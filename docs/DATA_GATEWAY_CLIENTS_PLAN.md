# Plan: clientes de la Data Gateway (Node, Go, Rust y CLI)

Clientes para consumir la [Data Gateway](DATA_GATEWAY.md) desde Node, Go y Rust, más una CLI, con **una sola API** en
los cuatro y el **transporte elegido por la cadena de conexión**: API REST, WebSocket (JSON-RPC), MCP por Streamable
HTTP, MCP por HTTP+SSE o MCP por WebSocket. La misma consulta de λORM, desde cualquier lenguaje y por cualquier vía.

Decidido con el usuario el 2026-11-20. Va antes de actualizar `lambdaorm-labs` a 3.x (los labs pasan a usar estos
clientes).

## 0. Punto de partida

- La gateway (3.0.x) expone cada esquema por cuatro transportes, cada uno en su puerto (`transports.<t>.port`):
  `http` (REST + Swagger), `webSocket` (JSON-RPC 2.0 con notificaciones), `mcpHttp` (Streamable HTTP y, con
  `legacySse`, el HTTP+SSE viejo) y `mcpWebSocket` (MCP sobre WebSocket, no estándar). Rutas: `DATA_GATEWAY.md` §4.
- Las tools del MCP tienen **paridad completa con REST** (`DATA_GATEWAY.md` §5.1): `orm_execute` ↔ `POST /execute`,
  `orm_plan` ↔ `POST /plan`, `schema_entities` ↔ `GET /entities`, … Por eso un cliente puede ofrecer las mismas
  operaciones por los cinco transportes.
- `@lambdaorm/client` (en este repo) ya es un cliente de la gateway: REST y WebSocket elegidos por la URL de
  `orm.init` (`http://` o `ws://`), `execute`, `executeQueued`, `executeScript`, `plan`, `metadata`, `model`,
  `parameters`, `constraints`, `schema.*`, `stage.*`, `general.*` y las notificaciones por WebSocket. `@lambdaorm/cli`
  depende de él.
- El repo `core` es privado (y lo sigue siendo) y GitHub Actions está pausado en él (sin presupuesto): el CI es
  `scripts/ci-local.sh`.

## 1. Decisiones

| Tema | Decisión |
| --- | --- |
| Repo | **todo en este monorepo** (decisión del usuario, 2026-11-20), como paquetes: `packages/client-node`, `packages/data-gateway-client-go`, `packages/data-gateway-client-rust`, `packages/data-gateway-cli` y `packages/conformance` (la suite común, §7). Lo de Go se publica además en espejos públicos de solo lectura (§1.1) |
| Nombres de paquete | según el ecosistema: npm `@lambdaorm/data-gateway-client`, Go `github.com/lambda-orm/data-gateway-client-go` (paquete `gateway`), crates.io `lambdaorm-data-gateway-client` (crate `lambdaorm_gateway`), binario `dgw` |
| Transporte | el **esquema de la URL** de la cadena de conexión (§2); nunca una opción aparte |
| Credenciales | aparte de la URL (opciones o variables de entorno), para que no queden en logs ni en el historial |
| Consulta | siempre **texto** con la expresión de λORM (`"Orders.filter(p => p.id == id)"`) y `data` aparte; Node acepta además una función (como hoy: se envía su texto) |
| `@lambdaorm/client` | su código pasa a `data-gateway-client-node`; `@lambdaorm/client` queda como alias que reexporta el nuevo, deprecado, y `@lambdaorm/cli` pasa a depender del nuevo |
| CLI | en Go, sobre el cliente de Go: un binario sin Node, para terminales, scripts y CI. No reemplaza `@lambdaorm/cli` (el ORM local: `sync`, `push`, `pull`, …), que sigue igual |
| Python | fuera de este plan; se suma después con el mismo contrato |
| Versionado | `0.x` hasta pasar la suite de conformidad por los cinco transportes; entonces `1.0.0` |

### 1.1 Monorepo privado y publicación

| Proyecto | Se desarrolla en | Se publica en | ¿Necesita algo público además? |
| --- | --- | --- | --- |
| Node | `packages/client-node` (workspace de pnpm, Changesets) | npm | no: npm publica el `dist/`, como `@lambdaorm/lib` |
| Rust | `packages/data-gateway-client-rust` (`cargo`) | crates.io (`cargo publish` sube el código del crate) | no |
| Go | `packages/data-gateway-client-go` | **espejo público** `lambda-orm/data-gateway-client-go` | **sí**: Go no tiene registro; `go get` baja el código del repo de la ruta del módulo, y un repo privado no se puede bajar |
| CLI | `packages/data-gateway-cli` | binarios en las releases del espejo público `lambda-orm/data-gateway-cli`, tap de Homebrew, `go install` | **sí**, por lo mismo (y las releases de un repo privado no se pueden bajar) |
| Conformidad | `packages/conformance` | — (la usan los paquetes de acá) | no |

- **Espejos de Go:** repos públicos que solo reciben lo que publica `scripts/ci-local.sh`: el contenido de
  `packages/data-gateway-client-go` (o `-cli`) en la raíz (`git subtree split`), su commit y su tag `v<versión>`.
  Nadie desarrolla en ellos; los issues se reciben en el espejo y se resuelven en el monorepo. El `go.mod` del
  paquete ya declara la ruta del espejo, así que dentro del monorepo la CLI lo usa con un `replace` local
  (`go.work`).
- **CI:** como el resto del monorepo, local: `scripts/ci-local.sh` suma `clients` (build, lint y tests de Node, Go y
  Rust, y la suite de conformidad contra la gateway en Docker por los cinco transportes) y `release-go`,
  `release-cli`, `release-rust`. El build de Node entra en `check`.
- pnpm ignora los paquetes de Go y Rust (no tienen `package.json`), salvo un `package.json` mínimo con scripts si
  hace falta para `pnpm -r`.

## 2. Cadena de conexión

```
<esquema>://<host>[:<puerto>][/<basePath>]/<ruta del esquema>[?<opciones sin secretos>]
```

| Esquema de URL | Transporte de la gateway | Qué hace el cliente |
| --- | --- | --- |
| `http`, `https` | `http` | REST: `POST {ruta}/execute`, `GET {ruta}/entities`, … |
| `ws`, `wss` | `webSocket` | JSON-RPC 2.0 en `ws://host/{ruta}`; notificaciones |
| `mcp+http`, `mcp+https` | `mcpHttp` | MCP Streamable HTTP en `{ruta}/mcp`: `initialize`, luego `tools/call` |
| `mcp+sse`, `mcp+sses` | `mcpHttp` con `legacySse: true` | MCP HTTP+SSE viejo: `GET {ruta}/sse` + `POST {ruta}/messages?sessionId=` |
| `mcp+ws`, `mcp+wss` | `mcpWebSocket` | MCP sobre WebSocket en `{ruta}/mcp` |

Ejemplos (puertos de la guía de la wiki: REST 8080, MCP 8081, WebSocket 8083):

```
http://localhost:8080/northwind
ws://localhost:8083/northwind
mcp+http://localhost:8081/northwind
mcp+sse://localhost:8081/northwind
mcp+ws://gateway.internal:8082/iot/v1
https://api.example.com/data/accounts/v1        # basePath "data" detrás de un ingress
```

- **La ruta es la del esquema** (`iot/v1`). Sin ruta (o `/`), el cliente queda a nivel gateway: solo `version`,
  `health`, `schemas`. Con un esquema en la raíz (`path: ""`), `?schema=` vacío lo indica; se resuelve en la
  fase 1 con la gateway real.
- **Opciones en la query, solo sin secretos:** `timeout` (ms), `stage`. Una credencial en la URL (`apiKey=`,
  `token=`, `user:pass@`) es un **error**, no una advertencia.
- **Variables de entorno**, iguales en los cuatro: `DATA_GATEWAY_URL`, `DATA_GATEWAY_API_KEY`, `DATA_GATEWAY_TOKEN`.
  Lo explícito gana sobre el entorno.

## 3. API común

Los nombres siguen la convención de cada lenguaje (`executeQueued` / `ExecuteQueued` / `execute_queued`); la forma
es la misma.

| Operación | Argumentos | REST | WebSocket (JSON-RPC) | MCP (tool) |
| --- | --- | --- | --- | --- |
| `execute` | `query`, `data?`, `options?` | `POST /execute` | `query.execute` | `orm_execute` |
| `executeScript` | `script`, `data?`, `options?` | `POST /script` | `query.executeScript` | `orm_execute_script` |
| `executeQueued` | `query`, `topic`, `data?`, `chunk?`, `options?` | `POST /execute-queued` | `query.executeQueued` | `orm_execute_queued` |
| `plan` | `query`, `options?` | `POST /plan` | `query.plan` | `orm_plan` |
| `metadata`, `model`, `parameters`, `constraints` | `query` | `POST /metadata`, … | `query.metadata`, … | `orm_metadata`, … |
| `schema.get`, `.version`, `.domain`, `.entities`, `.enums`, `.sources`, `.mappings`, `.views`, `.stages` | según el caso | `GET /schema`, … | `schema.*` | `schema_*` |
| `stage.exists`, `.export`, `.import` | `stage`, `data?` | `GET/POST /stages/:stage/…` | `stage.*` | `stage_*` |
| `version`, `health` | — | `GET /version`, `/health` | `general.*` | `gateway_version`, `gateway_health` |
| `schemas` | — | `GET /schemas` (nivel gateway) | `gateway.schemas` (conexión a la raíz) | — |
| `whoami` | — | `GET {ruta}/whoami` | — | — |
| `on(evento, listener)` | `queue.completed`, `queue.failed`, `schema.statusChanged` | — | notificaciones | — |
| `close` | — | — | cierra el socket | cierra la sesión MCP |

- Los nombres exactos de los métodos JSON-RPC se toman de la gateway en la fase 1, no de esta tabla.
- **Resultados tipados:** Go `ExecuteInto[T]`, Rust `execute_as::<T>()` con `serde`, Node genéricos de TypeScript.
- **Operación no disponible en un transporte** (`on` por REST o MCP, `whoami` fuera de REST): error
  `UnsupportedOperation` que nombra el transporte que sí la tiene.

## 4. Opciones de conexión

| Opción | Uso |
| --- | --- |
| `apiKey` | header `X-Api-Key` (o el que diga la gateway), en cada request o en el handshake |
| `token` | `Authorization: Bearer <token>` (service token / JWT) |
| `headers` | headers extra |
| `timeout` | por operación; por defecto 30 s |
| `reconnect` | solo `ws`/`mcp+ws`: reintento con backoff; las suscripciones se rehacen |
| `onTruncated` | solo MCP: `error` (por defecto) o `return` (§6) |

## 5. Errores

Un tipo de error común: `GatewayError { code, name, status, dbCode, message, transport, operation }`. El `code` es
el mismo por los cinco transportes y en los cuatro clientes; la tabla de códigos (`invalid`, `unauthorized`,
`forbidden`, `not_found`, `unique`, `foreign_key`, `conflict`, `timeout`, `too_large`, `rate_limited`,
`unavailable`, `internal`, `truncated`, `unsupported`, `transport`) y dónde trae cada transporte el status, el nombre
y el código de la base están en el [README de la suite](../packages/conformance/README.md#errors), y su
implementación de referencia en `packages/conformance/runner/errors.mjs`.

- **REST:** el status HTTP y el cuerpo `{ error, code, message }` (L30).
- **WebSocket:** `error.data` con `name`, `status` y `code`.
- **MCP:** un resultado `isError: true` trae el texto `"<Nombre>: <mensaje>"` para el modelo y, desde la gateway
  3.1.0, `structuredContent` con `error`, `status`, `code` y `message` para un programa (la 3.0.3 solo traía el texto:
  no se podía distinguir una clave única de una foránea).
- Errores del transporte (conexión, handshake, sesión SSE perdida): `code: "transport"`.

## 6. MCP como transporte de un cliente

El MCP está pensado para agentes, pero también sirve como transporte: un cliente que solo tiene abierto el puerto
del MCP hace lo mismo que por REST.

- Implementación propia y chica de JSON-RPC sobre cada canal (`initialize`, `notifications/initialized`,
  `tools/call`, `ping`), **sin depender de un SDK de MCP** en Go y Rust; en Node se evalúa el SDK oficial en la
  fase 1 y se usa solo si no agrega peso.
- El resultado de `tools/call` viene como JSON en `content[0].text` (y en `structuredContent` si es chico): el
  cliente lo parsea y devuelve lo mismo que REST.
- **`mcp.maxRows`:** la gateway corta las listas largas y responde `{ rows, truncated: true, … }`. Por defecto el
  cliente lanza `GatewayError { code: "truncated" }`: un programa no debe recibir datos incompletos sin saberlo. Con
  `onTruncated: 'return'` devuelve las filas y la marca.
- La sesión: Streamable HTTP sin estado (cada `POST` vale solo); HTTP+SSE viejo mantiene el `GET /sse` abierto y
  reintenta si se cae.

## 7. Suite de conformidad (`packages/conformance`)

Un paquete con:

- un `docker-compose.yml`: la imagen `flaviorita/data-gateway` (versión fija), northwind en Postgres, y **los
  cuatro transportes encendidos** con `legacySse: true` y dos credenciales de prueba (`reader`, `backend`);
- `cases/*.json` (JSON y no YAML: Go y Rust lo leen sin dependencias): cada caso tiene pasos con operación,
  argumentos y lo esperado (resultado, coincidencia parcial, largo, o error con su `code`): consultas con filtro,
  `include`, agregados, insert/update/delete con sus filas afectadas, scripts con rollback, cada código de error,
  `plan`, `metadata`, el esquema, la lista cortada por `mcp.maxRows`. Formato: el README de la suite;
- la gateway puede ser una imagen o la del código de `packages/data-gateway` (`scripts/ci-local.sh clients`), para
  probar un cambio de la gateway y de los clientes juntos;
- un **runner de referencia** en Node sin dependencias (`runner/`), que habla los cinco transportes: valida los casos
  contra la gateway antes de que exista un cliente, y muestra cómo viaja cada operación y cada error.

Faltan casos de las notificaciones (`on('queue.completed')`, solo `ws`): necesitan una cola en el entorno; se suman
con el cliente de Node.

Cada cliente tiene un runner que lee los casos y los corre **por cada uno de los cinco esquemas de URL**: la matriz
caso × transporte sale en verde en `scripts/ci-local.sh clients`. Es la garantía (y el mensaje) de que la misma consulta da lo
mismo por cualquier vía.

## 8. Cada proyecto

### Node — `packages/client-node` → `@lambdaorm/data-gateway-client`

- TypeScript, ESM + CJS, Node ≥ 20; `fetch` nativo en lugar de axios; WebSocket de Node 22 o `ws`.
- Parte del código de `packages/client` (API y adaptador WebSocket) y le suma los transportes MCP.
- `connect(url, options)` además de la forma actual `orm.init(url, options)` (compatibilidad).
- Migración: `@lambdaorm/client` 1.0.0 reexporta el nuevo y queda deprecado (`npm deprecate`, lo corre el usuario);
  `@lambdaorm/cli` pasa a depender de `@lambdaorm/data-gateway-client`.

### Go — `packages/data-gateway-client-go`

- Go ≥ 1.22, sin dependencias salvo un cliente WebSocket (`github.com/coder/websocket`).
- `gateway.Connect(url, opts...)` con opciones funcionales (`WithAPIKey`, `WithToken`, `WithTimeout`);
  `context.Context` en cada operación; `ExecuteInto[T]`.
- Go 1.22 (la del entorno local).
- Versión por tag (`v0.1.0`) en el espejo público (§1.1): no hay registro que publicar.

### CLI — `packages/data-gateway-cli` → `dgw`

- Go con `cobra`, sobre el cliente de Go.
- Comandos: `dgw execute <query> [-d json|@archivo]`, `script`, `queued`, `plan`, `metadata`, `schema <entities|…>`,
  `stage <export|import>`, `version`, `health`, `schemas`, `listen <evento>` (solo `ws`).
- `--url` (o `DATA_GATEWAY_URL`), perfiles en `~/.config/dgw/config.yaml` (URL y nombre de la variable que tiene la
  credencial, nunca la credencial), salida `json` (por defecto), `yaml` o `table`.
- Códigos de salida: 0 ok, 1 error de la consulta, 2 uso, 3 conexión.
- Releases con GoReleaser, corrido local: binarios Linux/macOS/Windows en las releases del espejo público, tap de
  Homebrew, `go install`.

### Rust — `packages/data-gateway-client-rust` → `lambdaorm-data-gateway-client`

- Async con `tokio`; `reqwest` (rustls); `tokio-tungstenite` y el MCP detrás de features (`ws`, `mcp`, encendidas
  por defecto) para quien quiera solo REST.
- `Gateway::connect(url, Options)`, `execute_as::<T>()` con `serde`.
- Publicación en crates.io.

## 9. Fases

| Fase | Contenido | Se publica |
| --- | --- | --- |
| 0 | Este plan; `packages/conformance` con el compose, 27 casos y el runner de referencia (135 en verde: 27 × 5 transportes); `ci-local.sh clients`; los arreglos que la suite encontró en lib y en la gateway | lib 3.7.1, gateway 3.1.0 |
| 1 | Node: `packages/client-node`, los cinco transportes con `fetch` y el `WebSocket` de Node (sin axios), la cadena de conexión, los errores, la suite en verde con su API pública (135/135); documentación en la wiki al publicarlo | `@lambdaorm/data-gateway-client` 0.1.0 |
| 2 | Migrar `@lambdaorm/cli` al cliente nuevo; `@lambdaorm/client` 1.0.0 como alias deprecado | `@lambdaorm/cli`, `@lambdaorm/client` |
| 3 | Go: los cinco transportes, la suite en verde; `release-go` y el espejo público | `v0.1.0` |
| 4 | CLI `dgw`; `release-cli` y su espejo | `v0.1.0` (binarios, Homebrew) |
| 5 | Rust; `release-rust` | crates.io 0.1.0 |
| 6 | Con la suite en verde en los cuatro: `1.0.0`; página de la wiki "Clients" (en los cuatro idiomas) y README de cada paquete con el mismo ejemplo en cada lenguaje | `1.0.0` de cada uno |

Cada fase es un PR contra `develop` (rama `feature/data-gateway-client-<fase>`); cada publicación (npm, crates.io,
espejos de Go, Homebrew) con el OK del usuario. Las credenciales, como las de npm y Docker Hub, por variables de
entorno en `~/.profile` que el usuario define: `LAMBDA_ORM_CRATES_TOKEN` (crates.io) y el acceso SSH a los espejos
(o `LAMBDA_ORM_GITHUB_TOKEN` para crear sus releases). Los espejos los crea el usuario (o con su OK) al llegar a la
fase 3.

## 10. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Los transportes divergen en detalles (formato de errores, resultados cortados) | la suite de conformidad corre cada caso por los cinco; el cliente normaliza (§5, §6) |
| El HTTP+SSE viejo es obsoleto en la especificación MCP | se soporta porque la gateway lo expone; se documenta como compatibilidad, no como recomendado |
| MCP por WebSocket no es estándar | igual que en la gateway: documentado como no estándar |
| Un PR de la comunidad en un espejo de Go se pisaría con la próxima publicación | el README del espejo dice que es de solo lectura y a dónde mandar issues; los PRs se pasan a mano al monorepo |
| Sin CI en GitHub (core privado, Actions pausado) | `scripts/ci-local.sh clients` antes de cada push, como el resto |
| Cuatro bases de código que mantener | contrato único (§3), casos compartidos (§7), sin lógica de λORM en los clientes (solo transporte) |
| La gateway cambia su API | la suite fija la versión de la imagen; un cambio de API es un cambio de la suite |
| Romper a quien usa `@lambdaorm/client` | alias deprecado que reexporta el nuevo; misma API |

## 11. Pendientes de decidir

- **Notificaciones por SSE en REST** (`GET {ruta}/events`): hoy las notificaciones solo van por WebSocket y el SSE
  existe solo en el MCP. Agregarlo a la gateway sirve a quien no puede abrir un WebSocket. Fuera de este plan hasta
  que el usuario lo decida.
- El nombre del binario de la CLI (`dgw` propuesto, o `data-gateway`).
- Python (después de la fase 6).
