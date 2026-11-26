import { ApprovalGate } from '../approval/approvals'
import { ScriptOptions } from '@lambdaorm/base'
import { authorize } from '../../domain/auth/authorizationPolicy'
import { GatewayError, badRequest } from '../../domain/errors/gatewayError'
import { RequestContext, ScriptRequest } from '../ports/input/dataGatewayPort'
import { OrmScriptPort } from '../ports/output/ormPorts'
import { Auditor } from './auditor'
import { requestOptions } from './requestOptions'
import { NO_VIEWS, ViewResolver } from './viewResolver'

export interface ScriptSettings {
	enabled: boolean
	maxLength: number
	timeoutMs: number
	maxIterations: number
}

/** The lower of a client's value and the gateway's limit: a client may lower a limit, never raise it. */
const lower = (requested: unknown, limit: number): number => {
	const value = Number(requested)
	return requested !== undefined && requested !== null && value > 0 && value < limit ? value : limit
}

/** Several queries in one transaction: a 3xpr script calling orm.execute (orm.executeScript). Always audited. */
export class ScriptUseCase {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly orm: OrmScriptPort, private readonly settings: ScriptSettings, private readonly auditor: Auditor, private readonly views: ViewResolver = NO_VIEWS, private readonly approvals?: ApprovalGate) {}

	public async execute (ctx: RequestContext, request: ScriptRequest): Promise<any> {
		authorize(ctx.principal, 'executeScript')
		if (!this.settings.enabled) {
			throw new GatewayError(403, 'ScriptDisabledError', 'scripts are disabled in this gateway (scripts.enabled)')
		}
		const script = request ? request.script : undefined
		if (typeof script !== 'string' || script.trim() === '') {
			throw badRequest('ScriptError', 'script is required')
		}
		if (script.length > this.settings.maxLength) {
			throw new GatewayError(413, 'ScriptTooLongError', `script longer than ${this.settings.maxLength} characters (scripts.maxLength)`)
		}
		// a script may write and it can't be known before: with approvals, it always waits (docs/MUTATION_APPROVAL.md §3)
		if (this.approvals?.needs(ctx)) return this.approvals.request(ctx, 'executeScript', script, request.data, request.options as Record<string, unknown> | undefined)
		// the script and its orm.execute run in the view of who calls (λORM: they inherit it)
		const options: ScriptOptions = requestOptions(request.options, ctx, this.views.of(ctx.principal))
		options.timeout = lower(options.timeout, this.settings.timeoutMs)
		options.maxIterations = lower(options.maxIterations, this.settings.maxIterations)
		return this.auditor.track(ctx, { operation: 'executeScript', query: script, data: request.data }, async () => {
			const result = await this.orm.executeScript(script, request.data, options)
			// a script that ends without a value answers null (not 204): the client always gets a body
			return result === undefined ? null : result
		})
	}
}
