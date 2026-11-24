import { GaugeReader, MetricsPort, OperationSample } from '../../../application/ports/output/supportPorts'

const promClient = require('prom-client')

const DURATION_BUCKETS = [0.005, 0.01, 0.05, 0.1, 0.3, 0.5, 1, 3, 5, 10, 30]

/**
 * Prometheus metrics (prom-client) of one worker, every sample labeled with it (worker="edge", "schema:iot/v1"):
 * default Node metrics (event loop lag, memory, GC), operations by transport / schema / method / status /
 * credential, forbidden, throttled, gauges read on render. The edge adds the snapshots of the schema workers.
 */
export class PromClientMetrics implements MetricsPort {
	public readonly enabled = true
	private readonly register: any
	private readonly requestTimer: any
	private readonly serverDuration: any
	private readonly operations: any
	private readonly durations: any
	private readonly forbiddenTotal: any
	private readonly throttledTotal: any
	private readonly sources: (() => Promise<unknown[]>)[] = []

	constructor (worker = 'edge') {
		this.register = new promClient.Registry()
		this.register.setDefaultLabels({ worker })
		promClient.collectDefaultMetrics({ prefix: 'node_', gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5], register: this.register })
		const registers = [this.register]
		this.requestTimer = new promClient.Histogram({
			name: 'http_request_duration_seconds',
			help: 'Duration of HTTP requests in seconds',
			labelNames: ['method', 'route', 'code', 'credential'],
			buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
			registers
		})
		// http.server.request.duration of the OpenTelemetry conventions, with their names in Prometheus (the one above stays
		// for the dashboards that use it)
		this.serverDuration = new promClient.Histogram({
			name: 'http_server_request_duration_seconds',
			help: 'Duration of HTTP server requests',
			labelNames: ['http_request_method', 'http_route', 'http_response_status_code'],
			buckets: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10],
			registers
		})
		this.operations = new promClient.Counter({
			name: 'data_gateway_requests_total',
			help: 'Operations on a schema by transport, method, status and credential',
			labelNames: ['transport', 'schema', 'method', 'status', 'credential'],
			registers
		})
		this.durations = new promClient.Histogram({
			name: 'data_gateway_request_duration_seconds',
			help: 'Duration of the operations on a schema',
			labelNames: ['transport', 'schema', 'method'],
			buckets: DURATION_BUCKETS,
			registers
		})
		this.forbiddenTotal = new promClient.Counter({
			name: 'data_gateway_forbidden_total',
			help: 'Operations refused because the credential lacks a permission',
			labelNames: ['credential', 'permission'],
			registers
		})
		this.throttledTotal = new promClient.Counter({
			name: 'data_gateway_throttled_total',
			help: 'Operations refused with 429 by server.maxConcurrent',
			labelNames: ['schema', 'transport'],
			registers
		})
	}

	public startTimer () {
		const end = this.requestTimer.startTimer()
		const start = process.hrtime.bigint()
		return (labels: Record<string, string | number>) => {
			const { template, ...rest } = labels
			end(rest)
			this.serverDuration.observe({
				http_request_method: String(labels.method ?? ''),
				http_route: template === undefined ? '' : String(template),
				http_response_status_code: String(labels.code ?? '')
			}, Number(process.hrtime.bigint() - start) / 1e9)
		}
	}

	public operation (sample: OperationSample): void {
		this.operations.inc({ transport: sample.transport, schema: sample.schema, method: sample.method, status: String(sample.status), credential: sample.credential })
		this.durations.observe({ transport: sample.transport, schema: sample.schema, method: sample.method }, sample.seconds)
	}

	public forbidden (credential: string, permission: string): void {
		this.forbiddenTotal.inc({ credential, permission })
	}

	public throttled (schema: string, transport: string): void {
		this.throttledTotal.inc({ schema, transport })
	}

	public gauge (name: string, help: string, labelNames: string[], read: GaugeReader): void {
		// eslint-disable-next-line no-new
		new promClient.Gauge({
			name,
			help,
			labelNames,
			registers: [this.register],
			collect (this: any) {
				this.reset()
				for (const { labels, value } of read()) this.set(labels, value)
			}
		})
	}

	public addSource (source: () => Promise<unknown[]>): void {
		this.sources.push(source)
	}

	public snapshot (): Promise<unknown[]> {
		return this.register.getMetricsAsJSON()
	}

	/** This worker and the sources (a source that doesn't answer is left out); a schema keeps only its samples */
	public async render (filter: { schema?: string } = {}) {
		const own = await this.register.getMetricsAsJSON()
		// a source answers one registry, or several (the edge: one per schema worker served at that moment)
		const others = (await Promise.all(this.sources.map(source => source().catch(() => []))))
			.flatMap(m => Array.isArray(m) && Array.isArray(m[0]) ? m : [m])
		let metrics: any[] = [own, ...others].filter(m => Array.isArray(m) && m.length)
		if (filter.schema !== undefined) {
			const worker = `schema:${filter.schema}`
			metrics = metrics.map(list => list.map((metric: any) => ({
				...metric,
				values: (metric.values ?? []).filter((v: any) => v.labels?.schema === filter.schema || v.labels?.worker === worker)
			})))
		}
		const aggregated = promClient.AggregatorRegistry.aggregate(metrics)
		return { contentType: this.register.contentType, body: await aggregated.metrics() }
	}
}

/** metrics.enabled: false */
export class NoMetrics implements MetricsPort {
	public readonly enabled = false
	public startTimer () { return () => undefined }
	public operation () { /* off */ }
	public forbidden () { /* off */ }
	public throttled () { /* off */ }
	public gauge () { /* off */ }
	public addSource () { /* off */ }
	public async snapshot () { return [] }
	public async render () { return { contentType: 'text/plain', body: '' } }
}
