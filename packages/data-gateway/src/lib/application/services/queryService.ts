import { IOrm, Metadata, MetadataConstraint, MetadataModel, MetadataParameter, QueryPlan, QueryOptions } from '@lambdaorm/lib'

export interface ScriptSettings {
	enabled: boolean
	maxLength: number
	timeoutMs: number
	/** Max loop iterations of a script (SCRIPT_MAX_ITERATIONS) */
	maxIterations?: number
}

/** An error with the HTTP status the service answers with */
const httpError = (status: number, name: string, message: string): Error => Object.assign(new Error(message), { name, status })

export class QueryService {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly orm: IOrm, private readonly scripts: ScriptSettings = { enabled: false, maxLength: 20000, timeoutMs: 30000 }) { }

	public async constraints ({ body }: { body: {query:string} }): Promise<MetadataConstraint> {
		return this.orm.constraints(body.query)
	}

	public async metadata ({ body }: { body: {query:string} }): Promise<Metadata> {
		return this.orm.metadata(body.query)
	}

	public async model ({ body }: { body: {query:string} }): Promise<MetadataModel[]> {
		return this.orm.model(body.query)
	}

	public async parameters ({ body }: { body: {query:string} }): Promise<MetadataParameter[]> {
		return this.orm.parameters(body.query)
	}

	public async plan ({ body }: { body: {query:string, options?:QueryOptions} }): Promise<QueryPlan> {
		return this.orm.plan(body.query, body.options)
	}

	public async execute ({ body }: { body: {query:string, data:any, options?:QueryOptions} }): Promise<any> {
		return this.orm.execute(body.query, body.data, body.options)
	}

	/** Several queries in one transaction: a 3xpr script calling orm.execute (orm.executeScript) */
	public async script ({ body }: { body: {script:string, data?:any, options?:QueryOptions} }): Promise<any> {
		if (!this.scripts.enabled) {
			throw httpError(403, 'ScriptDisabledError', 'scripts are disabled in this service (SCRIPT_ENABLED)')
		}
		const script = body ? body.script : undefined
		if (typeof script !== 'string' || script.trim() === '') {
			throw httpError(400, 'ScriptError', 'script is required')
		}
		if (script.length > this.scripts.maxLength) {
			throw httpError(413, 'ScriptTooLongError', `script longer than ${this.scripts.maxLength} characters (SCRIPT_MAX_LENGTH)`)
		}
		const result = await this.orm.executeScript(script, body.data, body.options, { timeout: this.scripts.timeoutMs, maxIterations: this.scripts.maxIterations })
		// a script that ends without a value answers null (not 204): the client always gets a body
		return result === undefined ? null : result
	}
}
