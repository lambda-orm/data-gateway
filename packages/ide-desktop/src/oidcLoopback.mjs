// The loopback of a login with an identity provider (docs/OIDC_LOGIN.md §2, RFC 8252): a server on 127.0.0.1 (any free
// port) that takes one answer of the provider (its query string: the code and the state, or the error), says the tab
// may be closed, and closes. No Electron: main.mjs gives it what to do when the answer arrives (bring the window back).
import http from 'node:http'

const PAGE = '<!doctype html><meta charset="utf-8"><title>λORM Data Gateway</title><body style="font: 14px system-ui, sans-serif; text-align: center; padding-top: 40px">You can close this tab and go back to the IDE.</body>'

/**
 * Starts a loopback: { redirectUri, answer (its query string), close }. After timeoutMs without an answer, it answers
 * an error itself.
 */
export const startLoopback = async ({ onAnswer = () => undefined, timeoutMs = 10 * 60000 } = {}) => {
	let answered
	const answer = new Promise(resolve => { answered = resolve })
	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1')
		if (url.pathname !== '/oidc-callback') { res.writeHead(404).end(); return }
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
		res.end(PAGE)
		answered(url.search)
		server.close()
		onAnswer()
	})
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
	const timer = setTimeout(() => { answered('?error=timeout&error_description=the%20login%20took%20too%20long'); server.close() }, timeoutMs)
	timer.unref?.()
	return {
		redirectUri: `http://127.0.0.1:${server.address().port}/oidc-callback`,
		answer,
		close: () => { clearTimeout(timer); server.close() }
	}
}
