/** CRC-32 (IEEE), the checksum of each file of a zip */
const TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[n] = c >>> 0
	}
	return table
})()

export const crc32 = (data: Buffer): number => {
	let crc = 0xffffffff
	for (const byte of data) crc = TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
	return (crc ^ 0xffffffff) >>> 0
}

/**
 * A zip of some text files, stored (not compressed): the code a build generates is small, and no library is needed.
 * Paths with /, names in UTF-8.
 */
export const zipOf = (files: { path: string, content: string }[]): Buffer => {
	const locals: Buffer[] = []
	const centrals: Buffer[] = []
	let offset = 0
	for (const file of files) {
		const name = Buffer.from(file.path, 'utf8')
		const data = Buffer.from(file.content, 'utf8')
		const crc = crc32(data)
		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4) // version needed
		local.writeUInt16LE(0x0800, 6) // UTF-8 names
		local.writeUInt16LE(0, 8) // stored
		local.writeUInt32LE(0, 10) // time and date: none
		local.writeUInt32LE(crc, 14)
		local.writeUInt32LE(data.length, 18)
		local.writeUInt32LE(data.length, 22)
		local.writeUInt16LE(name.length, 26)
		local.writeUInt16LE(0, 28)
		const central = Buffer.alloc(46)
		central.writeUInt32LE(0x02014b50, 0)
		central.writeUInt16LE(20, 4)
		central.writeUInt16LE(20, 6)
		central.writeUInt16LE(0x0800, 8)
		central.writeUInt16LE(0, 10)
		central.writeUInt32LE(0, 12)
		central.writeUInt32LE(crc, 16)
		central.writeUInt32LE(data.length, 20)
		central.writeUInt32LE(data.length, 24)
		central.writeUInt16LE(name.length, 28)
		central.writeUInt32LE(offset, 42)
		locals.push(local, name, data)
		centrals.push(central, name)
		offset += local.length + name.length + data.length
	}
	const directory = Buffer.concat(centrals)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(files.length, 8)
	end.writeUInt16LE(files.length, 10)
	end.writeUInt32LE(directory.length, 12)
	end.writeUInt32LE(offset, 16)
	return Buffer.concat([...locals, directory, end])
}
