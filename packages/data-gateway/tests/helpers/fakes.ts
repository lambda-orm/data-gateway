// Fakes of the output ports: the application and the transports are tested without λORM nor a database.
import { DataGateway } from '../../src/lib/application/facade/dataGateway'
import { OrmQueryPort, OrmSchemaPort, OrmScriptPort, OrmStagePort } from '../../src/lib/application/ports/output/ormPorts'
import { AuditPort, ClockPort, QueueExecuteArgs, QueueOutcome, QueuePort } from '../../src/lib/application/ports/output/supportPorts'
import { Listeners } from '../../src/lib/application/runtime/listeners'
import { Auditor } from '../../src/lib/application/usecases/auditor'
import { QueryUseCases } from '../../src/lib/application/usecases/queryUseCases'
import { QueueUseCase } from '../../src/lib/application/usecases/queueUseCase'
import { SchemaUseCases, StageUseCases } from '../../src/lib/application/usecases/schemaUseCases'
import { ScriptSettings, ScriptUseCase } from '../../src/lib/application/usecases/scriptUseCase'
import { AuditEntry } from '../../src/lib/domain/audit/auditEntry'
import { Permission } from '../../src/lib/domain/auth/permission'
import { principal } from '../../src/lib/domain/auth/principal'
import { RequestContext } from '../../src/lib/application/ports/input/dataGatewayPort'

const WRITE = /\.(insert|update|delete|upsert|merge|bulkInsert|bulkDelete|bulkMerge)\(/

/** A sentence tree like orm.metadata answers: root sentence plus one child per include, action read from the query */
export const fakeMetadata = (query: string): any => {
	const [root, ...includes] = query.split('.include(')
	const sentence = (text: string): any => ({
		classtype: 'Sentence',
		name: (WRITE.exec(text)?.[1]) ?? 'select',
		entity: text.trim().split('.')[0].replace(/^[^A-Za-z]*/, ''),
		children: []
	})
	const node = sentence(root)
	node.children = includes.map(text => ({ ...sentence(text), entity: `${node.entity}.include` }))
	return node
}

export class FakeOrm implements OrmQueryPort, OrmScriptPort, OrmSchemaPort, OrmStagePort {
	public executed: { query: string, data?: unknown, options?: unknown }[] = []
	public scripts: { script: string, data?: unknown, options?: unknown }[] = []
	public planned: { query: string, options?: unknown }[] = []
	public executeResult: any = [{ id: 1 }]
	public scriptResult: any = 7
	public executeDelayMs = 0
	public imported: { stage: string, data: unknown }[] = []

	public async execute (query: string, data?: unknown, options?: unknown) {
		this.executed.push({ query, data, options })
		if (this.executeDelayMs) await new Promise(resolve => setTimeout(resolve, this.executeDelayMs))
		if (this.executeResult instanceof Error) throw this.executeResult
		return this.executeResult
	}

	public async plan (query: string, options?: unknown) {
		this.planned.push({ query, options })
		return { entity: query.split('.')[0], dialect: 'PostgreSQL', source: 'main', sentence: 'SELECT 1' }
	}

	public async metadata (query: string, _options?: unknown) { return fakeMetadata(query) }
	public async model (_query?: string, _options?: unknown) { return [{ name: 'id', type: 'integer' }] as any }
	public async parameters () { return [{ name: 'id', type: 'integer' }] as any }
	public async constraints () { return { entity: 'Products', constraints: [] } as any }
	public async executeScript (script: string, data?: unknown, options?: unknown) {
		this.scripts.push({ script, data, options })
		return this.scriptResult
	}

	public check () {}
	public version () { return { version: '1.0.0' } }
	public domain (_view?: string) { return { entities: [{ name: 'Products' }], enums: [] } as any }
	public sources () { return [{ name: 'main', dialect: 'PostgreSQL' }] }
	public source (name: string) { return name === 'main' ? { name: 'main', dialect: 'PostgreSQL' } : undefined }
	public entities (_view?: string) { return [{ name: 'Products' }] as any }
	public entity (name: string) { return name === 'Products' ? { name } as any : undefined }
	public enums () { return [] }
	public enum () { return undefined }
	public mappings () { return [{ name: 'default' }] as any }
	public mapping (name: string) { return name === 'default' ? { name } as any : undefined }
	public entityMapping () { return undefined }
	public stages () { return [{ name: 'default' }] as any }
	public stage (name: string) { return name === 'default' ? { name } as any : undefined }
	public views () { return ['default'] }
	public async exists () { return true }
	public async export () { return { entities: [] } as any }
	public async import (stage: string, data: unknown) { this.imported.push({ stage, data }) }
}

export class MemoryAudit implements AuditPort {
	public entries: AuditEntry[] = []
	public write (entry: AuditEntry) { this.entries.push(entry) }
}

export class FixedClock implements ClockPort {
	private time = Date.parse('2026-11-17T12:00:00.000Z')
	public now () { const now = new Date(this.time); this.time += 5; return now }
	public uptimeSeconds () { return 42 }
}

export class FakeQueue implements QueuePort {
	public available = true
	public calls: QueueExecuteArgs[] = []
	public execute (args: QueueExecuteArgs) { this.calls.push(args); return `queue-${this.calls.length}` }
	/** The background execution n (from 1) ends */
	public finish (n: number, ok = true) {
		this.calls[n - 1].onDone?.({ queueId: `queue-${n}`, ok, ...(ok ? { rows: 3 } : { error: 'topic down' }) })
	}
}

export const ctx = (permissions: Permission[], name = 'tester', transport = 'test'): RequestContext =>
	({ principal: principal(name, permissions), transport })

export const ALL: Permission[] = ['read', 'write', 'script', 'queue', 'stageImport']

export interface GatewayFixture {
	gateway: DataGateway
	orm: FakeOrm
	audit: MemoryAudit
	queue: FakeQueue
	/** The ends of the background executions, as the edge receives them */
	queueOutcomes: Listeners<QueueOutcome>
}

export const fakeGateway = (options: { scripts?: Partial<ScriptSettings>, timeoutMs?: number, includeData?: boolean, auditEnabled?: boolean, queue?: FakeQueue | null } = {}): GatewayFixture => {
	const orm = new FakeOrm()
	const audit = new MemoryAudit()
	const clock = new FixedClock()
	const queue = options.queue === null ? undefined : options.queue ?? new FakeQueue()
	const auditor = new Auditor(audit, clock, '', { enabled: options.auditEnabled ?? true, includeData: options.includeData ?? false })
	const queueOutcomes = new Listeners<QueueOutcome>()
	const queries = new QueryUseCases(orm, auditor)
	const scripts: ScriptSettings = { enabled: true, maxLength: 20000, timeoutMs: 30000, maxIterations: 100000, ...options.scripts }
	const gateway = new DataGateway({
		queries,
		script: new ScriptUseCase(orm, scripts, auditor),
		queue: new QueueUseCase(queue, queries, auditor, { completed: outcome => queueOutcomes.emit(outcome) }),
		schema: new SchemaUseCases(orm),
		stages: new StageUseCases(orm, auditor)
	}, orm, clock, '9.9.9', options.timeoutMs ?? 5000)
	return { gateway, orm, audit, queue: queue ?? new FakeQueue(), queueOutcomes }
}
