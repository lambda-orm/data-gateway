/** A parameter a query expects, as GET /parameters answers it */
export interface QueryParameter {
	name: string
	type?: string
}

const sample = (type: string | undefined): unknown => {
	switch (type) {
	case 'integer': case 'decimal': case 'number': return 0
	case 'boolean': return false
	case 'date': case 'dateTime': case 'time': return new Date().toISOString().slice(0, 10)
	case 'any': case 'object': return null
	default: return type?.endsWith('[]') ? [] : ''
	}
}

/**
 * The data of a query completed with the parameters it expects: the values already written stay, the missing ones
 * get a placeholder of their type. Nested names (entity.name) become nested objects.
 */
export const dataFromParameters = (parameters: QueryParameter[], current: Record<string, unknown>): Record<string, unknown> => {
	const data: Record<string, unknown> = JSON.parse(JSON.stringify(current))
	for (const parameter of parameters) {
		const path = parameter.name.split('.')
		let target: Record<string, unknown> = data
		for (const part of path.slice(0, -1)) {
			if (typeof target[part] !== 'object' || target[part] === null) target[part] = {}
			target = target[part] as Record<string, unknown>
		}
		const last = path[path.length - 1]
		if (!(last in target)) target[last] = sample(parameter.type)
	}
	return data
}

/** JSON text of the data / options editors: empty is {}; invalid says where */
export const parseObject = (text: string, what: string): Record<string, unknown> => {
	if (!text.trim()) return {}
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch (error: any) {
		throw new Error(`${what} is not valid JSON: ${error?.message ?? error}`)
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what} must be a JSON object`)
	return value as Record<string, unknown>
}

/** One query (or script) the workbench ran on a schema: kept in the history, never with credentials or results */
export interface HistoryEntry {
	mode: 'query' | 'script'
	text: string
	data: string
	options: string
	at: string
}

export const HISTORY_SIZE = 30

/** The newest first, the same text once */
export const addToHistory = (history: HistoryEntry[], entry: HistoryEntry, size = HISTORY_SIZE): HistoryEntry[] =>
	[entry, ...history.filter(e => !(e.mode === entry.mode && e.text === entry.text))].slice(0, size)

/** An error of λORM as an editor marker: where it says (line / column), or the whole first line */
export interface EditorMarker {
	message: string
	startLineNumber: number
	startColumn: number
	endLineNumber: number
	endColumn: number
}

export const markerFromError = (message: string, text: string): EditorMarker => {
	const lines = text.split('\n')
	const position = /line[: ]+(\d+)[^0-9]+col(?:umn)?[: ]+(\d+)/i.exec(message)
	if (position) {
		const line = Math.min(Number(position[1]), lines.length)
		const column = Number(position[2])
		return { message, startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: (lines[line - 1]?.length ?? column) + 1 }
	}
	return { message, startLineNumber: 1, startColumn: 1, endLineNumber: lines.length, endColumn: (lines[lines.length - 1]?.length ?? 0) + 1 }
}
