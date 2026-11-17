import { forbidden } from '../errors/gatewayError'
import { Permission } from './permission'
import { Principal } from './principal'

export type Operation =
	| 'plan' | 'metadata' | 'model' | 'parameters' | 'constraints'
	| 'execute' | 'executeScript' | 'executeQueued'
	| 'schema' | 'stageExists' | 'stageExport' | 'stageImport'

/**
 * The permissions an operation needs. `writes` (from the query classification) matters for execute and
 * executeQueued: a query that writes needs `write` on top of `read` / `queue`.
 */
export const requiredPermissions = (operation: Operation, writes = false): Permission[] => {
	switch (operation) {
	case 'execute':
		return writes ? ['write'] : ['read']
	case 'executeQueued':
		return writes ? ['queue', 'write'] : ['queue']
	case 'executeScript':
		return ['script']
	case 'stageImport':
		return ['stageImport']
	default:
		return ['read']
	}
}

/** Throws 403 (ForbiddenError) naming the first permission the principal lacks. */
export const authorize = (principal: Principal, operation: Operation, writes = false): void => {
	for (const permission of requiredPermissions(operation, writes)) {
		if (!principal.permissions.has(permission)) {
			throw forbidden(principal.name, permission)
		}
	}
}
