import { createHmac } from 'crypto'
import { Kafka, Partitioners, Producer, KafkaConfig } from 'kafkajs'
import { Orm } from '@lambdaorm/lib'
import { OutboxDestinationPort, OutboxEvent, OutboxPort } from '../../../application/outbox/outboxDispatcher'

/** The outbox of λORM (orm.outbox, LambdaOrmOutbox) behind the port of the dispatcher */
export class LambdaOrmOutboxAdapter implements OutboxPort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly orm: Orm) {}

	private get declared (): boolean { return !!this.orm.state.schema?.infrastructure?.outbox }

	private require (): void {
		if (!this.declared) throw Object.assign(new Error('the schema has no outbox: declare infrastructure.outbox in its lambdaORM.yaml'), { status: 400, name: 'ValidationError' })
	}

	public async pending (limit: number) { return this.orm.outbox.pending({ limit }) as Promise<OutboxEvent[]> }
	public async done (ids: string[]) { await this.orm.outbox.done(ids) }
	public async failed (id: string, error: string) { await this.orm.outbox.failed(id, error) }

	public async list (status: 'pending' | 'done' | 'dead', limit: number): Promise<OutboxEvent[]> {
		this.require()
		// page takes numbers, not variables: the limit is a whole number checked by the use case
		const rows = await this.orm.execute(`LambdaOrmOutbox.filter(p => p.status == status).sort(p => desc(p.time)).page(1, ${Math.floor(Number(limit))})`, { status }) as any[]
		return rows.map(p => ({ ...p, keys: parse(p.keys), actor: parse(p.actor) }))
	}

	public async retry (id: string): Promise<boolean> {
		this.require()
		const changed = await this.orm.execute('LambdaOrmOutbox.update(p => ({ status: "pending", attempts: 0, nextAttempt: null, error: null })).filter(p => p.id == id)', { id })
		return Number(changed) > 0
	}
}

const parse = (value: unknown): unknown => {
	if (typeof value !== 'string') return value
	try { return JSON.parse(value) } catch { return value }
}

/** What leaves the gateway of an event: never the data, nor its state in the outbox */
const payloadOf = (event: OutboxEvent) => ({
	id: event.id,
	entity: event.entity,
	action: event.action,
	...(event.keys ? { keys: event.keys } : {}),
	...(event.actor ? { actor: event.actor } : {}),
	...(event.tx ? { tx: event.tx } : {}),
	time: event.time instanceof Date ? event.time.toISOString() : event.time
})

const takes = (entities: string[] | undefined, event: OutboxEvent) => !entities || entities.includes(event.entity)

/**
 * A webhook (docs/OUTBOX_DISPATCHER.md §3): a POST per event, its id in X-Data-Gateway-Event (the key of idempotency),
 * signed with HMAC-SHA256 of the timestamp and the body (X-Data-Gateway-Signature: sha256=…). A 2xx is delivered.
 */
export class WebhookDestination implements OutboxDestinationPort {
	public readonly name: string

	constructor (private readonly settings: { url: string, secret?: string, timeoutMs: number, entities?: string[] }, private readonly now: () => number = Date.now) {
		this.name = `webhook ${new URL(settings.url).host}`
	}

	public accepts (event: OutboxEvent): boolean { return takes(this.settings.entities, event) }

	public async deliver (event: OutboxEvent): Promise<void> {
		const body = JSON.stringify(payloadOf(event))
		const timestamp = String(Math.floor(this.now() / 1000))
		const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Data-Gateway-Event': event.id, 'X-Data-Gateway-Timestamp': timestamp }
		if (this.settings.secret) headers['X-Data-Gateway-Signature'] = `sha256=${createHmac('sha256', this.settings.secret).update(`${timestamp}.${body}`).digest('hex')}`
		const response = await fetch(this.settings.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(this.settings.timeoutMs) })
		if (!response.ok) throw new Error(`${this.name} answered ${response.status}`)
	}
}

/** A topic of Kafka (the brokers of infrastructure.queue of the schema): the key <entity>:<keys>, the event as value */
export class KafkaDestination implements OutboxDestinationPort {
	public readonly name: string
	private producer?: Promise<Producer>

	constructor (private readonly settings: { topic: string, entities?: string[] }, private readonly config: KafkaConfig, private readonly kafka: (config: KafkaConfig) => Kafka = c => new Kafka(c)) {
		this.name = `kafka ${settings.topic}`
	}

	public accepts (event: OutboxEvent): boolean { return takes(this.settings.entities, event) }

	private connected (): Promise<Producer> {
		if (!this.producer) {
			const producer = this.kafka(this.config).producer({ createPartitioner: Partitioners.DefaultPartitioner })
			this.producer = producer.connect().then(() => producer)
			this.producer.catch(() => { this.producer = undefined })
		}
		return this.producer
	}

	public async deliver (event: OutboxEvent): Promise<void> {
		const producer = await this.connected()
		await producer.send({ topic: this.settings.topic, messages: [{ key: `${event.entity}:${JSON.stringify(event.keys ?? null)}`, value: JSON.stringify(payloadOf(event)) }] })
	}

	public async close (): Promise<void> {
		const producer = await this.producer?.catch(() => undefined)
		await producer?.disconnect()
	}
}
