---
'@lambdaorm/ui': minor
---

The domain of the explorer lists its abstract entities apart, by name, in **Abstracts** (next to Entities and Enums): read from
the lambdaORM.yaml (with schemaRead), since the completed domain has none — `abstract: true` among the entities, and
`domain.abstracts` once λORM has it. Each one is shown as an entity — in the tree with its properties and relations,
and its view the same as an entity's (with what it inherits) without Data, Diagram nor Query; Edit and Remove as an
entity's (`abstractEntityOf`). The `extends <base>` of a view opens the base's view. Its `+` opens a new entity that starts abstract
(`FormFocus.abstract`). The YAML the explorer read is read again when the schema changes, so a new abstract (or
mapping, source, stage) appears.

A connection whose key is entered after the IDE opened asks again what its credential may do: its administration
(config, application, infrastructure, State, Source code) appears and its domains are read again, without reloading
the page.
