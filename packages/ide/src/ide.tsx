import React, { useEffect, useMemo, useState } from 'react'
import { BrowserSessionStore, Workspace } from '@lambdaorm/ui'
import { Cable, Menu as MenuIcon, Pencil, Plus, Settings, Trash2 } from 'lucide-react'
import { ConnectionPage, ConnectionTools, Credential, CredentialFields, getJson, Header, HeaderMenu, headersOf, Kind, OUT, PreferencesPage, usePrefs, Who, whoIs, wikiUrl } from './shared'
import { endpointsOf, McpTab, SwaggerTab, useTransports, WebSocketTab } from './tools'
import { forbiddenTarget, unreachable, viaProxy } from './proxy'

/**
 * The IDE (its own image): no home, no login. It connects to data-gateways, each with the URL of its management and its
 * credential; their schemas, workspaces and projects stay in them, as a database IDE connects to databases. What it
 * keeps of each connection is in this browser: where it is and how it authenticates (the key only if asked to be
 * remembered; else in this tab, asked again after closing it). Every request goes through the backend of the IDE, which
 * reaches the gateway at that URL (docs/DATA_GATEWAY.md §11.9).
 */
export interface IdeConnection {
	id: string
	name: string
	protocol: 'http' | 'https'
	/** host, port and base path of its management, as the backend of the IDE reaches it: data-gateway:9292 */
	address: string
	kind: Kind
	header: string
	user: string
	/** kept only when remember */
	secret?: string
	remember: boolean
	/** the URLs of its REST, WebSocket and MCP when the backend of the IDE doesn't reach them at the ports the gateway
	 * tells, on its host (a proxy in front, another network) */
	restUrl?: string
	webSocketUrl?: string
	mcpUrl?: string
}

const CONNECTIONS = 'data-gateway-ide.connections'
const SECRETS = 'data-gateway-ide.secrets'
const read = <T, >(storage: () => Storage, key: string, empty: T): T => { try { const text = storage().getItem(key); return text ? JSON.parse(text) : empty } catch { return empty } }
const write = (storage: () => Storage, key: string, value: unknown) => { try { storage().setItem(key, JSON.stringify(value)) } catch { /* private window */ } }
const local = () => window.localStorage
const tab = () => window.sessionStorage

export const urlOf = (c: Pick<IdeConnection, 'protocol' | 'address'>) => `${c.protocol}://${c.address.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '')}`
const credentialOf = (c: IdeConnection, secrets: Record<string, string>): Credential => ({ kind: c.kind, header: c.header, user: c.user, secret: c.secret ?? secrets[c.id] ?? '' })
const hasSecret = (c: IdeConnection, secrets: Record<string, string>) => c.kind === 'none' || !!(c.secret ?? secrets[c.id])
/** Its management, through the backend of the IDE */
const apiOf = (c: Pick<IdeConnection, 'protocol' | 'address'>) => viaProxy(urlOf(c))
const fixedOf = (c: IdeConnection) => ({ rest: c.restUrl, webSocket: c.webSocketUrl, mcp: c.mcpUrl })
/** What failed, said to the person: a target the IDE may not reach, a credential refused, a gateway not reached */
const problemOf = (e: any, t: { invalid: string, unreachable: string }): string =>
	forbiddenTarget(e) ? e.message : e?.status === 401 || e?.status === 403 ? t.invalid : unreachable(e) ? t.unreachable : (e?.message ?? String(e))

/** The form of a connection: where it is, how it authenticates; test it, save it, remove it; then who it is */
const ConnectionEditor: React.FC<{
	initial?: IdeConnection
	secret: string
	who?: Who
	problem?: string
	onSave: (connection: IdeConnection, secret: string) => void
	onRemove?: () => void
	onOpenTool?: (tool: 'swagger' | 'websocket' | 'mcp') => void
}> = ({ initial, secret: givenSecret, who, problem, onSave, onRemove, onOpenTool }) => {
	const { t } = usePrefs()
	const [draft, setDraft] = useState<IdeConnection>(initial ?? { id: '', name: '', protocol: 'http', address: '', kind: 'apikey', header: 'X-Api-Key', user: '', remember: false })
	const [secret, setSecret] = useState(givenSecret)
	const [tested, setTested] = useState<{ ok: boolean, text: string }>()
	const [busy, setBusy] = useState(false)
	const [removing, setRemoving] = useState(false)
	const credential: Credential = { kind: draft.kind, header: draft.header, user: draft.user, secret }
	const set = (patch: Partial<IdeConnection>) => { setDraft({ ...draft, ...patch }); setTested(undefined) }
	const test = async () => {
		setBusy(true)
		try {
			const version = await getJson(apiOf(draft), '/version').catch(() => undefined)
			const found = await whoIs(apiOf(draft), credential, t.noReady)
			setTested({ ok: true, text: `${t.connectedAs.replace('{name}', found.name)}${version?.version ? ` · data-gateway ${version.version}` : ''}` })
		} catch (e: any) {
			setTested({ ok: false, text: problemOf(e, t) })
		} finally { setBusy(false) }
	}
	const valid = draft.name.trim() && draft.address.trim()
	const form = (
		<section className="dg-card">
			<form className="dg-form dg-connection-form" onSubmit={e => { e.preventDefault(); if (valid) onSave({ ...draft, name: draft.name.trim() }, secret) }}>
				<label>{t.connectionName}<input aria-label={t.connectionName} value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="local" autoFocus={!initial} /></label>
				<span className="dg-url">
					<label>{t.protocol}
						<select aria-label={t.protocol} value={draft.protocol} onChange={e => set({ protocol: e.target.value as 'http' | 'https' })}>
							<option value="http">REST · http</option>
							<option value="https">REST · https</option>
						</select>
					</label>
					<label>{t.address}<input aria-label={t.address} value={draft.address} onChange={e => set({ address: e.target.value })} placeholder="host:port/base-path" spellCheck={false} /></label>
				</span>
				<CredentialFields credential={credential} onChange={patch => { if (patch.secret !== undefined) { setSecret(patch.secret); setTested(undefined) } else set(patch as Partial<IdeConnection>) }} />
				{draft.kind !== 'none' && <label className="dg-check"><input type="checkbox" checked={draft.remember} onChange={e => set({ remember: e.target.checked })} /> {t.rememberKey}</label>}
				<details className="dg-advanced">
					<summary>{t.publicUrls}</summary>
					<span className="dg-muted">{t.publicUrlsNote}</span>
					<label>{t.restUrl}<input aria-label={t.restUrl} value={draft.restUrl ?? ''} onChange={e => set({ restUrl: e.target.value || undefined })} placeholder="http://host:port" spellCheck={false} /></label>
					<label>{t.webSocketUrl}<input aria-label={t.webSocketUrl} value={draft.webSocketUrl ?? ''} onChange={e => set({ webSocketUrl: e.target.value || undefined })} placeholder="ws://host:port" spellCheck={false} /></label>
					<label>{t.mcpUrl}<input aria-label={t.mcpUrl} value={draft.mcpUrl ?? ''} onChange={e => set({ mcpUrl: e.target.value || undefined })} placeholder="http://host:port" spellCheck={false} /></label>
				</details>
				<span className="dg-muted">{t.connectionNote}</span>
				{tested && <div className={tested.ok ? 'dg-ok' : 'dg-error'} role="status">{tested.text}</div>}
				{!tested && problem && <div className="dg-error" role="alert">{problem}</div>}
				<span className="dg-form-actions">
					{onRemove && (removing
						? <><span className="dg-muted">{t.confirmRemove}</span><button type="button" onClick={() => setRemoving(false)}>{t.cancel}</button><button type="button" className="dg-danger" onClick={onRemove}>{t.removeConnection}</button></>
						: <button type="button" className="dg-danger" onClick={() => setRemoving(true)}>{t.removeConnection}</button>)}
					<span className="dg-spacer" />
					<button type="button" onClick={test} disabled={busy || !valid}>{busy ? t.checking : t.test}</button>
					<button type="submit" className="dg-primary" disabled={!valid}>{initial ? t.saveConnection : t.addConnection}</button>
				</span>
			</form>
		</section>
	)
	return initial
		? <ConnectionPage name={initial.name} url={urlOf(initial)} credential={credentialOf(initial, { [initial.id]: givenSecret })} who={who}
			tools={onOpenTool && <ToolsOf connection={initial} onOpen={onOpenTool} />}>{form}</ConnectionPage>
		: <div className="dg-pane"><h2>{t.newConnection}</h2>{form}</div>
}

/** The tools a connection may open: what its gateway exposes (GET /transports of its management), or the URLs it fixes */
const ToolsOf: React.FC<{ connection: IdeConnection, onOpen: (tool: 'swagger' | 'websocket' | 'mcp') => void }> = ({ connection, onOpen }) => {
	const transports = useTransports(urlOf(connection))
	const endpoints = endpointsOf(urlOf(connection), transports, fixedOf(connection))
	return <ConnectionTools available={{ swagger: !!endpoints.openapi, webSocket: !!endpoints.webSocket, mcp: !!endpoints.mcp }} onOpen={onOpen} />
}

/** A tool of a connection in its tab: where its transports are (they are read once the tab opens) */
const ToolTab: React.FC<{ connection: IdeConnection, tool: 'swagger' | 'websocket' | 'mcp', headers: () => Record<string, string>, theme: 'light' | 'dark' }> = ({ connection, tool, headers, theme }) => {
	const transports = useTransports(urlOf(connection))
	const endpoints = endpointsOf(urlOf(connection), transports, fixedOf(connection))
	return tool === 'swagger' ? <SwaggerTab endpoints={endpoints} headers={headers} /> : tool === 'websocket' ? <WebSocketTab endpoints={endpoints} headers={headers} theme={theme} /> : <McpTab endpoints={endpoints} headers={headers} theme={theme} />
}

export const IdeApp: React.FC<{ dark: boolean }> = ({ dark }) => {
	const { t, locale, culture } = usePrefs()
	const [connections, setConnections] = useState<IdeConnection[]>(() => read(local, CONNECTIONS, []))
	const [secrets, setSecrets] = useState<Record<string, string>>(() => read(tab, SECRETS, {}))
	const [whos, setWhos] = useState<Record<string, Who | undefined>>({})
	const [problems, setProblems] = useState<Record<string, string | undefined>>({})
	const [openPage, setOpenPage] = useState<{ key: string, at: number }>(() => ({ key: read<IdeConnection[]>(local, CONNECTIONS, []).length ? '' : 'connection:new', at: Date.now() }))
	const openOf = (key: string) => setOpenPage({ key, at: Date.now() })
	// the connection about to be removed (its confirmation)
	const [removing, setRemoving] = useState<IdeConnection>()
	useEffect(() => { write(local, CONNECTIONS, connections) }, [connections])
	useEffect(() => { write(tab, SECRETS, secrets) }, [secrets])
	// who each credential is on its gateway (its roles); what fails, said in its explorer and its page
	const signature = connections.map(c => `${c.id}|${urlOf(c)}|${c.kind}|${c.header}|${c.user}|${hasSecret(c, secrets) ? credentialOf(c, secrets).secret.length : 0}`).join('\n')
	useEffect(() => {
		for (const c of connections) {
			if (!hasSecret(c, secrets)) {
				setWhos(w => ({ ...w, [c.id]: undefined }))
				setProblems(p => ({ ...p, [c.id]: t.needsKey }))
				continue
			}
			whoIs(apiOf(c), credentialOf(c, secrets), t.noReady).then(
				who => { setWhos(w => ({ ...w, [c.id]: who })); setProblems(p => ({ ...p, [c.id]: undefined })) },
				(e: any) => {
					setWhos(w => ({ ...w, [c.id]: undefined }))
					setProblems(p => ({ ...p, [c.id]: problemOf(e, t) }))
				})
		}
	}, [signature, t])
	const save = (existing: IdeConnection | undefined) => (connection: IdeConnection, secret: string) => {
		const id = existing?.id ?? `c${Date.now().toString(36)}`
		const kept: IdeConnection = { ...connection, id, secret: connection.remember && secret ? secret : undefined }
		setConnections(all => existing ? all.map(c => c.id === id ? kept : c) : [...all, kept])
		setSecrets(s => ({ ...s, [id]: secret }))
		if (!existing) openOf(`connection:${id}`)
	}
	const remove = (id: string) => {
		setConnections(all => all.filter(c => c.id !== id))
		setSecrets(s => { const n = { ...s }; delete n[id]; return n })
	}
	const specs = useMemo(() => connections.map(c => {
		const credential = credentialOf(c, secrets)
		return {
			id: c.id,
			name: c.name,
			description: urlOf(c),
			baseUrl: apiOf(c),
			headers: () => headersOf(credential),
			// what is saved without the gateway's workspaces: per gateway and per user of the credential
			workspaceKey: `${urlOf(c)}|${whos[c.id]?.name ?? c.user ?? ''}`,
			problem: problems[c.id],
			actions: (
				<>
					<button type="button" className="lw-icon-button" aria-label={`${t.editConnection} ${c.name}`} title={t.editConnection} onClick={() => openOf(`connection:${c.id}`)}><Pencil size={14} aria-hidden="true" /></button>
					<button type="button" className="lw-icon-button" aria-label={`${t.removeConnection} ${c.name}`} title={t.removeConnection} onClick={() => setRemoving(c)}><Trash2 size={14} aria-hidden="true" /></button>
				</>
			)
		}
	}), [connections, secrets, problems, whos, t])
	const pages = useMemo(() => ({
		preferences: { title: t.preferences, icon: <Settings size={14} aria-hidden="true" />, render: () => <PreferencesPage /> },
		'connection:new': { title: t.newConnection, icon: <Plus size={14} aria-hidden="true" />, render: () => <ConnectionEditor secret="" onSave={save(undefined)} /> },
		...Object.fromEntries(connections.map(c => [`connection:${c.id}`, {
			title: `${t.connection}: ${c.name}`,
			icon: <Cable size={14} aria-hidden="true" />,
			render: () => <ConnectionEditor key={c.id} initial={c} secret={credentialOf(c, secrets).secret} who={whos[c.id]} problem={problems[c.id]} onSave={save(c)} onRemove={() => remove(c.id)}
				onOpenTool={tool => openOf(`${tool}:${c.id}`)} />
		}])),
		// its tools, with its credential
		...Object.fromEntries(connections.flatMap(c => (['swagger', 'websocket', 'mcp'] as const).map(tool => [`${tool}:${c.id}`, {
			title: `${tool === 'swagger' ? 'REST API' : tool === 'websocket' ? 'WebSocket' : 'MCP'} · ${c.name}`,
			icon: <Cable size={14} aria-hidden="true" />,
			render: () => <ToolTab connection={c} tool={tool} headers={() => headersOf(credentialOf(c, secrets))} theme={dark ? 'dark' : 'light'} />
		}])))
	}), [connections, secrets, whos, problems, t, dark])
	// where the IDE was (its tabs across the connections): in this browser
	const session = useMemo(() => new BrowserSessionStore('data-gateway-ide.session'), [])
	return (
		<div className="dg-page">
			<Header brand="Data Gateway IDE" version={__APP_VERSION__}
				menu={<HeaderMenu label={t.menu} icon={<MenuIcon size={20} strokeWidth={1.75} aria-hidden="true" />} items={[
					{ label: t.newConnection, icon: <Plus size={16} aria-hidden="true" />, onClick: () => openOf('connection:new') },
					{ label: t.preferences, icon: <Settings size={16} aria-hidden="true" />, onClick: () => openOf('preferences') }
				]} />}>
				<a className="dg-link" href={wikiUrl(locale)} {...OUT}>{t.documentation}</a>
			</Header>
			<Workspace connections={specs} theme={dark ? 'dark' : 'light'} locale={locale} culture={culture} pages={pages} openPage={openPage} session={session}
				connectionsHeading={{
					title: t.connections,
					actions: <button type="button" className="lw-icon-button" aria-label={t.newConnection} title={t.newConnection} onClick={() => openOf('connection:new')}><Plus size={14} aria-hidden="true" /></button>
				}} />
			{removing && (
				<div className="dg-dialog-back" onMouseDown={e => { if (e.target === e.currentTarget) setRemoving(undefined) }}>
					<div className="dg-dialog" role="dialog" aria-modal="true" aria-label={`${t.removeConnection} ${removing.name}`}>
						<h2>{t.removeConnection}: {removing.name}</h2>
						<p><code>{urlOf(removing)}</code></p>
						<p className="dg-muted">{t.confirmRemove}</p>
						<div className="dg-dialog-actions dg-form-actions">
							<button type="button" onClick={() => setRemoving(undefined)} autoFocus>{t.cancel}</button>
							<button type="button" className="dg-danger" onClick={() => { remove(removing.id); setRemoving(undefined) }}>{t.removeConnection}</button>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
