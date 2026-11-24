import React, { useState } from 'react'
import { AdminApiPort } from '../application/ports'
import { adminMessagesOf } from '../domain/adminI18n'
import { Modal } from './dialogs'

export type CodeLanguage = 'node' | 'client-node'
export type BuiltFile = { path: string, written?: string, bytes: number }

/** A file the browser downloads */
export const downloadBlob = (blob: Blob, name: string): void => {
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = name
	document.body.appendChild(link)
	link.click()
	link.remove()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * The code of the domain of a schema (build): a language, then a .zip to download or the code written in its folder of
 * src/ of the workspace (src/node/…, src/client-node/…). From the commands of the schema and from its source code.
 */
export const BuildDialog: React.FC<{
	admin: AdminApiPort
	schema: string
	locale?: string
	theme?: 'light' | 'dark'
	onClose: () => void
	/** the code written: its files, each created, updated or kept */
	onBuilt?: (files: BuiltFile[], language: CodeLanguage) => void
	/** the language chosen at first (a code built again) */
	language?: CodeLanguage
}> = ({ admin, schema, locale, theme, onClose, onBuilt, language: initial }) => {
	const m = adminMessagesOf(locale)
	const [language, setLanguage] = useState<CodeLanguage>(initial ?? 'node')
	// what it generates (as -m and -r of the CLI): at least one of them
	const [model, setModel] = useState(true)
	const [repositories, setRepositories] = useState(true)
	const parts = { model, repositories }
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string>()
	const attempt = async (action: () => Promise<void>) => {
		setBusy(true)
		setError(undefined)
		try { await action() } catch (e: any) { setError(e?.message ?? String(e)) } finally { setBusy(false) }
	}
	return (
		<Modal title={m.build} onClose={onClose} theme={theme}>
			<div className="lw-form">
				<label>language
					<select aria-label="language" value={language} onChange={e => setLanguage(e.target.value as CodeLanguage)}>
						<option value="node">node (@lambdaorm/lib)</option>
						<option value="client-node">client-node (@lambdaorm/client)</option>
					</select>
				</label>
				<fieldset className="lw-form-group lw-build-parts">
					<legend>{m.buildParts}</legend>
					<label className="lw-build-part"><input type="checkbox" checked={model} disabled={model && !repositories} onChange={e => setModel(e.target.checked)} /> model <span className="lw-type">-m · {m.buildModel}</span></label>
					<label className="lw-build-part"><input type="checkbox" checked={repositories} disabled={repositories && !model} onChange={e => setRepositories(e.target.checked)} /> repositories <span className="lw-type">-r · {m.buildRepositories}</span></label>
				</fieldset>
				{error && <div className="lw-notice" role="alert">{error}</div>}
				<div className="lw-form-actions">
					<button type="button" onClick={onClose}>{m.cancel}</button>
					<button type="button" disabled={busy} onClick={() => attempt(async () => downloadBlob(await admin.buildZip(schema, language, parts), `${schema.replace(/\//g, '_') || 'root'}-${language}.zip`))}>{m.buildZip}</button>
					<button type="button" className="lw-primary" disabled={busy} onClick={() => attempt(async () => { onBuilt?.((await admin.build(schema, language, parts)).files, language); onClose() })}>{m.buildWrite}</button>
				</div>
			</div>
		</Modal>
	)
}
