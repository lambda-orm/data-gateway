// What Ilusor does with the CLI's stage commands (docs/LAMBDAORM_PENDING.md L6, L19, L20, L21, L22):
// `push -o` generates each change's DDL (saved as a versioned SQL script), `push` only on throwaway
// databases, `pull` once for the first model, `fetch` in CI to catch drift.
import fs from 'fs'
import os from 'os'
import path from 'path'
import yaml from 'js-yaml'
import { Orm } from '../../../../lib'
import { newOrm, workspace } from './helpers'

/** A copy of the lab's workspace in a temp folder, so pull/push experiments never touch the lab's own files. */
const copyWorkspace = (change?: (schema: any) => void): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilusor-cloud-lab-'))
	const schema: any = yaml.load(fs.readFileSync(path.join(workspace, 'lambdaORM.yaml'), 'utf8'))
	if (change) change(schema)
	fs.writeFileSync(path.join(dir, 'lambdaORM.yaml'), yaml.dump(schema))
	// push compares the model with orm_state (what the last push applied), not with the database: copy it too
	fs.cpSync(path.join(workspace, 'orm_state'), path.join(dir, 'orm_state'), { recursive: true })
	return path.join(dir, 'lambdaORM.yaml')
}

describe('stage', () => {
	let orm: Orm
	beforeAll(async () => { orm = await newOrm() })
	afterAll(async () => { await orm.end() })

	test('L19 push -o compares with the database, not with orm_state (another environment has no orm_state of its own)', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilusor-cloud-lab-'))
		fs.copyFileSync(path.join(workspace, 'lambdaORM.yaml'), path.join(dir, 'lambdaORM.yaml'))
		const fresh = await newOrm(path.join(dir, 'lambdaORM.yaml'))
		try {
			// the tables exist in the database: nothing to create
			const flat = JSON.stringify(await fresh.stage.push({ stage: 'ddl' }).sentence())
			expect(flat).not.toMatch(/CREATE TABLE/i)
		} finally {
			await fresh.end()
		}
	})

	test('L19 push -o on a database in step with the model generates nothing', async () => {
		const sentences = await orm.stage.push({ stage: 'ddl' }).sentence()
		const flat = JSON.stringify(sentences)
		expect(flat).not.toMatch(/CREATE|ALTER|DROP/i)
	})

	test('L19 push -o of a change: only that change, one entry per source, nothing applied, no orm_state written', async () => {
		const schemaPath = copyWorkspace(schema => {
			schema.domain.entities.find((e: any) => e.name === 'Accounts').properties.push({ name: 'phone', length: 32 })
			schema.infrastructure.mappings.find((m: any) => m.name === 'accounts')
				.entities.find((e: any) => e.name === 'Accounts').properties.push({ name: 'phone', mapping: 'phone' })
		})
		const changed = await newOrm(schemaPath)
		try {
			const sentences = await changed.stage.push({ stage: 'ddl' }).sentence()
			const flat = JSON.stringify(sentences)
			expect(flat).toMatch(/ALTER TABLE .*accounts.* ADD .*phone/i)
			expect(flat).not.toMatch(/device_models|areas|CREATE TABLE/i)
			const state = path.join(path.dirname(schemaPath), 'orm_state')
			expect(fs.readdirSync(state).sort()).toEqual(fs.readdirSync(path.join(workspace, 'orm_state')).sort())
		} finally {
			await changed.end()
		}
	})

	test('L25 push with a last source without condition (catch-all) creates only the entities no other source took', async () => {
		const schemaPath = copyWorkspace(schema => {
			for (const stage of schema.infrastructure.stages) {
				const last = stage.sources[stage.sources.length - 1]
				delete last.condition
			}
		})
		const changed = await newOrm(schemaPath)
		try {
			const flat = JSON.stringify(await changed.stage.push({ stage: 'ddl' }).sentence())
			expect(flat).not.toMatch(/TABLE IF NOT EXISTS (DeviceTypes|Accounts|Quotes)\b/)
		} finally {
			await changed.end()
		}
	})

	test('L24 a string without length is unbounded (text), not VARCHAR(80)', async () => {
		const { pgColumn } = await import('./helpers')
		const column = await pgColumn('accounts', 'accounts', 'name')
		expect(column?.character_maximum_length ?? null).toBeNull()
	})

	test('L27 push -o of an added property generates ADD COLUMN', async () => {
		const schemaPath = copyWorkspace(schema => {
			schema.domain.entities.find((e: any) => e.name === 'Accounts').properties.push({ name: 'notes' })
		})
		const changed = await newOrm(schemaPath)
		try {
			const flat = JSON.stringify(await changed.stage.push({ stage: 'ddl' }).sentence())
			expect(flat).toMatch(/ALTER TABLE .*accounts.* ADD .*notes/i)
		} finally {
			await changed.end()
		}
	})

	test('L1 + L2 mapping dbType reaches the DDL (jsonb, timestamptz(3))', async () => {
		const column = (await import('./helpers')).pgColumn
		expect((await column('catalog', 'device_models', 'settings'))?.data_type).toBe('jsonb')
		expect((await column('catalog', 'device_models', 'created_at'))?.data_type).toBe('timestamp with time zone')
	})

	test('L20 a declared rename generates ALTER … RENAME, not drop + add', async () => {
		const schemaPath = copyWorkspace(schema => {
			const mapping = schema.infrastructure.mappings.find((m: any) => m.name === 'catalog')
				.entities.find((e: any) => e.name === 'DeviceTypes')
			mapping.properties.push({ name: 'icon', mapping: 'icon_name', previousMapping: 'icon' }) // proposal: how to declare it
		})
		const changed = await newOrm(schemaPath)
		try {
			const flat = JSON.stringify(await changed.stage.push({ stage: 'ddl' }).sentence())
			expect(flat).toMatch(/RENAME COLUMN .*icon.* TO .*icon_name/i)
			expect(flat).not.toMatch(/DROP COLUMN/i)
		} finally {
			await changed.end()
		}
	})

	test('L22 fetch on a database in step with the model reports no differences', async () => {
		const mappings: any = await orm.stage.fetch({ stage: 'ddl' })
		// expected: an empty diff (or a result that says "in step"); today fetch returns the database's mappings
		const differences = Array.isArray(mappings) ? mappings.filter((m: any) => (m.entities || []).length > 0) : mappings
		expect(differences).toEqual([])
	})

	test('L22 fetch reports the drift: a column of the model missing in the database', async () => {
		const schemaPath = copyWorkspace(schema => {
			schema.domain.entities.find((e: any) => e.name === 'Accounts').properties.push({ name: 'phone', length: 20 })
		})
		const changed = await newOrm(schemaPath)
		try {
			const mappings: any = await changed.stage.fetch({ stage: 'ddl' })
			const differing = mappings.flatMap((m: any) => m.entities)
			expect(differing.map((e: any) => e.name)).toEqual(['Accounts'])
			expect(differing[0].differences).toEqual(['column phone missing in the database'])
		} finally {
			await changed.end()
		}
	})

	test('L6 + L21 pull on an existing model: no error with reserved words, and what was written by hand survives', async () => {
		const schemaPath = copyWorkspace()
		const pulled = await newOrm(schemaPath)
		try {
			await pulled.stage.pull({ stage: 'ddl' } as any)
			const schema: any = yaml.load(fs.readFileSync(schemaPath, 'utf8'))
			const entity = (name: string) => schema.domain.entities.find((e: any) => e.name === name)
			expect(entity('DeviceTypes').properties.map((p: any) => p.name)).toContain('order')
			// relations between schemas (weak, no FK in the database) and names chosen by hand stay
			expect(entity('QuoteLines').relations.find((r: any) => r.name === 'deviceModel')).toMatchObject({ entity: 'DeviceModels', weak: true })
			expect(entity('Areas').relations.find((r: any) => r.name === 'location')).toBeDefined()
			expect(schema.application?.listeners?.length).toBe(1)
			expect(schema.infrastructure.stages.map((s: any) => s.name)).toEqual(['default', 'ddl'])
		} finally {
			await pulled.end()
		}
	})
})
