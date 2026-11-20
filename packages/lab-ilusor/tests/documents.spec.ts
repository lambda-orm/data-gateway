// Documents in FerretDB (MongoDB API) next to Postgres, as Ilusor's Cloud keeps its quotes and installation reports
// (docs/LAMBDAORM_PENDING.md L35, L37). Own model (tests/documents/lambdaORM.yaml): a Postgres table in schema lab_docs
// and a FerretDB collection. FerretDB has no transactions: the source says so (`transactions: false`); UUIDs are
// written as binary subtype 4 (`uuid: binary`) and decimals as Decimal128 (`decimal: decimal128`), as other drivers
// (pymongo with uuidRepresentation=standard) write them.
import path from 'path'
import { randomUUID } from 'crypto'
import { Client } from 'pg'
import { Orm } from '../../../../lib'
import { newOrm } from './helpers'

const pgAdmin = { host: '127.0.0.1', port: 55432, user: 'admin', password: 'admin', database: 'ilusor' }
const mongoUrl = 'mongodb://admin:admin@127.0.0.1:57017/?authMechanism=SCRAM-SHA-256'
process.env.ORM_DOCS_CNX = JSON.stringify({ ...pgAdmin, options: '-c search_path=lab_docs' })
process.env.ORM_DOCUMENTS_CNX = JSON.stringify({ url: mongoUrl, database: 'lab', transactions: false, uuid: 'binary', decimal: 'decimal128' })
// a UUIDv7, as Ilusor's ids (the driver 4 UUID class rejects versions above 5)
const uuid7 = () => { const u = randomUUID(); return u.slice(0, 14) + '7' + u.slice(15) }

describe('documents', () => {
	let orm: Orm
	let mongo: any
	beforeAll(async () => {
		const c = new Client(pgAdmin)
		await c.connect()
		await c.query(`CREATE SCHEMA IF NOT EXISTS lab_docs;
			CREATE TABLE IF NOT EXISTS lab_docs.doc_installations (id uuid PRIMARY KEY, number varchar(32) NOT NULL, quote_id uuid)`)
		await c.end()
		const { MongoClient } = require('mongodb')
		mongo = await MongoClient.connect(mongoUrl)
		orm = await newOrm(path.join(__dirname, 'documents', 'lambdaORM.yaml'))
	})
	afterAll(async () => { await orm.end(); await mongo.close() })

	const newQuote = async () => {
		const id = uuid7()
		await orm.execute('DocQuotes.insert()', { id, number: 'PRE-' + id.slice(0, 8), companyId: uuid7(), total: '329.31', lines: [{ description: 'Sensor', net: '12.50' }] })
		return id
	}

	test('L37 a UUID is written as binary subtype 4 and a decimal as Decimal128', async () => {
		const id = await newQuote()
		const raw = await mongo.db('lab').collection('quotes').findOne({ number: 'PRE-' + id.slice(0, 8) })
		expect(raw._id._bsontype).toBe('Binary')
		expect(raw._id.sub_type).toBe(4)
		expect(raw.companyId.sub_type).toBe(4)
		expect(raw.total._bsontype).toBe('Decimal128')
	})

	test('L37 read back: the UUID and the Decimal128 as text, a filter by UUID finds it', async () => {
		const id = await newQuote()
		const [quote] = await orm.execute('DocQuotes.filter(p => p.id == id)', { id })
		expect(quote.id).toBe(id)
		expect(typeof quote.companyId).toBe('string')
		expect(quote.total).toBe('329.31')
	})

	test('L35 + L37 include Postgres → FerretDB and FerretDB → Postgres (no transaction)', async () => {
		const quoteId = await newQuote()
		const installationId = uuid7()
		await orm.execute('DocInstallations.insert()', { id: installationId, number: 'INS-' + installationId.slice(0, 8), quoteId })
		const [installation] = await orm.execute('DocInstallations.filter(p => p.id == id).include(p => p.quote)', { id: installationId })
		expect(installation.quote.id).toBe(quoteId)
		const [quote] = await orm.execute('DocQuotes.filter(p => p.id == id).include(p => p.installationRef)', { id: quoteId })
		expect(quote.installationRef.id).toBe(installationId)
	})

	test('L35 update and delete of a document without a transaction', async () => {
		const id = await newQuote()
		await orm.execute('DocQuotes.update(p => ({ total: total })).filter(p => p.id == id)', { id, total: '400.00' })
		const [quote] = await orm.execute('DocQuotes.filter(p => p.id == id)', { id })
		expect(quote.total).toBe('400.00')
		await orm.execute('DocQuotes.delete().filter(p => p.id == id)', { id })
		expect(await orm.execute('DocQuotes.filter(p => p.id == id)', { id })).toEqual([])
	})
})
