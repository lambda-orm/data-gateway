import type { ELK as ElkApi, ElkNode } from 'elkjs/lib/elk-api'

export interface LayoutInput {
	nodes: { id: string, width: number, height: number }[]
	edges: { id: string, source: string, target: string }[]
}

export interface Point { x: number, y: number }

export interface LayoutResult {
	nodes: Map<string, Point>
	edges: Map<string, Point[]>
	width: number
	height: number
}

export type LayoutPort = (input: LayoutInput) => Promise<LayoutResult>

let elk: Promise<ElkApi> | undefined

/** ELK, loaded on first use (the application that never draws a diagram never downloads it) */
const loadElk = (): Promise<ElkApi> => {
	if (!elk) {
		elk = import('elkjs/lib/elk.bundled.js').then(m => new (m.default as any)() as ElkApi).catch(error => {
			// not loaded: the next diagram tries again; a module that is not there any more is a page older than its server
			elk = undefined
			const message = String(error?.message ?? error)
			throw new Error(/dynamically imported module|Importing a module script failed/i.test(message)
				? `the page is older than the gateway (it was updated): reload it to draw diagrams — ${message}`
				: message)
		})
	}
	return elk
}

/**
 * The places of the boxes and the routes of the lines with ELK's layered algorithm: parents on the left, children on
 * the right, orthogonal lines, the parts of the model that don't touch each other packed apart.
 */
export const elkLayout: LayoutPort = async ({ nodes, edges }) => {
	const api = await loadElk()
	const graph: ElkNode = {
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': 'RIGHT',
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.spacing.nodeNode': '36',
			'elk.layered.spacing.nodeNodeBetweenLayers': '90',
			'elk.layered.spacing.edgeNodeBetweenLayers': '24',
			'elk.spacing.edgeEdge': '12',
			'elk.separateConnectedComponents': 'true',
			'elk.spacing.componentComponent': '60',
			'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF'
		},
		children: nodes.map(n => ({ id: n.id, width: n.width, height: n.height })),
		edges: edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] }))
	}
	const laid = await api.layout(graph)
	const result: LayoutResult = { nodes: new Map(), edges: new Map(), width: laid.width ?? 0, height: laid.height ?? 0 }
	for (const child of laid.children ?? []) result.nodes.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 })
	for (const edge of laid.edges ?? []) {
		const points: Point[] = []
		for (const section of edge.sections ?? []) points.push(section.startPoint, ...(section.bendPoints ?? []), section.endPoint)
		result.edges.set(edge.id, points)
	}
	return result
}
