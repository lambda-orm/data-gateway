// The commands of a workspace as jobs (docs/DATA_GATEWAY_ADMIN_PLAN.md §4, phase 3a), on a real PostgreSQL: push and
// drop only after their preview and with the same lambdaORM.yaml, fetch, export (also saved in data/), import with the
// rows it will write, and the permissions. Needs DATA_GATEWAY_TEST_POSTGRES, the connection of an empty database
// ({"host":"127.0.0.1","port":55432,"user":"postgres","password":"…","database":"shop"}); skipped without it.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { startGateway } from '../../src/lib/infrastructure/build/main'
import { RunningGateway } from '../../src/lib/infrastructure/build/dataGatewayBuilder'
import { YamlFileConfigSource } from '../../src/lib/infrastructure/output/config/yamlFileConfigSource'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { call, freePort } from '../helpers/net'

const ADMIN = { 'X-Api-Key': 'admin-key' }
const READER = { 'X-Api-Key': 'reader-key' }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const POSTGRES = process.env.DATA_GATEWAY_TEST_POSTGRES

;(POSTGRES ? describe : describe.skip)('commands of a workspace (PostgreSQL)', () => {
	let gateway: RunningGateway
	let base: string
	let workspace: string
	const commands = '/admin/workspaces/shop/commands'

	const schemaOf = () => `
domain:
  entities:
    - name: Categories
      primaryKey: [id]
      uniqueKey: [name]
      properties:
        - { name: id, type: integer, required: true, autoIncrement: true }
        - { name: name, type: string, length: 80, required: true }
infrastructure:
  mappings:
    - name: default
  sources:
    - name: main
      dialect: PostgreSQL
      mapping: default
      connection: ${POSTGRES}
  stages:
    - name: default
      sources:
        - name: main
`

	/** Waits for a job to end */
	const finished = async (id: string) => {
		for (let i = 0; i < 100; i++) {
			const job = (await call(base, `/admin/workspaces/shop/jobs/${id}`, { headers: ADMIN })).body
			if (job.status !== 'running') return job
			await sleep(50)
		}
		throw new Error(`job ${id} did not end`)
	}

	beforeAll(async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-gateway-commands-'))
		workspace = path.join(root, 'shop')
		fs.mkdirSync(workspace)
		fs.writeFileSync(path.join(workspace, 'lambdaORM.yaml'), schemaOf())
		const port = await freePort()
		const file = path.join(root, 'data-gateway.config.yaml')
		fs.writeFileSync(file, `
orm: { workspacePath: ${root} }
admin: { enabled: true }
logger: { level: error }
audit: { enabled: false }
rateLimit: { max: 0 }
authentication:
  adapter: local
  type: apikey
  keys:
    - { name: admin, value: admin-key, permissions: [ read, write, stageImport, ddl, schemaRead, schemaWrite, workbenchWrite ] }
    - { name: reader, value: reader-key, permissions: [ read ] }
transports:
  http: { port: ${port}, host: 127.0.0.1 }
`)
		gateway = await startGateway({ source: new YamlFileConfigSource(file, {}), bootLogger: new ConsoleLogger('error') })
		base = `http://127.0.0.1:${port}`
	}, 60000)
	afterAll(() => gateway?.stop())

	test('the panel: the stages and what each credential may run', async () => {
		expect((await call(base, commands, { headers: ADMIN })).body).toMatchObject({ stages: ['default'], can: { push: true, drop: true, import: true, export: true, fetch: true } })
		expect((await call(base, commands, { headers: READER })).body.can).toMatchObject({ push: false, drop: false, import: false, fetch: true })
		expect((await call(base, `${commands}/version`, { method: 'POST', body: {}, headers: READER })).body).toMatchObject({ version: expect.any(String) })
	})

	test('push only runs its preview: the sentences first, then a job that creates the tables', async () => {
		expect((await call(base, `${commands}/push`, { body: {}, headers: ADMIN })).body.error).toBe('PreviewRequiredError')
		expect((await call(base, `${commands}/push/preview`, { body: {}, headers: READER })).status).toBe(403)
		const preview = await call(base, `${commands}/push/preview`, { body: { stage: 'default' }, headers: ADMIN })
		expect(preview.body).toMatchObject({ previewId: expect.any(String), stage: 'default', sentences: [{ source: 'main', sentences: expect.arrayContaining([expect.stringMatching(/CREATE TABLE/i)]) }] })
		const started = await call(base, `${commands}/push`, { body: { previewId: preview.body.previewId }, headers: ADMIN })
		expect(started).toMatchObject({ status: 202, body: { command: 'push', stage: 'default', status: 'running', credential: 'admin' } })
		const job = await finished(started.body.id)
		expect(job).toMatchObject({ status: 'done' })
		// a preview runs once
		expect((await call(base, `${commands}/push`, { body: { previewId: preview.body.previewId }, headers: ADMIN })).body.error).toBe('PreviewRequiredError')
		// the table is there: a row can be written
		expect((await call(base, '/shop/execute', { body: { query: 'Categories.insert()', data: { name: 'Beverages' } }, headers: ADMIN })).status).toBe(200)
	})

	test('fetch and export are jobs; an export can be saved in data/', async () => {
		const fetched = await finished((await call(base, `${commands}/fetch`, { body: {}, headers: READER })).body.id)
		expect(fetched.status).toBe('done')
		const exported = await finished((await call(base, `${commands}/export`, { body: { save: true }, headers: ADMIN })).body.id)
		expect(exported).toMatchObject({ status: 'done', file: expect.stringMatching(/^data\/default-.*\.json$/) })
		expect(JSON.stringify(exported.result)).toContain('Beverages')
		expect(fs.readFileSync(path.join(workspace, exported.file), 'utf8')).toContain('Beverages')
		expect((await call(base, `${commands}/export`, { body: { save: true }, headers: READER })).status).toBe(403)
		const jobs = (await call(base, '/admin/workspaces/shop/jobs', { headers: READER })).body
		expect(jobs.map((j: any) => j.command)).toEqual(['export', 'fetch', 'push'])
		expect(jobs[0].result).toBeUndefined()
		// each job leaves its record next to the state of λORM
		expect(fs.readdirSync(path.join(workspace, 'orm_state/jobs')).length).toBeGreaterThanOrEqual(3)
	})

	test('import: the rows of each entity first, then the job', async () => {
		const exported = (await call(base, '/shop/stages/default/export', { headers: ADMIN })).body
		const data = { ...exported, entities: exported.entities.map((e: any) => ({ ...e, rows: e.rows.map((r: any) => ({ ...r, id: r.id + 100, name: `${r.name} 2` })) })) }
		const preview = await call(base, `${commands}/import/preview`, { body: { data }, headers: ADMIN })
		expect(preview.body).toMatchObject({ rows: { Categories: 1 } })
		const job = await finished((await call(base, `${commands}/import`, { body: { previewId: preview.body.previewId }, headers: ADMIN })).body.id)
		expect(job.status).toBe('done')
		expect((await call(base, '/shop/execute', { body: { query: 'Categories.map(p => p.name).sort(p => p.name)' }, headers: READER })).body).toEqual([{ name: 'Beverages' }, { name: 'Beverages 2' }])
	})

	test('drop: a preview made with another lambdaORM.yaml is not run', async () => {
		const preview = await call(base, `${commands}/drop/preview`, { body: {}, headers: ADMIN })
		expect(preview.body.sentences.length).toBeGreaterThan(0)
		fs.appendFileSync(path.join(workspace, 'lambdaORM.yaml'), '# changed\n')
		expect((await call(base, `${commands}/drop`, { body: { previewId: preview.body.previewId }, headers: ADMIN })).body).toMatchObject({ error: 'PreviewRequiredError', message: expect.stringMatching(/changed since the preview/) })
		const again = await call(base, `${commands}/drop/preview`, { body: {}, headers: ADMIN })
		const job = await finished((await call(base, `${commands}/drop`, { body: { previewId: again.body.previewId }, headers: ADMIN })).body.id)
		expect(job.status).toBe('done')
		expect((await call(base, '/shop/execute', { body: { query: 'Categories.map(p => p.name)' }, headers: READER })).status).not.toBe(200)
	})
})
