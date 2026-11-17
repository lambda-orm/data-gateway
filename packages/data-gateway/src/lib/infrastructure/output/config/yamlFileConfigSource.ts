import fs from 'fs'
import { ConfigSourcePort } from '../../../application/ports/output/supportPorts'
import { ConfigError } from '../../../domain/errors/gatewayError'
import { resolveEnv } from './envResolver'
const YAML = require('js-yaml')

export const DEFAULT_CONFIG_PATH = '/config/data-gateway.config.yaml'

/** The configuration file (DATA_GATEWAY_CONFIG_PATH, default /config/data-gateway.config.yaml), mandatory. */
export class YamlFileConfigSource implements ConfigSourcePort {
	// eslint-disable-next-line no-useless-constructor
	constructor (
		public readonly location: string = process.env.DATA_GATEWAY_CONFIG_PATH || DEFAULT_CONFIG_PATH,
		private readonly env: Record<string, string | undefined> = process.env
	) {}

	public async load (): Promise<unknown> {
		if (!fs.existsSync(this.location)) {
			throw new ConfigError([`configuration file not found: ${this.location} (mount it, or set DATA_GATEWAY_CONFIG_PATH)`])
		}
		let parsed: unknown
		try {
			// synchronous: the supervisor sets UV_THREADPOOL_SIZE after reading it, before anything uses the threadpool
			parsed = YAML.load(fs.readFileSync(this.location, 'utf8'))
		} catch (error: any) {
			throw new ConfigError([`${this.location} is not valid YAML: ${error.message}`])
		}
		return resolveEnv(parsed ?? {}, this.env)
	}
}
