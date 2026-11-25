import { IOrm, Orm } from '@lambdaorm/lib'
import { Actor, QueryOptions, ResolvedObservability, ScriptOptions } from '@lambdaorm/base'
import { OrmCommandPort, OrmQueryPort, OrmSchemaPort, OrmScriptPort, OrmStagePort, SourceSentences } from '../../../application/ports/output/ormPorts'

/** λORM (@lambdaorm/lib) behind the ports of the application: one instance per schema. */
export class LambdaOrmAdapter implements OrmQueryPort, OrmScriptPort, OrmSchemaPort, OrmStagePort, OrmCommandPort {
	public readonly orm: IOrm

	constructor (orm?: IOrm) {
		this.orm = orm ?? new Orm()
	}

	/** Loads the schema (lambdaORM.yaml of the workspace) and creates its connection pools */
	public async init (workspace: string): Promise<void> {
		await this.orm.init(workspace)
	}

	/**
	 * Opens and releases one connection of every source with a connection: a database down, wrong credentials or a
	 * missing variable fail here, at start, instead of in the first query.
	 */
	public async checkConnections (timeoutMs: number): Promise<void> {
		const connection = (this.orm as any).connection
		const sources: { name: string, connection?: unknown }[] = this.infrastructure()?.sources ?? []
		// first the variables that are not set, all of them at once and without the network (λORM L43)
		const unset = sources.filter(s => typeof s.connection === 'string' && s.connection.includes('${'))
		if (unset.length) {
			const variables = [...new Set(unset.flatMap(s => [...(s.connection as string).matchAll(/\$\{([^}]+)\}/g)].map(m => m[1])))]
			const several = variables.length > 1
			throw new Error(`${unset.length > 1 ? 'sources' : 'source'} ${unset.map(s => s.name).join(', ')} ${unset.length > 1 ? 'need' : 'needs'} ` +
				`${variables.join(', ')}, which ${several ? 'are' : 'is'} not set: give ${several ? 'them' : 'it'} in orm.schemas[].env of ` +
				'data-gateway.config.yaml, or in the environment of the gateway')
		}
		for (const source of sources.filter(s => s.connection !== undefined && s.connection !== null && s.connection !== '')) {
			let timer: ReturnType<typeof setTimeout> | undefined
			try {
				await Promise.race([
					(async () => {
						const opened = await connection.acquire(source.name)
						await connection.release(opened)
					})(),
					new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${timeoutMs} ms`)), timeoutMs) })
				])
			} catch (error: any) {
				throw new Error(`source "${source.name}": ${error?.message ?? error}`)
			} finally {
				if (timer) clearTimeout(timer)
			}
		}
	}

	public async end (): Promise<void> {
		await this.orm.end()
	}

	/** The raw infrastructure of the loaded schema (queue, legacy service settings, …) */
	public infrastructure (): any {
		return this.orm.state?.schema?.infrastructure
	}

	/**
	 * λORM's spans and metrics with this configuration (the gateway's, for a schema without its own); the trace conditions
	 * of the entities of the schema still decide for them
	 */
	public observe (config: ResolvedObservability): void {
		// observeWith is in Orm and not yet in IOrm (pending in core)
		(this.orm as Orm).observeWith(config)
	}

	// ─── queries ─────────────────────────────────────────────────────────────

	public execute (query: string, data?: unknown, options?: QueryOptions) { return this.orm.execute(query, data, options) }
	public async plan (query: string, options?: QueryOptions) { return this.orm.plan(query, options) }
	public async metadata (query: string) { return this.orm.metadata(query) }
	public async model (query: string) { return this.orm.model(query) }
	public async parameters (query: string) { return this.orm.parameters(query) }
	public async constraints (query: string) { return this.orm.constraints(query) }
	public executeScript (script: string, data?: unknown, options?: ScriptOptions) { return this.orm.executeScript(script, data, options) }

	// ─── schema ──────────────────────────────────────────────────────────────

	public check (): void {
		const infrastructure = this.infrastructure()
		if (!infrastructure) throw new Error('Lambda ORM not initialized')
		if (!infrastructure.stages || infrastructure.stages.length === 0) throw new Error('Lambda ORM can\'t stages not initialized')
		if (!infrastructure.sources || infrastructure.sources.length === 0) throw new Error('Lambda ORM can\'t sources not initialized')
	}

	public version () { return this.orm.state.getSchemaVersion() }
	public domain () { return this.orm.state.getSchemaDomain() }
	public sources () { return this.orm.state.getSchemaSources() }
	// only a source of the schema (getSchemaSource answers { name, dialect: 'unknown' } for any other name)
	public source (name: string) { return this.orm.state.getSchemaSources()?.find(source => source.name === name) }
	public entities () { return this.orm.state.getSchemaEntities() }
	public entity (name: string) { return this.orm.state.getSchemaEntity(name) }
	public enums () { return this.orm.state.getSchemaEnums() }
	public enum (name: string) { return this.orm.state.getSchemaEnum(name) }
	public mappings () { return this.orm.state.getSchemaMappings() }
	public mapping (name: string) { return this.orm.state.getSchemaMapping(name) }
	public entityMapping (mapping: string, entity: string) { return this.orm.state.getSchemaEntityMapping(mapping, entity) }
	public stages () { return this.orm.state.getSchemaStages() }
	public stage (name: string) { return this.orm.state.getSchemaStage(name) }
	public views () { return this.orm.state.getSchemaViews() }

	// ─── stages ──────────────────────────────────────────────────────────────

	public exists (stage: string) { return this.orm.stage.exists(stage) }
	public export (stage: string) { return this.orm.stage.export({ stage }).execute() }
	public import (stage: string, data: unknown, actor?: Actor) { return this.orm.stage.import({ stage, actor }).execute(data as any) }

	// ─── commands (admin) ────────────────────────────────────────────────────

	public stageNames (): string[] { return (this.orm.state.getSchemaStages() ?? []).map((s: { name: string }) => s.name) }
	public fetch (stage: string) { return this.orm.stage.fetch({ stage }) as Promise<unknown[]> }
	public async pushSentences (stage: string): Promise<SourceSentences[]> {
		const bySource = new Map<string, SourceSentences>()
		for (const query of await this.orm.stage.push({ stage }).queries()) {
			const source = bySource.get(query.source) ?? bySource.set(query.source, { source: query.source, sentences: [] }).get(query.source)!
			source.sentences.push(query.sentence)
			if (query.destructive) (source.destructive ??= []).push({ sentence: query.sentence, reason: query.destructive })
		}
		return [...bySource.values()]
	}

	public push (stage: string, force: boolean, actor?: Actor, allowDestructive?: boolean) {
		return this.orm.stage.push({ stage, tryAllCan: force, actor, ...(allowDestructive ? { allowDestructive } : {}) }).execute() as Promise<unknown[]>
	}

	public migrations (stage: string) { return this.orm.stage.migrations.list({ stage }) as Promise<unknown[]> }

	/** as λORM's migrate does it: the applied migrations after the version, the newest first, and their undo */
	public async migrateSentences (stage: string, version: string): Promise<SourceSentences[]> {
		const later = (await this.orm.stage.migrations.list({ stage })).filter(m => m.status === 'applied' && m.version > version)
		return later.map(m => {
			const undo = m.undo ?? []
			const destructive = undo.filter(u => u.destructive).map(u => ({ sentence: u.sentence, reason: u.destructive! }))
			return { source: m.source, version: m.version, sentences: undo.map(u => u.sentence), ...(destructive.length ? { destructive } : {}) }
		})
	}

	public migrate (stage: string, version: string, actor?: Actor, allowDestructive?: boolean) {
		return this.orm.stage.migrate(version, { stage, actor, ...(allowDestructive ? { allowDestructive } : {}) }) as Promise<unknown[]>
	}

	public seedFiles (stage: string) { return this.orm.stage.seed({ stage }).files() }
	public seed (stage: string, actor?: Actor) { return this.orm.stage.seed({ stage, actor }).execute() as Promise<unknown[]> }
	public dropSentences (stage: string) { return this.orm.stage.drop({ stage }).sentence() as Promise<unknown[]> }
	public drop (stage: string, force: boolean, actor?: Actor) { return this.orm.stage.drop({ stage, tryAllCan: force, actor }).execute() as Promise<unknown[]> }

	/** The schema as written (variables unsolved), without its application: code of the schema that must not run here */
	private writtenSchema (): { schema: any, application: unknown } {
		const schema = JSON.parse(JSON.stringify(this.orm.state.originalSchema))
		const application = schema.application
		delete schema.application
		return { schema, application }
	}

	/** A λORM on a copy of the schema, without connections nor a file: what it changes is not written anywhere */
	private async onACopy<T> (task: (copy: Orm) => Promise<T>): Promise<{ result: T, schema: unknown }> {
		const { schema, application } = this.writtenSchema()
		const copy = new Orm()
		try {
			await copy.init(schema, false)
			const result = await task(copy)
			const changed: any = JSON.parse(JSON.stringify(copy.state.originalSchema))
			if (application !== undefined) changed.application = application
			return { result, schema: changed }
		} finally {
			await copy.end().catch(() => undefined)
		}
	}

	public async pullSchema (stage: string): Promise<unknown> {
		const mappings = await this.orm.stage.read({ stage })
		return (await this.onACopy(copy => copy.state.match(mappings))).schema
	}

	/**
	 * pull on the schema served: the state of the stage (orm_state) updated as λORM does, but without letting λORM write
	 * the lambdaORM.yaml (js-yaml loses its comments and order): the gateway writes the schema it answers.
	 */
	public async pull (stage: string, actor?: Actor): Promise<unknown> {
		const facade = (this.orm.state as any).facade
		const write = facade.write
		facade.write = async () => undefined
		try {
			await this.orm.stage.pull({ stage, actor })
		} finally {
			facade.write = write
		}
		return JSON.parse(JSON.stringify(this.orm.state.originalSchema))
	}

	public async introspectSchema (data: unknown, name: string): Promise<{ schema: unknown, data: unknown }> {
		const { result, schema } = await this.onACopy(copy => copy.state.introspect(data as any, name))
		return { schema, data: result }
	}
}
