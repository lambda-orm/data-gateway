import React, { useMemo, useRef, useState } from 'react'
import { AdminApiPort } from '../application/ports'
import { adminMessagesOf, format } from '../domain/adminI18n'
import { EditorMarker } from '../domain/workspace'
import { expressionCompletions, EXPRESSION_VALUES } from '../domain/expressionCompletion'
import { STAGE_SOURCE_VARIABLES } from '../domain/expressionTokens'
import { CodeEditor } from './CodeEditor'
import { Modal } from './dialogs'
import { useExpressionCheck, useExpressionLanguage } from './ExpressionInput'

/** What the variables of a sentence are, when the gateway doesn't say (an older one) */
const FALLBACK = STAGE_SOURCE_VARIABLES.map(name => ({ name, type: ['read', 'write', 'dml', 'ddl'].includes(name) ? 'boolean' : 'string', description: '' }))

export interface ExpressionDialogProps {
	admin: AdminApiPort
	title: string
	value: string
	/** stageSource: the condition of a source of a stage */
	context?: string
	entities?: string[]
	locale?: string
	theme?: 'light' | 'dark'
	onApply: (value: string) => void
	onClose: () => void
}

/**
 * An expression written in its own form: an editor with the colors of 3xpr, its suggestions (Ctrl+Space: the
 * variables, the functions; inside quotes the entities and the values of action, category and type) and its check;
 * beside it the variables of its context, what each one is and what it can be, inserted with a click.
 */
export const ExpressionDialog: React.FC<ExpressionDialogProps> = ({ admin, title, value, context = 'stageSource', entities = [], locale, theme, onApply, onClose }) => {
	const m = adminMessagesOf(locale)
	const [text, setText] = useState(value)
	const language = useExpressionLanguage(admin)
	const { problem, error } = useExpressionCheck(admin, text, context, language, locale)
	const insert = useRef<(text: string) => void>()
	const variables = language?.contexts[context]?.length ? language.contexts[context] : FALLBACK
	const lines = text.split('\n')
	const markers = useMemo<EditorMarker[]>(() => problem
		? [{ message: problem, severity: error ? 'error' : 'warning', startLineNumber: 1, startColumn: 1, endLineNumber: lines.length, endColumn: (lines[lines.length - 1]?.length ?? 0) + 1 }]
		: [], [problem, text])
	return (
		<Modal title={title} onClose={onClose} theme={theme}>
			<div className="lw-expression-dialog">
				<div className="lw-expression-editor">
					<CodeEditor value={text} onChange={setText} language="3xpr" expressionVariables={variables.map(v => v.name)} height="100%" theme={theme} ariaLabel={m.condition}
						markers={markers} listMarkers={false} inserter={insert} triggerCharacters={['.', '"', '(', ' ']}
						completion={(all, line, column) => expressionCompletions(language, context, entities, all.split('\n')[line - 1] ?? '', column)} />
					<small className="lw-type">{m.conditionHint}</small>
					<small className="lw-type">{m.expressionKeys}</small>
					{problem && <small className={error ? 'lw-error' : 'lw-warning'} role="status">{problem}</small>}
				</div>
				<aside className="lw-expression-help" aria-label={m.contextVariables}>
					<strong>{m.contextVariables}</strong>
					<ul>
						{variables.map(v => (
							<li key={v.name}>
								<button type="button" className="lw-link" title={format(m.insertIt, { name: v.name })} onClick={() => insert.current?.(v.name)}>
									<code className="lw-tok-variable">{v.name}</code>
								</button>
								<span className="lw-type"> {v.type}</span>
								{v.description && <div className="lw-type">{v.description}</div>}
								{EXPRESSION_VALUES[v.name] && (
									<div className="lw-chips">
										{EXPRESSION_VALUES[v.name].map(option => (
											<button key={option} type="button" className="lw-chip" title={format(m.insertIt, { name: `${v.name} == "${option}"` })}
												onClick={() => insert.current?.(`"${option}"`)}><code className="lw-tok-string">"{option}"</code></button>
										))}
									</div>
								)}
							</li>
						))}
					</ul>
				</aside>
			</div>
			<div className="lw-form-actions">
				<button type="button" onClick={onClose}>{m.cancel}</button>
				<button type="button" className="lw-primary" disabled={error} onClick={() => { onApply(text.trim()); onClose() }}>{m.apply}</button>
			</div>
		</Modal>
	)
}
