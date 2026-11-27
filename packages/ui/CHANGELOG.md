# @lambdaorm/ui

## 0.6.0

### Minor Changes

- c5595b9: The view of an abstract entity has a tab **Extended by (n)**: every entity that extends it, also through another abstract
  one (Areas → LocatedCatalog → Located), by name, with the base each one extends; each one opens its view.
- 18aec15: The domain of the explorer lists its abstract entities apart, by name, in **Abstracts** (first, before Entities and Enums): read from
  the lambdaORM.yaml (with schemaRead), since the completed domain has none — `abstract: true` among the entities, and
  `domain.abstracts` once λORM has it. Each one is shown as an entity — in the tree with its properties and relations,
  and its view the same as an entity's (with what it inherits) without Data, Diagram nor Query; Edit and Remove as an
  entity's (`abstractEntityOf`). The `extends <base>` of a view opens the base's view. Its `+` opens a new entity that starts abstract
  (`FormFocus.abstract`). The YAML the explorer read is read again when the schema changes, so a new abstract (or
  mapping, source, stage) appears.

  A connection whose key is entered after the IDE opened asks again what its credential may do: its administration
  (config, application, infrastructure, State, Source code) appears and its domains are read again, without reloading
  the page.

- e057710: The actions of a connection, a schema and an entity are in what opens when it is chosen, not in its row of the tree:
  the name of a connection opens its page (`onOpen` of a connection); the view of a schema has Remove next to Edit
  (`SchemaForms` takes `onRemoveSchema`); the view of an entity has Remove next to Edit (`EntityView` takes `onRemove`):
  its form says what uses it and asks to confirm (`removeRequest`), and once removed its tabs close. A schema that
  failed to load keeps its Remove in the tree (it has no view).
- 0c11bd4: The administration of a connection in the explorer: `WorkspaceConnection.administration` (`{ title, nodes }`) shows, above its schemas, a tree its host gives (`AdministrationNode`: a label, an icon, what it opens, the buttons of its row, its children). `AdministrationTree` is exported. Inside a connection the explorer is one tree: its nodes Administration (folded at first) and Schemas (with its new schema, export and import), each schema one level in.
- bbe4f3f: The root of the connections takes what goes before its title (`connectionsHeading.lead`: the menu of an app), without its icon then, its title shortened before the row overflows. What is saved of a schema shows as Workbench (it was projects).
- ea5064a: A connection of the `Workspace` can bring its own `fetch` (the data-gateway-ide puts its session of `management` in
  every request and logs in again when it ends), a `changes` subscription (the gateway's WebSocket of events: the schemas
  and what is saved are read again at once) and its own `refreshMs` (the polling, slower while the events work).
- 594725e: `DataTable`: the data of an entity as a backoffice (`docs/BACKOFFICE.md`), the tab Data of `EntityView`. Sorted by a
  column and filtered by a condition; with `canWrite`, a cell changed by a double click (an update that also filters by
  the value read: 0 rows is "someone changed it meanwhile"), rows added and deleted; the page or everything (by pages, up
  to `exportLimit`) exported as CSV (with a BOM), JSON or a real .xlsx written without dependencies (`toXlsx`, `toCsv`
  in `domain/exporters`; the queries in `domain/dataEditing`).
- ea086f4: Every diagram (of the domain, of an entity, saved, of the query wizard, of a stage) has an outline: a button of its toolbar shows it (hidden at first), the whole drawing small on the right of the view, as high as it, with a thin frame on what the view shows; a click or a drag on it moves the view there.
- e057710: The validations of an entity are its Constraints, as λORM names them: its tab `Constraints (n)` and, under a property,
  the constraints that use it. The form of an entity has tabs (Properties, Relations, Indexes, Constraints, each with how
  many it has) under its general fields. Its Edit (in the entity or the explorer) opens the form already in edit, with
  Cancel and Save; an open form of it goes to edit (`SchemaForms` takes `editRequest`, `onOpenElement` an `edit`).

  Opened by Edit, its Cancel or its Save closes the form and goes back to the view of the entity (`SchemaForms` takes
  `onDone`). Each expression of a property says what it is (`readExp: replaces the column when reading…`) and, under
  it, its editor (Monaco, with the properties and the functions suggested) or the expression in colors; the constraints
  that use the property, the same way. `abstract` and `view` share a line.

- e6f3a05: The diagram of an entity (its view) has **options**, a list of several choices at once in place of the check of the
  names: the names of the relations, its related entities (without them, only the entity) and the entities it extends
  (read from the lambdaORM.yaml with schemaRead: the abstract bases up its chain, with the dashed line of an inheritance;
  not the other entities of the same base). At first only the entities it extends are checked: the entity and its
  chain of bases. `DomainDiagram` takes them with `options` and `source` (the entities as the
  lambdaORM.yaml says them).
- cc52a55: The validations (constraints) of an entity: a tab of their own (`Validations (n)`, out of Keys and indexes) with each
  message, its condition in the colors of 3xpr and the properties it uses; and, under a property, after its expressions,
  the validations whose condition uses it (a property with validations has its `ƒ Expression` too). Its form edits them:
  the section `constraints`, the message in its row and the condition in an editor under the table, with the properties
  as its variables (`propertiesIn`, `constraintsOf`).
- 15ce19e: The explorer shows, by the metadata of a schema, its state (its data, the files of data/) and its source code: a node for each code, named by its language (TypeScript, Kotlin…) and, for a build of the gateway, its folder (TypeScript · node), with its files and an action that downloads its folder as a .zip; the source code has the build too (also in the commands of the schema, now `BuildDialog`). The code of each language is written in its own folder of src/ (data-gateway 4.1.0).

  Each node of code is built again (its dialog on its language) or deleted (asked first); the build generates the model, the repositories or both (as -m and -r of the CLI).

- 33b5463: Files and panels (`docs/FILES_AND_PANELS.md`): the data table opens the file a property keeps and, with write, uploads
  another to the storage (a URL signed by the gateway) or removes it (`QueryApiPort.files`, `fileUpload`, `fileUrl`); a
  new kind of saved item, the panel (`PanelView`): cards of queries shown as a number, a table, bars, lines or a pie (SVG
  charts of its own), refreshed by hand or every so often.
- 903e67f: What an entity inherits from the entities it extends (`extends`, a chain): its form shows the inherited properties and
  relations apart, by the base that declares them, read only (they are changed in that base, with a link to it), and an
  own one that redefines an inherited one says so; its view says `extends <base>` (the chain in its title) and, in its
  properties and relations, a column Inherited with where each one comes from. Read from the lambdaORM.yaml (with
  schemaRead): the completed domain no longer says `extends`. `inheritanceOf(entities, name)` resolves it as λORM does.

  The link of the inherited ones in the form of one element opens the base's form in a tab of its own
  (`onOpenElement` of `SchemaForms`), keeping what is being edited.

- e0252fe: The commands of a workspace (`CommandsPanel`) for the gateway 4.1.0: the preview of `push` (and of `migrate`) lists
  the changes that can lose data, and runs them only once they are allowed (`allowDestructive`); `migrations` shows the
  history of the stage, with a button to go back to an applied version (`migrate`, after its preview with the undo of
  each later migration); `seed` shows its files and inserts the rows that are not there. `CommandName` takes
  `migrations`, `migrate` and `seed`; `CommandPreview` takes `destructive`, `version` and `files`. A gateway without
  them (4.0.0) doesn't offer them.
- 5285aa3: The options of a query are a form (`OptionsForm`): each field may stay empty and says what is valid; `stage` and `view`
  offer those of the schema (the new optional `stages` and `views` of `QueryApiPort`, from `GET /{schema}/stages` and
  `/views` in `RestQueryApi`), `chunkSize` takes a whole number, `tryAllCan` default / yes / no, `headers` pairs of name and
  value, and a script adds `timeout` and `maxIterations`. The JSON is still what a query keeps (saved, in its history): the
  form can switch to it, keeps the options it doesn't know, and an invalid JSON is fixed as JSON.

  Under the query, the options are one line (what is set, or that none is) with an Edit button that opens them in a
  dialog, as a form or JSON; the data folds while it is empty and opens when something fills it; the editor of the query
  is taller.

- f233117: The options of a query (`OptionsForm`, `optionsFieldsOf`, `optionsTextOf`) no longer have a view: the gateway decides
  it by the identity and drops the one of a client. `OptionsFields` loses `view` and `OptionsMessages` loses `view` and
  `viewHint`; a view in the options of a query saved before is kept as an option the form doesn't know.
- cc52a55: The properties of an entity show their `readValue` and `writeValue` too (`PropertyInfo`, `PROPERTY_EXPRESSIONS`,
  `expressionsOf`): a property with expressions has `ƒ Expression` in its row, and selecting it shows them under the table
  in the colors of 3xpr. Its form edits them: the column `expressions` of the properties opens, under the table, an editor
  for each one (`readExp`, `writeExp`, `readValue`, `writeValue`) whose variables are the properties of the entity
  (`ExpressionInput` takes `variables` and `height`). The tables of a form line up: each cell its field without
  overflowing, the checks centered, the widths by kind of column, and an empty select says what it means (`string`,
  `oneToMany`).
- 4d53d7a: The query wizard: the tables as in a diagram, each field with a check, the + of a table adding its related ones (a
  relation, to one or to many, as an include of its own with its fields); a filter on the entity it starts
  from with its suggestions, the order and the page, not applied when empty. It writes the query in a new tab, and stays
  with it (and with the saved query) to be opened again. The icon of formatting a query is an indent.
- e30849c: Roles with their views and stages (data-gateway 4.4, `docs/ROLE_SCOPES.md`): `WhoAmI` has `stage`, `views`, `stages`,
  `roles` and `maxRows`; the options of a query (`OptionsForm`) offer the stages the roles of the credential allow and,
  when there is more than one, the view (`OptionsFields.view`).
- d2659ec: The history of a schema (`HistoryView`): who changed what and when, the newest first, with the JSON Patch of a change
  and the element before and after; a tab History in an entity (its changes) and in the view of the schema. A form or the
  YAML that meets a 412 says who changed it (`details.changedBy`). A change of another session (`workspace.changed` with
  who) is announced with a Refresh (`WorkspaceConnection.session`, `changes` with the event). An entity links to its
  traces when the connection says where (`tracesUrl`). `AdminApiPort.history`, and the types `SchemaChange`,
  `ChangeActor`, `JsonPatchOperation`, `WorkspaceChangeEvent`.
- a512079: The diagram of a stage (`StageDiagram`, and a button on each stage of the explorer): the Data Gateway and, under it, each source of the stage in its order with the tables that live in it (their name by its mapping) and those whose reads or writes it takes; an arrow from each source to the gateway shows its condition below, in the colours of the editor. The routing comes from the gateway (`GET /admin/workspaces/{schema}/stages/{stage}/routing`, data-gateway 4.1.0).

  Its toolbar: select or move the view, zoom (also with the wheel) and fit, the tables of each source or only their names, the gateway on top or on the left; the boxes are dragged where one wants (several selected at once), lay out again puts them back, and how it was left is kept with its tab.

  Save keeps it in a project like any diagram (a name, a description, a folder; Save as… a copy): with workbenchWrite in the workspace of the schema, shared, otherwise in the browser. The button of its stage opens the one saved, as it was left.

- 72a2b26: `vector` and `point` (λORM 3.15): the forms of the schema offer them (a vector's dimensions in `length`) and the
  indexes of the engine (`hnsw`, `ivfflat`, `spatial`, with their distance); the data table shows a point as "longitude,
  latitude" with a link to a map and edits it in two fields (sent as GeoJSON), and a vector by its first numbers and how
  many, edited only in the form of a row as JSON checked against its dimensions.
- 5ce25f5: The workbench says the view of λORM of the credential next to its name and permissions (`WhoAmI.view`, the gateway
  4.1.0 chooses it by the identity: `docs/VIEWS_BY_IDENTITY.md`).
- ce94eb0: The query wizard shows a table without a map with every field ticked, and its title has a check for all of them: off, only its primary key; a field unticked leaves the others, and all of them ticked again is no map. A map with every field of its table is read as no map. Its buttons are at the bottom right.
- a7bfb0c: The query wizard opened on a query it didn't write, or on one it wrote and that was edited by hand since, reads it: the entity it starts from, its includes (each with the fields of its map and its own includes), the fields of its map, the filter, the order and the page. What it can't show (a computed or renamed field, the filter of an include, a groupBy…) is listed in the wizard, which leaves it out of the query it writes; a query it wrote is updated in its tab, its boxes where they were. Several boxes selected in the diagram of the wizard are taken out at once.
- 83ddcfb: The explorer as the workspace is: each schema with Metadata (config (the lambdaORM.yaml read first, Edit / Save / Cancel), domain
  (entities, enums), application, infrastructure (mappings, sources, stages, the variables of the .env), data and src →
  model, their files read only) and Projects (the folders at the top of what is saved). Each element opens in its own
  tab, read first with Edit. Selecting the schema opens its tab: the commands as a toolbar of icons (the description on
  hover; import, introspect, incorporate and build open a form), and what the schema is (its name, description and
  version) with Edit; a new schema can start with its name and description. In a stage, each source is chosen with its
  condition, an expression of 3xpr with suggestions (`ExpressionInput`) checked while it is written, in order. The tabs
  close one by one, all but one or all (right click on a tab, or ⋯). The icons are Lucide's (`lucide-react`), in the
  color of the theme. `FileView`. Where the workspace was (its tabs and their drafts, what is unfolded) is restored after a reload: kept by the
  gateway for the credential (`/admin/session`) or in the browser (`session` prop, `GatewaySessionStore`,
  `BrowserSessionStore`, `FallbackSessionStore`). A condition of a stage shows in the colors of 3xpr (`ExpressionView`) and is written in its own form
  (`ExpressionDialog`: the editor with the colors, the suggestions and the check of 3xpr, and the variables of a sentence
  with their values). A diagram shows all the properties, the keys (PK and FK), the primary key or the names (`detail`,
  saved with it), lists the related tables of a box out of the diagram with its + to check which to add, exports as PDF, PNG or SVG, and selects several boxes (Shift/Ctrl+click, a rectangle with the select tool or
  Shift+drag, Ctrl+A) to move them together or remove them; its bar has the select and move tools and the zoom. The suggestions of a query or a script are λORM's (`lambdaCompletions`): the clauses, the properties of an entity
  with the icon of their type (text, number, boolean, date, JSON, uuid, enum), its relations (one or a list), the
  parameters of the lambdas resolved through relations, and the functions of the type of a property (`p.createdAt.` → the
  date functions), each with its signature. The json and yaml views of a result are Monaco editors, read only. The
  Workspace shows pages of the application as tabs (`pages`, `openPage`). A diagram gives the query of its data (its root with the others included through their relations: `diagramQuery`)
  in a new tab; a query is copied and formatted (`formatQuery`: a clause per line, long lists an item per line). The
  result flows with the page (one scroll; at their ends the editors give the wheel to the page). The numbers and dates of
  the tree and the table show in the format of a culture (`culture`, `formatValue`). The form of a condition is wide and
  resizable; the expressions listed (conditions, readExp, writeExp, constraints) show in the colors of 3xpr in every theme. The Workspace connects to several data-gateways (`connections`: `WorkspaceConnection`, each with its heading, its
  explorer, what its credential may do and its saved items; a tab belongs to one); without them, one, as before.

### Patch Changes

- b7a5325: An abstract entity is drawn apart in the diagrams: a dashed border and a header of its own colour (in the light and the
  dark theme, and in what is exported), its name in italics with «abstract» after it, the class `lw-abstract`.
- cb2db54: A connection in the tree is a card (a soft border, rounded, its explorer inside) with its heading on one line: the
  name, and its URL smaller and muted.
- b242b65: The layout of the `Workspace`: the explorer paints its background along its whole height (not only as far as its
  tree), and the tab bar is flat and in one row (scrolled sideways when the tabs don't fit), the active tab joined to its
  content with a line of the accent on top, its × inside it (shown on the active one and on hover), and `+` and `…` as icon
  buttons. No change of behavior.

  The toolbars: every control of a bar has one height, its groups are apart, query / script is a segmented control, the
  sections of an entity and the views of a result are tabs with a line under the chosen one, and the bar of a diagram is a
  strip over its canvas. Tabs opened in the same tick (before a render) no longer share an id.

- daaacf8: The side of `Workspace`: the box of the last connection fills its height and grows with its tree; past the height the
  side scrolls, its heading stays.
- 6fae87d: A visual pass: one palette and design tokens (spaces, text sizes, radii, heights, shadows) for every view; a hover, a
  pressed state and a focus ring on the controls; dialogs, menus and tables on those tokens (the rows of a table
  alternate); the labels in one style; dark text on the accent of the dark theme. The summary of a diagram reads
  "entities: 3 · relations: 2" (no plural to get wrong).
- 6416442: Seen reviewing the wiki: Workbench → New project opens a dialog titled New project (it said New folder); the tab
  Relations (n) of an entity counts its own relations, as the explorer (not those of Referenced by); the keys of an
  entity are edited in the tab Keys and indexes of its form, named as in its view; the help of the filter of the query
  wizard shows an example with the fields of its entity; the variables (.env) have the headers of their columns.

  The texts follow one rule in the ten languages: the names of the lambdaORM.yaml and of the API stay as written (Sources,
  Mappings, Stages, domain, plan, metadata, execute, Workbench: no Quellen or Sorgenti) and the rest is translated: the
  tabs of a result (árbol, tabla; json and yaml are names), Metadata (Metadatos), and About with the word the IDE uses
  (Acerca de, Über…). `Messages` takes `viewTree` and `viewTable`.

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
