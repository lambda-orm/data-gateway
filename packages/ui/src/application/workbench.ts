import { availability, Operation, WhoAmI } from '../domain/operations'
import { failure, measure, QueryResult, ResultError } from '../domain/results'
import { addToHistory, dataFromParameters, EditorMarker, HistoryEntry, markerFromError, parseObject } from '../domain/workspace'
import { HistoryPort, QueryApiPort, SchemaInfo } from './ports'

export type Mode = 'query' | 'script'

export interface WorkbenchState {
	schemas: SchemaInfo[]
	schema?: string
	whoami?: WhoAmI
	/** The domain of the schema as declarations, for the editor */
	typings?: string
	mode: Mode
	query: string
	script: string
	/** JSON text of the data and the options */
	data: string
	options: string
	topic: string
	chunk: string
	running?: Operation
	result?: QueryResult
	markers: EditorMarker[]
	history: HistoryEntry[]
	/** A problem loading the schema (credential, gateway down) */
	notice?: string
}

const errorOf = (error: any): ResultError => ({
	name: error?.name ?? 'Error',
	message: error?.message ?? String(error),
	status: Number.isInteger(error?.status) ? error.status : undefined,
	code: error?.code
})

/**
 * The state and actions of the workbench, without React (the components subscribe to it). Runs every action against
 * the QueryApiPort, keeps the last result, the λORM errors of the text as markers and the history per schema.
 */
export class WorkbenchController {
	private state: WorkbenchState
	private readonly listeners = new Set<() => void>()
	private validation: ReturnType<typeof setTimeout> | undefined
	private validationRun = 0

	constructor (
		private readonly api: QueryApiPort,
		private readonly history: HistoryPort | undefined,
		initial: Partial<WorkbenchState> = {},
		private readonly onResult?: (result: QueryResult) => void,
		private readonly clock: () => number = () => Date.now()
	) {
		this.state = { schemas: [], mode: 'query', query: '', script: '', data: '{}', options: '{}', topic: '', chunk: '', markers: [], history: [], ...initial }
	}

	public getState = (): WorkbenchState => this.state

	public subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener)
		return () => { this.listeners.delete(listener) }
	}

	private set (patch: Partial<WorkbenchState>): void {
		this.state = { ...this.state, ...patch }
		for (const listener of this.listeners) listener()
	}

	public update (patch: Partial<Pick<WorkbenchState, 'query' | 'script' | 'data' | 'options' | 'topic' | 'chunk' | 'mode'>>): void {
		this.set(patch)
	}

	/** The schemas that can be chosen (ready ones) */
	public async loadSchemas (): Promise<void> {
		try {
			const schemas = (await this.api.schemas()).filter(s => s.status === 'ready')
			this.set({ schemas, notice: schemas.length ? undefined : 'no schema is ready' })
		} catch (error) {
			this.set({ notice: `schemas: ${errorOf(error).message}` })
		}
	}

	/** Who the credential is on the schema, its typings and its history */
	public async selectSchema (schema: string): Promise<void> {
		this.set({ schema, whoami: undefined, typings: undefined, result: undefined, markers: [], history: this.history?.load(schema) ?? [], notice: undefined })
		try {
			const [whoami, typings] = await Promise.all([this.api.whoami(schema), this.api.typings(schema).catch(() => undefined)])
			if (this.state.schema === schema) this.set({ whoami, typings })
		} catch (error) {
			const e = errorOf(error)
			if (this.state.schema === schema) this.set({ notice: e.status === 401 ? 'the credential is not valid for this schema' : `${e.name}: ${e.message}` })
		}
	}

	public available (operation: Operation) {
		return availability(operation, this.state.whoami)
	}

	/** Runs an action on the text of the current mode; the result (or the error) replaces the previous one */
	public async run (operation: Operation): Promise<QueryResult | undefined> {
		const s = this.state
		if (s.schema === undefined || s.running) return undefined
		const started = this.clock()
		this.set({ running: operation })
		let result: QueryResult
		try {
			const value = await this.call(operation)
			result = measure(operation, value, this.clock() - started)
			if (operation === 'execute' || operation === 'executeScript' || operation === 'executeQueued') this.remember()
		} catch (error) {
			result = failure(operation, errorOf(error), this.clock() - started)
		}
		this.set({ running: undefined, result })
		this.onResult?.(result)
		return result
	}

	private call (operation: Operation): Promise<unknown> {
		const s = this.state
		const schema = s.schema!
		const options = parseObject(s.options, 'options')
		const hasOptions = Object.keys(options).length > 0
		if (operation === 'executeScript') return this.api.executeScript(schema, s.script, parseObject(s.data, 'data'), hasOptions ? options : undefined)
		const query = s.query
		switch (operation) {
		case 'plan': return this.api.plan(schema, query, hasOptions ? options : undefined)
		case 'metadata': return this.api.metadata(schema, query)
		case 'model': return this.api.model(schema, query)
		case 'parameters': return this.api.parameters(schema, query)
		case 'constraints': return this.api.constraints(schema, query)
		case 'execute': return this.api.execute(schema, query, parseObject(s.data, 'data'), hasOptions ? options : undefined)
		case 'executeQueued': {
			if (!s.topic.trim()) return Promise.reject(Object.assign(new Error('a topic is required'), { name: 'QueueError' }))
			const chunk = s.chunk.trim() ? Number(s.chunk) : undefined
			return this.api.executeQueued(schema, { topic: s.topic, query, data: parseObject(s.data, 'data'), chunk, options: hasOptions ? options : undefined })
		}
		}
		return Promise.reject(new Error(`unknown operation ${operation}`))
	}

	/** Completes the data with the parameters the query expects */
	public async fillParameters (): Promise<void> {
		const s = this.state
		if (s.schema === undefined) return
		const result = await this.run('parameters')
		if (!result?.ok || !Array.isArray(result.value)) return
		const data = dataFromParameters(result.value as any, parseObject(s.data, 'data'))
		this.set({ data: JSON.stringify(data, null, 2) })
	}

	/** Checks the query with λORM after a pause in the typing; its errors become markers */
	public scheduleValidation (delayMs = 500): void {
		if (this.validation) clearTimeout(this.validation)
		this.validation = setTimeout(() => { this.validate() }, delayMs)
	}

	public async validate (): Promise<EditorMarker[]> {
		const s = this.state
		const run = ++this.validationRun
		if (s.schema === undefined || s.mode !== 'query' || !s.query.trim() || !this.available('metadata').enabled) {
			this.set({ markers: [] })
			return []
		}
		let markers: EditorMarker[] = []
		try {
			await this.api.metadata(s.schema, s.query)
		} catch (error) {
			const e = errorOf(error)
			if (e.status === undefined || e.status < 500) markers = [markerFromError(`${e.name}: ${e.message}`, s.query)]
		}
		// a newer validation already answered
		if (run === this.validationRun) this.set({ markers })
		return markers
	}

	private remember (): void {
		const s = this.state
		if (s.schema === undefined || !this.history) return
		const entry: HistoryEntry = { mode: s.mode, text: s.mode === 'query' ? s.query : s.script, data: s.data, options: s.options, at: new Date(this.clock()).toISOString() }
		const history = addToHistory(s.history, entry)
		this.history.save(s.schema, history)
		this.set({ history })
	}

	public restore (entry: HistoryEntry): void {
		this.set(entry.mode === 'query'
			? { mode: 'query', query: entry.text, data: entry.data, options: entry.options }
			: { mode: 'script', script: entry.text, data: entry.data, options: entry.options })
	}

	public clearHistory (): void {
		if (this.state.schema === undefined) return
		this.history?.clear(this.state.schema)
		this.set({ history: [] })
	}
}
