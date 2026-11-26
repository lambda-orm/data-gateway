import { ClusterBusPort } from '../ports/output/clusterPorts'
import { LoggerPort } from '../ports/output/supportPorts'

export interface LeaderLeaseSettings {
	ttlMs: number
	renewMs: number
}

/**
 * One replica leads something (the dispatcher of an outbox, docs/REPLICAS.md §4): it holds a lease that it renews; when
 * it falls (or the Valkey does) the lease expires and another takes it. Without the Valkey nobody leads: better none
 * than two.
 */
export class LeaderLease {
	private timer?: NodeJS.Timeout
	private leading = false
	private stopped = false
	private turn: Promise<void> = Promise.resolve()

	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly bus: ClusterBusPort,
		private readonly key: string,
		private readonly owner: string,
		private readonly role: { lead: () => void | Promise<void>, follow: () => void | Promise<void> },
		private readonly logger: LoggerPort,
		private readonly settings: LeaderLeaseSettings = { ttlMs: 15000, renewMs: 5000 }
	) {}

	public get isLeader (): boolean { return this.leading }

	public start (): void {
		this.stopped = false
		this.tick()
	}

	/** one turn: take or renew the lease, lead or follow (exported for the tests) */
	public check (): Promise<void> {
		this.turn = this.turn.then(async () => {
			let held = false
			try {
				held = await this.bus.lease(this.key, this.owner, this.settings.ttlMs)
			} catch {
				held = false
			}
			if (this.stopped) return
			if (held && !this.leading) {
				this.leading = true
				this.logger.info(`cluster: this replica leads ${this.key}`)
				await this.role.lead()
			} else if (!held && this.leading) {
				this.leading = false
				this.logger.info(`cluster: this replica no longer leads ${this.key}`)
				await this.role.follow()
			}
		})
		return this.turn
	}

	private tick (): void {
		if (this.stopped) return
		this.check().finally(() => {
			if (this.stopped) return
			this.timer = setTimeout(() => this.tick(), this.settings.renewMs)
			this.timer.unref?.()
		})
	}

	/** stops leading and lets the lease go, so another replica takes it at once */
	public async stop (): Promise<void> {
		this.stopped = true
		if (this.timer) clearTimeout(this.timer)
		await this.turn.catch(() => undefined)
		if (this.leading) {
			this.leading = false
			await this.role.follow()
			await this.bus.release(this.key, this.owner).catch(() => undefined)
		}
	}
}
