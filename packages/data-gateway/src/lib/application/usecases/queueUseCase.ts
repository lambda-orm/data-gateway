import { GatewayError } from '../../domain/errors/gatewayError'
import { authorize } from '../../domain/auth/authorizationPolicy'
import { badRequest, unavailable } from '../../domain/errors/gatewayError'
import { QueuedRequest, RequestContext } from '../ports/input/dataGatewayPort'
import { QueueEventsPort, QueuePort } from '../ports/output/supportPorts'
import { Auditor } from './auditor'
import { requestOptions } from './requestOptions'
import { QueryUseCases, requireQuery } from './queryUseCases'

/** Runs a query in the background and sends its result to a topic. Needs `queue`, and `write` when the query writes. */
export class QueueUseCase {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly queue: QueuePort | undefined,
		private readonly queries: QueryUseCases,
		private readonly auditor: Auditor,
		private readonly events?: QueueEventsPort
	) {}

	public async execute (ctx: RequestContext, request: QueuedRequest): Promise<{ queueId: string }> {
		const query = requireQuery(request.query)
		const classification = await this.queries.classify(query, ctx)
		authorize(ctx.principal, 'executeQueued', classification.writes)
		if (classification.writes && this.queries.needsApproval(ctx)) {
			throw new GatewayError(403, 'ApprovalRequiredError', 'this write waits for a person to approve it: a queued execution can\'t wait, use execute (docs/MUTATION_APPROVAL.md)')
		}
		if (!this.queue || !this.queue.available) {
			throw unavailable('QueueUnavailableError', 'this schema has no queue (infrastructure.queue)')
		}
		if (typeof request.topic !== 'string' || request.topic.trim() === '') {
			throw badRequest('QueueError', 'topic is required')
		}
		const queue = this.queue
		return this.auditor.track(ctx, {
			operation: 'executeQueued',
			actions: classification.actions,
			entities: classification.entities,
			query,
			data: request.data
		}, async () => ({
			queueId: queue.execute({
				topic: request.topic,
				query,
				data: request.data,
				chunk: request.chunk,
				options: requestOptions(request.options, ctx, this.queries.viewOf(ctx)),
				onDone: outcome => this.events?.completed(outcome)
			})
		}))
	}
}
