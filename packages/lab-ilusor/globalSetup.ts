// Before the lab: its Postgres must be up, the tables created and in step with the model — a clear message instead of
// every test failing (docs/PLAN.md B3). A DDL fix (a type, a length) changes what setup creates: the tables of an older
// setup are then out of step and the lab asks for `npm run reset`.
import path from 'path'
import { Client } from 'pg'

export default async function (): Promise<void> {
	const client = new Client({ host: '127.0.0.1', port: 55432, user: 'admin', password: 'admin', database: 'ilusor', connectionTimeoutMillis: 3000 })
	try {
		await client.connect()
	} catch {
		throw new Error('the lab\'s Postgres is not up (127.0.0.1:55432): from packages/lab-ilusor run `npm run up && npm run setup`')
	}
	try {
		const result = await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema IN ('catalog', 'accounts', 'site')")
		if (result.rows[0].n === 0) {
			throw new Error('the lab\'s tables are not created: from packages/lab-ilusor run `npm run setup`')
		}
	} finally {
		await client.end()
	}
	await checkDrift()
}

/** stage.fetch of the lab's own model must be empty (L22) */
async function checkDrift (): Promise<void> {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const dotenv = require('dotenv')
	dotenv.config({ path: path.join(__dirname, '.env'), quiet: true })
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const { Orm } = require('@lambdaorm/lib')
	const orm = new Orm()
	try {
		await orm.init(path.join(__dirname, 'lambdaORM.yaml'))
		const mappings: any[] = await orm.stage.fetch({ stage: 'ddl' })
		const drift = mappings.flatMap(m => (m.entities || []).map((e: any) => `${e.name}: ${(e.differences || []).join('; ')}`))
		if (drift.length > 0) {
			throw new Error('the lab\'s tables are out of step with its model (an older setup?): from packages/lab-ilusor run ' +
				'`npm run reset`\n  ' + drift.join('\n  '))
		}
	} finally {
		await orm.end()
	}
}
