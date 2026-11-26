// The URLs of short life to a storage (docs/FILES_AND_PANELS.md §1), signed without the SDKs: the example of AWS for a
// presigned URL (SigV4 in the query string), and the service SAS of Azure Blob.
import { createHmac } from 'crypto'
import { AzureBlobUrlSigner, S3UrlSigner } from '../../src/lib/infrastructure/output/files/urlSigners'

describe('S3 (SigV4 in the query string)', () => {
	test('the example of the documentation of AWS: GET /test.txt of examplebucket, 24 h', () => {
		const signer = new S3UrlSigner({ bucket: 'examplebucket', region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }, () => new Date('2013-05-24T00:00:00Z'))
		const { url, method } = signer.read('test.txt', 86400)
		expect(method).toBe('GET')
		expect(url).toBe('https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')
	})

	test('another S3 (MinIO): the bucket in the path; an upload signs its type and its size', () => {
		const signer = new S3UrlSigner({ bucket: 'shop', region: 'us-east-1', endpoint: 'http://minio:9000', accessKeyId: 'k', secretAccessKey: 's' }, () => new Date('2026-11-26T10:00:00Z'))
		const upload = signer.upload({ key: 'products/1 a.png', type: 'image/png', size: 1234, expiresSeconds: 300 })
		expect(upload.method).toBe('PUT')
		expect(upload.url.startsWith('http://minio:9000/shop/products/1%20a.png?X-Amz-Algorithm=AWS4-HMAC-SHA256')).toBe(true)
		expect(upload.url).toContain('X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost')
		expect(upload.headers).toEqual({ 'Content-Type': 'image/png', 'Content-Length': '1234' })
	})
})

describe('Azure Blob (service SAS)', () => {
	test('read: sp=r of the blob, signed with the key of the account', () => {
		const key = Buffer.from('a key of the account').toString('base64')
		const signer = new AzureBlobUrlSigner({ account: 'shopfiles', container: 'invoices', accountKey: key }, () => new Date('2026-11-26T10:00:00Z'))
		const { url } = signer.read('2026/INV 1.pdf', 300)
		const parsed = new URL(url)
		expect(`${parsed.origin}${parsed.pathname}`).toBe('https://shopfiles.blob.core.windows.net/invoices/2026/INV%201.pdf')
		const q = parsed.searchParams
		expect([q.get('sv'), q.get('sr'), q.get('sp'), q.get('st'), q.get('se')]).toEqual(['2022-11-02', 'b', 'r', '2026-11-26T09:59:00Z', '2026-11-26T10:05:00Z'])
		const toSign = ['r', '2026-11-26T09:59:00Z', '2026-11-26T10:05:00Z', '/blob/shopfiles/invoices/2026/INV 1.pdf', '', '', 'https,http', '2022-11-02', 'b', '', '', '', '', '', '', ''].join('\n')
		expect(q.get('sig')).toBe(createHmac('sha256', Buffer.from(key, 'base64')).update(toSign).digest('base64'))
	})

	test('upload: create and write, a block blob of its type', () => {
		const signer = new AzureBlobUrlSigner({ account: 'devstoreaccount1', container: 'c', accountKey: 'a2V5', endpoint: 'http://azurite:10000/devstoreaccount1' })
		const upload = signer.upload({ key: 'x.pdf', type: 'application/pdf', size: 10, expiresSeconds: 60 })
		expect(upload.url.startsWith('http://azurite:10000/devstoreaccount1/c/x.pdf?')).toBe(true)
		expect(new URL(upload.url).searchParams.get('sp')).toBe('cw')
		expect(upload.headers).toEqual({ 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/pdf' })
	})
})
