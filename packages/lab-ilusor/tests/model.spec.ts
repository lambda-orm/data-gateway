// The relations of a model, checked without a database (docs/LAMBDAORM_PENDING.md L34): every pair of fields exists,
// has the same type on both sides, the "one" side is a key, a relation of several fields doesn't reach MongoDB, and
// none drops the key that both entities start with (locationId in Ilusor's iot_location: without it, a row reaches
// another location's row with the same id).
//
// The lab's own models always; Ilusor's real model when it is on this machine (ILUSOR_MODEL, by default
// ~/ilusor/dev/cloud/data-gateway/workspace/ilusor/lambdaORM.yaml). `npm run model` runs it without the lab's
// Postgres.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Orm } from '@lambdaorm/lib'
import { relationKeys, RelationType } from '@lambdaorm/base'

const ilusorModel = process.env.ILUSOR_MODEL || path.join(os.homedir(), 'ilusor/dev/cloud/data-gateway/workspace/ilusor/lambdaORM.yaml')
const models: [string, string][] = [
	['lab', path.join(__dirname, '..', 'lambdaORM.yaml')],
	['lab composite', path.join(__dirname, 'composite', 'lambdaORM.yaml')],
	['lab uuid', path.join(__dirname, 'uuid', 'lambdaORM.yaml')],
	['lab documents', path.join(__dirname, 'documents', 'lambdaORM.yaml')],
	...(fs.existsSync(ilusorModel) ? [['ilusor', ilusorModel] as [string, string]] : [])
]

export interface RelationReport {
	/** relations checked, and how many of several fields */
	relations: number
	composite: number
	/** what is wrong: a relation that gives wrong rows or that push can't create */
	errors: string[]
	/** what works but is worth knowing: several fields across sources (include, not filter), text vs string, a weak
	 * relation to a field that isn't a key */
	notes: string[]
}

const sameSet = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every(p => b.includes(p))

/** Checks every relation of a loaded (completed) schema */
export function checkRelations (orm: Orm, stage = 'default'): RelationReport {
	const schema = orm.state.schema
	const entities = new Map(schema.domain.entities.map(e => [e.name, e]))
	const sources = new Map((schema.infrastructure?.sources || []).map(s => [s.name, s]))
	const mappings = new Map((schema.infrastructure?.mappings || []).map(m => [m.name, m]))
	const sourceOf = (entity: string) => {
		try {
			const info: any = { entity, action: 'select', category: 'dml', type: 'dql', read: true, write: false, ddl: false, dml: true }
			return sources.get(orm.state.getSource(info, stage))
		} catch { return undefined }
	}
	const dbType = (entity: string, property: string) => {
		const source = sourceOf(entity)
		const mapping = source ? mappings.get(source.mapping) : undefined
		return mapping?.entities?.find(e => e.name === entity)?.properties?.find(p => p.name === property)?.dbType
	}
	const isKey = (entity: string, fields: string[]) => {
		const e = entities.get(entity)
		return !!e && (sameSet(e.primaryKey, fields) || sameSet(e.uniqueKey, fields))
	}
	const report: RelationReport = { relations: 0, composite: 0, errors: [], notes: [] }
	for (const entity of schema.domain.entities) {
		for (const relation of entity.relations || []) {
			report.relations++
			const name = `${entity.name}.${relation.name}`
			const keys = relationKeys(relation)
			const from = keys.map(k => k.from)
			const to = keys.map(k => k.to)
			if (keys.length > 1) report.composite++
			const related = entities.get(relation.entity)
			if (!related) { report.errors.push(`${name}: the entity ${relation.entity} doesn't exist`); continue }
			const [fromSource, toSource] = [sourceOf(entity.name), sourceOf(relation.entity)]
			const sameSource = !!fromSource && fromSource.name === toSource?.name
			let fieldsExist = true
			for (const { from: f, to: t } of keys) {
				const fp = entity.properties?.find(p => p.name === f)
				const tp = related.properties?.find(p => p.name === t)
				if (!fp) { report.errors.push(`${name}: ${entity.name} has no field ${f}`); fieldsExist = false }
				if (!tp) { report.errors.push(`${name}: ${relation.entity} has no field ${t}`); fieldsExist = false }
				if (!fp || !tp) continue
				if (fp.type !== tp.type) {
					// text and string are both text in the database: they compare, but the model says two things
					const text = ['text', 'string']
					;(text.includes(fp.type!) && text.includes(tp.type!) ? report.notes : report.errors)
						.push(`${name}: ${entity.name}.${f} is ${fp.type}, ${relation.entity}.${t} is ${tp.type}`)
				}
				// the column types only meet in a foreign key, within one source (MongoDB keeps a uuid as its own type)
				const [fd, td] = [dbType(entity.name, f), dbType(relation.entity, t)]
				if (sameSource && fd !== td) report.errors.push(`${name}: ${entity.name}.${f} is ${fd || 'the default type'} in the database, ${relation.entity}.${t} is ${td || 'the default type'}`)
			}
			if (!fieldsExist) continue
			// both entities keyed by the same first field (locationId) and the relation without it
			const lead = entity.primaryKey?.[0]
			const dropsLead = !!lead && (entity.primaryKey?.length || 0) > 1 && related.primaryKey?.[0] === lead &&
				(related.primaryKey?.length || 0) > 1 && !keys.some(k => k.from === lead && k.to === lead)
			if (dropsLead) {
				report.errors.push(`${name}: both ${entity.name} and ${relation.entity} are keyed by ${lead} first, and the relation doesn't pair it: a row reaches another ${lead}'s (and Postgres reads every partition)`)
			}
			// the "one" side must be a key: else the relation gives several rows where it promises one, and push has
			// no foreign key to create. A weak one (no foreign key) may look a row up by another field: a note.
			const [keyEntity, keyFields] = relation.type === RelationType.manyToOne ? [entity.name, from] : [relation.entity, to]
			if (!dropsLead && !isKey(keyEntity, keyFields)) {
				(relation.weak ? report.notes : report.errors).push(`${name}: [${keyFields}] is not a key of ${keyEntity}`)
			}
			// a field paired with another of the same name at another position: the pairs go by position
			from.forEach((f, i) => {
				const j = to.indexOf(f)
				if (j !== -1 && j !== i) report.errors.push(`${name}: ${f} is paired with ${to[i]}, and ${relation.entity}.${f} with ${from[j]}: the order of from and to differ`)
			})
			if (keys.length > 1) {
				for (const s of [fromSource, toSource]) {
					if (s?.dialect === 'MongoDB') report.errors.push(`${name}: a relation of several fields to the MongoDB source ${s.name} is not supported yet`)
				}
				if (fromSource && toSource && !sameSource && fromSource.dialect !== 'MongoDB' && toSource.dialect !== 'MongoDB') {
					report.notes.push(`${name}: several fields across sources (${fromSource.name} → ${toSource.name}): include works, a filter by it doesn't yet`)
				}
			}
		}
	}
	return report
}

describe.each(models)('model %s', (_label, model) => {
	let orm: Orm
	let report: RelationReport
	beforeAll(async () => {
		orm = new Orm()
		await orm.init(model, false) // no connections: only the schema
		report = checkRelations(orm)
	})
	afterAll(async () => { await orm.end() })

	test('L34 every relation pairs existing fields of the same type, the one side is a key, no key field dropped', () => {
		expect(report.relations).toBeGreaterThan(0)
		expect(report.errors).toEqual([])
	})

	test('L34 notes: several fields across sources (include only), text and string, weak lookups by another field', () => {
		if (report.notes.length > 0) console.log(`${model}: ${report.composite} of ${report.relations} relations have several fields\n${report.notes.join('\n')}`)
		expect(Array.isArray(report.notes)).toBe(true)
	})
})
