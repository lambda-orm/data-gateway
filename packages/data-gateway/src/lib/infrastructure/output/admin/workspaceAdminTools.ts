import fs from 'fs'
import { AdminToolsPort } from '../../../application/mcp/adminTools'
import { RequestContext } from '../../../application/ports/input/dataGatewayPort'
import { CommandUseCases } from '../../../application/usecases/commandUseCases'
import { versionOf } from './fileWorkspaceStore'
import { LambdaSchemaValidator } from './lambdaSchemaValidator'

/** The administration tools of a schema, in its worker: its lambdaORM.yaml, the validator, fetch with its λORM */
export const workspaceAdminTools = (schemaFile: string, commands: CommandUseCases): AdminToolsPort => {
	const validator = new LambdaSchemaValidator()
	return {
		readSchema: async () => {
			const text = await fs.promises.readFile(schemaFile, 'utf8')
			return { text, version: versionOf(text) }
		},
		validate: text => validator.validate(text),
		fetch: (ctx: RequestContext, stage?: string) => commands.run(ctx, 'fetch', [stage])
	}
}
