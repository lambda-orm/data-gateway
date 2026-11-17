import { IOrm } from '@lambdaorm/lib'
import { Kafka, Partitioners, Consumer, Message } from 'kafkajs'
import { v4 as uuidv4 } from 'uuid'
import { h3lp } from 'h3lp'
import { LoggerPort, QueueExecuteArgs, QueuePort } from '../../../application/ports/output/supportPorts'

export interface ConsumerInfo {
	config: any
	subscribe: any
	execute: string
}

/** infrastructure.queue of lambdaORM.yaml */
export interface QueuedInfo {
	config: any
	consumers?: ConsumerInfo[]
}

/**
 * Kafka (https://kafka.js.org/docs/configuration): background executions of a schema, its consumers (an expression
 * run for every message) and the queue.send(topic, messages) function of the expressions.
 */
export class KafkaQueueAdapter implements QueuePort {
	private kafka: Kafka | null = null
	private consumers: Consumer[] = []

	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly orm: IOrm, private readonly logger: LoggerPort) {}

	public get available (): boolean {
		return this.kafka !== null
	}

	public async start (queuedInfo: QueuedInfo): Promise<void> {
		if (h3lp.val.isEmpty(queuedInfo)) throw new Error('queuedInfo undefined')
		if (h3lp.val.isEmpty(queuedInfo.config)) throw new Error('queuedInfo.config undefined')
		this.kafka = new Kafka(queuedInfo.config)
		this.orm.exp.addFunction('queue.send(topic:string,messages:any[]):void', async (topic: string, messages: any[]) => {
			return this.send(topic, messages)
		}, { async: true, description: 'Send messages to a queue' })
		if (queuedInfo.consumers) {
			Promise.all(queuedInfo.consumers.map(consumer => this.createConsumer(consumer)))
				.then(instances => { this.consumers = instances })
				.catch(error => this.logger.error(error))
		}
		this.logger.info('kafka started')
	}

	public async stop (): Promise<void> {
		await Promise.all(this.consumers.map(consumer => consumer.disconnect().catch(() => undefined)))
		this.consumers = []
		this.kafka = null
		this.logger.info('kafka stopped')
	}

	private async createConsumer (consumerInfo: ConsumerInfo): Promise<Consumer> {
		if (!this.kafka) throw new Error('kafka undefined')
		const consumer = this.kafka.consumer(consumerInfo.config)
		await consumer.connect()
		await consumer.subscribe(consumerInfo.subscribe)
		await consumer.run({
			eachMessage: async ({ topic, partition, message }) => {
				try {
					const value = message.value instanceof Buffer ? message.value.toString() : message.value || ''
					await this.orm.exp.evalAsync(consumerInfo.execute, { message: JSON.parse(value.toString()), topic, partition })
				} catch (error: any) {
					this.logger.error(error)
				}
			}
		})
		return consumer
	}

	public execute (args: QueueExecuteArgs): string {
		if (!this.kafka) throw new Error('kafka undefined')
		const queueId = uuidv4()
		this.executeInBackground(queueId, args).catch(error => this.logger.error(error))
		return queueId
	}

	public async send (topic: string, messages: any[]): Promise<void> {
		if (!this.kafka) throw new Error('kafka undefined')
		try {
			const producer = this.kafka.producer({ allowAutoTopicCreation: true, createPartitioner: Partitioners.DefaultPartitioner })
			await producer.connect()
			await producer.send({ topic, messages: messages.map(message => ({ value: JSON.stringify(message) })) })
			await producer.disconnect()
		} catch (error: any) {
			this.logger.error(error)
		}
	}

	private async executeInBackground (queueId: string, args: QueueExecuteArgs): Promise<void> {
		try {
			const result = await this.orm.execute(args.query, args.data, args.options)
			const headers: any = {}
			const optionHeaders = (args.options as any)?.headers
			if (optionHeaders !== undefined) {
				for (const [key, value] of Object.entries(optionHeaders)) headers[key] = JSON.stringify(value)
			}
			const rows = Array.isArray(result) ? result : [result]
			const chunks = h3lp.array.chunks(rows, args.chunk || rows.length || 1)
			const messages: Message[] = chunks.map((chunk: any, i: number) => ({
				key: `${queueId}-${i}`,
				value: JSON.stringify(chunk),
				headers: { ...headers, chunkNro: i.toString() }
			}))
			if (this.kafka === null) throw new Error('kafka undefined')
			const producer = this.kafka.producer({ allowAutoTopicCreation: true, createPartitioner: Partitioners.DefaultPartitioner })
			await producer.connect()
			await producer.send({ topic: args.topic, messages })
			await producer.disconnect()
		} catch (error: any) {
			this.logger.info(`executed.queued: ${queueId} error: ${error?.message || 'undefined'}`)
		}
	}
}
