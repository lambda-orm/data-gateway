import { canMove, nameProblem, NameProblem, newId, parseExport, SavedDiagram, SavedFolder, SavedItem, SavedQuery, SavedQueryContent, subtreeOf, toExport } from '../domain/savedItems'
import { WorkspaceStore } from './ports'

export interface WorkspaceState {
	items: SavedItem[]
	loaded: boolean
	/** False when the browser doesn't let it store: what is saved lasts until the page is closed */
	durable: boolean
	error?: string
}

export interface NewItem {
	schema: string
	parentId?: string
	name: string
	description?: string
}

/** A name that can't be used, or a store that failed */
export class WorkspaceError extends Error {
	constructor (public readonly problem: NameProblem | 'invalidFile' | 'cannotMove' | 'notFound', message = problem) { super(message); this.name = 'WorkspaceError' }
}

/**
 * The saved folders, queries and diagrams, without React (the explorer subscribes to it): every change goes to the
 * store and then to the state. Names are required and not repeated in a folder; a folder goes with what it holds.
 */
export class WorkspaceController {
	private state: WorkspaceState = { items: [], loaded: false, durable: true }
	private readonly listeners = new Set<() => void>()

	constructor (private readonly store: WorkspaceStore, private readonly clock: () => Date = () => new Date()) {}

	public getState = (): WorkspaceState => this.state

	public subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener)
		return () => { this.listeners.delete(listener) }
	}

	private set (patch: Partial<WorkspaceState>): void {
		this.state = { ...this.state, ...patch }
		for (const listener of this.listeners) listener()
	}

	public async load (): Promise<void> {
		try {
			const [items, durable] = await Promise.all([this.store.all(), this.store.durable()])
			this.set({ items, durable, loaded: true, error: undefined })
		} catch (error: any) {
			this.set({ loaded: true, error: error?.message ?? String(error) })
		}
	}

	private check (candidate: Parameters<typeof nameProblem>[1]): void {
		const problem = nameProblem(this.state.items, candidate)
		if (problem) throw new WorkspaceError(problem)
	}

	private async save (items: SavedItem[]): Promise<void> {
		await this.store.put(items)
		const ids = new Set(items.map(i => i.id))
		this.set({ items: [...this.state.items.filter(i => !ids.has(i.id)), ...items] })
	}

	private stamp (): { createdAt: string, updatedAt: string } {
		const now = this.clock().toISOString()
		return { createdAt: now, updatedAt: now }
	}

	public async createFolder (item: NewItem): Promise<SavedFolder> {
		const folder: SavedFolder = { id: newId(), kind: 'folder', ...item, name: item.name.trim(), ...this.stamp() }
		this.check(folder)
		await this.save([folder])
		return folder
	}

	public async createQuery (item: NewItem, content: SavedQueryContent): Promise<SavedQuery> {
		const query: SavedQuery = { id: newId(), kind: 'query', ...item, name: item.name.trim(), ...content, ...this.stamp() }
		this.check(query)
		await this.save([query])
		return query
	}

	public async createDiagram (item: NewItem, content: Pick<SavedDiagram, 'entities' | 'positions' | 'bends' | 'compact' | 'relationNames'>): Promise<SavedDiagram> {
		const diagram: SavedDiagram = { id: newId(), kind: 'diagram', ...item, name: item.name.trim(), ...content, ...this.stamp() }
		this.check(diagram)
		await this.save([diagram])
		return diagram
	}

	private find (id: string): SavedItem {
		const item = this.state.items.find(i => i.id === id)
		if (!item) throw new WorkspaceError('notFound')
		return item
	}

	/** Name, description and, for a query or a diagram, its content */
	public async update (id: string, patch: Partial<Omit<SavedFolder, 'id' | 'kind' | 'schema' | 'parentId'>> | Partial<SavedQueryContent> | Partial<Pick<SavedDiagram, 'entities' | 'positions' | 'bends' | 'compact' | 'relationNames'>>): Promise<SavedItem> {
		const item = this.find(id)
		const updated = { ...item, ...patch, id: item.id, kind: item.kind, schema: item.schema, parentId: item.parentId, updatedAt: this.clock().toISOString() } as SavedItem
		updated.name = updated.name.trim()
		if (updated.name !== item.name) this.check(updated)
		await this.save([updated])
		return updated
	}

	/** Into a folder of the same schema, or to its top (undefined) */
	public async move (id: string, parentId: string | undefined): Promise<void> {
		const item = this.find(id)
		if (item.parentId === parentId) return
		if (!canMove(this.state.items, id, parentId)) throw new WorkspaceError('cannotMove')
		this.check({ ...item, parentId })
		await this.save([{ ...item, parentId, updatedAt: this.clock().toISOString() }])
	}

	/** The item and, for a folder, everything in it */
	public async remove (id: string): Promise<number> {
		const ids = subtreeOf(this.state.items, id)
		await this.store.remove(ids)
		const gone = new Set(ids)
		this.set({ items: this.state.items.filter(i => !gone.has(i.id)) })
		return ids.length
	}

	/** Everything, as the JSON text of an export file */
	public exportText (): string {
		return JSON.stringify(toExport(this.state.items, this.clock()), null, 2)
	}

	/** An export file: added to what there is (the same items are replaced), or instead of everything */
	public async importText (text: string, mode: 'merge' | 'replace'): Promise<number> {
		const items = parseExport(text)
		if (!items) throw new WorkspaceError('invalidFile')
		if (mode === 'replace') {
			await this.store.clear()
			await this.store.put(items)
			this.set({ items })
		} else {
			await this.save(items)
		}
		return items.length
	}
}
