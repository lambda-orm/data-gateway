// Evaluation set of the MCP (docs/DATA_GATEWAY_PLAN.md, phase 3): questions in natural language over northwind, answered
// by Claude through the MCP of a running gateway, compared with the result of a reference query. See eval/README.md.
//
//   npx tsx eval/run.ts            run every question (needs Anthropic credentials)
//   npx tsx eval/run.ts --check    no model: run the references, check the grader against them and the setup/cleanup
//   npx tsx eval/run.ts --only id1,id2
import fs from 'fs'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

interface QueryRef { query: string, data?: Record<string, unknown> }
interface Question {
	id: string
	question: string
	reference: QueryRef & { columns?: string[] }
	compare?: 'set' | 'ordered'
	write?: boolean
	setup?: QueryRef
	/** A write that answers it: --check runs it to test setup, reference, expected and cleanup */
	solution?: QueryRef
	expected?: Record<string, unknown>[]
	cleanup?: { query: string, delete: string }
}
interface Outcome {
	id: string
	correct: boolean
	toolCalls: number
	toolErrors: number
	answer?: unknown
	expected?: unknown
	reason?: string
	inputTokens: number
	outputTokens: number
	seconds: number
}

const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const REST = env('EVAL_REST_URL', 'http://127.0.0.1:58090')
const MCP = env('EVAL_MCP_URL', 'http://127.0.0.1:58091/mcp')
const MODEL = env('EVAL_MODEL', 'claude-opus-5-5')
const EFFORT = env('EVAL_EFFORT', 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max'
const MAX_TURNS = Number(env('EVAL_MAX_TURNS', '12'))
const KEYS = { reader: 'eval-reader', writer: 'eval-writer', runner: 'eval-runner' }

const SYSTEM = 'You answer questions about a database through the tools of a λORM data gateway (MCP). ' +
	'Find the answer with the tools, then call submit_answer once with the rows of the answer: one object per row, with ' +
	'the fields the question asks for (a single value is one row with one field). Do not answer in text.'

const SUBMIT: Anthropic.Beta.BetaTool = {
	name: 'submit_answer',
	description: 'Submit the final answer: the rows (one object per row, with the fields the question asks for).',
	input_schema: {
		type: 'object',
		properties: { rows: { type: 'array', items: { type: 'object' }, description: 'The rows of the answer' } },
		required: ['rows'],
		additionalProperties: false
	},
	strict: true
}

// ─── the gateway (REST, with the runner credential) ─────────────────────────

const execute = async (ref: QueryRef): Promise<any> => {
	const res = await fetch(`${REST}/execute`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-api-key': KEYS.runner },
		body: JSON.stringify({ query: ref.query, data: ref.data ?? {} })
	})
	const body = await res.json()
	if (!res.ok) throw new Error(`${ref.query}: ${res.status} ${JSON.stringify(body)}`)
	return body
}

const cleanup = async (q: Question): Promise<void> => {
	if (!q.cleanup) return
	for (const row of await execute({ query: q.cleanup.query })) await execute({ query: q.cleanup.delete, data: row })
}

// ─── grading ─────────────────────────────────────────────────────────────────

/** Values compared loosely: numbers to 2 decimals (numeric strings too), trimmed lower case text, dates by day */
const normalize = (value: unknown): string => {
	if (value === null || value === undefined) return 'null'
	if (typeof value === 'boolean') return value ? '1' : '0'
	if (typeof value === 'number') return (Math.round(value * 100) / 100).toString()
	const text = String(value).trim()
	if (/^-?\d+(\.\d+)?$/.test(text)) return normalize(Number(text))
	if (/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(text)) return text.slice(0, 10)
	return text.toLowerCase()
}

const values = (row: unknown): string[] =>
	typeof row === 'object' && row !== null ? Object.values(row).map(normalize) : [normalize(row)]

/** Every expected value is in the answer row (the model may add fields) */
const rowMatches = (expected: unknown, actual: unknown): boolean => {
	const pool = values(actual)
	return values(expected).every(value => {
		const i = pool.indexOf(value)
		if (i < 0) return false
		pool.splice(i, 1)
		return true
	})
}

export const grade = (expected: unknown[], actual: unknown, ordered: boolean): string | undefined => {
	if (!Array.isArray(actual)) return 'the answer is not a list of rows'
	if (actual.length !== expected.length) return `${actual.length} rows, expected ${expected.length}`
	if (ordered) {
		const i = expected.findIndex((row, i) => !rowMatches(row, actual[i]))
		return i < 0 ? undefined : `row ${i + 1} differs`
	}
	const pool = [...actual]
	for (const row of expected) {
		const i = pool.findIndex(candidate => rowMatches(row, candidate))
		if (i < 0) return `no row matches ${JSON.stringify(row)}`
		pool.splice(i, 1)
	}
	return undefined
}

const project = (rows: any[], columns?: string[]): any[] =>
	columns ? rows.map(row => Object.fromEntries(columns.map(c => [c, row[c]]))) : rows

const expectedOf = async (q: Question): Promise<unknown[]> => q.write ? q.expected ?? [] : project(await execute(q.reference), q.reference.columns)

// ─── the agent ──────────────────────────────────────────────────────────────

const connect = async (key: string): Promise<Client> => {
	const client = new Client({ name: 'data-gateway-eval', version: '1.0.0' })
	await client.connect(new StreamableHTTPClientTransport(new URL(MCP), { requestInit: { headers: { 'x-api-key': key } } }))
	return client
}

const ask = async (anthropic: Anthropic, mcp: Client, q: Question): Promise<Omit<Outcome, 'correct' | 'expected' | 'seconds'>> => {
	const { tools } = await mcp.listTools()
	const resource = await mcp.readResource({ uri: 'lambdaorm://guide/expressions' })
	const guide = (resource.contents[0] as { text: string }).text
	const definitions: Anthropic.Beta.BetaTool[] = [
		...tools.map(t => ({ name: t.name, description: t.description ?? '', input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema })),
		SUBMIT
	]
	const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: q.question }]
	const outcome = { id: q.id, toolCalls: 0, toolErrors: 0, inputTokens: 0, outputTokens: 0 } as Omit<Outcome, 'correct' | 'expected' | 'seconds'>
	for (let turn = 0; turn < MAX_TURNS; turn++) {
		const response = await anthropic.beta.messages.create({
			model: MODEL,
			max_tokens: 16000,
			betas: ['server-side-fallback-2026-07-01'],
			fallbacks: 'default',
			thinking: { type: 'adaptive' },
			output_config: { effort: EFFORT },
			// the guide is the resource a client would give the model: stable, so it is cached with the tools
			system: [{ type: 'text', text: `${SYSTEM}\n\n${guide}`, cache_control: { type: 'ephemeral' } }],
			tools: definitions,
			messages
		})
		outcome.inputTokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0)
		outcome.outputTokens += response.usage.output_tokens
		if (response.stop_reason === 'refusal') return { ...outcome, reason: `refusal (${response.stop_details?.category ?? 'no category'})` }
		messages.push({ role: 'assistant', content: response.content })
		if (response.stop_reason === 'pause_turn') continue
		const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
		if (uses.length === 0) {
			messages.push({ role: 'user', content: 'Call submit_answer with the rows of the answer.' })
			continue
		}
		const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
		for (const use of uses) {
			if (use.name === 'submit_answer') return { ...outcome, answer: (use.input as { rows: unknown }).rows }
			outcome.toolCalls++
			try {
				const result = await mcp.callTool({ name: use.name, arguments: use.input as Record<string, unknown> })
				if (result.isError) outcome.toolErrors++
				const text = (result.content as { type: string, text?: string }[]).map(c => c.text ?? '').join('\n')
				results.push({ type: 'tool_result', tool_use_id: use.id, content: text, is_error: Boolean(result.isError) })
			} catch (error: any) {
				outcome.toolErrors++
				results.push({ type: 'tool_result', tool_use_id: use.id, content: String(error?.message ?? error), is_error: true })
			}
		}
		messages.push({ role: 'user', content: results })
	}
	return { ...outcome, reason: `no answer in ${MAX_TURNS} turns` }
}

// ─── run ─────────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
	const args = process.argv.slice(2)
	const check = args.includes('--check')
	const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : undefined
	const questions: Question[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'))
		.filter((q: Question) => !only || only.includes(q.id))
	const anthropic = check ? undefined : new Anthropic()
	const outcomes: Outcome[] = []
	for (const q of questions) {
		const started = Date.now()
		await cleanup(q)
		if (q.setup) await execute(q.setup)
		let result: Omit<Outcome, 'correct' | 'expected' | 'seconds'>
		let expected: unknown[]
		try {
			if (check) {
				// the reference (or, for a write, the expected rows) must pass its own grader
				if (q.solution) await execute(q.solution)
				expected = await expectedOf(q)
				result = { id: q.id, toolCalls: 0, toolErrors: 0, inputTokens: 0, outputTokens: 0, answer: q.write ? await execute(q.reference) : expected }
				if (expected.length === 0) result.reason = 'the reference returns no rows'
				if (q.write && !q.solution) result.reason = 'a write question needs a solution'
			} else {
				const mcp = await connect(q.write ? KEYS.writer : KEYS.reader)
				try {
					result = await ask(anthropic!, mcp, q)
				} finally {
					await mcp.close()
				}
				expected = await expectedOf(q)
			}
			// a write is checked in the database, not in what the model says
			const actual = q.write ? (check ? result.answer : await execute(q.reference)) : result.answer
			const reason = result.reason ?? grade(expected, actual, q.compare === 'ordered')
			outcomes.push({ ...result, correct: reason === undefined, reason, expected, seconds: (Date.now() - started) / 1000 })
		} finally {
			await cleanup(q)
		}
		const last = outcomes[outcomes.length - 1]
		console.log(`${last.correct ? 'PASS' : 'FAIL'} ${q.id}  calls ${last.toolCalls}, errors ${last.toolErrors}${last.reason ? `  — ${last.reason}` : ''}`)
	}
	const total = outcomes.length
	const firstTry = outcomes.filter(o => o.correct && o.toolErrors === 0).length
	const withRetries = outcomes.filter(o => o.correct && o.toolErrors <= 2).length
	const summary = {
		model: check ? 'check' : MODEL,
		effort: EFFORT,
		total,
		firstTry: `${firstTry}/${total} (${Math.round(100 * firstTry / total)}%)`,
		withUpToTwoRetries: `${withRetries}/${total} (${Math.round(100 * withRetries / total)}%)`,
		targets: 'first try ≥ 80%, with up to two retries ≥ 95%',
		inputTokens: outcomes.reduce((s, o) => s + o.inputTokens, 0),
		outputTokens: outcomes.reduce((s, o) => s + o.outputTokens, 0)
	}
	console.log(JSON.stringify(summary, null, 2))
	const dir = path.join(__dirname, 'results')
	fs.mkdirSync(dir, { recursive: true })
	const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}${check ? '-check' : ''}.json`)
	fs.writeFileSync(file, JSON.stringify({ summary, outcomes }, null, 2))
	console.log(`results: ${file}`)
	if (check && outcomes.some(o => !o.correct)) process.exitCode = 1
}

if (require.main === module) {
	main().catch(error => {
		console.error(error)
		process.exitCode = 1
	})
}
