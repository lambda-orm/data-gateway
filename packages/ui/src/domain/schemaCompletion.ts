import { fromYaml } from './results'

/** A suggestion of the editor of a lambdaORM.yaml: a key where the cursor is, or a value of the key of its line */
export interface SchemaCompletion {
	label: string
	kind: 'key' | 'value'
	insertText: string
	detail?: string
}

const TYPES = ['string', 'text', 'integer', 'decimal', 'number', 'boolean', 'date', 'dateTime', 'time', 'uuid', 'json', 'vector', 'point']
const DIALECTS = ['PostgreSQL', 'MySQL', 'MariaDB', 'SqlServer', 'Oracle', 'MongoDB', 'SQLjs']
const RELATION_TYPES = ['oneToMany', 'manyToOne', 'oneToOne']

/** The keys of each place of a schema, by the path of keys that leads to it (`*` an item of a list) */
const KEYS: Record<string, string[]> = {
	'': ['domain', 'infrastructure', 'application'],
	domain: ['entities', 'enums'],
	'domain.entities.*': ['name', 'extends', 'abstract', 'view', 'singular', 'primaryKey', 'uniqueKey', 'properties', 'relations', 'indexes', 'constraints'],
	'domain.entities.*.properties.*': ['name', 'type', 'length', 'required', 'autoIncrement', 'default', 'enum', 'readExp', 'writeExp', 'readValue', 'writeValue', 'view'],
	'domain.entities.*.relations.*': ['name', 'type', 'from', 'entity', 'to', 'target', 'weak'],
	'domain.entities.*.indexes.*': ['name', 'fields'],
	'domain.entities.*.constraints.*': ['message', 'condition'],
	'domain.enums.*': ['name', 'values'],
	'domain.enums.*.values.*': ['name', 'value'],
	infrastructure: ['mappings', 'sources', 'stages', 'views', 'paths', 'queue'],
	'infrastructure.sources.*': ['name', 'dialect', 'mapping', 'connection'],
	'infrastructure.mappings.*': ['name', 'extends', 'entities'],
	'infrastructure.mappings.*.entities.*': ['name', 'mapping', 'sequence', 'filter', 'properties'],
	'infrastructure.mappings.*.entities.*.properties.*': ['name', 'mapping', 'dbType', 'readMappingExp', 'writeMappingExp'],
	'infrastructure.stages.*': ['name', 'sources'],
	'infrastructure.stages.*.sources.*': ['name', 'condition'],
	'infrastructure.paths': ['src', 'domain', 'state', 'data'],
	application: ['start', 'listeners']
}

const indentOf = (line: string): number => line.length - line.trimStart().length

/**
 * The path of keys of a line of a YAML text, from its indentation and the lines above it: `domain.entities.*.properties`
 * for a line inside a property of an entity. Enough for a schema written as λORM writes it (block style).
 */
export const pathAt = (lines: string[], index: number, column: number): string[] => {
	const path: string[] = []
	let indent = Math.min(column - 1, indentOf(lines[index] ?? ''))
	// the line itself starts an item of a list: its keys are those of the item
	if (/^\s*- /.test(lines[index] ?? '') && column - 1 > indentOf(lines[index])) {
		path.unshift('*')
		indent = indentOf(lines[index])
	}
	// inside an item: its list's key may be in the item's column (`stages:` then `- name:`) or to its left
	let inItem = path[0] === '*'
	for (let i = index - 1; i >= 0 && (indent > 0 || inItem); i--) {
		const line = lines[i]
		if (!line.trim() || line.trim().startsWith('#')) continue
		const lineIndent = indentOf(line)
		const item = /^(\s*)- /.exec(line)
		// an item of a list above: its keys are at its indentation + 2
		if (item && lineIndent < indent) {
			if (path[0] !== '*') path.unshift('*')
			indent = lineIndent
			inItem = true
			continue
		}
		if (item) continue
		const key = /^\s*([A-Za-z_][\w]*):/.exec(line)
		if (key && (lineIndent < indent || (inItem && lineIndent === indent))) {
			path.unshift(key[1])
			indent = lineIndent
			inItem = false
		}
	}
	return path
}

const names = (list: unknown): string[] => Array.isArray(list) ? list.map((e: any) => e?.name).filter((n: unknown): n is string => typeof n === 'string') : []

/** What to suggest at a position (1-based line and column) of the text of a lambdaORM.yaml */
export const schemaCompletions = (text: string, lineNumber: number, column: number): SchemaCompletion[] => {
	const lines = text.split('\n')
	const line = lines[lineNumber - 1] ?? ''
	const before = line.slice(0, column - 1)
	let schema: any
	try { schema = fromYaml(text) } catch { schema = undefined }
	// a value: the key of this line, before the cursor
	const value = /^\s*(?:- )?([A-Za-z_]\w*):\s*(\S*)$/.exec(before)
	if (value) {
		const key = value[1]
		const where = pathAt(lines, lineNumber - 1, indentOf(line) + 1).join('.')
		let options: string[] = []
		if (key === 'type' && where.endsWith('properties.*')) options = TYPES
		else if (key === 'type' && where.endsWith('relations.*')) options = RELATION_TYPES
		else if (key === 'dialect') options = DIALECTS
		else if ((key === 'entity' && where.endsWith('relations.*')) || (key === 'extends' && where === 'domain.entities.*')) options = names(schema?.domain?.entities)
		else if (key === 'enum') options = names(schema?.domain?.enums)
		else if (key === 'mapping' && where === 'infrastructure.sources.*') options = names(schema?.infrastructure?.mappings)
		else if ((key === 'required' || key === 'autoIncrement' || key === 'abstract' || key === 'weak' || key === 'view')) options = ['true', 'false']
		return options.map(o => ({ label: o, kind: 'value' as const, insertText: o, detail: key }))
	}
	// a key: those of the place of the cursor not written yet there
	if (!/^\s*(?:- )?[A-Za-z_]*$/.test(before)) return []
	const path = pathAt(lines, lineNumber - 1, column)
	const keys = KEYS[path.join('.').replace(/^$/, '')] ?? []
	const written = new Set<string>()
	const indent = indentOf(line) + (/^\s*- /.test(line) ? 2 : 0)
	for (let i = lineNumber - 2; i >= 0; i--) {
		const l = lines[i]
		if (!l.trim()) continue
		const own = indentOf(l) + (/^\s*- /.test(l) ? 2 : 0)
		if (own < indent || (/^\s*- /.test(l) && indentOf(l) + 2 === indent && i !== lineNumber - 1)) {
			const key = /^\s*(?:- )?([A-Za-z_]\w*):/.exec(l)
			if (key && own === indent) written.add(key[1])
			break
		}
		const key = /^\s*(?:- )?([A-Za-z_]\w*):/.exec(l)
		if (key && own === indent) written.add(key[1])
	}
	return keys.filter(k => !written.has(k)).map(k => ({ label: k, kind: 'key' as const, insertText: `${k}: `, detail: path.join('.') || 'schema' }))
}
