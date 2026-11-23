import { describe, expect, test } from 'vitest'
import { pdfOfJpeg } from '../src/infrastructure/pdf'

describe('a diagram as PDF', () => {
	test('one page of the size of the drawing with its JPEG; the offsets of the xref point at each object', () => {
		const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
		const pdf = pdfOfJpeg(jpeg, 800, 400, 400, 200)
		const text = new TextDecoder('latin1').decode(pdf)
		expect(text.startsWith('%PDF-1.4')).toBe(true)
		expect(text).toContain('/MediaBox [0 0 400 200]')
		expect(text).toContain('/Width 800 /Height 400')
		expect(text).toContain('/Filter /DCTDecode /Length 9')
		expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
		// the xref: each object where it says (bytes)
		const xref = Number(/startxref\n(\d+)/.exec(text)![1])
		expect(text.slice(xref, xref + 4)).toBe('xref')
		const offsets = text.slice(xref).split('\n').slice(3, 8).map(l => Number(l.slice(0, 10)))
		offsets.forEach((offset, i) => {
			const start = new TextDecoder('latin1').decode(pdf.slice(offset, offset + 10))
			expect(start.startsWith(`${i + 1} 0 obj`)).toBe(true)
		})
	})
})
