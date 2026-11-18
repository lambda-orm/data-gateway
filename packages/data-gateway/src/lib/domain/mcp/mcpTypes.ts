/** A JSON Schema (the subset the tools use: object / string / integer / boolean / any) */
export interface JsonSchema {
	type?: 'object' | 'string' | 'integer' | 'number' | 'boolean' | 'array'
	description?: string
	properties?: Record<string, JsonSchema>
	required?: string[]
	additionalProperties?: boolean
	minimum?: number
	minLength?: number
}

/** Hints for the client (they block nothing: what blocks are the permissions of the credential) */
export interface ToolAnnotations {
	title?: string
	readOnlyHint?: boolean
	destructiveHint?: boolean
	idempotentHint?: boolean
	openWorldHint?: boolean
}

/** What `tools/list` answers for one tool */
export interface ToolDefinition {
	name: string
	title?: string
	description: string
	inputSchema: JsonSchema & { type: 'object' }
	annotations: ToolAnnotations
}

/** What `tools/call` answers: the result as JSON text; isError when the model can read the error and correct */
export interface ToolResult {
	content: { type: 'text', text: string }[]
	structuredContent?: Record<string, unknown>
	isError?: boolean
}

export interface ResourceDefinition {
	uri: string
	name: string
	description: string
	mimeType: string
}

export interface ResourceTemplateDefinition {
	uriTemplate: string
	name: string
	description: string
	mimeType: string
}

export interface ResourceContent {
	uri: string
	mimeType: string
	text: string
}

export interface Page<T> {
	items: T[]
	nextCursor?: string
}
