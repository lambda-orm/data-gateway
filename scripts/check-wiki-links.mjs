// Checks the links to the wiki (https://lambda-orm.github.io/wiki/...) of the READMEs against the published site: each
// page must answer 200 and, with an anchor, have that id. A shell assignment (W=https://…/wiki/…) is a base URL, not a
// link, and is skipped. No dependencies (Node 20 or later).
//
//   node scripts/check-wiki-links.mjs            every README.md of the repository
//   node scripts/check-wiki-links.mjs a.md b.md  the given files
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const LINK = /https:\/\/lambda-orm\.github\.io\/wiki(?:\/[^\s)"'<>`\]]*)?/g
const ASSIGNMENT = /\b[A-Za-z_]\w*=$/

const files = process.argv.length > 2
	? process.argv.slice(2)
	: execFileSync('git', ['ls-files', '*README.md', 'README.md'], { encoding: 'utf8' }).split('\n').filter(f => f)

/** url (without anchor) → the places that link to it, with their anchors */
const links = new Map()
for (const file of files) {
	readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
		for (const match of line.matchAll(LINK)) {
			if (ASSIGNMENT.test(line.slice(0, match.index))) continue
			const [url, anchor] = match[0].split('#')
			if (!links.has(url)) links.set(url, [])
			links.get(url).push({ where: `${file}:${index + 1}`, anchor })
		}
	})
}

const fetchPage = async (url) => {
	for (let attempt = 1; ; attempt++) {
		try {
			const response = await fetch(url, { redirect: 'follow' })
			return { status: response.status, body: response.ok ? await response.text() : '' }
		} catch (error) {
			if (attempt === 3) return { status: 0, body: '', error: String(error) }
			await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
		}
	}
}

const broken = []
const urls = [...links.keys()]
for (let i = 0; i < urls.length; i += 8) {
	await Promise.all(urls.slice(i, i + 8).map(async url => {
		const page = await fetchPage(url)
		for (const { where, anchor } of links.get(url)) {
			if (page.status !== 200) {
				broken.push(`${where}: ${url} (${page.error ?? `HTTP ${page.status}`})`)
			} else if (anchor && !page.body.includes(`id="${anchor}"`)) {
				broken.push(`${where}: ${url}#${anchor} (no #${anchor} on the page)`)
			}
		}
	}))
}

broken.sort().forEach(line => console.log(line))
console.log(broken.length
	? `${broken.length} broken link(s) to the wiki, of ${urls.length} pages linked from ${files.length} files`
	: `every link to the wiki resolves: ${urls.length} pages linked from ${files.length} files`)
process.exitCode = broken.length ? 1 : 0
