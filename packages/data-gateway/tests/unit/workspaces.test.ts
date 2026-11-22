// Schemas that appear, go and change while the gateway runs (docs/DATA_GATEWAY_ADMIN_PLAN.md §2.1, phase 1): the
// supervisor (blue-green reload), the router of the edge and the monitor of the workspaces, with fakes.
import { HeartbeatPolicy, RestartPolicy } from '../../src/lib/domain/runtime/policies'
import { SchemaRouter } from '../../src/lib/application/runtime/schemaRouter'
import { Supervisor } from '../../src/lib/application/runtime/supervisor'
import { WorkspaceMonitor } from '../../src/lib/application/runtime/workspaceMonitor'
import { changeKindOf, ignoredWorkspaceFile, WorkspaceChange } from '../../src/lib/domain/runtime/workspaces'
import { NoneAuthenticator } from '../../src/lib/infrastructure/output/auth/authenticators'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { FixedClock } from '../helpers/fakes'

const logger = new ConsoleLogger('error')
const spec = (path: string, version = 1) => ({ descriptor: { path, workspace: `/w/${path}`, origin: 'discovered' as const, overrides: {} }, settings: { version } as any, env: {} })

describe('supervisor: schemas added, removed and reloaded', () => {
	const policies = { restart: new RestartPolicy(10, 40), heartbeat: new HeartbeatPolicy(1000, 5000), graceMs: 50 }

	class FakeWorker {
		public stopped = false
		constructor (public readonly spec: any, public readonly events: any) {}
		ping () { /* answered by the test */ }
		async stop () { this.stopped = true }
		async terminate () { this.events.exited('terminated') }
	}
	class FakeEdge {
		public readonly log: string[] = []
		public stopped = false
		constructor (public readonly events: any, public readonly started: string[]) {}
		ping () { /* */ }
		async stop () { this.stopped = true }
		async terminate () { /* */ }
		connect (path: string, worker: FakeWorker) { this.log.push(`connect ${path} v${worker.spec.settings.version}`) }
		state (state: any) { this.log.push(`state ${state.path} ${state.status}${state.pending ? ' pending' : ''}`) }
		add (s: any) { this.log.push(`add ${s.descriptor.path}`) }
		remove (path: string) { this.log.push(`remove ${path}`) }
		workspace (change: WorkspaceChange) { this.log.push(`workspace ${change.path} ${change.kind}`) }
	}

	const setup = (paths = ['a']) => {
		const workers: FakeWorker[] = []
		const edges: FakeEdge[] = []
		const supervisor = new Supervisor(paths.map(p => spec(p)),
			{ start: (s, events) => { const w = new FakeWorker(s, events); workers.push(w); return w as any } },
			{ start: (events, specs) => { const e = new FakeEdge(events, specs.map(s => s.descriptor.path)); edges.push(e); return e as any } },
			policies, new FixedClock(), logger)
		return { supervisor, workers, edges, last: () => workers[workers.length - 1] }
	}

	test('add: the edge learns it and the new worker connects; remove: its worker stops and the edge forgets it', async () => {
		const { supervisor, workers, edges, last } = setup()
		supervisor.start()
		workers[0].events.ready({})
		supervisor.add(spec('b'))
		expect(supervisor.states().map(s => `${s.path} ${s.status}`)).toEqual(['a ready', 'b starting'])
		last().events.ready({})
		expect(edges[0].log).toEqual(expect.arrayContaining(['add b', 'connect b v1', 'state b ready']))
		await supervisor.remove('b')
		expect(last().stopped).toBe(true)
		expect(supervisor.paths()).toEqual(['a'])
		expect(edges[0].log.at(-1)).toBe('remove b')
		// a late event of the removed worker changes nothing
		last().events.exited('stopped')
		expect(supervisor.states()).toHaveLength(1)
		await supervisor.stop()
	})

	test('reload of a ready schema is blue-green: the current worker serves until the new one is ready', async () => {
		const { supervisor, workers, edges } = setup()
		supervisor.start()
		const [v1] = workers
		v1.events.ready({})
		supervisor.reload(spec('a', 2))
		const v2 = workers[1]
		expect(v1.stopped).toBe(false)
		expect(supervisor.states()[0].status).toBe('ready')
		v2.events.ready({})
		expect(edges[0].log.slice(-2)).toEqual(['connect a v2', 'state a ready'])
		expect(v1.stopped).toBe(true)
		// the old worker ending is not a fall of the schema
		v1.events.exited('stopped')
		expect(supervisor.states()[0]).toMatchObject({ status: 'ready', restarts: 0 })
		await supervisor.stop()
	})

	test('after a reload the new worker is the schema\'s: its pongs keep it alive, its exit restarts the schema', async () => {
		const policies = { restart: new RestartPolicy(10, 40), heartbeat: new HeartbeatPolicy(10, 50), graceMs: 50 }
		const workers: FakeWorker[] = []
		const edges: FakeEdge[] = []
		let now = 0
		const clock = { now: () => new Date(now), uptimeSeconds: () => 0 }
		const supervisor = new Supervisor([spec('a')],
			{ start: (s, events) => { const w = new FakeWorker(s, events); workers.push(w); return w as any } },
			{ start: (events, specs) => { const e = new FakeEdge(events, specs.map(s => s.descriptor.path)); edges.push(e); return e as any } },
			policies, clock as any, logger)
		supervisor.start()
		workers[0].events.ready({})
		supervisor.reload(spec('a', 2))
		const v2 = workers[1]
		v2.events.ready({})
		// time goes by and the new worker answers its pings: it is not taken for hung
		for (let i = 0; i < 10; i++) {
			now += 20
			v2.events.pong()
			edges[0].events.pong()
			await new Promise(resolve => setTimeout(resolve, 12))
		}
		expect(supervisor.states()[0].status).toBe('ready')
		expect(workers).toHaveLength(2)
		// it falls: the schema restarts with a new worker
		v2.events.exited('out of memory')
		expect(supervisor.states()[0]).toMatchObject({ status: 'restarting', reason: 'out of memory' })
		await new Promise(resolve => setTimeout(resolve, 30))
		expect(workers).toHaveLength(3)
		await supervisor.stop()
	})

	test('a new version that does not start: the last one that did keeps serving, with the reason as pending', async () => {
		const { supervisor, workers, edges } = setup()
		supervisor.start()
		const [v1] = workers
		v1.events.ready({})
		supervisor.reload(spec('a', 2))
		workers[1].events.failed('lambdaORM.yaml: entity Products has no primary key')
		expect(supervisor.states()[0]).toMatchObject({ status: 'ready', pending: expect.stringMatching(/^the new version did not start: lambdaORM.yaml: entity Products has no primary key/) })
		expect(v1.stopped).toBe(false)
		expect(edges[0].log.at(-1)).toBe('state a ready pending')
		// fixed: the next version replaces it and the pending goes
		supervisor.reload(spec('a', 3))
		workers[2].events.ready({})
		expect(supervisor.states()[0].pending).toBeUndefined()
		expect(v1.stopped).toBe(true)
		await supervisor.stop()
	})

	test('reload of a schema in error starts the new version at once; a reload during another drops the first', async () => {
		const { supervisor, workers } = setup()
		supervisor.start()
		workers[0].events.failed('database down')
		supervisor.reload(spec('a', 2))
		expect(workers).toHaveLength(2)
		expect(supervisor.states()[0].status).toBe('starting')
		workers[1].events.ready({})
		supervisor.reload(spec('a', 3))
		supervisor.reload(spec('a', 4))
		expect(workers[2].stopped).toBe(true)
		workers[2].events.ready({})
		expect(workers[1].stopped).toBe(false)
		workers[3].events.ready({})
		expect(workers[1].stopped).toBe(true)
		await supervisor.stop()
	})

	test('a restarted edge gets the schemas served now, those added included', async () => {
		const { supervisor, workers, edges } = setup()
		supervisor.start()
		workers[0].events.ready({})
		supervisor.add(spec('b'))
		edges[0].events.exited('crash')
		await new Promise(resolve => setTimeout(resolve, 30))
		expect(edges[1].started).toEqual(['a', 'b'])
		supervisor.workspaceChanged({ path: 'a', kind: 'files', files: ['workbench/x.query.yaml'], at: 'now' })
		expect(edges[1].log.at(-1)).toBe('workspace a files')
		await supervisor.stop()
	})
})

describe('the router of the edge', () => {
	const settings = (path: string) => ({ path, transports: ['http' as const], maxConcurrent: 0, timeout: 1000, authenticators: { http: new NoneAuthenticator() } })

	test('schemas added and removed change the set the transports serve', () => {
		const router = new SchemaRouter([settings('b')], new FixedClock(), '3')
		const changes: string[][] = []
		router.onSchemasChange(() => changes.push(router.schemas().map(s => s.path)))
		router.add(settings('a'))
		router.add(settings('a'))
		router.remove('b')
		expect(changes).toEqual([['a', 'b'], ['a']])
		expect(router.states().map(s => `${s.path} ${s.status}`)).toEqual(['a starting'])
		// a state of a removed schema arrives late
		router.setState({ path: 'b', status: 'ready', since: 'now', restarts: 0 })
		expect(router.states()).toHaveLength(1)
	})

	test('a reload: the new requests go to the new channel; the old one closes after the timeout', async () => {
		jest.useFakeTimers()
		try {
			const router = new SchemaRouter([settings('a')], new FixedClock(), '3')
			const channel = (answer: unknown) => ({ request: async () => answer, close: jest.fn(), onEvent: jest.fn() })
			const [one, two] = [channel(1), channel(2)]
			router.connect('a', one, { name: 'n', version: '1', instructions: '' })
			router.setState({ path: 'a', status: 'ready', since: 'now', restarts: 0 })
			router.connect('a', two, { name: 'n', version: '1', instructions: '' })
			expect(await router.call('a', 'gateway', 'version', [], undefined)).toBe(2)
			expect(one.close).not.toHaveBeenCalled()
			jest.advanceTimersByTime(3001)
			expect(one.close).toHaveBeenCalled()
			const changes: WorkspaceChange[] = []
			router.onWorkspaceChange(change => changes.push(change))
			router.workspaceChanged({ path: 'a', kind: 'schema', at: 'now' })
			expect(changes).toHaveLength(1)
		} finally {
			jest.useRealTimers()
		}
	})
})

describe('the monitor of the workspaces', () => {
	const setup = () => {
		const files = new Map<string, { schema: string, env: string }>()
		const runtime = {
			log: [] as string[],
			changes: [] as WorkspaceChange[],
			add (s: any) { this.log.push(`add ${s.descriptor.path}`) },
			remove (path: string) { this.log.push(`remove ${path}`) },
			reload (s: any) { this.log.push(`reload ${s.descriptor.path}`) },
			workspaceChanged (change: WorkspaceChange) { this.changes.push(change) }
		}
		let onFile: (file: string) => void = () => undefined
		let schemas = ['iot/v1', 'iot/v2']
		let broken: string | undefined
		const monitor = new WorkspaceMonitor({
			roots: ['/w'],
			resolve: () => {
				if (broken) throw new Error(broken)
				return schemas.map(p => ({ descriptor: spec(p).descriptor, settings: {} as any }))
			},
			spec: s => ({ ...s, env: {} }),
			intervalMs: 0,
			debounceMs: 0
		}, runtime, { watch: (_folders, listener) => { onFile = listener; return () => undefined } }, {
			fingerprint: workspace => files.get(workspace) ?? { schema: 'one', env: '' },
			relative: (workspace, file) => file.startsWith(workspace + '/') ? file.slice(workspace.length + 1) : undefined,
			absolute: folder => folder
		}, new FixedClock(), logger)
		monitor.start(schemas.map(p => spec(p)))
		return {
			monitor,
			runtime,
			touch: (file: string) => onFile(file),
			set: (next: string[]) => { schemas = next },
			write: (path: string, fingerprint: { schema: string, env: string }) => files.set(`/w/${path}`, fingerprint),
			breakConfig: (reason?: string) => { broken = reason }
		}
	}
	const kinds = (changes: WorkspaceChange[]) => changes.map(c => `${c.path} ${c.kind}${c.files ? ` ${c.files.join(',')}` : ''}`)

	test('a workspace that appears is added, one that goes is removed', async () => {
		const m = setup()
		m.set(['iot/v1', 'iot/v3'])
		await m.monitor.check()
		expect(m.runtime.log).toEqual(['remove iot/v2', 'add iot/v3'])
		expect(kinds(m.runtime.changes)).toEqual(['iot/v2 removed', 'iot/v3 added'])
		await m.monitor.stop()
	})

	test('a lambdaORM.yaml or .env whose content changed reloads its schema; the same content (a touch) does not', async () => {
		const m = setup()
		m.write('iot/v1', { schema: 'one', env: '' })
		await m.monitor.check()
		expect(m.runtime.log).toEqual([])
		m.write('iot/v1', { schema: 'two', env: '' })
		m.write('iot/v2', { schema: 'one', env: 'secret' })
		await m.monitor.check()
		expect(m.runtime.log).toEqual(['reload iot/v1', 'reload iot/v2'])
		expect(kinds(m.runtime.changes)).toEqual(['iot/v1 schema lambdaORM.yaml', 'iot/v2 env .env'])
		await m.monitor.stop()
	})

	test('other files of a workspace are only notified, grouped; the state of λORM and editors\' temporary files are not', async () => {
		const m = setup()
		for (const file of ['/w/iot/v1/workbench/a.query.yaml', '/w/iot/v1/workbench/reports/b.diagram.yaml', '/w/iot/v1/orm_state/default-model.json',
			'/w/iot/v1/workbench/.a.query.yaml.swp', '/w/iot/v2/data/rows.json', '/elsewhere/x']) m.touch(file)
		await m.monitor.check()
		expect(m.runtime.log).toEqual([])
		expect(kinds(m.runtime.changes)).toEqual(['iot/v1 files workbench/a.query.yaml,workbench/reports/b.diagram.yaml', 'iot/v2 files data/rows.json'])
		await m.monitor.stop()
	})

	test('workspaces that can\'t be served as they are (two at the same route): nothing changes until they can', async () => {
		const m = setup()
		m.breakConfig('schema path "iot/v1" is used by two schemas')
		m.set(['iot/v1'])
		await m.monitor.check()
		expect(m.runtime.log).toEqual([])
		m.breakConfig(undefined)
		await m.monitor.check()
		expect(m.runtime.log).toEqual(['remove iot/v2'])
		await m.monitor.stop()
	})

	test('the kind of a file and the files never notified', () => {
		expect(['lambdaORM.yaml', '.env', 'workbench/a.query.yaml'].map(changeKindOf)).toEqual(['schema', 'env', 'files'])
		expect(['orm_state/x.json', 'src/node_modules/a.js', 'a.yaml~', '.git/HEAD', 'workbench/a.query.yaml'].map(ignoredWorkspaceFile)).toEqual([true, true, true, true, false])
	})
})
