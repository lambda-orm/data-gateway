---
'@lambdaorm/ui': minor
---
The explorer as the workspace is: each schema with Metadata (config (the lambdaORM.yaml read first, Edit / Save / Cancel), domain
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

