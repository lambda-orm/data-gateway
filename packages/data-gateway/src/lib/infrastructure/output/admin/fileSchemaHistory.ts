import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { FileLogAdapter, Logger, LogLevel, OpenTelemetryLogAdapter, SchemaChange, SCHEMA_CHANGE_EVENT } from '@lambdaorm/base'
import { SchemaHistoryFilter, SchemaHistoryPort } from '../../../application/ports/output/adminPorts'
import { WorkspaceChange } from '../../../domain/runtime/workspaces'

const HISTORY_FILE = 'changes.jsonl'
/** λORM keeps the hash of the last lambdaORM.yaml it saw here: one the gateway wrote is not a change from outside */
const HASH_FILE = 'schema.hash'

/** the folder of the logs of a workspace: infrastructure.paths.logs of its lambdaORM.yaml, logs by default */
const logsOf = (workspace: string): string => {
	const dir = fs.existsSync(workspace) && fs.statSync(workspace).isDirectory() ? workspace : path.dirname(workspace)
	let logs = 'logs'
	try {
		const schema = yaml.load(fs.readFileSync(path.join(dir, 'lambdaORM.yaml'), 'utf8')) as any
		const configured = schema?.infrastructure?.paths?.logs
		if (typeof configured === 'string' && configured.trim()) logs = configured.trim()
	} catch {
		// no lambdaORM.yaml (yet): the default
	}
	return path.isAbsolute(logs) ? logs : path.join(dir, logs)
}

const kindOfFile = (change: SchemaChange): WorkspaceChange['kind'] =>
	change.kind.startsWith('schema.') ? 'schema' : change.kind === 'env.set' ? 'env' : 'files'

/**
 * The history of a schema in <workspace>/<paths.logs>/changes.jsonl, with the format and the adapter of λORM (its
 * events of push, pull… go to the same file), and as a LogRecord of OpenTelemetry (Loki…) when the logs are exported.
 * Each change is announced at once to the IDEs (workspace.changed with who and what).
 */
export class FileSchemaHistory implements SchemaHistoryPort {
	private readonly loggers = new Map<string, Logger>()

	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly announce?: (change: WorkspaceChange) => void) {}

	public async record (schemaPath: string, workspace: string, change: SchemaChange): Promise<void> {
		const logs = logsOf(workspace)
		await this.logger(logs).event(SCHEMA_CHANGE_EVENT, change as unknown as Record<string, unknown>, LogLevel.INFO)
		if (change.version?.after) {
			await fs.promises.mkdir(logs, { recursive: true })
			await fs.promises.writeFile(path.join(logs, HASH_FILE), change.version.after)
		}
		this.announce?.({
			path: schemaPath,
			kind: kindOfFile(change),
			at: change.time,
			change: { id: change.id, kind: change.kind, target: change.target, actor: change.actor, time: change.time, version: change.version?.after }
		})
	}

	public async read (workspace: string, filter: SchemaHistoryFilter): Promise<{ items: SchemaChange[], nextCursor?: string }> {
		const file = path.join(logsOf(workspace), HISTORY_FILE)
		let text = ''
		try {
			await this.loggers.get(logsOf(workspace))?.flush()
			text = await fs.promises.readFile(file, 'utf8')
		} catch {
			return { items: [] }
		}
		const changes: SchemaChange[] = []
		for (const line of text.split('\n')) {
			if (!line.trim()) continue
			try {
				const record = JSON.parse(line)
				if (record.event === SCHEMA_CHANGE_EVENT && record.attributes?.id) changes.push(record.attributes)
			} catch {
				// a line cut by a crash: skipped
			}
		}
		const matching = changes
			.filter(p => !filter.since || p.time >= filter.since)
			.filter(p => !filter.kind || p.kind === filter.kind)
			.filter(p => !filter.target || (p.target ?? '').startsWith(filter.target))
			.filter(p => !filter.cursor || p.id < filter.cursor)
			// ULIDs sort by time: the newest first
			.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
		const items = matching.slice(0, filter.limit)
		return matching.length > filter.limit ? { items, nextCursor: items[items.length - 1].id } : { items }
	}

	private logger (logs: string): Logger {
		let logger = this.loggers.get(logs)
		if (!logger) {
			logger = new Logger([
				new FileLogAdapter({ path: path.join(logs, HISTORY_FILE), events: [SCHEMA_CHANGE_EVENT] }),
				// a no-op without the SDK; with it, the change goes to Loki (or wherever the logs are exported)
				new OpenTelemetryLogAdapter({ name: '@lambdaorm/data-gateway' })
			])
			this.loggers.set(logs, logger)
		}
		return logger
	}
}
