import { ObservabilitySdk } from '@lambdaorm/lib'
import { DataPointType } from '@opentelemetry/sdk-metrics'

/** UCUM units to the words of Prometheus (the OpenTelemetry → Prometheus compatibility of the specification) */
const UNITS: Record<string, string> = {
	d: 'days', h: 'hours', min: 'minutes', s: 'seconds', ms: 'milliseconds', us: 'microseconds', ns: 'nanoseconds',
	By: 'bytes', KiBy: 'kibibytes', MiBy: 'mebibytes', GiBy: 'gibibytes', KBy: 'kilobytes', MBy: 'megabytes', GBy: 'gigabytes',
	m: 'meters', V: 'volts', A: 'amperes', J: 'joules', W: 'watts', g: 'grams', Cel: 'celsius', Hz: 'hertz', '%': 'percent'
}
const PER: Record<string, string> = { s: 'second', m: 'minute', h: 'hour', d: 'day', w: 'week', mo: 'month', y: 'year' }

const sanitize = (name: string): string => {
	const clean = name.replace(/[^a-zA-Z0-9_:]/g, '_').replace(/_+/g, '_')
	return /^[0-9]/.test(clean) ? `_${clean}` : clean
}

/** the unit as a suffix: s → seconds, By/s → bytes_per_second; {row}, {connection}… (annotations) give none */
const unitSuffix = (unit: string | undefined, gauge: boolean): string | undefined => {
	const clean = (unit ?? '').replace(/\{[^}]*\}/g, '').trim()
	if (!clean) return undefined
	if (clean === '1') return gauge ? 'ratio' : undefined
	const [main, per] = clean.split('/')
	const words = [main ? UNITS[main] ?? main : undefined, per ? `per_${PER[per] ?? UNITS[per] ?? per}` : undefined].filter(Boolean)
	return words.length ? sanitize(words.join('_')) : undefined
}

/**
 * The name of an OpenTelemetry metric in Prometheus, as the specification says and the Collector, Prometheus 3 (OTLP)
 * and VictoriaMetrics (-opentelemetry.usePrometheusNaming) do: db.client.operation.duration (s) →
 * db_client_operation_duration_seconds; a monotonic counter ends in _total. The same names by pull (/metrics) as by
 * push (OTLP), so a dashboard works with both.
 */
export const prometheusName = (name: string, unit: string | undefined, kind: 'counter' | 'gauge' | 'histogram'): string => {
	let result = sanitize(name)
	const suffix = unitSuffix(unit, kind === 'gauge')
	if (suffix && !result.endsWith(`_${suffix}`)) result = `${result}_${suffix}`
	if (kind === 'counter' && !result.endsWith('_total')) result = `${result}_total`
	return result
}

const labelsOf = (attributes: Record<string, unknown>, worker: string): Record<string, string | number> => {
	const labels: Record<string, string | number> = { worker }
	for (const [key, value] of Object.entries(attributes ?? {})) {
		if (value === undefined || value === null) continue
		labels[sanitize(key)] = typeof value === 'number' ? value : String(value)
	}
	return labels
}

/**
 * The OpenTelemetry metrics of this worker (λORM's) as JSON of prom-client (the format of getMetricsAsJSON), labeled
 * with the worker as the others: the edge aggregates them with the ones of every worker into one exposition, where each
 * family appears once (twice, Prometheus refuses the scrape).
 */
export const otelMetricsAsPromJson = async (worker: string): Promise<unknown[]> => {
	const resourceMetrics = await ObservabilitySdk.collectMetrics()
	if (!resourceMetrics) return []
	const result: unknown[] = []
	for (const scope of resourceMetrics.scopeMetrics ?? []) {
		for (const metric of scope.metrics ?? []) {
			const { name, description, unit } = metric.descriptor
			if (metric.dataPointType === DataPointType.HISTOGRAM) {
				const promName = prometheusName(name, unit, 'histogram')
				const values: unknown[] = []
				for (const point of metric.dataPoints) {
					const labels = labelsOf(point.attributes, worker)
					const { boundaries, counts } = point.value.buckets
					let cumulative = 0
					boundaries.forEach((le: number, i: number) => {
						cumulative += counts[i] ?? 0
						values.push({ metricName: `${promName}_bucket`, labels: { ...labels, le }, value: cumulative })
					})
					cumulative += counts[boundaries.length] ?? 0
					values.push({ metricName: `${promName}_bucket`, labels: { ...labels, le: '+Inf' }, value: cumulative })
					values.push({ metricName: `${promName}_sum`, labels, value: point.value.sum ?? 0 })
					values.push({ metricName: `${promName}_count`, labels, value: point.value.count })
				}
				result.push({ name: promName, help: description || name, type: 'histogram', values, aggregator: 'sum' })
			} else if (metric.dataPointType === DataPointType.SUM || metric.dataPointType === DataPointType.GAUGE) {
				const counter = metric.dataPointType === DataPointType.SUM && metric.isMonotonic
				const promName = prometheusName(name, unit, counter ? 'counter' : 'gauge')
				const values = metric.dataPoints.map((point: any) => ({ labels: labelsOf(point.attributes, worker), value: point.value }))
				result.push({ name: promName, help: description || name, type: counter ? 'counter' : 'gauge', values, aggregator: 'sum' })
			}
		}
	}
	return result
}
