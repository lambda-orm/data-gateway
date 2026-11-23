/**
 * A value of a result shown in the format of a culture (es-AR, en-US, de-DE…): its numbers with their separators, its
 * dates and times as that culture writes them. Without a culture, as it came. Only what is shown changes: the json and
 * yaml views, the copies and the downloads keep the values as they are.
 */
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

const numbers = new Map<string, Intl.NumberFormat>()
const dates = new Map<string, Intl.DateTimeFormat>()
const numberFormat = (culture: string) => numbers.get(culture) ?? numbers.set(culture, new Intl.NumberFormat(culture, { maximumFractionDigits: 20 })).get(culture)!
const dateFormat = (culture: string, time: boolean) => {
	const key = `${culture}|${time}`
	return dates.get(key) ?? dates.set(key, new Intl.DateTimeFormat(culture, time ? { dateStyle: 'medium', timeStyle: 'medium' } : { dateStyle: 'medium' })).get(key)!
}

/** Whether a culture is one the browser knows (else the values are shown as they came) */
export const validCulture = (culture: string | undefined): culture is string => {
	if (!culture) return false
	try { return Intl.NumberFormat.supportedLocalesOf([culture]).length > 0 } catch { return false }
}

/** A number or a date (ISO) in the format of the culture; anything else as it is */
export const formatValue = (value: unknown, culture?: string): string | undefined => {
	if (!validCulture(culture)) return undefined
	if (typeof value === 'number' && Number.isFinite(value)) return numberFormat(culture).format(value)
	if (typeof value !== 'string') return undefined
	const day = DATE.exec(value)
	// a date alone, in the day it says (not moved by the time zone)
	if (day) return dateFormat(culture, false).format(new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])))
	if (DATE_TIME.test(value)) {
		const at = new Date(value.replace(' ', 'T'))
		if (!Number.isNaN(at.getTime())) return dateFormat(culture, true).format(at)
	}
	return undefined
}

/** How a culture writes a number and a date and time: what the preferences show of it */
export const culturePreview = (culture: string): string => {
	if (!validCulture(culture)) return ''
	return `${numberFormat(culture).format(1234567.891)} · ${dateFormat(culture, true).format(new Date(2026, 10, 23, 18, 30, 0))}`
}
