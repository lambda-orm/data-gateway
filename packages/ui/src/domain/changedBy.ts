import { adminMessagesOf, format } from './adminI18n'

/** who changed an element, from the details of a 412 (a gateway that keeps the history: details.changedBy) */
export interface ChangedBy { credential?: string, client?: string, time: string, kind?: string, target?: string }

/** "<credential> changed it at <time>: this is what it has now", or the text without who when the gateway doesn't say */
export const changedByText = (changedBy: ChangedBy | undefined, locale: string | undefined, fallback: string): string => {
	if (!changedBy?.time) return fallback
	const date = new Date(changedBy.time)
	const time = Number.isNaN(date.getTime()) ? changedBy.time : date.toLocaleTimeString(locale)
	const name = changedBy.credential ?? changedBy.client ?? '?'
	return format(adminMessagesOf(locale).changedBy, { name: changedBy.client && changedBy.credential ? `${name} (${changedBy.client})` : name, time })
}
