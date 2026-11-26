// The files of some properties (docs/FILES_AND_PANELS.md §1), with λORM on SQLite and real storages: an S3
// (DATA_GATEWAY_TEST_S3: http://k3y:s3cr3t@host:port/bucket, versitygw) and an Azure Blob (DATA_GATEWAY_TEST_AZURITE:
// http://host:port, Azurite, its container files made). A URL to upload (its type and size within what the storage
// takes), the key in the row, a URL to read only the key a row of the view of who asks has.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Orm } from '@lambdaorm/lib'
import { composeSchema, ComposedSchema } from '../../src/lib/infrastructure/build/schemaComposer'
import { ConfigReader } from '../../src/lib/domain/config/configReader'
import { effectiveSettings } from '../../src/lib/domain/runtime/schemas'
import { principal } from '../../src/lib/domain/auth/principal'
import { ConsoleLogger } from '../../src/lib/infrastructure/output/logger/loggers'
import { RequestContext } from '../../src/lib/application/ports/input/dataGatewayPort'
import { FixedClock, MemoryAudit } from '../helpers/fakes'

const S3 = process.env.DATA_GATEWAY_TEST_S3
const AZURITE = process.env.DATA_GATEWAY_TEST_AZURITE
const AZURITE_KEY = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=='

;(S3 && AZURITE ? describe : describe.skip)('files in S3 and Azure Blob (SQLite)', () => {
	let dir: string
	let schema: ComposedSchema
	const editor: RequestContext = { principal: principal('editor', ['read', 'write']), transport: 'http' }
	const reader: RequestContext = { principal: principal('reader', ['read']), transport: 'http' }
	const outsider: RequestContext = { principal: { ...principal('outsider', ['read']), view: 'noPhotos' }, transport: 'http' }
	const png = Buffer.from('89504e470d0a1a0a', 'hex')

	beforeAll(async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-files-'))
		const workspace = path.join(dir, 'shop')
		fs.mkdirSync(workspace)
		fs.writeFileSync(path.join(workspace, 'lambdaORM.yaml'), `domain:
  entities:
    - name: Products
      primaryKey: [id]
      properties:
        - { name: id, type: integer, required: true }
        - { name: name, type: string, length: 80, required: true }
        - { name: photo, type: string, length: 200 }
        - { name: invoice, type: string, length: 200 }
infrastructure:
  views:
    - name: noPhotos
      entities:
        - name: Products
          properties:
            - { name: photo, exclude: true }
  mappings:
    - name: default
  sources:
    - { name: main, dialect: SQLjs, mapping: default, connection: ':memory:' }
  stages:
    - name: default
      sources:
        - name: main
`)
		const s3 = new URL(S3!)
		const { config, issues } = new ConfigReader().read({
			orm: { workspacePath: dir },
			transports: { http: { port: 8080 } },
			files: {
				storages: {
					images: { type: 's3', endpoint: `${s3.protocol}//${s3.host}`, bucket: s3.pathname.slice(1), region: 'us-east-1', accessKeyId: s3.username, secretAccessKey: s3.password, prefix: 'shop/', maxBytes: '1KB', types: ['image/png'], expires: '2m' },
					invoices: { type: 'azureBlob', endpoint: `${AZURITE}/devstoreaccount1`, account: 'devstoreaccount1', container: 'files', accountKey: AZURITE_KEY }
				},
				properties: { 'Products.photo': 'images', 'Products.invoice': 'invoices' }
			}
		})
		expect(issues).toEqual([])
		const settings = effectiveSettings(config!, { path: 'shop', workspace, overrides: {} } as any)
		schema = await composeSchema({ path: 'shop', workspace, settings, audit: { enabled: false, includeData: false }, mcpName: 'dg', pageSize: 50, version: '9.9.9', checkConnections: false },
			{ logger: new ConsoleLogger('error'), audit: new MemoryAudit(), clock: new FixedClock() })
		await ((schema.gateway as any).orm.orm as Orm).stage.push({ stage: 'default' }).execute()
		await schema.gateway.execute(editor, { query: 'Products.insert()', data: { id: 1, name: 'Chai' } })
	}, 60000)
	afterAll(async () => {
		await schema?.stop()
		fs.rmSync(dir, { recursive: true, force: true })
	})

	test('which properties keep files, in the view of who asks', async () => {
		expect(await schema.gateway.files(reader)).toEqual([
			{ entity: 'Products', property: 'photo', storage: 'images', maxBytes: 1024, types: ['image/png'] },
			{ entity: 'Products', property: 'invoice', storage: 'invoices', maxBytes: 10485760 }
		])
		expect((await schema.gateway.files(outsider)).map(f => f.property)).toEqual(['invoice'])
	})

	test('S3: upload with the signed URL, keep the key in the row, read it with another', async () => {
		const upload: any = await schema.gateway.fileUpload(editor, 'Products', 'photo', { name: 'chai.PNG', type: 'image/png', size: png.length })
		expect(upload.key).toMatch(/^shop\/Products\/photo\/[0-9a-f-]{36}\.png$/)
		expect((await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: png })).status).toBe(200)
		await schema.gateway.execute(editor, { query: 'Products.update(p => ({ photo: k })).filter(p => p.id == 1)', data: { k: upload.key } })
		const { url } = await schema.gateway.fileUrl(reader, 'Products', 'photo', upload.key)
		const got = await fetch(url)
		expect(got.status).toBe(200)
		expect(Buffer.from(await got.arrayBuffer())).toEqual(png)
		// a key no row of its view has: not signed
		await expect(schema.gateway.fileUrl(reader, 'Products', 'photo', 'shop/Products/photo/another.png')).rejects.toMatchObject({ status: 404 })
		// a view without the property: refused
		await expect(schema.gateway.fileUrl(outsider, 'Products', 'photo', upload.key)).rejects.toMatchObject({ status: 403, name: 'ViewError' })
	})

	test('what the storage takes: its types, its size; only with write; a property that keeps no files', async () => {
		await expect(schema.gateway.fileUpload(editor, 'Products', 'photo', { name: 'x.gif', type: 'image/gif', size: 10 })).rejects.toMatchObject({ status: 415 })
		await expect(schema.gateway.fileUpload(editor, 'Products', 'photo', { name: 'x.png', type: 'image/png', size: 2048 })).rejects.toMatchObject({ status: 413 })
		await expect(schema.gateway.fileUpload(reader, 'Products', 'photo', { name: 'x.png', type: 'image/png', size: 10 })).rejects.toMatchObject({ status: 403 })
		await expect(schema.gateway.fileUpload(editor, 'Products', 'name', { name: 'x.png', type: 'image/png', size: 10 })).rejects.toMatchObject({ status: 404 })
	})

	test('Azure Blob: upload, keep, read', async () => {
		const pdf = Buffer.from('%PDF-1.7 invoice')
		const upload: any = await schema.gateway.fileUpload(editor, 'Products', 'invoice', { name: 'inv.pdf', type: 'application/pdf', size: pdf.length })
		expect((await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: pdf })).status).toBe(201)
		await schema.gateway.execute(editor, { query: 'Products.update(p => ({ invoice: k })).filter(p => p.id == 1)', data: { k: upload.key } })
		const got = await fetch((await schema.gateway.fileUrl(outsider, 'Products', 'invoice', upload.key)).url)
		expect(got.status).toBe(200)
		expect(Buffer.from(await got.arrayBuffer()).toString()).toBe('%PDF-1.7 invoice')
	})
})
