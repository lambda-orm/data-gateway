// The history of a schema (docs/OBSERVABILITY.md §5.2, §5.3): the JSON Patch of a change, the history in
// logs/changes.jsonl (with λORM's events in the same file), its announcement once to the IDEs.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SchemaChange } from '@lambdaorm/base'
import { jsonDiff } from '../../src/lib/domain/admin/jsonPatch'
import { ignoredWorkspaceFile, WorkspaceChange } from '../../src/lib/domain/runtime/workspaces'
import { FileSchemaHistory } from '../../src/lib/infrastructure/output/admin/fileSchemaHistory'
import { SchemaRouter } from '../../src/lib/application/runtime/schemaRouter'
import { FixedClock } from '../helpers/fakes'

describe('jsonDiff (RFC 6902)', () => {
	test('objects: add, remove, replace, by their path', () => {
		expect(jsonDiff({ a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 5 }, e: 'x' })).toEqual([
			{ op: 'remove', path: '/b/d' },
			{ op: 'replace', path: '/b/c', value: 5 },
			{ op: 'add', path: '/e', value: 'x' }
		])
	})
	test('lists by position, the removed from the end; keys with / and ~ escaped', () => {
		expect(jsonDiff({ l: [1, 2, 3] }, { l: [1, 9] })).toEqual([{ op: 'replace', path: '/l/1', value: 9 }, { op: 'remove', path: '/l/2' }])
		expect(jsonDiff({ l: [1] }, { l: [1, 2, 3] })).toEqual([{ op: 'add', path: '/l/1', value: 2 }, { op: 'add', path: '/l/2', value: 3 }])
		expect(jsonDiff({ 'a/b': 1, 'c~d': 1 }, { 'a/b': 2, 'c~d': 2 })).toEqual([{ op: 'replace', path: '/a~1b', value: 2 }, { op: 'replace', path: '/c~0d', value: 2 }])
		expect(jsonDiff({ a: 1 }, { a: 1 })).toEqual([])
	})
})

describe('logs/ is not a change of a workspace', () => {
	test('the history and the hash of λORM are not announced as files', () => {
		expect(ignoredWorkspaceFile('logs/changes.jsonl')).toBe(true)
		expect(ignoredWorkspaceFile('logs/schema.hash')).toBe(true)
		expect(ignoredWorkspaceFile('data/logs.json')).toBe(false)
	})
})

describe('FileSchemaHistory', () => {
	let workspace: string
	beforeEach(() => {
		workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-history-'))
		fs.writeFileSync(path.join(workspace, 'lambdaORM.yaml'), 'name: shop\ndomain: { entities: [] }\n')
	})
	afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }))

	const change = (id: string, kind: any, target: string, time: string): SchemaChange =>
		({ id, time, schema: 'shop', kind, target, version: { before: 'aaaa', after: `v-${id}` }, actor: { credential: 'modeler', session: 's1' }, result: 'ok' })

	test('records, announces with who and what, and leaves the hash for λORM', async () => {
		const announced: WorkspaceChange[] = []
		const history = new FileSchemaHistory(p => announced.push(p))
		await history.record('shop', workspace, change('01A', 'schema.patch', 'domain/entities/Customers', '2026-11-24T10:00:00.000Z'))
		expect(announced).toEqual([{ path: 'shop', kind: 'schema', at: '2026-11-24T10:00:00.000Z', change: { id: '01A', kind: 'schema.patch', target: 'domain/entities/Customers', actor: { credential: 'modeler', session: 's1' }, time: '2026-11-24T10:00:00.000Z', version: 'v-01A' } }])
		expect(fs.readFileSync(path.join(workspace, 'logs', 'schema.hash'), 'utf8')).toBe('v-01A')
		const [line] = fs.readFileSync(path.join(workspace, 'logs', 'changes.jsonl'), 'utf8').trim().split('\n').map(p => JSON.parse(p))
		expect(line).toMatchObject({ event: 'schema.change', level: 'info', attributes: { id: '01A', kind: 'schema.patch' } })
	})

	test('reads the newest first, with its filters and pages, and the events of λORM in the same file', async () => {
		const history = new FileSchemaHistory()
		await history.record('shop', workspace, change('01A', 'schema.patch', 'domain/entities/Customers', '2026-11-24T10:00:00.000Z'))
		await history.record('shop', workspace, change('01B', 'schema.patch', 'domain/entities/Customers/properties/email', '2026-11-24T11:00:00.000Z'))
		await history.record('shop', workspace, change('01C', 'schema.patch', 'domain/entities/Orders', '2026-11-24T12:00:00.000Z'))
		// what λORM writes (a push from the CLI), and a line cut by a crash
		fs.appendFileSync(path.join(workspace, 'logs', 'changes.jsonl'), JSON.stringify({ time: '2026-11-24T13:00:00.000Z', level: 'info', message: 'schema.change', event: 'schema.change', attributes: change('01D', 'stage.push', undefined as any, '2026-11-24T13:00:00.000Z') }) + '\n{"time":')
		const all = await history.read(workspace, { limit: 50 })
		expect(all.items.map(p => p.id)).toEqual(['01D', '01C', '01B', '01A'])
		expect((await history.read(workspace, { limit: 50, target: 'domain/entities/Customers' })).items.map(p => p.id)).toEqual(['01B', '01A'])
		expect((await history.read(workspace, { limit: 50, kind: 'stage.push' })).items.map(p => p.id)).toEqual(['01D'])
		expect((await history.read(workspace, { limit: 50, since: '2026-11-24T11:30:00.000Z' })).items.map(p => p.id)).toEqual(['01D', '01C'])
		const page = await history.read(workspace, { limit: 2 })
		expect(page).toMatchObject({ nextCursor: '01C' })
		expect((await history.read(workspace, { limit: 2, cursor: page.nextCursor })).items.map(p => p.id)).toEqual(['01B', '01A'])
	})

	test('a workspace without history: nothing', async () => {
		expect(await new FileSchemaHistory().read(workspace, { limit: 50 })).toEqual({ items: [] })
	})
})

describe('workspace.changed', () => {
	test('a change of the administration is announced once (with who); one from outside goes as it comes', () => {
		const router = new SchemaRouter([], new FixedClock(), '1')
		const seen: WorkspaceChange[] = []
		router.onWorkspaceChange(p => seen.push(p))
		const full = 'abcdef0123456789'.repeat(4)
		router.workspaceChanged({ path: 'shop', kind: 'schema', at: 't1', change: { id: '01A', kind: 'schema.patch', target: 'domain/entities/Customers', actor: { credential: 'modeler' }, time: 't1', version: full.slice(0, 16) } })
		// the monitor sees the same file
		router.workspaceChanged({ path: 'shop', kind: 'schema', files: ['lambdaORM.yaml'], at: 't2', version: full })
		// an editor changes it
		router.workspaceChanged({ path: 'shop', kind: 'schema', files: ['lambdaORM.yaml'], at: 't3', version: 'ff'.repeat(32) })
		expect(seen.map(p => p.at)).toEqual(['t1', 't3'])
		expect(seen[0].change?.actor).toEqual({ credential: 'modeler' })
	})
})
