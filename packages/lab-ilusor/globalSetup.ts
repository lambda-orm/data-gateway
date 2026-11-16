// Before the lab: its Postgres must be up and the tables created — a clear message instead of every test failing.
import { Client } from 'pg'

export default async function (): Promise<void> {
	const client = new Client({ host: '127.0.0.1', port: 55432, user: 'admin', password: 'admin', database: 'ilusor', connectionTimeoutMillis: 3000 })
	try {
		await client.connect()
	} catch {
		throw new Error('the lab\'s Postgres is not up (127.0.0.1:55432): from packages/lib run `npm run lab:ilusor:up && npm run lab:ilusor:setup`')
	}
	try {
		const result = await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema IN ('catalog', 'accounts', 'site')")
		if (result.rows[0].n === 0) {
			throw new Error('the lab\'s tables are not created: from packages/lib run `npm run lab:ilusor:setup`')
		}
	} finally {
		await client.end()
	}
}
