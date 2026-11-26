import { AuditEntry } from '../../domain/audit/auditEntry'
import { RequestContext } from '../ports/input/dataGatewayPort'
import { AuditPort, ClockPort } from '../ports/output/supportPorts'

export interface AuditSettings {
	enabled: boolean
	includeData: boolean
}

type AuditFields = Omit<AuditEntry, 'type' | 'time' | 'schema' | 'transport' | 'credential' | 'durationMs' | 'result' | 'error' | 'rows'>

/** Rows a result stands for: the affected rows of an update / delete, the length of a list, else undefined. */
const rowsOf = (result: unknown): number | undefined =>
	typeof result === 'number' ? result : Array.isArray(result) ? result.length : undefined

/** Runs an operation that writes (or may write) and leaves its audit entry, also when it fails. */
export class Auditor {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly port: AuditPort,
		private readonly clock: ClockPort,
		private readonly schema: string,
		private readonly settings: AuditSettings
	) {}

	public async track<T> (ctx: RequestContext, fields: AuditFields, run: () => Promise<T>): Promise<T> {
		if (!this.settings.enabled) return run()
		const started = this.clock.now()
		const entry: AuditEntry = {
			type: 'audit',
			time: started.toISOString(),
			schema: this.schema,
			transport: ctx.transport,
			credential: ctx.principal.name,
			...fields,
			...(ctx.approvedBy ? { approvedBy: ctx.approvedBy } : {}),
			durationMs: 0,
			result: 'ok'
		}
		if (!this.settings.includeData) delete entry.data
		try {
			const result = await run()
			const rows = rowsOf(result)
			if (rows !== undefined) entry.rows = rows
			return result
		} catch (error: any) {
			entry.result = 'error'
			entry.error = error?.message ?? String(error)
			throw error
		} finally {
			entry.durationMs = this.clock.now().getTime() - started.getTime()
			this.port.write(entry)
		}
	}
}
