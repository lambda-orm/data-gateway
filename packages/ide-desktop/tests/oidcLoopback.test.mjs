// The loopback of the login of the desktop app (docs/OIDC_LOGIN.md §2): it takes one answer of the identity provider on
// 127.0.0.1, says the tab may be closed, tells the app and closes; without an answer in time, an error of its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startLoopback } from '../src/oidcLoopback.mjs'

test('one answer: its query string; the page says so; the server closes', async () => {
	let told = 0
	const loopback = await startLoopback({ onAnswer: () => { told++ } })
	assert.match(loopback.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/oidc-callback$/)
	assert.equal((await fetch(loopback.redirectUri.replace('/oidc-callback', '/other'))).status, 404)
	const page = await fetch(`${loopback.redirectUri}?code=abc&state=s1`)
	assert.equal(page.status, 200)
	assert.match(await page.text(), /close this tab/)
	assert.equal(await loopback.answer, '?code=abc&state=s1')
	assert.equal(told, 1)
	await assert.rejects(fetch(`${loopback.redirectUri}?code=again`))
})

test('no answer in time: an error of its own', async () => {
	const loopback = await startLoopback({ timeoutMs: 50 })
	assert.match(await loopback.answer, /^\?error=timeout/)
	loopback.close()
})
