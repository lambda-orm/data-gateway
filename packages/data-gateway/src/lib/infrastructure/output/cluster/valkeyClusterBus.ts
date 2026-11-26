import Valkey from 'iovalkey'
import { ClusterBusPort } from '../../../application/ports/output/clusterPorts'
import { LoggerPort } from '../../../application/ports/output/supportPorts'

/** a lease renewed only by its owner (the lease of an outbox, docs/REPLICAS.md §4) */
const RENEW = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end"
const RELEASE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end"

/**
 * The replicas together through a Valkey (or a Redis: the same protocol), with iovalkey (docs/REPLICAS.md): one
 * connection publishes and holds leases (no offline queue: a command while it is down fails at once), another listens
 * (subscriptions come back by themselves after a reconnection). It reconnects by itself, waiting up to 5 s.
 */
export class ValkeyClusterBus implements ClusterBusPort {
	private readonly commands: Valkey
	private readonly listener: Valkey
	private readonly channels = new Map<string, Set<(message: string) => void>>()
	private down = false

	constructor (url: string, private readonly logger: LoggerPort, name = 'data-gateway') {
		const tls = /^(valkeys|rediss):/i.test(url) ? { tls: {} } : {}
		const options = {
			connectionName: name,
			lazyConnect: true,
			retryStrategy: (times: number) => Math.min(times * 500, 5000),
			...tls
		}
		this.commands = new Valkey(url, { ...options, enableOfflineQueue: false, maxRetriesPerRequest: 1 })
		this.listener = new Valkey(url, { ...options, enableOfflineQueue: true, maxRetriesPerRequest: null })
		this.listener.on('message', (channel: string, message: string) => {
			for (const listen of this.channels.get(channel) ?? []) listen(message)
		})
		for (const connection of [this.commands, this.listener]) {
			connection.on('error', (error: Error) => {
				if (!this.down) this.logger.warn(`cluster: the Valkey is not reached (${error.message}): each replica on its own until it is back`)
				this.down = true
			})
			connection.on('ready', () => {
				if (this.down) this.logger.info('cluster: the Valkey is back')
				this.down = false
			})
		}
	}

	/** connects both; a Valkey down at the start is not an error (it keeps trying) */
	public async connect (): Promise<void> {
		await Promise.all([this.commands, this.listener].map(c => c.connect().catch(() => undefined)))
	}

	public get connected (): boolean { return this.commands.status === 'ready' && this.listener.status === 'ready' }

	public async publish (channel: string, message: string): Promise<void> {
		await this.commands.publish(channel, message)
	}

	public async subscribe (channel: string, listen: (message: string) => void): Promise<() => Promise<void>> {
		let listeners = this.channels.get(channel)
		if (!listeners) {
			listeners = new Set()
			this.channels.set(channel, listeners)
			// not awaited: with the Valkey down it is sent when it connects (and again after each reconnection)
			this.listener.subscribe(channel).catch((error: Error) => this.logger.warn(`cluster: subscribe ${channel}: ${error.message}`))
		}
		listeners.add(listen)
		return async () => {
			listeners!.delete(listen)
			if (listeners!.size === 0 && this.channels.get(channel) === listeners) {
				this.channels.delete(channel)
				await this.listener.unsubscribe(channel).catch(() => undefined)
			}
		}
	}

	public async lease (key: string, owner: string, ttlMs: number): Promise<boolean> {
		if (await this.commands.set(key, owner, 'PX', ttlMs, 'NX') === 'OK') return true
		return Number(await this.commands.eval(RENEW, 1, key, owner, String(ttlMs))) === 1
	}

	public async release (key: string, owner: string): Promise<void> {
		await this.commands.eval(RELEASE, 1, key, owner)
	}

	public async close (): Promise<void> {
		this.channels.clear()
		await Promise.all([this.commands, this.listener].map(c => c.quit().catch(() => c.disconnect())))
	}
}
