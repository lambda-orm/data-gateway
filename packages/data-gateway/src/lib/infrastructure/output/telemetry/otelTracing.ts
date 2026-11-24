import { context, propagation, ROOT_CONTEXT } from '@opentelemetry/api'
import { TracingPort } from '../../../application/ports/output/supportPorts'

/**
 * The trace of a request across the channel, with the propagator of OpenTelemetry (W3C Trace Context): the edge
 * injects the active span in the request, the schema worker runs it in that context, and λORM's spans are its children.
 */
export class OtelTracing implements TracingPort {
	public carrier (): Record<string, string> | undefined {
		const carrier: Record<string, string> = {}
		propagation.inject(context.active(), carrier)
		return Object.keys(carrier).length > 0 ? carrier : undefined
	}

	public within<T> (carrier: Record<string, string> | undefined, fn: () => Promise<T>): Promise<T> {
		if (!carrier) return fn()
		return context.with(propagation.extract(ROOT_CONTEXT, carrier), fn)
	}
}
