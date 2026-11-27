// The administration of a connection in the explorer: a tree its host gives, above the schemas.
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AdministrationTree } from '../src/components/Explorer'

afterEach(cleanup)

describe('the administration tree', () => {
	test('a node with children unfolds; one without opens; its actions are buttons of its row', () => {
		const opened: string[] = []
		const added = vi.fn()
		render(<AdministrationTree title="Administration" nodes={[
			{ key: 'roles', label: 'Roles', onOpen: () => opened.push('roles'), actions: [{ label: 'Add role', onClick: added }], children: [{ key: 'role:admin', label: 'admin', onOpen: () => opened.push('admin') }] },
			{ key: 'sessions', label: 'Sessions', onOpen: () => opened.push('sessions') }
		]} />)
		expect(screen.getByRole('navigation', { name: 'Administration' })).toBeTruthy()
		expect(screen.queryByText('admin')).toBeNull()
		fireEvent.click(screen.getByText('Roles'))
		expect(screen.getByText('admin')).toBeTruthy()
		fireEvent.doubleClick(screen.getByText('Roles'))
		expect(opened).toEqual(['roles'])
		fireEvent.click(screen.getByText('admin'))
		fireEvent.click(screen.getByText('Sessions'))
		expect(opened).toEqual(['roles', 'admin', 'sessions'])
		fireEvent.click(screen.getByRole('button', { name: 'Add role' }))
		expect(added).toHaveBeenCalledTimes(1)
		// the action doesn't unfold nor fold its row
		expect(screen.getByText('admin')).toBeTruthy()
	})
})
