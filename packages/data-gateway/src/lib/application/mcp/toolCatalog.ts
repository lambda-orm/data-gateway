import { Principal } from '../../domain/auth/principal'
import { Tool } from './tool'

export interface ToolFilter {
	/** Only these (empty = all) */
	include: string[]
	exclude: string[]
}

/**
 * The tools of a schema: the registered ones minus mcp.tools (include / exclude); for a credential, only those it can
 * use. A tool that isn't visible doesn't exist for that credential (calling it is an unknown tool).
 */
export class ToolCatalog {
	private readonly tools: Tool[]

	constructor (tools: Tool[], private readonly filter: ToolFilter = { include: [], exclude: [] }) {
		this.tools = tools.filter(tool => this.allows(tool.name))
	}

	/** mcp.tools.include / exclude: also for the tools that come later (the named queries) */
	public allows (name: string): boolean {
		return (this.filter.include.length === 0 || this.filter.include.includes(name)) && !this.filter.exclude.includes(name)
	}

	public get names (): string[] {
		return this.tools.map(tool => tool.name)
	}

	public visible (principal: Principal): Tool[] {
		return this.tools.filter(tool => tool.visibleTo(principal))
	}

	public find (principal: Principal, name: string): Tool | undefined {
		return this.visible(principal).find(tool => tool.name === name)
	}
}
