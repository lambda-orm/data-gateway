import { IOrm, Orm } from '@lambdaorm/lib'
import { QueryOptions, ScriptOptions } from '@lambdaorm/base'
import { OrmCommandPort, OrmQueryPort, OrmSchemaPort, OrmScriptPort, OrmStagePort } from '../../../application/ports/output/ormPorts'

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
	public import (stage: string, data: unknown) { return this.orm.stage.import({ stage }).execute(data as any) }

	// ─── commands (admin) ────────────────────────────────────────────────────

	public stageNames (): string[] { return (this.orm.state.getSchemaStages() ?? []).map((s: { name: string }) => s.name) }
	public fetch (stage: string) { return this.orm.stage.fetch({ stage }) as Promise<unknown[]> }
	public pushSentences (stage: string) { return this.orm.stage.push({ stage }).sentencesBySource() }
	public push (stage: string, force: boolean) { return this.orm.stage.push({ stage, tryAllCan: force }).execute() as Promise<unknown[]> }
	public dropSentences (stage: string) { return this.orm.stage.drop({ stage }).sentence() as Promise<unknown[]> }
	public drop (stage: string, force: boolean) { return this.orm.stage.drop({ stage, tryAllCan: force }).execute() as Promise<unknown[]> }
}
