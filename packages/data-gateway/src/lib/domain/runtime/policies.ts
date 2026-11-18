/** Wait before restarting a worker that fell or didn't start: doubles each time, up to maxDelayMs */
export class RestartPolicy {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly initialDelayMs: number, private readonly maxDelayMs: number) {}

	/** attempt 0 is the first restart */
	public delay (attempt: number): number {
		return Math.min(this.maxDelayMs, this.initialDelayMs * 2 ** Math.min(attempt, 30))
	}
}

/** A worker that didn't answer a ping for timeoutMs is hung (a synchronous loop never throws): terminate it */
export class HeartbeatPolicy {
	// eslint-disable-next-line no-useless-constructor
	constructor (public readonly intervalMs: number, public readonly timeoutMs: number) {}

	public isHung (lastPongMs: number, nowMs: number): boolean {
		return nowMs - lastPongMs > this.timeoutMs
	}
}

/** starting → ready | error; ready → restarting (fell, hung) → starting …; stopped at shutdown */
export type SchemaStatus = 'starting' | 'ready' | 'error' | 'restarting' | 'stopped'

export interface SchemaState {
	path: string
	status: SchemaStatus
	/** Why it is in error / restarting */
	reason?: string
	since: string
	restarts: number
}
