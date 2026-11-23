/**
 * The options of a query or script (QueryOptions and ScriptOptions of λORM) as the fields of a form, and back to their
 * JSON text: the text stays what a query keeps (saved, in its history), the form only shows it. An empty field is no
 * option; an option the form doesn't know is kept as it is.
 */
export interface OptionsFields {
	stage: string
	view: string
	chunkSize: string
	/** '' (the default), 'true' or 'false' */
	tryAllCan: '' | 'true' | 'false'
	/** name and value of each header */
	headers: [string, string][]
	/** scripts only */
	timeout: string
	maxIterations: string
}

export const EMPTY_OPTIONS: OptionsFields = { stage: '', view: '', chunkSize: '', tryAllCan: '', headers: [], timeout: '', maxIterations: '' }

const KNOWN = ['stage', 'view', 'chunkSize', 'tryAllCan', 'headers', 'timeout', 'maxIterations']
const NUMBERS = ['chunkSize', 'timeout', 'maxIterations'] as const

/** A whole number greater than 0, written as such (an empty field is valid: no option) */
export const validCount = (text: string): boolean => text.trim() === '' || /^[1-9]\d*$/.test(text.trim())

const textOf = (value: unknown): string => typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value)

/** The fields of a JSON text of options, and the options the form doesn't know (kept); or why it can't be read */
export const optionsFieldsOf = (text: string): { fields: OptionsFields, extra: Record<string, unknown>, error?: 'invalid' } => {
	let raw: unknown
	try { raw = JSON.parse(text.trim() === '' ? '{}' : text) } catch { return { fields: { ...EMPTY_OPTIONS }, extra: {}, error: 'invalid' } }
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { fields: { ...EMPTY_OPTIONS }, extra: {}, error: 'invalid' }
	const o = raw as Record<string, unknown>
	const extra = Object.fromEntries(Object.entries(o).filter(([key]) => !KNOWN.includes(key)))
	const headers = Array.isArray(o.headers)
		? o.headers.filter(h => Array.isArray(h) && h.length >= 1).map(h => [textOf(h[0]), textOf(h[1])] as [string, string])
		: o.headers && typeof o.headers === 'object' ? Object.entries(o.headers as Record<string, unknown>).map(([k, v]) => [k, textOf(v)] as [string, string]) : []
	return {
		fields: {
			stage: textOf(o.stage),
			view: textOf(o.view),
			chunkSize: textOf(o.chunkSize),
			tryAllCan: o.tryAllCan === true ? 'true' : o.tryAllCan === false ? 'false' : '',
			headers,
			timeout: textOf(o.timeout),
			maxIterations: textOf(o.maxIterations)
		},
		extra
	}
}

/**
 * The JSON text of the fields (only those with a value; a number only when it is a valid one) and the kept options. The
 * options of a script (timeout, maxIterations) are kept in query mode too: the form shows them only for a script.
 */
export const optionsTextOf = (fields: OptionsFields, extra: Record<string, unknown> = {}): string => {
	const options: Record<string, unknown> = { ...extra }
	if (fields.stage.trim()) options.stage = fields.stage.trim()
	if (fields.view.trim()) options.view = fields.view.trim()
	for (const key of NUMBERS) {
		const value = fields[key].trim()
		if (value && validCount(value)) options[key] = Number(value)
	}
	if (fields.tryAllCan) options.tryAllCan = fields.tryAllCan === 'true'
	const headers = fields.headers.filter(([name]) => name.trim()).map(([name, value]) => [name.trim(), value])
	if (headers.length) options.headers = headers
	return Object.keys(options).length ? JSON.stringify(options, null, 2) : '{}'
}
