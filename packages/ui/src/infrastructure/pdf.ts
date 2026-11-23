/**
 * A PDF of one page with one JPEG image filling it: what a diagram exports as PDF, without a library. The page is the
 * size of the drawing in points (pageWidth × pageHeight), the image keeps its own pixels (twice as many, to print sharp).
 */
export const pdfOfJpeg = (jpeg: Uint8Array, pixelsWide: number, pixelsHigh: number, pageWidth: number, pageHeight: number): Uint8Array => {
	const encoder = new TextEncoder()
	const parts: Uint8Array[] = []
	const offsets: number[] = []
	let length = 0
	const push = (part: Uint8Array | string) => { const bytes = typeof part === 'string' ? encoder.encode(part) : part; parts.push(bytes); length += bytes.length }
	const object = (n: number, body: (string | Uint8Array)[]) => { offsets[n] = length; push(`${n} 0 obj\n`); for (const b of body) push(b); push('\nendobj\n') }
	const w = Math.round(pageWidth * 100) / 100
	const h = Math.round(pageHeight * 100) / 100
	const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`
	push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
	object(1, ['<< /Type /Catalog /Pages 2 0 R >>'])
	object(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'])
	object(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`])
	object(4, [`<< /Type /XObject /Subtype /Image /Width ${pixelsWide} /Height ${pixelsHigh} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream'])
	object(5, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`])
	const xref = length
	push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`)
	push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
	const out = new Uint8Array(length)
	let at = 0
	for (const part of parts) { out.set(part, at); at += part.length }
	return out
}
