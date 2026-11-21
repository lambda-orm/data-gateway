import YAML from 'js-yaml'
import { Operation } from './operations'

/** An error as the gateway answers it */
export interface ResultError {
	name: string
	message: string
	status?: number
	code?: string
	/** names of the query that don't exist, with the closest ones (gateway 3.1.0) */
	suggestions?: { name: string, didYouMean: string[] }[]
}

/** The outcome of one action, with what the result viewer shows about it */
export interface QueryResult {
	operation: Operation
	ok: boolean
	status?: number
	durationMs: number
	value?: unknown
	error?: ResultError
	/** Size of the JSON of the value */
	bytes: number
	/** Rows, when the value is a list */
	rows?: number
}

export const toJson = (value: unknown): string => JSON.stringify(value === undefined ? null : value, null, 2)

/** YAML of a result: dates as ISO text, no references between repeated objects */
export const toYaml = (value: unknown): string =>
	YAML.dump(value === undefined ? null : JSON.parse(JSON.stringify(value ?? null)), { noRefs: true, lineWidth: 120, sortKeys: false })

export const fromYaml = (text: string): unknown => YAML.load(text)

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A list of objects can be shown as a table */
export const isTable = (value: unknown): value is Record<string, unknown>[] => Array.isArray(value) && value.length > 0 && value.every(isRecord)

/** The columns of a table: every key, in the order they first appear */
export const columnsOf = (rows: Record<string, unknown>[]): string[] => {
	const columns: string[] = []
	for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key)
	return columns
}

/** A cell: primitives as they are, objects and lists as compact JSON */
export const cellText = (value: unknown): string => {
	if (value === null || value === undefined) return ''
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

/** A cell of a tab-separated text: its tabs and line breaks as spaces */
const tsvCell = (value: unknown): string => cellText(value).replace(/[\t\r\n]+/g, ' ')

/**
 * A result as tab-separated text (spreadsheets open it): a table with its columns as the first line, an object as a
 * table of one row, a list of values as one column "value", a value as itself.
 */
export const toTsv = (value: unknown): string => {
	const rows = isTable(value) ? value : isRecord(value) ? [value] : undefined
	if (rows) {
		const columns = columnsOf(rows)
		return [columns.map(tsvCell).join('\t'), ...rows.map(row => columns.map(c => tsvCell(row[c])).join('\t'))].join('\n') + '\n'
	}
	if (Array.isArray(value)) return ['value', ...value.map(tsvCell)].join('\n') + '\n'
	return tsvCell(value) + '\n'
}

export const measure = (operation: Operation, value: unknown, durationMs: number, status = 200): QueryResult => {
	const json = value === undefined ? '' : JSON.stringify(value)
	return {
		operation,
		ok: true,
		status,
		durationMs,
		value,
		bytes: new TextEncoder().encode(json).length,
		rows: Array.isArray(value) ? value.length : undefined
	}
}

export const failure = (operation: Operation, error: ResultError, durationMs: number): QueryResult =>
	({ operation, ok: false, status: error.status, durationMs, error, bytes: 0 })

export const formatBytes = (bytes: number): string =>
	bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`
