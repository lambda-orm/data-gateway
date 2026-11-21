import { McpRequestError } from '../../domain/errors/gatewayError'
import { JsonSchema } from '../../domain/mcp/mcpTypes'

const typeOf = (value: unknown): string => {
	if (value === null) return 'null'
	if (Array.isArray(value)) return 'array'
	if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
	return typeof value
}

const matches = (schema: JsonSchema, value: unknown): boolean => {
	if (!schema.type) return true
	const actual = typeOf(value)
	return actual === schema.type || (schema.type === 'number' && actual === 'integer')
}

/**
 * Checks the arguments of a tool against its inputSchema (the subset the tools use): object, known properties,
 * required ones present, types, minLength / minimum, lists (minItems, maxItems, the type of their items). Every problem in one McpRequestError (JSON-RPC invalid params).
 */
export const validateArguments = (tool: string, schema: JsonSchema, args: unknown): Record<string, unknown> => {
	const value = args ?? {}
	if (typeOf(value) !== 'object') throw new McpRequestError(`${tool}: the arguments must be an object`)
	const object = value as Record<string, unknown>
	const properties = schema.properties ?? {}
	const problems: string[] = []
	for (const key of schema.required ?? []) {
		if (object[key] === undefined || object[key] === null) problems.push(`"${key}" is required`)
	}
	for (const [key, item] of Object.entries(object)) {
		const property = properties[key]
		if (!property) {
			if (schema.additionalProperties === false) problems.push(`"${key}" is not an argument (valid: ${Object.keys(properties).join(', ') || 'none'})`)
			continue
		}
		if (item === undefined || item === null) continue
		if (!matches(property, item)) problems.push(`"${key}" must be ${property.type}, not ${typeOf(item)}`)
		else if (property.minLength !== undefined && typeof item === 'string' && item.trim().length < property.minLength) problems.push(`"${key}" must not be empty`)
		else if (property.minimum !== undefined && typeof item === 'number' && item < property.minimum) problems.push(`"${key}" must be >= ${property.minimum}`)
		else if (Array.isArray(item)) {
			if (property.minItems !== undefined && item.length < property.minItems) problems.push(`"${key}" must have at least ${property.minItems} items`)
			else if (property.maxItems !== undefined && item.length > property.maxItems) problems.push(`"${key}" must have at most ${property.maxItems} items`)
			else if (property.items && item.some(element => !matches(property.items!, element))) problems.push(`"${key}" must be a list of ${property.items.type}`)
		}
	}
	if (problems.length) throw new McpRequestError(`${tool}: ${problems.join('; ')}`)
	return object
}
