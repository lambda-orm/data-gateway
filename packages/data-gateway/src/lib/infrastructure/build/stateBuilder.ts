import { randomUUID } from 'crypto'
import { DataGatewayConfig } from '../../domain/config/dataGatewayConfig'
import { describeState, StateSource, stateSourceOf } from '../../domain/config/stateSource'
import { RoleCatalog } from '../../application/auth/roleCatalog'
import { describeAccess } from '../../application/auth/accessView'
import { RoleAdmin, RoleRefresher } from '../../application/auth/roleAdmin'
import { ClockPort, LoggerPort } from '../../application/ports/output/supportPorts'
import { closeState, roleStoreOf } from '../output/state/stateStores'
import { ObservabilityAdmin, ObservabilityRefresher } from '../../application/observability/observabilityAdmin'
import { observabilityProblems } from './observability'

/** The state of the gateway in this process (docs/GATEWAY_STATE.md): its source, the catalog of the roles and theirs */
export interface GatewayState {
	source: StateSource
	catalog: RoleCatalog
	roles: RoleAdmin
	refresher: RoleRefresher
	/** the observability of the gateway changed from the administration (docs/DATA_GATEWAY.md §8.2) */
	observability: ObservabilityAdmin
	/** what the administration changed of the observability when this process started (none: the YAML's) */
	observabilityOverride?: Record<string, any>
	close (): Promise<void>
}

/**
 * The roles of the YAML and of the state, loaded before the transports start (docs/ROLE_SCOPES.md). Without the source
 * of the state the YAML alone; with state.required, the gateway doesn't start.
 */
export const buildGatewayState = async (
	config: DataGatewayConfig,
	logger: LoggerPort,
	clock: ClockPort,
	/** an observability saved (here or in another replica): who applies it (the supervisor); none, at the next start */
	onObservability?: (override: Record<string, any> | undefined) => void
): Promise<GatewayState> => {
	const source = stateSourceOf(config.state, config.orm.workspacePath)
	const catalog = new RoleCatalog(config)
	const store = roleStoreOf(source)
	const refresher = new RoleRefresher(store, catalog, config.state?.refreshMs ?? 30000, logger)
	await refresher.refresh()
	if (!refresher.available && config.state?.required) throw new Error(`the state of the gateway (${describeState(source)}) can't be read and state.required is true`)
	refresher.start()
	const observed = new ObservabilityRefresher(store, config.state?.refreshMs ?? 30000, override => {
		if (onObservability) onObservability(override)
		else logger.warn('[data-gateway] observability: changed in the state; it applies when the gateway starts again')
	}, logger)
	await observed.refresh()
	observed.start()
	const override = await store.setting('observability').then(s => s?.value as Record<string, any> | undefined, () => undefined)
	return {
		...(override ? { observabilityOverride: override } : {}),
		source,
		catalog,
		roles: new RoleAdmin(store, catalog, clock, randomUUID, logger, () => describeAccess(config)),
		refresher,
		observability: new ObservabilityAdmin(store, config, config.metrics.enabled, clock, randomUUID, logger, observabilityProblems, () => observed.refresh()),
		close: async () => {
			refresher.stop()
			observed.stop()
			await closeState(source)
		}
	}
}
