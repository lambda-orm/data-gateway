// Hexagonal layers (docs/DATA_GATEWAY_PLAN.md §2): dependencies point inwards. Checked on every import of src/lib.
import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '../../src/lib')

const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
	entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.ts') ? [path.join(dir, entry.name)] : [])

/** Every module a file imports (import … from / require), relative ones resolved to a path inside src/lib */
const imports = (file: string): string[] => {
	const text = fs.readFileSync(file, 'utf8')
	const specifiers = [...text.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g)].map(m => m[1])
	return specifiers.map(s => s.startsWith('.') ? path.relative(SRC, path.resolve(path.dirname(file), s)) : s)
}

const layer = (file: string): string => path.relative(SRC, file).split(path.sep).slice(0, 2).join('/')

const violations = (files: string[], forbidden: (specifier: string) => boolean): string[] =>
	files.flatMap(file => imports(file).filter(forbidden).map(specifier => `${path.relative(SRC, file)} → ${specifier}`))

describe('architecture', () => {
	const all = files(SRC)
	const domain = all.filter(f => layer(f).startsWith('domain'))
	const application = all.filter(f => layer(f).startsWith('application'))
	const input = all.filter(f => layer(f) === 'infrastructure/input')
	const isExternal = (s: string) => !s.startsWith('domain') && !s.startsWith('application') && !s.startsWith('infrastructure')

	test('there is something to check', () => {
		expect(domain.length).toBeGreaterThan(3)
		expect(application.length).toBeGreaterThan(3)
		expect(input.length).toBeGreaterThan(1)
	})

	test('domain depends on nothing but @lambdaorm/base types', () => {
		expect(violations(domain, s => s.startsWith('application') || s.startsWith('infrastructure') || (isExternal(s) && s !== '@lambdaorm/base'))).toEqual([])
	})

	test('application depends on domain, its ports and @lambdaorm/base types only (no λORM, express, fs, …)', () => {
		expect(violations(application, s => s.startsWith('infrastructure') || (isExternal(s) && s !== '@lambdaorm/base'))).toEqual([])
	})

	test('transports (input adapters) do not know the output adapters', () => {
		expect(violations(input, s => s.startsWith('infrastructure/output'))).toEqual([])
	})
})
