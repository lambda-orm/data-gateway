import { LoggerPort } from '../../../application/ports/output/supportPorts'

const LEVELS = ['error', 'warn', 'info', 'debug']

const text = (message: string | Error | unknown): string =>
	message instanceof Error ? message.message : typeof message === 'string' ? message : JSON.stringify(message)

/** One line per message on stdout / stderr, with time and level. */
export class ConsoleLogger implements LoggerPort {
	private readonly max: number

	constructor (level = 'info', private readonly label = '') {
		this.max = LEVELS.indexOf(level)
	}

	private log (level: string, message: unknown): void {
		if (LEVELS.indexOf(level) > this.max) return
		const line = `${new Date().toISOString()} ${level.toUpperCase()}${this.label ? ' ' + this.label : ''}: ${text(message)}`
		if (level === 'error') console.error(line)
		else console.log(line)
	}

	public info (message: string): void { this.log('info', message) }
	public warn (message: string): void { this.log('warn', message) }
	public error (message: string | Error): void { this.log('error', message) }
}

/** winston on the console (the container's log collector keeps it). */
export class WinstonLogger implements LoggerPort {
	private readonly logger: any

	constructor (level = 'info', label = '') {
		const { transports, createLogger, format } = require('winston')
		this.logger = createLogger({
			level,
			format: format.combine(
				format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
				format.printf(({ level, message, timestamp }: { level: string, message: string, timestamp: string }) => `${timestamp} ${level}${label ? ' ' + label : ''}: ${message}`)
			),
			transports: [new transports.Console()]
		})
	}

	public info (message: string): void { this.logger.info(message) }
	public warn (message: string): void { this.logger.warn(message) }
	public error (message: string | Error): void { this.logger.error(text(message)) }
}
