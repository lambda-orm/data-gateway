import YAML from 'yaml'
import { YamlPort } from '../../../application/ports/output/adminPorts'
import { mergeIntoYaml } from './yamlMerge'

export class YamlAdapter implements YamlPort {
	public parse (text: string): unknown {
		return YAML.parse(text)
	}

	public stringify (value: unknown): string {
		// long texts (a query, a script) as blocks, not folded
		return YAML.stringify(value, { lineWidth: 0, blockQuote: 'literal' })
	}

	public merge (text: string, value: unknown): string {
		return mergeIntoYaml(text, value)
	}
}
