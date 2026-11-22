import express from 'express'
import { AdminService } from '../../../application/admin/adminService'
import { CommandService } from '../../../application/admin/commandService'
import { Principal } from '../../../domain/auth/principal'
import { toHttpError } from './httpErrors'
import { zipOf } from '../../shared/zip'
import { notFound } from '../../../domain/errors/gatewayError'
import { SchemaDirectoryPort } from '../../../application/ports/input/schemaDirectoryPort'

/** A route in a URL path segment: iot%2Fv1, and ~ for the schema at the root */
export const schemaParam = (raw: string | string[]): string => { const value = Array.isArray(raw) ? raw.join("/") : raw; return value === "~" ? "" : value }

/**
 * The administration of the workspaces over REST (docs/DATA_GATEWAY_ADMIN_PLAN.md §2.2), under {basePath}/admin, with
 * the authentication of the http transport. A workspace is named by its route, encoded in one segment (iot%2Fv1; ~ is
 * the root). Every read answers its version (ETag), every write says the one it changes (If-Match).
 */
export const adminRouter = (admin: AdminService, authenticate: express.RequestHandler, commands?: CommandService, directory?: SchemaDirectoryPort): express.Router => {
	const router = express.Router()
	router.use(authenticate)
	const principal = (res: express.Response) => res.locals.principal as Principal
	const handle = (action: (req: express.Request, res: express.Response) => Promise<unknown>) =>
		async (req: express.Request, res: express.Response) => {
			try {
				const result = await action(req, res)
				const created = req.method === 'POST' && (req.path === '/workspaces' || ((result as any)?.status === 'running' && /\/commands\/[a-z]+$/.test(req.path)))
				if (!res.headersSent) res.status(created ? (req.path === '/workspaces' ? 201 : 202) : 200).json(result)
			} catch (error: any) {
				const httpError = toHttpError(error)
				res.status(httpError.status).json(httpError.body)
			}
		}

	// what this credential may do here: the UI shows the actions with it
	router.get('/', handle(async (_req, res) => ({ enabled: true, can: admin.can(principal(res)) })))
	router.get('/workspaces', handle(async (_req, res) => admin.workspaces(principal(res))))
	router.post('/workspaces', handle(async (req, res) => admin.create(principal(res), req.body ?? {})))
	router.delete('/workspaces/:schema', handle(async (req, res) => admin.remove(principal(res), schemaParam(req.params.schema), req.query.confirm)))
	router.get('/workspaces/:schema/schema', handle(async (req, res) => {
		const file = await admin.readSchema(principal(res), schemaParam(req.params.schema))
		res.setHeader('ETag', `"${file.version}"`)
		return file
	}))
	router.put('/workspaces/:schema/schema', handle(async (req, res) => {
		const ifMatch = (req.header('if-match') ?? '').replace(/^W\//, '').replace(/^"|"$/g, '') || req.body?.version
		const result = await admin.writeSchema(principal(res), schemaParam(req.params.schema), req.body?.text, ifMatch)
		res.setHeader('ETag', `"${result.version}"`)
		return result
	}))
	router.patch('/workspaces/:schema/schema', handle(async (req, res) => {
		const result = await admin.patchSchema(principal(res), schemaParam(req.params.schema), req.body ?? {})
		res.setHeader('ETag', `"${result.version}"`)
		return result
	}))
	router.post('/workspaces/:schema/references', handle(async (req, res) => admin.references(principal(res), schemaParam(req.params.schema), req.body?.at)))
	// the domain as the schema serves it (extends and relations completed), through the worker
	const domainOf = async (req: express.Request, res: express.Response) => {
		const served = directory?.schemas().find(s => s.path === schemaParam(req.params.schema))
		if (!served) throw notFound(`no schema "${schemaParam(req.params.schema)}"`)
		return served.gateway.domain({ principal: principal(res), transport: 'admin' })
	}
	router.post('/workspaces/:schema/build', handle(async (req, res) => {
		const result = await admin.build(principal(res), schemaParam(req.params.schema), req.body ?? {}, await domainOf(req, res))
		return { language: result.language, files: result.files.map(f => ({ path: f.path, written: f.written, bytes: Buffer.byteLength(f.content) })) }
	}))
	router.get('/workspaces/:schema/build.zip', handle(async (req, res) => {
		const result = await admin.build(principal(res), schemaParam(req.params.schema), { language: req.query.language ?? 'node' }, await domainOf(req, res))
		res.status(200).type('application/zip').setHeader('Content-Disposition', `attachment; filename="${(schemaParam(req.params.schema) || 'root').replace(/\//g, '_')}-${result.language}.zip"`)
		res.send(zipOf(result.files.map(f => ({ path: f.path, content: f.content }))))
		return undefined
	}))
	router.get('/workspaces/:schema/files', handle(async (req, res) => admin.files(principal(res), schemaParam(req.params.schema), req.query.dir)))
	router.get('/workspaces/:schema/files/content', handle(async (req, res) => admin.fileContent(principal(res), schemaParam(req.params.schema), req.query.path)))
	router.get('/workspaces/:schema/variables', handle(async (req, res) => admin.variables(principal(res), schemaParam(req.params.schema))))
	router.put('/workspaces/:schema/variables', handle(async (req, res) => admin.setVariables(principal(res), schemaParam(req.params.schema), req.body ?? {})))
	router.post('/validate', handle(async (req, res) => admin.validate(principal(res), req.body?.text)))
	router.get('/workbench', handle(async (req, res) => {
		const schema = typeof req.query.schema === 'string' ? schemaParam(req.query.schema) : undefined
		const result = await admin.workbench(principal(res), schema)
		const etag = `"${result.version}"`
		res.setHeader('ETag', etag)
		if (req.header('if-none-match') === etag) {
			res.status(304).end()
			return undefined
		}
		return result
	}))
	router.put('/workbench', handle(async (req, res) => admin.putItems(principal(res), req.body ?? {})))
	router.post('/workbench/remove', handle(async (req, res) => admin.removeItems(principal(res), req.body ?? {})))
	if (commands) {
		// the commands of a workspace (§4): their panel, the preview of the ones that change the databases, the jobs
		router.get('/workspaces/:schema/commands', handle(async (req, res) => commands.summary(principal(res), schemaParam(req.params.schema))))
		router.post('/workspaces/:schema/commands/:command/preview', handle(async (req, res) => commands.preview(principal(res), schemaParam(req.params.schema), String(req.params.command), req.body ?? {})))
		router.post('/workspaces/:schema/commands/:command', handle(async (req, res) => commands.run(principal(res), schemaParam(req.params.schema), String(req.params.command), req.body ?? {})))
		router.get('/workspaces/:schema/jobs', handle(async (req, res) => commands.jobsOf(principal(res), schemaParam(req.params.schema))))
		router.get('/workspaces/:schema/jobs/:id', handle(async (req, res) => commands.job(principal(res), schemaParam(req.params.schema), String(req.params.id))))
	}
	return router
}
