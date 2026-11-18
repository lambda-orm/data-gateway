import './monacoWorkers'
import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryWorkbench } from '@lambdaorm/ui'
import '@lambdaorm/ui/styles.css'
import './app.css'

type Kind = 'bearer' | 'apikey' | 'basic' | 'none'

/** The REST API is the same origin, under the base path the UI is served at ({basePath}/ui/) */
const baseUrl = window.location.origin + window.location.pathname.replace(/\/ui\/?.*$/, '')

/** The credential lives only in this tab's memory: no storage, no cookie */
const App: React.FC = () => {
	const [kind, setKind] = useState<Kind>('bearer')
	const [header, setHeader] = useState('X-Api-Key')
	const [user, setUser] = useState('')
	const [secret, setSecret] = useState('')
	const [applied, setApplied] = useState<{ kind: Kind, header: string, user: string, secret: string }>()
	const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
	const headers = useMemo(() => {
		if (!applied) return undefined
		return (): Record<string, string> => {
			switch (applied.kind) {
			case 'bearer': return { Authorization: `Bearer ${applied.secret}` }
			case 'apikey': return { [applied.header]: applied.secret }
			case 'basic': return { Authorization: `Basic ${btoa(`${applied.user}:${applied.secret}`)}` }
			default: return {}
			}
		}
	}, [applied])
	return (
		<div className={`app ${dark ? 'dark' : ''}`}>
			<form className="credential" onSubmit={e => { e.preventDefault(); setApplied({ kind, header, user, secret }) }}>
				<strong>λORM</strong>
				<select aria-label="authentication" value={kind} onChange={e => setKind(e.target.value as Kind)}>
					<option value="bearer">Bearer token</option>
					<option value="apikey">API key</option>
					<option value="basic">Basic</option>
					<option value="none">none</option>
				</select>
				{kind === 'apikey' && <input aria-label="header" value={header} onChange={e => setHeader(e.target.value)} />}
				{kind === 'basic' && <input aria-label="user" placeholder="user" value={user} onChange={e => setUser(e.target.value)} autoComplete="username" />}
				{kind !== 'none' && <input aria-label="secret" type="password" placeholder="credential" value={secret} onChange={e => setSecret(e.target.value)} autoComplete="current-password" />}
				<button type="submit">connect</button>
				{applied && <button type="button" onClick={() => { setApplied(undefined); setSecret('') }}>forget</button>}
			</form>
			{headers
				? <QueryWorkbench key={JSON.stringify({ ...applied, secret: applied!.secret.length })} baseUrl={baseUrl} headers={headers} theme={dark ? 'dark' : 'light'} initialQuery="" />
				: <p className="hint">Enter a credential of this gateway. It stays in this tab only.</p>}
		</div>
	)
}

createRoot(document.getElementById('root')!).render(<App />)
