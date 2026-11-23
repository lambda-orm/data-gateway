const UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }

/** '14MB' → bytes (the units of express' body limit); undefined if it isn't a size */
export const parseSize = (size: string | number): number | undefined => {
	if (typeof size === 'number') return Number.isFinite(size) && size >= 0 ? Math.floor(size) : undefined
	const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(size)
	if (!match) return undefined
	return Math.floor(Number(match[1]) * UNITS[(match[2] ?? 'b').toLowerCase()])
}
