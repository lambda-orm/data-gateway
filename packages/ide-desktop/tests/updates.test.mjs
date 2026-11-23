// The pure parts of the updates: the order of the versions, and the latest release of the IDE among the others of the
// repository (ide-v*; not drafts, not prereleases). updates.mjs imports electron: these load it through a stub.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve (specifier, context, next) {
	if (specifier === 'electron') return { url: 'data:text/javascript,export const app = {}; export const dialog = {}; export const shell = {}', shortCircuit: true }
	return next(specifier, context)
}`))
const { newer, latestIdeRelease } = await import('../src/updates.mjs')

test('versions: numbers by part; a prerelease is older than its release', () => {
	assert.equal(newer('1.10.0', '1.9.2'), true)
	assert.equal(newer('1.1.0', '1.1.0'), false)
	assert.equal(newer('1.1.0', '1.1.0-rc.1'), true)
	assert.equal(newer('1.1.0-rc.2', '1.1.0-rc.1'), true)
	assert.equal(newer('1.0.9', '1.1.0'), false)
})

test('the latest release of the IDE, among those of the other packages', async () => {
	const releases = [
		{ tag_name: '@lambdaorm/ui@0.7.0', draft: false, prerelease: false },
		{ tag_name: 'ide-v1.2.0-rc.1', draft: false, prerelease: true },
		{ tag_name: 'ide-v1.3.0', draft: true, prerelease: false },
		{ tag_name: 'ide-v1.1.0', draft: false, prerelease: false, html_url: 'https://github.com/lambda-orm/data-gateway/releases/tag/ide-v1.1.0' }
	]
	const fetcher = async () => ({ ok: true, json: async () => releases })
	assert.deepEqual(await latestIdeRelease(fetcher), { version: '1.1.0', url: releases[3].html_url })
	assert.equal(await latestIdeRelease(async () => ({ ok: true, json: async () => [] })), undefined)
	await assert.rejects(latestIdeRelease(async () => ({ ok: false, status: 403 })), /403/)
})
