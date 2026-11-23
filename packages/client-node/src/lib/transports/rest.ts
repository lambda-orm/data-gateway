import { ConnectionTarget } from '../connection'
import { gatewayError, GatewayError, transportError, unsupported } from '../errors'
import { Args, clean, Operation, REST, WHERE } from '../operations'
import { Transport } from './transport'

/** The REST API: each operation a request under the route of the schema */
export class RestTransport implements Transport {
	public readonly name = 'http' as const
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly target: ConnectionTarget) {}

	public async open (): Promise<void> { /* stateless */ }
	public async close (): Promise<void> { /* stateless */ }

	public async call (operation: Operation, args: Args): Promise<unknown> {
		const route = REST[operation]
		if (!route) throw unsupported(this.name, operation, WHERE[operation] ?? 'not on this transport')
		const [method, path, body] = route(args)
		let response: Response
		try {
			response = await fetch(this.target.url + path, {
				method,
				headers: { ...this.target.headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
				body: body !== undefined ? JSON.stringify(clean(body)) : undefined,
				signal: AbortSignal.timeout(this.target.timeout)
			})
		} catch (error: any) {
			if (error?.name === 'TimeoutError') throw new GatewayError({ code: 'timeout', message: `${operation} took longer than ${this.target.timeout} ms`, transport: this.name, operation })
			throw transportError(this.name, `${method} ${this.target.url + path}: ${error?.cause?.message ?? error?.message ?? error}`)
		}
		if (response.status === 204) return null
		const text = await response.text()
		let payload: any = null
		try {
			payload = text === '' ? null : JSON.parse(text)
		} catch {
			if (response.ok) throw transportError(this.name, `${method} ${path} answered something that is not JSON`)
		}
		if (!response.ok) {
			throw gatewayError(this.name, {
				status: response.status,
				errorName: payload?.error,
				dbCode: payload?.code,
				suggestions: payload?.suggestions,
				message: payload?.message ?? (text || response.statusText)
			})
		}
		return payload
	}
}
