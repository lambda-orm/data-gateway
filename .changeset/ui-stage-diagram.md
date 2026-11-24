---
'@lambdaorm/ui': minor
---

The diagram of a stage (`StageDiagram`, and a button on each stage of the explorer): the Data Gateway and, under it, each source of the stage in its order with the tables that live in it (their name by its mapping) and those whose reads or writes it takes; an arrow from each source to the gateway shows its condition below, in the colours of the editor. The routing comes from the gateway (`GET /admin/workspaces/{schema}/stages/{stage}/routing`, data-gateway 4.1.0).

Its toolbar: select or move the view, zoom (also with the wheel) and fit, the tables of each source or only their names, the gateway on top or on the left; the boxes are dragged where one wants (several selected at once), lay out again puts them back, and how it was left is kept with its tab.

Save keeps it in a project like any diagram (a name, a description, a folder; Save as… a copy): with workbenchWrite in the workspace of the schema, shared, otherwise in the browser. The button of its stage opens the one saved, as it was left.
