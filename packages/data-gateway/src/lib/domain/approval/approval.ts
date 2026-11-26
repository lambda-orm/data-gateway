import { Actor } from '@lambdaorm/base'
import { Permission } from '../auth/permission'

/**
 * A write that waits for a person (docs/MUTATION_APPROVAL.md): pending until someone with approve decides; approved,
 * it runs once with the identity that asked for it and ends done (its result) or failed (its error); rejected (its
 * reason) or expired, it never runs.
 */
export type ApprovalStatus = 'pending' | 'approved' | 'done' | 'failed' | 'rejected' | 'expired'

/** Who asked for it: what it needs to run later as itself (its view, its context), never its secret */
export interface ApprovalRequester {
	name: string
	permissions: Permission[]
	actor?: Actor
	context?: Record<string, unknown>
	view?: string
	transport: string
}

export interface Approval {
	id: string
	schema: string
	operation: 'execute' | 'executeScript'
	/** the query (execute) or the script (executeScript) */
	text: string
	/** a query of application.queries asked for by its name */
	name?: string
	data?: unknown
	options?: Record<string, unknown>
	/** what it would run: the sentences of its plan (a script has none) */
	plan?: unknown
	requester: ApprovalRequester
	status: ApprovalStatus
	createdAt: string
	expiresAt: string
	decidedBy?: string
	decidedAt?: string
	reason?: string
	result?: unknown
	error?: string
}

/** What who asked gets at once: its write waits */
export interface ApprovalPending {
	approval: string
	status: 'pending'
	expiresAt: string
	message: string
}

export const isApprovalPending = (value: unknown): value is ApprovalPending =>
	!!value && typeof value === 'object' && typeof (value as any).approval === 'string' && (value as any).status === 'pending' && typeof (value as any).expiresAt === 'string'
