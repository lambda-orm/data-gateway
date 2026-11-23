import { AuditPort } from '../../../application/ports/output/supportPorts'
import { AuditEntry, SessionAuditEntry } from '../../../domain/audit/auditEntry'

/**
 * One JSON line per entry on stdout, with type "audit", so the log collector of the environment (Loki, ELK,
 * CloudWatch, …) can route it apart from the rest of the log.
 */
export class StdoutAuditAdapter implements AuditPort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly out: (line: string) => void = line => process.stdout.write(line + '\n')) {}

	public write (entry: AuditEntry | SessionAuditEntry): void {
		try {
			this.out(JSON.stringify(entry))
		} catch {
			// data that can't be serialized (a cycle) never stops the operation: the entry goes without it
			this.out(JSON.stringify({ ...entry, data: '[not serializable]' }))
		}
	}
}
