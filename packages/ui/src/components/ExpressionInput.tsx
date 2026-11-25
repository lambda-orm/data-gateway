import React, { useEffect, useMemo, useState } from 'react'
import { AdminApiPort, ExpressionCheck, ExpressionLanguage } from '../application/ports'
import { EditorMarker } from '../domain/workspace'
import { expressionCompletions } from '../domain/expressionCompletion'
import { adminMessagesOf, format } from '../domain/adminI18n'
import { CodeEditor } from './CodeEditor'

// the language is the same for every expression of a gateway: asked once
const languages = new WeakMap<AdminApiPort, Promise<ExpressionLanguage | undefined>>()
export const languageOf = (admin: AdminApiPort): Promise<ExpressionLanguage | undefined> => {
	let language = languages.get(admin)
	if (!language) {
		language = admin.expressionLanguage ? admin.expressionLanguage().catch(() => undefined) : Promise.resolve(undefined)
		languages.set(admin, language)
	}
	return language
}

/** An expression checked by the gateway a moment after it changes: its problem (it doesn't parse, an unknown variable) */
/** variables: the names the expression may use when they aren't a context of the gateway (the properties of an entity) */
export const useExpressionCheck = (admin: AdminApiPort, value: string, context: string, language: ExpressionLanguage | undefined, locale?: string, variables?: string[]) => {
	const m = adminMessagesOf(locale)
	const [check, setCheck] = useState<ExpressionCheck>()
	useEffect(() => {
		if (!admin.checkExpression || !value.trim()) { setCheck(undefined); return }
		let alive = true
		const timer = setTimeout(() => {
			admin.checkExpression!(value, context).then(c => { if (alive) setCheck(c) }).catch(() => { if (alive) setCheck(undefined) })
		}, 400)
		return () => { alive = false; clearTimeout(timer) }
	}, [admin, value, context])
	const known = variables ?? (language?.contexts[context] ?? []).map(v => v.name)
	// with variables of its own, the gateway only says what the expression uses: what isn't one of them is unknown here
	const unknown = variables ? (check?.variables ?? []).filter(v => !variables.includes(v)) : check?.unknown ?? []
	const problem = check?.error ?? (unknown.length ? format(m.notAVariable, { name: unknown.join(', '), names: known.join(', ') }) : undefined)
	return { check, problem, error: !!check?.error }
}

/** The language of the expressions of a gateway, asked once */
export const useExpressionLanguage = (admin: AdminApiPort): ExpressionLanguage | undefined => {
	const [language, setLanguage] = useState<ExpressionLanguage>()
	useEffect(() => { let alive = true; languageOf(admin).then(l => { if (alive) setLanguage(l) }); return () => { alive = false } }, [admin])
	return language
}

export interface ExpressionInputProps {
	admin: AdminApiPort
	value: string
	onChange: (value: string) => void
	readOnly?: boolean
	/** what the expression has to work with: stageSource (the condition of a source of a stage) */
	context?: string
	/** the names of the entities of the schema, suggested inside quotes */
	entities?: string[]
	/** its variables, when they aren't those of a context of the gateway (the properties of an entity) */
	variables?: string[]
	/** the height of the editor (default 44) */
	height?: number
	ariaLabel: string
	placeholder?: string
	theme?: 'light' | 'dark'
	locale?: string
}

/**
 * An expression of 3xpr (λORM's expressions) in an editor: the variables of its context, the functions and the
 * entities suggested while it is written, and checked by the gateway a moment after each change.
 */
export const ExpressionInput: React.FC<ExpressionInputProps> = ({ admin, value, onChange, readOnly = false, context = 'stageSource', entities = [], variables, height = 44, ariaLabel, placeholder, theme, locale }) => {
	const language = useExpressionLanguage(admin)
	const { problem, error } = useExpressionCheck(admin, value, context, language, locale, variables)
	// the completions of its own variables: the language with them as the variables of its context
	const own = useMemo(() => variables && language ? { ...language, contexts: { ...language.contexts, [context]: variables.map(name => ({ name, type: 'any', description: '' })) } } : language, [language, variables, context])
	const lines = value.split('\n')
	const markers = useMemo<EditorMarker[]>(() => problem
		? [{ message: problem, severity: error ? 'error' : 'warning', startLineNumber: 1, startColumn: 1, endLineNumber: lines.length, endColumn: (lines[lines.length - 1]?.length ?? 0) + 1 }]
		: [], [problem, value])

	return (
		<div className="lw-expression">
			<CodeEditor value={value} onChange={onChange} language="3xpr" expressionVariables={variables ?? (language?.contexts[context] ?? []).map(v => v.name)} readOnly={readOnly} compact height={height} theme={theme} ariaLabel={ariaLabel}
				markers={markers} triggerCharacters={['.', '"', '(', ' ']}
				completion={(text, line, column) => expressionCompletions(own, context, entities, text.split('\n')[line - 1] ?? '', column)} />
			{!value && placeholder && <small className="lw-type lw-expression-hint">{placeholder}</small>}
			{problem && <small className={error ? 'lw-error' : 'lw-warning'} role="status">{problem}</small>}
		</div>
	)
}
