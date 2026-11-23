import { HistoryEntry } from '../domain/workspace'
import { HistoryPort } from '../application/ports'

/**
 * The history of each schema in the browser (queries, data and options; never credentials or results). Storage that
 * isn't there (private window, blocked) keeps nothing instead of failing.
 */
export class LocalStorageHistory implements HistoryPort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly prefix = 'lambdaorm-ui:history:', private readonly storage: () => Storage | undefined = () => globalThis.localStorage) {}

	public load (schema: string): HistoryEntry[] {
		try {
			const text = this.storage()?.getItem(this.prefix + schema)
			const entries = text ? JSON.parse(text) : []
			return Array.isArray(entries) ? entries : []
		} catch {
			return []
		}
	}

	public save (schema: string, entries: HistoryEntry[]): void {
		try { this.storage()?.setItem(this.prefix + schema, JSON.stringify(entries)) } catch { /* not kept */ }
	}

	public clear (schema: string): void {
		try { this.storage()?.removeItem(this.prefix + schema) } catch { /* nothing to clear */ }
	}
}
