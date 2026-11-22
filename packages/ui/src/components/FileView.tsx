import React, { useEffect, useState } from 'react'
import { AdminApiPort } from '../application/ports'
import { CodeEditor } from './CodeEditor'

export interface FileViewProps {
	admin: AdminApiPort
	schema: string
	path: string
	theme?: 'light' | 'dark'
	/** changes when the gateway serves another version: read again */
	revision?: string
}

const LANGUAGES: Record<string, 'json' | 'yaml' | 'sql' | 'typescript' | 'javascript'> = { json: 'json', yaml: 'yaml', yml: 'yaml', sql: 'sql', ts: 'typescript', js: 'javascript' }

/** A file of data/ or src/ of a workspace (an export, a script, the code of build), read only */
export const FileView: React.FC<FileViewProps> = ({ admin, schema, path, theme = 'light', revision }) => {
	const [text, setText] = useState<string>()
	const [error, setError] = useState<string>()
	useEffect(() => {
		admin.fileContent(schema, path).then(file => { setText(file.text); setError(undefined) }, e => setError(e?.message ?? String(e)))
	}, [admin, schema, path, revision])
	const language = LANGUAGES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext'
	return (
		<section className="lw-file-view" aria-label={path}>
			<div className="lw-toolbar"><strong>{path}</strong></div>
			{error && <div className="lw-notice" role="alert">{error}</div>}
			{text !== undefined && <CodeEditor value={text} onChange={() => undefined} language={language} readOnly height="calc(100vh - 160px)" theme={theme} ariaLabel={path} />}
		</section>
	)
}
