import { ClockPort } from '../../../application/ports/output/supportPorts'

export class SystemClock implements ClockPort {
	public now (): Date { return new Date() }
	public uptimeSeconds (): number { return process.uptime() }
}
