// uuid columns (Postgres dbType uuid), as Ilusor's Cloud has every id since 2026-11-20 (docs/LAMBDAORM_PENDING.md
// L36, L38). Own model (tests/uuid/lambdaORM.yaml) and own tables in schema lab_uuid, created here — the lab's model
// and its drift check are untouched.
import path from 'path'
import { Client } from 'pg'
import { Orm } from '../../../../lib'
import { id, newOrm } from './helpers'

// a schema of its own (the lab's drift check reads site, catalog and accounts): the lab's administrator creates it
const admin = { host: '127.0.0.1', port: 55432, user: 'admin', password: 'admin', database: 'ilusor' }
process.env.ORM_UUID_CNX = JSON.stringify({ ...admin, options: '-c search_path=lab_uuid' })

describe('uuid', () => {
	let orm: Orm
	beforeAll(async () => {
		const c = new Client(admin)
		await c.connect()
		await c.query(`CREATE SCHEMA IF NOT EXISTS lab_uuid;
			CREATE TABLE IF NOT EXISTS lab_uuid.uuid_tasks (id uuid PRIMARY KEY, name text NOT NULL);
			CREATE TABLE IF NOT EXISTS lab_uuid.uuid_task_steps (task_id uuid NOT NULL REFERENCES lab_uuid.uuid_tasks (id),
			  seq integer NOT NULL, code varchar(64), PRIMARY KEY (task_id, seq))`)
		await c.end()
		orm = await newOrm(path.join(__dirname, 'uuid', 'lambdaORM.yaml'))
	})
	afterAll(async () => { await orm.end() })

	const newTask = async (name: string) => {
		const taskId = id()
		await orm.execute('UuidTasks.insert()', { id: taskId, name })
		await orm.execute('UuidTaskSteps.insert()', { taskId, seq: 1, code: 'http.call' })
		await orm.execute('UuidTaskSteps.insert()', { taskId, seq: 2, code: 'http.call' })
		return taskId
	}

	test('L36 include of the children of one parent by a uuid key', async () => {
		const taskId = await newTask('one-' + id())
		const [task] = await orm.execute('UuidTasks.filter(p => p.id == id).include(p => p.steps)', { id: taskId })
		expect(task.steps).toHaveLength(2)
	})

	test('L36 include of the children of several parents by a uuid key (task_id IN (…))', async () => {
		const name = 'many-' + id()
		await newTask(name)
		await newTask(name)
		const tasks = await orm.execute('UuidTasks.filter(p => p.name == name).include(p => p.steps)', { name })
		expect(tasks).toHaveLength(2)
		for (const t of tasks) expect(t.steps).toHaveLength(2)
	})

	test('L38 fetch: a uuid column is what the model says (dbType uuid), no drift', async () => {
		const mappings: any[] = await orm.stage.fetch({ stage: 'ddl' })
		const drift = mappings.flatMap(m => (m.entities || []).flatMap((e: any) => e.differences || []))
		expect(drift).toEqual([])
	})
})
