import net from 'net'

/**
 * The address of the client of a request (docs/DATA_GATEWAY_SESSIONS_PLAN.md D7): the one of the connection, unless it
 * comes from a trusted proxy (the backend of the IDE), whose X-Forwarded-For is then read from the right, skipping the
 * trusted ones. A header from anyone else is ignored: it could say anything.
 */
export class ClientAddress {
	private readonly trusted = new net.BlockList()
	private readonly any: boolean

	constructor (trustedProxies: string[]) {
		for (const entry of trustedProxies) {
			const [address, prefix] = entry.split('/')
			const type = net.isIPv6(address) ? 'ipv6' : 'ipv4'
			if (prefix !== undefined) this.trusted.addSubnet(address, Number(prefix), type)
			else this.trusted.addAddress(address, type)
		}
		this.any = trustedProxies.length > 0
	}

	public of (remote: string | undefined, forwardedFor: string | string[] | undefined): string | undefined {
		const connection = normalize(remote)
		if (!connection || !this.any || !this.isTrusted(connection)) return connection
		const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor
		if (!header) return connection
		const hops = header.split(',').map(h => normalize(h.trim())).filter((h): h is string => !!h && net.isIP(h) !== 0)
		for (let i = hops.length - 1; i >= 0; i--) {
			if (!this.isTrusted(hops[i])) return hops[i]
		}
		return hops[0] ?? connection
	}

	private isTrusted (address: string): boolean {
		return this.trusted.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4')
	}
}

/** ::ffff:10.0.0.1 (IPv4 on an IPv6 socket) → 10.0.0.1 */
const normalize = (address: string | undefined): string | undefined =>
	address?.startsWith('::ffff:') && net.isIPv4(address.slice(7)) ? address.slice(7) : address
