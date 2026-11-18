import net from 'net'

/** A free TCP port on 127.0.0.1, chosen now (the configuration needs a real port: 0 is not accepted) */
export const freePort = (): Promise<number> => new Promise((resolve, reject) => {
	const server = net.createServer()
	server.once('error', reject)
	server.listen(0, '127.0.0.1', () => {
		const port = (server.address() as net.AddressInfo).port
		server.close(() => resolve(port))
	})
})

export interface Answer { status: number, body: any, headers: Headers }

/** fetch with JSON in and out */
export const call = async (base: string, path: string, init: { method?: string, body?: unknown, headers?: Record<string, string> } = {}): Promise<Answer> => {
	const response = await fetch(base + path, {
		method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
		headers: { 'content-type': 'application/json', ...init.headers },
		body: init.body !== undefined ? JSON.stringify(init.body) : undefined
	})
	const text = await response.text()
	let body: any = text
	try { body = text ? JSON.parse(text) : undefined } catch { /* text */ }
	return { status: response.status, body, headers: response.headers }
}
