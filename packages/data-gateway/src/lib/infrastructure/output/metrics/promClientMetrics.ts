import { MetricsPort } from '../../../application/ports/output/supportPorts'

/** Prometheus metrics (prom-client): default Node metrics plus the duration of every request. */
export class PromClientMetrics implements MetricsPort {
	public readonly enabled = true
	private readonly register: any
	private readonly requestTimer: any

	constructor () {
		const promClient = require('prom-client')
		this.register = new promClient.Registry()
		promClient.collectDefaultMetrics({ prefix: 'node_', gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5], register: this.register })
		this.requestTimer = new promClient.Histogram({
			name: 'http_request_duration_seconds',
			help: 'Duration of HTTP requests in seconds',
			labelNames: ['method', 'route', 'code', 'credential'],
			buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
			registers: [this.register]
		})
	}

	public startTimer () {
		return this.requestTimer.startTimer()
	}

	public async render () {
		return { contentType: this.register.contentType, body: await this.register.metrics() }
	}
}

/** metrics.enabled: false */
export class NoMetrics implements MetricsPort {
	public readonly enabled = false
	public startTimer () { return () => undefined }
	public async render () { return { contentType: 'text/plain', body: '' } }
}
