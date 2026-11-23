import path from 'path'
import { randomUUID } from 'crypto'
import dotenv from 'dotenv'
import { Client } from 'pg'
import { Orm } from '@lambdaorm/lib'

export const workspace = path.join(__dirname, '..')
dotenv.config({ path: path.join(workspace, '.env') })

export const id = (): string => randomUUID()

/** A new Orm on the lab's schema (each spec its own, ended in afterAll). */
export async function newOrm (schemaPath = path.join(workspace, 'lambdaORM.yaml')): Promise<Orm> {
	const orm = new Orm()
	await orm.init(schemaPath)
	return orm
}

/** Rows left by earlier runs don't matter: every test writes its own ids. Only this helper empties the tables. */
export async function truncateAll (orm: Orm): Promise<void> {
	await orm.stage.truncate({ stage: 'ddl' }).execute()
}

/** Whatever the update/delete answered, as a number of affected rows (undefined if it doesn't say). */
export function affected (result: any): number | undefined {
	if (typeof result === 'number') return result
	if (result && typeof result === 'object') {
		for (const key of ['affectedRows', 'rowCount', 'count', 'changes']) {
			if (typeof result[key] === 'number') return result[key]
		}
	}
	return undefined
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Service under test (ORM_URL); its specs run only with ORM_SVC=1. */
export const svcUrl = process.env.ORM_URL || 'http://127.0.0.1:59291'
export const describeSvc = (name: string, fn: () => void) => (process.env.ORM_SVC === '1' ? describe : describe.skip)(name, fn)

/** The service's token (SERVICE_TOKEN of the service under test), sent by svc() unless a test says otherwise */
export const svcToken = process.env.ORM_SVC_TOKEN

export async function svc (route: string, body?: any, headers: Record<string, string | undefined> = {}): Promise<{ status: number, body: any }> {
	const all: Record<string, string | undefined> = { 'Content-Type': 'application/json', ...(svcToken ? { Authorization: `Bearer ${svcToken}` } : {}), ...headers }
	const res = await fetch(svcUrl + route, {
		method: body === undefined ? 'GET' : 'POST',
		headers: Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined)) as Record<string, string>,
		body: body === undefined ? undefined : JSON.stringify(body)
	})
	const text = await res.text()
	let parsed: any = text
	try { parsed = JSON.parse(text) } catch { /* plain text */ }
	return { status: res.status, body: parsed }
}

/** A column as Postgres has it (information_schema), read with the admin user — to check what push created. */
export async function pgColumn (schema: string, table: string, column: string): Promise<any> {
	const client = new Client({ host: '127.0.0.1', port: 55432, user: 'admin', password: 'admin', database: 'ilusor' })
	await client.connect()
	try {
		const res = await client.query(
			'SELECT data_type, datetime_precision, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3',
			[schema, table, column])
		return res.rows[0]
	} finally {
		await client.end()
	}
}
