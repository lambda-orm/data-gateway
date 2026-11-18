import fs from 'fs'
import path from 'path'

/**
 * The Queryable declarations of @lambdaorm/base (its build) as globals, the way the UI gives them to Monaco: without
 * imports (the types they bring are any) and without `export`.
 */
export const globalQueryableDeclarations = (): string => {
	const file = path.join(__dirname, '../../../base/build/lib/repository/domain/queryable.d.ts')
	const text = fs.readFileSync(file, 'utf8')
	const imported = [...text.matchAll(/^import \{([^}]+)\} from .*$/gm)].flatMap(m => m[1].split(',').map(s => s.trim()).filter(Boolean))
	return imported.map(name => `type ${name} = any`).join('\n') + '\n' +
		text.replace(/^import .*$/gm, '').replace(/^export declare /gm, 'declare ').replace(/^export /gm, '')
}
