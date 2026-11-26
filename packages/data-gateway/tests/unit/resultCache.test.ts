// The cache of the reads (docs/RESULT_CACHE.md): LRU with a TTL, dropped by the writes of the entities a read depends
// on (also those reached through a relation), keyed by who reads (its view, its context), never a write.
import { createHash } from 'crypto'
import { ResultCache, ResultCacheSettings } from '../../src/lib/application/cache/resultCache'

const sha = (text: string) => createHash('sha256').update(text).digest('base64url')
import { readEntities } from '../../src/lib/domain/query/readEntities'
import { QueryUseCases } from '../../src/lib/application/usecases/queryUseCases'
import { Auditor } from '../../src/lib/application/usecases/auditor'
import { ViewResolver } from '../../src/lib/application/usecases/viewResolver'
import { ConfigReader } from '../../src/lib/domain/config/configReader'
import { principal } from '../../src/lib/domain/auth/principal'
import { ctx, FakeOrm, FixedClock, MemoryAudit } from '../helpers/fakes'

const settings = (more: Partial<ResultCacheSettings> = {}): ResultCacheSettings => ({ ttlMs: 1000, maxEntries: 3, maxBytes: 1000, entities: {}, ...more })

describe('the cache', () => {
	test('a result until its TTL; a write of an entity it reads drops it; each hit is its own copy', () => {
		let now = 0
		const cache = new ResultCache(settings(), sha, () => now)
		cache.set('a', [{ id: 1 }], ['Products', 'Categories'])
		const hit = cache.get('a')!.value as any[]
		hit.push({ id: 2 })
		expect(cache.get('a')!.value).toEqual([{ id: 1 }])
		cache.invalidate(['Categories'])
		expect(cache.get('a')).toBeUndefined()
		cache.set('b', 1, ['Orders'])
		now = 1001
		expect(cache.get('b')).toBeUndefined()
		expect(cache.snapshot).toMatchObject({ hits: 2, misses: 2, invalidations: 1, entries: 0 })
	})

	test('the least used goes when it is full; a result too large is not kept', () => {
		const cache = new ResultCache(settings({ maxBytes: 20 }), sha, () => 0)
		for (const key of ['a', 'b', 'c']) cache.set(key, key, ['X'])
		cache.get('a')
		cache.set('d', 'd', ['X'])
		expect(['a', 'b', 'c', 'd'].map(k => cache.get(k) !== undefined)).toEqual([true, false, true, true])
		cache.set('big', 'x'.repeat(50), ['X'])
		expect(cache.get('big')).toBeUndefined()
	})

	test('by entity: another ttl (the shortest of what it reads), or none', () => {
		const cache = new ResultCache(settings({ entities: { Prices: { ttlMs: 5 }, AuditLogs: { enabled: false } } }), sha, () => 0)
		expect(cache.ttlFor(['Products'])).toBe(1000)
		expect(cache.ttlFor(['Products', 'Prices'])).toBe(5)
		expect(cache.ttlFor(['Products', 'AuditLogs'])).toBeUndefined()
	})

	test('the key: the same parts in any order give the same key; another context, another', () => {
		const keys = new ResultCache(settings(), sha)
		const a = keys.keyOf({ query: 'Q', options: { view: 'v', context: { tenant: 't1', region: 'eu' } } })
		expect(keys.keyOf({ options: { context: { region: 'eu', tenant: 't1' }, view: 'v' }, query: 'Q' })).toBe(a)
		expect(keys.keyOf({ query: 'Q', options: { view: 'v', context: { tenant: 't2', region: 'eu' } } })).not.toBe(a)
	})
})

describe('the entities a read depends on', () => {
	const domain = [
		{ name: 'Products', relations: [{ name: 'category', entity: 'Categories' }, { name: 'supplier', entity: 'Suppliers' }] },
		{ name: 'Categories', relations: [{ name: 'parent', entity: 'Groups' }] },
		{ name: 'Orders', relations: [{ name: 'details', entity: 'Orders.details' }] }
	]
	test('its sentences and the relations it goes through (a join is not a sentence)', () => {
		expect(readEntities('Products.filter(p => p.category.name == x).map(p => p.name)', ['Products'], domain).sort()).toEqual(['Categories', 'Products'])
		expect(readEntities('Products.map(p => p.category.parent.name)', ['Products'], domain).sort()).toEqual(['Categories', 'Groups', 'Products'])
		expect(readEntities('Products.map(p => p.name)', ['Products'], domain)).toEqual(['Products'])
	})
})

describe('execute through the cache', () => {
	const setup = () => {
		const orm = new FakeOrm()
		const results = new ResultCache(settings({ maxEntries: 100 }), sha)
		const queries = new QueryUseCases(orm, new Auditor(new MemoryAudit(), new FixedClock(), '', { enabled: false, includeData: false }),
			new ViewResolver(() => ['default', 'support']), { results, domain: () => [{ name: 'Products', relations: [] }] })
		return { orm, results, queries }
	}

	test('a read once to the database; a write never kept; written, read again', async () => {
		const { orm, results, queries } = setup()
		expect(await queries.execute(ctx(['read']), { query: 'Products', data: { a: 1 } })).toEqual([{ id: 1 }])
		await queries.execute(ctx(['read']), { query: 'Products', data: { a: 1 } })
		expect(orm.executed).toHaveLength(1)
		await queries.execute(ctx(['read']), { query: 'Products', data: { a: 2 } })
		expect(orm.executed).toHaveLength(2)
		await queries.execute(ctx(['read', 'write']), { query: 'Products.insert()', data: {} })
		await queries.execute(ctx(['read', 'write']), { query: 'Products.insert()', data: {} })
		expect(orm.executed).toHaveLength(4)
		results.invalidate(['Products'])
		await queries.execute(ctx(['read']), { query: 'Products', data: { a: 1 } })
		expect(orm.executed).toHaveLength(5)
	})

	test('two identities never share a result: another view or another context, another read', async () => {
		const { orm, queries } = setup()
		const who = (view: string | undefined, tenant: string) => ({ principal: { ...principal('ann', ['read']), ...(view ? { view } : {}), context: { tenant } }, transport: 'http' })
		await queries.execute(who(undefined, 't1'), { query: 'Products' })
		await queries.execute(who(undefined, 't2'), { query: 'Products' })
		await queries.execute(who('support', 't1'), { query: 'Products' })
		await queries.execute(who(undefined, 't1'), { query: 'Products' })
		expect(orm.executed).toHaveLength(3)
	})
})

describe('the configuration of the cache', () => {
	const minimal = { orm: { schemas: [{ path: 'shop', workspace: '/tmp/shop' }] }, transports: { http: { port: 9291 } } }
	test('off by default; on with its ttl and its entities; by schema; view, queries and cache are keys of a schema', () => {
		expect(new ConfigReader().read(minimal).config!.cache.enabled).toBe(false)
		const reading = new ConfigReader().read({
			...minimal,
			cache: { enabled: true, ttl: '30s', maxRowBytes: '2MB', entities: { Prices: { ttl: '5s' }, AuditLogs: { enabled: false } } },
			orm: { schemas: [{ path: 'shop', workspace: '/tmp/shop', view: 'public', queries: {}, cache: { enabled: false } }] }
		})
		expect(reading.issues).toEqual([])
		expect(reading.warnings).toEqual([])
		expect(reading.config!.cache).toEqual({ enabled: true, ttlMs: 30000, maxEntries: 10000, maxBytes: 2 * 1024 * 1024, entities: { Prices: { ttlMs: 5000 }, AuditLogs: { enabled: false } } })
		expect(reading.config!.orm.schemas[0].cache?.enabled).toBe(false)
		expect(new ConfigReader().read({ ...minimal, cache: { store: 'redis' } }).issues.join()).toContain('redis comes later')
	})
})
