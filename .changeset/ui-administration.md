---
"@lambdaorm/ui": minor
---

The administration of a connection in the explorer: `WorkspaceConnection.administration` (`{ title, nodes }`) shows, above its schemas, a tree its host gives (`AdministrationNode`: a label, an icon, what it opens, the buttons of its row, its children). `AdministrationTree` is exported. Inside a connection the explorer is one tree: its nodes Administration (folded at first) and Schemas (with its new schema, export and import), each schema one level in.
