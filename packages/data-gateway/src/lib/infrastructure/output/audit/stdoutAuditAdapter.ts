import { LogLevel, LogRecord, OpenTelemetryLogAdapter } from '@lambdaorm/base'
import { AuditPort } from '../../../application/ports/output/supportPorts'
import { AuditEntry, SessionAuditEntry } from '../../../domain/audit/auditEntry'

/**
 * One JSON line per entry on stdout, with type "audit", so the log collector of the environment (Loki, ELK,
 * CloudWatch, …) can route it apart from the rest of the log. With the logs of OpenTelemetry exported, the entry also
 * goes as a LogRecord (event audit) linked to the trace of its request; without its SDK that does nothing.
 */
export class StdoutAuditAdapter implements AuditPort {
	private readonly otel = new OpenTelemetryLogAdapter({ name: '@lambdaorm/data-gateway' })

	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly out: (line: string) => void = line => process.stdout.write(line + '\n')) {}

	public write (entry: AuditEntry | SessionAuditEntry): void {
		try {
			this.out(JSON.stringify(entry))
		} catch {
			// data that can't be serialized (a cycle) never stops the operation: the entry goes without it
			this.out(JSON.stringify({ ...entry, data: '[not serializable]' }))
		}
		try {
			const failed = (entry as { result?: string }).result === 'error'
			const record: LogRecord = {
				time: entry.time,
				level: failed ? LogLevel.WARN : LogLevel.INFO,
				message: 'audit',
				event: 'audit',
				attributes: { ...entry } as Record<string, unknown>
			}
			this.otel.write(record)
		} catch {
			// the audit on stdout is what counts
		}
	}
}
