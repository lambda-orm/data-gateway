import { authorize, Operation } from '../../domain/auth/authorizationPolicy'
import { badRequest } from '../../domain/errors/gatewayError'
import { CommandOperation } from '../../domain/runtime/channelProtocol'
import { RequestContext } from '../ports/input/dataGatewayPort'
import { OrmCommandPort } from '../ports/output/ormPorts'
import { Auditor } from './auditor'

const OPERATIONS: Record<CommandOperation, Operation> = {
	stages: 'schema',
	fetch: 'stageFetch',
	pushSentences: 'stageFetch',
	push: 'stagePush',
	dropSentences: 'stageFetch',
	drop: 'stageDrop',
	export: 'stageExport',
	import: 'stageImport'
}

/**
 * The commands of a workspace in its schema worker (docs/DATA_GATEWAY_ADMIN_PLAN.md §4): authorized again here (the
 * edge already did), audited when they change the databases. The stage is the first one when none is given.
 */
export class CommandUseCases {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly orm: OrmCommandPort, private readonly auditor: Auditor) {}

	private stageOf (stage: unknown): string {
		const names = this.orm.stageNames()
		if (stage === undefined || stage === null || stage === '') {
			if (!names.length) throw badRequest('ValidationError', 'the schema has no stages')
			return names[0]
		}
		if (typeof stage !== 'string' || !names.includes(stage)) throw badRequest('ValidationError', `unknown stage "${String(stage)}" (${names.join(', ')})`)
		return stage
	}

	public async run (ctx: RequestContext, op: CommandOperation, args: unknown[]): Promise<unknown> {
		authorize(ctx.principal, OPERATIONS[op])
		if (op === 'stages') return this.orm.stageNames()
		const stage = this.stageOf(args[0])
		const force = args[1] === true
		switch (op) {
		case 'fetch': return this.orm.fetch(stage)
		case 'pushSentences': return this.orm.pushSentences(stage)
		case 'dropSentences': return this.orm.dropSentences(stage)
		case 'export': return this.orm.export(stage)
		case 'push': return this.auditor.track(ctx, { operation: 'stagePush', stage }, () => this.orm.push(stage, force))
		case 'drop': return this.auditor.track(ctx, { operation: 'stageDrop', stage }, () => this.orm.drop(stage, force))
		case 'import': return this.auditor.track(ctx, { operation: 'stageImport', stage, data: args[1] }, () => this.orm.import(stage, args[1]))
		}
	}
}
