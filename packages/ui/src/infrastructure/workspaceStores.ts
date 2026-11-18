import { WorkspaceStore } from '../application/ports'
import { SavedItem } from '../domain/savedItems'

/** In memory: tests, and the fallback when the browser doesn't allow IndexedDB (some private windows) */
export class MemoryWorkspaceStore implements WorkspaceStore {
	private readonly items = new Map<string, SavedItem>()
	constructor (initial: SavedItem[] = [], private readonly isDurable = false) { for (const item of initial) this.items.set(item.id, item) }
	async all () { return [...this.items.values()].map(i => ({ ...i })) }
	async put (items: SavedItem[]) { for (const item of items) this.items.set(item.id, { ...item }) }
	async remove (ids: string[]) { for (const id of ids) this.items.delete(id) }
	async clear () { this.items.clear() }
	async durable () { return this.isDurable }
}

const STORE = 'items'


/**
 * IndexedDB of the browser, a database per workspace (for example per gateway and user): it lives on this device and
 * this browser only, and it goes if the site data is cleared (the export is the backup). It asks the browser to keep
 * it (navigator.storage.persist). When IndexedDB can't be opened, it keeps the items in memory and says so (durable).
 */
export class IndexedDbWorkspaceStore implements WorkspaceStore {
	private db: Promise<IDBDatabase | undefined> | undefined
	private readonly memory = new MemoryWorkspaceStore()

	constructor (private readonly key: string, private readonly factory: IDBFactory | undefined = (globalThis as any).indexedDB) {}

	private open (): Promise<IDBDatabase | undefined> {
		if (!this.db) {
			this.db = new Promise<IDBDatabase | undefined>(resolve => {
				if (!this.factory) { resolve(undefined); return }
				let opening: IDBOpenDBRequest
				try { opening = this.factory.open(`lambdaorm-workspace:${this.key}`, 1) } catch { resolve(undefined); return }
				opening.onupgradeneeded = () => {
					const db = opening.result
					if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
				}
				opening.onsuccess = () => resolve(opening.result)
				opening.onerror = () => resolve(undefined)
				opening.onblocked = () => resolve(undefined)
			})
			const storage = (globalThis as any).navigator?.storage
			storage?.persist?.().catch(() => undefined)
		}
		return this.db
	}

	private async run<T> (mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
		const db = await this.open()
		if (!db) return undefined
		return new Promise<T | undefined>((resolve, reject) => {
			const transaction = db.transaction(STORE, mode)
			const r = work(transaction.objectStore(STORE))
			transaction.oncomplete = () => resolve(r ? r.result : undefined)
			transaction.onerror = () => reject(transaction.error)
			transaction.onabort = () => reject(transaction.error)
		})
	}

	async all (): Promise<SavedItem[]> {
		if (!await this.open()) return this.memory.all()
		return (await this.run('readonly', store => store.getAll() as IDBRequest<SavedItem[]>)) ?? []
	}

	async put (items: SavedItem[]): Promise<void> {
		if (!await this.open()) return this.memory.put(items)
		await this.run('readwrite', store => { for (const item of items) store.put(item) })
	}

	async remove (ids: string[]): Promise<void> {
		if (!await this.open()) return this.memory.remove(ids)
		await this.run('readwrite', store => { for (const id of ids) store.delete(id) })
	}

	async clear (): Promise<void> {
		if (!await this.open()) return this.memory.clear()
		await this.run('readwrite', store => store.clear())
	}

	async durable (): Promise<boolean> { return !!(await this.open()) }
}

