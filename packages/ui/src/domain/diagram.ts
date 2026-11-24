/** The domain of a schema as GET /{schema}/domain gives it (the part the diagram draws) */
export interface DomainInfo {
	entities: EntityInfo[]
	enums?: { name: string, values: { name: string, value: unknown }[] }[]
}

export interface EntityInfo {
	name: string
	abstract?: boolean
	extends?: string
	primaryKey?: string[]
	uniqueKey?: string[]
	properties?: PropertyInfo[]
	relations?: RelationInfo[]
	view?: boolean
	indexes?: { name: string, fields: string[] }[]
	constraints?: { message: string, condition: string }[]
}

export interface PropertyInfo {
	name: string
	type?: string
	required?: boolean
	autoIncrement?: boolean
	length?: number
	enum?: string
	default?: string
	view?: boolean
	readExp?: string
	writeExp?: string
}

export interface RelationInfo {
	name: string
	type: 'oneToMany' | 'manyToOne' | 'oneToOne' | string
	from: string
	entity: string
	to: string
	weak?: boolean
	composite?: boolean
}

/**
 * A line of the diagram. A relation goes from the parent (the "one" side, whose field is referenced) to the child
 * (the side with the foreign key); a manyToOne in one entity and the oneToMany back in the other are the same line.
 * An inheritance goes from the parent entity to the one that extends it.
 */
export interface DiagramEdge {
	id: string
	kind: 'relation' | 'extends'
	parent: string
	parentField?: string
	child: string
	childField?: string
	/** Rows of the child for a row of the parent */
	childCardinality: '1' | 'N'
	/** The names the entities give it (Orders.details, OrderDetails.order) */
	names: string[]
}

/** The lines of a domain: one per relation (both sides of it together) and one per inheritance */
export const edgesOf = (domain: DomainInfo): DiagramEdge[] => {
	const names = new Set(domain.entities.map(e => e.name))
	const edges = new Map<string, DiagramEdge>()
	for (const entity of domain.entities) {
		if (entity.extends && names.has(entity.extends)) {
			const id = `extends:${entity.extends}>${entity.name}`
			edges.set(id, { id, kind: 'extends', parent: entity.extends, child: entity.name, childCardinality: '1', names: [] })
		}
		for (const relation of entity.relations ?? []) {
			if (!names.has(relation.entity)) continue
			// λORM names the type from the other side: oneToMany is one row of the other entity (this one has the key)
			const [parent, parentField, child, childField] = relation.type === 'manyToOne'
				? [entity.name, relation.from, relation.entity, relation.to]
				: [relation.entity, relation.to, entity.name, relation.from]
			const childCardinality = relation.type === 'oneToOne' ? '1' : 'N'
			const id = relation.type === 'oneToOne'
				? `one:${[`${parent}.${parentField}`, `${child}.${childField}`].sort().join('=')}`
				: `rel:${parent}.${parentField}>${child}.${childField}`
			const edge = edges.get(id)
			if (edge) edge.names.push(`${entity.name}.${relation.name}`)
			else edges.set(id, { id, kind: 'relation', parent, parentField, child, childField, childCardinality, names: [`${entity.name}.${relation.name}`] })
		}
	}
	return [...edges.values()]
}

/** The fields of each entity that point to another one */
export const foreignKeysOf = (edges: DiagramEdge[]): Map<string, Set<string>> => {
	const keys = new Map<string, Set<string>>()
	for (const edge of edges) {
		if (edge.kind !== 'relation' || !edge.childField) continue
		if (!keys.has(edge.child)) keys.set(edge.child, new Set())
		keys.get(edge.child)!.add(edge.childField)
	}
	return keys
}

/** An entity and those at most depth lines away from it (all of them for 'all') */
export const neighbourhood = (domain: DomainInfo, edges: DiagramEdge[], focus: string | undefined, depth: number | 'all'): Set<string> => {
	if (depth === 'all' || focus === undefined) return new Set(domain.entities.map(e => e.name))
	const seen = new Set([focus])
	let frontier = [focus]
	for (let level = 0; level < depth; level++) {
		const next: string[] = []
		for (const edge of edges) {
			for (const [a, b] of [[edge.parent, edge.child], [edge.child, edge.parent]]) {
				if (frontier.includes(a) && !seen.has(b)) { seen.add(b); next.push(b) }
			}
		}
		frontier = next
	}
	return seen
}

/** The entity to start with: the one with the most lines (the centre of the model) */
export const hubOf = (domain: DomainInfo, edges: DiagramEdge[]): string | undefined => {
	const count = new Map<string, number>()
	for (const edge of edges) for (const name of [edge.parent, edge.child]) count.set(name, (count.get(name) ?? 0) + 1)
	return [...domain.entities].sort((a, b) => (count.get(b.name) ?? 0) - (count.get(a.name) ?? 0) || a.name.localeCompare(b.name))[0]?.name
}

/** The text of the type of a property: text(50), integer · auto, an enum by its name */
export const typeText = (property: PropertyInfo): string =>
	`${property.enum ?? property.type ?? 'string'}${property.length ? `(${property.length})` : ''}${property.autoIncrement ? ' · auto' : ''}`

export const ROW = 18
export const HEADER = 26
const CHAR = 7.2

/** The size of an entity's box: its name and, unless compact, a row per property; check: a check before the name (the wizard) */
export const boxSize = (entity: EntityInfo, compact: boolean, check = false): { width: number, height: number } => {
	const title = (entity.name.length + (entity.extends ? entity.extends.length + 3 : 0)) * 8 + 24 + (check ? 18 : 0)
	const rows = compact ? [] : (entity.properties ?? []).map(p => (p.name.length + 2 + typeText(p).length) * CHAR + 44)
	return { width: Math.ceil(Math.max(140, title, ...rows)), height: HEADER + (compact ? 0 : Math.max(1, entity.properties?.length ?? 0) * ROW + 6) }
}

/** The relations of other entities that point to this one (what references it) */
export const referencesTo = (domain: DomainInfo, entity: string): { entity: string, relation: RelationInfo }[] =>
	domain.entities.filter(e => e.name !== entity).flatMap(e => (e.relations ?? []).filter(r => r.entity === entity).map(relation => ({ entity: e.name, relation })))

/** "1 — N" from the side of the entity that has the relation */
export const cardinalityOf = (relation: RelationInfo): string =>
	relation.type === 'manyToOne' ? '1 — N' : relation.type === 'oneToMany' ? 'N — 1' : '1 — 1'

export interface Placed { x: number, y: number, width: number, height: number }

/** Where a line meets a box: the row of the field when the box shows its properties, else the middle of the title */
const anchorY = (box: Placed, entity: EntityInfo | undefined, field: string | undefined, compact: boolean): number => {
	const index = !compact && field ? (entity?.properties ?? []).findIndex(p => p.name === field) : -1
	return index >= 0 ? box.y + HEADER + 4 + index * ROW + 9 : box.y + HEADER / 2
}

/**
 * Lines for boxes placed by hand: from the side of the parent that faces the child to the facing side of the child,
 * at the rows of their fields, with a bend in the middle (orthogonal); boxes one above the other, top to bottom; an
 * entity related to itself, a loop on its right. A line with a bend (moved by hand) has its vertical stretch there.
 */
export const routeOrthogonal = (edges: DiagramEdge[], boxes: Map<string, Placed>, entities: Map<string, EntityInfo>, compact: boolean, bends: Record<string, number> = {}): Map<string, { x: number, y: number }[]> => {
	const routes = new Map<string, { x: number, y: number }[]>()
	for (const edge of edges) {
		const p = boxes.get(edge.parent)
		const c = boxes.get(edge.child)
		if (!p || !c) continue
		const py = anchorY(p, entities.get(edge.parent), edge.parentField, compact)
		const cy = anchorY(c, entities.get(edge.child), edge.childField, compact)
		const bend = bends[edge.id]
		if (bend !== undefined) {
			// a line moved by hand: its vertical stretch where it was left; each end leaves its box by the side facing it
			const from = bend >= p.x + p.width / 2 ? p.x + p.width : p.x
			const to = bend >= c.x + c.width / 2 ? c.x + c.width : c.x
			routes.set(edge.id, [{ x: from, y: py }, { x: bend, y: py }, { x: bend, y: cy }, { x: to, y: cy }])
		} else if (edge.parent === edge.child) {
			const x = p.x + p.width
			routes.set(edge.id, [{ x, y: py }, { x: x + 24, y: py }, { x: x + 24, y: Math.max(cy, py + 18) }, { x, y: Math.max(cy, py + 18) }])
		} else if (c.x >= p.x + p.width + 16 || c.x + c.width + 16 <= p.x) {
			const right = c.x >= p.x + p.width
			const from = right ? p.x + p.width : p.x
			const to = right ? c.x : c.x + c.width
			const mid = (from + to) / 2
			routes.set(edge.id, [{ x: from, y: py }, { x: mid, y: py }, { x: mid, y: cy }, { x: to, y: cy }])
		} else {
			const below = c.y >= p.y
			const from = below ? p.y + p.height : p.y
			const to = below ? c.y : c.y + c.height
			const px = p.x + p.width / 2
			const cx = c.x + c.width / 2
			const mid = (from + to) / 2
			routes.set(edge.id, [{ x: px, y: from }, { x: px, y: mid }, { x: cx, y: mid }, { x: cx, y: to }])
		}
	}
	return routes
}
