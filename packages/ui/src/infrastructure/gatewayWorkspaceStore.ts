import { AdminApiPort, WorkbenchProblem, WorkspaceStore } from '../application/ports'
import { SavedItem } from '../domain/savedItems'

/**
 * What is saved, in the workspaces of the gateway (workbench/, docs/DATA_GATEWAY.md §11.1) instead of the browser:
 * shared by everyone with access to the schema, one file per item. It remembers the version of each item it read and
 * sends it with each change: an item someone else changed meanwhile is refused (412) and read again.
 */
export class GatewayWorkspaceStore implements WorkspaceStore {
	private versions = new Map<string, string>()
	private seen: string | undefined
	/** the files of workbench/ that are not items, as of the last read */
	public problems: WorkbenchProblem[] = []

	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly admin: AdminApiPort) {}

	public async all (): Promise<SavedItem[]> {
		const answer = await this.admin.workbench()
		if (!answer) return []
		this.seen = answer.version
		this.problems = answer.problems ?? []
		this.versions = new Map(answer.items.filter(i => i.version).map(i => [i.id, i.version!]))
		return answer.items.map(item => { const copy: Record<string, unknown> = { ...item }; delete copy.version; return copy as unknown as SavedItem })
	}

	/** Whether what is saved changed on the gateway since it was read (someone else saved, or a file changed) */
	public async changed (): Promise<boolean> {
		return (await this.admin.workbench(this.seen)) !== undefined
	}

	public async put (items: SavedItem[]): Promise<void> {
		try {
			const answer = await this.admin.putItems(items.map(item => ({ ...item, version: this.versions.get(item.id) })))
			for (const { id, version } of answer.items) this.versions.set(id, version)
			this.seen = undefined
		} catch (error: any) {
			if (error?.status === 412) throw Object.assign(new Error(`someone else changed it meanwhile: it is read again (${error.message})`), { name: 'ConflictError', status: 412 })
			throw error
		}
	}

	public async remove (ids: string[]): Promise<void> {
		await this.admin.removeItems(ids)
		for (const id of ids) this.versions.delete(id)
		this.seen = undefined
	}

	/** Everything at once is not removed from a shared workspace: an import adds to it */
	public async clear (): Promise<void> {
		throw Object.assign(new Error('what is saved in the workspaces is shared: an import adds to it, it does not replace it'), { name: 'WorkspaceError' })
	}

	/** In the volume of the gateway */
	public async durable (): Promise<boolean> {
		return true
	}
}
