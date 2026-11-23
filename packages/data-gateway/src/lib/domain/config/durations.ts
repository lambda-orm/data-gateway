const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }

/** '30m', '12h', '45s', '7d', '500ms' or a number of milliseconds → milliseconds; undefined if it isn't a duration */
export const parseDuration = (value: string | number): number | undefined => {
	if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
	const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/i.exec(value)
	if (!match) return undefined
	return Math.floor(Number(match[1]) * UNITS[(match[2] ?? 'ms').toLowerCase()])
}
