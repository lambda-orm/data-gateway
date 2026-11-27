---
'@lambdaorm/ui': minor
---

The domain of the explorer lists its abstract entities apart, in **Abstracts** (next to Entities and Enums): read from
the lambdaORM.yaml (with schemaRead), since the completed domain has none — `abstract: true` among the entities, and
`domain.abstracts` once λORM has it. Each one opens its form; its `+` opens a new entity that starts abstract
(`FormFocus.abstract`). The YAML the explorer read is read again when the schema changes, so a new abstract (or
mapping, source, stage) appears.

A connection whose key is entered after the IDE opened asks again what its credential may do: its administration
(config, application, infrastructure, State, Source code) appears without reloading the page.
