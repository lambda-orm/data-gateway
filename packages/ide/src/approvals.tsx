import React, { useCallback, useEffect, useState } from 'react'
import { ManagementClient } from './management'
import { usePrefs } from './shared'

/** A write that waits for a person, as the gateway lists it (docs/MUTATION_APPROVAL.md §4) */
interface ListedApproval {
	id: string
	schema: string
	operation: 'execute' | 'executeScript'
	text: string
	name?: string
	data?: unknown
	plan?: unknown
	requester: { name: string, transport: string }
	createdAt: string
	expiresAt: string
}

/** a schema in the URL of the administration: its route in one segment, the root as ~ */
const segment = (schema: string) => encodeURIComponent(schema || '~')

/** The sentences of a plan, as text */
const sentencesOf = (plan: unknown): string[] => {
	const out: string[] = []
	const walk = (node: any) => {
		if (!node || typeof node !== 'object') return
		if (typeof node.sentence === 'string') out.push(node.sentence)
		for (const child of node.children ?? []) walk(child)
	}
	walk(plan)
	return out
}

/**
 * The writes that wait in the schemas of a connection, in its page (with approve): what each would run, its data and who
 * asked; approve (it runs as who asked) or reject with a reason. Read again every 15 s while shown.
 */
export const ApprovalsPanel: React.FC<{ client: ManagementClient, self: string }> = ({ client, self }) => {
	const { t, culture } = usePrefs()
	const [list, setList] = useState<ListedApproval[]>([])
	const [error, setError] = useState<string>()
	const [rejecting, setRejecting] = useState<{ id: string, schema: string, reason: string }>()
	const [busy, setBusy] = useState<string>()
	const when = (iso: string) => new Date(iso).toLocaleString(culture, { dateStyle: 'short', timeStyle: 'short' })
	const load = useCallback(async () => {
		try {
			// the schemas of the gateway that are ready (one in error can't answer)
			const states = await client.fetch(`${client.base}/schemas`).then(r => r.ok ? r.json() : []) as { path: string, status: string }[]
			const schemas = states.filter(s => s.status === 'ready').map(s => s.path)
			const all = await Promise.all(schemas.map(async schema => {
				const response = await client.fetch(`${client.base}/admin/workspaces/${segment(schema)}/approvals?status=pending`)
				if (!response.ok) throw new Error((await response.json().catch(() => undefined))?.message ?? `HTTP ${response.status}`)
				return response.json() as Promise<ListedApproval[]>
			}))
			setList(all.flat().sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
			setError(undefined)
		} catch (e: any) { setError(e?.message ?? String(e)) }
	}, [client])
	useEffect(() => {
		load()
		const timer = setInterval(load, 15000)
		return () => clearInterval(timer)
	}, [load])
	const decide = async (a: { id: string, schema: string }, decision: 'approve' | 'reject', reason?: string) => {
		setBusy(a.id)
		try {
			const response = await client.fetch(`${client.base}/admin/workspaces/${segment(a.schema)}/approvals/${encodeURIComponent(a.id)}/${decision}`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reason ? { reason } : {})
			})
			if (!response.ok) setError((await response.json().catch(() => undefined))?.message ?? `HTTP ${response.status}`)
			else setError(undefined)
		} finally {
			setBusy(undefined)
			setRejecting(undefined)
			await load()
		}
	}
	return (
		<section className="dg-card dg-approvals">
			<h3>{t.approvals}{list.length > 0 && <span className="dg-chip">{list.length}</span>}</h3>
			<p className="dg-muted">{t.approvalsNote}</p>
			{error && <div className="dg-error" role="alert">{error}</div>}
			{list.length === 0 && !error && <p className="dg-muted">{t.noApprovals}</p>}
			{list.map(a => (
				<article key={a.id} className="dg-approval" aria-label={a.id}>
					<header>
						<strong>{a.schema || '/'}</strong> · {a.name ? <code>{a.name}</code> : a.operation === 'executeScript' ? 'script' : 'execute'}
						<span className="dg-muted"> · {t.askedBy} <strong>{a.requester.name}</strong> ({a.requester.transport}) · {when(a.createdAt)} · {t.approvalExpires} {when(a.expiresAt)}</span>
					</header>
					<pre className="dg-code">{a.text}</pre>
					{a.operation === 'executeScript'
						? <p className="dg-warning">{t.approvalScript}</p>
						: sentencesOf(a.plan).length > 0 && (
							<details open>
								<summary>{t.approvalPlan}</summary>
								<pre className="dg-code">{sentencesOf(a.plan).join(';\n')}</pre>
							</details>
							)}
					{a.data !== undefined && (
						<details>
							<summary>{t.approvalData}</summary>
							<pre className="dg-code">{JSON.stringify(a.data, null, 2)}</pre>
						</details>
					)}
					<span className="dg-form-actions">
						{rejecting?.id === a.id
							? (
								<>
									<input aria-label={t.rejectReason} placeholder={t.rejectReason} value={rejecting.reason} onChange={e => setRejecting({ ...rejecting, reason: e.target.value })} />
									<button type="button" onClick={() => setRejecting(undefined)}>{t.cancel}</button>
									<button type="button" className="dg-danger" disabled={busy === a.id} onClick={() => decide(a, 'reject', rejecting.reason.trim() || undefined)}>{t.rejectWrite}</button>
								</>
								)
							: (
								<>
									<button type="button" className="dg-danger" disabled={busy === a.id} onClick={() => setRejecting({ id: a.id, schema: a.schema, reason: '' })}>{t.rejectWrite}</button>
									<button type="button" className="dg-primary" disabled={busy === a.id || a.requester.name === self} title={a.requester.name === self ? t.approvalsNote : undefined} onClick={() => decide(a, 'approve')}>{t.approveWrite}</button>
								</>
								)}
					</span>
				</article>
			))}
		</section>
	)
}
