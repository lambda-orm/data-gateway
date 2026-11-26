import React, { useEffect, useMemo, useRef, useState } from 'react'
import { QueryApiPort } from '../application/ports'
import { CodeEditor } from './CodeEditor'
import { OptionsFields, optionsFieldsOf, optionsTextOf, validCount } from '../domain/queryOptions'
import { optionsMessagesOf } from '../domain/optionsI18n'
import { format } from '../domain/i18n'

export interface OptionsFormProps {
	/** the options as JSON text: what the query keeps */
	value: string
	onChange: (value: string) => void
	/** the stages of the schema are its choices */
	api: QueryApiPort
	schema?: string
	/** a script has two more options (timeout, maxIterations) */
	mode: 'query' | 'script'
	theme: 'light' | 'dark'
	locale?: string
	/** the label over the form */
	label: string
	/** show the label over the form (in a dialog its title says it) */
	heading?: boolean
}

/** The options in one line: what is set (or that none is), for the bar of a query */
export const optionsSummary = (text: string, locale?: string): { text: string, invalid: boolean } => {
	const m = optionsMessagesOf(locale)
	const read = optionsFieldsOf(text)
	if (read.error) return { text: m.invalidShort, invalid: true }
	const f = read.fields
	const parts = [
		f.stage && `${m.stage}: ${f.stage}`,
		f.view && `${m.view}: ${f.view}`,
		f.chunkSize && `${m.chunkSize}: ${f.chunkSize}`,
		f.tryAllCan && `${m.tryAllCan}: ${f.tryAllCan === 'true' ? m.yes : m.no}`,
		f.headers.length > 0 && format(m.headersCount, { n: f.headers.length }),
		f.timeout && `${m.timeout}: ${f.timeout}`,
		f.maxIterations && `${m.maxIterations}: ${f.maxIterations}`,
		...Object.keys(read.extra)
	].filter(Boolean) as string[]
	return { text: parts.length ? parts.join(' · ') : m.none, invalid: false }
}

/**
 * The options of a query (QueryOptions / ScriptOptions of λORM) as a form: each field may stay empty, and says what is
 * valid; stage offers those of the schema. The JSON stays what is kept, and can be written as such (JSON).
 */
export const OptionsForm: React.FC<OptionsFormProps> = ({ value, onChange, api, schema, mode, theme, locale, label, heading = true }) => {
	const m = optionsMessagesOf(locale)
	const [asJson, setAsJson] = useState(false)
	const read = useMemo(() => optionsFieldsOf(value), [value])
	// an invalid text can only be fixed as JSON
	const json = asJson || !!read.error
	// what is being typed (a header without its name yet, a number not valid yet) lives here; the JSON gets what is valid.
	// A JSON changed from elsewhere (as JSON, the history, a saved query) starts it again.
	const [fields, setFields] = useState<OptionsFields>(read.fields)
	const sent = useRef(value)
	useEffect(() => {
		if (value === sent.current) return
		sent.current = value
		setFields(optionsFieldsOf(value).fields)
	}, [value])
	const set = (patch: Partial<OptionsFields>) => {
		const next = { ...fields, ...patch }
		setFields(next)
		const text = optionsTextOf(next, read.extra)
		sent.current = text
		onChange(text)
	}

	// the stages and the views the roles of the credential let it choose (data-gateway 4.4); before, the stages of the schema
	const [choices, setChoices] = useState<{ stages?: string[], views?: string[] }>({})
	useEffect(() => {
		setChoices({})
		if (schema === undefined) return
		let alive = true
		Promise.resolve(api.whoami(schema)).catch(() => undefined).then(async whoami => {
			const stages = whoami?.stages ?? await Promise.resolve(api.stages?.(schema)).catch(() => undefined)
			if (alive) setChoices({ stages, views: whoami?.views })
		})
		return () => { alive = false }
	}, [api, schema])

	const id = useMemo(() => `lw-options-${Math.random().toString(36).slice(2, 8)}`, [])
	/** a choice of the schema (a name kept that is not in it any more is still shown, marked) */
	const choice = (key: 'stage' | 'view', list: string[] | undefined, hint: string) => {
		const current = fields[key]
		const names = list ?? []
		return (
			<div className="lw-option">
				<span className="lw-option-label" aria-hidden="true">{m[key]}</span>
				<div>
					{list
						? (
							<select id={`${id}-${key}`} aria-label={`${label} · ${m[key]}`} value={current} onChange={e => set({ [key]: e.target.value })}>
								<option value="">{m.byDefault}</option>
								{names.map(name => <option key={name} value={name}>{name}</option>)}
								{current && !names.includes(current) && <option value={current}>{current} ({m.notInSchema})</option>}
							</select>
						)
						: <input id={`${id}-${key}`} aria-label={`${label} · ${m[key]}`} value={current} onChange={e => set({ [key]: e.target.value })} placeholder={m.byDefault} spellCheck={false} />}
					<div className="lw-hint">{hint}</div>
				</div>
			</div>
		)
	}
	const count = (key: 'chunkSize' | 'timeout' | 'maxIterations', hint: string) => {
		const valid = validCount(fields[key])
		return (
			<div className="lw-option">
				<span className="lw-option-label" aria-hidden="true">{m[key]}</span>
				<div>
					<input id={`${id}-${key}`} aria-label={`${label} · ${m[key]}`} inputMode="numeric" value={fields[key]} placeholder={m.byDefault} aria-invalid={!valid} title={m.wholeNumber}
						className={valid ? '' : 'lw-invalid'} onChange={e => set({ [key]: e.target.value })} />
					<div className={valid ? 'lw-hint' : 'lw-hint lw-error-text'}>{valid ? hint : m.wholeNumber}</div>
				</div>
			</div>
		)
	}
	const headers = fields.headers
	const setHeader = (index: number, at: 0 | 1, text: string) => set({ headers: headers.map((h, i) => i === index ? (at === 0 ? [text, h[1]] : [h[0], text]) as [string, string] : h) })
	const extraNames = Object.keys(read.extra)

	return (
		<div className="lw-options">
			<div className="lw-options-head">
				{heading ? <span className="lw-label">{label}</span> : <span className="lw-spacer" />}
				<span className="lw-modes lw-modes-small" role="radiogroup" aria-label={label}>
					<button type="button" role="radio" aria-checked={!json} className={!json ? 'lw-active' : ''} disabled={!!read.error} onClick={() => setAsJson(false)}>{m.form}</button>
					<button type="button" role="radio" aria-checked={json} className={json ? 'lw-active' : ''} onClick={() => setAsJson(true)}>{m.json}</button>
				</span>
			</div>
			{json
				? (
					<>
						<CodeEditor ariaLabel="options" language="json" theme={theme} value={value} onChange={onChange} height={110} />
						{read.error && <div className="lw-hint lw-error-text">{m.invalid}</div>}
					</>
				)
				: (
					<div className="lw-options-form">
						{choice('stage', choices.stages, m.stageHint)}
						{(choices.views?.length ?? 0) > 1 && choice('view', choices.views, m.viewHint)}
						{count('chunkSize', m.chunkSizeHint)}
						<div className="lw-option">
							<span className="lw-option-label" aria-hidden="true">{m.tryAllCan}</span>
							<div>
								<select id={`${id}-tryAllCan`} aria-label={`${label} · ${m.tryAllCan}`} value={fields.tryAllCan} onChange={e => set({ tryAllCan: e.target.value as OptionsFields['tryAllCan'] })}>
									<option value="">{m.byDefault}</option>
									<option value="true">{m.yes}</option>
									<option value="false">{m.no}</option>
								</select>
								<div className="lw-hint">{m.tryAllCanHint}</div>
							</div>
						</div>
						{mode === 'script' && count('timeout', m.timeoutHint)}
						{mode === 'script' && count('maxIterations', m.maxIterationsHint)}
						<div className="lw-option">
							<span className="lw-option-label">{m.headers}</span>
							<div>
								{headers.map(([name, text], index) => (
									<div key={index} className="lw-option-pair">
										<input aria-label={`${label} · ${m.headers} · ${m.headerName}`} placeholder={m.headerName} value={name} onChange={e => setHeader(index, 0, e.target.value)} spellCheck={false} />
										<input aria-label={`${label} · ${m.headers} · ${m.headerValue}`} placeholder={m.headerValue} value={text} onChange={e => setHeader(index, 1, e.target.value)} spellCheck={false} />
										<button type="button" className="lw-icon" aria-label={m.removeHeader} title={m.removeHeader} onClick={() => set({ headers: headers.filter((_, i) => i !== index) })}>×</button>
									</div>
								))}
								<button type="button" onClick={() => set({ headers: [...headers, ['', '']] })}>+ {m.addHeader}</button>
								<div className="lw-hint">{m.headersHint}</div>
							</div>
						</div>
						{extraNames.length > 0 && <div className="lw-hint">{format(m.kept, { names: extraNames.join(', ') })}</div>}
					</div>
				)}
		</div>
	)
}
