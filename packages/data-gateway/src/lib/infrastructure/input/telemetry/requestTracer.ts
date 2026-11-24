import { Attributes, context, propagation, ROOT_CONTEXT, Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import type express from 'express'

const SCOPE = '@lambdaorm/data-gateway'

/** error.type of a failure: the code or the name of the error (never its message: it can carry data) */
const errorType = (error: any): string => (typeof error?.code === 'string' && error.code) || error?.name || 'Error'

/**
 * The spans of the requests of the transports (docs/OBSERVABILITY.md §7.3): one SERVER span per HTTP request,
 * WebSocket message or MCP call, child of the traceparent of the caller, with the attributes of the OpenTelemetry
 * conventions (HTTP, JSON-RPC, MCP). Off (the default) it adds nothing. One per thread: each worker has its own.
 */
export class RequestTracer {
	private enabled = false

	public enable (enabled: boolean): void {
		this.enabled = enabled
	}

	public get on (): boolean {
		return this.enabled
	}

	/**
	 * The middleware of an Express app: its span ends with the response, named by the route template
	 * (`POST /data-gateway/{schema}/execute`), never by the concrete path.
	 */
	public http (routeOf: (req: express.Request) => string | undefined): express.RequestHandler {
		return (req, res, next) => {
			if (!this.enabled) return next()
			const parent = propagation.extract(ROOT_CONTEXT, req.headers)
			const attributes: Attributes = {
				'http.request.method': req.method,
				'url.path': req.path,
				'url.scheme': 'http'
			}
			if (req.socket.remoteAddress) attributes['client.address'] = req.socket.remoteAddress
			if (req.socket.localPort) attributes['server.port'] = req.socket.localPort
			const userAgent = req.headers['user-agent']
			if (userAgent) attributes['user_agent.original'] = userAgent.slice(0, 300)
			const span = trace.getTracer(SCOPE).startSpan(req.method, { kind: SpanKind.SERVER, attributes }, parent)
			res.on('finish', () => {
				const route = routeOf(req)
				if (route) {
					span.setAttribute('http.route', route)
					span.updateName(`${req.method} ${route}`)
				}
				span.setAttribute('http.response.status_code', res.statusCode)
				const principal = res.locals.principal as { name?: string } | undefined
				if (principal?.name) span.setAttribute('enduser.id', principal.name)
				if (res.statusCode >= 500) {
					span.setAttribute('error.type', String(res.statusCode))
					span.setStatus({ code: SpanStatusCode.ERROR })
				}
				span.end()
			})
			context.with(trace.setSpan(parent, span), next)
		}
	}

	/**
	 * A call that is not HTTP (a WebSocket message, an MCP call): a SERVER span around run, child of the traceparent
	 * it brings (_meta of MCP), or a root.
	 */
	public async call<T> (name: string, attributes: Attributes, carrier: Record<string, unknown> | undefined, run: () => Promise<T>): Promise<T> {
		if (!this.enabled) return run()
		const parent = carrier ? propagation.extract(ROOT_CONTEXT, carrier) : ROOT_CONTEXT
		return trace.getTracer(SCOPE).startActiveSpan(name, { kind: SpanKind.SERVER, attributes }, parent, async (span: Span) => {
			try {
				return await run()
			} catch (error: any) {
				span.setAttribute('error.type', errorType(error))
				span.setStatus({ code: SpanStatusCode.ERROR })
				throw error
			} finally {
				span.end()
			}
		})
	}
}

/** the tracer of the transports of this thread */
export const requestTracer = new RequestTracer()
