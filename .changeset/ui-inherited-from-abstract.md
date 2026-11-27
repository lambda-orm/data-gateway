---
'@lambdaorm/ui': minor
---

What an entity inherits from the entities it extends (`extends`, a chain): its form shows the inherited properties and
relations apart, by the base that declares them, read only (they are changed in that base, with a link to it), and an
own one that redefines an inherited one says so; its view says `extends <base>` (the chain in its title) and, in its
properties and relations, a column Inherited with where each one comes from. Read from the lambdaORM.yaml (with
schemaRead): the completed domain no longer says `extends`. `inheritanceOf(entities, name)` resolves it as λORM does.
