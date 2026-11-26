import { authorize, Operation } from '../../domain/auth/authorizationPolicy'
import { badRequest, forbidden, notFound } from '../../domain/errors/gatewayError'
import { OutboxPort } from '../outbox/outboxDispatcher'
import { ApprovalUseCases } from '../approval/approvals'

type ApprovalOperation = 'approvalsList' | 'approve' | 'reject'
import { CommandOperation } from '../../domain/runtime/channelProtocol'
import { RequestContext } from '../ports/input/dataGatewayPort'
import { OrmCommandPort } from '../ports/output/ormPorts'
import { Auditor } from './auditor'

const OPERATIONS: Record<Exclude<CommandOperation, ApprovalOperation>, Operation> = {
	stages: 'schema',
	fetch: 'stageFetch',
	pushSentences: 'stageFetch',
	push: 'stagePush',
	dropSentences: 'stageFetch',
	drop: 'stageDrop',
	export: 'stageExport',
	import: 'stageImport',
	pullSchema: 'stageFetch',
	pull: 'stagePull',
	introspectSchema: 'schema',
	migrations: 'stageFetch',
	migrateSentences: 'stageFetch',
	migrate: 'stagePush',
	seedFiles: 'stageFetch',
	seed: 'stageImport',
	outboxList: 'stageFetch',
	outboxRetry: 'stagePush'
}

const versionOf = (value: unknown): string => {
	if (typeof value !== 'string' || !/^\d{12}$/.test(value)) throw badRequest('ValidationError', 'version is the one of a migration (yyMMddHHmmss, as the list of the migrations shows it)')
	return value
}

/**
 * The commands of a workspace in its schema worker (docs/DATA_GATEWAY_ADMIN_PLAN.md §4): authorized again here (the
 * edge already did), audited when they change the databases. The stage is the first one when none is given.
 */
export class CommandUseCases {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly orm: OrmCommandPort, private readonly auditor: Auditor, private readonly outbox?: OutboxPort, private readonly approvals?: ApprovalUseCases) {}

	/** the writes that wait (docs/MUTATION_APPROVAL.md §4): approve authorizes them, not the permissions of the stage */
	private approvalOp (ctx: RequestContext, op: ApprovalOperation, args: unknown[]): Promise<unknown> {
		if (!this.approvals) throw badRequest('ValidationError', 'the schema has no approvals')
		if (op === 'approvalsList') return this.approvals.list(ctx, args[0], args[1])
		if (typeof args[0] !== 'string' || !args[0]) throw badRequest('ValidationError', 'id is the one of an approval')
		return op === 'approve' ? this.approvals.approve(ctx, args[0]) : this.approvals.reject(ctx, args[0], args[1])
	}

	/** the outbox of the schema (docs/OUTBOX_DISPATCHER.md §5): its events by state, and a dead one back to pending */
	private outboxOp (op: 'outboxList' | 'outboxRetry', args: unknown[]): Promise<unknown> {
		if (!this.outbox) throw badRequest('ValidationError', 'the schema has no outbox')
		if (op === 'outboxList') {
			const status = args[0] ?? 'dead'
			if (status !== 'pending' && status !== 'done' && status !== 'dead') throw badRequest('ValidationError', 'status is pending, done or dead')
			const limit = Math.min(Math.max(Number(args[1] ?? 100) || 100, 1), 1000)
			return this.outbox.list(status, limit)
		}
		if (typeof args[0] !== 'string' || !args[0]) throw badRequest('ValidationError', 'id is the one of an event of the outbox')
		const id = args[0]
		return this.outbox.retry(id).then(found => {
			if (!found) throw notFound(`no event ${id} in the outbox`)
			return { id, status: 'pending' }
		})
	}

	private stageOf (stage: unknown): string {
		const names = this.orm.stageNames()
		if (stage === undefined || stage === null || stage === '') {
			if (!names.length) throw badRequest('ValidationError', 'the schema has no stages')
			return names[0]
		}
		if (typeof stage !== 'string' || !names.includes(stage)) throw badRequest('ValidationError', `unknown stage "${String(stage)}" (${names.join(', ')})`)
		return stage
	}

	public async run (ctx: RequestContext, op: CommandOperation, args: unknown[]): Promise<unknown> {
		if (op === 'approvalsList' || op === 'approve' || op === 'reject') return this.approvalOp(ctx, op, args)
		authorize(ctx.principal, OPERATIONS[op])
		if (op === 'stages') return this.orm.stageNames()
		if (op === 'outboxList' || op === 'outboxRetry') return this.outboxOp(op, args)
		if (op === 'introspectSchema') {
			if (typeof args[1] !== 'string' || !args[1]) throw badRequest('ValidationError', 'name is the entity of the data (Orders for a list of orders)')
			return this.orm.introspectSchema(args[0], args[1])
		}
		const stage = this.stageOf(args[0])
		const force = args[1] === true
		// a push or a migration that loses data: with the permission destructive (docs/ROLE_SCOPES.md §3)
		if ((op === 'push' || op === 'migrate') && args[2] === true && !ctx.principal.permissions.has('destructive')) throw forbidden(ctx.principal.name, 'destructive')
		switch (op) {
		case 'fetch': return this.orm.fetch(stage)
		case 'pushSentences': return this.orm.pushSentences(stage)
		case 'dropSentences': return this.orm.dropSentences(stage)
		case 'export': return this.orm.export(stage)
		case 'push': return this.auditor.track(ctx, { operation: 'stagePush', stage }, () => this.orm.push(stage, force, ctx.principal.actor, args[2] === true))
		case 'migrations': return this.orm.migrations(stage)
		case 'migrateSentences': return this.orm.migrateSentences(stage, versionOf(args[1]))
		case 'migrate': {
			const version = versionOf(args[1])
			return this.auditor.track(ctx, { operation: 'stageMigrate', stage }, () => this.orm.migrate(stage, version, ctx.principal.actor, args[2] === true))
		}
		case 'seedFiles': return this.orm.seedFiles(stage)
		case 'seed': return this.auditor.track(ctx, { operation: 'stageSeed', stage }, () => this.orm.seed(stage, ctx.principal.actor))
		case 'drop': return this.auditor.track(ctx, { operation: 'stageDrop', stage }, () => this.orm.drop(stage, force, ctx.principal.actor))
		case 'import': return this.auditor.track(ctx, { operation: 'stageImport', stage, data: args[1] }, () => this.orm.import(stage, args[1], ctx.principal.actor))
		case 'pullSchema': return this.orm.pullSchema(stage)
		case 'pull': return this.orm.pull(stage, ctx.principal.actor)
		}
	}
}
