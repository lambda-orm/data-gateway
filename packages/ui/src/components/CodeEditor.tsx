import React, { useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import { EditorMarker } from '../domain/workspace'
import { loadMonaco } from '../infrastructure/monaco/monacoSetup'
import { EXPRESSION_CONSTANTS, STAGE_SOURCE_VARIABLES } from '../domain/expressionTokens'
import type { LambdaKind } from '../domain/lambdaCompletion'

export interface CodeEditorProps {
	value: string
	onChange: (value: string) => void
	/** 3xpr: an expression of λORM (its colors; its variables in expressionVariables) */
	language: 'typescript' | 'javascript' | 'json' | 'yaml' | 'sql' | 'plaintext' | '3xpr'
	/** the variables of the context of a 3xpr expression, colored apart */
	expressionVariables?: string[]
	/** Shown, not edited */
	readOnly?: boolean
	/** λORM errors to mark in the text */
	markers?: EditorMarker[]
	/** Ctrl/Cmd+Enter */
	onRun?: () => void
	height?: number | string
	theme?: 'light' | 'dark'
	ariaLabel: string
	/** Suggestions of its own at a position (1-based): keys and values of a lambdaORM.yaml */
	completion?: (text: string, line: number, column: number) => CompletionItem[]
	/** the markers listed under the text area while Monaco is not there (default: yes; no when the owner says them) */
	listMarkers?: boolean
	/** set to a function that inserts a text at the cursor (the editor, or the end of the text area) */
	inserter?: React.MutableRefObject<((text: string) => void) | undefined>
	/** a query or a script of λORM: its suggestions show what each one is (the icons of the types, lw-lambda) */
	lambda?: boolean
	/** one short text (an expression): no line numbers, no folding */
	compact?: boolean
	/** characters that open the suggestions (besides typing a word) */
	triggerCharacters?: string[]
}

/** A suggestion of an editor: a key or value of a YAML, a function, a variable or a constant of an expression */
export interface CompletionItem {
	label: string
	kind: 'key' | 'value' | 'function' | 'variable' | 'constant' | LambdaKind
	insertText: string
	detail?: string
	documentation?: string
	/** insertText is a snippet ($1 where the cursor goes) */
	snippet?: boolean
}

let models = 0

/**
 * The kind of Monaco of a suggestion: its icon. Those of λORM take kinds TypeScript doesn't give in these editors (its
 * suggestions are off): styles.css draws each one with the glyph and color of its type (.lw-lambda).
 */
const kindOf = (monaco: typeof Monaco, kind: CompletionItem['kind']): Monaco.languages.CompletionItemKind => {
	const K = monaco.languages.CompletionItemKind
	return ({
		key: K.Property, value: K.Value, function: K.Function, variable: K.Variable, constant: K.Constant,
		string: K.Text, number: K.Unit, boolean: K.Constant, date: K.Event, json: K.Struct, uuid: K.Value, enum: K.Enum, any: K.Variable,
		relation: K.Class, relations: K.Module, entity: K.Interface, parameter: K.Variable, clause: K.Method,
		'fn-string': K.Field, 'fn-number': K.Property, 'fn-date': K.Operator, 'fn-boolean': K.TypeParameter, 'fn-list': K.Reference, 'fn-any': K.Function
	} as Record<string, Monaco.languages.CompletionItemKind>)[kind] ?? K.Text
}

let expressionsRegistered: string | undefined
/** 3xpr in Monaco: its colors, as expressionTokens reads them (the variables of the context apart) */
const registerExpressions = (monaco: typeof Monaco, given: string[]) => {
	const variables = given.length ? given : STAGE_SOURCE_VARIABLES
	const key = variables.join(',')
	if (expressionsRegistered === key) return
	if (expressionsRegistered === undefined) monaco.languages.register({ id: '3xpr' })
	expressionsRegistered = key
	monaco.languages.setMonarchTokensProvider('3xpr', {
		variables,
		constants: EXPRESSION_CONSTANTS,
		tokenizer: {
			root: [
				[/[A-Za-z_$][\w$]*(?=\s*\()/, 'keyword.flow'],
				[/[A-Za-z_$][\w$]*/, { cases: { '@constants': 'keyword', '@variables': 'variable.predefined', '@default': 'variable' } }],
				[/\d+(\.\d+)?/, 'number'],
				[/"([^"\\]|\\.)*"?/, 'string'],
				[/'([^'\\]|\\.)*'?/, 'string'],
				[/[-+*/%<>!=&|^~?:]+/, 'operator'],
				[/[()[\]{}.,;]/, 'delimiter']
			]
		}
	} as any)
	monaco.languages.setLanguageConfiguration('3xpr', {
		brackets: [['(', ')'], ['[', ']'], ['{', '}']],
		autoClosingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' }, { open: '{', close: '}' }, { open: '"', close: '"' }, { open: "'", close: "'" }]
	})
}

/**
 * Monaco when it loads; a plain text area before (and if it can't load, e.g. no browser workers). The text area keeps
 * the workbench usable and is what the tests type in.
 */
export const CodeEditor: React.FC<CodeEditorProps> = ({ value, onChange, language, readOnly = false, markers = [], onRun, height = 160, theme = 'light', ariaLabel, completion, triggerCharacters = [' ', ':'], compact = false, expressionVariables = STAGE_SOURCE_VARIABLES, inserter, listMarkers = true, lambda = false }) => {
	const host = useRef<HTMLDivElement>(null)
	const editor = useRef<Monaco.editor.IStandaloneCodeEditor>()
	const monacoRef = useRef<typeof Monaco>()
	const completionProvider = useRef<Monaco.IDisposable>()
	const handlers = useRef({ onChange, onRun, completion })
	handlers.current = { onChange, onRun, completion }
	const [ready, setReady] = useState(false)
	// without Monaco (before it loads, or in tests): what is inserted goes at the end of the text
	useEffect(() => { if (inserter && !ready) inserter.current = (text: string) => handlers.current.onChange(value + text) }, [inserter, ready, value])

	useEffect(() => {
		let disposed = false
		loadMonaco().then(monaco => {
			if (disposed || !host.current) return
			monacoRef.current = monaco
			if (language === '3xpr') registerExpressions(monaco, expressionVariables)
			const extension = ({ json: 'json', yaml: 'yaml', typescript: 'ts', javascript: 'js', sql: 'sql', plaintext: 'txt', '3xpr': 'txt' } as const)[language]
			const model = monaco.editor.createModel(value, language, monaco.Uri.parse(`file:///lambdaorm-${++models}.${extension}`))
			const instance = monaco.editor.create(host.current, {
				model,
				minimap: { enabled: false },
				automaticLayout: true,
				scrollBeyondLastLine: false,
				fontSize: 13,
				lineNumbers: compact ? 'off' : 'on',
				glyphMargin: false,
				lineDecorationsWidth: compact ? 4 : undefined,
				lineNumbersMinChars: compact ? 0 : undefined,
				wordWrap: compact || language === '3xpr' ? 'on' : 'off',
				renderLineHighlight: compact ? 'none' : 'line',
				overviewRulerLanes: compact ? 0 : undefined,
				// at its top or its end, the wheel scrolls the page (not three scrolls inside each other)
				scrollbar: compact ? { vertical: 'auto', horizontal: 'hidden', alwaysConsumeMouseWheel: false } : { alwaysConsumeMouseWheel: false },
				wordBasedSuggestions: compact ? 'off' : undefined,
				tabSize: 2,
				theme: theme === 'dark' ? 'vs-dark' : 'vs',
				ariaLabel,
				readOnly,
				domReadOnly: readOnly,
				folding: !compact
			})
			instance.onDidChangeModelContent(() => handlers.current.onChange(instance.getValue()))
			instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => handlers.current.onRun?.())
			// suggestions of its own, only for this editor's model (the provider of a language is global)
			if (handlers.current.completion) {
				completionProvider.current = monaco.languages.registerCompletionItemProvider(language, {
					triggerCharacters,
					provideCompletionItems: (target, position) => {
						if (target !== model || !handlers.current.completion) return { suggestions: [] }
						const word = target.getWordUntilPosition(position)
						const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
						return {
							suggestions: handlers.current.completion(target.getValue(), position.lineNumber, position.column).map(s => ({
								label: s.label,
								kind: kindOf(monaco, s.kind),
								insertText: s.insertText,
								insertTextRules: s.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
								detail: s.detail,
								documentation: s.documentation,
								sortText: (s as any).sortText,
								range
							}))
						}
					}
				})
			}
			editor.current = instance
			if (inserter) {
				inserter.current = (text: string) => {
					const selection = instance.getSelection()
					if (selection) instance.executeEdits('insert', [{ range: selection, text, forceMoveMarkers: true }])
					instance.focus()
				}
			}
			setReady(true)
		}).catch(() => { /* the text area stays */ })
		return () => {
			disposed = true
			completionProvider.current?.dispose()
			const model = editor.current?.getModel()
			editor.current?.dispose()
			model?.dispose()
			editor.current = undefined
		}
	// the editor is created once; value and markers are synchronized below
	}, [language])

	useEffect(() => {
		const instance = editor.current
		if (instance && instance.getValue() !== value) instance.setValue(value)
	}, [value, ready])

	useEffect(() => {
		const model = editor.current?.getModel()
		const monaco = monacoRef.current
		if (!model || !monaco) return
		monaco.editor.setModelMarkers(model, 'lambdaorm', markers.map(m => ({ ...m, severity: m.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error })))
	}, [markers, ready])

	useEffect(() => {
		monacoRef.current?.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs')
	}, [theme, ready])

	return (
		<div className={lambda ? 'lw-editor lw-lambda' : 'lw-editor'} style={{ height }}>
			<div ref={host} className="lw-editor-host" style={{ height, display: ready ? 'block' : 'none' }} />
			{!ready && (
				<textarea
					className="lw-editor-fallback"
					aria-label={ariaLabel}
					value={value}
					spellCheck={false}
					readOnly={readOnly}
					style={{ height }}
					onChange={e => onChange(e.target.value)}
					onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onRun?.() } }}
				/>
			)}
			{!ready && !compact && listMarkers && markers.length > 0 && <ul className="lw-markers">{markers.map((m, i) => <li key={i}>{m.message}</li>)}</ul>}
		</div>
	)
}
