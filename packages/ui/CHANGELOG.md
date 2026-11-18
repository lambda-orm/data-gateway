# @lambdaorm/ui

## 0.2.0

### Minor Changes

- 8887612: `QueryTabs`: several `QueryWorkbench` in tabs (add, close, rename by double click). `locale` on `QueryWorkbench`, `QueryTabs` and `ResultViewer`: their labels and messages in English, Spanish, Portuguese, French, Italian, German, Dutch, Catalan, Galician or Basque (`LOCALES`, `messagesOf`); the action names stay the API's.

  `DomainDiagram`: the domain of a schema as a class / entity-relationship diagram (properties, types, PK / FK, relations with their cardinality, inheritance), laid out with ELK (`elkjs`, loaded on first use); the neighbours of an entity or the whole model, zoom and pan, SVG / PNG export. `QueryTabs` `diagram` shows it in a first fixed tab, where a double click on an entity opens a tab that queries it. `QueryApiPort.domain` (optional), `QueryWorkbench` `initialSchema`. `ResultViewer`: a copy icon and an export menu (JSON, YAML, tab-separated text).

## 0.1.0

### Minor Changes

- 8a0a0e0: First release of `@lambdaorm/ui`: `QueryWorkbench` (Monaco editor with the autocompletion of the schema, data and options, plan / metadata / model / parameters / constraints / execute / executeQueued / executeScript enabled by the credential's permissions, result as tree, table, JSON or YAML with downloads, history per schema) and its parts, over a `QueryApiPort` with a REST adapter for the λORM data-gateway.
