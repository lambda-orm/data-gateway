# @lambdaorm/ui

[![npm version](https://img.shields.io/npm/v/@lambdaorm/ui.svg)](https://www.npmjs.com/package/@lambdaorm/ui)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Documentation:** [lambda-orm.github.io/wiki](https://lambda-orm.github.io/wiki) (English, Deutsch, Español, Português)

A database IDE for your [λORM](https://lambda-orm.github.io/wiki/) schemas, as React components you can put in your
own application — the same one the [Data Gateway](https://lambda-orm.github.io/wiki/data-gateway/) serves at `/ui`:

- an **explorer** of the schemas: the domain, each entity as a form (properties, relations, keys, its rows), saved
  queries and diagrams in folders;
- **query tabs** with a Monaco editor that **autocompletes the domain** (`Orders.filter(p => p.customer.` → its
  properties) and marks errors while you type;
- results as a **tree, table, JSON or YAML**, with downloads; `plan` shows the SQL of each source;
- **diagrams** of the domain (class / entity-relationship), laid out by themselves and editable;
- only the actions the **credential's permissions** allow; ten languages.

![The UI](https://raw.githubusercontent.com/lambda-orm/wiki/main/docs/ide/images/ide-query.png)

## Install and mount

```bash
npm install @lambdaorm/ui react react-dom
```

```tsx
import { QueryWorkbench } from '@lambdaorm/ui'
import '@lambdaorm/ui/styles.css'

<QueryWorkbench
  baseUrl="https://gateway.example.com"     // the REST transport of the data-gateway
  schema="iot/v1"                           // optional: without it, a selector of the ready schemas (the only one, chosen)
  headers={() => ({ 'X-Api-Key': token })}  // how to authenticate; the library keeps no credential
  theme="dark"
  onResult={result => console.log(result.operation, result.durationMs)}
/>
```

- `api={myAdapter}` instead of `baseUrl`: anything that implements `QueryApiPort` (for example through a backend of
  your own). `RestQueryApi` is the adapter for the REST API.
- `operations={['plan', 'execute']}` limits the actions; `history={false}` keeps no history (by default the last 30
  queries of each schema go to `localStorage`, never credentials nor results).
- The parts are exported too: `QueryEditor`, `ScriptEditor`, `DataEditor`, `ResultViewer`, `SchemaSelector`,
  `WorkbenchController` (the state and actions, without React).
- `locale="es"`: the labels and messages in `en`, `es`, `pt`, `fr`, `it`, `de`, `nl`, `ca`, `gl` or `eu` (`LOCALES`
  lists them with their names); the action names stay the API's.

## Tabs and the diagram of the domain

```tsx
<QueryTabs baseUrl={url} headers={headers} diagram locale="es" />
```

`QueryTabs` takes the props of `QueryWorkbench`: several workbenches in tabs (add, close, rename with a double click;
`maxTabs`, 10 by default). With `diagram`, a first fixed tab draws the domain of the schema with `DomainDiagram`; a
double click on an entity opens a tab that queries it.

`DomainDiagram` (on its own too) draws the domain (GET `/{schema}/domain`) as a class / entity-relationship diagram:
a box per entity with its properties, types, PK and FK (required ones in bold), a line per relation with its
cardinality (1 — N) and a dashed one per inheritance. It starts on the most connected entity and its neighbours; it
can show 2 levels or the whole model, names only, and export SVG and PNG. The boxes are laid out by
[ELK](https://github.com/kieler/elkjs) (`elkjs`, loaded on first use; `layout` takes another `LayoutPort`). An
`api` of your own gives the domain with `QueryApiPort.domain`.

## Workspace: explorer, entities, saved queries and diagrams

```tsx
<Workspace baseUrl={url} headers={headers} locale="es" workspaceKey={`${url}|${user}`} />
```

An explorer of the schemas on the left and tabs on the right. Each schema shows:

- its domain as YAML, read only (only GET `/{schema}/domain`: never the sources nor the connections);
- its entities, each with its properties and its relations; a double click opens the form of the entity, as a
  database IDE shows a table: properties (type, length, required, PK, auto, default, the entity a foreign key
  references, expressions), relations and what references it, keys, indexes and constraints, its rows (read only, by
  pages) and its diagram;
- what was saved in it: folders, which nest, queries and diagrams, each with a name and a description, moved by
  dragging them. A query tab saves with Save, Save as… or Ctrl+S and shows • while it has unsaved changes. A diagram
  is created choosing its entities (one by one, or adding the neighbours of the chosen ones); its boxes are laid out
  by themselves, can be dragged and are taken out with their × (or Delete), its lines can be moved sideways (a double click puts one back), the names of the
  relations can be shown on them, and all of it is saved ("lay out again" goes back to the automatic places).

What is saved stays in this browser: IndexedDB, one database per `workspaceKey` (for example the gateway and the
user). It doesn't reach other browsers or devices, and it goes if the site data is cleared; the explorer exports the
whole workspace to a JSON file and imports it back (added to what there is, or instead of everything). `store` takes
another `WorkspaceStore` (`MemoryWorkspaceStore`, or a backend of your own).

## Monaco

Monaco is loaded on first use and its workers come from your bundler. With Vite:

```ts
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

self.MonacoEnvironment = {
  getWorker: (_id, label) => label === 'typescript' || label === 'javascript' ? new TsWorker()
    : label === 'json' ? new JsonWorker() : new EditorWorker()
}
```

Without Monaco (no workers), the editors are plain text areas and everything else works.

The autocompletion comes from `GET /{schema}/typings` of the gateway (the domain as declarations) plus the
`Queryable` declarations of `@lambdaorm/base`, embedded at build time. While writing, the query is checked with λORM
(`metadata`) and its errors are marked in the editor.

## Documentation

- [The IDE in the λORM wiki](https://lambda-orm.github.io/wiki/ide/), with screenshots, and how to put it in
  an application of your own
- [Change log](CHANGELOG.md)

## Development

```bash
npm run build   # declarations of base, Vite (ESM + CJS + styles.css), types
npm test        # Vitest + Testing Library
```

## License

MIT
