/**
 * A panel of the IDE (docs/FILES_AND_PANELS.md §2): a grid of cards, each a query and how its result is shown — a number
 * (its first value), a table (its rows), bars, lines (a column of labels and one or more of values) or a pie (a label
 * and a value). It runs with the credential of the connection: its view and its permissions.
 */
export type PanelForm = 'number' | 'table' | 'bar' | 'line' | 'pie'
export const PANEL_FORMS: PanelForm[] = ['number', 'table', 'bar', 'line', 'pie']

export interface PanelCard {
	id: string
	title: string
	/** the query, as the query editor has it */
	query: string
	/** JSON text of its parameters */
	data?: string
	form: PanelForm
	/** the column of the labels (bar, line, pie); none, the first one */
	label?: string
	/** the columns of the values (bar, line; pie takes the first); none, every numeric one but the label */
	values?: string[]
	/** how many columns of the grid it takes (1 or 2) */
	width?: 1 | 2
}

export interface PanelContent {
	cards: PanelCard[]
	/** seconds between two refreshes; 0 or none, only by hand */
	refresh?: number
}

type Row = Record<string, unknown>

const rowsOf = (result: unknown): Row[] =>
	Array.isArray(result) ? result.map(r => r && typeof r === 'object' && !Array.isArray(r) ? r as Row : { value: r }) : result && typeof result === 'object' ? [result as Row] : [{ value: result }]

/** The first value of the result: a count, a sum */
export const numberOf = (result: unknown): unknown => {
	const [first] = rowsOf(result)
	if (!first) return undefined
	const values = Object.values(first)
	return values.length ? values[0] : undefined
}

export interface Series { name: string, values: number[] }
export interface ChartData { labels: string[], series: Series[] }

const isNumeric = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))

/** The labels and the series of a chart from the rows of a result */
export const chartOf = (result: unknown, label?: string, values?: string[]): ChartData => {
	const rows = rowsOf(result)
	const columns = rows.length ? Object.keys(rows[0]) : []
	const labelColumn = label && columns.includes(label) ? label : columns[0]
	const valueColumns = values?.length ? values.filter(v => columns.includes(v)) : columns.filter(c => c !== labelColumn && rows.some(r => isNumeric(r[c])))
	return {
		labels: rows.map(r => r[labelColumn] === null || r[labelColumn] === undefined ? '' : String(r[labelColumn])),
		series: valueColumns.map(name => ({ name, values: rows.map(r => isNumeric(r[name]) ? Number(r[name]) : 0) }))
	}
}

/** Up to 5 significant digits, with the culture's separators: 1234.5 → 1,234.5 */
export const formatNumber = (value: number, culture?: string) =>
	new Intl.NumberFormat(culture, { maximumSignificantDigits: 6 }).format(value)

/** A "nice" top for an axis: 0…max rounded up to 1, 2 or 5 × 10^n */
export const niceMax = (max: number): number => {
	if (!(max > 0)) return 1
	const power = 10 ** Math.floor(Math.log10(max))
	const step = [1, 2, 5, 10].find(s => s * power >= max)!
	return step * power
}
