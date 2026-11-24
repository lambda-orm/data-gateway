---
'@lambdaorm/ui': minor
---

The history of a schema (`HistoryView`): who changed what and when, the newest first, with the JSON Patch of a change
and the element before and after; a tab History in an entity (its changes) and in the view of the schema. A form or the
YAML that meets a 412 says who changed it (`details.changedBy`). A change of another session (`workspace.changed` with
who) is announced with a Refresh (`WorkspaceConnection.session`, `changes` with the event). An entity links to its
traces when the connection says where (`tracesUrl`). `AdminApiPort.history`, and the types `SchemaChange`,
`ChangeActor`, `JsonPatchOperation`, `WorkspaceChangeEvent`.
