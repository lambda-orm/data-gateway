import { JsonPatchOperation } from '@lambdaorm/base'

const isObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

/** a key in a JSON Pointer (RFC 6901): ~ as ~0, / as ~1 */
const pointer = (key: string | number): string => String(key).replace(/~/g, '~0').replace(/\//g, '~1')

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * The JSON Patch (RFC 6902) that takes before to after: what a change of a schema did, operation by operation (the
 * history of the IDE shows it; a tool can apply it). Lists by position: an element added in the middle is a replace
 * of the ones after it and an add at the end, valid though not the shortest.
 */
export const jsonDiff = (before: unknown, after: unknown, path = ''): JsonPatchOperation[] => {
	if (same(before, after)) return []
	if (isObject(before) && isObject(after)) {
		const operations: JsonPatchOperation[] = []
		for (const key of Object.keys(before)) {
			if (!(key in after)) operations.push({ op: 'remove', path: `${path}/${pointer(key)}` })
		}
		for (const [key, value] of Object.entries(after)) {
			const at = `${path}/${pointer(key)}`
			if (!(key in before)) operations.push({ op: 'add', path: at, value })
			else operations.push(...jsonDiff(before[key], value, at))
		}
		return operations
	}
	if (Array.isArray(before) && Array.isArray(after)) {
		const operations: JsonPatchOperation[] = []
		const common = Math.min(before.length, after.length)
		for (let i = 0; i < common; i++) operations.push(...jsonDiff(before[i], after[i], `${path}/${i}`))
		for (let i = common; i < after.length; i++) operations.push({ op: 'add', path: `${path}/${i}`, value: after[i] })
		// from the end, so each index is still the one of the element when it is removed
		for (let i = before.length - 1; i >= common; i--) operations.push({ op: 'remove', path: `${path}/${i}` })
		return operations
	}
	return [{ op: 'replace', path: path || '', value: after }]
}
