import { createHash, createHmac } from 'crypto'

/**
 * URLs of short life to a storage (docs/FILES_AND_PANELS.md §1): the bytes go between who uploads or reads and the
 * storage, never through the gateway. Signed here, without the SDKs: SigV4 query string of S3 (AWS, MinIO, R2…) and the
 * service SAS of Azure Blob.
 */
import { SignedRequest, UploadSpec, UrlSignerPort } from '../../../application/ports/output/filePorts'

export { SignedRequest, UploadSpec, UrlSignerPort }

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const hmac = (key: Buffer | string, text: string) => createHmac('sha256', key).update(text, 'utf8').digest()

/** RFC 3986, as SigV4 wants it: everything but A-Z a-z 0-9 - _ . ~ (and / in a path) */
const encode = (text: string, path = false) =>
	encodeURIComponent(text).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(path ? /%2F/g : /$^/, '/')

export interface S3Settings {
	bucket: string
	region: string
	/** another S3 (MinIO, R2…): its URL; the bucket in the path. Without it, AWS with the bucket in the host */
	endpoint?: string
	accessKeyId: string
	secretAccessKey: string
}

/** S3 with SigV4 in the query string (presigned URLs): an upload signs its type and its size, so neither can change */
export class S3UrlSigner implements UrlSignerPort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly settings: S3Settings, private readonly now: () => Date = () => new Date()) {}

	private target (key: string): { host: string, origin: string, path: string } {
		if (this.settings.endpoint) {
			const url = new URL(this.settings.endpoint)
			const base = url.pathname.replace(/\/+$/, '')
			return { host: url.host, origin: `${url.protocol}//${url.host}`, path: `${base}/${encode(this.settings.bucket)}/${encode(key, true)}` }
		}
		// us-east-1 answers at the global endpoint (the one of the examples of AWS)
		const host = this.settings.region === 'us-east-1' ? `${this.settings.bucket}.s3.amazonaws.com` : `${this.settings.bucket}.s3.${this.settings.region}.amazonaws.com`
		return { host, origin: `https://${host}`, path: `/${encode(key, true)}` }
	}

	/** the presigned URL of method on key, with the headers it signs (besides host) */
	public sign (method: 'GET' | 'PUT', key: string, expiresSeconds: number, headers: Record<string, string> = {}): SignedRequest {
		const { host, origin, path } = this.target(key)
		const time = this.now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
		const day = time.slice(0, 8)
		const scope = `${day}/${this.settings.region}/s3/aws4_request`
		const signed: Record<string, string> = { host, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()])) }
		const names = Object.keys(signed).sort()
		const query: Record<string, string> = {
			'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
			'X-Amz-Credential': `${this.settings.accessKeyId}/${scope}`,
			'X-Amz-Date': time,
			'X-Amz-Expires': String(expiresSeconds),
			'X-Amz-SignedHeaders': names.join(';')
		}
		const canonicalQuery = Object.keys(query).sort().map(k => `${encode(k)}=${encode(query[k])}`).join('&')
		const canonical = [method, path, canonicalQuery, names.map(n => `${n}:${signed[n]}\n`).join(''), names.join(';'), 'UNSIGNED-PAYLOAD'].join('\n')
		const toSign = ['AWS4-HMAC-SHA256', time, scope, sha256(canonical)].join('\n')
		const key0 = hmac(hmac(hmac(hmac(`AWS4${this.settings.secretAccessKey}`, day), this.settings.region), 's3'), 'aws4_request')
		const signature = createHmac('sha256', key0).update(toSign, 'utf8').digest('hex')
		const sent = Object.fromEntries(Object.entries(headers))
		return { url: `${origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`, method, headers: sent }
	}

	public upload (spec: UploadSpec): SignedRequest {
		return this.sign('PUT', spec.key, spec.expiresSeconds, { 'Content-Type': spec.type, 'Content-Length': String(spec.size) })
	}

	public read (key: string, expiresSeconds: number): SignedRequest {
		return this.sign('GET', key, expiresSeconds)
	}
}

export interface AzureBlobSettings {
	account: string
	container: string
	accountKey: string
	/** another Blob service (Azurite: http://azurite:10000/devstoreaccount1); without it, https://<account>.blob.core.windows.net */
	endpoint?: string
}

const SAS_VERSION = '2022-11-02'

/** Azure Blob with a service SAS of the blob: create and write to upload (a block blob), read to see it */
export class AzureBlobUrlSigner implements UrlSignerPort {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly settings: AzureBlobSettings, private readonly now: () => Date = () => new Date()) {}

	public sas (key: string, permissions: string, expiresSeconds: number, contentType?: string): string {
		const start = new Date(this.now().getTime() - 60000)
		const end = new Date(this.now().getTime() + expiresSeconds * 1000)
		const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')
		const resource = `/blob/${this.settings.account}/${this.settings.container}/${key}`
		// the fields of a service SAS of version 2020-12-06 and later, in their order
		const toSign = [permissions, iso(start), iso(end), resource, '', '', 'https,http', SAS_VERSION, 'b', '', '', '', '', '', '', contentType ?? ''].join('\n')
		const signature = createHmac('sha256', Buffer.from(this.settings.accountKey, 'base64')).update(toSign, 'utf8').digest('base64')
		const query = new URLSearchParams({ sv: SAS_VERSION, st: iso(start), se: iso(end), sr: 'b', sp: permissions, spr: 'https,http', ...(contentType ? { rsct: contentType } : {}), sig: signature })
		return query.toString()
	}

	private urlOf (key: string): string {
		const base = (this.settings.endpoint ?? `https://${this.settings.account}.blob.core.windows.net`).replace(/\/+$/, '')
		return `${base}/${encode(this.settings.container)}/${encode(key, true)}`
	}

	public upload (spec: UploadSpec): SignedRequest {
		return { url: `${this.urlOf(spec.key)}?${this.sas(spec.key, 'cw', spec.expiresSeconds)}`, method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': spec.type } }
	}

	public read (key: string, expiresSeconds: number): SignedRequest {
		return { url: `${this.urlOf(key)}?${this.sas(key, 'r', expiresSeconds)}`, method: 'GET', headers: {} }
	}
}
