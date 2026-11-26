/**
 * The replicas of a gateway together (docs/REPLICAS.md): what one says, the others hear, and a lease only one holds at a
 * time. A Valkey (or Redis) behind it; without one, nothing of this.
 */
export interface ClusterBusPort {
	/** connected now (a fall is survived: each replica on its own until it comes back) */
	readonly connected: boolean
	/** to every replica listening on the channel (this one too: a listener skips its own) */
	publish (channel: string, message: string): Promise<void>
	/** what is published on the channel; answers how to stop listening */
	subscribe (channel: string, listener: (message: string) => void): Promise<() => Promise<void>>
	/** the lease of key for owner during ttlMs: taken (or renewed, when owner already holds it) or not */
	lease (key: string, owner: string, ttlMs: number): Promise<boolean>
	/** the lease of key let go, only if owner holds it */
	release (key: string, owner: string): Promise<void>
	close (): Promise<void>
}
