// The history of a schema in the UI (phase 4 of the observability, docs/OBSERVABILITY_PLAN.md of core): the tab History
// (who, when, what, the diff and the element before and after), who changed an element in the 412 of a form, the
// notice of a change of another session with its Refresh, and the link of an entity to its traces.
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HistoryView } from '../src/components/HistoryView'
import { EntityView } from '../src/components/EntityView'
import { Workspace } from '../src/components/Workspace'
import { AdminApiPort, SchemaChange, SchemaHistoryQuery, WorkspaceChangeEvent } from '../src/application/ports'
import { RestAdminApi } from '../src/infrastructure/restAdminApi'
import { MemoryWorkspaceStore } from '../src/infrastructure/workspaceStores'
import { changedByText } from '../src/domain/changedBy'
import { FakeApi } from './fakes'

vi.mock('../src/infrastructure/monaco/monacoSetup', () => ({ loadMonaco: () => Promise.reject(new Error('no monaco in tests')), setSchemaTypings: () => Promise.resolve() }))
afterEach(cleanup)

const patch: SchemaChange = {
	id: '01JDX2', time: '2026-11-24T10:00:00.000Z', schema: 'shop', kind: 'schema.patch', target: 'domain/entities/Customers/properties/email', op: 'set',
	before: { name: 'email', length: 80 }, after: { name: 'email', length: 120 },
	diff: [{ op: 'replace', path: '/domain/entities/0/properties/2/length', value: 120 }],
	version: { before: 'aaaa', after: 'bbbb' }, actor: { credential: 'modeler', session: 's-1', client: 'data-gateway-ide 2.1.0', ip: '10.0.0.9' }, result: 'ok'
}
const push: SchemaChange = { id: '01JDX1', time: '2026-11-24T09:00:00.000Z', schema: 'shop', kind: 'stage.push', stage: 'default', actor: { client: 'lambdaorm-cli 1.7.0', user: 'flavio' }, ddl: [{ source: 'crm', file: 'orm_state/crm/V261124090000__push.sql', sentences: 3 }], result: 'ok' }

const adminWith = (pages: { items: SchemaChange[], nextCursor?: string }[]): AdminApiPort & { asked: SchemaHistoryQuery[] } => {
	const asked: SchemaHistoryQuery[] = []
	return { asked, history: async (_schema: string, query: SchemaHistoryQuery = {}) => { asked.push(query); return pages[asked.length - 1] ?? { items: [] } } } as any
}

describe('HistoryView', () => {
	test('who, when and what, the newest first; a change shows its diff and the element before and after', async () => {
		const admin = adminWith([{ items: [patch, push] }])
		render(<HistoryView admin={admin} schema="shop" locale="en" />)
		await screen.findByText('modeler')
		expect(screen.getByText('· data-gateway-ide 2.1.0')).toBeTruthy()
		expect(screen.getByText('flavio')).toBeTruthy()
		fireEvent.click(screen.getByText('modeler'))
		const diff = screen.getByLabelText('Changes')
		expect(diff.textContent).toContain('~ /domain/entities/0/properties/2/length: 120')
		expect(screen.getByText('Before')).toBeTruthy()
		expect(screen.getAllByText(/"length": 120/).length).toBe(1)
		fireEvent.click(screen.getByText('flavio'))
		expect(screen.getByText('orm_state/crm/V261124090000__push.sql')).toBeTruthy()
	})

	test('only the changes of an element, page by page', async () => {
		const admin = adminWith([{ items: [patch], nextCursor: '01JDX2' }, { items: [push] }])
		render(<HistoryView admin={admin} schema="shop" target="domain/entities/Customers" locale="en" pageSize={1} />)
		await screen.findByText('modeler')
		fireEvent.click(screen.getByRole('button', { name: 'Older changes' }))
		await screen.findByText('flavio')
		expect(admin.asked).toEqual([{ target: 'domain/entities/Customers', limit: 1, cursor: undefined }, { target: 'domain/entities/Customers', limit: 1, cursor: '01JDX2' }])
		expect(screen.queryByRole('button', { name: 'Older changes' })).toBeNull()
	})

	test('a gateway that does not keep it, and one without changes', async () => {
		const { unmount } = render(<HistoryView admin={{} as any} schema="shop" locale="es" />)
		expect(screen.getByText('Esta gateway no guarda el historial del esquema')).toBeTruthy()
		unmount()
		render(<HistoryView admin={adminWith([{ items: [] }])} schema="shop" locale="en" />)
		await screen.findByText('No changes recorded yet')
	})
})

describe('the REST client', () => {
	test('GET /admin/workspaces/{schema}/history with its query', async () => {
		const urls: string[] = []
		const api = new RestAdminApi('http://gw/data-gateway', () => ({}), (async (url: string) => { urls.push(url); return new Response(JSON.stringify({ items: [] }), { status: 200 }) }) as any)
		await api.history('iot/v1', { target: 'domain/entities/Customers', limit: 10 })
		await api.history('')
		expect(urls).toEqual(['http://gw/data-gateway/admin/workspaces/iot%2Fv1/history?target=domain%2Fentities%2FCustomers&limit=10', 'http://gw/data-gateway/admin/workspaces/~/history'])
	})
})

describe('who changed it (412)', () => {
	test('the credential and the IDE, with the time; without it, the text of before', () => {
		const text = changedByText({ credential: 'modeler', client: 'data-gateway-ide 2.1.0', time: '2026-11-24T10:00:00.000Z' }, 'en', 'fallback')
		expect(text).toMatch(/^modeler \(data-gateway-ide 2\.1\.0\) changed it at .+: this is what it has now$/)
		expect(changedByText(undefined, 'en', 'fallback')).toBe('fallback')
	})
})

describe('an entity', () => {
	const domain = async () => ({ entities: [{ name: 'Customers', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer' }] }], enums: [] }) as any
	test('its tab History (with its changes) and the link to its traces', async () => {
		const admin = adminWith([{ items: [patch] }])
		render(<EntityView api={new FakeApi()} schema="shop" entity="Customers" domain={domain} locale="en" onOpenEntity={() => undefined} onQuery={() => undefined}
			admin={admin} tracesUrl="http://grafana:3000/explore?x=1" />)
		const link = await screen.findByRole('link', { name: 'View traces' })
		expect(link.getAttribute('href')).toBe('http://grafana:3000/explore?x=1')
		expect(link.getAttribute('target')).toBe('_blank')
		fireEvent.click(screen.getByRole('tab', { name: 'History' }))
		await screen.findByText('modeler')
		expect(admin.asked[0].target).toBe('domain/entities/Customers')
	})
	test('without the administration: no History, no link', async () => {
		render(<EntityView api={new FakeApi()} schema="shop" entity="Customers" domain={domain} locale="en" onOpenEntity={() => undefined} onQuery={() => undefined} />)
		await screen.findByRole('tab', { name: /Properties/ })
		expect(screen.queryByRole('tab', { name: 'History' })).toBeNull()
		expect(screen.queryByRole('link', { name: 'View traces' })).toBeNull()
	})
})

describe('a change of another session', () => {
	test('is announced with who and what, and a Refresh; one of this session is not', async () => {
		const listeners = new Set<(event?: WorkspaceChangeEvent) => void>()
		const emit = (event: WorkspaceChangeEvent) => { for (const l of [...listeners]) l(event) }
		const a = {
			id: 'a', name: 'local', api: new FakeApi(), admin: false as const, store: new MemoryWorkspaceStore([], true),
			changes: (listener: (event?: WorkspaceChangeEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
			session: () => 'mine'
		}
		render(<Workspace locale="en" refreshMs={0} history={false} connections={[a]} />)
		await waitFor(() => expect(listeners.size).toBeGreaterThan(0))
		emit({ path: 'shop', kind: 'schema', change: { id: '1', kind: 'schema.patch', target: 'domain/entities/Customers', actor: { credential: 'modeler', session: 'mine' }, time: 't' } })
		await new Promise(resolve => setTimeout(resolve, 20))
		expect(screen.queryByText(/changed domain\/entities\/Customers/)).toBeNull()
		emit({ path: 'shop', kind: 'schema', change: { id: '2', kind: 'schema.patch', target: 'domain/entities/Customers', actor: { credential: 'analyst', session: 'other' }, time: 't' } })
		await screen.findByText(/analyst changed domain\/entities\/Customers in shop/)
		fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
		await waitFor(() => expect(screen.queryByText(/analyst changed/)).toBeNull())
		// an event without who (from outside, or a change of state): no notice
		emit({ path: 'shop', kind: 'schema' })
		await new Promise(resolve => setTimeout(resolve, 20))
		expect(screen.queryByText(/changed/)).toBeNull()
	})
})
