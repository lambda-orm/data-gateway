import { InfrastructureSchema, Schema } from '@lambdaorm/lib'
import { QueuedInfo } from './queuedInfo'

export interface ServiceConfig {
	port?: number
	host?: string
	requestBodySize?: string
	rateLimitWindowMs?: string
	rateLimitMax?: string
	/** POST /script: off unless true (SCRIPT_ENABLED). A script runs several queries in one transaction */
	scriptEnabled?: boolean | string
	/** Max length of a script in characters (SCRIPT_MAX_LENGTH, default 20000) */
	scriptMaxLength?: number | string
	/** Max time of a script in ms; then it rolls back (SCRIPT_TIMEOUT_MS, default 30000) */
	scriptTimeoutMs?: number | string
	/** When set (SERVICE_TOKEN), requests need "Authorization: Bearer <token>"; /ping, /health and /metrics don't */
	token?: string
}

export interface ServiceInfrastructureSchema extends InfrastructureSchema {
	service: ServiceConfig
	queue: QueuedInfo
}

export interface ServiceSchema extends Schema {
	infrastructure: ServiceInfrastructureSchema
}
