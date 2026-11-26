---
'@lambdaorm/ui': minor
---

`DataTable`: the data of an entity as a backoffice (`docs/BACKOFFICE.md`), the tab Data of `EntityView`. Sorted by a
column and filtered by a condition; with `canWrite`, a cell changed by a double click (an update that also filters by
the value read: 0 rows is "someone changed it meanwhile"), rows added and deleted; the page or everything (by pages, up
to `exportLimit`) exported as CSV (with a BOM), JSON or a real .xlsx written without dependencies (`toXlsx`, `toCsv`
in `domain/exporters`; the queries in `domain/dataEditing`).
