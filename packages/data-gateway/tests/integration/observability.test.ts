// The span of an HTTP request of the gateway (docs/OBSERVABILITY.md §7.3): SERVER, named by its route template with the
// schema as {schema}, child of the traceparent of the caller, and the actor that reaches λORM.
import { context, propagation, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import { HttpTransport } from '../../src/lib/infrastructure/input/http/httpTransport'
import { BearerAuthenticator } from '../../src/lib/infrastructure/output/auth/authenticators'
import { NoMetrics } from '../../src/lib/infrastructure/output/metrics/promClientMetrics'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { InlineSchemaDirectory } from '../../src/lib/application/runtime/inlineSchemaDirectory'
import { requestTracer } from '../../src/lib/infrastructure/input/telemetry/requestTracer'
import { fakeGateway, FixedClock, GatewayFixture } from '../helpers/fakes'
import { call } from '../helpers/net'

const credentials = [{ name: 'backend', value: 'backend-token', permissions: ['read' as const, 'write' as const] }]
const exporter = new InMemorySpanExporter()
const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] })
let fixture: GatewayFixture
let transport: HttpTransport
let base: string

beforeAll(async () => {
	context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
	propagation.setGlobalPropagator(new W3CTraceContextPropagator())
	trace.setGlobalTracerProvider(provider)
	requestTracer.enable(true)
	fixture = fakeGateway()
	transport = new HttpTransport({
		port: 0, host: '127.0.0.1', basePath: '/data-gateway', requestBodySize: '1mb', rateLimit: { windowMs: 1000, max: 0 }, swaggerEnabled: false
	}, {
		directory: new InlineSchemaDirectory([{
			path: 'shop', gateway: fixture.gateway, mcp: undefined as any, transports: ['http'], authenticators: { http: new BearerAuthenticator(credentials) }
		}], new FixedClock(), '9.9.9'),
		metrics: new NoMetrics(),
		logger: new ConsoleLogger('error')
	})
	await transport.start()
	base = `http://127.0.0.1:${transport.address!.port}/data-gateway/shop`
})
afterAll(async () => {
	await transport.stop()
	requestTracer.enable(false)
	await provider.shutdown()
	trace.disable()
	propagation.disable()
	context.disable()
})
beforeEach(() => exporter.reset())

const spanNamed = async (name: string) => {
	for (let i = 0; i < 20 && !exporter.getFinishedSpans().some(p => p.name === name); i++) await new Promise(resolve => setTimeout(resolve, 10))
	return exporter.getFinishedSpans().find(p => p.name === name)
}

test('a span per request, by its route template, child of the traceparent of the caller', async () => {
	const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
	const res = await call(base, '/execute', { body: { query: 'Products', data: { secret: 'x' } }, headers: { Authorization: 'Bearer backend-token', traceparent } })
	expect(res.status).toBe(200)
	const span = await spanNamed('POST /data-gateway/{schema}/execute')
	expect(span).toBeDefined()
	expect(span!.kind).toBe(1) // SERVER
	expect(span!.spanContext().traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
	expect(span!.parentSpanContext?.spanId).toBe('00f067aa0ba902b7')
	expect(span!.attributes).toMatchObject({ 'http.request.method': 'POST', 'http.route': '/data-gateway/{schema}/execute', 'http.response.status_code': 200, 'enduser.id': 'backend', 'url.path': '/data-gateway/shop/execute' })
	expect(JSON.stringify(span!.attributes)).not.toContain('secret')
})

test('the actor reaches λORM: the credential and the address of the client', async () => {
	await call(base, '/execute', { body: { query: 'Products' }, headers: { Authorization: 'Bearer backend-token' } })
	const options = fixture.orm.executed.at(-1)!.options as any
	expect(options.actor.credential).toBe('backend')
	expect(options.actor.ip).toMatch(/127\.0\.0\.1/)
})

test('a request that fails in the server: the span says so; a 401 does not', async () => {
	const unauthorized = await call(base, '/execute', { body: { query: 'Products' } })
	expect(unauthorized.status).toBe(401)
	const span = await spanNamed('POST')
	expect(span?.status.code ?? 0).toBe(0)
	expect(span?.attributes['http.response.status_code']).toBe(401)
})
