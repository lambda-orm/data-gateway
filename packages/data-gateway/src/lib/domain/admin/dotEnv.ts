/**
 * The .env of a workspace edited without losing what it has (docs/DATA_GATEWAY_ADMIN_PLAN.md §5): the other variables,
 * the comments and the order stay; a variable set replaces its line or is added at the end, one removed loses its line.
 * The values are secrets: nothing here answers them.
 */
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=/

export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** The names a .env defines */
export const dotEnvNames = (text: string): string[] => text.split(/\r?\n/).map(l => LINE.exec(l)?.[1]).filter((n): n is string => !!n)

/** A value as a line of .env: quoted when it has spaces, # or quotes (a JSON connection has ") */
export const dotEnvValue = (value: string): string => {
	if (/[\r\n]/.test(value)) throw new Error('a value of .env is one line')
	if (!/[\s#"']/.test(value)) return value
	if (!value.includes("'")) return `'${value}'`
	if (!value.includes('"')) return `"${value}"`
	throw new Error('a value of .env can\'t have both \' and "')
}

export const editDotEnv = (text: string, set: Record<string, string>, remove: string[]): string => {
	const lines = text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/)
	const pending = new Map(Object.entries(set))
	const out: string[] = []
	for (const line of lines) {
		const name = LINE.exec(line)?.[1]
		if (name && remove.includes(name)) continue
		if (name && pending.has(name)) {
			out.push(`${name}=${dotEnvValue(pending.get(name)!)}`)
			pending.delete(name)
			continue
		}
		out.push(line)
	}
	for (const [name, value] of pending) out.push(`${name}=${dotEnvValue(value)}`)
	return out.length ? out.join('\n') + '\n' : ''
}

/** The variables a lambdaORM.yaml names (${NAME}), with the sources whose connection names each */
export const schemaVariables = (schema: any, text: string): Map<string, string[]> => {
	const found = new Map<string, string[]>()
	for (const match of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) if (!found.has(match[1])) found.set(match[1], [])
	for (const source of Array.isArray(schema?.infrastructure?.sources) ? schema.infrastructure.sources : []) {
		const connection = typeof source?.connection === 'string' ? source.connection : JSON.stringify(source?.connection ?? '')
		for (const match of connection.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) found.get(match[1])?.push(source.name)
	}
	return found
}
