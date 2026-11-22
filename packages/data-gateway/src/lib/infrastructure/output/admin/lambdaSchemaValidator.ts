import YAML, { LineCounter } from 'yaml'
import { Orm } from '@lambdaorm/lib'
import { SchemaIssue, SchemaValidatorPort } from '../../../application/ports/output/adminPorts'

/** The types λORM knows for a property (typ3s Primitive and those of the dialects) */
const PROPERTY_TYPES = ['string', 'text', 'integer', 'decimal', 'number', 'boolean', 'date', 'dateTime', 'time', 'uuid', 'any', 'obj', 'list', 'json', 'blob', 'binary']

/**
 * A lambdaORM.yaml checked as the gateway would load it, without connecting nor running anything of it: the YAML (each
 * error at its line), the shape, and λORM completing the schema (extends, relations, mappings). application.start and
 * the listeners are left out: they are code of the schema, and validating must not run it.
 */
export class LambdaSchemaValidator implements SchemaValidatorPort {
	public async validate (text: string): Promise<SchemaIssue[]> {
		const lines = new LineCounter()
		const document = YAML.parseDocument(text, { lineCounter: lines, prettyErrors: false })
		const at = (offset: number | undefined) => offset === undefined ? {} : (({ line, col }) => ({ line, column: col }))(lines.linePos(offset))
		const issues: SchemaIssue[] = [
			...document.errors.map(e => ({ severity: 'error' as const, message: e.message.split('\n')[0], ...at(e.pos?.[0]) })),
			...document.warnings.map(w => ({ severity: 'warning' as const, message: w.message.split('\n')[0], ...at(w.pos?.[0]) }))
		]
		if (issues.some(i => i.severity === 'error')) return issues
		const schema = document.toJS() as any
		if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [...issues, { severity: 'error', message: 'a schema is an object (domain, infrastructure, application)', line: 1 }]
		if (schema.domain !== undefined && (typeof schema.domain !== 'object' || Array.isArray(schema.domain))) {
			issues.push({ severity: 'error', message: 'domain is an object (entities, enums)', ...at((document.get('domain', true) as any)?.range?.[0]) })
		}
		const entities = Array.isArray(schema.domain?.entities) ? schema.domain.entities : []
		entities.forEach((entity: any, i: number) => {
			(Array.isArray(entity?.properties) ? entity.properties : []).forEach((property: any, j: number) => {
				if (property?.type !== undefined && !PROPERTY_TYPES.includes(property.type)) {
					const node = document.getIn(['domain', 'entities', i, 'properties', j, 'type'], true) as any
					issues.push({ severity: 'warning', message: `${entity.name}.${property.name}: "${property.type}" is not a type of λORM (${PROPERTY_TYPES.join(', ')})`, ...at(node?.range?.[0]) })
				}
			})
		})
		// a name twice in a list (two properties price): λORM takes either, a form would edit only one
		const named: string[][] = [['domain', 'entities'], ['domain', 'enums'], ['infrastructure', 'sources'], ['infrastructure', 'mappings'], ['infrastructure', 'stages'], ['infrastructure', 'views']]
		entities.forEach((_e: any, i: number) => { for (const list of ['properties', 'relations', 'indexes']) named.push(['domain', 'entities', i as any, list]) })
		;(Array.isArray(schema.infrastructure?.mappings) ? schema.infrastructure.mappings : []).forEach((_m: any, i: number) => named.push(['infrastructure', 'mappings', i as any, 'entities']))
		;(Array.isArray(schema.infrastructure?.stages) ? schema.infrastructure.stages : []).forEach((_s: any, i: number) => named.push(['infrastructure', 'stages', i as any, 'sources']))
		for (const path of named) {
			const list = path.reduce((v: any, k) => v?.[k], schema)
			if (!Array.isArray(list)) continue
			const seen = new Set<string>()
			list.forEach((item: any, k: number) => {
				const name = item?.name
				if (typeof name !== 'string') return
				if (seen.has(name)) {
					const owner = path.length > 2 ? `${path.slice(0, 3).reduce((v: any, key) => v?.[key], schema)?.name ?? ''}.` : ''
					const node = document.getIn([...path, k, 'name'], true) as any
					issues.push({ severity: 'error', message: `${owner}${path[path.length - 1]}: "${name}" twice`, ...at(node?.range?.[0]) })
				}
				seen.add(name)
			})
		}
		if (issues.some(i => i.severity === 'error')) return issues
		// λORM completes it: what it can't (an entity extends one that doesn't exist, a relation to nothing) is an error
		const rest = { ...schema }
		delete rest.application
		const orm = new Orm()
		try {
			await orm.init({ domain: { entities: [], enums: [] }, ...rest, application: { start: [], listeners: [] } } as any, false)
		} catch (error: any) {
			issues.push({ severity: 'error', message: error?.message ?? String(error) })
		} finally {
			await orm.end().catch(() => undefined)
		}
		return issues
	}
}
