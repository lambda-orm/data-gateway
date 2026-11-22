# Plan: administrar esquemas desde la gateway y la UI

Hoy la Data Gateway y su UI solo **leen** el esquema: consultas, el dominio en YAML de solo lectura, el explorador,
formularios de entidad y diagramas. Este plan las vuelve un **entorno de trabajo** completo:

1. **crear, editar y eliminar esquemas** de λORM, cada uno con su **workspace** en el volumen de la gateway;
2. ver el esquema **entero en YAML con Monaco** y, a la vez, **cada sección y elemento en formularios** para crearlo,
   editarlo o eliminarlo;
3. **concurrencia** (dos personas o una persona y un agente no se pisan) y **refresh** (lo que cambia otro se ve);
4. **carpetas con consultas, scripts y diagramas** guardados, como los de la UI hoy, pero **en el workspace** y
   compartidos;
5. ejecutar desde la UI **todos los comandos de la CLI**: `version`, `init`, `build`, `schema`, `push`, `pull`,
   `fetch`, `introspect`, `incorporate`, `drop`, `import`, `export`.

Decidido con el usuario el 2026-11-22.

## 0. Punto de partida

- Los esquemas son **estáticos**: `orm.schemas[]` de `data-gateway.config.yaml` (`path`, `workspace`, `env`, overrides).
  El supervisor arranca un worker por esquema, lo vigila y lo reinicia si cae; no hay alta, baja ni recarga en caliente.
- El `lambdaORM.yaml` se lee al arrancar el worker. Nadie lo escribe salvo `pull`, `introspect` e `incorporate` de lib
  (`fileSchemaService.write`), que lo reescriben con `js-yaml.dump`: **pierden los comentarios y el orden**.
- Los comandos de la CLI son, casi todos, una llamada a lib: `orm.stage.push|pull|fetch|drop|import|export|introspect|
  incorporate`, `orm.schema.*`. Las excepciones son `init` (crea la estructura del workspace) y `build` (genera el
  modelo y los repositorios por lenguaje, en `cli/src/lib/infrastructure/languages`).
- Los permisos de una credencial: `read`, `write`, `script`, `queue`, `stageImport`. La UI muestra o deshabilita cada
  acción según `whoami`.
- Los cambios de estado de un esquema ya se notifican por WebSocket (`schema.statusChanged`).
- La UI ya guarda **carpetas, consultas y diagramas** (anidadas, con nombre y descripción, mover arrastrando), pero
  **en el navegador** (IndexedDB, por gateway y credencial): otro navegador u otra persona no los ve; se comparten
  exportando un JSON.

## 1. Decisiones

| Tema | Propuesta |
| --- | --- |
| Dónde viven los workspaces | un directorio raíz en el volumen, `orm.workspacesPath` (`/workspaces`): **cada subcarpeta con un `lambdaORM.yaml` es un esquema**, y su ruta es el nombre de la carpeta (`iot/v1` → `/workspaces/iot/v1`). Los `orm.schemas[]` del config siguen valiendo, para dar overrides o esquemas fuera de la raíz |
| Estructura de un workspace | la de `lambdaorm init`: `lambdaORM.yaml`, `data/`, `src/`, `src/model/` (con `build`), `orm_state/`, `.env` para las conexiones (§5) y `workbench/` para las consultas, scripts y diagramas guardados (§3.5) |
| Activación | **apagado por defecto**: `admin.enabled: false`. Una gateway de producción sigue siendo de solo lectura aunque tenga la UI |
| Permisos nuevos | `schemaRead` (ver el YAML y la infraestructura completa, sin secretos), `schemaWrite` (editar el esquema), `schemaAdmin` (crear y eliminar workspaces), `ddl` (`push`, `pull`, `drop`, `incorporate`), `build`, `workbenchWrite` (guardar consultas, scripts y diagramas en el workspace, sin poder tocar el esquema). `stageImport` ya existe y cubre `import`; leer lo guardado pide `read` |
| Formato del archivo | editar con el paquete `yaml` (eemeli), con su `Document`: **se conservan los comentarios, el orden y el estilo**. También para `pull`, `introspect` e `incorporate` cuando corren desde la gateway (dejan de usar `js-yaml.dump`) |
| Concurrencia | optimista: cada lectura devuelve la **versión** del archivo (hash del contenido, `ETag`) y cada escritura la exige (`If-Match`); si cambió, `412` con la versión actual. Más un **candado por workspace** para los comandos (§4) |
| Refresh | un **watcher** del volumen (lo que cambia otro, la gateway o alguien con un editor) y una notificación `workspace.changed` por WebSocket; la UI recarga lo que no estás editando y avisa sobre lo que sí |
| Aplicar un cambio | guardar valida el esquema completo con lib (sin conectar); si es inválido, no se escribe (`422` con los errores y sus líneas). Si es válido, se escribe atómico (archivo temporal + `rename`) y **se reinicia solo ese esquema**; los demás siguen atendiendo |
| Comandos destructivos | en dos pasos: **ver** (`push -o`, `fetch`, `drop` con las sentencias) y **confirmar** esa misma vista; si el esquema cambió entre medio, se pide ver de nuevo |
| Conexiones | un `.env` por workspace, editable desde la UI con `schemaAdmin` y nunca devuelto; el entorno de la gateway sigue valiendo. Un adapter de secretos, más adelante (§5) |
| `build` | escribe en `src/` del workspace y además se descarga como `.zip` (§6) |
| YAML inválido cambiado fuera | el esquema queda en `error` con el motivo y la línea, y **sigue atendiendo con la última versión válida** |
| MCP | en la fase 6, solo ver, validar y `fetch`; escribir y los comandos destructivos quedan fuera hasta definir cómo confirma un agente |

## 2. La gateway

### 2.1 Registro dinámico de esquemas

- `SchemaRegistry` (application) une los `orm.schemas[]` del config y las carpetas de `orm.workspacesPath`, y avisa
  altas, bajas y cambios. El supervisor gana `add(path)`, `remove(path)` y `reload(path)`: arranca, para o reinicia un
  worker sin tocar los demás.
- El borde (las rutas REST, el MCP por esquema, el WebSocket) se registra y se da de baja con el esquema: hoy se arma
  una vez al arrancar.
- Un esquema nuevo arranca en `starting` y pasa a `ready` o a `error` con su motivo, como cualquier otro.

### 2.2 Rutas de administración

Bajo `/admin` (fuera de las rutas de un esquema, para que existan aunque el esquema no arranque):

| Método | Ruta | Hace | Permiso |
| --- | --- | --- | --- |
| `GET` | `/admin/workspaces` | los workspaces, con su estado y su versión | `schemaRead` |
| `POST` | `/admin/workspaces` | crea uno (`{ path, template?: 'empty' \| 'northwind' \| <otro workspace> }`), como `init` | `schemaAdmin` |
| `DELETE` | `/admin/workspaces/{path}` | lo elimina; pide el nombre de nuevo (`?confirm={path}`) y lo mueve a `/.trash` | `schemaAdmin` |
| `GET` | `/admin/workspaces/{path}/schema` | el `lambdaORM.yaml` como texto, y su versión (`ETag`) | `schemaRead` |
| `PUT` | `/admin/workspaces/{path}/schema` | lo reemplaza entero (lo que hace el editor YAML); `If-Match` | `schemaWrite` |
| `PATCH` | `/admin/workspaces/{path}/schema` | cambia un elemento (lo que hacen los formularios, §2.3); `If-Match` | `schemaWrite` |
| `POST` | `/admin/workspaces/{path}/validate` | valida un texto sin guardarlo: los errores con su línea | `schemaRead` |
| `GET` | `/admin/workspaces/{path}/files[/{file}]` | el árbol del workspace y un archivo (`data/`, `src/`, …) | `schemaRead` |
| `PUT`, `DELETE` | `/admin/workspaces/{path}/files/{file}` | sube o elimina un archivo (los datos de `import`, `introspect`) | `schemaWrite` |
| `POST` | `/admin/workspaces/{path}/commands/{command}` | corre un comando (§4) | el del comando |
| `GET` | `/admin/workspaces/{path}/workbench[/{item}]` | el árbol de carpetas, consultas, scripts y diagramas (§3.5), y uno con su versión | `read` |
| `PUT`, `DELETE` | `/admin/workspaces/{path}/workbench/{item}` | guarda o elimina uno (o una carpeta, con lo que tiene); `If-Match` | `workbenchWrite` |
| `POST` | `/admin/workspaces/{path}/workbench/{item}/move` | lo mueve o renombra (`{ to }`) | `workbenchWrite` |
| `GET` | `/admin/workspaces/{path}/jobs[/{id}]` | los comandos en curso y los últimos, con su salida | `schemaRead` |

Las mismas operaciones por WebSocket (`admin.*`). Por MCP, solo ver, validar y `fetch` (fase 6): escribir y los
comandos destructivos no, porque un agente los llamaría sin la confirmación de la UI.

### 2.3 Cambios por elemento

Cada formulario manda **un cambio sobre un elemento**, no el archivo entero, para que dos personas que editan cosas
distintas no choquen:

```json
{ "op": "set", "at": ["domain", "entities", "Products", "properties", "price"], "value": { "type": "decimal", "required": true } }
{ "op": "add", "at": ["domain", "entities"], "value": { "name": "Suppliers", "primaryKey": ["id"], "properties": [] } }
{ "op": "remove", "at": ["infrastructure", "sources", "legacy"] }
{ "op": "rename", "at": ["domain", "entities", "Products"], "to": "Product" }
```

- `at` nombra los elementos de una lista **por su nombre**, no por su posición: `Products`, no `entities[3]`.
- Se aplica sobre el `Document` de `yaml`: el resto del archivo, con sus comentarios, queda igual.
- `rename` cambia también las referencias: relaciones (`entity`), mappings, `extends`, stages. La respuesta dice qué
  más cambió.
- **Concurrencia por elemento:** el `If-Match` puede ser la versión del archivo o la del elemento (el hash de su
  nodo). Si otro cambió ese mismo elemento, `412`; si cambió otro elemento, el cambio se aplica igual sobre la versión
  nueva.
- Un cambio que deja el esquema inválido no se guarda: `422` con el error.

### 2.4 Concurrencia, en resumen

| Caso | Qué pasa |
| --- | --- |
| Dos personas editan **elementos distintos** | se aplican los dos; cada una ve el cambio de la otra por `workspace.changed` |
| Dos personas editan **el mismo elemento** | el segundo recibe `412` con el valor actual; la UI muestra las dos versiones y deja elegir |
| Alguien guarda el YAML entero sobre una versión vieja | `412`; la UI ofrece un diff de tres vías (lo que abrió, lo que hay, lo suyo) en Monaco |
| Un comando corre en un workspace | los otros comandos de ese workspace esperan o responden `409 busy` (a elección del que llama); editar el esquema sigue permitido, y el comando trabaja con la versión con que empezó |
| El archivo cambia fuera de la gateway (un editor, `git pull`) | el watcher lo ve, valida, notifica y reinicia el esquema; si quedó inválido, el esquema queda en `error` con el motivo y la línea, y el último válido sigue atendiendo |
| Varias réplicas de la gateway sobre el mismo volumen | el candado es un archivo (`.lambdaorm.lock`, con `O_EXCL` y vencimiento); la versión es el hash del contenido, sin estado en memoria |

## 3. La UI

### 3.1 Workspaces

- La lista de esquemas del explorador gana **Nuevo**, **Eliminar** y **Duplicar** (con permiso `schemaAdmin`).
- Cada esquema muestra su estado y, si está en `error`, el motivo y un enlace a la línea del YAML que falla.

### 3.2 El esquema en YAML

- El YAML **editable** en Monaco, con:
    - validación mientras se escribe (`/validate`), los errores marcados en su línea;
    - autocompletado de las claves del esquema, a partir del JSON Schema de `lambdaORM.yaml` (hay que generarlo desde
      los tipos de `base`), y de los nombres (entidades, sources, mappings);
    - **Guardar** (Ctrl+S) con `If-Match`, y el diff de tres vías si hubo conflicto;
    - un aviso, sin perder lo escrito, cuando otro guardó una versión nueva.

### 3.3 El esquema en formularios

Un árbol con cada sección, y un formulario por elemento con **Crear**, **Guardar** y **Eliminar**:

| Sección | Elementos | Formulario |
| --- | --- | --- |
| Dominio | entidades | nombre, `extends`, `abstract`, `view`, clave primaria, clave única; sus **propiedades** (tipo, enum, largo, requerida, autoincremental, default, expresiones de lectura y escritura), **relaciones** (tipo, entidad, `from` / `to` de uno o varios campos, débil), índices, constraints |
| Dominio | enums | nombre, valores |
| Infraestructura | sources | nombre, dialecto, mapping, la conexión (§5) |
| Infraestructura | mappings | por entidad: tabla, por propiedad la columna y su `dbType` |
| Infraestructura | stages | sources por regla, `paths` |
| Infraestructura | views | entidades y propiedades visibles |
| Aplicación | listeners, otros | en YAML, al principio |

- El formulario de entidad que ya existe pasa a ser editable.
- Lo que se cambia en un formulario aparece en el YAML, y al revés: los dos leen el mismo `Document`.
- Eliminar un elemento al que otros apuntan (una entidad con relaciones hacia ella) muestra quiénes y pide confirmar.

### 3.4 Comandos

Un panel **Comandos** por esquema, con un formulario por comando (sus argumentos, los mismos que en la CLI) y la
salida del job en vivo. Los destructivos muestran primero qué van a hacer y piden confirmar (§4).

### 3.5 Carpetas, consultas, scripts y diagramas

Lo que hoy la UI guarda en el navegador pasa a guardarse **en el workspace**, en `workbench/`, y lo ve todo el que
tenga acceso al esquema:

```text
/workspaces/iot/v1/
  lambdaORM.yaml
  workbench/
    reportes/                        una carpeta (se anidan)
      ventas por mes.query.yaml
      cierre mensual.script.yaml
    dominio.diagram.yaml
```

| Archivo | Contiene |
| --- | --- |
| carpeta | una carpeta real del volumen; `.folder.yaml` opcional con su descripción |
| `<nombre>.query.yaml` | `description`, `query`, `data`, `options` |
| `<nombre>.script.yaml` | `description`, `script` (3xpr con `orm.execute`), `data`, `options` |
| `<nombre>.diagram.yaml` | `description`, `entities`, la posición de cada caja y línea, las opciones (nombres de relaciones, solo nombres) |

- Un archivo por elemento y carpetas reales: se pueden versionar con git junto al esquema, y dos personas que guardan
  cosas distintas no chocan.
- Las mismas reglas de hoy: nombre y descripción, mover arrastrando, eliminar una carpeta con lo que tiene, dos
  elementos del mismo tipo no pueden llamarse igual en una carpeta. Los **scripts** pasan a ser un tipo propio (hoy
  son una consulta en modo script).
- Concurrencia y refresh como el esquema: versión por archivo (`If-Match`, `412` con lo que hay si otro lo guardó) y
  `workspace.changed` cuando cambia algo en `workbench/`, también desde fuera de la gateway.
- Un diagrama o una consulta que nombra una entidad que ya no existe se abre igual y la marca (no se pierde).
- **El navegador sigue** como espacio **personal** ("Mis borradores"): sin permiso `workbenchWrite`, o con el admin
  apagado, la UI guarda como hoy. Un elemento se pasa de uno a otro con **Mover al workspace** / **Copiar a mis
  borradores**, y el JSON que exporta la UI hoy se importa al workspace.

## 4. Los comandos

| Comando | Desde la gateway | Paso de vista | Permiso |
| --- | --- | --- | --- |
| `version` | la versión de la gateway, de lib y del esquema | — | `schemaRead` |
| `init` | crea el workspace (`POST /admin/workspaces`) | — | `schemaAdmin` |
| `build` | genera el modelo y los repositorios en `src/` (§6) | la lista de archivos que va a escribir | `build` |
| `schema` | el esquema completo o una parte | — | `schemaRead` |
| `push` | sincroniza las bases de datos con el modelo | **sí**: las sentencias por source (`push -o`) | `ddl` |
| `pull` | actualiza el esquema con la estructura de las bases | **sí**: el diff del YAML | `ddl` + `schemaWrite` |
| `fetch` | las diferencias entre las bases y el modelo | — (ya es una vista) | `schemaRead` |
| `introspect` | lee un archivo de `data/` (o subido) y actualiza el esquema | **sí**: el diff del YAML | `schemaWrite` |
| `incorporate` | `introspect`, `push` e `import` | **sí**: el diff y las sentencias | `ddl` + `schemaWrite` + `stageImport` |
| `drop` | elimina los objetos de las bases | **sí**: las sentencias, y escribir el nombre del stage | `ddl` |
| `import` | importa un archivo de `data/` (o subido) | la cantidad de filas por entidad | `stageImport` |
| `export` | exporta los datos a `data/` o como descarga | — | `read` |

- Cada comando es un **job**: un id, su estado (`queued`, `running`, `done`, `failed`), su salida a medida que sale (por
  WebSocket, `job.output` / `job.finished`) y su resultado. Los últimos quedan en `orm_state/jobs/` del workspace.
- Corre en el **worker del esquema** (o en uno temporal, si el esquema no arranca: `pull` y `fetch` tienen que poder
  correr justamente cuando el esquema todavía no coincide con la base).
- El paso de vista devuelve un `previewId`; confirmar manda ese id. Si la versión del esquema cambió desde la vista,
  `409` y se ve de nuevo.
- Se auditan como las escrituras: credencial, comando, argumentos, resultado.
- La CLI y la gateway comparten el código de los comandos: se mueven de `cli` a un módulo común (en `lib`, o un paquete
  nuevo `@lambdaorm/workspace`), y la CLI queda como su interfaz de línea.

## 5. Conexiones

Un esquema nuevo necesita las conexiones de sus sources, y hoy salen de `${VAR}` resueltas con el entorno de la gateway
o con `orm.schemas[].env` del config, que es estático. Opciones:

1. **`.env` del workspace**, en el volumen, editable desde la UI con `schemaAdmin`; la UI nunca devuelve el valor, solo
   si está definido. Simple, pero los secretos quedan en el volumen en texto.
2. **Solo variables de entorno de la gateway**: la UI edita el nombre (`${ORM_IOT_CNX}`) y no el valor; hay que
   reiniciar la gateway, o el contenedor, para dar una nueva.
3. **Un proveedor de secretos** (Vault, AWS Secrets Manager, Kubernetes secrets) con un adapter: lo correcto para
   producción, más trabajo.

Decidido: 1 y 2 juntas (el `.env` del workspace y, si no está, el entorno de la gateway), con 3 como adapter más adelante.

## 6. `build`

`build` genera el modelo y los repositorios para un lenguaje (hoy Node y `clientNode`) en `src/`. Dentro de la gateway
puede:

1. escribir en `src/` del workspace, en el volumen, para que otro lo tome de ahí;
2. devolver los archivos como un `.zip` para descargar, sin escribir nada;
3. las dos.

Decidido: 3.

## 7. Seguridad

- Todo esto está **apagado por defecto** (`admin.enabled`) y con permisos propios: una credencial `[ read ]` no ve
  nada nuevo.
- El YAML que se devuelve **no tiene secretos**: una conexión escrita en el YAML (no como `${VAR}`) se devuelve como
  `***` y, al guardar, `***` deja el valor que había.
- Las rutas de archivos se resuelven dentro del workspace (sin `..`, sin enlaces que salgan de él).
- Los límites de tamaño de `server.requestBodySize` valen también para subir archivos; uno propio,
  `admin.maxFileBytes`, para los datos.
- Las operaciones del admin se auditan siempre, aunque `audit.enabled` sea `false` para las consultas.

## 8. Fases

| Fase | Qué | Resultado |
| --- | --- | --- |
| 1 ✅ | **Registro dinámico**: `orm.workspacesPath`, alta, baja y recarga de un esquema sin reiniciar la gateway, el watcher y `workspace.changed` | una carpeta nueva en el volumen aparece en la UI; un YAML editado a mano se recarga |
| 2 | **Editar el YAML**: `GET` / `PUT` / `validate` con versión, Monaco editable, el diff de conflicto, crear y eliminar workspaces; **`workbench/`**: carpetas, consultas, scripts y diagramas en el workspace, con su versión y su refresh, y pasar lo del navegador | el esquema se edita entero desde la UI, y lo guardado se comparte |
| 3 | **Comandos**: los comandos en un módulo común, jobs, la vista previa de los destructivos y el panel de la UI | todos los comandos de la CLI desde la UI |
| 4 | **Formularios**: `PATCH` por elemento, `rename` con referencias, el árbol y los formularios de cada sección | el esquema se edita sin escribir YAML |
| 5 | **Conexiones y secretos** (§5), `build` (§6), el JSON Schema de `lambdaORM.yaml` para el autocompletado | un esquema nuevo de cero hasta consultarlo, sin tocar el contenedor |
| 6 | MCP de administración (lectura y validación primero), la wiki, la suite de conformidad con los casos del admin | |

Cada fase se publica como una versión menor de la gateway (3.2.0, 3.3.0, …) y de `@lambdaorm/ui`, con el admin apagado
por defecto.

## 9. Estado

- **Fase 1 (hecha, 3.2.0):** `orm.watch`, alta, baja y recarga blue-green de un esquema (el último que arrancó sigue si
  el nuevo no arranca, con el motivo en `pending`), el ruteo dinámico de los cuatro transportes, el monitor del volumen
  (eventos + recorrido, por contenido) y `workspace.changed`. En la UI, ver §3.1.
- **Fase 2a (hecha):** la API `/admin` (`DATA_GATEWAY.md` §11): workspaces creados y eliminados (a `.trash`), el
  `lambdaORM.yaml` con versión (`412` / `428`), su validación (con línea; sin ejecutar `application.start`) y
  `workbench/` como archivos. Permisos `schemaRead`, `schemaWrite`, `schemaAdmin`, `workbenchWrite`, nunca por defecto.
  Pendientes: 2b, el editor YAML y crear / eliminar en la UI; 2c, lo guardado de la UI en el workspace.
- Encontrado en la fase 1: λORM arranca un esquema con un tipo que no existe (`type: nope`) sin error; la validación de
  la fase 2 tiene que marcarlo.

## 10. Pruebas

- Unitarias: los cambios por elemento sobre el `Document` (que no toquen comentarios ni el resto), `rename` con sus
  referencias, la versión por elemento.
- Integración: dos clientes editando a la vez (mismo elemento y distintos), un archivo cambiado fuera, el candado de
  comandos, un esquema que pasa a inválido y vuelve, alta y baja con el resto atendiendo.
- Con el modelo de Ilusor (`tests/fixtures/ilusor`): editar una entidad de un esquema de 192 y que el resto del archivo
  quede igual byte a byte.
- E2E de la UI con Chrome headless (como en 3.1.0): crear un workspace de Northwind, editar una propiedad por
  formulario, ver el cambio en el YAML de otra pestaña, `push` con su vista y `execute`.
