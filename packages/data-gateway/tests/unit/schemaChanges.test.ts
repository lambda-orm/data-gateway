// What λORM changes in a schema (pull, introspect), written back keeping the comments, and shown as a diff
// (docs/DATA_GATEWAY_ADMIN_PLAN.md §4, phase 3b).
import YAML from 'yaml'
import { mergeIntoYaml } from '../../src/lib/infrastructure/output/admin/yamlMerge'
import { lineDiff } from '../../src/lib/domain/admin/lineDiff'
import fs from 'fs'
import path from 'path'

const TEXT = `# the schema of the shop
domain:
  entities:
    # what is sold
    - name: Products
      primaryKey: [id]
      properties:
        - name: id
          type: integer # the key
        - name: name
          type: string
    - name: Categories # their kinds
      properties:
        - {name: id, type: integer}
infrastructure:
  sources:
    - name: main
      connection: \${SHOP_CNX} # from .env
`

describe('the schema changed by λORM, written back', () => {
	test('a property added and another changed: the comments, the order and the flow style of the rest stay', () => {
		const value = YAML.parse(TEXT)
		value.domain.entities[0].properties[1].length = 80
		value.domain.entities[0].properties.push({ name: 'price', type: 'decimal' })
		value.domain.entities.push({ name: 'Suppliers', primaryKey: ['id'], properties: [{ name: 'id', type: 'integer' }] })
		const merged = mergeIntoYaml(TEXT, value)
		for (const comment of ['# the schema of the shop', '# what is sold', '# the key', '# their kinds', '# from .env']) expect(merged).toContain(comment)
		expect(merged).toContain('primaryKey: [id]')
		expect(merged).toContain('- {name: id, type: integer}')
		expect(merged).toContain('connection: ${SHOP_CNX}')
		expect(YAML.parse(merged)).toEqual(value)
	})

	test('the padding of [a] and { a } that the file uses', () => {
		const padded = 'domain:\n  entities:\n    - { name: A, primaryKey: [ id ] }\n'
		const value = YAML.parse(padded)
		value.domain.entities.push({ name: 'B', primaryKey: ['id'] })
		expect(mergeIntoYaml(padded, value)).toContain('- { name: A, primaryKey: [ id ] }')
	})

	test('an entity removed (pull with removeEntities) and the items paired by name, not by place', () => {
		const value = YAML.parse(TEXT)
		value.domain.entities = [value.domain.entities[1], value.domain.entities[0]].filter(e => e.name !== 'Categories')
		const merged = mergeIntoYaml(TEXT, value)
		expect(merged).not.toContain('Categories')
		expect(merged).toContain('# the key')
		expect(YAML.parse(merged)).toEqual(value)
	})

	test('Ilusor\'s schema (10k lines): unchanged it is written byte for byte; one property changed, one line of diff', () => {
		const text = fs.readFileSync(path.join(__dirname, '../fixtures/ilusor/lambdaORM.yaml'), 'utf8')
		const value = YAML.parse(text)
		expect(lineDiff(text, mergeIntoYaml(text, value))).toMatchObject({ added: 0, removed: 0 })
		const areas = value.domain.entities.find((e: any) => e.name === 'Areas')
		areas.properties.find((p: any) => p.name === 'name').length = 120
		const diff = lineDiff(text, mergeIntoYaml(text, value))
		expect(diff.removed).toBeLessThanOrEqual(1)
		expect(diff.added).toBeLessThanOrEqual(2)
	})

	test('the diff: only the lines that changed, with their context and line numbers', () => {
		const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
		const after = before.replace('line 10', 'line ten').replace('line 25', 'line 25\nline 25b')
		const diff = lineDiff(before, after, 2)
		expect(diff).toMatchObject({ added: 2, removed: 1 })
		expect(diff.hunks).toHaveLength(2)
		expect(diff.hunks[0]).toMatchObject({ oldStart: 8, newStart: 8 })
		expect(diff.hunks[0].lines.map(l => `${l.op}${l.text}`)).toEqual([' line 8', ' line 9', '-line 10', '+line ten', ' line 11', ' line 12'])
		expect(diff.hunks[1].lines.filter(l => l.op === '+').map(l => l.text)).toEqual(['line 25b'])
		expect(lineDiff('a\nb', 'a\nb')).toEqual({ added: 0, removed: 0, hunks: [] })
	})
})
