/**
 * The queries of the editable table of an entity (docs/BACKOFFICE.md §2): its page sorted and filtered, the change of a
 * cell (only if it still has the value that was read: optimistic), a new row and the removal of one. Every value goes
 * in data, never in the text of the query.
 */
export interface EditedQuery { query: string, data: Record<string, unknown> }

export interface PageRequest {
	sort?: { field: string, desc: boolean }
	/** the body of a filter on p (p.price > 10); empty, none */
	filter?: string
	page: number
	size: number
}

/** Entity.filter(p => …).sort(p => …).page(n, size) */
export const pageQuery = (entity: string, request: PageRequest): string => {
	let query = entity
	if (request.filter?.trim()) query += `.filter(p => ${request.filter.trim()})`
	if (request.sort) query += `.sort(p => ${request.sort.desc ? `desc(p.${request.sort.field})` : `p.${request.sort.field}`})`
	return `${query}.page(${request.page}, ${request.size})`
}

/** p.id == k_id && …: the row by its primary key */
const byKey = (primaryKey: string[], row: Record<string, unknown>, data: Record<string, unknown>): string =>
	primaryKey.map(field => { data[`k_${field}`] = row[field]; return `p.${field} == k_${field}` }).join(' && ')

/**
 * A cell changed: its row by its key, and only while the cell still has what was read (someone else may have changed it:
 * then no row changes, and the table says so)
 */
export const updateCell = (entity: string, primaryKey: string[], row: Record<string, unknown>, field: string, value: unknown): EditedQuery => {
	const data: Record<string, unknown> = { v_new: value }
	const old = row[field]
	let condition = byKey(primaryKey, row, data)
	if (old === null || old === undefined) condition += ` && isNull(p.${field})`
	else { data.v_old = old; condition += ` && p.${field} == v_old` }
	return { query: `${entity}.update(p => ({ ${field}: v_new })).filter(p => ${condition})`, data }
}

export const insertRow = (entity: string, row: Record<string, unknown>): EditedQuery => ({ query: `${entity}.insert()`, data: row })

export const deleteRow = (entity: string, primaryKey: string[], row: Record<string, unknown>): EditedQuery => {
	const data: Record<string, unknown> = {}
	return { query: `${entity}.delete().filter(p => ${byKey(primaryKey, row, data)})`, data }
}

/** The text of an input as the value of its property's type: '' is no value (null); a number that isn't one, an error */
export const valueOf = (text: string, type: string | undefined): { value?: unknown, error?: string } => {
	const t = text.trim()
	if (t === '') return { value: null }
	switch (type) {
	case 'integer': return /^-?\d+$/.test(t) ? { value: Number(t) } : { error: 'a whole number' }
	case 'decimal': case 'number': return Number.isFinite(Number(t)) ? { value: Number(t) } : { error: 'a number' }
	case 'boolean': return t === 'true' || t === 'false' ? { value: t === 'true' } : { error: 'true or false' }
	case 'json': try { return { value: JSON.parse(t) } } catch { return { error: 'JSON' } }
	default: return { value: text }
	}
}

/** How a value is written in its input */
export const textOf = (value: unknown): string =>
	value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
