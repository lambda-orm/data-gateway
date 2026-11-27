/** Where the traces of a gateway are seen, as its management tells at GET /observability (observability.explore) */
export interface Explore {
	grafana: string
	/** the uid of the datasource of Tempo */
	tempo: string
	orgId: number
}

/**
 * The Explore of Grafana on Tempo with the traces of an entity (its spans carry lambdaorm.entity): from the tab of the
 * entity, to see what λORM did with it.
 */
export const tracesOfEntity = (explore: Explore, entity: string): string => {
	const query = `{ span.lambdaorm.entity = ${JSON.stringify(entity)} }`
	const datasource = explore.tempo || 'tempo'
	const panes = { a: { datasource, queries: [{ refId: 'A', datasource: { type: 'tempo', uid: datasource }, queryType: 'traceql', query }], range: { from: 'now-1h', to: 'now' } } }
	return `${explore.grafana.replace(/\/+$/, '')}/explore?schemaVersion=1&orgId=${explore.orgId || 1}&panes=${encodeURIComponent(JSON.stringify(panes))}`
}
