// The replicas together (docs/REPLICAS.md): the changes of the data of one reach the others (their caches and their
// subscriptions), never its own twice; one replica leads the outbox, another takes it when it goes or its lease
// expires, and without the Valkey nobody leads. The configuration cluster.valkey, and its password never logged.
import { SchemaChanges, shareChanges } from '../../src/lib/application/cluster/clusterChanges'
import { LeaderLease } from '../../src/lib/application/cluster/leaderLease'
import { ClusterBusPort } from '../../src/lib/application/ports/output/clusterPorts'
import { ConfigReader } from '../../src/lib/domain/config/configReader'
import { effectiveSettings } from '../../src/lib/domain/runtime/schemas'
import { maskSecrets } from '../../src/lib/infrastructure/build/dataGatewayBuilder'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'

const logger = new ConsoleLogger('error')

/** One Valkey in memory: channels and leases with their expiry (now, moved by the test) */
class MemoryValkey {
	public now = 0
	public down = false
	public readonly channels = new Map<string, Set<(m: string) => void>>()
	public readonly leases = new Map<string, { owner: string, until: number }>()
	public bus (): ClusterBusPort {
		const valkey = this
		const check = () => { if (valkey.down) throw new Error('Connection is closed.') }
		return {
			get connected () { return !valkey.down },
			async publish (channel, message) { check(); for (const listen of valkey.channels.get(channel) ?? []) listen(message) },
			async subscribe (channel, listen) {
				const set = valkey.channels.get(channel) ?? new Set()
				valkey.channels.set(channel, set)
				set.add(listen)
				return async () => { set.delete(listen) }
			},
			async lease (key, owner, ttlMs) {
				check()
				const held = valkey.leases.get(key)
				if (held && held.until > valkey.now && held.owner !== owner) return false
				valkey.leases.set(key, { owner, until: valkey.now + ttlMs })
				return true
			},
			async release (key, owner) { check(); if (valkey.leases.get(key)?.owner === owner) valkey.leases.delete(key) },
			async close () {}
		}
	}
}

const flush = () => new Promise(resolve => setImmediate(resolve))

describe('the changes of the data between replicas', () => {
	test('a write of one replica reaches the others, marked remote; never back to itself', async () => {
		const valkey = new MemoryValkey()
		const a = new SchemaChanges(); const b = new SchemaChanges(); const c = new SchemaChanges()
		const heard: Record<string, { entities: string[], remote: boolean }[]> = { a: [], b: [], c: [] }
		for (const [name, changes] of Object.entries({ a, b, c })) changes.on((list, remote) => heard[name].push({ entities: list.map(x => x.entity), remote }))
		await shareChanges(valkey.bus(), 'dg:shop:changes', 'replica-a', a, logger)
		await shareChanges(valkey.bus(), 'dg:shop:changes', 'replica-b', b, logger)
		await shareChanges(valkey.bus(), 'dg:other:changes', 'replica-c', c, logger)
		a.emit([{ entity: 'Orders', action: 'insert', keys: [{ id: 11078 }], count: 1 }])
		await flush()
		expect(heard.a).toEqual([{ entities: ['Orders'], remote: false }])
		expect(heard.b).toEqual([{ entities: ['Orders'], remote: true }])
		// another schema, another channel
		expect(heard.c).toEqual([])
		// what arrives malformed is dropped
		for (const listen of valkey.channels.get('dg:shop:changes')!) listen('{not json')
		for (const listen of valkey.channels.get('dg:shop:changes')!) listen(JSON.stringify({ from: 'x', changes: [{ entity: 1 }] }))
		expect(heard.b).toHaveLength(1)
	})

	test('the Valkey down: the replica keeps its own changes (its cache, its subscriptions); said once', async () => {
		const valkey = new MemoryValkey()
		const warnings: string[] = []
		const spy = { ...logger, warn: (m: string) => { warnings.push(m) }, info: () => undefined, error: () => undefined, debug: () => undefined } as any
		const a = new SchemaChanges()
		const own: string[] = []
		a.on(list => own.push(list[0].entity))
		await shareChanges(valkey.bus(), 'dg:shop:changes', 'replica-a', a, spy)
		valkey.down = true
		a.emit([{ entity: 'Orders', action: 'update' }])
		a.emit([{ entity: 'Customers', action: 'update' }])
		await flush()
		expect(own).toEqual(['Orders', 'Customers'])
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toContain("don't reach the other replicas")
	})
})

describe('one replica leads the outbox', () => {
	const role = () => {
		const calls: string[] = []
		return { calls, role: { lead: () => { calls.push('lead') }, follow: () => { calls.push('follow') } } }
	}

	test('one takes the lease; the other follows; when the first goes, the other takes it', async () => {
		const valkey = new MemoryValkey()
		const a = role(); const b = role()
		const leaseA = new LeaderLease(valkey.bus(), 'dg:shop:outbox', 'a', a.role, logger)
		const leaseB = new LeaderLease(valkey.bus(), 'dg:shop:outbox', 'b', b.role, logger)
		await leaseA.check(); await leaseB.check()
		expect([leaseA.isLeader, leaseB.isLeader]).toEqual([true, false])
		// renewing keeps it
		valkey.now += 10000
		await leaseA.check(); await leaseB.check()
		expect([leaseA.isLeader, leaseB.isLeader]).toEqual([true, false])
		// stopping lets it go at once
		await leaseA.stop()
		await leaseB.check()
		expect([leaseA.isLeader, leaseB.isLeader]).toEqual([false, true])
		expect(a.calls).toEqual(['lead', 'follow'])
		expect(b.calls).toEqual(['lead'])
	})

	test('a replica that stops renewing (it fell) loses it when it expires; without the Valkey nobody leads', async () => {
		const valkey = new MemoryValkey()
		const a = role(); const b = role()
		const leaseA = new LeaderLease(valkey.bus(), 'dg:shop:outbox', 'a', a.role, logger, { ttlMs: 15000, renewMs: 5000 })
		const leaseB = new LeaderLease(valkey.bus(), 'dg:shop:outbox', 'b', b.role, logger, { ttlMs: 15000, renewMs: 5000 })
		await leaseA.check()
		valkey.now += 14000
		await leaseB.check()
		expect(leaseB.isLeader).toBe(false)
		valkey.now += 2000
		await leaseB.check()
		expect(leaseB.isLeader).toBe(true)
		// a, back, finds it taken: it follows
		await leaseA.check()
		expect(leaseA.isLeader).toBe(false)
		expect(a.calls).toEqual(['lead', 'follow'])
		// the Valkey down: the leader stops leading (better none than two)
		valkey.down = true
		await leaseB.check()
		expect(leaseB.isLeader).toBe(false)
		expect(b.calls).toEqual(['lead', 'follow'])
	})
})

describe('cluster.valkey', () => {
	// several replicas keep their state in a database (docs/GATEWAY_STATE.md §2)
	const base = { orm: { workspacePath: '/workspace' }, transports: { http: { port: 8080 } }, state: { source: { dialect: 'PostgreSQL', connection: 'postgres://u:pw@db/gateway' } } }
	const read = (raw: unknown) => new ConfigReader().read(raw)

	test('its url and prefix; to every schema; without it, each replica on its own', () => {
		const { config, issues } = read({ ...base, cluster: { valkey: { url: 'valkey://:pw@valkey:6379/2', prefix: 'shop' } } })
		expect(issues).toEqual([])
		expect(config!.cluster).toEqual({ valkey: { url: 'valkey://:pw@valkey:6379/2', prefix: 'shop' } })
		expect(read({ ...base, cluster: { valkey: { url: 'rediss://cache:6380' } } }).config!.cluster.valkey).toEqual({ url: 'rediss://cache:6380', prefix: 'data-gateway' })
		expect(read(base).config!.cluster).toEqual({})
		const settings = effectiveSettings(config!, { path: 'shop', workspace: '/workspace/shop', overrides: {} } as any)
		expect(settings.valkey).toEqual({ url: 'valkey://:pw@valkey:6379/2', prefix: 'shop' })
		expect(effectiveSettings(read(base).config!, { path: 'shop', workspace: '/w', overrides: {} } as any).valkey).toBeUndefined()
	})

	test('a url that is not one, an error; a url not given (its variable), a warning', () => {
		expect(read({ ...base, cluster: { valkey: { url: 'http://valkey' } } }).issues).toContain('cluster.valkey.url must be valkey://, valkeys://, redis:// or rediss://')
		expect(read({ ...base, cluster: { valkey: { url: '' } } }).warnings).toContain('cluster.valkey has no url (a variable not given?): each replica on its own')
		expect(read({ ...base, cluster: { valkey: { url: 'valkey://v', prefix: 'a b' } } }).issues).toContain('cluster.valkey.prefix: letters, digits and _ . : - only')
	})

	test('several replicas on the SQLite of the volume: an error (they lose data)', () => {
		const sqlite = { ...base, state: undefined }
		expect(read({ ...sqlite, cluster: { valkey: { url: 'valkey://v' } } }).issues).toContain('cluster.valkey (several replicas) with the state of the gateway in SQLite: give state.source another database (PostgreSQL)')
	})

	test('its password is never in the log of the configuration', () => {
		const { config } = read({ ...base, cluster: { valkey: { url: 'valkey://user:s3cret@valkey:6379' } } })
		expect(JSON.stringify(maskSecrets(config!))).not.toContain('s3cret')
		expect((maskSecrets(config!) as any).cluster.valkey.url).toBe('valkey://***@valkey:6379')
		// nor the one of the database of the state
		expect((maskSecrets(config!) as any).state.source.connection).toBe('postgres://***@db/gateway')
	})
})
