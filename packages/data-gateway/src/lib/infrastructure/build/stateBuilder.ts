import { randomUUID } from 'crypto'
import { DataGatewayConfig } from '../../domain/config/dataGatewayConfig'
import { describeState, StateSource, stateSourceOf } from '../../domain/config/stateSource'
import { RoleCatalog } from '../../application/auth/roleCatalog'
import { describeAccess } from '../../application/auth/accessView'
import { RoleAdmin, RoleRefresher } from '../../application/auth/roleAdmin'
import { ClockPort, LoggerPort } from '../../application/ports/output/supportPorts'
import { closeState, roleStoreOf } from '../output/state/stateStores'

/** The state of the gateway in this process (docs/GATEWAY_STATE.md): its source, the catalog of the roles and theirs */
export interface GatewayState {
	source: StateSource
	catalog: RoleCatalog
	roles: RoleAdmin
	refresher: RoleRefresher
	close (): Promise<void>
}

/**
 * The roles of the YAML and of the state, loaded before the transports start (docs/ROLE_SCOPES.md). Without the source
 * of the state the YAML alone; with state.required, the gateway doesn't start.
 */
export const buildGatewayState = async (config: DataGatewayConfig, logger: LoggerPort, clock: ClockPort): Promise<GatewayState> => {
	const source = stateSourceOf(config.state, config.orm.workspacePath)
	const catalog = new RoleCatalog(config)
	const store = roleStoreOf(source)
	const refresher = new RoleRefresher(store, catalog, config.state?.refreshMs ?? 30000, logger)
	await refresher.refresh()
	if (!refresher.available && config.state?.required) throw new Error(`the state of the gateway (${describeState(source)}) can't be read and state.required is true`)
	refresher.start()
	return {
		source,
		catalog,
		roles: new RoleAdmin(store, catalog, clock, randomUUID, logger, () => describeAccess(config)),
		refresher,
		close: async () => {
			refresher.stop()
			await closeState(source)
		}
	}
}
