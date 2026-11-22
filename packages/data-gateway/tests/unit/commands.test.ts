// The commands of a workspace as jobs, without a database (docs/DATA_GATEWAY_ADMIN_PLAN.md §4): the preview that a
// command which changes the databases needs, one job at a time per schema, the permissions and what a job keeps.
import { CommandService, rowsPerEntity } from '../../src/lib/application/admin/commandService'
import { principal } from '../../src/lib/domain/auth/principal'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { FixedClock } from '../helpers/fakes'
import { YamlAdapter } from '../../src/lib/infrastructure/output/admin/yamlAdapter'

const SCHEMA = 'domain:\n  entities:\n    # sold\n    - name: A\n      properties: [{name: id}]\n'
const files = new Map<string, string>([['/w/shop/lambdaORM.yaml', SCHEMA]])
const store: any = {
	read: async (ws: string, file: string) => files.has(`${ws}/${file}`) ? { text: files.get(`${ws}/${file}`), version: files.get(`${ws}/${file}`), modified: 'now' } : undefined,
	write: async (ws: string, file: string, text: string, expected?: string) => {
		if (expected !== undefined && files.get(`${ws}/${file}`) !== expected) throw Object.assign(new Error('changed'), { name: 'VersionConflict' })
		files.set(`${ws}/${file}`, text)
		return text
	},
	withLock: async (_ws: string, task: () => Promise<unknown>) => task()
}

const setup = () => {
	const calls: string[] = []
	let release: () => void = () => undefined
	const schema: any = {
		path: 'shop',
		workspace: '/w/shop',
		gateway: { version: async () => ({ version: '3.2.0' }) },
		commands: async (ctx: any, op: string, args: unknown[]) => {
			calls.push(`${op} ${JSON.stringify(args)} as ${ctx.principal.name}:${[...ctx.principal.permissions].join(',')}`)
			if (op === 'stages') return ['default', 'test']
			if (op === 'pushSentences') return [{ source: 'main', sentences: ['CREATE TABLE A (id INT)'] }]
			if (op === 'push') await new Promise<void>(resolve => { release = resolve })
			if (op === 'export') return { entities: [{ entity: 'A', rows: [{ id: 1 }] }] }
			const withB = { domain: { entities: [{ name: 'A', properties: [{ name: 'id' }] }, { name: 'B', properties: [{ name: 'id' }] }] } }
			if (op === 'pullSchema' || op === 'pull') return withB
			if (op === 'introspectSchema') return { schema: withB, data: { entities: [{ entity: 'B', rows: [{ id: 1 }, { id: 2 }] }] } }
			return []
		}
	}
	let since = 'one'
	const service = new CommandService({
		anonymousAdmin: false, timeoutMs: 1000, previewTtlMs: 60000, keepJobs: 10,
		since: () => since,
		reloaded: async (_path, before) => { if (before === since) since = 'two' }
	}, () => [schema], store, new YamlAdapter(), new FixedClock(), new ConsoleLogger('error'))
	return { service, calls, release: () => release() }
}
const admin = principal('admin', ['read', 'ddl', 'stageImport', 'workbenchWrite'])
const reader = principal('reader', ['read'])
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const ended = async (service: CommandService, who: any, id: string) => { for (let i = 0; i < 100 && service.job(who, 'shop', id).status === 'running'; i++) await tick(); return service.job(who, 'shop', id) }

describe('commands as jobs', () => {
	test('push runs only its preview, once, on the stage it showed; one job at a time', async () => {
		const { service, calls, release } = setup()
		await expect(service.run(admin, 'shop', 'push', {})).rejects.toMatchObject({ status: 409, name: 'PreviewRequiredError' })
		await expect(service.preview(reader, 'shop', 'push', {})).rejects.toMatchObject({ status: 403 })
		const preview = await service.preview(admin, 'shop', 'push', { stage: 'test' })
		expect(preview).toMatchObject({ stage: 'test', sentences: [{ source: 'main', sentences: ['CREATE TABLE A (id INT)'] }] })
		const job = await service.run(admin, 'shop', 'push', { previewId: preview.previewId, force: true }) as any
		expect(job).toMatchObject({ command: 'push', stage: 'test', status: 'running', credential: 'admin' })
		expect(calls.at(-1)).toBe('push ["test",true] as admin:read,ddl,stageImport,workbenchWrite')
		await expect(service.run(admin, 'shop', 'fetch', {})).rejects.toMatchObject({ status: 409, name: 'BusyError' })
		release()
		await tick()
		await tick()
		expect(service.job(admin, 'shop', job.id)).toMatchObject({ status: 'done', finishedAt: expect.any(String) })
		await expect(service.run(admin, 'shop', 'push', { previewId: preview.previewId })).rejects.toMatchObject({ name: 'PreviewRequiredError' })
	})

	test('a preview of another lambdaORM.yaml is not run', async () => {
		const { service } = setup()
		const preview = await service.preview(admin, 'shop', 'drop', {})
		files.set('/w/shop/lambdaORM.yaml', SCHEMA + '# changed\n')
		await expect(service.run(admin, 'shop', 'drop', { previewId: preview.previewId })).rejects.toMatchObject({ message: expect.stringMatching(/changed since the preview/) })
		files.set('/w/shop/lambdaORM.yaml', SCHEMA)
	})

	test('export saved in data/ needs workbenchWrite; the result only in the job alone', async () => {
		const { service } = setup()
		await expect(service.run(reader, 'shop', 'export', { save: true })).rejects.toMatchObject({ status: 403 })
		const job = await service.run(admin, 'shop', 'export', { save: true }) as any
		await tick()
		await tick()
		expect(service.job(admin, 'shop', job.id)).toMatchObject({ status: 'done', file: expect.stringMatching(/^data\/default-/), result: { entities: [{ entity: 'A' }] } })
		expect(service.jobsOf(reader, 'shop')[0].result).toBeUndefined()
		expect([...files.keys()].some(f => f.startsWith('/w/shop/orm_state/jobs/'))).toBe(true)
	})

	test('import shows the rows of each entity; the panel says what may be run', async () => {
		const { service } = setup()
		expect(rowsPerEntity({ entities: [{ entity: 'A', rows: [{}, {}] }, { entity: 'B', rows: [] }] })).toEqual({ A: 2, B: 0 })
		await expect(service.preview(admin, 'shop', 'import', {})).rejects.toMatchObject({ status: 400 })
		expect(await service.summary(reader, 'shop')).toMatchObject({ stages: ['default', 'test'], can: { fetch: true, push: false, import: false } })
		await expect(service.run(admin, 'shop', 'nope', {})).rejects.toMatchObject({ status: 404 })
		expect(await service.run(reader, 'shop', 'version', {})).toEqual({ version: '3.2.0', schema: 'shop' })
	})
})

describe('commands that change the schema', () => {
	const owner = principal('owner', ['read', 'ddl', 'stageImport', 'schemaWrite'])

	test('pull: the diff of the lambdaORM.yaml first; then written keeping its comments, with the state of the stage', async () => {
		const { service, calls } = setup()
		await expect(service.preview(admin, 'shop', 'pull', {})).rejects.toMatchObject({ status: 403 })
		const preview = await service.preview(owner, 'shop', 'pull', {}) as any
		expect(preview.diff).toMatchObject({ added: 3, removed: 0 })
		expect(preview.diff.hunks[0].lines.filter((l: any) => l.op === '+').map((l: any) => l.text.trim())).toEqual(['- name: B', 'properties:', '- name: id'])
		const job = await service.run(owner, 'shop', 'pull', { previewId: preview.previewId }) as any
		expect(await ended(service, owner, job.id)).toMatchObject({ status: 'done', result: { file: 'lambdaORM.yaml', added: 3 } })
		expect(calls.some(c => c.startsWith('pull ["default"]'))).toBe(true)
		expect(files.get('/w/shop/lambdaORM.yaml')).toContain('# sold')
		expect(files.get('/w/shop/lambdaORM.yaml')).toContain('- name: B')
		files.set('/w/shop/lambdaORM.yaml', SCHEMA)
	})

	test('incorporate: the diff and the rows; written, then (reloaded) pushed and imported', async () => {
		const { service, calls, release } = setup()
		await expect(service.preview(principal('w', ['read', 'schemaWrite']), 'shop', 'incorporate', { data: [{ id: 1 }], name: 'B' })).rejects.toMatchObject({ status: 403 })
		const preview = await service.preview(owner, 'shop', 'incorporate', { data: [{ id: 1 }, { id: 2 }], name: 'B' }) as any
		expect(preview).toMatchObject({ rows: { B: 2 }, diff: { added: 3 } })
		const job = await service.run(owner, 'shop', 'incorporate', { previewId: preview.previewId }) as any
		// the push of the fake waits to be let go
		for (let i = 0; i < 20 && !calls.some(c => c.startsWith('push ')); i++) await tick()
		release()
		expect(await ended(service, owner, job.id)).toMatchObject({ status: 'done', result: { imported: { B: 2 } } })
		expect(calls.filter(c => /^(push|import) /.test(c)).map(c => c.split(' ')[0])).toEqual(['push', 'import'])
		files.set('/w/shop/lambdaORM.yaml', SCHEMA)
	})
})
