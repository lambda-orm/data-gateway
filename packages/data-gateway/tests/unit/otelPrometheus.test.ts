// λORM's metrics (OpenTelemetry) in the /metrics of the gateway (docs/OBSERVABILITY_PLAN.md phase 3): the names of the
// OpenTelemetry → Prometheus compatibility (as the Collector, Prometheus 3 and VictoriaMetrics), one family per name
// whatever the workers, and the gateway's observability for a schema without its own.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { metrics } from '@opentelemetry/api'
import { ObservabilityConfigService } from '@lambdaorm/base'
import { ObservabilitySdk } from '@lambdaorm/lib'
import { prometheusName, otelMetricsAsPromJson } from '../../src/lib/infrastructure/output/metrics/otelPrometheus'
import { PromClientMetrics } from '../../src/lib/infrastructure/output/metrics/promClientMetrics'
import { withPrometheus } from '../../src/lib/infrastructure/build/observability'
import { LambdaOrmAdapter } from '../../src/lib/infrastructure/output/orm/lambdaOrmAdapter'

describe('names', () => {
	test.each([
		['db.client.operation.duration', 's', 'histogram', 'db_client_operation_duration_seconds'],
		['lambdaorm.constraint.violations', '{violation}', 'counter', 'lambdaorm_constraint_violations_total'],
		['db.client.connection.count', '{connection}', 'gauge', 'db_client_connection_count'],
		['db.client.response.returned_rows', '{row}', 'histogram', 'db_client_response_returned_rows'],
		['network.io', 'By/s', 'gauge', 'network_io_bytes_per_second'],
		['cpu.utilization', '1', 'gauge', 'cpu_utilization_ratio'],
		['http.server.request.duration', 's', 'histogram', 'http_server_request_duration_seconds'],
		['requests_total', '', 'counter', 'requests_total']
	] as const)('%s (%s, %s) → %s', (name, unit, kind, expected) => {
		expect(prometheusName(name, unit, kind)).toBe(expected)
	})
})

describe('the exposition', () => {
	afterEach(() => ObservabilitySdk.shutdown())

	test('the metrics of every worker in one exposition: one family per name, their values added', async () => {
		const config = withPrometheus(undefined, true)!
		expect(config.metrics.exporters).toEqual([{ type: 'prometheus' }])
		await ObservabilitySdk.start(config, () => undefined)
		const meter = metrics.getMeter('@lambdaorm/lib')
		const duration = meter.createHistogram('db.client.operation.duration', { unit: 's', description: 'Duration of database client operations', advice: { explicitBucketBoundaries: [0.01, 0.1, 1] } })
		const violations = meter.createCounter('lambdaorm.constraint.violations', { unit: '{violation}' })
		duration.record(0.05, { 'db.system.name': 'postgresql', 'db.collection.name': 'orders' })
		duration.record(0.5, { 'db.system.name': 'postgresql', 'db.collection.name': 'orders' })
		violations.add(2, { 'lambdaorm.entity': 'Customers' })
		const prom = new PromClientMetrics('edge')
		// two workers answer the same families
		prom.addSource(async () => [await otelMetricsAsPromJson('schema:shop'), await otelMetricsAsPromJson('schema:shop')])
		const { contentType, body } = await prom.render()
		expect(contentType).toMatch(/text\/plain/)
		const types = body.split('\n').filter(p => p.startsWith('# TYPE '))
		expect(new Set(types).size).toBe(types.length)
		expect(types).toContain('# TYPE db_client_operation_duration_seconds histogram')
		expect(types).toContain('# TYPE lambdaorm_constraint_violations_total counter')
		expect(body).toMatch(/db_client_operation_duration_seconds_bucket\{.*le="0.1".*\} 2/)
		expect(body).toMatch(/db_client_operation_duration_seconds_bucket\{.*le="\+Inf".*\} 4/)
		expect(body).toMatch(/db_client_operation_duration_seconds_count\{[^}]*db_collection_name="orders"[^}]*\} 4/)
		expect(body).toMatch(/lambdaorm_constraint_violations_total\{[^}]*lambdaorm_entity="Customers"[^}]*\} 4/)
		expect(body).toContain('worker="schema:shop"')
		expect(body).toContain('# TYPE http_server_request_duration_seconds histogram')
		// every sample line is valid in the text format of Prometheus
		for (const line of body.split('\n').filter(p => p && !p.startsWith('#'))) {
			expect(line).toMatch(/^[a-zA-Z_:][a-zA-Z0-9_:]*(\{([a-zA-Z_][a-zA-Z0-9_]*="([^"\\]|\\.)*",?)*\})? -?[0-9.e+-]+$|^[a-zA-Z_:][a-zA-Z0-9_:]*(\{.*\})? ([Nn]a[Nn]|\+Inf|-Inf)$/)
		}
	})

	test('metrics.enabled false: nothing added; OTLP metrics only if observability asks for them', () => {
		expect(withPrometheus(undefined, false)).toBeUndefined()
		const otlp = new ObservabilityConfigService().resolve({ exporter: { type: 'otlp', endpoint: 'http://alloy:4318' }, metrics: { enabled: true } }, {})
		expect(withPrometheus(otlp, true)!.metrics.exporters).toEqual([{ type: 'opentelemetry', exportIntervalMs: 60000 }, { type: 'prometheus' }])
		const tracesOnly = new ObservabilityConfigService().resolve({ exporter: { type: 'otlp', endpoint: 'http://alloy:4318' }, traces: { enabled: true } }, {})
		expect(withPrometheus(tracesOnly, true)!.metrics.exporters).toEqual([{ type: 'prometheus' }])
	})
})

describe('a schema without its own observability', () => {
	test('takes the one of the gateway', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-observe-'))
		fs.writeFileSync(path.join(dir, 'lambdaORM.yaml'), [
			'name: shop', 'domain:', '  entities:', '    - { name: Customers, primaryKey: [id], properties: [{ name: id, type: integer }] }',
			'infrastructure:', '  sources:', '    - { name: main, dialect: PostgreSQL, mapping: main, connection: { host: 127.0.0.1, port: 1 } }'
		].join('\n'))
		const orm = new LambdaOrmAdapter()
		try {
			await orm.init(dir)
			const telemetry = (orm.orm as any).helper.telemetry
			expect(telemetry.measuring).toBe(false)
			orm.observe(withPrometheus(undefined, true)!)
			expect(telemetry.measuring).toBe(true)
		} finally {
			await orm.orm.end()
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})
