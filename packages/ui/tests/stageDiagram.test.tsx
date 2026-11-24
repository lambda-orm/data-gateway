// The diagram of a stage: the Data Gateway and, under it, each source of the stage with the tables that live in it; a
// click on the arrow of a source shows its condition below, in colours. A gateway without the routing says so.
import React from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StageDiagram } from '../src/components/StageDiagram'
import { AdminApiPort, StageRouting } from '../src/application/ports'

afterEach(cleanup)

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
})
