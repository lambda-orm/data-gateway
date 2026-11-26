/** The cache of a schema as the configuration gives it (docs/RESULT_CACHE.md §2) */
export interface ResultCacheSettings {
	/** how long a result lives: the bound of what is written outside λORM */
	ttlMs: number
	maxEntries: number
	/** a result larger than this (its JSON) is not kept */
	maxBytes: number
	/** by entity: another ttl, or none (what reads it is not kept) */
	entities: Record<string, { enabled?: boolean, ttlMs?: number }>
}

interface Entry {
	/** the result as JSON: each hit parses its own copy (whoever uses it can't change what is kept) */
	text: string
	entities: string[]
	expires: number
}

export interface ResultCacheStats {
	hits: number
	misses: number
	invalidations: number
	entries: number
}

/**
 * The results of the reads of a schema (docs/RESULT_CACHE.md): in memory, the least used go first when it is full (LRU),
 * each until its TTL; a write of an entity (a DataChange of λORM) drops every result that reads it.
 */
export class ResultCache {
	private readonly entries = new Map<string, Entry>()
	/** entity → the keys of the results that read it */
	private readonly byEntity = new Map<string, Set<string>>()
	private readonly stats = { hits: 0, misses: 0, invalidations: 0 }

	/** hash: of a text, for the keys (the infrastructure gives it: sha256) */
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly settings: ResultCacheSettings,
		private readonly hash: (text: string) => string,
		private readonly now: () => number = Date.now
	) {}

	/** the key of a read: a hash of everything that changes its result (never the data in clear) */
	public keyOf (parts: Record<string, unknown>): string {
		return this.hash(stable(parts))
	}

	/** whether the results that read these entities are kept, and for how long (the shortest ttl of them) */
	public ttlFor (entities: string[]): number | undefined {
		let ttl = this.settings.ttlMs
		for (const entity of entities) {
			const own = this.settings.entities[entity]
			if (own?.enabled === false) return undefined
			if (own?.ttlMs !== undefined) ttl = Math.min(ttl, own.ttlMs)
		}
		return ttl > 0 ? ttl : undefined
	}

	public get (key: string): { value: unknown } | undefined {
		const entry = this.entries.get(key)
		if (!entry || entry.expires <= this.now()) {
			if (entry) this.drop(key)
			this.stats.misses++
			return undefined
		}
		// the most recently used goes last: the first ones are the ones to drop
		this.entries.delete(key)
		this.entries.set(key, entry)
		this.stats.hits++
		return { value: JSON.parse(entry.text) }
	}

	public set (key: string, value: unknown, entities: string[]): void {
		const ttl = this.ttlFor(entities)
		if (ttl === undefined) return
		const text = JSON.stringify(value ?? null)
		if (Buffer.byteLength(text) > this.settings.maxBytes) return
		this.drop(key)
		this.entries.set(key, { text, entities, expires: this.now() + ttl })
		for (const entity of entities) {
			if (!this.byEntity.has(entity)) this.byEntity.set(entity, new Set())
			this.byEntity.get(entity)!.add(key)
		}
		while (this.entries.size > this.settings.maxEntries) this.drop(this.entries.keys().next().value!)
	}

	/** a write of these entities: every result that reads one of them goes */
	public invalidate (entities: string[]): void {
		for (const entity of new Set(entities)) {
			const keys = this.byEntity.get(entity)
			if (!keys?.size) continue
			this.stats.invalidations++
			for (const key of [...keys]) this.drop(key)
		}
	}

	public get snapshot (): ResultCacheStats {
		return { ...this.stats, entries: this.entries.size }
	}

	private drop (key: string): void {
		const entry = this.entries.get(key)
		if (!entry) return
		this.entries.delete(key)
		for (const entity of entry.entities) {
			const keys = this.byEntity.get(entity)
			keys?.delete(key)
			if (keys && keys.size === 0) this.byEntity.delete(entity)
		}
	}
}

/** JSON with the keys of every object in order: the same parts give the same key */
const stable = (value: unknown): string => {
	if (value === undefined) return 'null'
	if (value === null || typeof value !== 'object') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
	return `{${Object.keys(value as object).sort().filter(k => (value as any)[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable((value as any)[k])}`).join(',')}}`
}
