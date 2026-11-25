// The conformance suite (packages/conformance) with this client: every case on the five transports, through
// the public API of the client. `npm run conformance` with the environment of the suite up.
import { connect, DataGatewayClient, GatewayError } from '../src/lib'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore the runner of the suite is plain JavaScript
import { CONNECTIONS, check, credentialOf, expectationOf, loadCases, resolve, stepsOf } from '../../conformance/runner/index.mjs'

type Args = Record<string, any>
/** each operation of the cases as the public API of the client does it */
const OPERATIONS: Record<string, (c: DataGatewayClient, a: Args) => Promise<unknown>> = {
	execute: (c, a) => c.execute(a.query, a.data, a.options),
	executeScript: (c, a) => c.executeScript(a.script, a.data, a.options),
	plan: (c, a) => c.plan(a.query, a.options),
	metadata: (c, a) => c.metadata(a.query),
	model: (c, a) => c.model(a.query),
	parameters: (c, a) => c.parameters(a.query),
	constraints: (c, a) => c.constraints(a.query),
	queries: c => c.queries(),
	query: (c, a) => c.query(a.name, a.data, a.options),
	schemaVersion: c => c.schema.version(),
	domain: c => c.schema.domain(),
	entities: c => c.schema.entities(),
	entity: (c, a) => c.schema.entity(a.entity),
	search: (c, a) => c.schema.search(a.text),
	describe: (c, a) => c.schema.describe(a.entities),
	enums: c => c.schema.enums(),
	enum: (c, a) => c.schema.enum(a.enum),
	sources: c => c.schema.sources(),
	source: (c, a) => c.schema.source(a.source),
	mappings: c => c.schema.mappings(),
	mapping: (c, a) => c.schema.mapping(a.mapping),
	stages: c => c.schema.stages(),
	stage: (c, a) => c.schema.stage(a.stage),
	views: c => c.schema.views(),
	stageExists: async (c, a) => ({ exists: await c.stage.exists(a.stage) }),
	stageExport: (c, a) => c.stage.export(a.stage),
	version: c => c.general.version(),
	health: c => c.general.health()
}

const main = async (): Promise<void> => {
	const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }
	const transports: string[] = (arg('--transport') ?? Object.keys(CONNECTIONS).join(',')).split(',')
	const filter = arg('--case')
	const cases = loadCases().filter((c: any) => !filter || c.name.includes(filter))
	const failures: string[] = []
	let passed = 0
	for (const transport of transports) {
		const open: Record<string, DataGatewayClient> = {}
		const client = async (credential: string) => {
			open[credential] ??= await connect(CONNECTIONS[transport], credentialOf(credential))
			return open[credential]
		}
		console.log(`\n${transport}  ${CONNECTIONS[transport]}`)
		for (const testCase of cases) {
			if (testCase.transports && !testCase.transports.includes(transport)) continue
			let problem: string | null = null
			try {
				const results: unknown[] = []
				for (const [i, step] of stepsOf(testCase).entries()) {
					const c = await client(testCase.credential ?? 'reader')
					const outcome: { result?: unknown, error?: GatewayError } = {}
					try {
						outcome.result = await OPERATIONS[step.operation](c, resolve(step.args ?? {}, results, transport))
					} catch (error) {
						if (!(error instanceof GatewayError)) throw error
						outcome.error = error
					}
					results.push(outcome.result)
					problem = check(expectationOf(step, transport, results), outcome)
					if (problem) { problem = `step ${i} (${step.operation}): ${problem}`; break }
				}
			} catch (error: any) {
				problem = `failed to run: ${error.message}`
			}
			if (problem) failures.push(`${transport} ${testCase.name}: ${problem}`)
			else passed++
			console.log(`  ${problem ? '✗' : '✓'} ${testCase.name}${problem ? `\n      ${problem}` : ''}`)
		}
		for (const c of Object.values(open)) await c.close()
	}
	console.log(`\n${passed} passed, ${failures.length} failed (${cases.length} cases × ${transports.length} transports)`)
	process.exit(failures.length ? 1 : 0)
}

main()
