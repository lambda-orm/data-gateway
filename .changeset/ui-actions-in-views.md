---
'@lambdaorm/ui': minor
---

The actions of a connection, a schema and an entity are in what opens when it is chosen, not in its row of the tree:
the name of a connection opens its page (`onOpen` of a connection); the view of a schema has Remove next to Edit
(`SchemaForms` takes `onRemoveSchema`); the view of an entity has Remove next to Edit (`EntityView` takes `onRemove`):
its form says what uses it and asks to confirm (`removeRequest`), and once removed its tabs close. A schema that
failed to load keeps its Remove in the tree (it has no view).
