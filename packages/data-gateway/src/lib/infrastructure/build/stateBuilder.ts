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
import { PersistAdmin } from './persist'
import { stringify } from 'yaml'
import { systemSchema, VOLUME_MAPPING } from '../output/state/ormState'
import { StateDescription } from '../../application/auth/roleAdmin'

/** A connection without its secrets: the values of keys like password, the password of a URL */
export const maskConnection = (connection: unknown): unknown => {
	if (typeof connection === 'string') {
		return connection.replace(/(\/\/[^:/@\s]+:)[^@\s]*@/, '$1***@').replace(/((?:password|pwd|secret|token)\s*=\s*)[^;&\s]*/gi, '$1***')
	}
	if (Array.isArray(connection)) return connection.map(maskConnection)
	if (connection && typeof connection === 'object') {
		return Object.fromEntries(Object.entries(connection).map(([k, v]) => [k, /pass|secret|token|key|credential/i.test(k) ? '***' : maskConnection(v)]))
	}
	return connection
}

/**
 * Where the gateway keeps its state and its schema as λORM sees it (docs/GATEWAY_STATE.md §3), without secrets: what
 * the administration shows in Persist and Config
 */
export const describeStateOf = (source: StateSource, config: DataGatewayConfig, available: boolean): StateDescription => {
	const dialect = source.kind === 'orm' ? source.dialect : source.kind === 'sqlite' ? 'SQLite' : undefined
	const connection = source.kind === 'orm' ? maskConnection(source.connection) : source.kind === 'sqlite' ? { file: source.file } : undefined
	return {
		kind: source.kind,
		...(dialect ? { dialect } : {}),
		...(connection !== undefined ? { connection } : {}),
		...(source.kind === 'sqlite' ? { file: source.file } : {}),
		where: describeState(source),
		// the SQLite of the volume is used directly (node:sqlite); another database, through λORM with this schema
		managedBy: source.kind === 'orm' ? 'lambdaORM' : source.kind === 'sqlite' ? 'node:sqlite' : 'memory',
		configured: !!config.state?.source,
		refreshMs: config.state?.refreshMs ?? 30000,
		required: config.state?.required ?? false,
		available,
		persisted: !!config.state?.persisted,
		// the mapping changes in a database through λORM; the SQLite of the volume has the gateway's own tables
		mappingEditable: source.kind === 'orm',
		...(dialect ? { schema: stringify(systemSchema(dialect, connection, '<the temporary folder of the gateway>', source.kind === 'orm' ? source.mapping : VOLUME_MAPPING)) } : {})
	}
}

/** The state of the gateway in this process (docs/GATEWAY_STATE.md): its source, the catalog of the roles and theirs */
export interface GatewayState {
	source: StateSource
	catalog: RoleCatalog
	roles: RoleAdmin
	refresher: RoleRefresher
	/** the observability of the gateway changed from the administration (docs/DATA_GATEWAY.md §8.2) */
	observability: ObservabilityAdmin
	/** where the state is kept, changed from the administration (docs/GATEWAY_STATE.md §2) */
	persist: PersistAdmin
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
	onObservability?: (override: Record<string, any> | undefined) => void,
	/** where the state is kept changed: who restarts the gateway with it (the supervisor); none, at the next start */
	onPersist?: () => void
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
		roles: new RoleAdmin(store, catalog, clock, randomUUID, logger, () => describeAccess(config), () => describeStateOf(source, config, refresher.available)),
		refresher,
		persist: new PersistAdmin(config, logger, () => {
			if (onPersist) onPersist()
			else logger.warn('[data-gateway] state: where it is kept changed; it applies when the gateway starts again')
		}),
		observability: new ObservabilityAdmin(store, config, config.metrics.enabled, clock, randomUUID, logger, observabilityProblems, () => observed.refresh()),
		close: async () => {
			refresher.stop()
			observed.stop()
			await closeState(source)
		}
	}
}
