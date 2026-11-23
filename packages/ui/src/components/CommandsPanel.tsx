import React, { useCallback, useEffect, useState } from 'react'
import { AdminApiPort, CommandName, CommandPreview, CommandsSummary, Job } from '../application/ports'
import { adminMessagesOf, format } from '../domain/adminI18n'
import { toYaml } from '../domain/results'
import { Icons, Modal } from './dialogs'

export interface CommandsPanelProps {
	admin: AdminApiPort
	schema: string
	/** the credential may save in the workspace (an export to data/) */
	canSave?: boolean
	locale?: string
	/** how often the jobs running are asked for (ms) */
	pollMs?: number
	/** the credential may generate the code of the domain (build) */
	canBuild?: boolean
	/** the heading (the tab of a schema: its name); Commands by default */
	title?: string
	/** shown under the toolbar, before what the commands answer (what the schema is) */
	children?: React.ReactNode
}

const PREVIEWED: CommandName[] = ['push', 'drop', 'import', 'pull', 'introspect', 'incorporate']

/** The sentences of a preview as lines: push gives them by source, drop as a list */
const sentencesOf = (preview: CommandPreview): { source?: string, sentences: string[] }[] => {
	const list = preview.sentences ?? []
	if (list.every(s => s && typeof s === 'object' && 'source' in (s as any))) return list as { source: string, sentences: string[] }[]
	return [{ sentences: list.map(s => typeof s === 'string' ? s : (s as any)?.sentence ?? JSON.stringify(s)) }]
}

const download = (name: string, value: unknown) => {
	const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
	const link = document.createElement('a')
	link.href = url
	link.download = name
	document.body.appendChild(link)
	link.click()
	link.remove()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * The commands of the CLI on a workspace (docs/DATA_GATEWAY_ADMIN_PLAN.md §3.4, §4): fetch and export run at once as a
 * job; push, drop and import first show what they will do (the sentences by source, the rows of each entity) and run
 * exactly that. The last jobs, with their result.
 */
export const CommandsPanel: React.FC<CommandsPanelProps> = ({ admin, schema, canSave = false, locale, pollMs = 1000, canBuild = false, title, children }) => {
	const [language, setLanguage] = useState<'node' | 'client-node'>('node')
	// the form of a command that needs a file (import, introspect, incorporate) or a choice (build)
	const [form, setForm] = useState<'import' | 'introspect' | 'incorporate' | 'build'>()
	const [built, setBuilt] = useState<{ path: string, written?: string }[]>()
	const m = adminMessagesOf(locale)
	const [summary, setSummary] = useState<CommandsSummary>()
	const [stage, setStage] = useState('')
	const [jobs, setJobs] = useState<Job[]>([])
	const [open, setOpen] = useState<Job>()
	const [preview, setPreview] = useState<CommandPreview>()
	const [force, setForce] = useState(false)
	const [typed, setTyped] = useState('')
	const [data, setData] = useState<unknown>()
	// introspect, incorporate: the data to read the entities from, and their entity
	const [source, setSource] = useState<unknown>()
	const [entity, setEntity] = useState('')
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)

	const refresh = useCallback(async () => {
		try {
			const list = await admin.jobs(schema)
			setJobs(list)
			if (open && open.status === 'running') {
				const now = list.find(j => j.id === open.id)
				if (now && now.status !== 'running') setOpen(await admin.job(schema, now.id))
			}
		} catch { /* the next time */ }
	}, [admin, schema, open])

	useEffect(() => {
		admin.commands(schema).then(s => { setSummary(s); setStage(s.stages[0] ?? '') }, e => setError(e?.message ?? String(e)))
		refresh()
	}, [admin, schema])

	// while a job runs, its end is asked for
	const anyRunning = jobs.some(j => j.status === 'running')
	useEffect(() => {
		if (!anyRunning || pollMs <= 0) return
		const timer = setInterval(refresh, pollMs)
		return () => clearInterval(timer)
	}, [anyRunning, pollMs, refresh])

	const attempt = async (action: () => Promise<void>) => {
		setBusy(true)
		setError(undefined)
		try { await action() } catch (e: any) { setError(e?.message ?? String(e)) } finally { setBusy(false) }
	}

	const start = (command: CommandName, body: Record<string, unknown> = {}) => attempt(async () => {
		const answer = await admin.runCommand(schema, command, { stage: stage || undefined, ...body }) as Job
		setPreview(undefined)
		setTyped('')
		if ((answer as any).id) {
			setOpen(answer)
			await refresh()
		} else {
			setOpen({ id: 'version', schema, command, status: 'done', credential: '', startedAt: new Date().toISOString(), result: answer })
		}
	})

	const ask = (command: CommandName) => attempt(async () => {
		const body = command === 'import' ? { data } : command === 'introspect' || command === 'incorporate' ? { data: source, name: entity.trim() } : {}
		setPreview(await admin.previewCommand(schema, command, { stage: stage || undefined, ...body }))
		setForce(false)
		setTyped('')
	})

	const readFile = (set: (value: unknown) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		e.target.value = ''
		if (!file) return
		file.text().then(text => { set(JSON.parse(text)); setError(undefined) }).catch(err => setError(String(err?.message ?? err)))
	}
	const chooseFile = readFile(setData)

	const can = (command: CommandName) => !!summary?.can[command] && !busy && !anyRunning
	const confirmable = preview && (preview.command !== 'drop' || typed === preview.stage)

	// a command of the toolbar: its icon, its name to be read, its description on hover
	const tool = (command: string, label: string, icon: React.ReactNode, enabled: boolean, onClick: () => void) => (
		<button type="button" className="lw-tool" aria-label={label} title={`${label} — ${(m as any)[`cmd_${command}`] ?? ''}`} disabled={!enabled} onClick={onClick}>{icon}</button>
	)
	const downloadZip = () => attempt(async () => {
		const blob = await admin.buildZip(schema, language)
		const url = URL.createObjectURL(blob)
		const link = document.createElement('a')
		link.href = url
		link.download = `${schema.replace(/\//g, '_') || 'root'}-${language}.zip`
		document.body.appendChild(link)
		link.click()
		link.remove()
		setTimeout(() => URL.revokeObjectURL(url), 1000)
		setForm(undefined)
	})

	return (
		<section className="lw-commands" aria-label={`${m.commands} — ${schema || '/'}`}>
			<div className="lw-toolbar lw-command-toolbar" role="toolbar" aria-label={m.commands}>
				<strong>{title ?? m.commands}</strong>
				<label className="lw-type">{m.stage}{' '}
					<select aria-label="stage" value={stage} onChange={e => { setStage(e.target.value); setPreview(undefined) }}>
						{(summary?.stages ?? []).map(s => <option key={s} value={s}>{s}</option>)}
					</select>
				</label>
				<span className="lw-tool-group">
					{tool('fetch', 'fetch', <Icons.compare size={18} />, can('fetch'), () => start('fetch'))}
					{tool('export', 'export', <Icons.exportData size={18} />, can('export'), () => start('export'))}
					{canSave && tool('exportSave', 'export → data/', <Icons.saveData size={18} />, can('export'), () => start('export', { save: true }))}
					{tool('import', 'import…', <Icons.importData size={18} />, can('import'), () => setForm('import'))}
				</span>
				<span className="lw-tool-group">
					{tool('push', 'push…', <Icons.push size={18} />, can('push'), () => ask('push'))}
					{tool('pull', 'pull…', <Icons.pull size={18} />, can('pull'), () => ask('pull'))}
					{tool('drop', 'drop…', <Icons.drop size={18} />, can('drop'), () => ask('drop'))}
				</span>
				<span className="lw-tool-group">
					{tool('introspect', 'introspect…', <Icons.introspect size={18} />, can('introspect'), () => setForm('introspect'))}
					{tool('incorporate', 'incorporate…', <Icons.incorporate size={18} />, can('incorporate'), () => setForm('incorporate'))}
				</span>
				<span className="lw-tool-group">
					{canBuild && tool('build', 'build…', <Icons.code size={18} />, !busy, () => setForm('build'))}
					{tool('version', 'version', <Icons.info size={18} />, !!summary?.can.version && !busy, () => start('version'))}
				</span>
			</div>
			{children}
			{form && (
				<Modal title={form === 'build' ? m.build : `${form}…`} onClose={() => setForm(undefined)}>
					<div className="lw-form">
						{form === 'import' && (
							<label>{m.chooseExport}<input type="file" accept="application/json,.json" aria-label={m.chooseExport} onChange={chooseFile} /></label>
						)}
						{(form === 'introspect' || form === 'incorporate') && (
							<>
								<label>{m.dataFile}<input type="file" accept="application/json,.json" aria-label={m.dataFile} onChange={readFile(setSource)} /></label>
								<label>{m.entityOfData}<input aria-label={m.entityOfData} value={entity} onChange={e => setEntity(e.target.value)} /></label>
								{form === 'incorporate' && <small className="lw-type">{m.incorporateNote}</small>}
							</>
						)}
						{form === 'build' && (
							<label>language
								<select aria-label="language" value={language} onChange={e => setLanguage(e.target.value as 'node' | 'client-node')}>
									<option value="node">node (@lambdaorm/lib)</option>
									<option value="client-node">client-node (@lambdaorm/client)</option>
								</select>
							</label>
						)}
						<div className="lw-form-actions">
							<button type="button" onClick={() => setForm(undefined)}>{m.cancel}</button>
							{form === 'build'
								? (
									<>
										<button type="button" disabled={busy} onClick={downloadZip}>{m.buildZip}</button>
										<button type="button" className="lw-primary" disabled={busy} onClick={() => attempt(async () => { setBuilt((await admin.build(schema, language)).files); setForm(undefined) })}>{m.buildWrite}</button>
									</>
									)
								: (
									<button type="button" className="lw-primary"
										disabled={busy || (form === 'import' ? data === undefined : source === undefined || !entity.trim())}
										onClick={() => { const command = form; setForm(undefined); ask(command) }}>{m.preview}</button>
									)}
						</div>
					</div>
				</Modal>
			)}
			{built && (
				<div className="lw-job" role="region" aria-label={m.build}>
					<p className="lw-type">{format(m.written, { n: built.filter(f => f.written === 'created' || f.written === 'updated').length })}</p>
					<ul>{built.map(f => <li key={f.path}><code>{f.path}</code> <span className="lw-type">{f.written}</span></li>)}</ul>
				</div>
			)}
			{error && <div className="lw-notice" role="alert">{error}</div>}
			{preview && (
				<div className="lw-preview" role="region" aria-label={format(m.willRun, { name: preview.command, stage: preview.stage })}>
					<p><strong>{format(preview.diff ? m.schemaChanges : m.willRun, { name: preview.command, stage: preview.stage })}</strong></p>
					{preview.diff && (
						<>
							<p className="lw-type">{format(m.linesChanged, { added: preview.diff.added, removed: preview.diff.removed })}</p>
							{preview.diff.hunks.map((hunk, i) => (
								<pre key={i} className="lw-sentences lw-diff" aria-label={`@@ ${hunk.oldStart} ${hunk.newStart} @@`}>
									{hunk.lines.map((line, n) => <span key={n} className={line.op === '+' ? 'lw-diff-add' : line.op === '-' ? 'lw-diff-remove' : undefined}>{`${line.op}${line.text}`}</span>)}
								</pre>
							))}
						</>
					)}
					{preview.command === 'incorporate' && <p className="lw-type">{m.incorporateNote}</p>}
					{preview.diff && !preview.rows ? null : preview.rows
						? (
							<table className="lw-table"><caption>{m.rowsToWrite}</caption><tbody>
								{Object.entries(preview.rows).map(([entity, n]) => <tr key={entity}><td>{entity}</td><td>{n}</td></tr>)}
							</tbody></table>
							)
						: sentencesOf(preview).every(g => g.sentences.length === 0)
							? <p>{m.nothingToRun}</p>
							: sentencesOf(preview).map((group, i) => (
								<div key={i}>
									{group.source && <div className="lw-type">{group.source}</div>}
									<pre className="lw-sentences">{group.sentences.join(';\n\n')}{group.sentences.length ? ';' : ''}</pre>
								</div>
							))}
					{['push', 'drop'].includes(preview.command) && <label className="lw-type"><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} /> {m.force}</label>}
					{preview.command === 'drop' && <label>{format(m.typeStage, { name: preview.stage })} <input aria-label="confirm stage" value={typed} onChange={e => setTyped(e.target.value)} /></label>}
					<div className="lw-actions">
						<button type="button" onClick={() => setPreview(undefined)}>{m.cancel}</button>
						<button type="button" className="lw-danger" disabled={!confirmable || busy}
							onClick={() => start(preview.command, { previewId: preview.previewId, force, stage: preview.stage })}>{format(m.runNamed, { name: preview.command })}</button>
					</div>
				</div>
			)}
			{open && (
				<div className="lw-job" role="region" aria-label={`${open.command} ${open.id}`}>
					<p>
						<strong>{open.command}{open.stage ? ` ${open.stage}` : ''}</strong>{' '}
						<span className={open.status === 'failed' ? 'lw-error-text' : 'lw-type'}>{m[open.status]}</span>
						{open.file && <span className="lw-type"> — {format(m.savedIn, { name: open.file })}</span>}
						{open.status === 'done' && open.command === 'export' && open.result !== undefined && (
							<> <button type="button" onClick={() => download(`${schema.replace(/\//g, '_') || 'root'}-${open.stage ?? 'default'}.json`, open.result)}>{m.download}</button></>
						)}
					</p>
					{open.error && <div className="lw-notice" role="alert">{open.error.name}: {open.error.message}</div>}
					{open.status === 'done' && open.command === 'fetch' && Array.isArray(open.result) && open.result.every((x: any) => !x?.entities?.length) && <p>{m.inStep}</p>}
					{open.status === 'done' && open.result !== undefined && <pre className="lw-sentences">{toYaml(open.result).slice(0, 20000)}</pre>}
				</div>
			)}
			<h4>{m.jobs}</h4>
			{jobs.length === 0
				? <p className="lw-type">{m.noJobs}</p>
				: (
					<table className="lw-table lw-jobs">
						<tbody>
							{jobs.map(job => (
								<tr key={job.id} onClick={() => admin.job(schema, job.id).then(setOpen, () => undefined)} className={open?.id === job.id ? 'lw-active' : undefined}>
									<td>{job.command}</td>
									<td>{job.stage ?? ''}</td>
									<td className={job.status === 'failed' ? 'lw-error-text' : undefined}>{m[job.status]}</td>
									<td>{job.credential}</td>
									<td>{new Date(job.startedAt).toLocaleString()}</td>
								</tr>
							))}
						</tbody>
					</table>
					)}
		</section>
	)
}

export { PREVIEWED }
