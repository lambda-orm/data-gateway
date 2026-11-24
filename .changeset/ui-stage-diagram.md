---
'@lambdaorm/ui': minor
---

The diagram of a stage (`StageDiagram`, and a button on each stage of the explorer): the Data Gateway and, under it, each source of the stage in its order with the tables that live in it (their name by its mapping) and those whose reads or writes it takes; an arrow from each source to the gateway shows its condition below, in the colours of the editor. The routing comes from the gateway (`GET /admin/workspaces/{schema}/stages/{stage}/routing`, data-gateway 4.1.0).
