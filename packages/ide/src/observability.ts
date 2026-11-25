/**
 * The Explore of Grafana on Tempo with the traces of an entity (its spans carry lambdaorm.entity): from the tab of the
 * entity, to see what λORM did with it.
 */
export const tracesOfEntity = (grafanaUrl: string, datasource: string, entity: string): string => {
	const query = `{ span.lambdaorm.entity = ${JSON.stringify(entity)} }`
	const panes = { a: { datasource, queries: [{ refId: 'A', datasource: { type: 'tempo', uid: datasource }, queryType: 'traceql', query }], range: { from: 'now-1h', to: 'now' } } }
	return `${grafanaUrl.replace(/\/+$/, '')}/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify(panes))}`
}
