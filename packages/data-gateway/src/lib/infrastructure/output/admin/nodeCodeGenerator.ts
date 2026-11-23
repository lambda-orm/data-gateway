import { NodeCodeBuilder } from '@lambdaorm/base'
import { CodeGeneratorPort } from '../../../application/ports/output/adminPorts'

/** The code of `lambdaorm build` (node, client-node), from @lambdaorm/base: the same text the CLI writes */
export class NodeCodeGenerator implements CodeGeneratorPort {
	public files (language: 'node' | 'client-node', domain: any, options: { model: boolean, repositories: boolean }) {
		return new NodeCodeBuilder(language === 'client-node' ? '@lambdaorm/client' : '@lambdaorm/lib').files(domain, options)
	}
}
