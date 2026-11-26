import { DataChangeSummary } from '../../domain/runtime/channelProtocol'
import { ClusterBusPort } from '../ports/output/clusterPorts'
import { LoggerPort } from '../ports/output/supportPorts'

export type ChangesListener = (changes: DataChangeSummary[], remote: boolean) => void

/**
 * The changes of the data of a schema, its own and (with a cluster) those of the other replicas (docs/REPLICAS.md §3):
 * the cache and the subscriptions listen here, so a write through any replica drops the results that read it and tells
 * the subscribers of every replica. Only entity, action, keys and count travel, never the rows.
 */
export class SchemaChanges {
	private readonly listeners: ChangesListener[] = []

	public on (listener: ChangesListener): void { this.listeners.push(listener) }

	/** changes of this replica (λORM's onDataChange) or, remote, of another */
	public emit (changes: DataChangeSummary[], remote = false): void {
		if (!changes.length) return
		for (const listener of this.listeners) {
			try { listener(changes, remote) } catch { /* a listener never stops the others */ }
		}
	}
}

/** What travels between replicas: who said it and what changed */
interface ClusterMessage { from: string, changes: DataChangeSummary[] }

/**
 * The changes of this replica to the others and theirs to it, by the channel <prefix>:<schema>:changes: answers how to
 * stop. A publish that fails (the Valkey down) is logged once per fall; the others' changes arrive again when it is back.
 */
export const shareChanges = async (bus: ClusterBusPort, channel: string, replica: string, changes: SchemaChanges, logger: LoggerPort): Promise<() => Promise<void>> => {
	let failing = false
	changes.on((list, remote) => {
		if (remote) return
		const message: ClusterMessage = { from: replica, changes: list }
		bus.publish(channel, JSON.stringify(message)).then(() => { failing = false }, error => {
			if (!failing) logger.warn(`cluster: the changes of ${channel} don't reach the other replicas (${error?.message ?? error}): each one on its own until it is back`)
			failing = true
		})
	})
	return bus.subscribe(channel, text => {
		let message: ClusterMessage
		try { message = JSON.parse(text) } catch { return }
		if (!message || message.from === replica || !Array.isArray(message.changes)) return
		changes.emit(message.changes.filter(c => c && typeof c.entity === 'string' && typeof c.action === 'string'), true)
	})
}
