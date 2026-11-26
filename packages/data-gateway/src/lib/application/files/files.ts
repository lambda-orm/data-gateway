import { authorize } from '../../domain/auth/authorizationPolicy'
import { GatewayError } from '../../domain/errors/gatewayError'
import { RequestContext } from '../ports/input/dataGatewayPort'
import { UrlSignerPort } from '../ports/output/filePorts'
import { ClockPort } from '../ports/output/supportPorts'

/** A storage of files as the use cases see it: how it signs and what it takes */
export interface FileStorage {
	signer: UrlSignerPort
	prefix: string
	maxBytes: number
	types?: string[]
	expiresMs: number
}

/** A property whose value is the key of an object of a storage, as a client sees it */
export interface FileProperty { entity: string, property: string, storage: string, maxBytes: number, types?: string[] }

export interface UploadRequest { name?: string, type?: string, size?: number }

/** What the use cases need of the rest of the gateway: the entities of who calls (its view) and a read in it */
export interface FilesContext {
	/** the properties of the entity in the view of who calls; an entity it excludes, a ViewError */
	propertiesOf (ctx: RequestContext, entity: string): Promise<string[]>
	/** a read in the view of who calls */
	read (ctx: RequestContext, query: string, data: Record<string, unknown>): Promise<unknown>
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The files of some properties (docs/FILES_AND_PANELS.md §1): a URL to upload one (write: its type and its size within
 * what the storage takes, its key made here) and a URL to read the one a row names (read: only a key that a row of its
 * view has, so nobody reads what its view doesn't show).
 */
export class FilesUseCases {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		private readonly storages: Record<string, FileStorage>,
		/** Entity.property → the name of its storage */
		private readonly properties: Record<string, string>,
		private readonly context: FilesContext,
		private readonly clock: ClockPort,
		private readonly newId: () => string
	) {}

	/** its storage, when the property is one and who calls sees it */
	private async storageOf (ctx: RequestContext, entity: string, property: string): Promise<FileStorage> {
		const name = NAME.test(entity) && NAME.test(property) ? this.properties[`${entity}.${property}`] : undefined
		if (!name) throw new GatewayError(404, 'NotFoundError', `${entity}.${property} keeps no files (files.properties)`)
		if (!(await this.context.propertiesOf(ctx, entity)).includes(property)) {
			throw new GatewayError(403, 'ViewError', `${entity}.${property} is not in the view of the credential "${ctx.principal.name}"`)
		}
		return this.storages[name]
	}

	/** the properties that keep files that who calls sees */
	public async list (ctx: RequestContext): Promise<FileProperty[]> {
		authorize(ctx.principal, 'schema')
		const out: FileProperty[] = []
		for (const [key, name] of Object.entries(this.properties)) {
			const [entity, property] = key.split('.')
			let visible: string[]
			try { visible = await this.context.propertiesOf(ctx, entity) } catch { continue }
			if (!visible.includes(property)) continue
			const storage = this.storages[name]
			out.push({ entity, property, storage: name, maxBytes: storage.maxBytes, ...(storage.types ? { types: storage.types } : {}) })
		}
		return out
	}

	public async upload (ctx: RequestContext, entity: string, property: string, request: UploadRequest) {
		authorize(ctx.principal, 'execute', true)
		const storage = await this.storageOf(ctx, entity, property)
		const type = typeof request?.type === 'string' && request.type.trim() ? request.type.trim().toLowerCase() : 'application/octet-stream'
		const size = Number(request?.size)
		if (!Number.isInteger(size) || size <= 0) throw new GatewayError(400, 'ValidationError', 'size is the number of bytes of the file')
		if (size > storage.maxBytes) throw new GatewayError(413, 'FileTooLargeError', `the file has ${size} bytes: ${entity}.${property} takes up to ${storage.maxBytes}`)
		if (storage.types && !storage.types.includes(type)) throw new GatewayError(415, 'FileTypeError', `${entity}.${property} takes ${storage.types.join(', ')}, not ${type}`)
		// the key is made here (nobody chooses it: nobody overwrites the object of another)
		const extension = /\.([A-Za-z0-9]{1,10})$/.exec(String(request?.name ?? ''))?.[1]?.toLowerCase()
		const key = `${storage.prefix}${entity}/${property}/${this.newId()}${extension ? `.${extension}` : ''}`
		const seconds = Math.ceil(storage.expiresMs / 1000)
		const signed = storage.signer.upload({ key, type, size, expiresSeconds: seconds })
		return { key, ...signed, expiresAt: new Date(this.clock.now().getTime() + seconds * 1000).toISOString() }
	}

	public async url (ctx: RequestContext, entity: string, property: string, key: unknown) {
		const storage = await this.storageOf(ctx, entity, property)
		if (typeof key !== 'string' || !key) throw new GatewayError(400, 'ValidationError', 'key is the one a row keeps')
		// only a key that a row of its view has
		const rows = await this.context.read(ctx, `${entity}.filter(p => p.${property} == k).map(p => ({ key: p.${property} })).page(1, 1)`, { k: key })
		if (!Array.isArray(rows) || rows.length === 0) throw new GatewayError(404, 'NotFoundError', `no row of ${entity} has the file "${key}"`)
		const seconds = Math.ceil(storage.expiresMs / 1000)
		const signed = storage.signer.read(key, seconds)
		return { url: signed.url, expiresAt: new Date(this.clock.now().getTime() + seconds * 1000).toISOString() }
	}
}
