import express from 'express'
import { AdminService } from '../../../application/admin/adminService'
import { Principal } from '../../../domain/auth/principal'
import { toHttpError } from './httpErrors'

/** A route in a URL path segment: iot%2Fv1, and ~ for the schema at the root */
export const schemaParam = (raw: string | string[]): string => { const value = Array.isArray(raw) ? raw.join("/") : raw; return value === "~" ? "" : value }

/**
 * The administration of the workspaces over REST (docs/DATA_GATEWAY_ADMIN_PLAN.md §2.2), under {basePath}/admin, with
 * the authentication of the http transport. A workspace is named by its route, encoded in one segment (iot%2Fv1; ~ is
 * the root). Every read answers its version (ETag), every write says the one it changes (If-Match).
 */
export const adminRouter = (admin: AdminService, authenticate: express.RequestHandler): express.Router => {
	const router = express.Router()
	router.use(authenticate)
	const principal = (res: express.Response) => res.locals.principal as Principal
	const handle = (action: (req: express.Request, res: express.Response) => Promise<unknown>) =>
		async (req: express.Request, res: express.Response) => {
			try {
				const result = await action(req, res)
				if (!res.headersSent) res.status(req.method === 'POST' && req.path === '/workspaces' ? 201 : 200).json(result)
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
	return router
}
