/**
 * Frames of the channel over a socket: [4 bytes: length of the header][header JSON][4 bytes: length of the body][body].
 * The body is the `json` bytes of a response (a result already serialized travels as is, not inside another JSON).
 */
export const encodeFrame = (message: object): Buffer => {
	const { json, ...rest } = message as { json?: Uint8Array }
	const header = Buffer.from(JSON.stringify(rest))
	const body = json ? Buffer.from(json.buffer, json.byteOffset, json.byteLength) : Buffer.alloc(0)
	const frame = Buffer.allocUnsafe(8 + header.length + body.length)
	frame.writeUInt32BE(header.length, 0)
	header.copy(frame, 4)
	frame.writeUInt32BE(body.length, 4 + header.length)
	body.copy(frame, 8 + header.length)
	return frame
}

/** Collects chunks of a socket and emits each complete message */
export class FrameDecoder {
	private buffer = Buffer.alloc(0)

	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly onMessage: (message: any) => void) {}

	public push (chunk: Buffer): void {
		this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
		for (;;) {
			if (this.buffer.length < 4) return
			const headerLength = this.buffer.readUInt32BE(0)
			if (this.buffer.length < 8 + headerLength) return
			const bodyLength = this.buffer.readUInt32BE(4 + headerLength)
			const end = 8 + headerLength + bodyLength
			if (this.buffer.length < end) return
			const message = JSON.parse(this.buffer.subarray(4, 4 + headerLength).toString())
			if (bodyLength > 0) message.json = new Uint8Array(this.buffer.subarray(8 + headerLength, end))
			this.buffer = this.buffer.subarray(end)
			this.onMessage(message)
		}
	}
}
