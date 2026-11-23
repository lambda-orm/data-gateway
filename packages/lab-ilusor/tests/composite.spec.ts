// Relations of several fields (docs/LAMBDAORM_PENDING.md L34), as Ilusor's iot_location keys them: (locationId, x).
// Own model (tests/composite/lambdaORM.yaml) and tables in schema lab_composite, created here by push.
import path from 'path'
import { randomUUID } from 'crypto'
import { Client } from 'pg'
import { Orm } from '@lambdaorm/lib'
import { newOrm } from './helpers'

const admin = { host: '127.0.0.1', port: 55432, user: 'admin', password: 'admin', database: 'ilusor' }
process.env.ORM_COMPOSITE_CNX = JSON.stringify({ ...admin, options: '-c search_path=lab_composite' })

describe('composite', () => {
	let orm: Orm
	// two locations with the same area code and the same device id
	const locA = randomUUID()
	const locB = randomUUID()
	beforeAll(async () => {
		const c = new Client(admin)
		await c.connect()
		await c.query('DROP SCHEMA IF EXISTS lab_composite CASCADE; CREATE SCHEMA lab_composite')
		await c.end()
		orm = await newOrm(path.join(__dirname, 'composite', 'lambdaORM.yaml'))
		await orm.stage.push({ stage: 'default' }).execute()
		for (const [loc, name] of [[locA, 'Living A'], [locB, 'Living B']]) {
			await orm.execute('CmpAreas.insert()', { locationId: loc, code: 'living', name })
			await orm.execute('CmpDevices.insert()', { locationId: loc, id: '0x00158d0001', name: 'sensor ' + name, areaId: 'living' })
		}
	})
	afterAll(async () => { await orm.end() })

	test('L34 push creates a foreign key of several columns', async () => {
		const c = new Client(admin)
		await c.connect()
		const r = await c.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
			WHERE contype = 'f' AND conrelid = 'lab_composite.cmp_devices'::regclass`)
		await c.end()
		expect(r.rows.map((p: any) => p.def)).toContainEqual(expect.stringMatching(/^FOREIGN KEY \(location_id, area_id\) REFERENCES (lab_composite\.)?cmp_areas\(location_id, code\)/))
	})

	test('L34 include by a relation of several fields: each device its own location\'s area', async () => {
		const devices = await orm.execute('CmpDevices.filter(p => p.id == "0x00158d0001").include(p => p.area)')
		expect(devices).toHaveLength(2)
		for (const d of devices) expect(d.area.name).toBe(d.locationId === locA ? 'Living A' : 'Living B')
	})

	test('L34 the inverse (target): an area\'s devices are only its location\'s', async () => {
		const [area] = await orm.execute('CmpAreas.filter(p => p.locationId == loc && p.code == "living").include(p => p.devices)', { loc: locA })
		expect(area.devices).toHaveLength(1)
		expect(area.devices[0].locationId).toBe(locA)
	})

	test('L34 a field of the relation in map and filter joins on every field', async () => {
		const rows = await orm.execute('CmpDevices.filter(p => p.area.name == "Living B").map(p => ({ loc: p.locationId, area: p.area.name }))')
		expect(rows).toEqual([{ loc: locB, area: 'Living B' }])
	})

	test('L34 composite children: saved with the parent\'s whole key, pruned only in its location', async () => {
		await orm.execute('CmpDevices.insert().include(p => p.links)', { locationId: locA, id: '0xaaaa', name: 'switch A', links: [{ position: 0, linkKey: 'mirror' }, { position: 1, linkKey: 'proxy' }] })
		await orm.execute('CmpDevices.insert().include(p => p.links)', { locationId: locB, id: '0xaaaa', name: 'switch B', links: [{ position: 0, linkKey: 'mirror' }] })
		await orm.execute('CmpDevices.update().include(p => p.links)', { locationId: locA, id: '0xaaaa', name: 'switch A', links: [{ position: 1, linkKey: 'proxy' }] })
		const [a] = await orm.execute('CmpDevices.filter(p => p.locationId == loc && p.id == "0xaaaa").include(p => p.links)', { loc: locA })
		const [b] = await orm.execute('CmpDevices.filter(p => p.locationId == loc && p.id == "0xaaaa").include(p => p.links)', { loc: locB })
		expect(a.links.map((p: any) => p.position)).toEqual([1])
		expect(b.links.map((p: any) => p.linkKey)).toEqual(['mirror'])
	})
})
