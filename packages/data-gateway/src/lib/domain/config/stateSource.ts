import { StateConfig } from './dataGatewayConfig'

/**
 * Where the state of the gateway lives (docs/GATEWAY_STATE.md §2): a SQLite file (node:sqlite: durable, shared by the
 * workers and the processes that open it), a database through λORM (several replicas), or memory (no volume).
 */
export type StateSource =
	| { kind: 'sqlite', file: string }
	| { kind: 'orm', dialect: string, connection: unknown }
	| { kind: 'memory' }

/** The SQLite of the volume, shared by the replicas that mount it */
export const stateFileOf = (workspacePath: string): string => `${workspacePath.replace(/[\\/]+$/, '')}/.data-gateway/state.sqlite`

/** The source of the state of a configuration: state.source, else the SQLite of the volume, else memory */
export const stateSourceOf = (state: StateConfig | undefined, workspacePath: string | undefined): StateSource => {
	const source = state?.source
	if (source && source.dialect !== 'SQLite') return { kind: 'orm', dialect: source.dialect, connection: source.connection }
	if (source) {
		const connection = source.connection as string | { file?: string }
		const file = typeof connection === 'string' ? connection : connection?.file
		if (file) return { kind: 'sqlite', file }
	}
	return workspacePath ? { kind: 'sqlite', file: stateFileOf(workspacePath) } : { kind: 'memory' }
}

export const describeState = (source: StateSource): string =>
	source.kind === 'sqlite' ? `SQLite ${source.file}` : source.kind === 'orm' ? `${source.dialect} (λORM)` : 'memory'
