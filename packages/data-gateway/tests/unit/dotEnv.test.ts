// The .env of a workspace edited from the gateway (docs/DATA_GATEWAY_ADMIN_PLAN.md §5): the rest of it stays.
import { dotEnvNames, dotEnvValue, editDotEnv, schemaVariables } from '../../src/lib/domain/admin/dotEnv'
import { parseDotEnv } from '../../src/lib/infrastructure/output/discovery/dotEnvFileReader'

describe('the .env of a workspace', () => {
	const TEXT = '# connections of the shop\nSHOP_CNX={"host":"db"}\nexport TZ=UTC\n\n# old\nOLD=1\n'

	test('a variable set replaces its line or is added; one removed loses its line; comments and order stay', () => {
		const edited = editDotEnv(TEXT, { SHOP_CNX: '{"host":"db2","port":5432}', NEW_ONE: 'x y' }, ['OLD'])
		expect(edited).toBe('# connections of the shop\nSHOP_CNX=\'{"host":"db2","port":5432}\'\nexport TZ=UTC\n\n# old\nNEW_ONE=\'x y\'\n')
		expect(parseDotEnv(edited)).toEqual({ SHOP_CNX: '{"host":"db2","port":5432}', TZ: 'UTC', NEW_ONE: 'x y' })
		expect(dotEnvNames(edited)).toEqual(['SHOP_CNX', 'TZ', 'NEW_ONE'])
		expect(editDotEnv('', { A: '1' }, [])).toBe('A=1\n')
	})

	test('a value is one line, quoted when it needs it', () => {
		expect(dotEnvValue('plain')).toBe('plain')
		expect(dotEnvValue('it\'s "both"'.replace('it\'s', 'its'))).toBe('\'its "both"\'')
		expect(() => dotEnvValue('a\nb')).toThrow(/one line/)
		expect(() => dotEnvValue('it\'s "both"')).toThrow(/both/)
	})

	test('the variables a schema names, with the sources that use them', () => {
		const schema = { infrastructure: { sources: [{ name: 'main', connection: '${SHOP_CNX}' }, { name: 'docs', connection: { url: '${DOCS_URL}' } }] } }
		const found = schemaVariables(schema, 'connection: ${SHOP_CNX}\nurl: ${DOCS_URL}\nkey: ${API_KEY}')
		expect([...found.entries()]).toEqual([['SHOP_CNX', ['main']], ['DOCS_URL', ['docs']], ['API_KEY', []]])
	})
})
