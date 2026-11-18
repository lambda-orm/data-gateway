import { ToolResult } from '../../domain/mcp/mcpTypes'

/** structuredContent duplicates the payload: only for small results */
export const STRUCTURED_CONTENT_MAX_BYTES = 1024 * 1024

export interface TruncatedRows {
	rows: unknown[]
	truncated: true
	returned: number
	total: number
	hint: string
}

/** Cuts an array result longer than maxRows (0 = no limit) and tells the model how to ask for less */
export const limitRows = (result: unknown, maxRows: number): unknown => {
	if (!Array.isArray(result) || maxRows <= 0 || result.length <= maxRows) return result
	const truncated: TruncatedRows = {
		rows: result.slice(0, maxRows),
		truncated: true,
		returned: maxRows,
		total: result.length,
		hint: `The result was cut to ${maxRows} rows. Use .page(1, ${maxRows}) (or a smaller page), aggregate with map/count, or filter the query more.`
	}
	return truncated
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/** A successful result: JSON text, and structuredContent (same object) when it is an object and small */
export const toolSuccess = (result: unknown): ToolResult => {
	const text = JSON.stringify(result === undefined ? null : result)
	const toolResult: ToolResult = { content: [{ type: 'text', text }], isError: false }
	if (isPlainObject(result) && Buffer.byteLength(text) < STRUCTURED_CONTENT_MAX_BYTES) toolResult.structuredContent = result
	return toolResult
}

/** An error the model can read and correct (λORM syntax, permission, script disabled, timeout…) */
export const toolError = (error: unknown): ToolResult => {
	const name = (error as any)?.name ?? 'Error'
	const message = (error as any)?.message ?? String(error)
	return { content: [{ type: 'text', text: `${name}: ${message}` }], isError: true }
}
