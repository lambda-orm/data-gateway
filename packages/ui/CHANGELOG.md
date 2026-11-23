# @lambdaorm/ui

## 0.5.0

### Minor Changes

- dc07e86: The administration of the workspaces of a gateway with admin.enabled: the lambdaORM.yaml of a schema editable in Monaco
  (validated while typed, with the line of each issue; saved with Ctrl+S with the version it read; when someone else saved
  another version, both side by side to choose), new schemas (empty or a copy of another one) and removed ones (their
  route typed again). `SchemaEditor`, `RestAdminApi` and `AdminApiPort`; the Workspace takes `admin` (by default the
  gateway's own).
- 3a0fafa: The panel of commands of a workspace (`CommandsPanel`, a **Commands** row of each ready schema): fetch and export as
  jobs (an export downloaded or saved in data/), push, drop and import after their preview (the sentences by source, the
  rows of each entity; drop asks for its stage again), and the last jobs with their result.
- 37a1e21: The variables of the connections (.env) in the schema's forms, set without ever being shown; the code of the domain
  (build) written in src/ or downloaded as a zip from the panel of commands; and the completion of the keys and known
  values of the lambdaORM.yaml in its editor.
- af7cced: pull, introspect and incorporate in the panel of commands: their preview is the diff of the lambdaORM.yaml (added and
  removed lines in color); introspect and incorporate take a data file and the entity of its rows.
- c61218c: The schema as forms (`SchemaForms`, **Schema (forms)** of each schema): entities (with their properties, relations and
  indexes in tables), enums, sources, mappings and stages, created, changed, renamed and removed one element at a time;
  a remove first shows who uses the element, and a change of someone else to the same element is shown to choose.
- 36ac834: The Workspace reads the schemas again (`refreshMs`, default 5000): a schema added, removed or reloaded on the gateway
  shows without reloading the page, its domain and typings are read again, and a new version that didn't start is marked
  with its reason (`SchemaInfo.since`, `SchemaInfo.pending`).
- 3cfd879: With `workbenchWrite` on a gateway with the administration, what is saved (folders, queries, scripts, diagrams) goes to
  the workspaces of the gateway (`GatewayWorkspaceStore`), shared and read again when it changes; what the browser kept is
  offered to copy there. A file of workbench/ that can't be read is shown, never replaced.

## 0.4.0

### Minor Changes

- 0d15eab: The explorer filters the entities of a schema by part of a name: an entity whose name contains it, or the properties
  and relations that do, shown under their entity without opening it (`Areas.type` looks only in Areas). With a large
  domain (192 entities) the list was flat and had to be scrolled. Escape clears it; the count says how many match.
- 2923a57: - An error of the query with a suggestion of the gateway offers it ("use name"): a click replaces the name in the query
  (every whole word, not quoted text) and checks it again.
  - The width of the explorer is kept in the browser, changes with the keyboard (arrows on its border) and, with a double
    click or Enter on the border, fits the longest name.
  - A schema that didn't start shows in the explorer with its status and, opened, its reason (a database down, a
    connection variable not set); nothing can be created in it.

## 0.3.4

### Patch Changes

- 9b81b4f: The entities of the diagram dialog: each checkbox next to its name (they were above it).
- 48e8712: `QueryWorkbench` (and the tabs of `QueryTabs` and `Workspace`): when there is a single ready schema it is chosen by itself, instead of asking to choose it.

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
