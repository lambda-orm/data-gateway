import { ObservabilityConfig } from '@lambdaorm/base'
import { Principal } from '../../domain/auth/principal'
import { ExploreConfig } from '../../domain/config/dataGatewayConfig'
import { mergeObservability, readObservabilityOverride } from '../../domain/config/observabilitySettings'
import { badRequest, forbidden, notFound } from '../../domain/errors/gatewayError'
import { ClockPort, LoggerPort } from '../ports/output/supportPorts'
import { ConfigChange, SettingStorePort } from '../ports/output/statePorts'

type Raw = Record<string, any>

/** The observability as the administration shows it: the YAML, what the state changed, and what applies */
export interface ObservabilityView {
	/** of data-gateway.config.yaml (observability, with explore) */
	yaml?: Raw
	/** the sections changed from the administration: each replaces the one of the YAML, whole */
	override?: Raw
	/** the YAML with the override: what the gateway uses (the OTEL_* variables still override it) */
	effective?: Raw
	updatedAt?: string
	updatedBy?: string
	/** /metrics (Prometheus) is served: metrics.enabled of the YAML */
	prometheus: boolean
}

/**
 * The observability of the gateway changed from the administration (docs/DATA_GATEWAY.md §8.2): its exporter, its
 * traces, metrics and logs, and where they are seen (explore), kept in the state over the YAML. With the permission
 * observability. Each change is recorded (who, when, before and after); once saved, the gateway applies it: the edge
 * restarts, and the schema workers whose SDK changes reload (blue-green).
 */
export class ObservabilityAdmin {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly store: SettingStorePort,
		private readonly yaml: { observability?: ObservabilityConfig, explore?: ExploreConfig },
		private readonly prometheus: boolean,
		private readonly clock: ClockPort,
		private readonly id: () => string,
		private readonly logger: LoggerPort,
		/** the problems of an observability (the shape of λORM's, its explore): none, it can be applied */
		private readonly validate: (merged: Raw | undefined) => string[],
		/** saved: the gateway applies it (the refresher of the edge tells the supervisor) */
		private readonly applied: () => Promise<void> = async () => undefined
	) {}

	private require (who: Principal): void {
		if (!who.permissions.has('observability')) throw forbidden(who.name, 'observability')
	}

	public async get (who: Principal): Promise<ObservabilityView> {
		this.require(who)
		const stored = await this.store.setting('observability')
		const override = stored?.value as Raw | undefined
		const yaml = mergeObservability(this.yaml, undefined)
		const effective = mergeObservability(this.yaml, override)
		return {
			...(yaml ? { yaml } : {}),
			...(override ? { override } : {}),
			...(effective ? { effective } : {}),
			...(stored ? { updatedAt: stored.updatedAt, updatedBy: stored.updatedBy } : {}),
			prometheus: this.prometheus
		}
	}

	public async put (who: Principal, body: unknown, reason?: string): Promise<ObservabilityView> {
		this.require(who)
		const issues: string[] = []
		const override = readObservabilityOverride(body, issues)
		if (!issues.length) issues.push(...this.validate(mergeObservability(this.yaml, override)))
		if (issues.length) throw badRequest('ValidationError', issues.join('; '))
		const before = (await this.store.setting('observability'))?.value
		const at = this.clock.now().toISOString()
		await this.store.putSetting({ key: 'observability', value: override, updatedAt: at, updatedBy: who.name }, this.change(who, before, override, at, reason))
		this.logger.info(`[data-gateway] observability: "${who.name}" changed ${Object.keys(override ?? {}).join(', ')}: the gateway applies it`)
		await this.applied()
		return this.get(who)
	}

	/** back to the YAML */
	public async remove (who: Principal, reason?: string): Promise<ObservabilityView> {
		this.require(who)
		const before = (await this.store.setting('observability'))?.value
		if (before === undefined) throw notFound('the observability is the one of the configuration: nothing changed from the administration')
		const at = this.clock.now().toISOString()
		await this.store.removeSetting('observability', this.change(who, before, undefined, at, reason))
		this.logger.info(`[data-gateway] observability: "${who.name}" went back to the one of the configuration: the gateway applies it`)
		await this.applied()
		return this.get(who)
	}

	private change (who: Principal, before: unknown, after: unknown, at: string, reason?: string): ConfigChange {
		return { id: this.id(), area: 'observability', key: 'observability', ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}), by: who.name, at, ...(reason ? { reason: String(reason).slice(0, 1000) } : {}) }
	}
}

/**
 * The observability of the state in this replica: when its version moves (this replica or another saved one), the
 * supervisor is told the override to apply. The first reading only learns the version (the supervisor started with it).
 */
export class ObservabilityRefresher {
	private timer?: ReturnType<typeof setInterval>
	private seen?: number

	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly store: SettingStorePort,
		private readonly refreshMs: number,
		private readonly changed: (override: Raw | undefined) => void,
		private readonly logger: LoggerPort
	) {}

	public async refresh (): Promise<void> {
		try {
			const version = await this.store.areaVersion('observability')
			if (this.seen !== undefined && version !== this.seen) this.changed((await this.store.setting('observability'))?.value as Raw | undefined)
			this.seen = version
		} catch (error: any) {
			this.logger.warn(`[data-gateway] state: the observability of the state can't be read (${error?.message ?? error})`)
		}
	}

	public start (): void {
		if (this.refreshMs > 0 && !this.timer) {
			this.timer = setInterval(() => { this.refresh().catch(() => undefined) }, this.refreshMs)
			this.timer.unref?.()
		}
	}

	public stop (): void {
		if (this.timer) clearInterval(this.timer)
		this.timer = undefined
	}
}
