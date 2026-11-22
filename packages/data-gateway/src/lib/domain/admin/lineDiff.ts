/** A change of a text, line by line, as a unified diff shows it */
export interface DiffLine {
	op: ' ' | '+' | '-'
	text: string
}

export interface DiffHunk {
	/** 1-based, in the old and the new text */
	oldStart: number
	newStart: number
	lines: DiffLine[]
}

export interface LineDiff {
	added: number
	removed: number
	hunks: DiffHunk[]
}

/** Above this many lines changed in the middle, the middle is shown as removed and added (no LCS) */
const MAX_MIDDLE = 4000

/**
 * The lines that changed between two texts, with `context` lines around each change. The common start and end are
 * skipped; the middle is compared with an LCS (a change of a schema is usually small, the schema large).
 */
export const lineDiff = (before: string, after: string, context = 3): LineDiff => {
	const all = diffOps(before.split('\n'), after.split('\n'))
	return hunksOf(all, context)
}

/** Every line of both texts in order: kept, removed or added */
export const diffOps = (a: string[], b: string[]): DiffLine[] => {
	let start = 0
	while (start < a.length && start < b.length && a[start] === b[start]) start++
	let endA = a.length
	let endB = b.length
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
	const midA = a.slice(start, endA)
	const midB = b.slice(start, endB)
	const ops: DiffLine[] = []
	if (midA.length * midB.length > MAX_MIDDLE * MAX_MIDDLE / 4 || midA.length > MAX_MIDDLE || midB.length > MAX_MIDDLE) {
		ops.push(...midA.map(text => ({ op: '-' as const, text })), ...midB.map(text => ({ op: '+' as const, text })))
	} else {
		// lcs[i][j]: the longest common lines of midA[i..] and midB[j..]
		const lcs: Uint32Array[] = Array.from({ length: midA.length + 1 }, () => new Uint32Array(midB.length + 1))
		for (let i = midA.length - 1; i >= 0; i--) {
			for (let j = midB.length - 1; j >= 0; j--) {
				lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
			}
		}
		let i = 0
		let j = 0
		while (i < midA.length || j < midB.length) {
			// what goes out before what comes in, as a unified diff shows it
			if (i < midA.length && j < midB.length && midA[i] === midB[j]) { ops.push({ op: ' ', text: midA[i] }); i++; j++ } else if (i < midA.length && (j === midB.length || lcs[i + 1][j] >= lcs[i][j + 1])) { ops.push({ op: '-', text: midA[i] }); i++ } else { ops.push({ op: '+', text: midB[j] }); j++ }
		}
	}
	// the whole sequence, with the common start and end as context
	return [...a.slice(0, start).map(text => ({ op: ' ' as const, text })), ...ops, ...a.slice(endA).map(text => ({ op: ' ' as const, text }))]
}

const hunksOf = (all: DiffLine[], context: number): LineDiff => {
	const hunks: DiffHunk[] = []
	let oldLine = 1
	let newLine = 1
	let current: DiffHunk | undefined
	let lastChange = -Infinity
	all.forEach((line, k) => {
		const changed = line.op !== ' '
		if (changed) {
			if (!current || k - lastChange > 2 * context) {
				const from = Math.max(0, k - context)
				const before = all.slice(from, k)
				current = { oldStart: oldLine - before.filter(l => l.op !== '+').length, newStart: newLine - before.filter(l => l.op !== '-').length, lines: [...before] }
				hunks.push(current)
			} else {
				current.lines.push(...all.slice(lastChange + 1, k))
			}
			current.lines.push(line)
			lastChange = k
		}
		if (line.op !== '+') oldLine++
		if (line.op !== '-') newLine++
	})
	// the context after the last change of each hunk
	for (const hunk of hunks) {
		const lastIndex = all.indexOf(hunk.lines[hunk.lines.length - 1])
		hunk.lines.push(...all.slice(lastIndex + 1, lastIndex + 1 + context).filter(l => l.op === ' '))
	}
	return { added: all.filter(l => l.op === '+').length, removed: all.filter(l => l.op === '-').length, hunks }
}
