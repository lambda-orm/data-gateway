/** Names a segment of a schema route can't take: they are routes of the gateway itself (docs/DATA_GATEWAY.md §2.2) */
export const RESERVED_SEGMENTS = [
	'health', 'ping', 'metrics', 'version', 'schemas', 'mcp', 'sse', 'messages', 'status', 'doc', 'api-docs', 'swagger',
	'asyncapi', 'ui', 'whoami', 'typings'
]

const SEGMENT = /^[a-zA-Z0-9_.-]+$/

/** 'iot/v1/' → 'iot/v1'; '' is the root */
export const normalizeSchemaPath = (path: string): string => path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

/** Problems of one route: characters and reserved names */
export const schemaPathIssues = (path: string): string[] => {
	if (path === '') return []
	const issues: string[] = []
	for (const segment of path.split('/')) {
		if (!SEGMENT.test(segment)) issues.push(`schema path "${path}": segment "${segment}" must be [a-zA-Z0-9_.-]`)
		else if (RESERVED_SEGMENTS.includes(segment)) issues.push(`schema path "${path}": "${segment}" is reserved`)
	}
	return issues
}

/**
 * Problems of the set of routes: duplicated, one prefix of another (iot and iot/v1), and the root shared with others.
 * Every route is also checked alone.
 */
export const schemaPathsIssues = (paths: string[]): string[] => {
	const issues = paths.flatMap(schemaPathIssues)
	const seen = new Set<string>()
	for (const path of paths) {
		if (seen.has(path)) issues.push(`schema path "${path || '/'}" is used by two schemas`)
		seen.add(path)
	}
	const unique = [...seen]
	if (unique.includes('') && unique.length > 1) issues.push('a schema at the root must be the only schema (the others would be under its routes)')
	for (const a of unique) {
		for (const b of unique) {
			if (a !== '' && a !== b && b.startsWith(`${a}/`)) issues.push(`schema path "${a}" is a prefix of "${b}"`)
		}
	}
	return issues
}
