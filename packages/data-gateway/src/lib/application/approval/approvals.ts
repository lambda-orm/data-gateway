import { Approval, ApprovalPending, ApprovalStatus } from '../../domain/approval/approval'
import { GatewayError } from '../../domain/errors/gatewayError'
import { ExecuteRequest, RequestContext, ScriptRequest } from '../ports/input/dataGatewayPort'
import { ApprovalStorePort } from '../ports/output/approvalPorts'
import { ClockPort } from '../ports/output/supportPorts'

export interface ApprovalSettings {
	/** writes: every write by MCP waits (mcp.approval) */
	mcp: 'none' | 'writes'
	expiresMs: number
}

const STATUSES: ApprovalStatus[] = ['pending', 'approved', 'done', 'failed', 'rejected', 'expired']

/**
 * Whether a write waits for a person, and leaving it waiting (docs/MUTATION_APPROVAL.md §3): a write by MCP with
 * mcp.approval writes, or of a credential or role with approval writes. A write a person approved runs at once.
 */
export class ApprovalGate {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly store: ApprovalStorePort,
		private readonly settings: ApprovalSettings,
		private readonly schema: string,
		private readonly clock: ClockPort,
		private readonly newId: () => string,
		/** the sentences a query would run, for who decides (none for a script) */
		private readonly planOf: (query: string, options: Record<string, unknown>) => Promise<unknown>
	) {}

	public needs (ctx: RequestContext): boolean {
		if (ctx.approvedBy) return false
		if (ctx.principal.approval === 'writes') return true
		return this.settings.mcp === 'writes' && ctx.transport.startsWith('mcp')
	}

	/** planOptions: the options it would run with (its view, its context), for its plan */
	public async request (ctx: RequestContext, operation: Approval['operation'], text: string, data: unknown, options: Record<string, unknown> | undefined, name?: string, planOptions?: Record<string, unknown>): Promise<ApprovalPending> {
		const now = this.clock.now()
		const p = ctx.principal
		let plan: unknown
		if (operation === 'execute') {
			try { plan = await this.planOf(text, planOptions ?? options ?? {}) } catch { plan = undefined }
		}
		const approval: Approval = {
			id: this.newId(),
			schema: this.schema,
			operation,
			text,
			...(name ? { name } : {}),
			...(data !== undefined ? { data } : {}),
			...(options ? { options } : {}),
			...(plan !== undefined ? { plan } : {}),
			requester: {
				name: p.name,
				permissions: [...p.permissions],
				...(p.actor ? { actor: p.actor } : {}),
				...(p.context ? { context: p.context } : {}),
				...(p.view ? { view: p.view } : {}),
				transport: ctx.transport
			},
			status: 'pending',
			createdAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + this.settings.expiresMs).toISOString()
		}
		await this.store.create(approval)
		return {
			approval: approval.id,
			status: 'pending',
			expiresAt: approval.expiresAt,
			message: `This write waits for a person to approve it (approval ${approval.id}). Nothing changed yet: ask the user to approve it, and check it later with approval_status.`
		}
	}
}

/** What runs an approved write as who asked for it (the use cases of the queries and the scripts) */
export interface ApprovedRunner {
	execute (ctx: RequestContext, request: ExecuteRequest, named?: string): Promise<unknown>
	executeScript (ctx: RequestContext, request: ScriptRequest): Promise<unknown>
}

/**
 * The writes that wait (docs/MUTATION_APPROVAL.md §4): listed and decided by who has approve (never its own: four
 * eyes); approved, run once with the identity that asked (its view, its context) and audited with who approved it.
 */
export class ApprovalUseCases {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly store: ApprovalStorePort,
		private readonly schema: string,
		private readonly runner: ApprovedRunner,
		private readonly clock: ClockPort
	) {}

	private requireApprove (ctx: RequestContext): void {
		if (!ctx.principal.permissions.has('approve')) {
			throw new GatewayError(403, 'ForbiddenError', `the credential "${ctx.principal.name}" does not have the "approve" permission`)
		}
	}

	/** a pending one whose time is over is expired (when it is next read) */
	private async fresh (approval: Approval | undefined): Promise<Approval | undefined> {
		if (!approval || approval.status !== 'pending' || Date.parse(approval.expiresAt) > this.clock.now().getTime()) return approval
		await this.store.transition(approval.id, 'pending', { status: 'expired' })
		return this.store.get(approval.id)
	}

	private async found (id: string): Promise<Approval> {
		const approval = await this.fresh(await this.store.get(String(id)))
		if (!approval || approval.schema !== this.schema) throw new GatewayError(404, 'NotFoundError', `the approval "${id}" doesn't exist`)
		return approval
	}

	public async list (ctx: RequestContext, status?: unknown, limit?: unknown): Promise<Approval[]> {
		this.requireApprove(ctx)
		const wanted = status === undefined || status === '' ? undefined : String(status)
		if (wanted !== undefined && !STATUSES.includes(wanted as ApprovalStatus)) throw new GatewayError(400, 'ValidationError', `status must be one of ${STATUSES.join(', ')}`)
		const n = Math.min(Math.max(Number(limit ?? 100) || 100, 1), 1000)
		const list = await this.store.list(this.schema, wanted as ApprovalStatus | undefined, n)
		const fresh = await Promise.all(list.map(a => this.fresh(a)))
		return (fresh.filter(Boolean) as Approval[]).filter(a => wanted === undefined || a.status === wanted)
	}

	/** its state: for who asked for it, or who approves */
	public async status (ctx: RequestContext, id: string): Promise<Approval> {
		const approval = await this.found(id)
		if (approval.requester.name !== ctx.principal.name && !ctx.principal.permissions.has('approve')) {
			throw new GatewayError(404, 'NotFoundError', `the approval "${id}" doesn't exist`)
		}
		return approval
	}

	public async approve (ctx: RequestContext, id: string): Promise<Approval> {
		this.requireApprove(ctx)
		const approval = await this.decidable(ctx, id)
		const decidedAt = this.clock.now().toISOString()
		if (!await this.store.transition(approval.id, 'pending', { status: 'approved', decidedBy: ctx.principal.name, decidedAt })) {
			throw new GatewayError(409, 'ApprovalDecidedError', `the approval "${id}" was decided meanwhile`)
		}
		const r = approval.requester
		const asked: RequestContext = {
			principal: {
				name: r.name,
				permissions: new Set(r.permissions),
				...(r.actor ? { actor: r.actor } : {}),
				...(r.context ? { context: r.context } : {}),
				...(r.view ? { view: r.view } : {})
			},
			transport: r.transport,
			approvedBy: ctx.principal.name
		}
		try {
			const result = approval.operation === 'execute'
				? await this.runner.execute(asked, { query: approval.text, data: approval.data, options: approval.options as any }, approval.name)
				: await this.runner.executeScript(asked, { script: approval.text, data: approval.data, options: approval.options as any })
			await this.store.transition(approval.id, 'approved', { status: 'done', result: result === undefined ? null : result })
		} catch (error: any) {
			await this.store.transition(approval.id, 'approved', { status: 'failed', error: error?.message ?? String(error) })
		}
		return (await this.store.get(approval.id))!
	}

	public async reject (ctx: RequestContext, id: string, reason?: unknown): Promise<Approval> {
		this.requireApprove(ctx)
		const approval = await this.decidable(ctx, id)
		const change = { status: 'rejected' as const, decidedBy: ctx.principal.name, decidedAt: this.clock.now().toISOString(), ...(typeof reason === 'string' && reason.trim() ? { reason: reason.trim().slice(0, 2000) } : {}) }
		if (!await this.store.transition(approval.id, 'pending', change)) {
			throw new GatewayError(409, 'ApprovalDecidedError', `the approval "${id}" was decided meanwhile`)
		}
		return (await this.store.get(approval.id))!
	}

	/** pending, not expired, and not of who decides */
	private async decidable (ctx: RequestContext, id: string): Promise<Approval> {
		const approval = await this.found(id)
		if (approval.status === 'expired') throw new GatewayError(410, 'ApprovalExpiredError', `the approval "${id}" expired at ${approval.expiresAt}`)
		if (approval.status !== 'pending') throw new GatewayError(409, 'ApprovalDecidedError', `the approval "${id}" is ${approval.status}`)
		if (approval.requester.name === ctx.principal.name) {
			throw new GatewayError(403, 'ApprovalOwnError', `the credential "${ctx.principal.name}" asked for this write: another one approves it`)
		}
		return approval
	}
}
