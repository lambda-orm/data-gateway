// Domain and application of the library without React: actions by permission, results, parameters, history, workbench.
import { describe, expect, test, vi } from 'vitest'
import { availability } from '../src/domain/operations'
import { columnsOf, fromYaml, isTable, measure, toYaml } from '../src/domain/results'
import { addToHistory, dataFromParameters, markerFromError, parseObject } from '../src/domain/workspace'
import { WorkbenchController } from '../src/application/workbench'
import { HistoryPort } from '../src/application/ports'
import { RestQueryApi } from '../src/infrastructure/restQueryApi'
import { LocalStorageHistory } from '../src/infrastructure/localStorageHistory'
import { FakeApi, WHO_READS } from './fakes'

describe('domain', () => {
	test('actions by permission and scripts enabled', () => {
		expect(availability('plan', WHO_READS)).toEqual({ enabled: true })
		expect(availability('executeScript', WHO_READS)).toEqual({ enabled: false, reason: 'scripts are disabled on this schema' })
		expect(availability('executeScript', { ...WHO_READS, scripts: true })).toEqual({ enabled: false, reason: '"agent" has no script permission' })
		expect(availability('executeQueued', WHO_READS).enabled).toBe(false)
		expect(availability('execute', undefined)).toEqual({ enabled: false, reason: 'no credential yet' })
	})

	test('results: table, columns, YAML both ways, size and rows', () => {
		const rows = [{ id: 1, name: 'a' }, { id: 2, extra: { x: 1 } }]
		expect(isTable(rows)).toBe(true)
		expect(isTable([1, 2])).toBe(false)
		expect(columnsOf(rows)).toEqual(['id', 'name', 'extra'])
		expect(fromYaml(toYaml(rows))).toEqual(rows)
		expect(toYaml({ when: new Date('2026-01-02T03:04:05Z') })).toBe("when: '2026-01-02T03:04:05.000Z'\n")
		expect(measure('execute', rows, 12)).toMatchObject({ ok: true, rows: 2, bytes: JSON.stringify(rows).length, durationMs: 12 })
	})

	test('parameters complete the data; history keeps the newest once; markers', () => {
		expect(dataFromParameters([{ name: 'minPrice', type: 'decimal' }, { name: 'entity.name', type: 'string' }, { name: 'id', type: 'integer' }], { id: 7 }))
			.toEqual({ id: 7, minPrice: 0, entity: { name: '' } })
		expect(() => parseObject('[1]', 'data')).toThrow('data must be a JSON object')
		expect(() => parseObject('{x', 'data')).toThrow(/data is not valid JSON/)
		const a = { mode: 'query' as const, text: 'A', data: '{}', options: '{}', at: '1' }
		const b = { ...a, text: 'B', at: '2' }
		expect(addToHistory(addToHistory([a], b), { ...a, at: '3' }).map(e => e.text + e.at)).toEqual(['A3', 'B2'])
		expect(addToHistory([], a, 1)).toHaveLength(1)
		expect(markerFromError('error at line 2, column 5', 'x\nOrders.nope')).toMatchObject({ startLineNumber: 2, startColumn: 5, endColumn: 12 })
		expect(markerFromError('no position', 'a\nbc')).toMatchObject({ startLineNumber: 1, endLineNumber: 2, endColumn: 3 })
	})
})

const memory = (): HistoryPort & { saved: Record<string, unknown> } => {
	const saved: Record<string, any> = {}
	return { saved, load: s => saved[s] ?? [], save: (s, e) => { saved[s] = e }, clear: s => { delete saved[s] } }
}

describe('workbench controller', () => {
	test('schemas: only the ready ones; a schema loads whoami and typings', async () => {
		const api = new FakeApi()
		const wb = new WorkbenchController(api, undefined)
		await wb.loadSchemas()
		expect(wb.getState().schemas.map(s => s.path)).toEqual(['northwind/v1'])
		await wb.selectSchema('northwind/v1')
		expect(wb.getState()).toMatchObject({ schema: 'northwind/v1', whoami: { name: 'backend' }, typings: expect.stringContaining('Products') })
	})

	test('each action with the text, data and options; the result measured; runs go to the history', async () => {
		const api = new FakeApi()
		const history = memory()
		const results: unknown[] = []
		let now = 0
		const wb = new WorkbenchController(api, history, {}, r => results.push(r), () => (now += 5))
		await wb.selectSchema('northwind/v1')
		wb.update({ query: 'Products.filter(p => p.price > minPrice)', data: '{"minPrice": 10}', options: '{"stage": "default"}' })
		expect(await wb.run('execute')).toMatchObject({ ok: true, rows: 3, durationMs: 5, operation: 'execute' })
		expect(api.calls.at(-1)).toEqual({ operation: 'execute', args: ['northwind/v1', 'Products.filter(p => p.price > minPrice)', { minPrice: 10 }, { stage: 'default' }] })
		expect(history.saved['northwind/v1']).toEqual([expect.objectContaining({ mode: 'query', text: 'Products.filter(p => p.price > minPrice)' })])
		for (const op of ['plan', 'metadata', 'model', 'constraints'] as const) expect((await wb.run(op))!.ok).toBe(true)
		expect(results).toHaveLength(5)
		wb.update({ topic: 'jobs', chunk: '50' })
		expect((await wb.run('executeQueued'))!.value).toBe('queue-1')
		expect(api.calls.at(-1)!.args[1]).toEqual({ topic: 'jobs', query: 'Products.filter(p => p.price > minPrice)', data: { minPrice: 10 }, chunk: 50, options: { stage: 'default' } })
		wb.update({ mode: 'script', script: 'orm.execute("Products")' })
		expect((await wb.run('executeScript'))!.value).toBe(7)
	})

	test('errors are results: λORM errors, invalid data, no topic', async () => {
		const wb = new WorkbenchController(new FakeApi(), undefined)
		await wb.selectSchema('northwind/v1')
		wb.update({ query: 'Nope' })
		expect(await wb.run('execute')).toMatchObject({ ok: false, status: 400, error: { name: 'SchemaError', message: 'Entity Nope not found' } })
		wb.update({ query: 'Products', data: '{bad' })
		expect((await wb.run('execute'))!.error!.message).toMatch(/data is not valid JSON/)
		wb.update({ data: '{}' })
		expect((await wb.run('executeQueued'))!.error).toMatchObject({ name: 'QueueError', message: 'a topic is required' })
	})

	test('parameters fill the data; validation marks λORM errors; history restore and clear', async () => {
		const history = memory()
		const wb = new WorkbenchController(new FakeApi(), history)
		await wb.selectSchema('northwind/v1')
		wb.update({ query: 'Products.filter(p => p.price > minPrice)', data: '{"x": 1}' })
		await wb.fillParameters()
		expect(JSON.parse(wb.getState().data)).toEqual({ x: 1, minPrice: 0, entity: { name: '' } })
		wb.update({ query: 'Nope.filter(p => p)' })
		expect(await wb.validate()).toEqual([expect.objectContaining({ message: 'SchemaError: Entity Nope not found' })])
		wb.update({ query: 'Products' })
		expect(await wb.validate()).toEqual([])
		await wb.run('execute')
		wb.update({ query: 'other' })
		wb.restore(wb.getState().history[0])
		expect(wb.getState().query).toBe('Products')
		wb.clearHistory()
		expect(wb.getState().history).toEqual([])
		expect(history.saved['northwind/v1']).toBeUndefined()
	})

	test('the schema at the root ("") is a schema', async () => {
		const api = new FakeApi()
		const wb = new WorkbenchController(api, undefined)
		await wb.selectSchema('')
		wb.update({ query: 'Products' })
		expect((await wb.run('execute'))!.ok).toBe(true)
		expect(api.calls.at(-1)!.args[0]).toBe('')
	})

	test('a credential the schema refuses: a notice', async () => {
		const api = new FakeApi()
		api.whoami = async () => { throw Object.assign(new Error('a valid credential is required'), { name: 'Unauthorized', status: 401 }) }
		const wb = new WorkbenchController(api, undefined)
		await wb.selectSchema('northwind/v1')
		expect(wb.getState().notice).toBe('the credential is not valid for this schema')
	})
})

describe('infrastructure', () => {
	test('RestQueryApi: routes of the schema, headers on every request, errors with status and code', async () => {
		const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith('/typings')) return new Response('declare const X: 1', { status: 200 })
			if (url.endsWith('/execute')) return new Response(JSON.stringify({ error: 'Error', message: 'duplicate', code: '23505' }), { status: 409 })
			return new Response(JSON.stringify({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined }), { status: 200 })
		})
		const api = new RestQueryApi('http://gw/', () => ({ 'X-Api-Key': 'k' }), fetcher as any)
		expect(await api.plan('iot/v1', 'Q', { stage: 's' })).toEqual({ url: 'http://gw/iot/v1/plan', body: { query: 'Q', options: { stage: 's' } } })
		expect(await api.typings('iot/v1')).toBe('declare const X: 1')
		expect(await api.schemas()).toMatchObject({ url: 'http://gw/schemas' })
		expect((await api.whoami('') as any).url).toBe('http://gw/whoami')
		await expect(api.execute('iot/v1', 'Q')).rejects.toMatchObject({ status: 409, name: 'Error', message: 'duplicate', code: '23505' })
		expect(fetcher.mock.calls[0][1]!.headers).toEqual({ 'X-Api-Key': 'k', 'content-type': 'application/json' })
	})

	test('LocalStorageHistory: per schema; storage that fails keeps nothing', () => {
		const history = new LocalStorageHistory('t:')
		history.save('a', [{ mode: 'query', text: 'Q', data: '{}', options: '{}', at: 'x' }])
		expect(history.load('a')).toHaveLength(1)
		expect(history.load('b')).toEqual([])
		history.clear('a')
		expect(history.load('a')).toEqual([])
		const broken = new LocalStorageHistory('t:', () => { throw new Error('blocked') })
		expect(broken.load('a')).toEqual([])
		expect(() => broken.save('a', [])).not.toThrow()
	})
})
