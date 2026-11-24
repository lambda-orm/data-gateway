import { AdminApiPort, AdminCapabilities, CommandName, CommandPreview, CommandsSummary, ExpressionCheck, ExpressionLanguage, Job, SchemaIssue, SchemaPatch, SchemaVariable, StageRouting, WorkbenchProblem, CodeParts } from '../application/ports'
import { SavedItem } from '../domain/savedItems'
import { GatewayRequestError, HeadersProvider } from './restQueryApi'

/** A route as one segment of a URL: iot%2Fv1, and ~ for the schema at the root */
export const schemaSegment = (schema: string): string => schema === '' ? '~' : encodeURIComponent(schema)

/** The administration of a gateway over REST ({baseUrl}/admin) */
/** only what is left out is sent: the gateway generates both by default */
const partsOf = (parts: CodeParts): Record<string, boolean> => ({ ...(parts.model === false ? { model: false } : {}), ...(parts.repositories === false ? { repositories: false } : {}) })

export class RestAdminApi implements AdminApiPort {
	private readonly baseUrl: string

	constructor (baseUrl: string, private readonly headers: HeadersProvider = () => ({}), private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {
		this.baseUrl = baseUrl.replace(/\/+$/, '')
	}

	private async request (path: string, init: { method?: string, body?: unknown, headers?: Record<string, string> } = {}): Promise<{ status: number, body: any }> {
		const headers: Record<string, string> = { ...(await this.headers()), ...init.headers }
		if (init.body !== undefined) headers['content-type'] = 'application/json'
		const response = await this.fetcher(`${this.baseUrl}/admin${path}`, {
			method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
			headers,
			body: init.body !== undefined ? JSON.stringify(init.body) : undefined
		})
		if (response.status === 304) return { status: 304, body: undefined }
		const text = await response.text()
		let body: any
		try { body = text ? JSON.parse(text) : undefined } catch { body = undefined }
		if (!response.ok) throw new GatewayRequestError(response.status, body?.error ?? `HTTP ${response.status}`, body?.message ?? (text || response.statusText), body?.code, body?.suggestions, body?.details)
		return { status: response.status, body }
	}

	public async capabilities (): Promise<AdminCapabilities | undefined> {
		try {
			return (await this.request('')).body?.can
		} catch (error: any) {
			// no administration on this gateway (admin off: the route doesn't exist), or no credential for it
			if ([401, 403, 404].includes(error?.status)) return undefined
			throw error
		}
	}

	public async readSchema (schema: string) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/schema`)).body as { text: string, version: string }
	}

	public async writeSchema (schema: string, text: string, version: string) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/schema`, { method: 'PUT', body: { text }, headers: { 'If-Match': `"${version}"` } })).body as { version: string, issues: SchemaIssue[] }
	}

	public async patchSchema (schema: string, patch: SchemaPatch) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/schema`, { method: 'PATCH', body: patch })).body as { version: string, references: string[], added: number, removed: number }
	}

	public async variables (schema: string) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/variables`)).body as { variables: SchemaVariable[] }
	}

	public async setVariables (schema: string, change: { set?: Record<string, string>, remove?: string[] }) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/variables`, { method: 'PUT', body: change })).body as { variables: SchemaVariable[] }
	}

	public async build (schema: string, language: 'node' | 'client-node', parts: CodeParts = {}) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/build`, { body: { language, write: true, ...partsOf(parts) } })).body as { language: string, files: { path: string, written?: string, bytes: number }[] }
	}

	public async removeCode (schema: string, dir: string) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/files?dir=${encodeURIComponent(dir)}`, { method: 'DELETE' })).body as { removed: string }
	}

	public async folderZip (schema: string, dir: string) {
		return await this.blob(`${this.baseUrl}/admin/workspaces/${schemaSegment(schema)}/files.zip?dir=${encodeURIComponent(dir)}`)
	}

	public async buildZip (schema: string, language: 'node' | 'client-node', parts: CodeParts = {}) {
		const only = Object.entries(partsOf(parts)).map(([k, v]) => `&${k}=${v}`).join('')
		return await this.blob(`${this.baseUrl}/admin/workspaces/${schemaSegment(schema)}/build.zip?language=${language}${only}`)
	}

	/** a file to download (a zip): the error of the gateway when it isn't one */
	private async blob (url: string) {
		const response = await this.fetcher(url, { headers: { ...(await this.headers()) } })
		if (!response.ok) {
			let body: any
			try { body = await response.json() } catch { body = undefined }
			throw new GatewayRequestError(response.status, body?.error ?? `HTTP ${response.status}`, body?.message ?? response.statusText)
		}
		return await response.blob()
	}

	public async files (schema: string, dir?: string) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/files${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`)).body as { roots: { data: string, src: string, model: string }, files: { path: string, dir: boolean, modified: string }[] }
	}

	public async fileContent (schema: string, path: string) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/files/content?path=${encodeURIComponent(path)}`)).body as { path: string, text: string, version: string }
	}

	public async references (schema: string, at: string[]) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/references`, { body: { at } })).body as { references: string[] }
	}

	public async validate (text: string) {
		return (await this.request('/validate', { body: { text } })).body as { valid: boolean, issues: SchemaIssue[] }
	}

	public async expressionLanguage () {
		return (await this.request('/expressions')).body as ExpressionLanguage
	}

	public async checkExpression (expression: string, context = 'stageSource') {
		return (await this.request('/expressions/check', { body: { expression, context } })).body as ExpressionCheck
	}

	public async stageRouting (schema: string, stage: string) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/stages/${encodeURIComponent(stage)}/routing`)).body as StageRouting
	}

	public async createWorkspace (path: string, copyOf?: string, about: { name?: string, description?: string } = {}) {
		return (await this.request('/workspaces', { body: { path, ...(copyOf ? { copyOf } : {}), ...(about.name ? { name: about.name } : {}), ...(about.description ? { description: about.description } : {}) } })).body as { path: string, version: string }
	}

	public async removeWorkspace (path: string) {
		return (await this.request(`/workspaces/${schemaSegment(path)}?confirm=${encodeURIComponent(path)}`, { method: 'DELETE' })).body as { trash: string }
	}

	public async workbench (version?: string) {
		const answer = await this.request('/workbench', { headers: version ? { 'If-None-Match': `"${version}"` } : {} })
		return answer.status === 304 ? undefined : answer.body as { version: string, items: (SavedItem & { version?: string })[], problems?: WorkbenchProblem[] }
	}

	public async putItems (items: (SavedItem & { version?: string })[]) {
		return (await this.request('/workbench', { method: 'PUT', body: { items } })).body as { items: { id: string, version: string }[] }
	}

	public async removeItems (ids: string[]) {
		return (await this.request('/workbench/remove', { body: { ids } })).body as { removed: string[] }
	}

	public async commands (schema: string) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/commands`)).body as CommandsSummary
	}

	public async previewCommand (schema: string, command: CommandName, body: { stage?: string, data?: unknown, name?: string }) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/commands/${command}/preview`, { body })).body as CommandPreview
	}

	public async runCommand (schema: string, command: CommandName, body: { stage?: string, previewId?: string, force?: boolean, save?: boolean }) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/commands/${command}`, { body })).body as Job | Record<string, unknown>
	}

	public async jobs (schema: string) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/jobs`)).body as Job[]
	}

	public async job (schema: string, id: string) {
		return (await this.request(`/workspaces/${schemaSegment(schema)}/jobs/${encodeURIComponent(id)}`)).body as Job
	}
}
