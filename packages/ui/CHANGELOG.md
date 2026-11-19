# @lambdaorm/ui

## 0.3.3

### Patch Changes

- 67cd58c: READMEs: the one of `@lambdaorm/lib` is about the library (installation, getting started, queries across databases,
  dialects, stages), with the CLI, the Data Gateway, the client and the UI as related projects at the end; no emojis,
  and only the npm and license badges.

## 0.3.2

### Patch Changes

- 8be132e: The declarations of the query functions (the types of typed queries and the autocompletion of the UI's editor) match
  the language: `hour`, `minute`, `second`, `addHour`, `addMinute`, `addSecond` instead of `hours`, `minutes`, `seconds`,
  `addHours`, `addMinutes`, `addSeconds`, which don't exist; the differences (`dayDiff`, …) return a number;
  `millisecond`, `addMillisecond`, `subtractTime`, `dayDiff`, `hourDiff`, `secondDiff`, `millisecondDiff`, the
  `…ToDate` functions, `dateToString`, `log10`, `length`, `strCount` and `mask` are declared (`length` not in the lib's global `syntax.d.ts`, where it would clash with the DOM's `length`); `toDateTime`, `toTime`, `toJson`,
  `user`, `source`, `dateDiff` and `timeDiff`, which the language doesn't have (or no SQL engine translates), are not.

## 0.3.1

### Patch Changes

- cd0044e: `includes` has two meanings, as in JavaScript: a list includes a value (`["USA", "Mexico"].includes(p.country)`, an
  `IN`) and a text includes a text (`p.name.includes("fre")`, contains). Which one applied depended on the order of the
  functions in the configuration of each dialect: on SQL Server a list became a `LIKE`, and on MongoDB the pipeline was
  invalid. Now the type of the first operand decides, on every engine: a list, or a variable, is an `IN`; a text (a
  column or any expression of text, such as `upper(p.name)`) is a contains. On MongoDB the text is searched literally
  (`$indexOfCP`), not as a regular expression. The declaration of `includes` for lists is `includes(list, value)`, as it
  works and as the wiki documents.

## 0.3.0

### Minor Changes

- 3477dc3: `Workspace`: an explorer of the schemas on the left and tabs on the right. Each schema shows its domain as YAML (read only), its entities with their properties and relations, and what is saved in it: folders, queries and diagrams with a name and a description, moved by dragging. `EntityView`: the form of an entity (properties, relations and references, keys, indexes and constraints, rows read only by pages, diagram). Saved diagrams: the entities are chosen (or their neighbours added), the boxes are laid out and can be dragged, the boxes are taken out with their × or the Delete key, the lines can be moved sideways (a double click puts one back), the names of the relations can be shown, and all of it is saved. What is saved stays in the browser (`IndexedDbWorkspaceStore`, per `workspaceKey`) or in another `WorkspaceStore`; the workspace is exported to and imported from a JSON file. `DomainDiagram`: `entities`, `focus`, `positions` / `onPositionsChange`, `bends` / `onBendsChange`, `relationNames`, `onRemoveEntity`, `compact`, `toolbar`, `onOpenEntity`. `CodeEditor` `yaml` and `readOnly`; `QueryWorkbench` `initial`, `onContentChange`, `toolbar`, `showWho`; `ResultViewer` `initialView`.

## 0.2.0

### Minor Changes

- 8887612: `QueryTabs`: several `QueryWorkbench` in tabs (add, close, rename by double click). `locale` on `QueryWorkbench`, `QueryTabs` and `ResultViewer`: their labels and messages in English, Spanish, Portuguese, French, Italian, German, Dutch, Catalan, Galician or Basque (`LOCALES`, `messagesOf`); the action names stay the API's.

  `DomainDiagram`: the domain of a schema as a class / entity-relationship diagram (properties, types, PK / FK, relations with their cardinality, inheritance), laid out with ELK (`elkjs`, loaded on first use); the neighbours of an entity or the whole model, zoom and pan, SVG / PNG export. `QueryTabs` `diagram` shows it in a first fixed tab, where a double click on an entity opens a tab that queries it. `QueryApiPort.domain` (optional), `QueryWorkbench` `initialSchema`. `ResultViewer`: a copy icon and an export menu (JSON, YAML, tab-separated text).

## 0.1.0

### Minor Changes

- 8a0a0e0: First release of `@lambdaorm/ui`: `QueryWorkbench` (Monaco editor with the autocompletion of the schema, data and options, plan / metadata / model / parameters / constraints / execute / executeQueued / executeScript enabled by the credential's permissions, result as tree, table, JSON or YAML with downloads, history per schema) and its parts, over a `QueryApiPort` with a REST adapter for the λORM data-gateway.
