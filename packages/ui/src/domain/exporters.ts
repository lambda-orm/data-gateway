/**
 * The exports of a table (docs/BACKOFFICE.md §3): CSV (with a BOM, so Excel reads its letters) and a real .xlsx written
 * here, without dependencies: a zip stored (not compressed) with the XML of one sheet.
 */
type Row = Record<string, unknown>

/** the columns of the rows: the keys of every row, in the order they appear */
export const columnsOf = (rows: Row[]): string[] => {
	const columns: string[] = []
	for (const row of rows) for (const key of Object.keys(row ?? {})) if (!columns.includes(key)) columns.push(key)
	return columns
}

const cellText = (value: unknown): string =>
	value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)

/** RFC 4180: a field with a comma, a quote or a line break between quotes, its quotes doubled; a BOM first */
export const toCsv = (rows: Row[]): string => {
	const columns = columnsOf(rows)
	const field = (text: string) => /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
	const lines = [columns.map(field).join(','), ...rows.map(row => columns.map(c => field(cellText(row[c]))).join(','))]
	return '﻿' + lines.join('\r\n') + '\r\n'
}

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
	// characters XML 1.0 doesn't allow
	// eslint-disable-next-line no-control-regex
	.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

/** A1, B1 … AA1: the name of a column */
const columnName = (index: number): string => {
	let name = ''
	for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
	return name
}

const sheetXml = (rows: Row[]): string => {
	const columns = columnsOf(rows)
	const cell = (value: unknown, ref: string): string => {
		if (value === null || value === undefined || value === '') return ''
		if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`
		if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
		return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(cellText(value))}</t></is></c>`
	}
	const line = (values: unknown[], r: number) => `<row r="${r}">${values.map((v, i) => cell(v, `${columnName(i)}${r}`)).join('')}</row>`
	const body = [line(columns, 1), ...rows.map((row, i) => line(columns.map(c => row[c]), i + 2))].join('')
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

/** the files of a workbook of one sheet */
const workbookFiles = (rows: Row[], sheet: string): [string, string][] => [
	['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
	['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
	['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheet.slice(0, 31) || 'Sheet1')}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
	['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
	['xl/worksheets/sheet1.xml', sheetXml(rows)]
]

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
		table[n] = c >>> 0
	}
	return table
})()

export const crc32 = (bytes: Uint8Array): number => {
	let crc = 0xFFFFFFFF
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
	return (crc ^ 0xFFFFFFFF) >>> 0
}

/** a zip of files stored as they are (method 0), as a .xlsx can be */
export const zipStored = (files: [string, Uint8Array][]): Uint8Array => {
	const chunks: Uint8Array[] = []
	const central: Uint8Array[] = []
	let offset = 0
	const encoder = new TextEncoder()
	for (const [name, data] of files) {
		const nameBytes = encoder.encode(name)
		const crc = crc32(data)
		const local = new DataView(new ArrayBuffer(30))
		local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true)
		local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBytes.length, true)
		const header = new DataView(new ArrayBuffer(46))
		header.setUint32(0, 0x02014b50, true); header.setUint16(4, 20, true); header.setUint16(6, 20, true); header.setUint16(8, 0x0800, true)
		header.setUint32(16, crc, true); header.setUint32(20, data.length, true); header.setUint32(24, data.length, true); header.setUint16(28, nameBytes.length, true)
		header.setUint32(42, offset, true)
		chunks.push(new Uint8Array(local.buffer), nameBytes, data)
		central.push(new Uint8Array(header.buffer), nameBytes)
		offset += 30 + nameBytes.length + data.length
	}
	const size = central.reduce((n, c) => n + c.length, 0)
	const end = new DataView(new ArrayBuffer(22))
	end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true)
	end.setUint32(12, size, true); end.setUint32(16, offset, true)
	const all = [...chunks, ...central, new Uint8Array(end.buffer)]
	const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0))
	let at = 0
	for (const c of all) { out.set(c, at); at += c.length }
	return out
}

/** the rows as an .xlsx of one sheet: numbers and booleans as such, the rest as text */
export const toXlsx = (rows: Row[], sheet = 'Sheet1'): Uint8Array => {
	const encoder = new TextEncoder()
	return zipStored(workbookFiles(rows, sheet).map(([name, text]) => [name, encoder.encode(text)]))
}
