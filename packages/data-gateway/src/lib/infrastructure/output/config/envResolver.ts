const WHOLE = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/
const BRACED = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * Resolves the environment variables of a configuration value, in the whole tree:
 * - a whole string `$VAR` or `${VAR}` becomes the variable's value, or undefined when it is not defined (the key then
 *   takes its default, or the transport is not exposed);
 * - `${VAR}` inside a longer string is interpolated (`"${HOST}:${PORT}"`); if any of them is not defined, the whole
 *   value is undefined;
 * - a `$` that is not one of those forms is kept (`"a$b"` stays as it is: secrets may contain `$`).
 */
export const resolveEnv = (value: unknown, env: Record<string, string | undefined> = process.env): unknown => {
	if (typeof value === 'string') {
		const whole = WHOLE.exec(value.trim())
		if (whole) return env[whole[1]]
		let missing = false
		const interpolated = value.replace(BRACED, (_match, name: string) => {
			const resolved = env[name]
			if (resolved === undefined) missing = true
			return resolved ?? ''
		})
		return missing ? undefined : interpolated
	}
	if (Array.isArray(value)) {
		return value.map(item => resolveEnv(item, env))
	}
	if (typeof value === 'object' && value !== null) {
		const result: Record<string, unknown> = {}
		for (const [key, item] of Object.entries(value)) {
			const resolved = resolveEnv(item, env)
			if (resolved !== undefined) result[key] = resolved
		}
		return result
	}
	return value
}
