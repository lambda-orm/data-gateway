import type * as Monaco from 'monaco-editor'
import { QUERYABLE_DECLARATIONS } from './queryableDeclarations.generated'

export type MonacoApi = typeof Monaco

/**
 * TypeScript diagnostics that don't apply to a λORM query: names that come in "data" (2304 cannot find name, 2552
 * did you mean), an expression statement (2349, 7027 unreachable), comparisons of different types (2367).
 */
const IGNORED_DIAGNOSTICS = [2304, 2552, 2582, 7027, 2367, 1375, 1378, 80001, 80005, 6133]

let loading: Promise<MonacoApi> | undefined
let typingsLib: Monaco.IDisposable | undefined

/**
 * Monaco, loaded on first use (it is large, and the package must load where there is no browser). The application
 * gives the workers (MonacoEnvironment); see the README. The TypeScript service knows Queryable and the functions.
 */
export const loadMonaco = (): Promise<MonacoApi> => {
	if (!loading) {
		loading = import('monaco-editor').then(monaco => {
			const ts = monaco.languages.typescript.typescriptDefaults
			ts.setCompilerOptions({
				target: monaco.languages.typescript.ScriptTarget.ES2020,
				allowNonTsExtensions: true,
				noLib: false,
				lib: ['es2020'],
				strict: false
			})
			ts.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore: IGNORED_DIAGNOSTICS })
			ts.addExtraLib(QUERYABLE_DECLARATIONS, 'ts:lambdaorm/queryable.d.ts')
			return monaco
		})
	}
	return loading
}

/** The domain of the chosen schema (GET /{schema}/typings): replaces the previous one */
export const setSchemaTypings = async (typings: string | undefined): Promise<void> => {
	const monaco = await loadMonaco()
	typingsLib?.dispose()
	typingsLib = typings ? monaco.languages.typescript.typescriptDefaults.addExtraLib(typings, 'ts:lambdaorm/schema.d.ts') : undefined
}
