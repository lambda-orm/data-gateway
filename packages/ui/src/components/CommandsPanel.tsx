import React, { useCallback, useEffect, useState } from 'react'
import { AdminApiPort, CommandName, CommandPreview, CommandsSummary, Job } from '../application/ports'
import { adminMessagesOf, format } from '../domain/adminI18n'
import { toYaml } from '../domain/results'

export interface CommandsPanelProps {
	admin: AdminApiPort
	schema: string
	/** the credential may save in the workspace (an export to data/) */
	canSave?: boolean
	locale?: string
	/** how often the jobs running are asked for (ms) */
	pollMs?: number
}

const PREVIEWED: CommandName[] = ['push', 'drop', 'import']

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
export const CommandsPanel: React.FC<CommandsPanelProps> = ({ admin, schema, canSave = false, locale, pollMs = 1000 }) => {
	const m = adminMessagesOf(locale)
	const [summary, setSummary] = useState<CommandsSummary>()
	const [stage, setStage] = useState('')
	const [jobs, setJobs] = useState<Job[]>([])
	const [open, setOpen] = useState<Job>()
	const [preview, setPreview] = useState<CommandPreview>()
	const [force, setForce] = useState(false)
	const [typed, setTyped] = useState('')
	const [save, setSave] = useState(false)
	const [data, setData] = useState<unknown>()
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
		setPreview(await admin.previewCommand(schema, command, { stage: stage || undefined, data: command === 'import' ? data : undefined }))
		setForce(false)
		setTyped('')
	})

	const chooseFile = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		e.target.value = ''
		if (!file) return
		file.text().then(text => { setData(JSON.parse(text)); setError(undefined) }, err => setError(String(err))).catch(err => setError(String(err?.message ?? err)))
	}

	const can = (command: CommandName) => !!summary?.can[command] && !busy && !anyRunning
	const confirmable = preview && (preview.command !== 'drop' || typed === preview.stage)

	return (
		<section className="lw-commands" aria-label={`${m.commands} — ${schema || '/'}`}>
			<div className="lw-toolbar">
				<strong>{m.commands}</strong>
				<label>{m.stage}{' '}
					<select aria-label="stage" value={stage} onChange={e => { setStage(e.target.value); setPreview(undefined) }}>
						{(summary?.stages ?? []).map(s => <option key={s} value={s}>{s}</option>)}
					</select>
				</label>
			</div>
			<div className="lw-command-list">
				<button type="button" disabled={!can('fetch')} onClick={() => start('fetch')}>fetch</button>
				<span className="lw-command-group">
					<button type="button" disabled={!can('export')} onClick={() => start('export', { save })}>export</button>
					{canSave && <label className="lw-type"><input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} /> {m.saveToData}</label>}
				</span>
				<button type="button" disabled={!can('push')} onClick={() => ask('push')}>push…</button>
				<button type="button" disabled={!can('drop')} onClick={() => ask('drop')}>drop…</button>
				<span className="lw-command-group">
					<label className="lw-type">{m.chooseExport} <input type="file" accept="application/json,.json" aria-label={m.chooseExport} onChange={chooseFile} disabled={!summary?.can.import} /></label>
					<button type="button" disabled={!can('import') || data === undefined} onClick={() => ask('import')}>import…</button>
				</span>
				<button type="button" disabled={!summary?.can.version || busy} onClick={() => start('version')}>version</button>
			</div>
			{error && <div className="lw-notice" role="alert">{error}</div>}
			{preview && (
				<div className="lw-preview" role="region" aria-label={format(m.willRun, { name: preview.command, stage: preview.stage })}>
					<p><strong>{format(m.willRun, { name: preview.command, stage: preview.stage })}</strong></p>
					{preview.rows
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
					{preview.command !== 'import' && <label className="lw-type"><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} /> {m.force}</label>}
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
