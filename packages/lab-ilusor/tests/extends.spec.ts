// Abstract entities and `extends` (docs/LAMBDAORM_PENDING.md L45–L53), as Ilusor's Cloud uses them: Audited, and
// Catalog / Located (extends Audited) / LocatedCatalog (extends Located). Checked on the completed schema
// (`orm.schema.complete`), without a database: `npm run model` runs it without the lab's Postgres.
import { Orm } from '@lambdaorm/lib'

type Json = any

/** The schema completed as λORM loads it (each test its own: complete changes it in place) */
const complete = (schema: Json): Json => {
	new Orm().schema.complete(schema)
	return schema
}
const entityOf = (schema: Json, name: string): Json => schema.domain.entities.find((e: Json) => e.name === name)
const propertyOf = (schema: Json, entity: string, name: string): Json => entityOf(schema, entity)?.properties?.find((p: Json) => p.name === name)
const relationOf = (schema: Json, entity: string, name: string): Json => entityOf(schema, entity)?.relations?.find((r: Json) => r.name === name)
const names = (rows: Json[] = []): string[] => rows.map(p => p.name)

const audited = (): Json => ({
	name: 'Audited',
	abstract: true,
	properties: [
		{ name: 'createdAt', type: 'dateTime', required: true },
		{ name: 'createdBy', length: 128, required: true }
	]
})
const located = (): Json => ({
	name: 'Located',
	abstract: true,
	extends: 'Audited',
	properties: [{ name: 'locationId', length: 36, required: true }],
	relations: [{ name: 'location', from: 'locationId', entity: 'Locations', to: 'id', weak: true }]
})
const locations = (): Json => ({ name: 'Locations', primaryKey: ['id'], properties: [{ name: 'id', length: 36, required: true }] })
/** A source and its stage: without them `complete` leaves the domain as it is (no defaults, nothing to see) */
const infrastructure = (mapping: Json = { name: 'catalog' }): Json => ({
	mappings: [mapping],
	sources: [{ name: 'catalog', dialect: 'PostgreSQL', mapping: mapping.name, connection: {} }],
	stages: [{ name: 'default', sources: [{ name: 'catalog' }] }]
})
const domain = (...entities: Json[]): Json => ({ domain: { entities }, infrastructure: infrastructure() })

describe('extends', () => {
	test('a chain gives the child the properties and relations of every base (as Ilusor uses it today)', () => {
		const schema = complete(domain(audited(), located(), locations(), {
			name: 'Areas',
			extends: 'Located',
			primaryKey: ['locationId', 'code'],
			properties: [{ name: 'code', length: 64, required: true }]
		}))
		expect(names(entityOf(schema, 'Areas').properties).sort()).toEqual(['code', 'createdAt', 'createdBy', 'locationId'])
		expect(relationOf(schema, 'Areas', 'location')).toMatchObject({ from: 'locationId', entity: 'Locations', to: 'id', weak: true })
		expect(entityOf(schema, 'Located')).toBeUndefined()
	})

	test('L45 a child that says only the target of an inherited relation keeps the base\'s weak', () => {
		const schema = complete(domain(audited(), located(), locations(), {
			name: 'Areas',
			extends: 'Located',
			primaryKey: ['locationId', 'code'],
			properties: [{ name: 'code', length: 64, required: true }],
			relations: [{ name: 'location', target: 'areas' }]
		}))
		expect(relationOf(schema, 'Areas', 'location')).toMatchObject({ entity: 'Locations', weak: true, target: 'areas' })
	})

	test('L45 a child that says only the length of an inherited property keeps the base\'s type and required', () => {
		const schema = complete(domain(audited(), {
			name: 'Notes',
			extends: 'Audited',
			primaryKey: ['id'],
			properties: [{ name: 'id', length: 36, required: true }, { name: 'createdBy', length: 255 }]
		}))
		expect(propertyOf(schema, 'Notes', 'createdBy')).toMatchObject({ length: 255, required: true })
	})

	test('L46 a child without primaryKey gets its base\'s', () => {
		const schema = complete(domain(audited(), {
			name: 'Catalog',
			abstract: true,
			extends: 'Audited',
			primaryKey: ['code'],
			properties: [{ name: 'code', length: 64, required: true }, { name: 'name', length: 255 }]
		}, {
			name: 'Brands',
			extends: 'Catalog',
			properties: [{ name: 'country', length: 2 }]
		}))
		expect(entityOf(schema, 'Brands').primaryKey).toEqual(['code'])
	})

	test('L47 a child gets the constraints and the uniqueKey of its base', () => {
		const schema = complete(domain({
			name: 'ThresholdBand',
			abstract: true,
			uniqueKey: ['ownerId', 'position'],
			properties: [{ name: 'ownerId', length: 36, required: true }, { name: 'position', type: 'integer', required: true }, { name: 'color', length: 7 }],
			constraints: [{ message: 'color is #rrggbb', condition: 'isNull(color) || test(color, "^#[0-9a-fA-F]{6}$")' }]
		}, {
			name: 'PropertyThresholdBands',
			extends: 'ThresholdBand',
			primaryKey: ['id'],
			properties: [{ name: 'id', length: 36, required: true }]
		}))
		const band = entityOf(schema, 'PropertyThresholdBands')
		expect(band.uniqueKey).toEqual(['ownerId', 'position'])
		expect((band.constraints || []).map((c: Json) => c.message)).toContain('color is #rrggbb')
	})

	test('L48 an entity extends two bases: the properties and relations of both', () => {
		const locatedOnly = located()
		delete locatedOnly.extends
		const schema = complete(domain(audited(), locatedOnly, locations(), {
			name: 'Areas',
			extends: ['Audited', 'Located'],
			primaryKey: ['locationId', 'code'],
			properties: [{ name: 'code', length: 64, required: true }]
		}))
		expect(names(entityOf(schema, 'Areas').properties).sort()).toEqual(['code', 'createdAt', 'createdBy', 'locationId'])
		expect(relationOf(schema, 'Areas', 'location')).toMatchObject({ entity: 'Locations', weak: true })
	})

	test('L49 `properties:` with no items (null) loads, or the error names the entity', () => {
		let error: Error | undefined
		let schema: Json
		try {
			schema = complete(domain(audited(), {
				name: 'Catalog',
				abstract: true,
				extends: 'Audited',
				properties: [{ name: 'code', length: 64, required: true }]
			}, {
				name: 'Thresholds',
				extends: 'Catalog',
				primaryKey: ['code'],
				properties: null
			}))
		} catch (e) { error = e as Error }
		if (error) expect(error.message).toMatch(/Thresholds/)
		else expect(names(entityOf(schema, 'Thresholds').properties).sort()).toEqual(['code', 'createdAt', 'createdBy'])
	})

	test('L50 today: the entity of a mapping that says extends gets the mapping of its abstract', () => {
		const schema = complete({
			...domain(audited(), {
				name: 'Brands',
				extends: 'Audited',
				primaryKey: ['code'],
				properties: [{ name: 'code', length: 64, required: true }]
			}),
			infrastructure: infrastructure({
				name: 'catalog',
				entities: [
					{ name: 'Audited', abstract: true, properties: [{ name: 'createdAt', mapping: 'created_at', dbType: 'timestamptz(3)' }, { name: 'createdBy', mapping: 'created_by' }] },
					{ name: 'Brands', extends: 'Audited', mapping: 'cat_brands' }
				]
			})
		})
		const brands = schema.infrastructure.mappings[0].entities.find((e: Json) => e.name === 'Brands')
		expect(brands.properties.find((p: Json) => p.name === 'createdAt')).toMatchObject({ mapping: 'created_at', dbType: 'timestamptz(3)' })
	})

	test('L50 the entity of a mapping gets the mapping of the abstract it extends, without saying extends again', () => {
		const schema = complete({
			...domain(audited(), {
				name: 'Brands',
				extends: 'Audited',
				primaryKey: ['code'],
				properties: [{ name: 'code', length: 64, required: true }]
			}),
			infrastructure: infrastructure({
				name: 'catalog',
				entities: [
					{ name: 'Audited', abstract: true, properties: [{ name: 'createdAt', mapping: 'created_at', dbType: 'timestamptz(3)' }, { name: 'createdBy', mapping: 'created_by' }] },
					{ name: 'Brands', mapping: 'cat_brands' }
				]
			})
		})
		const brands = schema.infrastructure.mappings[0].entities.find((e: Json) => e.name === 'Brands')
		expect(brands.properties.find((p: Json) => p.name === 'createdAt')).toMatchObject({ mapping: 'created_at', dbType: 'timestamptz(3)' })
	})

	test('L51 the inherited properties go before the entity\'s own (the columns of a created table)', () => {
		const schema = complete(domain(audited(), located(), locations(), {
			name: 'Areas',
			extends: 'Located',
			primaryKey: ['locationId', 'code'],
			properties: [{ name: 'code', length: 64, required: true }]
		}))
		expect(names(entityOf(schema, 'Areas').properties)).toEqual(['createdAt', 'createdBy', 'locationId', 'code'])
	})

	test('L52 an entity extends one of domain.abstracts; the abstracts don\'t reach the completed entities', () => {
		const base = audited()
		delete base.abstract
		const schema = complete({
			domain: {
				abstracts: [base],
				entities: [{ name: 'Brands', extends: 'Audited', primaryKey: ['code'], properties: [{ name: 'code', length: 64, required: true }] }]
			},
			infrastructure: infrastructure()
		})
		expect(names(entityOf(schema, 'Brands').properties).sort()).toEqual(['code', 'createdAt', 'createdBy'])
		expect(names(schema.domain.entities)).toEqual(['Brands'])
	})

	test('L53 the completed entity says what it extends and where each inherited property comes from', () => {
		const schema = complete(domain(audited(), located(), locations(), {
			name: 'Areas',
			extends: 'Located',
			primaryKey: ['locationId', 'code'],
			properties: [{ name: 'code', length: 64, required: true }]
		}))
		expect(entityOf(schema, 'Areas').extends).toBe('Located')
		expect(propertyOf(schema, 'Areas', 'createdAt').inheritedFrom).toBe('Audited')
		expect(propertyOf(schema, 'Areas', 'locationId').inheritedFrom).toBe('Located')
		expect(propertyOf(schema, 'Areas', 'code').inheritedFrom).toBeUndefined()
		expect(relationOf(schema, 'Areas', 'location').inheritedFrom).toBe('Located')
	})
})
