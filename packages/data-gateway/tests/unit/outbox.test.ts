// The dispatcher of the outbox (docs/OUTBOX_DISPATCHER.md): the pending events to every destination that takes them
// (all, or it failed and is retried whole), signed webhooks, Kafka by the key of the row; its configuration.
import http from 'http'
import { AddressInfo } from 'net'
import { createHmac } from 'crypto'
import { OutboxDestinationPort, OutboxDispatcher, OutboxEvent, OutboxPort } from '../../src/lib/application/outbox/outboxDispatcher'
import { KafkaDestination, WebhookDestination } from '../../src/lib/infrastructure/output/outbox/outboxDestinations'
import { ConfigReader } from '../../src/lib/domain/config/configReader'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'

const event = (id: string, entity = 'Orders'): OutboxEvent => ({ id, entity, action: 'insert', keys: [{ id: Number(id) }], tx: 't1', time: '2026-11-25T10:00:00.000Z', status: 'pending', attempts: 0 })

class MemoryOutbox implements OutboxPort {
	public events: OutboxEvent[] = []
	public delivered: string[] = []
	public failures: { id: string, error: string }[] = []
	async pending (limit: number) { return this.events.filter(e => e.status === 'pending').slice(0, limit) }
	async done (ids: string[]) { this.delivered.push(...ids); for (const e of this.events) if (ids.includes(e.id)) e.status = 'done' }
	async failed (id: string, error: string) { this.failures.push({ id, error }) }
	async list (status: 'pending' | 'done' | 'dead') { return this.events.filter(e => e.status === status) }
	async retry () { return true }
}

const destination = (name: string, fails = (_e: OutboxEvent) => false, entities?: string[]): OutboxDestinationPort & { got: string[] } => {
	const got: string[] = []
	return { name, got, accepts: e => !entities || entities.includes(e.entity), deliver: async e => { if (fails(e)) throw new Error(`${name} is down`); got.push(e.id) } }
}

const logger = new ConsoleLogger('error')

describe('the dispatcher', () => {
	test('each event to every destination that takes it; delivered by all, it is done', async () => {
		const outbox = new MemoryOutbox()
		outbox.events = [event('1'), event('2', 'Customers')]
		const all = destination('all')
		const orders = destination('orders', undefined, ['Orders'])
		await new OutboxDispatcher(outbox, [all, orders], { intervalMs: 10, batch: 10 }, logger).round()
		expect(all.got).toEqual(['1', '2'])
		expect(orders.got).toEqual(['1'])
		expect(outbox.delivered).toEqual(['1', '2'])
	})

	test('one destination fails: the event failed (retried whole later), the others go on', async () => {
		const outbox = new MemoryOutbox()
		outbox.events = [event('1'), event('2')]
		const ok = destination('ok')
		const flaky = destination('flaky', e => e.id === '1')
		const dispatcher = new OutboxDispatcher(outbox, [ok, flaky], { intervalMs: 10, batch: 10 }, logger)
		await dispatcher.round()
		expect(outbox.failures).toEqual([{ id: '1', error: 'flaky is down' }])
		expect(outbox.delivered).toEqual(['2'])
		expect(dispatcher.snapshot).toMatchObject({ delivered: 1, failed: 1, rounds: 1 })
	})

	test('rounds every interval until stopped', async () => {
		const outbox = new MemoryOutbox()
		const dispatcher = new OutboxDispatcher(outbox, [destination('d')], { intervalMs: 5, batch: 10 }, logger)
		dispatcher.start()
		outbox.events = [event('1')]
		await new Promise(resolve => setTimeout(resolve, 40))
		await dispatcher.stop()
		const rounds = dispatcher.snapshot.rounds
		expect(outbox.delivered).toEqual(['1'])
		await new Promise(resolve => setTimeout(resolve, 20))
		expect(dispatcher.snapshot.rounds).toBe(rounds)
	})
})

describe('a webhook', () => {
	let server: http.Server
	let url = ''
	const received: { headers: http.IncomingHttpHeaders, body: string }[] = []
	let status = 200
	beforeAll(async () => {
		server = http.createServer((req, res) => {
			let body = ''
			req.on('data', chunk => { body += chunk })
			req.on('end', () => { received.push({ headers: req.headers, body }); if (status === 0) return; res.writeHead(status).end() })
		})
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
		url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks`
	})
	afterAll(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))

	test('a POST per event, never the data nor its state; its id and a signature the receiver can check', async () => {
		const webhook = new WebhookDestination({ url, secret: 's3cret', timeoutMs: 1000 }, () => 1_764_064_800_000)
		await webhook.deliver({ ...event('7'), error: 'old', attempts: 3 })
		const { headers, body } = received.at(-1)!
		expect(JSON.parse(body)).toEqual({ id: '7', entity: 'Orders', action: 'insert', keys: [{ id: 7 }], tx: 't1', time: '2026-11-25T10:00:00.000Z' })
		expect(headers['x-data-gateway-event']).toBe('7')
		expect(headers['x-data-gateway-signature']).toBe(`sha256=${createHmac('sha256', 's3cret').update(`${headers['x-data-gateway-timestamp']}.${body}`).digest('hex')}`)
	})

	test('not a 2xx, or no answer in its timeout: failed', async () => {
		status = 503
		await expect(new WebhookDestination({ url, timeoutMs: 1000 }).deliver(event('8'))).rejects.toThrow('answered 503')
		status = 0
		await expect(new WebhookDestination({ url, timeoutMs: 50 }).deliver(event('9'))).rejects.toThrow()
		status = 200
	})
})

describe('kafka', () => {
	test('to its topic, keyed by the entity and the keys of the row (their events in order), the event as value', async () => {
		const sent: any[] = []
		const producer = { connect: async () => undefined, send: async (record: any) => { sent.push(record) }, disconnect: async () => undefined }
		const kafka = new KafkaDestination({ topic: 'shop-changes', entities: ['Orders'] }, { brokers: ['k:9092'] }, () => ({ producer: () => producer }) as any)
		expect(kafka.accepts(event('1', 'Customers'))).toBe(false)
		await kafka.deliver(event('1'))
		expect(sent).toEqual([{ topic: 'shop-changes', messages: [{ key: 'Orders:[{"id":1}]', value: expect.stringContaining('"id":"1"') }] }])
		await kafka.close()
	})
})

describe('the configuration', () => {
	const minimal = { orm: { schemas: [{ path: 'shop', workspace: '/tmp/shop' }] }, transports: { http: { port: 9291 } } }
	test('its destinations, its interval and batch; by schema; what is wrong stops it', () => {
		const reading = new ConfigReader().read({
			...minimal,
			orm: { schemas: [{ path: 'shop', workspace: '/tmp/shop', outbox: { interval: '2s', batch: 50, destinations: [{ type: 'webhook', url: 'https://b.example.com/h', secret: 'x', timeout: '3s', entities: ['Orders'] }, { type: 'kafka', topic: 'changes' }] } }] }
		})
		expect(reading.issues).toEqual([])
		expect(reading.warnings).toEqual([])
		expect(reading.config!.orm.schemas[0].outbox).toEqual({
			dispatch: true, intervalMs: 2000, batch: 50,
			destinations: [{ type: 'webhook', url: 'https://b.example.com/h', secret: 'x', timeoutMs: 3000, entities: ['Orders'] }, { type: 'kafka', topic: 'changes' }]
		})
		const issues = (outbox: unknown) => new ConfigReader().read({ ...minimal, outbox }).issues.join('\n')
		expect(issues({ destinations: [{ type: 'webhook', url: 'ftp://x' }] })).toContain('is not an http(s) URL')
		expect(issues({ destinations: [{ type: 'kafka' }] })).toContain('topic is required')
		expect(issues({ destinations: [{ type: 'sqs' }] })).toContain('type must be webhook or kafka')
	})
})
