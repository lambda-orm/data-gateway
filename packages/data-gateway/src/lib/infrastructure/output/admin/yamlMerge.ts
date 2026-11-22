import YAML, { Document, isMap, isScalar, isSeq, Node, Pair, Scalar, YAMLMap, YAMLSeq } from 'yaml'
import { diffOps } from '../../../domain/admin/lineDiff'

const isPlainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** The name of an item of a list of the schema (entities, properties, sources…), to pair the old and the new ones */
const nameOf = (node: unknown): unknown => isMap(node) ? (node.get('name', true) as Scalar | undefined)?.value : undefined

/**
 * A node with a new value, reusing what didn't change: maps key by key, lists of named items (entities, properties,
 * relations, sources, stages) by their name, scalars only when their value is another. What is reused keeps its
 * comments and style; only what changed is new.
 */
const update = (doc: Document, node: unknown, value: unknown): Node => {
	if (isPlainObject(value) && isMap(node)) {
		const map = node as YAMLMap
		for (const pair of [...map.items]) {
			const key = isScalar(pair.key) ? pair.key.value : pair.key
			if (typeof key !== 'string' || !(key in value) || value[key] === undefined) map.items.splice(map.items.indexOf(pair), 1)
		}
		for (const [key, child] of Object.entries(value)) {
			if (child === undefined) continue
			const pair = map.items.find(p => (isScalar(p.key) ? p.key.value : p.key) === key) as Pair<unknown, unknown> | undefined
			if (pair) pair.value = update(doc, pair.value, child)
			else map.items.push(doc.createPair(key, child) as Pair<unknown, unknown>)
		}
		return map
	}
	if (Array.isArray(value) && isSeq(node)) {
		const seq = node as YAMLSeq
		const named = value.every(v => isPlainObject(v) && typeof v.name === 'string')
		const old = [...seq.items]
		seq.items = value.map((child, i) => {
			const match = named ? old.find(item => nameOf(item) === (child as any).name) : old[i]
			return match !== undefined ? update(doc, match, child) : doc.createNode(child)
		})
		return seq
	}
	if (isScalar(node) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
		if (node.value !== value) node.value = value
		return node
	}
	return doc.createNode(value) as Node
}

/**
 * The text of a lambdaORM.yaml with the schema that λORM changed (pull, introspect), keeping the comments, the order
 * and the style of what didn't change (λORM writes it with js-yaml, which loses them).
 */
export const mergeIntoYaml = (text: string, value: unknown): string => {
	const doc = YAML.parseDocument(text)
	if (doc.errors.length || !doc.contents) return YAML.stringify(value, { lineWidth: 0 })
	doc.contents = update(doc, doc.contents, value) as any
	// the padding of [a, b] and { a: b } the file already uses (the yaml library has one for both)
	const padded = (text.match(/[[{] \S/g) ?? []).length
	const tight = (text.match(/[[{][^\s\]}]/g) ?? []).length
	// and whether its lists go indented under their key (`entities:` then `  - name`) or in its column (`- name`)
	const lines = text.split('\n')
	let indented = 0
	let inColumn = 0
	lines.forEach((line, i) => {
		const next = lines[i + 1]
		if (!next || !/:\s*$/.test(line) || !/^\s*- /.test(next)) return
		const depth = (s: string) => s.length - s.trimStart().length
		if (depth(next) > depth(line)) indented++
		else if (depth(next) === depth(line)) inColumn++
	})
	// and how wide its lines go before a long one is folded (none folded: no limit)
	const widest = Math.max(0, ...lines.map(l => l.length))
	const folded = lines.some((line, i) => /[[{][^\]}]*,\s*$/.test(line) && /^\s+[^-\s]/.test(lines[i + 1] ?? ''))
	const written = doc.toString({ lineWidth: folded ? widest : 0, flowCollectionPadding: padded > tight, indentSeq: indented >= inColumn })
	return keepUnchangedText(text, written)
}

/** A line with its spaces collapsed: two texts that differ only in how a long line is folded or spaced are the same */
const squeeze = (lines: string[]): string => lines.map(l => l.trim()).join(' ').replace(/\s+/g, ' ').replace(/([[{,:]) /g, '$1').replace(/ ([\]}])/g, '$1')

/**
 * The text written, with the original lines wherever a change is only how they are folded or spaced (a file written by
 * hand folds some long lines and not others: no setting of the writer reproduces it). Only what really changed differs.
 */
export const keepUnchangedText = (original: string, written: string): string => {
	const ops = diffOps(original.split('\n'), written.split('\n'))
	const out: string[] = []
	let k = 0
	while (k < ops.length) {
		if (ops[k].op === ' ') { out.push(ops[k].text); k++; continue }
		// a block of changes: its removed lines and its added lines, in order
		const removed: string[] = []
		const added: string[] = []
		while (k < ops.length && ops[k].op !== ' ') { (ops[k].op === '-' ? removed : added).push(ops[k].text); k++ }
		let i = 0
		let j = 0
		// the same content, folded otherwise: the original lines
		while (i < removed.length && j < added.length) {
			let ii = i
			let jj = j
			let a = squeeze([removed[i]])
			let b = squeeze([added[j]])
			while (a !== b && (a.startsWith(b) || b.startsWith(a))) {
				if (a.length < b.length) { if (++ii >= removed.length) break; a = squeeze(removed.slice(i, ii + 1)) } else { if (++jj >= added.length) break; b = squeeze(added.slice(j, jj + 1)) }
			}
			if (a !== b) break
			out.push(...removed.slice(i, ii + 1))
			i = ii + 1
			j = jj + 1
		}
		out.push(...added.slice(j))
	}
	return out.join('\n')
}
