// Ilusor writes what an insert drags to other tables with schema listeners (docs/LAMBDAORM_PENDING.md L10, L11).
// The lab's listener: inserting an InstallationFile sets its Installation's lastEventAt.
// Listeners are awaited one after the other and run in the sentence's transaction (an implicit one when the sentence
// runs alone): their orm.execute uses the same connections, an error fails the sentence and rolls everything back.
// `transactional: false` runs a listener outside the transaction.
import { Orm } from '../../../../lib'
import fs from 'fs'
import os from 'os'
import path from 'path'
import yaml from 'js-yaml'
import { id, newOrm, workspace } from './helpers'

describe('listeners', () => {
	let orm: Orm
	beforeAll(async () => { orm = await newOrm() })
	afterAll(async () => { await orm.end() })

	const newInstallation = async () => {
		const installationId = id(); const accountId = id(); const locationId = id()
		await orm.execute('Accounts.insert()', { id: accountId, name: 'listeners' })
		await orm.execute('Locations.insert()', { id: locationId, accountId, name: 'home' })
		await orm.execute('Installations.insert()', { id: installationId, locationId, status: 'requested', version: 1 })
		return installationId
	}

	test('L10 the after listener has finished when execute returns', async () => {
		const installationId = await newInstallation()
		const uploadedAt = new Date('2026-11-16T12:00:00.000Z')
		await orm.execute('InstallationFiles.insert()', { id: id(), installationId, name: 'plan.pdf', uploadedAt })
		const [installation] = await orm.execute('Installations.filter(p => p.id == id)', { id: installationId })
		expect(installation.lastEventAt).toBeTruthy()
		expect(new Date(installation.lastEventAt).toISOString()).toBe(uploadedAt.toISOString())
	})

	test('L10 the after listener runs in the transaction of the sentence: a rollback undoes it too', async () => {
		const installationId = await newInstallation()
		const fileId = id()
		await expect(orm.transaction({ stage: 'default' }, async tr => {
			await tr.execute('InstallationFiles.insert()', { id: fileId, installationId, name: 'x.pdf', uploadedAt: new Date() })
			await tr.execute('InstallationFiles.insert()', { id: fileId, installationId, name: 'duplicate key', uploadedAt: new Date() })
		})).rejects.toThrow()
		await new Promise(resolve => setTimeout(resolve, 500)) // give a detached listener time to show itself
		expect(await orm.execute('InstallationFiles.filter(p => p.id == id)', { id: fileId })).toHaveLength(0)
		const [installation] = await orm.execute('Installations.filter(p => p.id == id)', { id: installationId })
		expect(installation.lastEventAt ?? null).toBeNull()
	})

	test('L10 an error in the after listener fails the sentence (and rolls it back)', async () => {
		// a file for an installation that doesn't exist: the listener's update changes 0 rows — not an error by itself.
		// Until the listener can fail, this documents that a broken listener expression is not reported:
		const source = fs.readFileSync(path.join(workspace, 'lambdaORM.yaml'), 'utf8')
		const schema: any = yaml.load(source)
		schema.application.listeners = [{
			name: 'broken', on: ['insert'], condition: 'entity == "InstallationFiles"', after: 'orm.execute("Nope.insert()", {})'
		}]
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilusor-cloud-lab-'))
		fs.writeFileSync(path.join(dir, 'lambdaORM.yaml'), yaml.dump(schema))
		const broken = await newOrm(path.join(dir, 'lambdaORM.yaml'))
		try {
			const installationId = await newInstallation()
			const fileId = id()
			await expect(broken.execute('InstallationFiles.insert()', { id: fileId, installationId, name: 'y.pdf', uploadedAt: new Date() }))
				.rejects.toThrow()
			expect(await orm.execute('InstallationFiles.filter(p => p.id == id)', { id: fileId })).toHaveLength(0)
		} finally {
			await broken.end()
		}
	})

	/** An Orm on a copy of the lab's schema with these listeners instead of the lab's. */
	const ormWithListeners = async (listeners: any[]): Promise<Orm> => {
		const schema: any = yaml.load(fs.readFileSync(path.join(workspace, 'lambdaORM.yaml'), 'utf8'))
		schema.application.listeners = listeners
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilusor-cloud-lab-'))
		fs.writeFileSync(path.join(dir, 'lambdaORM.yaml'), yaml.dump(schema))
		return newOrm(path.join(dir, 'lambdaORM.yaml'))
	}

	test('L10 an error in a before listener prevents the sentence', async () => {
		const other = await ormWithListeners([{ name: 'refuse', on: ['insert'], condition: 'entity == "InstallationFiles"', before: 'throw "files are closed"' }])
		try {
			const installationId = await newInstallation()
			const fileId = id()
			await expect(other.execute('InstallationFiles.insert()', { id: fileId, installationId, name: 'b.pdf', uploadedAt: new Date() }))
				.rejects.toThrow(/^files are closed$/)
			expect(await orm.execute('InstallationFiles.filter(p => p.id == id)', { id: fileId })).toHaveLength(0)
		} finally {
			await other.end()
		}
	})

	test('L10 a listener with transactional: false runs outside the transaction: its write survives a rollback', async () => {
		const other = await ormWithListeners([{
			name: 'audit',
			on: ['insert'],
			condition: 'entity == "InstallationFiles"',
			transactional: false,
			after: 'orm.execute("Installations.update(p => ({ lastEventAt: at })).filter(p => p.id == id)", { id: data.installationId, at: data.uploadedAt })'
		}])
		try {
			const installationId = await newInstallation()
			const fileId = id()
			const uploadedAt = new Date('2026-11-16T13:00:00.000Z')
			await expect(other.transaction({ stage: 'default' }, async tr => {
				await tr.execute('InstallationFiles.insert()', { id: fileId, installationId, name: 'a.pdf', uploadedAt })
				throw new Error('abort')
			})).rejects.toThrow('abort')
			expect(await orm.execute('InstallationFiles.filter(p => p.id == id)', { id: fileId })).toHaveLength(0)
			const [installation] = await orm.execute('Installations.filter(p => p.id == id)', { id: installationId })
			expect(new Date(installation.lastEventAt).toISOString()).toBe(uploadedAt.toISOString())
		} finally {
			await other.end()
		}
	})

	test('L11 the listener sees the inserted data (data.installationId, data.uploadedAt) and the result', async () => {
		// covered by the first test: the update uses data.installationId and data.uploadedAt.
		// Here: the result of the insert (e.g. generated values) is available as `result`.
		const seen: any[] = []
		orm.subscribe({
			on: ['insert'] as any,
			condition: 'entity == "InstallationFiles"',
			before: async () => {},
			after: async (args: any) => { seen.push(args) },
			error: async () => {}
		} as any)
		const installationId = await newInstallation()
		await orm.execute('InstallationFiles.insert()', { id: id(), installationId, name: 'z.pdf', uploadedAt: new Date() })
		await new Promise(resolve => setTimeout(resolve, 200))
		expect(seen).toHaveLength(1)
		expect(seen[0].data.installationId).toBe(installationId)
		expect(seen[0].result).toBeDefined()
	})
})
