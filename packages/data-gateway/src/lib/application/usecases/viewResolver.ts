import { GatewayError } from '../../domain/errors/gatewayError'
import { Principal } from '../../domain/auth/principal'

/**
 * The view of λORM of a request (docs/VIEWS_BY_IDENTITY.md): the one of its principal (its key, its roles), else the
 * one of the schema (orm.schemas[].view), else none (default, the domain). Never the client's (R2). A view the schema
 * doesn't have is refused (403): a mistake in the configuration never shows the whole domain.
 */
export class ViewResolver {
	// eslint-disable-next-line no-useless-constructor
	constructor (private readonly available: () => string[], private readonly schemaView?: string) {}

	/** the view, or undefined for the domain (default) */
	public of (principal: Principal): string | undefined {
		const view = principal.view ?? this.schemaView
		if (view === undefined || view === 'default') return undefined
		if (!this.available().includes(view)) {
			throw new GatewayError(403, 'ViewError', `the view "${view}" of "${principal.name}" is not in the schema (${this.available().join(', ')})`)
		}
		return view
	}

	/** the views the configuration names that the schema doesn't have: said when it loads */
	public missing (named: string[]): string[] {
		const available = this.available()
		return [...new Set([...named, ...(this.schemaView ? [this.schemaView] : [])])].filter(v => v !== 'default' && !available.includes(v))
	}
}

/** No view: every request sees the domain (tests, a schema without views) */
export const NO_VIEWS = new ViewResolver(() => [], undefined)
