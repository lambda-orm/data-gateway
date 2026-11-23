import { Principal } from '../../domain/auth/principal'
import { forbidden } from '../../domain/errors/gatewayError'
import { ToolDefinition } from '../../domain/mcp/mcpTypes'
import { RequestContext } from '../ports/input/dataGatewayPort'
import { SchemaIssue } from '../ports/output/adminPorts'
import { Tool } from './tool'

/** What the administration tools read in the worker of a schema: its file, a validation, the drift of a stage */
export interface AdminToolsPort {
	readSchema (): Promise<{ text: string, version: string }>
	validate (text: string): Promise<SchemaIssue[]>
	fetch (ctx: RequestContext, stage?: string): Promise<unknown>
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

const requireSchemaRead = (principal: Principal) => {
	if (!principal.permissions.has('schemaRead')) throw forbidden(principal.name, 'schemaRead')
}

/** A tool of the administration: only for credentials with schemaRead, and only reading (docs/DATA_GATEWAY_ADMIN_PLAN.md §8, phase 6) */
class AdminTool implements Tool {
	public readonly returnsRows = false
	// eslint-disable-next-line no-useless-constructor
	constructor (
		public readonly name: string,
		private readonly title: string,
		private readonly description: string,
		private readonly properties: Record<string, any>,
		private readonly required: string[],
		private readonly run: (ctx: RequestContext, args: Record<string, any>) => Promise<unknown>
	) {}

	public visibleTo (principal: Principal): boolean {
		return principal.permissions.has('schemaRead')
	}

	public definition (): ToolDefinition {
		return {
			name: this.name,
			title: this.title,
			description: this.description,
			inputSchema: { type: 'object', properties: this.properties, required: this.required, additionalProperties: false },
			annotations: { title: this.title, ...READ_ONLY }
		}
	}

	public execute (ctx: RequestContext, args: Record<string, unknown>): Promise<unknown> {
		requireSchemaRead(ctx.principal)
		return this.run(ctx, args)
	}
}

/**
 * The administration over MCP, read only: an agent reads the lambdaORM.yaml, checks a change before proposing it and
 * sees whether the databases are in step with the model. Writing (the schema, push, drop…) is not offered over MCP: a
 * model would run it without the preview and the confirmation of the UI.
 */
export const adminTools = (port: AdminToolsPort): Tool[] => [
	new AdminTool('admin_schema_get', 'Read lambdaORM.yaml',
		'The lambdaORM.yaml of this schema as written (with its comments; connections as ${VARIABLES}, never their values) and its version.',
		{}, [], () => port.readSchema()),
	new AdminTool('admin_schema_validate', 'Validate lambdaORM.yaml',
		'Checks a lambdaORM.yaml without saving it: YAML errors at their line, the shape, names repeated in a list, types λORM doesn\'t know (warnings) and λORM completing the schema. Nothing of the schema runs.',
		{ text: { type: 'string', minLength: 1, description: 'The whole lambdaORM.yaml' } }, ['text'],
		async (_ctx, args) => {
			const issues = await port.validate(String(args.text))
			return { valid: !issues.some(i => i.severity === 'error'), issues }
		}),
	new AdminTool('admin_stage_fetch', 'Compare databases and model',
		'The differences between the databases of a stage and the model (fetch): per mapping, the entities whose tables differ; none when they are in step.',
		{ stage: { type: 'string', description: 'The stage; without it, the first one' } }, [],
		(ctx, args) => port.fetch(ctx, typeof args.stage === 'string' ? args.stage : undefined))
]
