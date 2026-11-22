import React, { useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import { EditorMarker } from '../domain/workspace'
import { loadMonaco } from '../infrastructure/monaco/monacoSetup'

export interface CodeEditorProps {
	value: string
	onChange: (value: string) => void
	language: 'typescript' | 'javascript' | 'json' | 'yaml'
	/** Shown, not edited */
	readOnly?: boolean
	/** λORM errors to mark in the text */
	markers?: EditorMarker[]
	/** Ctrl/Cmd+Enter */
	onRun?: () => void
	height?: number | string
	theme?: 'light' | 'dark'
	ariaLabel: string
}

let models = 0

/**
 * Monaco when it loads; a plain text area before (and if it can't load, e.g. no browser workers). The text area keeps
 * the workbench usable and is what the tests type in.
 */
export const CodeEditor: React.FC<CodeEditorProps> = ({ value, onChange, language, readOnly = false, markers = [], onRun, height = 160, theme = 'light', ariaLabel }) => {
	const host = useRef<HTMLDivElement>(null)
	const editor = useRef<Monaco.editor.IStandaloneCodeEditor>()
	const monacoRef = useRef<typeof Monaco>()
	const handlers = useRef({ onChange, onRun })
	handlers.current = { onChange, onRun }
	const [ready, setReady] = useState(false)

	useEffect(() => {
		let disposed = false
		loadMonaco().then(monaco => {
			if (disposed || !host.current) return
			monacoRef.current = monaco
			const extension = language === 'json' ? 'json' : language === 'yaml' ? 'yaml' : language === 'typescript' ? 'ts' : 'js'
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
			editor.current = instance
			setReady(true)
		}).catch(() => { /* the text area stays */ })
		return () => {
			disposed = true
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
