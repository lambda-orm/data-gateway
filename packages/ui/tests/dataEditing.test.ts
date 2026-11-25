// The queries of the editable table and its exports (docs/BACKOFFICE.md): every value in data, the change of a cell
// only while it has what was read, CSV with a BOM and a real .xlsx (a stored zip of XML).
import { describe, expect, test } from 'vitest'
import { deleteRow, insertRow, pageQuery, textOf, updateCell, valueOf } from '../src/domain/dataEditing'
import { columnsOf, crc32, toCsv, toXlsx } from '../src/domain/exporters'

describe('the queries of the table', () => {
	test('a page, sorted and filtered', () => {
		expect(pageQuery('Products', { page: 2, size: 50 })).toBe('Products.page(2, 50)')
		expect(pageQuery('Products', { page: 1, size: 10, filter: ' p.price > 10 ', sort: { field: 'name', desc: true } })).toBe('Products.filter(p => p.price > 10).sort(p => desc(p.name)).page(1, 10)')
	})

	test('a cell: by its key and only while it has what was read; null is isNull', () => {
		expect(updateCell('Products', ['id'], { id: 7, name: 'Chai', price: null }, 'name', 'Chai tea')).toEqual({
			query: 'Products.update(p => ({ name: v_new })).filter(p => p.id == k_id && p.name == v_old)', data: { v_new: 'Chai tea', v_old: 'Chai', k_id: 7 }
		})
		expect(updateCell('Prices', ['product', 'list'], { product: 7, list: 'A', price: null }, 'price', 3).query)
			.toBe('Prices.update(p => ({ price: v_new })).filter(p => p.product == k_product && p.list == k_list && isNull(p.price))')
	})

	test('a new row, and a row removed by its key', () => {
		expect(insertRow('Products', { name: 'x' })).toEqual({ query: 'Products.insert()', data: { name: 'x' } })
		expect(deleteRow('Products', ['id'], { id: 7, name: 'Chai' })).toEqual({ query: 'Products.delete().filter(p => p.id == k_id)', data: { k_id: 7 } })
	})

	test('the text of an input as the value of its type', () => {
		expect(valueOf('42', 'integer')).toEqual({ value: 42 })
		expect(valueOf('4.2', 'integer')).toEqual({ error: 'a whole number' })
		expect(valueOf('4.2', 'decimal')).toEqual({ value: 4.2 })
		expect(valueOf('true', 'boolean')).toEqual({ value: true })
		expect(valueOf('', 'string')).toEqual({ value: null })
		expect(valueOf('{"a":1}', 'json')).toEqual({ value: { a: 1 } })
		expect(textOf({ a: 1 })).toBe('{"a":1}')
		expect(textOf(null)).toBe('')
	})
})

describe('the exports', () => {
	const rows = [{ id: 1, name: 'Côte de Blaye, "red"', price: 263.5, active: true }, { id: 2, name: 'line\nbreak', extra: { a: 1 } }]

	test('the columns of every row, in order', () => {
		expect(columnsOf(rows)).toEqual(['id', 'name', 'price', 'active', 'extra'])
	})

	test('CSV: a BOM, quotes where needed', () => {
		expect(toCsv(rows)).toBe('﻿id,name,price,active,extra\r\n1,"Côte de Blaye, ""red""",263.5,true,\r\n2,"line\nbreak",,,"{""a"":1}"\r\n')
	})

	test('xlsx: a zip whose entries are the parts of a workbook, each with its CRC', () => {
		const bytes = toXlsx(rows, 'Products')
		expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
		const text = new TextDecoder().decode(bytes)
		for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']) expect(text).toContain(part)
		expect(text).toContain('<c r="C2"><v>263.5</v></c>')
		expect(text).toContain('<c r="D2" t="b"><v>1</v></c>')
		expect(text).toContain('Côte de Blaye, &quot;red&quot;')
		expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926)
	})
})
