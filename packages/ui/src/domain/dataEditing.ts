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

/** A point of λORM: GeoJSON, its coordinates [longitude, latitude] (docs/VECTOR_POINT_SQLJS.md §1) */
export interface GeoPoint { type: 'Point', coordinates: [number, number] }

export const isPoint = (value: unknown): value is GeoPoint =>
	!!value && typeof value === 'object' && (value as any).type === 'Point' && Array.isArray((value as any).coordinates) && (value as any).coordinates.length >= 2

/** A longitude and a latitude as a point; out of range or not numbers, an error */
export const pointOf = (lng: string, lat: string): { value?: GeoPoint | null, error?: string } => {
	if (lng.trim() === '' && lat.trim() === '') return { value: null }
	const x = Number(lng); const y = Number(lat)
	if (lng.trim() === '' || !Number.isFinite(x) || x < -180 || x > 180) return { error: 'a longitude (-180 to 180)' }
	if (lat.trim() === '' || !Number.isFinite(y) || y < -90 || y > 90) return { error: 'a latitude (-90 to 90)' }
	return { value: { type: 'Point', coordinates: [x, y] } }
}

/** Where a point is, on OpenStreetMap */
export const mapUrlOf = (point: GeoPoint): string => {
	const [lng, lat] = point.coordinates
	return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`
}

/** The text of an input as the value of its property's type: '' is no value (null); a number that isn't one, an error */
export const valueOf = (text: string, type: string | undefined, length?: number): { value?: unknown, error?: string } => {
	const t = text.trim()
	if (t === '') return { value: null }
	switch (type) {
	case 'point': {
		const [lng = '', lat = ''] = t.split(',')
		return pointOf(lng, lat)
	}
	case 'vector': {
		let parsed: unknown
		try { parsed = JSON.parse(t) } catch { return { error: 'a list of numbers: [0.1, 0.2, …]' } }
		if (!Array.isArray(parsed) || !parsed.every(n => typeof n === 'number' && Number.isFinite(n))) return { error: 'a list of numbers: [0.1, 0.2, …]' }
		if (length && parsed.length !== length) return { error: `${length} numbers (it has ${parsed.length})` }
		return { value: parsed }
	}
	case 'integer': return /^-?\d+$/.test(t) ? { value: Number(t) } : { error: 'a whole number' }
	case 'decimal': case 'number': return Number.isFinite(Number(t)) ? { value: Number(t) } : { error: 'a number' }
	case 'boolean': return t === 'true' || t === 'false' ? { value: t === 'true' } : { error: 'true or false' }
	case 'json': try { return { value: JSON.parse(t) } } catch { return { error: 'JSON' } }
	default: return { value: text }
	}
}

/** How a value is written in its input (a point: "longitude, latitude") */
export const textOf = (value: unknown): string =>
	value === null || value === undefined ? '' : isPoint(value) ? `${value.coordinates[0]}, ${value.coordinates[1]}` : typeof value === 'object' ? JSON.stringify(value) : String(value)

/** How a value is shown in a cell: a vector by its first numbers and how many (nobody reads 1536 numbers) */
export const cellOf = (value: unknown, type?: string): string => {
	if (type === 'vector' && Array.isArray(value)) {
		const head = value.slice(0, 3).map(n => typeof n === 'number' ? Number(n.toFixed(4)) : n).join(', ')
		return `[${head}${value.length > 3 ? ', …' : ''}] (${value.length})`
	}
	return textOf(value)
}
