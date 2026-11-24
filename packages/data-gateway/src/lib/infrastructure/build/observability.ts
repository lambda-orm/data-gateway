import { expressions } from '3xpr'
import { ObservabilityConfig, ObservabilityConfigService, ObservabilityValidator, ResolvedObservability } from '@lambdaorm/base'
import { ObservabilitySdk } from '@lambdaorm/lib'
import { NO_TRACING, LoggerPort, TracingPort } from '../../application/ports/output/supportPorts'
import { requestTracer } from '../input/telemetry/requestTracer'
import { OtelTracing } from '../output/telemetry/otelTracing'

export const GATEWAY_SERVICE_NAME = 'data-gateway'

/**
 * The observability of the gateway: the section `observability` of data-gateway.config.yaml (the same shape as the one
 * of a lambdaORM.yaml), with the OTEL_* variables overriding it, resolved once in the main thread and handed to every
 * worker (the OTEL_* don't reach an isolated worker). Invalid, it stops the start.
 */
export const resolveObservability = (config: ObservabilityConfig | undefined, env: Record<string, string | undefined>): ResolvedObservability | undefined => {
	const otel = Object.keys(env).some(key => key.startsWith('OTEL_') && env[key])
	if (!config && !otel) return undefined
	const { errors } = new ObservabilityValidator(expressions).validate(config)
	if (errors.length > 0) throw new Error(`observability: ${errors.join('; ')}`)
	return new ObservabilityConfigService().resolve({ serviceName: GATEWAY_SERVICE_NAME, ...config }, env)
}

/**
 * Starts the OpenTelemetry SDK of this thread (the edge, a schema worker or the inline gateway) BEFORE λORM: its Orm
 * finds it and uses it (one SDK, the gateway's service.name and exporter; the traces and rules of each schema still
 * decide λORM's spans). A meter taken before the provider stays a no-op: that is why it goes first.
 */
/**
 * With metrics.enabled (the /metrics of Prometheus, on by default) the SDK of every worker also has a Prometheus reader
 * (without a server of its own): λORM's metrics are added to /metrics. OTLP metrics only if observability asks for them.
 */
export const withPrometheus = (config: ResolvedObservability | undefined, metricsEnabled: boolean): ResolvedObservability | undefined => {
	if (!metricsEnabled) return config
	const base = config ?? new ObservabilityConfigService().resolve({ serviceName: GATEWAY_SERVICE_NAME }, {})
	if (base.sdkDisabled) return config
	const exporters = base.metrics.enabled ? base.metrics.exporters.filter(p => p.type !== 'prometheus') : []
	return { ...base, metrics: { ...base.metrics, enabled: true, exporters: [...exporters, { type: 'prometheus' }] } }
}

export const startObservability = async (config: ResolvedObservability | undefined, logger: LoggerPort): Promise<TracingPort> => {
	if (!config) return NO_TRACING
	await ObservabilitySdk.start(config, message => logger.warn(message))
	requestTracer.enable(config.traces.enabled && !config.sdkDisabled)
	return config.traces.enabled ? new OtelTracing() : NO_TRACING
}

export const stopObservability = async (): Promise<void> => {
	requestTracer.enable(false)
	await ObservabilitySdk.shutdown()
}
