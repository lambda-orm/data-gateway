// The options of a query as a form: the JSON stays what is kept (read and written by domain/queryOptions), the form
// offers the stages of the schema (not its views: the gateway decides the view), says what is valid, keeps what it doesn't know, and can be written as JSON.
import React, { useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { optionsFieldsOf, optionsTextOf, validCount, EMPTY_OPTIONS } from '../src/domain/queryOptions'
import { OptionsForm } from '../src/components/OptionsForm'
import { FakeApi } from './fakes'

vi.mock('../src/infrastructure/monaco/monacoSetup', () => ({
	loadMonaco: () => Promise.reject(new Error('no browser')),
	setSchemaTypings: () => Promise.resolve()
}))

afterEach(cleanup)

describe('the options as fields', () => {
	test('read: the known ones as fields, the others kept; an invalid text says so', () => {
		const read = optionsFieldsOf('{"stage":"test","chunkSize":500,"tryAllCan":true,"headers":[["tenant","a"]],"timeout":2000,"other":{"x":1}}')
		expect(read.fields).toEqual({ stage: 'test', view: '', chunkSize: '500', tryAllCan: 'true', headers: [['tenant', 'a']], timeout: '2000', maxIterations: '' })
		expect(read.extra).toEqual({ other: { x: 1 } })
		// the view: one of those of the roles of the credential (data-gateway 4.4)
		expect(optionsFieldsOf('{"view":"public"}').fields.view).toBe('public')
		expect(JSON.parse(optionsTextOf({ ...EMPTY_OPTIONS, view: 'support' }))).toEqual({ view: 'support' })
		expect(optionsFieldsOf('').fields).toEqual(EMPTY_OPTIONS)
		expect(optionsFieldsOf('{ nope').error).toBe('invalid')
		expect(optionsFieldsOf('[1]').error).toBe('invalid')
	})

	test('write: only what has a value, numbers only when valid, the kept ones too', () => {
		expect(optionsTextOf(EMPTY_OPTIONS)).toBe('{}')
		expect(JSON.parse(optionsTextOf({ ...EMPTY_OPTIONS, stage: ' test ', chunkSize: '500', tryAllCan: 'false', headers: [['tenant', 'a'], ['', 'ignored']] }, { other: 1 })))
			.toEqual({ other: 1, stage: 'test', chunkSize: 500, tryAllCan: false, headers: [['tenant', 'a']] })
		// a number being typed, not valid yet, is left out (the form keeps it and says what is valid)
		expect(JSON.parse(optionsTextOf({ ...EMPTY_OPTIONS, chunkSize: '5a', timeout: '0' }))).toEqual({})
		expect(validCount('')).toBe(true)
		expect(validCount('12')).toBe(true)
		expect(validCount('0')).toBe(false)
		expect(validCount('-3')).toBe(false)
		expect(validCount('1.5')).toBe(false)
	})
})

class ChoicesApi extends FakeApi {
	async stages () { return ['default', 'test'] }
}

/** The form with its JSON in a state, as the workbench keeps it */
const Harness: React.FC<{ initial: string, mode?: 'query' | 'script', onText?: (text: string) => void }> = ({ initial, mode = 'query', onText }) => {
	const [text, setText] = useState(initial)
	// one api, as the workbench keeps it (another one would read the stages again)
	const [api] = useState(() => new ChoicesApi())
	return <OptionsForm label="options" value={text} onChange={t => { setText(t); onText?.(t) }} api={api} schema="northwind/v1" mode={mode} theme="light" />
}

class RolesApi extends ChoicesApi {
	async whoami (schema: string) { return { name: 'ana', permissions: ['read'], schema, scripts: false, view: 'support', stage: 'default', views: ['support', 'public'], stages: ['default', 'reporting'], roles: ['analyst'] } }
}

describe('OptionsForm', () => {
	test('with roles (data-gateway 4.4): the stages and the views they allow; a view only when there is more than one', async () => {
		const texts: string[] = []
		const Roles: React.FC = () => {
			const [text, setText] = useState('{}')
			const [api] = useState(() => new RolesApi())
			return <OptionsForm label="options" value={text} onChange={t => { setText(t); texts.push(t) }} api={api} schema="shop" mode="query" theme="light" />
		}
		render(<Roles />)
		await waitFor(() => expect((screen.getByLabelText('options · stage') as HTMLElement).tagName).toBe('SELECT'))
		expect([...(screen.getByLabelText('options · stage') as HTMLSelectElement).options].map(o => o.value)).toEqual(['', 'default', 'reporting'])
		const view = screen.getByLabelText('options · view') as HTMLSelectElement
		expect([...view.options].map(o => o.value)).toEqual(['', 'support', 'public'])
		fireEvent.change(view, { target: { value: 'public' } })
		expect(JSON.parse(texts.at(-1)!)).toEqual({ view: 'public' })
	})

	test('stage offers those of the schema, and there is no view; each field says what is valid; an empty one is no option', async () => {
		const texts: string[] = []
		render(<Harness initial="{}" onText={t => texts.push(t)} />)
		// a text field until the stages arrive, then their combo
		await waitFor(() => expect((screen.getByLabelText('options · stage') as HTMLElement).tagName).toBe('SELECT'))
		const stage = screen.getByLabelText('options · stage') as HTMLSelectElement
		expect([...stage.options].map(o => o.value)).toEqual(['', 'default', 'test'])
		expect(screen.queryByLabelText('options · view')).toBeNull()
		expect(screen.getByText(/where it runs: a stage of the schema/)).toBeTruthy()
		fireEvent.change(stage, { target: { value: 'test' } })
		expect(JSON.parse(texts.at(-1)!)).toEqual({ stage: 'test' })
		fireEvent.change(screen.getByLabelText('options · stage'), { target: { value: '' } })
		expect(texts.at(-1)).toBe('{}')
		// the script options only for a script
		expect(screen.queryByLabelText('options · timeout (ms)')).toBeNull()
	})

	test('a number not valid yet stays in its field, says what is valid, and doesn\'t reach the JSON', async () => {
		const texts: string[] = []
		render(<Harness initial="{}" onText={t => texts.push(t)} />)
		const chunk = await screen.findByLabelText('options · chunk size') as HTMLInputElement
		fireEvent.change(chunk, { target: { value: '5a' } })
		expect(chunk.value).toBe('5a')
		expect(chunk.getAttribute('aria-invalid')).toBe('true')
		expect(screen.getByText('a whole number greater than 0')).toBeTruthy()
		expect(texts.at(-1)).toBe('{}')
		fireEvent.change(chunk, { target: { value: '500' } })
		expect(JSON.parse(texts.at(-1)!)).toEqual({ chunkSize: 500 })
	})

	test('a header is added, named and given its value; the options it doesn\'t know are kept and listed', async () => {
		const texts: string[] = []
		render(<Harness initial='{"custom":true}' mode="script" onText={t => texts.push(t)} />)
		expect(await screen.findByText('Other options, kept as they are: custom')).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: '+ add a header' }))
		fireEvent.change(screen.getByLabelText('options · headers · name'), { target: { value: 'tenant' } })
		fireEvent.change(screen.getByLabelText('options · headers · value'), { target: { value: 'acme' } })
		fireEvent.change(screen.getByLabelText('options · max iterations'), { target: { value: '1000' } })
		expect(JSON.parse(texts.at(-1)!)).toEqual({ custom: true, maxIterations: 1000, headers: [['tenant', 'acme']] })
	})

	test('as JSON, and an invalid JSON can only be fixed as JSON', async () => {
		render(<Harness initial="{ nope" />)
		expect(await screen.findByText('The options are not a JSON object: fix them in JSON.')).toBeTruthy()
		expect((screen.getByRole('radio', { name: 'form' }) as HTMLButtonElement).disabled).toBe(true)
		expect(screen.getByRole('textbox', { name: 'options' })).toBeTruthy()
	})
})

describe('the options and the data in the workbench', () => {
	test('the options in one line; Edit opens them in a dialog, as a form or JSON', async () => {
		const { QueryWorkbench } = await import('../src/components/QueryWorkbench')
		render(<QueryWorkbench api={new ChoicesApi()} history={false} initial={{ options: '{"stage":"test","chunkSize":500}' }} />)
		expect(await screen.findByText('stage: test · chunk size: 500')).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'edit' }))
		const dialog = await screen.findByRole('dialog', { name: 'options' })
		expect(dialog).toBeTruthy()
		expect(screen.getByRole('radio', { name: 'form' })).toBeTruthy()
		expect(screen.getByRole('radio', { name: 'JSON' })).toBeTruthy()
		fireEvent.change(screen.getByLabelText('options · chunk size'), { target: { value: '' } })
		fireEvent.click(screen.getByRole('button', { name: 'done' }))
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(screen.getByText('stage: test')).toBeTruthy()
	})

	test('the data folds while empty and opens when something fills it', async () => {
		const { QueryWorkbench } = await import('../src/components/QueryWorkbench')
		const { container } = render(<QueryWorkbench api={new ChoicesApi()} history={false} />)
		await screen.findByText('none: the defaults')
		const data = container.querySelector('details.lw-data') as HTMLDetailsElement
		expect(data.open).toBe(false)
		expect(screen.queryByRole('textbox', { name: 'data' })).toBeNull()
		// a query whose data has something (a saved one, the history): open
		render(<QueryWorkbench api={new ChoicesApi()} history={false} initial={{ data: '{"id":1}' }} />)
		await waitFor(() => expect([...document.querySelectorAll('details.lw-data')].some(d => (d as HTMLDetailsElement).open)).toBe(true))
	})
})
