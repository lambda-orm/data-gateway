import React, { useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import { EditorMarker } from '../domain/workspace'
import { loadMonaco } from '../infrastructure/monaco/monacoSetup'

export interface CodeEditorProps {
	value: string
	onChange: (value: string) => void
	language: 'typescript' | 'javascript' | 'json' | 'yaml' | 'sql' | 'plaintext'
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
	completion?: (text: string, line: number, column: number) => { label: string, kind: 'key' | 'value', insertText: string, detail?: string }[]
}

let models = 0

/**
 * Monaco when it loads; a plain text area before (and if it can't load, e.g. no browser workers). The text area keeps
 * the workbench usable and is what the tests type in.
 */
export const CodeEditor: React.FC<CodeEditorProps> = ({ value, onChange, language, readOnly = false, markers = [], onRun, height = 160, theme = 'light', ariaLabel, completion }) => {
	const host = useRef<HTMLDivElement>(null)
	const editor = useRef<Monaco.editor.IStandaloneCodeEditor>()
	const monacoRef = useRef<typeof Monaco>()
	const completionProvider = useRef<Monaco.IDisposable>()
	const handlers = useRef({ onChange, onRun, completion })
	handlers.current = { onChange, onRun, completion }
	const [ready, setReady] = useState(false)

	useEffect(() => {
		let disposed = false
		loadMonaco().then(monaco => {
			if (disposed || !host.current) return
			monacoRef.current = monaco
			const extension = ({ json: 'json', yaml: 'yaml', typescript: 'ts', javascript: 'js', sql: 'sql', plaintext: 'txt' } as const)[language]
			const model = monaco.editor.createModel(value, language, monaco.Uri.parse(`file:///lambdaorm-${++models}.${extension}`))
			const instance = monaco.editor.create(host.current, {
				model,
				minimap: { enabled: false },
				automaticLayout: true,
				scrollBeyondLastLine: false,
				fontSize: 13,
				lineNumbers: 'on',
				tabSize: 2,
				theme: theme === 'dark' ? 'vs-dark' : 'vs',
				ariaLabel,
				readOnly,
				domReadOnly: readOnly,
				folding: true
			})
			instance.onDidChangeModelContent(() => handlers.current.onChange(instance.getValue()))
			instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => handlers.current.onRun?.())
			// suggestions of its own, only for this editor's model (the provider of a language is global)
			if (handlers.current.completion) {
				completionProvider.current = monaco.languages.registerCompletionItemProvider(language, {
					triggerCharacters: [' ', ':'],
					provideCompletionItems: (target, position) => {
						if (target !== model || !handlers.current.completion) return { suggestions: [] }
						const word = target.getWordUntilPosition(position)
						const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
						return {
							suggestions: handlers.current.completion(target.getValue(), position.lineNumber, position.column).map(s => ({
								label: s.label,
								kind: s.kind === 'key' ? monaco.languages.CompletionItemKind.Property : monaco.languages.CompletionItemKind.Value,
								insertText: s.insertText,
								detail: s.detail,
								range
							}))
						}
					}
				})
			}
			editor.current = instance
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
		<div className="lw-editor" style={{ height }}>
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
			{!ready && markers.length > 0 && <ul className="lw-markers">{markers.map((m, i) => <li key={i}>{m.message}</li>)}</ul>}
		</div>
	)
}
