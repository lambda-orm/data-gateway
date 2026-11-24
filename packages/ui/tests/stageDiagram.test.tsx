// The diagram of a stage: the Data Gateway and, under it, each source of the stage with the tables that live in it; a
// click on the arrow of a source shows its condition below, in colours. A gateway without the routing says so.
import React from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StageDiagram, StageView } from '../src/components/StageDiagram'
import { AdminApiPort, StageRouting } from '../src/application/ports'

afterEach(cleanup)

// jsdom has no PointerEvent: without it the coordinates of a drag are lost
if (!(globalThis as any).PointerEvent) {
	(globalThis as any).PointerEvent = class extends MouseEvent {
		pointerId: number
		constructor (type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 }
	}
}

const ROUTING: StageRouting = {
	stage: 'default',
	sources: [
		{ name: 'documents', dialect: 'MongoDB', mapping: 'docs', condition: 'entity.in(["Orders","Products"])', entities: [{ entity: 'Orders', table: 'orders' }, { entity: 'Products', table: 'Products' }] },
		{ name: 'replica', dialect: 'PostgreSQL', condition: 'read && entity == "Customers"', entities: [] },
		{ name: 'main', dialect: 'PostgreSQL', entities: [{ entity: 'Customers', table: 'TBL_CUSTOMERS', read: 'replica' }] }
	],
	unrouted: ['Legacy']
}

const adminOf = (routing?: StageRouting, failure?: Error): AdminApiPort => ({
	stageRouting: async () => { if (failure) throw failure; return routing! }
}) as unknown as AdminApiPort

describe('StageDiagram', () => {
	test('each source with its tables; the arrow of a source shows its condition, in colours', async () => {
		const { container } = render(<StageDiagram admin={adminOf(ROUTING)} schema="northwind" stage="default" />)
		expect(await screen.findByRole('img', { name: 'Stage default' })).toBeTruthy()
		expect([...container.querySelectorAll('[data-source]')].map(g => g.getAttribute('data-source'))).toEqual(['documents', 'replica', 'main'])
		const main = container.querySelector('[data-source="main"]')!
		// the table by its mapping, the entity when it is named otherwise, and where its reads go
		expect(main.textContent).toContain('TBL_CUSTOMERS')
		expect(main.textContent).toContain('Customers · reads: replica')
		// the replica: the reads it takes of a table that lives in main
		expect(container.querySelector('[data-source="replica"]')!.textContent).toContain('TBL_CUSTOMERS  its reads · lives in main')
		expect(screen.getByRole('status').textContent).toContain('Legacy')
		expect(screen.getByText('Click the arrow of a source to see its condition.')).toBeTruthy()

		fireEvent.click(screen.getByRole('button', { name: 'Condition 1. documents' }))
		const code = screen.getByLabelText('Condition')
		expect(code.textContent).toBe('entity.in(["Orders","Products"])')
		// in the colours of the editor: a variable, a function, the strings
		expect(code.querySelector('.lw-tok-variable, [class*="variable"]')).toBeTruthy()

		// the last one has no condition: it takes the rest
		fireEvent.click(screen.getByRole('button', { name: 'Condition 3. main' }))
		expect(screen.getByLabelText('Condition').textContent).toBe('no condition: the rest')
	})

	test('a gateway before 4.1.0 has no routing: it says so', async () => {
		render(<StageDiagram admin={adminOf(undefined, Object.assign(new Error('GET /admin/workspaces/x/stages/default/routing is not a route of this gateway'), { status: 404 }))} schema="x" stage="default" />)
		expect((await screen.findByRole('alert')).textContent).toMatch(/4\.1\.0 or later/)
	})

	test('its toolbar: only the names of the sources, the gateway on the left, a box dragged where one wants; kept with its tab', async () => {
		const views: StageView[] = []
		const { container } = render(<StageDiagram admin={adminOf(ROUTING)} schema="northwind" stage="default" onViewChange={v => views.push(v)} />)
		await screen.findByRole('img', { name: 'Stage default' })
		const translateOf = (key: string) => container.querySelector(`[data-source="${key}"]`)!.getAttribute('transform')
		// only the names: no table
		fireEvent.change(screen.getByLabelText('show'), { target: { value: 'names' } })
		expect(container.querySelector('[data-source="main"]')!.textContent).not.toContain('TBL_CUSTOMERS')
		expect(views.at(-1)).toMatchObject({ detail: 'names' })
		// the gateway on the left: the sources in a column
		const before = [translateOf('documents'), translateOf('main')]
		fireEvent.click(screen.getByRole('button', { name: 'the gateway on the left, the sources on the right' }))
		expect(views.at(-1)).toMatchObject({ orientation: 'left', positions: {} })
		const after = [translateOf('documents'), translateOf('main')]
		expect(after).not.toEqual(before)
		const x = (t: string | null) => Number(/translate\(([-\d.]+),/.exec(t ?? '')![1])
		expect(x(after[0])).toBe(x(after[1]))
		// a box dragged: where it was put, told to be kept
		const box = container.querySelector('[data-source="main"]')!
		fireEvent.pointerDown(box, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
		fireEvent.pointerMove(container.querySelector('.lw-stage-canvas')!, { clientX: 160, clientY: 130, pointerId: 1 })
		fireEvent.pointerUp(container.querySelector('.lw-stage-canvas')!, { pointerId: 1 })
		expect(views.at(-1)?.positions?.main).toBeTruthy()
		// lay out again: every box where it goes by itself
		fireEvent.click(screen.getByRole('button', { name: 'lay out again' }))
		expect(views.at(-1)).toMatchObject({ positions: {} })
	})

	test('how it was left: turned and with a box moved, it opens so', async () => {
		const { container } = render(<StageDiagram admin={adminOf(ROUTING)} schema="northwind" stage="default" view={{ orientation: 'left', positions: { main: { x: 900, y: 40 } } }} />)
		await screen.findByRole('img', { name: 'Stage default' })
		expect(container.querySelector('[data-source="main"]')!.getAttribute('transform')).toBe('translate(900,40)')
		expect(screen.getByRole('button', { name: 'the gateway on the left, the sources on the right' }).getAttribute('aria-pressed')).toBe('true')
	})
})
