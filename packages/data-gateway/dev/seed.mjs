// The workspace of the dev gateway (docs/VECTOR_POINT_SQLJS.md §2), only the first time: dev/workspace is yours (not in
// git) and is never replaced. Without dev/workspace/northwind it copies dev/seed/northwind (the schema of the conformance
// suite on SQLite, sql.js), writes the path of its database in its .env, creates the tables (push) and imports the
// data of the conformance suite. Delete dev/workspace/northwind to start again.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// @lambdaorm/lib is CommonJS (its exports only for require)
const { Orm } = createRequire(import.meta.url)('@lambdaorm/lib')

const here = path.dirname(fileURLToPath(import.meta.url))
// DEV_WORKSPACE: another folder for it (the tests)
const workspace = process.env.DEV_WORKSPACE ? path.resolve(process.env.DEV_WORKSPACE) : path.join(here, 'workspace', 'northwind')
const database = path.join(workspace, 'data', 'northwind.sqlite')

if (fs.existsSync(path.join(workspace, 'lambdaORM.yaml'))) {
	console.log(`[dev] ${path.relative(process.cwd(), workspace)} is there: left as it is`)
	process.exit(0)
}
fs.mkdirSync(path.dirname(database), { recursive: true })
fs.copyFileSync(path.join(here, 'seed', 'northwind', 'lambdaORM.yaml'), path.join(workspace, 'lambdaORM.yaml'))
fs.writeFileSync(path.join(workspace, '.env'), `NORTHWIND_SQLITE=${database}\n`)
process.env.NORTHWIND_SQLITE = database

const orm = new Orm()
try {
	await orm.init(workspace)
	await orm.stage.push({ stage: 'default' }).execute()
	const data = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'conformance', 'data.json'), 'utf8'))
	await orm.stage.import({ stage: 'default' }).execute(data)
	const [{ orders }] = await orm.execute('Orders.map(p => ({ orders: count(1) }))')
	console.log(`[dev] ${path.relative(process.cwd(), workspace)}: northwind on SQLite, ${orders} orders (${path.relative(process.cwd(), database)})`)
} finally {
	// sql.js writes its file when the pool ends
	await orm.end()
}
