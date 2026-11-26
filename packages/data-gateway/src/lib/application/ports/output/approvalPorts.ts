import { Approval, ApprovalStatus } from '../../../domain/approval/approval'

/**
 * Where the writes that wait for a person live (docs/MUTATION_APPROVAL.md §5): shared by the workers and the replicas
 * that use the same file (the SQLite of the volume), or in memory (one process).
 */
export interface ApprovalStorePort {
	create (approval: Approval): Promise<void>
	get (id: string): Promise<Approval | undefined>
	/** of a schema, the newest first; with status, only those */
	list (schema: string, status: ApprovalStatus | undefined, limit: number): Promise<Approval[]>
	/**
	 * from its status to another, with what changes, only while it still has `from` (two people approving at once: one
	 * moves it, the other gets false)
	 */
	transition (id: string, from: ApprovalStatus, change: Partial<Approval> & { status: ApprovalStatus }): Promise<boolean>
}
