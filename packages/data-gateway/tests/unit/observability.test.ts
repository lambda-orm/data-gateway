// The observability of the gateway (docs/OBSERVABILITY_PLAN.md phase 3): its configuration, the actor of a request
// (set by the gateway, never by the client) and the trace across the channel to a schema worker.
import { context, propagation, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import { ConfigReader } from '../../src/lib/domain/config/configReader'
import { principal, withActor as principalWithActor } from '../../src/lib/domain/auth/principal'
import { requestOptions } from '../../src/lib/application/usecases/requestOptions'
import { resolveObservability } from '../../src/lib/infrastructure/build/observability'
import { ChannelDispatcher } from '../../src/lib/application/runtime/channelDispatcher'
import { SchemaRouter } from '../../src/lib/application/runtime/schemaRouter'
import { OtelTracing } from '../../src/lib/infrastructure/output/telemetry/otelTracing'
import { requestTracer } from '../../src/lib/infrastructure/input/telemetry/requestTracer'
import { DataGatewayMcpServer } from '../../src/lib/application/mcp/dataGatewayMcpServer'
import { ToolCatalog } from '../../src/lib/application/mcp/toolCatalog'
import { gatewayTools } from '../../src/lib/application/mcp/gatewayTools'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { fakeGateway, FixedClock } from '../helpers/fakes'

const minimal = { orm: { schemas: [{ path: 'shop', workspace: '/tmp/shop' }] }, transports: { http: { port: 9291 } } }

describe('configuration', () => {
	test('observability is the shape of the one of a lambdaORM.yaml', () => {
		const reading = new ConfigReader().read({ ...minimal, observability: { exporter: { type: 'otlp', endpoint: 'http://alloy:4318' }, traces: { enabled: true } } })
		expect(reading.issues).toEqual([])
		expect(reading.config?.observability).toEqual({ exporter: { type: 'otlp', endpoint: 'http://alloy:4318' }, traces: { enabled: true } })
	})
	test('no headers (tokens) in the file, and an object', () => {
		expect(new ConfigReader().read({ ...minimal, observability: { exporter: { headers: 'Authorization=x' } } }).issues.join()).toContain('OTEL_EXPORTER_OTLP_HEADERS')
		expect(new ConfigReader().read({ ...minimal, observability: 'on' }).issues.join()).toContain('observability must be an object')
	})
	test('explore: where the traces, metrics and logs are seen, of the gateway (not of the SDK of λORM); its URL checked', () => {
		const reading = new ConfigReader().read({ ...minimal, observability: { traces: { enabled: true }, explore: { grafana: 'https://grafana.example.com/' } } })
		expect(reading.issues).toEqual([])
		expect(reading.config?.explore).toEqual({ grafana: 'https://grafana.example.com', tempo: 'tempo', prometheus: 'prometheus', loki: 'loki', orgId: 1 })
		expect(reading.config?.observability).toEqual({ traces: { enabled: true } })
		expect(new ConfigReader().read({ ...minimal, observability: { explore: { grafana: 'https://g', tempo: 'tempo-eu', prometheus: 'vm', loki: 'loki-eu', orgId: 3 } } }).config?.explore).toEqual({ grafana: 'https://g', tempo: 'tempo-eu', prometheus: 'vm', loki: 'loki-eu', orgId: 3 })
		expect(new ConfigReader().read({ ...minimal }).config?.explore).toBeUndefined()
		expect(new ConfigReader().read({ ...minimal, observability: { explore: { grafana: 'grafana:3000' } } }).issues.join()).toContain('observability.explore.grafana')
		expect(new ConfigReader().read({ ...minimal, observability: { explore: { grafana: 'http://g', datasource: 'x' } } }).issues.join()).toContain('unknown keys datasource')
		expect(new ConfigReader().read({ ...minimal, observability: { explore: 'http://g' } }).issues.join()).toContain('observability.explore must be an object')
	})
	test('resolved once in the main thread: data-gateway by default, the OTEL_* override, invalid rules stop it', () => {
		expect(resolveObservability(undefined, {})).toBeUndefined()
		expect(resolveObservability({ traces: { enabled: true } }, {})?.serviceName).toBe('data-gateway')
		const resolved = resolveObservability(undefined, { OTEL_SERVICE_NAME: 'gw-cloud', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4318', OTEL_EXPORTER_OTLP_HEADERS: 'X-Scope-OrgID=ilusor' })
		expect(resolved).toMatchObject({ serviceName: 'gw-cloud', exporter: { type: 'otlp', endpoint: 'http://alloy:4318', headers: { 'X-Scope-OrgID': 'ilusor' } } })
		expect(() => resolveObservability({ traces: { rules: [{ condition: 'tenant == "x"' }] } }, {})).toThrow('observability')
	})
})

describe('actor', () => {
	test('the credential, and what the transport knows', () => {
		const who = principalWithActor(principal('modeler', ['read']), { session: 's1', client: 'data-gateway-ide 2.1.0', ip: '10.0.0.9', user: '' })
		expect(who.actor).toEqual({ credential: 'modeler', session: 's1', client: 'data-gateway-ide 2.1.0', ip: '10.0.0.9' })
	})
	test('the options of λORM take the actor of the gateway: one sent by the client is replaced', () => {
		const ctx = { principal: principalWithActor(principal('backend', ['read']), { ip: '10.0.0.1' }), transport: 'http' }
		expect(requestOptions({ stage: 'default', actor: { credential: 'admin' } } as any, ctx)).toEqual({ stage: 'default', actor: { credential: 'backend', ip: '10.0.0.1' } })
		expect(requestOptions('{"stage":"default"}', ctx)).toEqual({ stage: 'default', actor: { credential: 'backend', ip: '10.0.0.1' } })
		expect(requestOptions({ actor: { credential: 'admin' } } as any, { principal: principal('x', []), transport: 'http' })).toEqual({})
	})
	test('the view and the context of the client are dropped: the gateway decides them', () => {
		const ctx = { principal: principal('x', ['read']), transport: 'http' }
		expect(requestOptions({ stage: 'default', view: 'admin', context: { tenant: 'other' } } as any, ctx)).toEqual({ stage: 'default' })
		expect(requestOptions('{"view":"admin","context":{"tenant":"other"}}', ctx)).toEqual({})
	})
})

describe('the trace across the channel', () => {
	const exporter = new InMemorySpanExporter()
	const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] })
	beforeAll(() => {
		context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
		propagation.setGlobalPropagator(new W3CTraceContextPropagator())
		trace.setGlobalTracerProvider(provider)
	})
	afterAll(async () => {
		await provider.shutdown()
		trace.disable()
		propagation.disable()
		context.disable()
	})

	test('the edge sends the traceparent of its span; the worker runs in it, with the actor', async () => {
		const sent: any[] = []
		const router = new SchemaRouter([{ path: 'shop', transports: ['http'], maxConcurrent: 0, timeout: 1000, authenticators: {} }], new FixedClock(), '1', new OtelTracing())
		router.setState({ path: 'shop', status: 'ready', since: '', restarts: 0 } as any)
		router.connect('shop', { request: async (request: any) => { sent.push(request); return [] }, onEvent: () => undefined, close: () => undefined } as any, { name: 'x', version: '1' } as any)
		const ctx = { principal: principalWithActor(principal('backend', ['read']), { ip: '10.0.0.9' }), transport: 'http' }
		const span = trace.getTracer('test').startSpan('POST /data-gateway/{schema}/execute')
		await context.with(trace.setSpan(context.active(), span), () => router.call('shop', 'gateway', 'execute', [{ query: 'Products' }], ctx))
		span.end()
		expect(sent[0].trace.traceparent).toContain(span.spanContext().traceId)
		expect(sent[0].principal.actor).toEqual({ credential: 'backend', ip: '10.0.0.9' })

		const fixture = fakeGateway()
		let seen: string | undefined
		const execute = fixture.orm.execute.bind(fixture.orm)
		fixture.orm.execute = async (query: string, data?: unknown, options?: unknown) => {
			seen = trace.getSpanContext(context.active())?.traceId
			return execute(query, data, options)
		}
		const mcp = new DataGatewayMcpServer(new ToolCatalog(gatewayTools(fixture.gateway)), fixture.orm as any, { name: 'x', version: '1', pageSize: 50, maxRows: 500 })
		const dispatcher = new ChannelDispatcher(fixture.gateway, mcp, 0, new ConsoleLogger('error'), undefined, undefined, new OtelTracing())
		await dispatcher.dispatch({ ...sent[0], id: 1 })
		expect(seen).toBe(span.spanContext().traceId)
		expect((fixture.orm.executed[0].options as any).actor).toEqual({ credential: 'backend', ip: '10.0.0.9' })
	})

	test('a call that is not HTTP (WebSocket, MCP): a span child of the traceparent of its _meta', async () => {
		exporter.reset()
		requestTracer.enable(true)
		try {
			const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
			await requestTracer.call('tools/call orm_execute', { 'mcp.method.name': 'tools/call' }, { traceparent }, async () => 1)
			const [span] = exporter.getFinishedSpans()
			expect(span.name).toBe('tools/call orm_execute')
			expect(span.spanContext().traceId).toBe('0af7651916cd43dd8448eb211c80319c')
			expect(span.parentSpanContext?.spanId).toBe('b7ad6b7169203331')
			await expect(requestTracer.call('x', {}, undefined, async () => { throw Object.assign(new Error('boom'), { name: 'ForbiddenError' }) })).rejects.toThrow('boom')
			const failed = exporter.getFinishedSpans()[1]
			expect(failed.attributes['error.type']).toBe('ForbiddenError')
			expect(JSON.stringify({ attributes: failed.attributes, status: failed.status, events: failed.events })).not.toContain('boom')
		} finally {
			requestTracer.enable(false)
		}
	})
})
