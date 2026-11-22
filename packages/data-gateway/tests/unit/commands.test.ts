// The commands of a workspace as jobs, without a database (docs/DATA_GATEWAY_ADMIN_PLAN.md §4): the preview that a
// command which changes the databases needs, one job at a time per schema, the permissions and what a job keeps.
import { CommandService, rowsPerEntity } from '../../src/lib/application/admin/commandService'
import { principal } from '../../src/lib/domain/auth/principal'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { FixedClock } from '../helpers/fakes'

const files = new Map<string, string>([['/w/shop/lambdaORM.yaml', 'v1']])
const store: any = {
	read: async (ws: string, file: string) => files.has(`${ws}/${file}`) ? { text: files.get(`${ws}/${file}`), version: files.get(`${ws}/${file}`), modified: 'now' } : undefined,
	write: async (ws: string, file: string, text: string) => { files.set(`${ws}/${file}`, text); return 'v' }
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
			return []
		}
	}
	const service = new CommandService({ anonymousAdmin: false, timeoutMs: 1000, previewTtlMs: 60000, keepJobs: 10 }, () => [schema], store, new FixedClock(), new ConsoleLogger('error'))
	return { service, calls, release: () => release() }
}
const admin = principal('admin', ['read', 'ddl', 'stageImport', 'workbenchWrite'])
const reader = principal('reader', ['read'])
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

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
		files.set('/w/shop/lambdaORM.yaml', 'v2')
		await expect(service.run(admin, 'shop', 'drop', { previewId: preview.previewId })).rejects.toMatchObject({ message: expect.stringMatching(/changed since the preview/) })
		files.set('/w/shop/lambdaORM.yaml', 'v1')
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
