import { LoggerPort } from '../ports/output/supportPorts'

/** An event of the outbox of λORM (LambdaOrmOutbox): a change of the data, never the data */
export interface OutboxEvent {
	id: string
	entity: string
	action: string
	keys?: Record<string, unknown>[] | null
	actor?: unknown
	tx?: string
	time: string | Date
	status: 'pending' | 'done' | 'dead'
	attempts: number
	error?: string | null
}

/** The outbox of a schema: what is pending, what was delivered or failed, the dead ones and their retry */
export interface OutboxPort {
	pending (limit: number): Promise<OutboxEvent[]>
	done (ids: string[]): Promise<void>
	/** retried later by λORM (1, 2, 4… s, an hour at most); dead after its maxAttempts */
	failed (id: string, error: string): Promise<void>
	list (status: 'pending' | 'done' | 'dead', limit: number): Promise<OutboxEvent[]>
	/** a dead (or failed) event back to pending, its attempts from 0 */
	retry (id: string): Promise<boolean>
}

/** Where an event goes: a webhook, a topic of Kafka */
export interface OutboxDestinationPort {
	readonly name: string
	accepts (event: OutboxEvent): boolean
	deliver (event: OutboxEvent): Promise<void>
	close? (): Promise<void>
}

export interface OutboxDispatcherStats { delivered: number, failed: number, rounds: number }

/**
 * The dispatcher of the outbox of a schema (docs/OUTBOX_DISPATCHER.md): a round every interval takes the pending events,
 * delivers each to every destination that takes it (all of them, or it failed: it is retried whole, so the
 * destinations must be idempotent by its id), and marks it done or failed. One per outbox (its replica decides).
 */
export class OutboxDispatcher {
	private timer?: NodeJS.Timeout
	private stopped = false
	private running?: Promise<void>
	private readonly stats = { delivered: 0, failed: 0, rounds: 0 }

	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly outbox: OutboxPort,
		private readonly destinations: OutboxDestinationPort[],
		private readonly settings: { intervalMs: number, batch: number },
		private readonly logger: LoggerPort
	) {}

	public start (): void {
		this.stopped = false
		this.schedule()
	}

	private schedule (): void {
		if (this.stopped) return
		this.timer = setTimeout(() => {
			this.running = this.round().catch(error => this.logger.error(error as Error)).finally(() => { this.running = undefined; this.schedule() })
		}, this.settings.intervalMs)
		this.timer.unref?.()
	}

	/** one round: the pending events, delivered (exported for the tests) */
	public async round (): Promise<void> {
		this.stats.rounds++
		const events = await this.outbox.pending(this.settings.batch)
		const done: string[] = []
		for (const event of events) {
			const targets = this.destinations.filter(d => d.accepts(event))
			try {
				for (const target of targets) await target.deliver(event)
				done.push(event.id)
				this.stats.delivered++
			} catch (error: any) {
				this.stats.failed++
				await this.outbox.failed(event.id, String(error?.message ?? error))
			}
		}
		if (done.length) await this.outbox.done(done)
	}

	public get snapshot (): OutboxDispatcherStats { return { ...this.stats } }

	/** the round running ends and no other starts, its destinations stay open (another replica took the outbox) */
	public async pause (): Promise<void> {
		this.stopped = true
		if (this.timer) clearTimeout(this.timer)
		await this.running?.catch(() => undefined)
	}

	/** the round running ends; no other starts; its destinations close */
	public async stop (): Promise<void> {
		await this.pause()
		await Promise.all(this.destinations.map(d => d.close?.().catch(() => undefined)))
	}
}
