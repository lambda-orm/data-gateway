---
'@lambdaorm/data-gateway-client': minor
---

`client.approval(id)` and `isApprovalPending(result)`: a write that waits for a person to approve it (gateway 4.3,
`docs/MUTATION_APPROVAL.md`) answers `{ approval, status: 'pending', expiresAt }` at once; `approval(id)` tells its state
(pending, done with its result, failed, rejected, expired), on every transport.
