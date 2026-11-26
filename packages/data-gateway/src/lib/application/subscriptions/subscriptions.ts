import { authorize } from '../../domain/auth/authorizationPolicy'
import { badRequest, GatewayError, notFound } from '../../domain/errors/gatewayError'
import { classifyQuery } from '../../domain/query/queryClassification'
import { readEntities } from '../../domain/query/readEntities'
import { DataChangeSummary } from '../../domain/runtime/channelProtocol'
import { DataGatewayPort, RequestContext } from '../ports/input/dataGatewayPort'

export interface SubscriptionLimits {
	/** subscriptions at a time on one connection */
	max: number
	/** a subscribed query is run again at most once in this time, however many writes arrive */
	debounceMs: number
}

interface EntitySubscription {
	kind: 'entity'
	entity: string
	primaryKey: string[]
}

interface QuerySubscription {
	kind: 'query'
	/** the text, or the name of a query of application.queries */
	query?: string
	name?: string
	data: unknown
	reads: string[]
	last: string
	timer?: NodeJS.Timeout
	running: boolean
	again: boolean
}

type Subscription = EntitySubscription | QuerySubscription

/**
 * The subscriptions of one connection (a WebSocket, an SSE stream) to the writes of its schema (docs/SUBSCRIPTIONS.md),
 * always with the identity of who subscribed: its permissions, its view and its context.
 *
 * - To an entity: each write of it (action, keys, count), never the data; with keys, only those its view sees.
 * - To a query (or a named one): run again when something it reads is written, at most once per debounce, and its new
 *   result sent only when it changed.
 */
export class ConnectionSubscriptions {
	private readonly subscriptions = new Map<string, Subscription>()
	private sequence = 0
	private readonly off: () => void

	constructor (
		private readonly gateway: DataGatewayPort,
		private readonly ctx: RequestContext,
		onDataChange: (listener: (changes: DataChangeSummary[]) => void) => () => void,
		private readonly emit: (event: 'data.changed' | 'query.changed' | 'subscription.failed', params: Record<string, unknown>) => void,
		private readonly limits: SubscriptionLimits
	) {
		this.off = onDataChange(changes => { this.changed(changes).catch(() => undefined) })
	}

	private nextId (): string {
		if (this.subscriptions.size >= this.limits.max) {
			throw new GatewayError(429, 'TooManySubscriptionsError', `at most ${this.limits.max} subscriptions on a connection`)
		}
		return `s${++this.sequence}`
	}

	/** to the writes of an entity of its view */
	public async entity (entity: unknown): Promise<{ subscription: string }> {
		if (typeof entity !== 'string' || !entity) throw badRequest('ValidationError', 'entity is required (the name of an entity)')
		authorize(this.ctx.principal, 'execute', false)
		// an entity its view excludes is not there for it
		const found = await this.gateway.entity(this.ctx, entity)
		const subscription = this.nextId()
		this.subscriptions.set(subscription, { kind: 'entity', entity, primaryKey: (found as { primaryKey?: string[] }).primaryKey ?? [] })
		return { subscription }
	}

	/** to a query (its text and data) or a named one: its result now, and again when it changes */
	public async query (params: { query?: unknown, name?: unknown, data?: unknown }): Promise<{ subscription: string, result: unknown }> {
		let reads: string[]
		if (typeof params.name === 'string' && params.name) {
			const info = (await this.gateway.queries(this.ctx)).find(q => q.name === params.name)
			if (!info) throw notFound(`query ${params.name} not found (GET /queries lists them)`)
			if (info.writes) throw badRequest('ValidationError', `the query ${params.name} writes: only a read can be subscribed`)
			reads = info.reads
		} else if (typeof params.query === 'string' && params.query.trim()) {
			const classification = classifyQuery(await this.gateway.metadata(this.ctx, { query: params.query }))
			if (classification.writes) throw badRequest('ValidationError', 'the query writes: only a read can be subscribed')
			reads = readEntities(params.query, classification.entities, await this.gateway.entities(this.ctx) as { name: string, relations?: { name: string, entity: string }[] }[])
		} else {
			throw badRequest('ValidationError', 'query (its text) or name (of a query of application.queries) is required')
		}
		const subscription = this.nextId()
		const sub: QuerySubscription = {
			kind: 'query',
			...(typeof params.name === 'string' && params.name ? { name: params.name } : { query: params.query as string }),
			data: params.data ?? {},
			reads,
			last: '',
			running: false,
			again: false
		}
		const result = await this.run(sub)
		sub.last = JSON.stringify(result ?? null)
		this.subscriptions.set(subscription, sub)
		return { subscription, result }
	}

	public unsubscribe (subscription: unknown): { unsubscribed: boolean } {
		const sub = typeof subscription === 'string' ? this.subscriptions.get(subscription) : undefined
		if (!sub) throw notFound(`no subscription "${String(subscription)}" on this connection`)
		if (sub.kind === 'query' && sub.timer) clearTimeout(sub.timer)
		this.subscriptions.delete(subscription as string)
		return { unsubscribed: true }
	}

	/** the connection closed: every subscription goes */
	public close (): void {
		this.off()
		for (const sub of this.subscriptions.values()) if (sub.kind === 'query' && sub.timer) clearTimeout(sub.timer)
		this.subscriptions.clear()
	}

	public get size (): number { return this.subscriptions.size }

	private run (sub: QuerySubscription): Promise<unknown> {
		return sub.name
			? this.gateway.query(this.ctx, sub.name, { data: sub.data })
			: this.gateway.execute(this.ctx, { query: sub.query!, data: sub.data })
	}

	private async changed (changes: DataChangeSummary[]): Promise<void> {
		const entities = new Set(changes.map(c => c.entity))
		for (const [subscription, sub] of this.subscriptions) {
			if (sub.kind === 'entity') {
				for (const change of changes.filter(c => c.entity === sub.entity)) await this.entityChanged(subscription, sub, change)
			} else if (sub.reads.some(entity => entities.has(entity))) {
				this.schedule(subscription, sub)
			}
		}
	}

	/** a write of a subscribed entity: with keys, only those its view sees (read in its view, docs/SUBSCRIPTIONS.md §4) */
	private async entityChanged (subscription: string, sub: EntitySubscription, change: DataChangeSummary): Promise<void> {
		let keys = change.keys
		if (keys?.length && sub.primaryKey.length) {
			try {
				keys = await this.visible(sub, keys)
			} catch {
				return
			}
			if (keys.length === 0) return
		}
		this.emit('data.changed', {
			subscription,
			entity: change.entity,
			action: change.action,
			...(keys?.length ? { keys } : {}),
			...(change.count !== undefined ? { count: change.count } : {})
		})
	}

	/** the keys of the change that its view sees: they are read with its identity (its view, its context) */
	private async visible (sub: EntitySubscription, keys: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
		const data: Record<string, unknown> = {}
		const conditions = keys.map((key, i) => sub.primaryKey.map((field, j) => {
			data[`k${i}_${j}`] = key[field]
			return `p.${field} == k${i}_${j}`
		}).join(' && '))
		const query = `${sub.entity}.filter(p => ${conditions.map(c => `(${c})`).join(' || ')}).map(p => [${sub.primaryKey.map(f => `p.${f}`).join(', ')}])`
		const rows = await this.gateway.execute(this.ctx, { query, data }) as Record<string, unknown>[]
		const seen = new Set((rows ?? []).map(row => JSON.stringify(sub.primaryKey.map(f => row[f]))))
		return keys.filter(key => seen.has(JSON.stringify(sub.primaryKey.map(f => key[f]))))
	}

	/** run the query again, at most once per debounce; a write during a run makes it run once more after */
	private schedule (subscription: string, sub: QuerySubscription): void {
		if (sub.running) { sub.again = true; return }
		if (sub.timer) return
		sub.timer = setTimeout(() => {
			sub.timer = undefined
			sub.running = true
			this.run(sub)
				.then(result => {
					const text = JSON.stringify(result ?? null)
					if (text !== sub.last && this.subscriptions.get(subscription) === sub) {
						sub.last = text
						this.emit('query.changed', { subscription, result })
					}
				}, (error: any) => {
					if (this.subscriptions.get(subscription) === sub) this.emit('subscription.failed', { subscription, error: error?.name ?? 'Error', message: error?.message ?? String(error) })
				})
				.finally(() => {
					sub.running = false
					if (sub.again) { sub.again = false; this.schedule(subscription, sub) }
				})
		}, this.limits.debounceMs)
	}
}
