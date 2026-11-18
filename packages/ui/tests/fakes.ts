import { QueryApiPort } from '../src/application/ports'
import { WhoAmI } from '../src/domain/operations'

export const WHO_READS: WhoAmI = { name: 'agent', permissions: ['read'], schema: 'northwind/v1', scripts: false }
export const WHO_ALL: WhoAmI = { name: 'backend', permissions: ['read', 'write', 'script', 'queue', 'stageImport'], schema: 'northwind/v1', scripts: true }

const named = (name: string, message: string, status?: number) => Object.assign(new Error(message), { name, status })

/** A gateway in memory: Products with three rows; "Nope" doesn't exist */
export class FakeApi implements QueryApiPort {
	public calls: { operation: string, args: unknown[] }[] = []
	public who: WhoAmI = WHO_ALL
	public rows: unknown = [{ id: 1, name: 'Chai' }, { id: 2, name: 'Chang' }, { id: 3, name: 'Aniseed Syrup' }]

	private record (operation: string, ...args: unknown[]) { this.calls.push({ operation, args }) }

	async schemas () { return [{ path: 'northwind/v1', status: 'ready' }, { path: 'northwind/v2', status: 'error', reason: 'down' }] }
	async whoami (schema: string) { this.record('whoami', schema); return { ...this.who, schema } }
	async typings () { return 'declare const Products: Queryable<QryProduct>' }
	private check (query: string) { if (query.includes('Nope')) throw named('SchemaError', 'Entity Nope not found', 400) }
	async plan (schema: string, query: string, options?: unknown) { this.record('plan', schema, query, options); this.check(query); return { entity: 'Products', sentence: 'SELECT 1' } }
	async metadata (schema: string, query: string) { this.record('metadata', schema, query); this.check(query); return { name: 'select' } }
	async model (schema: string, query: string) { this.record('model', schema, query); return [{ name: 'id', type: 'integer' }] }
	async parameters (schema: string, query: string) { this.record('parameters', schema, query); return [{ name: 'minPrice', type: 'decimal' }, { name: 'entity.name', type: 'string' }] }
	async constraints (schema: string, query: string) { this.record('constraints', schema, query); return { entity: 'Products', constraints: [] } }
	async execute (schema: string, query: string, data?: unknown, options?: unknown) { this.record('execute', schema, query, data, options); this.check(query); return this.rows }
	async executeQueued (schema: string, request: unknown) { this.record('executeQueued', schema, request); return 'queue-1' }
	async executeScript (schema: string, script: string, data?: unknown) { this.record('executeScript', schema, script, data); return 7 }
}
