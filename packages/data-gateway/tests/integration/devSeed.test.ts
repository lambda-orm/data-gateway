// The workspace of the dev gateway (docs/VECTOR_POINT_SQLJS.md §2): northwind on SQLite (sql.js) with the data of the
// conformance suite, created once and never replaced, so the dev gateway needs no database server.
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Orm } from '@lambdaorm/lib'

const seed = path.join(__dirname, '..', '..', 'dev', 'seed.mjs')
let dir: string

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-dev-seed-')) })
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

test('seeded once: the schema on SQLite with its data; a second time, left as it is', async () => {
	const workspace = path.join(dir, 'northwind')
	const first = execFileSync('node', [seed], { env: { ...process.env, DEV_WORKSPACE: workspace }, encoding: 'utf8' })
	expect(first).toContain('northwind on SQLite, 830 orders')
	const database = path.join(workspace, 'data', 'northwind.sqlite')
	expect(fs.readFileSync(path.join(workspace, '.env'), 'utf8')).toBe(`NORTHWIND_SQLITE=${database}\n`)
	process.env.NORTHWIND_SQLITE = database
	const orm = new Orm()
	try {
		await orm.init(workspace)
		expect(await orm.execute('Customers.filter(p => p.country == c).map(p => p.id).sort(p => p.id).page(1, 2)', { c: 'Germany' })).toEqual([{ id: 'ALFKI' }, { id: 'BLAUS' }])
	} finally {
		await orm.end()
	}
	const before = fs.statSync(database).mtimeMs
	const second = execFileSync('node', [seed], { env: { ...process.env, DEV_WORKSPACE: workspace }, encoding: 'utf8' })
	expect(second).toContain('is there: left as it is')
	expect(fs.statSync(database).mtimeMs).toBe(before)
}, 60000)
