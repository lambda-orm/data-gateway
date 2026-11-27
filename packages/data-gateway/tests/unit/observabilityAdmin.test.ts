// The observability of the gateway changed from the administration (docs/DATA_GATEWAY.md §8.2): over the YAML, a
// section replaced whole; checked before it is kept; each change recorded; told to who applies it; back to the YAML.
import { ObservabilityAdmin, ObservabilityRefresher } from '../../src/lib/application/observability/observabilityAdmin'
import { mergeObservability } from '../../src/lib/domain/config/observabilitySettings'
import { applicableObservability, effectiveExplore, observabilityProblems } from '../../src/lib/infrastructure/build/observability'
import { MemoryRoleStore } from '../../src/lib/infrastructure/output/state/stateStores'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { ConfigReader } from '../../src/lib/domain/config/configReader'
import { principal } from '../../src/lib/domain/auth/principal'
import { FixedClock } from '../helpers/fakes'

const silent = new ConsoleLogger('error')
const yaml = {
	observability: { exporter: { type: 'otlp' as const, endpoint: 'http://alloy:4318' }, traces: { enabled: true, sampler: { ratio: 1 } } },
	explore: { grafana: 'https://grafana.example.com', tempo: 'tempo', prometheus: 'prometheus', loki: 'loki', orgId: 1 }
}

describe('the observability over the YAML', () => {
	test('merge: a section of the override replaces the one of the YAML, whole; null removes it; the others stay', () => {
		expect(mergeObservability(yaml, undefined)).toEqual({ ...yaml.observability, explore: yaml.explore })
		expect(mergeObservability(yaml, { traces: { enabled: false }, metrics: { enabled: true }, exporter: null })).toEqual({
			traces: { enabled: false }, metrics: { enabled: true }, explore: yaml.explore
		})
		expect(mergeObservability({}, undefined)).toBeUndefined()
	})

	test('its problems: the shape of λORM, explore, no headers', () => {
		expect(observabilityProblems(mergeObservability(yaml, { metrics: { enabled: true } }))).toEqual([])
		expect(observabilityProblems({ exporter: { headers: 'Authorization=x' } }).join()).toContain('OTEL_EXPORTER_OTLP_HEADERS')
		expect(observabilityProblems({ explore: { grafana: 'grafana:3000' } }).join()).toContain('explore.grafana')
		expect(observabilityProblems({ traces: { sampler: { ratio: 7 } } })).not.toEqual([])
	})

	test('what applies: the SDK of the merge (an invalid override, the YAML\'s), and the explore of the override', () => {
		const config = new ConfigReader().read({ orm: { schemas: [{ path: 'shop', workspace: '/w' }] }, transports: { http: { port: 1 } }, observability: { ...yaml.observability, explore: { grafana: 'https://grafana.example.com' } } }).config!
		expect(applicableObservability(config, { traces: { enabled: false } }, {}, silent)?.traces.enabled).toBe(false)
		expect(applicableObservability(config, { traces: { sampler: { ratio: 7 } } }, {}, silent)?.traces.enabled).toBe(true)
		expect(effectiveExplore(config, undefined)?.grafana).toBe('https://grafana.example.com')
		expect(effectiveExplore(config, { explore: { grafana: 'https://other', loki: 'logs' } })).toMatchObject({ grafana: 'https://other', loki: 'logs', tempo: 'tempo' })
		expect(effectiveExplore(config, { traces: { enabled: false } })?.grafana).toBe('https://grafana.example.com')
	})
})

describe('the administration of the observability', () => {
	const setup = () => {
		const store = new MemoryRoleStore()
		let applied = 0
		let n = 0
		const admin = new ObservabilityAdmin(store, yaml, true, new FixedClock(), () => `c${++n}`, silent, observabilityProblems, async () => { applied++ })
		return { store, admin, applied: () => applied }
	}
	const boss = principal('boss', ['read', 'observability'])

	test('with the permission observability: the YAML, the override and what applies', async () => {
		const { admin } = setup()
		await expect(admin.get(principal('nobody', ['read', 'roles']))).rejects.toMatchObject({ status: 403 })
		expect(await admin.get(boss)).toEqual({ yaml: { ...yaml.observability, explore: yaml.explore }, effective: { ...yaml.observability, explore: yaml.explore }, prometheus: true })
	})

	test('saved: checked first, recorded, applied; back to the YAML', async () => {
		const { store, admin, applied } = setup()
		await expect(admin.put(boss, { traces: { sampler: { ratio: 7 } } })).rejects.toMatchObject({ status: 400 })
		await expect(admin.put(boss, { tracez: {} })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('unknown sections') })
		await expect(admin.put(boss, { exporter: { endpoint: 'http://x', headers: 'Authorization=t' } })).rejects.toMatchObject({ status: 400 })
		expect(applied()).toBe(0)
		const view = await admin.put(boss, { metrics: { enabled: true }, explore: { ...yaml.explore, prometheus: 'vm' } }, 'to VictoriaMetrics')
		expect(applied()).toBe(1)
		expect(view).toMatchObject({ override: { metrics: { enabled: true } }, effective: { metrics: { enabled: true }, traces: { enabled: true }, explore: { prometheus: 'vm' } }, updatedBy: 'boss' })
		expect(await store.areaVersion('observability')).toBe(1)
		const changes = await store.changes(10)
		expect(changes[0]).toMatchObject({ area: 'observability', key: 'observability', by: 'boss', reason: 'to VictoriaMetrics', after: { metrics: { enabled: true } } })
		expect((await admin.remove(boss)).override).toBeUndefined()
		expect(applied()).toBe(2)
		await expect(admin.remove(boss)).rejects.toMatchObject({ status: 404 })
	})

	test('the refresher tells a change of the version (of this replica or another), not the first reading', async () => {
		const { store, admin } = setup()
		const told: unknown[] = []
		const refresher = new ObservabilityRefresher(store, 0, override => told.push(override), silent)
		await refresher.refresh()
		await refresher.refresh()
		expect(told).toEqual([])
		await admin.put(boss, { traces: { enabled: false } })
		await refresher.refresh()
		expect(told).toEqual([{ traces: { enabled: false } }])
		await admin.remove(boss)
		await refresher.refresh()
		expect(told).toEqual([{ traces: { enabled: false } }, undefined])
	})
})
