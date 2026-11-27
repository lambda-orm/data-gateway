---
'@lambdaorm/ui': minor
---

The diagram of an entity (its view) has **options**, a list of several choices at once in place of the check of the
names: the names of the relations, its related entities (without them, only the entity) and the entities it extends
(read from the lambdaORM.yaml with schemaRead: the abstract bases up its chain, with the dashed line of an inheritance;
not the other entities of the same base). At first only the entities it extends are checked: the entity and its
chain of bases. `DomainDiagram` takes them with `options` and `source` (the entities as the
lambdaORM.yaml says them).
