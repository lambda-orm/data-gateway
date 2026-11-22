import { AdminApiPort, AdminCapabilities, CommandName, CommandPreview, CommandsSummary, Job, SchemaIssue, WorkbenchProblem } from '../application/ports'
import { SavedItem } from '../domain/savedItems'
import { GatewayRequestError, HeadersProvider } from './restQueryApi'

/** A route as one segment of a URL: iot%2Fv1, and ~ for the schema at the root */
export const schemaSegment = (schema: string): string => schema === '' ? '~' : encodeURIComponent(schema)

/** The administration of a gateway over REST ({baseUrl}/admin) */
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

	public async validate (text: string) {
		return (await this.request('/validate', { body: { text } })).body as { valid: boolean, issues: SchemaIssue[] }
	}

	public async createWorkspace (path: string, copyOf?: string) {
		return (await this.request('/workspaces', { body: copyOf ? { path, copyOf } : { path } })).body as { path: string, version: string }
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
