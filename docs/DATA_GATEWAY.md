# data-gateway

> **Estado (2026-11-17): diseño, no implementado.** Este documento describe cómo va a funcionar; el plan de
> implementación está en [`DATA_GATEWAY_PLAN.md`](DATA_GATEWAY_PLAN.md). Hasta que se implemente, lo que corre es
> `packages/service` (`@lambdaorm/service`, imagen `flaviorita/lambdaorm-svc`).

`data-gateway` es el nuevo nombre del servicio de λORM (hoy `packages/service`). Expone la funcionalidad de λORM
(consultas en el lenguaje de expresiones, scripts transaccionales, esquema, stages, cola Kafka):

- **por varios transportes a la vez**, elegidos por configuración:

  | Transporte (`transports.<clave>`) | Protocolo | Para quién | Desde |
  | --- | --- | --- | --- |
  | `http` | API REST (los endpoints actuales del service + Swagger) | `@lambdaorm/client`, `@lambdaorm/cli`, cualquier cliente HTTP | 3.0.0 |
  | `mcpHttp` | MCP Streamable HTTP (estándar actual) + HTTP+SSE (obsoleto, por compatibilidad) en el mismo puerto | agentes LLM y clientes MCP (Claude Code, Claude Desktop, otros gateways) | 3.0.0 |
  | `mcpWebSocket` | MCP sobre WebSocket (**no estándar**: la especificación MCP solo define stdio y Streamable HTTP) | clientes MCP que lo soportan por su cuenta | 3.0.0 |
  | `webSocket` | JSON-RPC 2.0 sobre WebSocket, con notificaciones del servidor | `@lambdaorm/client` (adaptador WebSocket), UIs, procesos con muchas consultas | 3.2.0 |
  | `management` | API REST de administración y consultas, en su propio puerto (§12) | el backend del data-gateway-ide | 4.0.0 |

- **para varios esquemas a la vez** (varios `lambdaORM.yaml`: distintos dominios o distintas versiones de uno), cada
  uno en su ruta: `/iot/v1`, `/iot/v2`, `/accounts/v1` (§2.2, §4);
- con **cada esquema en su propio hilo (o proceso)**, supervisado: que uno falle, se cuelgue o no responda no afecta a
  los demás (§3);
- con **credenciales con permisos** (`read`, `write`, `script`, `queue`, `stageImport`) aplicados igual en todos los
  transportes (§6), y **auditoría** de cada escritura (§8.1);
- con una **UI web para escribir y probar consultas** (Monaco con autocompletado del modelo del esquema), construida
  como librería React reutilizable `@lambdaorm/ui` (§10), que usa el **data-gateway-ide**, una imagen aparte que llega a
  la gateway por su transporte `management` (§11.9, §12). Desde 4.0.0 la gateway no sirve ninguna UI.

Todos los transportes exponen los mismos métodos, incluidas las escrituras, sujetas a los permisos de la credencial.

**Alcance:** todo el desarrollo está en este paquete (`packages/service` → `packages/data-gateway`).
`@lambdaorm/lib` y `@lambdaorm/base` **no se modifican**: el gateway usa su API pública tal como está, una instancia de
`Orm` por esquema. Los otros paquetes que se agregan o cambian: **`@lambdaorm/ui`** (nuevo, librería de componentes React, 3.1.0, §10)
y `@lambdaorm/client` (adaptador WebSocket, 3.2.0, §9). Implementación propia en TypeScript, con arquitectura limpia / hexagonal y principios SOLID (§3), sin
depender de `@blazedpath/commons` ni de ningún paquete de blazedpath (el `blz-ai-gateway` se usó solo como ejemplo de
la idea "un núcleo, varios transportes activados por configuración").

## 1. Nombres y versiones

| Qué | Antes | Ahora |
| --- | --- | --- |
| Carpeta | `packages/service` | `packages/data-gateway` |
| Paquete (privado, no se publica en npm) | `@lambdaorm/service` | `@lambdaorm/data-gateway` |
| Imagen Docker | `flaviorita/lambdaorm-svc` | `flaviorita/data-gateway` |
| Tag de git | `service-v<versión>` | `data-gateway-v<versión>` |
| Rama de release | `release/service-<versión>` | `release/data-gateway-<versión>` |
| Workflow | `.github/workflows/service-image.yml` | `.github/workflows/data-gateway-image.yml` |

Se publica por etapas: `3.0.0-rc.1` (núcleo + `http`), `3.0.0-rc.2` (+ MCP, un esquema), **`3.0.0`** (+ varios esquemas y workers),
`3.1.0` (+ UI), `3.2.0` (+ `webSocket`), **`4.0.0`** (+ `management`; sin `/ui`, sin `/admin` en `http` y sin CORS, §12). Las versiones `-rc.N` se publican en Docker Hub **sin**
mover `latest`. `flaviorita/lambdaorm-svc` queda congelada en 2.4.0; su descripción en Docker Hub apunta a la nueva.

## 2. Configuración

Toda la configuración del gateway sale de **un archivo YAML montado**, nunca horneado en la imagen:

- Ruta: `DATA_GATEWAY_CONFIG_PATH` (por defecto `/config/data-gateway.config.yaml`). **Obligatorio**: sin archivo el
  proceso registra el error y sale con código 1 (§2.6).
- Los valores `$VAR` / `${VAR}` se resuelven con las variables de entorno del proceso, en todo el árbol e incluso
  dentro de strings (`"${HOST}:${PORT}"`). Un `$VAR` cuya variable no existe se considera **no definido** (la misma
  regla que hoy aplica `withoutUnresolved` en `server.ts`).
- Los esquemas de λORM (`lambdaORM.yaml`, fuentes, mappings, stages, cola) **no** se mueven a este archivo: siguen en
  sus workspaces. El archivo del gateway dice dónde están, cómo se llega a cada uno y cómo exponerlos.

### 2.1 Puertos y transportes

**Un transporte se expone si y solo si tiene un puerto configurado.** No hay puertos por defecto en ningún lado (ni
en el código ni en el Dockerfile):

| `transports.<t>` | Resultado |
| --- | --- |
| sección ausente | no se expone |
| sección presente sin `port`, o `port: $VAR` con la variable no definida | no se expone (log `info`: `mcpHttp not exposed: no port configured`) |
| `port` definido pero no es un entero 1–65535 | error de configuración, el proceso no arranca |
| dos transportes con el mismo `host:port` | error de configuración, el proceso no arranca |

Así se activan o desactivan transportes desde el despliegue solo con variables de entorno: el mismo YAML con
`port: $DATA_GATEWAY_MCP_HTTP_PORT` expone MCP solo donde esa variable está definida. Si no queda **ningún**
transporte expuesto, el proceso no arranca.

### 2.2 Esquemas

Un **esquema** es un workspace de λORM (una carpeta con `lambdaORM.yaml`) servido en una **ruta** (`iot/v1`). Hay dos
formas de declararlos, y se pueden combinar:

```yaml
orm:
  # 1. Descubrimiento: se recorre el directorio y la ruta sale de la ubicación de cada lambdaORM.yaml
  workspacePath: /workspace

  # 2. Explícito: cada esquema con su ruta y su carpeta, independientes entre sí
  schemas:
    - path: accounts/v1
      workspace: /mnt/accounts          # carpeta con lambdaORM.yaml (o el archivo mismo)
```

**Descubrimiento (`orm.workspacePath`).** Al arrancar se recorre el árbol. Cada carpeta que tiene un `lambdaORM.yaml`
es un esquema y su ruta relativa es su `path`; al encontrarlo **no se sigue bajando** por esa rama (un workspace tiene
subcarpetas propias: `orm_state`, `data`, …):

```
/workspace                          (orm.workspacePath)
├── iot/
│   ├── v1/lambdaORM.yaml    →  esquema "iot/v1"       →  /iot/v1/...
│   └── v2/lambdaORM.yaml    →  esquema "iot/v2"       →  /iot/v2/...
└── accounts/
    └── v1/lambdaORM.yaml    →  esquema "accounts/v1"  →  /accounts/v1/...
```

**Explícito (`orm.schemas[]` con `workspace`).** La ruta no depende de dónde está la carpeta. Sirve para montar
volúmenes distintos por esquema o para que una instancia sirva solo algunos esquemas.

**Ajustes por esquema (`orm.schemas[]` sin `workspace`).** Una entrada sin `workspace` no define un esquema: ajusta uno
descubierto (si su `path` no coincide con ninguno, es error de configuración). Una entrada con `workspace` define y
ajusta a la vez. Qué se puede ajustar:

| Clave por esquema | Efecto | Si no se define |
| --- | --- | --- |
| `transports` | lista de transportes por los que se expone este esquema; en los demás sus rutas no existen (`404`) | todos los expuestos |
| `authentication` | reemplaza la autenticación (y sus permisos) para este esquema, en todos sus transportes | la del transporte, si no la global |
| `env` | variables de entorno que recibe el worker del esquema (§2.3) | solo el `.env` del workspace y las variables base |
| `scripts` | `enabled` y límites de scripts | `scripts` global |
| `mcp.maxRows`, `mcp.tools` | límite de filas y tools listadas en el MCP de este esquema | `mcp` global |
| `server.timeout`, `server.maxConcurrent`, `server.maxResponseBytes`, `server.streamThresholdBytes` | timeout, operaciones simultáneas y tamaños de respuesta de este esquema | `server` global |
| `runtime.mode`, `runtime.maxMemoryMb`, `runtime.checkConnections` | `thread` / `process`, límite de memoria del worker de este esquema y si prueba sus conexiones al arrancar | `runtime.schemas`, `runtime.maxMemoryMb` y `runtime.checkConnections` globales |

Solo globales o por transporte (son del proceso o del puerto, no del esquema): puertos, `host`, `basePath`,
`rateLimit`, `logger`, `metrics`, `swagger` / `asyncapi`, `legacySse`, `stateful`, `runtime.transports`,
`runtime.heartbeat`, `runtime.threadpoolSize`, `runtime.env`.

**Prioridad, siempre la misma:** esquema → transporte → global. El más específico **reemplaza** al anterior (no se
combinan). Ajustes por la combinación esquema × transporte no existen en 3.0.0 (podrían agregarse después como
`schemas[].transportOverrides.<t>` sin romper nada).

**Reglas:**

- Hay que declarar al menos uno de `orm.workspacePath` u `orm.schemas` con `workspace`. Sin `orm.watch`, tiene que
  resultar al menos un esquema; con `orm.watch` (por defecto) un volumen vacío arranca y espera, y un ajuste de un esquema
  que todavía no está se avisa y se aplica cuando aparece.
- Descubiertos + explícitos se sirven todos. Dos esquemas con la misma ruta son error de configuración.
- Cada segmento de la ruta: `[a-zA-Z0-9_.-]`, y ninguno puede ser un nombre reservado: `health`, `ping`, `metrics`,
  `version`, `schemas`, `mcp`, `sse`, `messages`, `status`, `doc`, `api-docs`, `swagger`, `asyncapi`, `ui`, `whoami`,
  `typings`.
- La ruta de un esquema no puede ser prefijo de la de otro (`iot` e `iot/v1` a la vez es error de configuración).
- **Esquema en la raíz:** si `workspacePath` tiene `lambdaORM.yaml` en su raíz (o un explícito usa `path: ""`), ese
  esquema se sirve en la raíz (`/execute`), como hoy. Solo se permite si es el **único** esquema.
- **Recarga en caliente (`orm.watch`, 3.2.0, `DATA_GATEWAY_ADMIN_PLAN.md` fase 1).** Mientras la gateway corre:
    - una carpeta nueva con un `lambdaORM.yaml` es un **esquema nuevo**: arranca su worker y sus rutas aparecen en
      todos los transportes, sin reiniciar la gateway ni tocar los demás esquemas;
    - un `lambdaORM.yaml` o un `.env` **cuyo contenido cambió** recarga ese esquema **blue-green**: el worker nuevo
      arranca al lado del actual, que sigue atendiendo hasta que el nuevo está `ready` (sin un instante fuera de
      servicio). Si el nuevo no arranca (un YAML inválido), **sigue el último que arrancó**, y el estado del esquema lo
      dice en `pending` (`GET /schemas`, `schema.statusChanged`);
    - una carpeta que se va (o pierde su `lambdaORM.yaml`) **quita** el esquema: sus rutas pasan a `404` y las conexiones
      WebSocket a él se cierran con el código `4404`;
    - cualquier otro archivo de un workspace (`workbench/`, `data/`, `src/`) solo se **notifica**
      (`workspace.changed`, §7); `orm_state/` y los temporales de los editores no.
  Los eventos del sistema de archivos son el camino rápido; un recorrido cada `orm.watch.intervalMs` ve lo que no
  llega por eventos (algunos volúmenes montados). Lo que cambió se decide por el contenido (un hash), no por el evento.
  Los ajustes de `orm.schemas[]` y el resto de `data-gateway.config.yaml` se leen al arrancar.
- Cola Kafka: cada esquema usa la `infrastructure.queue` de su propio `lambdaORM.yaml`, si la tiene.

### 2.3 Variables de entorno por esquema

λORM resuelve los `$VAR` de cada `lambdaORM.yaml` con `process.env`. Para que un esquema no pueda leer las credenciales
de otro ni los secretos del gateway, **cada schema worker recibe solo sus variables** (`worker_threads` y
`child_process` aceptan un `env` propio; dentro del worker, `process.env` es ese objeto). De mayor a menor prioridad:

| Fuente | Ejemplo |
| --- | --- |
| `schemas[].env` en la config del gateway (los valores pueden referenciar variables del gateway) | `DB_CONNECTION: $IOT_V1_DB` |
| `.env` dentro del workspace del esquema (opcional) | `/workspace/iot/v1/.env` |
| variables base: `PATH`, `HOME`, `TZ`, `LANG`, `NODE_*`, `LD_LIBRARY_PATH`, `ORACLE_*` y `runtime.env.passthrough` | `TZ=UTC` |

Así todos los `lambdaORM.yaml` pueden usar el mismo nombre y el gateway mapea cada uno al secreto real:

```yaml
orm:
  workspacePath: /workspace
  schemas:
    - path: iot/v1
      env: { DB_CONNECTION: $IOT_V1_DB }
    - path: iot/v2
      env: { DB_CONNECTION: $IOT_V2_DB }    # iot/v2 puede ser una copia exacta de iot/v1
runtime:
  env:
    isolate: true                         # false = todos heredan process.env completo (desarrollo local)
    passthrough: [ KAFKA_BROKER ]         # variables que sí reciben todos los esquemas
```

El edge (§3.1) tampoco recibe variables de esquemas: el supervisor resuelve la configuración y le pasa a cada worker
solo lo suyo ya resuelto. Una variable referenciada en `schemas[].env` que no está definida queda sin definir: el
esquema falla al conectar, queda en `error` con un mensaje claro y los demás arrancan igual.

### 2.4 Runtime

```yaml
runtime:
  transports: shared        # shared (todos en un worker "edge") | thread | process (uno por transporte)
  schemas: thread           # thread | process — uno por esquema (ajustable por esquema con runtime.mode)
  maxMemoryMb: 512          # heap de JS por worker; si lo supera, se reinicia solo ese worker
  threadpoolSize: auto      # UV_THREADPOOL_SIZE; auto = max(4, 2 × esquemas en modo thread), tope 64
  heartbeat:
    intervalMs: 5000
    timeoutMs: 30000        # sin respuesta → worker colgado → se termina y se reinicia
  restart:
    initialDelayMs: 1000    # primera espera antes de reintentar un worker caído o que no arrancó
    maxDelayMs: 300000      # tope de la espera creciente
  env: { isolate: true, passthrough: [] }
```

Modelo y garantías en §3.

### 2.5 Ejemplo completo

```yaml
# data-gateway.config.yaml
orm:
  workspacePath: /workspace
  schemas:
    - path: iot/v1                      # descubierto: solo ajustes
      transports: [ http ]              # no se expone por MCP
      env: { DB_CONNECTION: $IOT_V1_DB }
      scripts: { enabled: false }
    - path: iot/v2
      env: { DB_CONNECTION: $IOT_V2_DB }
      mcp: { maxRows: 100 }
      runtime: { maxMemoryMb: 1024 }
    - path: accounts/v1                 # explícito: define y ajusta
      workspace: /mnt/accounts
      env: { DB_CONNECTION: $ACCOUNTS_DB }
      runtime: { mode: process }
      authentication:
        adapter: local
        type: apikey
        keys:
          - { name: accounts-backend, value: $ACCOUNTS_KEY, permissions: [ read, write ] }

runtime:
  transports: shared
  schemas: thread
  maxMemoryMb: 512

server:
  timeout: 120000                  # ms por request / mensaje / llamada a tool
  maxConcurrent: 64                # operaciones simultáneas por esquema; por encima, 429
  requestBodySize: 14MB
  maxResponseBytes: 256MB          # 0 = sin límite
  streamThresholdBytes: 8MB        # por encima, REST responde en partes

logger: { adapter: winston, level: info }
metrics: { enabled: true }
audit: { enabled: true, includeData: false }

authentication:                    # política global
  adapter: local
  type: apikey
  header: X-Api-Key
  keys:
    - { name: agent,   value: $AGENT_KEY,   permissions: [ read ] }
    - { name: backend, value: $BACKEND_KEY, permissions: [ read, write, script, queue, stageImport ] }

rateLimit: { windowMs: 30000, max: 0 }   # solo http; max: 0 = sin límite

scripts: { enabled: true, maxLength: 20000, timeoutMs: 30000, maxIterations: 100000 }

mcp:
  name: data-gateway               # serverInfo.name base; cada esquema agrega su ruta
  tools: { include: [], exclude: [] }
  pageSize: 50
  maxRows: 500

transports:
  http:
    port: $DATA_GATEWAY_HTTP_PORT
  mcpHttp:
    port: $DATA_GATEWAY_MCP_HTTP_PORT
    legacySse: true
  mcpWebSocket:
    port: $DATA_GATEWAY_MCP_WS_PORT
  webSocket:                       # 3.2.0
    port: $DATA_GATEWAY_WS_PORT
  management:                      # 4.0.0; sin la variable, no se expone (producción)
    port: $DATA_GATEWAY_MANAGEMENT_PORT
```

### 2.6 Referencia

| Clave | Por defecto | Notas |
| --- | --- | --- |
| `orm.workspacePath` | — | raíz donde se descubren esquemas (§2.2) |
| `orm.schemas[]` | `[]` | `path` (obligatorio), `workspace` (define un esquema) y ajustes (§2.2) |
| `orm.watch` | `true` | recarga en caliente de los workspaces (§2.2); `false`, o `{ enabled, intervalMs, debounceMs }` |
| `orm.watch.intervalMs` | `5000` | cada cuánto se recorren los workspaces (`0`: solo los eventos del sistema de archivos) |
| `orm.watch.debounceMs` | `300` | cuánto se juntan los cambios antes de aplicarlos (un editor escribe un archivo en varios pasos) |
| `admin.enabled` | — | **quitado en 4.0.0**: la administración está si se expone `transports.management` (§12); si aparece, se avisa y se ignora |
| `admin.allowAnonymous` | `false` | con `authentication: none`, cualquiera administra (solo desarrollo local) |
| `admin.maxFileBytes` | `2MB` | el archivo más grande que se puede escribir (un `lambdaORM.yaml`, una consulta guardada) |
| `admin.commandTimeoutMs` | `600000` | cuánto puede tardar un comando (§11.3) |
| `runtime.transports` | `shared` | `shared` / `thread` / `process` (§3.1); en 3.0.0 solo `shared` (los otros dos avisan y usan `shared`) |
| `runtime.schemas` | `thread` | `thread` / `process` |
| `runtime.maxMemoryMb` | `512` | por worker |
| `runtime.checkConnections` | `true` | al arrancar, cada esquema abre y libera una conexión de cada fuente: una base caída lo deja en `error` (y se reintenta) en lugar de fallar en la primera consulta |
| `runtime.threadpoolSize` | `auto` | `max(4, 2 × esquemas thread)`, tope 64 |
| `runtime.heartbeat.intervalMs` / `timeoutMs` | `5000` / `30000` | |
| `runtime.restart.initialDelayMs` / `maxDelayMs` | `1000` / `300000` | espera creciente entre reinicios |
| `runtime.env.isolate` / `passthrough` | `true` / `[]` | §2.3 |
| `server.timeout` | `120000` | por request HTTP, mensaje WS y llamada a tool MCP |
| `server.maxConcurrent` | `64` | operaciones simultáneas por esquema; por encima, `429` (§3.2); `0` = sin límite |
| `server.requestBodySize` | `14MB` | |
| `server.maxResponseBytes` | `256MB` | `0` = sin límite; si se supera, error `413` (§3.2) |
| `server.streamThresholdBytes` | `8MB` | por encima, la respuesta REST va en partes (pendiente: en 3.0.0 el resultado viaja entero, transferido sin copia) |
| `logger.adapter` / `logger.level` | `winston` / `info` | |
| `metrics.enabled` | `true` | |
| `audit.enabled` | `true` | registro de escrituras (§8.1) |
| `audit.includeData` | `false` | `true` agrega los parámetros (`data`) de la operación; pueden tener datos personales |
| `authentication` | `{ adapter: none }` | §6 |
| `transports.<t>.authentication` | hereda `authentication` | reemplaza la global para ese transporte |
| `rateLimit.windowMs` / `rateLimit.max` | `30000` / `30` | solo `http`; `max: 0` lo desactiva |
| `scripts.*` | `enabled: false`, `20000`, `30000`, `100000` | mismos límites que hoy; el cliente puede pedir menos, nunca más |
| `mcp.name` | `data-gateway` | |
| `mcp.tools.include` / `exclude` | `[]` / `[]` | nombres de tools (§5.1) |
| `mcp.pageSize` | `50` | paginación de `tools/list` y `resources/list` |
| `mcp.maxRows` | `500` | filas máximas en el resultado de `orm_execute` / `orm_execute_script`; `0` = sin límite |
| `transports.<t>.port` | **ninguno** | sin puerto, el transporte no se expone (§2.1) |
| `transports.<t>.host` | `0.0.0.0` | |
| `transports.<t>.basePath` | `''` | prefijo antes de la ruta del esquema, para publicar detrás de un ingress con path |
| `transports.<t>.maxConnections` | `100` | solo `webSocket`, `mcpWebSocket` y el SSE viejo de `mcpHttp` |
| `transports.mcpHttp.legacySse` | `true` | además de Streamable HTTP, expone HTTP+SSE para clientes viejos |
| `transports.mcpHttp.stateful` | `false` | Streamable HTTP sin estado: cualquier réplica atiende cualquier request |
| `transports.http.swagger.enabled` | `true` | `/doc`, `/api-docs` (y `/` con esquema en la raíz) |
| `transports.http.ui` | — | **quitado en 4.0.0**: la UI es el data-gateway-ide (§11.9); si aparece, se avisa y se ignora |
| `transports.management.port` | **ninguno** | sin puerto no hay administración ni API para el IDE (§12); en producción, normalmente sin puerto |
| `transports.<ws>.asyncapi.enabled` | `true` | `GET /asyncapi` y `/asyncapi.json` en `webSocket` y `mcpWebSocket` |

### 2.7 Migración desde el service 2.x

No hay modo legado: el data-gateway no lee `infrastructure.service` de `lambdaORM.yaml` (si está, registra un warning
de que se ignora) ni las variables `PORT`, `SERVICE_TOKEN`, `RATE_LIMIT_*`, `SCRIPT_*`, etc. por sí mismo. Quien siga
configurando por variables usa `flaviorita/lambdaorm-svc:2.4.0`. Para migrar se escribe un YAML que referencie las
mismas variables:

| Variable / `infrastructure.service` (2.x) | En `data-gateway.config.yaml` |
| --- | --- |
| `PORT` / `port` | `transports.http.port: $PORT` — ya **no hay puerto 80 por defecto** |
| `HOST` / `host` | ya no se usa (Swagger toma el host del request) |
| `WORKSPACE` | `orm.workspacePath: $WORKSPACE` (su `lambdaORM.yaml` en la raíz = esquema en la raíz, rutas como hoy) |
| variables usadas en `lambdaORM.yaml` (conexiones) | `runtime.env.passthrough: [ … ]`, o `schemas[].env`, o un `.env` en el workspace (§2.3) |
| `SERVICE_TOKEN` / `token` | `authentication: { adapter: local, type: bearer, token: $SERVICE_TOKEN }` (todos los permisos; `/ping`, `/health`, `/metrics` siguen libres) |
| `RATE_LIMIT_WINDOWS_MS`, `RATE_LIMIT_MAX` | `rateLimit.windowMs`, `rateLimit.max` |
| `REQUEST_BODY_SIZE` / `requestBodySize` | `server.requestBodySize` |
| `SCRIPT_ENABLED`, `SCRIPT_MAX_LENGTH`, `SCRIPT_TIMEOUT_MS`, `SCRIPT_MAX_ITERATIONS` | `scripts.enabled`, `scripts.maxLength`, `scripts.timeoutMs`, `scripts.maxIterations` |
| `infrastructure.queue` en `lambdaORM.yaml` | igual, se sigue leyendo de ahí |

Dos diferencias a propósito:

- En 2.x, sin `SERVICE_TOKEN` el service quedaba abierto; ahora un autenticador `local` cuyo secreto no está definido
  es un **error de configuración** (§6). Abierto es solo `adapter: none`, explícito.
- En 2.x el `lambdaORM.yaml` veía todas las variables del proceso; ahora solo las de §2.3. Las variables de conexión
  hay que pasarlas explícitamente (o `runtime.env.isolate: false`).

```yaml
# equivalente de un service 2.x
orm:
  workspacePath: $WORKSPACE
runtime:
  env:
    passthrough: [ DB_CONNECTION ]     # las variables que usa el lambdaORM.yaml
authentication:
  adapter: local
  type: bearer
  token: $SERVICE_TOKEN                # si no se usaba SERVICE_TOKEN, quitar el bloque authentication
rateLimit:
  windowMs: $RATE_LIMIT_WINDOWS_MS
  max: $RATE_LIMIT_MAX
scripts:
  enabled: $SCRIPT_ENABLED
transports:
  http:
    port: $PORT
```

### 2.8 Helm / Kubernetes

El YAML va en un ConfigMap montado en `/config`; secretos y puertos llegan como variables, así que el mismo ConfigMap
sirve para distintos entornos y cada uno decide qué transportes expone. Los workspaces se montan en `/workspace` (o
donde digan `workspacePath` / `schemas[].workspace`).

```yaml
data-gateway:
  enabled: true
  image:
    repository: flaviorita/data-gateway
    tag: 3.0.0
  replicaCount: 2                 # mcpHttp sin estado: no hace falta afinidad de sesión (salvo el SSE viejo)
  config:
    DATA_GATEWAY_CONFIG_PATH:   "/config/config.yaml"
    DATA_GATEWAY_HTTP_PORT:     "8080"
    DATA_GATEWAY_MCP_HTTP_PORT: "8082"
    # sin DATA_GATEWAY_MCP_WS_PORT: ese transporte no se expone
  configYaml: |
    orm:
      workspacePath: /workspace
    runtime:
      env: { passthrough: [ DB_CONNECTION ] }
    authentication:
      adapter: local
      type: bearer
      tokens:
        - { name: backend, value: $BACKEND_TOKEN, permissions: [ read, write, script ] }
        - { name: agent,   value: $AGENT_TOKEN,   permissions: [ read ] }
    transports:
      http:         { port: $DATA_GATEWAY_HTTP_PORT }
      mcpHttp:      { port: $DATA_GATEWAY_MCP_HTTP_PORT }
      mcpWebSocket: { port: $DATA_GATEWAY_MCP_WS_PORT }
```

Para aislar un esquema en su propia instancia (otro Deployment), se usa `orm.schemas` explícito con solo ese esquema;
las rutas no cambian, así que un ingress reparte por path (`/iot/v1/*` → deployment `iot-v1`). El Dockerfile no
declara `EXPOSE`: los puertos solo existen en la configuración.

## 3. Arquitectura

### 3.1 Modelo de ejecución

```
 hilo principal: SUPERVISOR (sin red, sin consultas)
   lee y valida la config, descubre esquemas, arranca y vigila los workers (heartbeat),
   crea los canales y difunde el estado de cada esquema
     │
     ├── EDGE WORKER (runtime.transports: shared)
     │     http · mcpHttp · mcpWebSocket · webSocket — cada uno en su puerto
     │     autentica, aplica rate limit, resuelve el esquema por la ruta, habla REST / MCP / JSON-RPC
     │     (con thread / process: un worker por transporte, mismo código)
     │
     └── SCHEMA WORKERS (uno por esquema, runtime.schemas o runtime.mode)
           iot/v1 · iot/v2 · accounts/v1
           cada uno con su env, su Orm (pool de conexiones), su cola, sus casos de uso,
           su catálogo MCP y su autorización

   edge ──── un canal directo por esquema ────► schema worker
   (el supervisor no está en el camino de los datos)
```

- **Supervisor (hilo principal):** no abre puertos ni ejecuta consultas ni código del usuario; es el único punto
  común y el único que nunca se reinicia.
- **Edge:** todos los transportes en un worker. Los transportes son código delgado y de I/O, sin código del usuario;
  separarlos en hilos multiplicaría canales, difusión de estados y memoria sin aislar nada que importe. Si el edge se
  cae, el supervisor lo reinicia y los esquemas siguen vivos con sus conexiones y su cola. `runtime.transports: thread`
  o `process` da un worker por transporte, para quien quiera aislarlos.
- **Schema worker:** uno por esquema, con su event loop, su heap, su `env` y su `Orm`. Una consulta pesada o un script
  con mucha CPU en `iot/v1` no frena a `iot/v2` ni al edge.
- **Canal:** el edge manda `{ id, op, params, principal, deadline }` y recibe `{ id, result }` o
  `{ id, error: { name, status, message } }`. Los resultados grandes **no viajan como objetos**: el schema worker hace
  `JSON.stringify` y manda un `Buffer` **transferido** (con `worker_threads`, cambia de dueño sin copia); el edge
  escribe esos bytes en la respuesta sin parsearlos. Por encima de `server.streamThresholdBytes` el schema worker
  manda partes de 1 MB y el edge responde REST con `Transfer-Encoding: chunked`. Los mensajes chicos (health, esquema,
  errores) van como objetos. Con `thread`, `MessageChannel` directo; con `process`, un socket unix que abre el schema
  worker. Mismo protocolo en los dos casos.
- **Estado:** el supervisor avisa al edge cada cambio de estado de un esquema (`starting`, `ready`, `error`,
  `restarting`); el edge sabe así a dónde rutear y qué responder en `/health` y `/schemas`.
- **Threadpool:** `UV_THREADPOOL_SIZE` se fija desde `runtime.threadpoolSize` antes de arrancar cualquier worker.

### 3.2 Aislamiento y recuperación

- **Un esquema que no arranca** (base caída, `lambdaORM.yaml` inválido, variable faltante): el gateway arranca igual
  con los demás. Sus rutas (y su MCP) responden `503` con el motivo; `GET /schemas` lo muestra con `status: error`. El
  supervisor reintenta con espera creciente (`runtime.restart`) y, cuando la base vuelve, el esquema pasa a `ready` sin
  reiniciar nada más.
- **Un worker que se cae** (excepción no capturada, supera `maxMemoryMb`): las operaciones en curso de ese esquema
  responden `503`; se reinicia con la misma espera creciente. Los demás no se enteran.
- **Un worker colgado** (loop síncrono, nunca lanza excepción): el **heartbeat** lo detecta (sin respuesta en
  `runtime.heartbeat.timeoutMs`), el supervisor lo termina por la fuerza (`worker.terminate()`, o `SIGKILL` en
  `process`) y lo reinicia. Aplica también al edge.
- **Una base que deja de responder** con el gateway andando: afecta solo a las consultas de ese esquema; cada
  operación tiene su `deadline` (`server.timeout`) y los pools están separados.
- **Una ráfaga de operaciones a un esquema:** el edge cuenta las operaciones en curso de cada esquema; por encima de
  `server.maxConcurrent` responde `429` (con `Retry-After`) en lugar de encolarlas sin límite, así la cola del worker y
  el pool de conexiones no crecen hasta que todo dé timeout. En MCP es `isError: true` con el mismo mensaje; en
  WebSocket, error con `status: 429`.
- **Una respuesta enorme:** si el resultado serializado supera `server.maxResponseBytes`, el schema worker corta y
  responde `413` ("usá `.page(1, n)` o agregá en la consulta"), en lugar de agotar la memoria.
- **El proceso nunca muere por un esquema caído.** Solo no arranca por errores de configuración (§2), y termina por
  `SIGTERM` / `SIGINT`.

**Qué aísla cada nivel:**

| | `thread` | `process` | instancia aparte |
| --- | --- | --- | --- |
| CPU / event loop | ✅ | ✅ | ✅ |
| Heap de JS (`maxMemoryMb`) | ✅ | ✅ | ✅ |
| Worker colgado (heartbeat) | ✅ | ✅ | ✅ |
| Variables de entorno (§2.3) | ✅ | ✅ | ✅ |
| Threadpool de libuv (DNS, `fs`, `crypto`, drivers nativos) | ⚠️ compartido, mitigado con `threadpoolSize` | ✅ | ✅ |
| Memoria nativa / OOM del contenedor | ❌ | ⚠️ mismo contenedor | ✅ |
| Crash de código nativo (segfault de un driver) | ❌ cae todo el proceso | ✅ | ✅ |

Recomendación: `thread` en desarrollo y para esquemas chicos; `runtime.mode: process` para un esquema crítico en
producción (los drivers de λORM son JavaScript o WASM — `pg`, `mysql2`, `tedious`, `mongodb`, `sql.js`, `oracledb` 6
thin —, pero Oracle en modo thick usa código nativo); una instancia por esquema para esquemas de equipos o clientes
distintos.

### 3.3 Capas (hexagonal)

Hexagonal (puertos y adaptadores) sobre las tres capas que ya usa el repo. Las dependencias apuntan **siempre hacia
adentro**. Hay **tres composition roots**, uno por tipo de hilo: supervisor, edge (transport worker) y schema worker.

| Capa | Contiene | Puede importar |
| --- | --- | --- |
| `domain/` | value objects y reglas puras: configuración y su validación (puertos, rutas, reservados, duplicados, esquema en la raíz), resolución de ajustes efectivos (esquema → transporte → global), resolución del `env` de un esquema, `SchemaDescriptor`, `SchemaStatus`, `RestartPolicy`, `HeartbeatPolicy`, protocolo del canal, `Principal` (nombre + permisos), `Permission`, **`AuthorizationPolicy`** (operación + clasificación lectura / escritura → permiso requerido), errores (`GatewayError` con `name` + `status`: `NotFound`, `Forbidden`, `Validation`, `Timeout`, `SchemaUnavailable`, `ResponseTooLarge`, `TooManyRequests`), `AuditEntry`, `ToolDefinition`, `ToolResult`, `ResourceDefinition` | solo tipos de `@lambdaorm/base` |
| `application/ports/` | **Entrada:** `DataGatewayPort` (operaciones de un esquema, con `Principal`), `McpServerPort`, `RpcDispatcherPort`. **Salida:** `OrmQueryPort`, `OrmScriptPort`, `OrmSchemaPort`, `OrmStagePort`, `QueuePort`, `AuthenticatorPort`, `LoggerPort`, `MetricsPort`, `ConfigSourcePort`, `SchemaDiscoveryPort`, `EnvFilePort`, `SchemaRuntimePort`, `TransportRuntimePort`, `SchemaChannelPort`, `AuditPort`, `ClockPort` | `domain` |
| `application/` | casos de uso de un esquema (General, Query, Script, Schema, Stage) que autorizan con `AuthorizationPolicy` antes de ejecutar (para `execute` con solo `read`, clasifican la consulta con `OrmQueryPort.metadata`), fachada `DataGateway`, catálogo de tools (filtrado por permisos) y `DataGatewayMcpServer`, `ResultSerializer` (bytes, partes, límites, recorte `maxRows`), `RpcDispatcher`, **`Supervisor`** (arranque, heartbeat, reinicios, difusión de estados), **`SchemaRouter`** | `domain`, `application/ports` |
| `infrastructure/output/` | `LambdaOrmAdapter` (envuelve `IOrm` de `@lambdaorm/lib`), `KafkaQueueAdapter`, autenticadores, loggers, métricas, `YamlFileConfigSource`, `FileSystemSchemaDiscovery`, `DotEnvFileReader`, `WorkerThread*Runtime` / `ChildProcess*Runtime`, `MessageChannelSchemaChannel` / `UnixSocketSchemaChannel`, **proxies** `DataGatewayProxy` y `McpServerProxy` | lo anterior + librerías externas, `worker_threads`, `child_process`, `net`, `fs` |
| `infrastructure/input/` | transportes (`HttpTransport`, `McpHttpTransport`, `McpWebSocketTransport`, `WebSocketTransport`) y el **receptor del canal** en el schema worker | lo anterior + express, `ws`, `@modelcontextprotocol/sdk` |
| `infrastructure/build/` | composition roots: `supervisorMain`, `edgeWorkerMain`, `schemaWorkerMain`; `TransportRegistry`, `AuthenticatorRegistry`, registros de runtimes | todo |

Los transportes usan `DataGatewayPort` y `McpServerPort` **sin saber que hay hilos en el medio**: en el edge los
implementan los proxies; en el schema worker, la fachada y el servidor MCP reales. En los tests se puede conectar un
transporte directo a la fachada real, sin workers.

`@lambdaorm/lib`, express, `ws`, `@modelcontextprotocol/sdk`, `kafkajs`, `winston`, `prom-client`, `worker_threads`,
`child_process`, `net` y `fs` **solo aparecen en `infrastructure/`**. Se hace cumplir con `no-restricted-imports` de
ESLint por carpeta y un test de arquitectura que recorre los imports de `domain/` y `application/`.

### 3.4 SOLID aplicado

| Principio | Cómo se cumple |
| --- | --- |
| **S** — responsabilidad única | supervisor solo supervisa; edge solo red; schema worker solo λORM; un adaptador por transporte; un autenticador por tipo; un caso de uso por clase; autorización en una política del dominio |
| **O** — abierto/cerrado | transportes, autenticadores, tools y modos de runtime se agregan **registrándolos**, sin tocar los composition roots ni un `switch` |
| **L** — sustitución | todo `Transport` cumple `start()` / `stop()` / `name`; `WorkerThread*Runtime` y `ChildProcess*Runtime` son intercambiables; proxy y fachada real cumplen el mismo `DataGatewayPort` (verificado con tests de contrato) |
| **I** — segregación de interfaces | `OrmQueryPort`, `OrmScriptPort`, `OrmSchemaPort`, `OrmStagePort` por separado; cada caso de uso recibe solo el que usa; los transportes solo ven puertos de entrada |
| **D** — inversión de dependencias | `application` depende de puertos; las implementaciones se inyectan por constructor desde los composition roots |

### 3.5 Arranque y apagado

1. **Supervisor:** lee y valida la config → fija `UV_THREADPOOL_SIZE` → descubre esquemas → valida rutas → resuelve
   el `env` de cada esquema → arranca un schema worker por esquema → arranca el edge (o un worker por transporte) →
   crea los canales → difunde estados → empieza el heartbeat. Los transportes escuchan aunque algún esquema siga en
   `starting`.
2. **Schema worker:** `orm.init(workspace)` → casos de uso, fachada, catálogo MCP (con el dominio del esquema) →
   avisa `ready` (o `error` con el motivo).
3. **`SIGTERM` / `SIGINT`:** el edge deja de aceptar conexiones y espera las operaciones en curso (hasta
   `server.timeout`); después los schema workers cierran la cola y hacen `orm.end()`; el supervisor sale.

## 4. Rutas

Cada esquema se alcanza por su ruta en todos los transportes que lo exponen (`{basePath}` es el del transporte):

| Transporte | Esquema `iot/v1` | Nivel gateway |
| --- | --- | --- |
| `http` | `POST /iot/v1/execute`, `GET /iot/v1/entities`, … (todos los endpoints actuales bajo el prefijo) | `GET /health`, `/ping`, `/metrics`, `/version`, `/schemas`, `/whoami`, `/transports`, `/doc` |
| `management` (4.0.0) | los mismos que `http`, de todos los esquemas | los de `http` (sin `/doc`) y `/admin/…` (§11, §12) |
| `mcpHttp` | `POST/GET/DELETE /iot/v1/mcp` (Streamable HTTP); `GET /iot/v1/sse` + `POST /iot/v1/messages?sessionId=` (SSE viejo) | `GET /status` |
| `mcpWebSocket` | upgrade en `/iot/v1/mcp` | `GET /status` |
| `webSocket` (3.1.0) | conexión a `ws://host:port/iot/v1` | conexión a la raíz: solo `general.*` y `gateway.schemas` |

- **Rutas generales también bajo cada esquema** (para que `@lambdaorm/client` funcione sin cambios, §9):
  `/iot/v1/health` y `/iot/v1/ping` (estado de ese esquema: `200` si `ready`, `503` si no), `/iot/v1/version`
  (versión del gateway y del esquema), `/iot/v1/metrics` (métricas de ese esquema).
- **`GET /{esquema}/typings`** (3.1.0): declaraciones TypeScript del modelo del esquema, para el autocompletado de la
  UI (§10.3). Requiere `read`.
- **`GET /whoami`** y **`GET /{esquema}/whoami`** (3.1.0): nombre y permisos de la credencial con la que se llama
  (con la autenticación efectiva de ese esquema). Nunca devuelve el secreto.
- **`GET /schemas`:** `[{ "path": "iot/v1", "status": "ready", "transports": ["http"], "source": "discovered" }, { "path": "iot/v2", "status": "error", "error": "…", "retryAt": "…" }, …]`.
- **`GET /health`:** `200` mientras al menos un esquema esté `ready`, con el detalle de cada uno; `503` si ninguno.
- Esquema en la raíz (único): todo como hoy (`/execute`, `/entities`, …).
- Ruta de un esquema que no se expone por ese transporte: `404`. Esquema no `ready`: `503` con el motivo.
- **`GET /{esquema}/search?q=`** y **`GET /{esquema}/describe?entities=A,B`** (3.1.0): lo mismo que `schema_search` y
  `schema_describe` de MCP (§5.1), y `schema.search` / `schema.describe` del WebSocket: entidades, propiedades y
  relaciones por parte del nombre, y algunas entidades en dos líneas cada una. Requieren `read`.
- **Sugerencias de un error de la consulta** (3.1.0): un nombre que no existe (`p.nme`, `Area`) responde `400` con
  `suggestions: [{ name: "nme", didYouMean: ["name"] }]` además del mensaje, en el cuerpo de REST, en `error.data` del
  WebSocket y en `structuredContent` de MCP (λORM L41). La UI ofrece reemplazarlo con un clic.
- **Una ruta que no existe** (3.1.0): `404` en JSON como el resto (`{ error: "NotFoundError", message }`), con las
  rutas más parecidas (`GET /iot/v1/schema/entities is not a route of this gateway; did you mean GET /iot/v1/entities?`).
- **Una fuente sin su variable de conexión** (3.1.0): con `runtime.checkConnections`, el esquema no arranca y su motivo
  nombra todas las variables que faltan (`source salesDocuments needs ORM_SALES_DOCUMENTS_CNX, which is not set: give it
  in orm.schemas[].env …`), antes de abrir ninguna conexión. Sin la comprobación, la primera consulta a esa fuente
  responde `503` (`ConnectionError`, λORM L43) con el mismo nombre de variable.

## 5. MCP

Un **servidor MCP por esquema** (`/iot/v1/mcp`), no uno con un argumento `schema` en cada tool: las descripciones
llevan el dominio de ese esquema (mezclar varios confunde al modelo), cada versión se registra como un MCP separado en
el cliente (`iot-v1`, `iot-v2`) y las tools mantienen los mismos nombres. El protocolo vive en el edge; el catálogo, la
autorización y la ejecución de tools, en el schema worker (`McpServerProxy` en el medio).

### 5.1 Tools

Nombres en `[a-z_]`. Las descripciones y los `inputSchema` (JSON Schema) se generan al arrancar el esquema e
**incluyen su dominio** (entidades, propiedades, relaciones, enums), para que el modelo sepa qué consultar sin una
llamada previa. Cada tool es una clase que implementa `Tool` (`definition`, `permission`, `execute(args)`), registrada
en el `ToolCatalog`.

Una tool por cada método, **incluidas las escrituras**: paridad completa con `http`. No es lo habitual en servidores
MCP, pero es una decisión explícita: el agente puede hacer lo mismo que una aplicación **si su credencial lo permite**.

| Tool | Argumentos | Endpoint REST equivalente | Permiso | Anotaciones MCP |
| --- | --- | --- | --- | --- |
| `orm_execute` | `query`, `data?`, `options?` | `POST /execute` | `read` (solo `select`) o `write` | `destructiveHint: true` (con `write`) / `readOnlyHint: true` (solo `read`) |
| `orm_execute_script` | `script`, `data?`, `options?` | `POST /script` | `script` | `destructiveHint: true` |
| `orm_execute_queued` | `topic`, `query`, `data?`, `chunk?`, `options?` | `POST /execute-queued` | `queue` | `destructiveHint: true` |
| `orm_plan` | `query`, `options?` | `POST /plan` | `read` | `readOnlyHint: true` |
| `orm_metadata` | `query` | `POST /metadata` | `read` | `readOnlyHint: true` |
| `orm_model` | `query` | `POST /model` | `read` | `readOnlyHint: true` |
| `orm_parameters` | `query` | `POST /parameters` | `read` | `readOnlyHint: true` |
| `orm_constraints` | `query` | `POST /constraints` | `read` | `readOnlyHint: true` |
| `schema_get` | — | `GET /schema` | `read` | `readOnlyHint: true` |
| `schema_version` | — | `GET /schema/version` | `read` | `readOnlyHint: true` |
| `schema_domain` | — | `GET /domain` | `read` | `readOnlyHint: true` |
| `schema_entities` | `entity?` | `GET /entities`, `GET /entities/:entity` | `read` | `readOnlyHint: true` |
| `schema_search` | `text` | — (para un modelo: texto compacto) | `read` | `readOnlyHint: true` |
| `schema_describe` | `entities` | — (para un modelo: texto compacto) | `read` | `readOnlyHint: true` |
| `schema_enums` | `enum?` | `GET /enums`, `GET /enums/:enum` | `read` | `readOnlyHint: true` |
| `schema_sources` | `source?` | `GET /sources`, `GET /sources/:source` | `read` | `readOnlyHint: true` |
| `schema_mappings` | `mapping?`, `entity?` | `GET /mappings…` | `read` | `readOnlyHint: true` |
| `schema_views` | — | `GET /views` | `read` | `readOnlyHint: true` |
| `schema_stages` | `stage?` | `GET /stages`, `GET /stages/:stage` | `read` | `readOnlyHint: true` |
| `stage_exists` | `stage` | `GET /stages/:stage/exists` | `read` | `readOnlyHint: true` |
| `stage_export` | `stage` | `GET /stages/:stage/export` | `read` | `readOnlyHint: true` |
| `stage_import` | `stage`, `data` | `POST /stages/:stage/import` | `stageImport` | `destructiveHint: true` |
| `gateway_version` | — | `GET /version` | `read` | `readOnlyHint: true` |
| `gateway_health` | — | `GET /health` | `read` | `readOnlyHint: true` |
| `admin_schema_get` | — | `GET /admin/workspaces/{ruta}/schema` | `schemaRead` (con `management`) | `readOnlyHint: true` |
| `admin_schema_validate` | `text` | `POST /admin/validate` | `schemaRead` (con `management`) | `readOnlyHint: true` |
| `admin_stage_fetch` | `stage?` | `POST …/commands/fetch` | `schemaRead` (con `management`) | `readOnlyHint: true` |

- **`tools/list` se filtra por los permisos de la credencial:** una credencial sin `script` no ve
  `orm_execute_script`; con solo `read`, `orm_execute` aparece con la descripción "solo consultas de lectura con esta
  credencial". El modelo no ve herramientas que no puede usar.
- Las **anotaciones** (`readOnlyHint` / `destructiveHint`) no bloquean nada: le indican al cliente qué tools
  modifican datos, para que pueda pedir confirmación. Lo que bloquea son los permisos (§6).
- Mismas reglas que REST: `orm_execute_script` responde error si `scripts.enabled` es `false`; `orm_execute_queued`
  responde error si el esquema no tiene cola.
- `mcp.tools.include` / `exclude` (global o por esquema) restringen además la lista.
- **Un esquema grande (desde 3.1.0).** Si el dominio descrito no entra en la descripción de `orm_execute` (12.000
  caracteres), esta lleva solo los nombres de las entidades y apunta a `schema_search` y `schema_describe`, en vez de
  cortar el dominio y mandar a leerlo entero. Con el modelo de Ilusor (192 entidades): el dominio en JSON pesa 389 KB;
  la parte de dominio de `orm_execute`, 4 KB; `schema_describe` de dos entidades, 2 KB; y una búsqueda, de 0,1 a 8 KB
  (40 resultados como máximo, con `more` y una pista para acotarla). `schema_search` encuentra por parte del nombre
  (`Areas.type` solo en `Areas`) y, si nada lo contiene, da los nombres más parecidos (`didYouMean`).
  `schema_entities` y `schema_domain` siguen devolviendo el JSON de REST: los clientes los usan como equivalentes.

### 5.2 Resultados y errores

- Éxito: `{ content: [{ type: 'text', text: <JSON del resultado> }], isError: false }`, armado en el schema worker.
  `structuredContent` con el mismo resultado se agrega solo si es chico (menos de 1 MB), para no duplicar el payload.
- **Límite de filas (`mcp.maxRows`, 500 por defecto).** Si `orm_execute` u `orm_execute_script` devuelven un array
  más largo, se recorta y se avisa al modelo:

  ```json
  { "rows": [ …500 filas… ], "truncated": true, "returned": 500, "total": 18234,
    "hint": "The result was cut to 500 rows. Use .page(1, 500) (or a smaller page), aggregate with map/count, or filter the query more." }
  ```

  Si no hace falta recortar, el resultado va tal cual (sin envoltorio). Solo aplica a MCP. El recorte es posterior a
  la ejecución: protege el contexto del modelo, no la base (para eso, `server.maxResponseBytes` y `server.timeout`).
- Error de λORM (sintaxis, entidad inexistente, constraint, script deshabilitado o fuera de límites, timeout) o falta
  de permiso: `isError: true` con el mensaje en `text`, para que el modelo pueda leerlo y corregir, y desde 3.1.0
  `structuredContent: { error, status, code?, message }`, el mismo nombre, status y código de la base que REST y
  WebSocket, para un programa que usa el MCP como transporte (docs/DATA_GATEWAY_CLIENTS_PLAN.md §5).
- Esquema no disponible, error de protocolo, tool inexistente, argumentos inválidos, no autenticado: error JSON-RPC.

### 5.3 Escrituras por MCP

No hay un modo de solo lectura del transporte: lo que puede hacer un agente lo deciden **los permisos de su
credencial**. Para un agente que solo consulta, una credencial con `[ read ]`: puede ejecutar consultas `select`
pero no escribir, ni correr scripts, ni encolar, ni importar stages, por ningún transporte. Además:
`schemas[].transports` para no exponer un esquema por MCP, `mcp.tools.exclude`, los permisos del usuario de base de
datos (la garantía de fondo) y las anotaciones MCP.

### 5.4 Resources

| URI | Contenido |
| --- | --- |
| `lambdaorm://schema/domain` | dominio completo del esquema (entidades, propiedades, relaciones, enums) en JSON |
| `lambdaorm://entities/{entity}` | una entidad (template) |
| `lambdaorm://guide/expressions` | guía corta del lenguaje de consultas (Markdown), para dar contexto al modelo |

`subscribe` / `unsubscribe` son no-op (el esquema no cambia en caliente). Sin prompts en la primera versión.

**Que el modelo use bien λORM.** Los modelos conocen SQL de memoria, pero el lenguaje de λORM lo aprenden en cada
sesión con la guía, las descripciones y los errores. Por eso la guía, los ejemplos dentro de las descripciones de
`orm_execute` y los mensajes de error se ajustan midiendo con un **conjunto de evaluación** (preguntas en lenguaje
natural sobre northwind con su respuesta esperada; ver el plan, fase 3), no a ojo.

### 5.5 Transportes MCP

**`mcpHttp`** (`@modelcontextprotocol/sdk`):

| Ruta | Protocolo | Cliente |
| --- | --- | --- |
| `POST/GET/DELETE {basePath}/{esquema}/mcp` | Streamable HTTP (revisión 2025-03-26 de la especificación) | Claude Code `--transport http`, clientes nuevos |
| `GET {basePath}/{esquema}/sse` + `POST {basePath}/{esquema}/messages?sessionId=<id>` | HTTP+SSE (obsoleto), solo con `legacySse: true` | clientes viejos |
| `GET {basePath}/status` | estado, esquemas, sesiones SSE abiertas | operación |

- Streamable HTTP **sin estado** por defecto (`stateful: false`): el servidor no manda notificaciones propias, así que
  cada `POST` es independiente y cualquier réplica lo atiende, sin afinidad de sesión en el ingress. El SSE viejo sí
  mantiene sesión en memoria y necesita afinidad de sesión con más de una réplica.
- Autenticación: Streamable HTTP en cada request; SSE viejo en el `GET` y en cada `POST`.

**`mcpWebSocket`** (`ws`, **no estándar**): upgrade en `{basePath}/{esquema}/mcp` (autentica en el handshake; sin
credenciales responde 401 y cierra), JSON-RPC 2.0 con los métodos MCP (`initialize`, `ping`, `tools/list`,
`tools/call`, `resources/*`, `prompts/*`, `completion/complete`, `logging/setLevel`), más `GET {basePath}/status` y
`/asyncapi` por HTTP. Se ofrece para clientes y gateways que lo soportan por su cuenta; Claude Code y la mayoría de los
clientes usan `mcpHttp`.

Ejemplo con Claude Code: `claude mcp add --transport http iot-v1 http://gateway:<puerto>/iot/v1/mcp --header "X-Api-Key: …"`.

## 6. Autenticación y autorización

### 6.1 Autenticación

Bloque `authentication` en tres niveles: global, por transporte (`transports.<t>.authentication`) y por esquema
(`schemas[].authentication`); gana el más específico (esquema → transporte → global) y reemplaza a los otros. Se aplica
en el edge, antes de enviar nada al esquema. Cada tipo es un `AuthenticatorPort` registrado en el
`AuthenticatorRegistry`:

| `adapter` | Credencial única (todos los permisos) | Varias credenciales con permisos | Valida |
| --- | --- | --- | --- |
| `none` (por defecto) | — | — | todo (principal anónimo con todos los permisos) |
| `local`, `type: bearer` | `token` | `tokens: [{ name, value, permissions }]` | `Authorization: Bearer <token>` |
| `local`, `type: apikey` | `value` (+ `header`, def. `X-Api-Key`) | `keys: [{ name, value, permissions }]` | el header |
| `local`, `type: basic` | `username`, `password` | `users: [{ username, password, permissions }]` | `Authorization: Basic …` |
| `jwt` (fase posterior) | — | roles / scopes del token mapeados a permisos | JWT firmado (Keycloak, Entra ID) |

- Una credencial `local` sin su secreto (o con su `$VAR` no definida) es error de configuración: el proceso no
  arranca. Abierto es solo `adapter: none`, explícito.
- Comparación de secretos en tiempo constante (`crypto.timingSafeEqual`).
- `http`: `/ping`, `/health` y `/metrics` (en la raíz y bajo cada esquema) sin autenticación.
- El resultado es un `Principal` (`name`, `permissions`) que viaja en cada mensaje al schema worker. Nunca viaja el
  secreto.

### 6.2 Autorización (permisos)

| Permiso | Habilita |
| --- | --- |
| `read` | esquema, dominio, plan, metadata, model, parameters, constraints, `stage_exists`, `stage_export`, health, version, y `execute` **solo si todas sus sentencias son `select`** |
| `write` | `execute` con escrituras (`insert`, `update`, `delete`, `upsert`, `merge`, `bulk*`, …) |
| `script` | `executeScript` / `POST /script` (un script de 3xpr puede hacer cualquier cosa adentro: no se clasifica, es un permiso aparte) |
| `queue` | `executeQueued` (y además `write` si la consulta escribe) |
| `stageImport` | `stage_import` / `POST /stages/:stage/import` |
| `schemaRead` | administración (§11): el `lambdaORM.yaml` de cada workspace y su validación |
| `schemaWrite` | administración: cambiar el `lambdaORM.yaml` |
| `schemaAdmin` | administración: crear y eliminar workspaces |
| `workbenchWrite` | administración: guardar consultas, scripts y diagramas en los workspaces, sin tocar el esquema |
| `ddl` | administración: cambiar la estructura de las bases de un stage (`push`, `drop`, §11.3) |
| `build` | administración: generar el código del dominio en `src/` del workspace (§11.5) |

Los de administración **nunca se dan por defecto**: una credencial sin lista de permisos tiene los cinco de los
datos, y para administrar hay que nombrarlos.

- Se autoriza en el **schema worker**, en la capa de aplicación, antes de ejecutar, con `AuthorizationPolicy` (dominio,
  sin red). Aplica igual en REST, MCP y WebSocket.
- **Lectura o escritura sin tocar `lib`:** `orm.metadata(query)` (API pública) devuelve el árbol de la consulta, donde
  cada sentencia tiene `classtype: 'Sentence'` y `name` = su acción (`select`, `insert`, …; ver
  `base/src/lib/sentence/domain/sentence.ts`). Con solo `read`, el caso de uso pide la metadata y rechaza si alguna
  sentencia (incluidas las de un `include`) no es `select`. Con `write`, no hace falta clasificar.
- Sin permiso: `403` en REST, error con `status: 403` en WebSocket, `isError: true` en MCP, con un mensaje claro
  ("la credencial `agent` no tiene permiso `write`").
- Permisos por entidad (`write:Orders`) no existen en 3.0.0; el mismo árbol de metadata permitiría agregarlos.

## 7. API WebSocket (`webSocket`, 3.2.0)

JSON-RPC 2.0. La conexión se abre contra la ruta del esquema (`ws://host:port{basePath}/iot/v1`) y se autentica en el
upgrade; en la raíz solo están `general.*` y `gateway.schemas`.

Un navegador no puede mandar cabeceras en un WebSocket: la credencial va entonces en los subprotocolos
(`Sec-WebSocket-Protocol`), `lambdaorm` y `lambdaorm.headers.<base64url del JSON de las cabeceras>` (por ejemplo
`{"X-Api-Key":"…"}`); la gateway responde `lambdaorm` y autentica con esas cabeceras como si vinieran en el pedido. Como
en una cabecera `Authorization`, la credencial viaja en el pedido: fuera de una máquina local, `wss://`. Lo mismo acepta
el MCP sobre WebSocket (con su subprotocolo `mcp`).

`GET {basePath}/transports` (HTTP, sin credencial) dice los transportes de la gateway: su puerto, su ruta base, cómo se
llega a un esquema y dónde está su documento (`/openapi.json` del HTTP, `/asyncapi.json` de los WebSocket, que se pueden
leer sin credencial). Detrás de un proxy sus URLs son otras: el IDE las toma de su connection (§11.9).

```json
→ { "jsonrpc": "2.0", "id": 1, "method": "query.execute", "params": { "query": "Products.filter(p => p.price > 10)", "data": {} } }
← { "jsonrpc": "2.0", "id": 1, "result": [ … ] }
← { "jsonrpc": "2.0", "id": 2, "error": { "code": -32000, "message": "…", "data": { "name": "ScriptDisabledError", "status": 403 } } }
```

| Sección | Métodos |
| --- | --- |
| `general` | `version`, `health`, `ping` |
| `gateway` | `schemas` (solo en la raíz) |
| `query` | `execute`, `executeQueued`, `script`, `plan`, `metadata`, `model`, `parameters`, `constraints` |
| `schema` | `schema`, `version`, `domain`, `sources`, `source`, `entities`, `entity`, `enums`, `enum`, `mappings`, `mapping`, `entityMapping`, `stages`, `stage`, `views` |
| `stage` | `exists`, `export`, `import` |

**Notificaciones del servidor** (lo que WebSocket da y REST no; JSON-RPC sin `id`):

| Notificación | Cuándo |
| --- | --- |
| `queue.completed` / `queue.failed` | terminó una ejecución encolada con `executeQueued` y `notify: true` en esa conexión |
| `schema.statusChanged` | el esquema de la conexión pasó a `error` / `restarting` o volvió a `ready`; `pending`: una versión nueva de su workspace no arrancó y sigue la anterior |
| `workspace.changed` | cambió algo en el workspace del esquema (una conexión a la raíz: en cualquiera): `{ path, kind, files?, at }`, `kind` `added` / `removed` / `schema` (`lambdaORM.yaml`, recargado) / `env` (`.env`, recargado) / `files` (otros: `workbench/`, `data/`, …) |

```json
→ { "jsonrpc": "2.0", "id": 7, "method": "query.executeQueued", "params": { "topic": "…", "query": "…", "notify": true } }
← { "jsonrpc": "2.0", "id": 7, "result": { "queueId": "q-123" } }
← { "jsonrpc": "2.0", "method": "queue.completed", "params": { "queueId": "q-123", "rows": 18234 } }
```

Los `params` son el body (o los parámetros de ruta) del endpoint REST equivalente. Los errores llevan en `data` el
`name` y el `status` HTTP que habría devuelto REST. Si el esquema deja de estar `ready`, los mensajes responden error
con `status: 503`; la conexión no se cierra y vuelve a funcionar cuando el esquema se recupera. El primer consumidor es
el adaptador WebSocket de `@lambdaorm/client` (§9).

## 8. Observabilidad

- **Logs:** cada worker loguea con su etiqueta (`[edge]`, `[schema:iot/v1]`, `[supervisor]`); el supervisor loguea arranques,
  caídas, reinicios, heartbeats perdidos y cambios de estado, transportes expuestos / no expuestos y la configuración
  efectiva sin secretos. Cada operación se registra con el nombre de la credencial (nunca su valor).
- **Métricas:** cada worker tiene las suyas; `GET /metrics` (en `http`) las pide a todos a través del supervisor y las
  devuelve juntas: las actuales más `data_gateway_requests_total{transport,schema,method,status,credential}`,
  `data_gateway_request_duration_seconds{transport,schema,method}`, `data_gateway_forbidden_total{credential,permission}`,
  `data_gateway_connections{transport}`, `data_gateway_schema_status{schema,status}`,
  `data_gateway_worker_restarts_total{kind,name,reason}` y `data_gateway_event_loop_lag_seconds{worker}`.
  `GET /iot/v1/metrics` filtra por esquema. Cada muestra lleva `worker` (`edge`, `schema:iot/v1`); los reinicios se
  publican como `data_gateway_schema_restarts{schema}` (lo que el edge sabe de cada esquema).
- **Health:** §4 (`/health`, `/{esquema}/health`, `/schemas`).
- **Rechazos por carga:** `data_gateway_throttled_total{schema,transport}` (respuestas `429` por `maxConcurrent`).
- OpenTelemetry queda para una fase posterior (`TracerPort` + adaptador).

### 8.1 Auditoría de escrituras

Cada operación que modifica datos o puede hacerlo deja una entrada de auditoría, separada del log general, para poder
responder "¿qué modificó el agente ayer?":

| Operación | Cuándo se audita |
| --- | --- |
| `execute` | cuando alguna sentencia no es `select` (misma clasificación que §6.2) |
| `executeScript` | siempre |
| `executeQueued` | siempre (al encolar) |
| `stageImport` | siempre |

```json
{ "type": "audit", "time": "2026-11-17T14:03:22.114Z", "schema": "iot/v1", "transport": "mcpHttp",
  "credential": "agent", "operation": "execute", "actions": ["insert"], "entities": ["Devices"],
  "query": "Devices.insert()", "rows": 1, "durationMs": 42, "result": "ok" }
```

- La escribe el schema worker después de ejecutar (también si falla: `result: "error"` con el mensaje), a través de
  `AuditPort`. El adaptador de 3.0.0 escribe una línea JSON por entrada en la salida estándar con `type: "audit"`, para
  que el colector de logs del entorno (Loki, ELK, CloudWatch…) la separe y la retenga aparte. Otro destino (archivo,
  Kafka) es otro adaptador.
- Lleva el nombre de la credencial, nunca su secreto. Los parámetros de la operación (`data`) no se incluyen salvo
  `audit.includeData: true`, porque pueden tener datos personales.
- `audit.enabled: false` la desactiva (desarrollo local).

## 9. Clientes (`@lambdaorm/client`, `@lambdaorm/cli`)

**3.0.0: sin cambios.** El cliente arma cada URL como `basePath + ruta`, así que alcanza con incluir el esquema en la
URL base; por eso el gateway sirve también las rutas generales bajo cada esquema (§4):

```ts
await orm.init('http://gateway:8080/iot/v1', { token })   // → POST http://gateway:8080/iot/v1/execute
```
```bash
lambdaorm execute -e "Devices.filter(…)" --url http://gateway:8080/iot/v1
```

Con un único esquema en la raíz, todo queda como hoy (`http://gateway:8080`).

**3.2.0: adaptador WebSocket en `@lambdaorm/client`** (con su changeset; `lib` no cambia): `orm.init('ws://gateway:8081/iot/v1')`
usa la conexión persistente para todas las operaciones y expone `orm.on('queue.completed', …)` /
`orm.on('schema.statusChanged', …)`. Mejora opcional posterior en `client` y `cli`: `orm.init(url, { schema })`,
`orm.schemas()` y `--schema`.

## 10. UI de consultas (`@lambdaorm/ui`, 3.1.0)

Una interfaz web para escribir, probar y ejecutar consultas de λORM contra un esquema del gateway, con autocompletado
del modelo. Sirve para probar, para aprender el lenguaje y para validar lo que después hace un agente por MCP.

### 10.1 Librería y app

| Pieza | Qué es | Dónde |
| --- | --- | --- |
| **`@lambdaorm/ui`** | librería de componentes **React (web)**, publicada en npm (Changesets, como `base` / `lib` / `client` / `cli`) | `packages/ui` |
| **data-gateway-ide** | la app que usa la librería: sus connections, su workspace y su backend, que llega a cada gateway por `management` (§11.9) | `packages/ide` |

La librería no depende del gateway: cualquier proyecto (por ejemplo un Portal) la instala y monta el componente
apuntando a un data-gateway. `react` y `react-dom` son `peerDependencies`. `@lambdaorm/lib` y `@lambdaorm/base` no se
modifican.

```tsx
import { QueryWorkbench } from '@lambdaorm/ui'
import '@lambdaorm/ui/styles.css'

<QueryWorkbench
  baseUrl="https://gateway.example.com"     // o api={miAdaptador} (ver abajo)
  schema="iot/v1"                           // opcional: si falta, muestra el selector de /schemas
  headers={() => ({ 'X-Api-Key': token })}  // cómo autenticar; la librería no guarda credenciales
  operations={['plan', 'metadata', 'model', 'parameters', 'constraints', 'execute', 'executeQueued', 'executeScript']}
  theme="dark"
  onResult={(r) => …}
/>
```

Exporta además las piezas por separado, para armar otra pantalla: `QueryEditor` (Monaco + tipos del esquema),
`ScriptEditor`, `DataEditor` (JSON de parámetros), `OptionsPanel`, `ResultViewer` y `SchemaSelector`.

**Arquitectura de la librería (hexagonal):** los componentes dependen de un puerto, `QueryApiPort` (`schemas`,
`whoami`, `typings`, `plan`, `metadata`, `model`, `parameters`, `constraints`, `execute`, `executeQueued`,
`executeScript`). La librería trae `RestQueryApi` (con `fetch`, contra la API REST del gateway) y se puede inyectar
otro adaptador con `api={…}`, por ejemplo para que un Portal pase por su propio backend. La lógica (estado de la
consulta, historial, conversión JSON ↔ YAML, armado de los tipos para Monaco) está en módulos sin React, probados
aparte.

### 10.2 Pantalla

- **Esquema:** selector a partir de `GET /schemas` (solo los `ready`), salvo que venga fijo por prop.
- **Modo consulta / modo script:** editor Monaco de la consulta (`Orders.filter(p => …)`) o de un script de 3xpr
  (`executeScript`, que puede llamar varias veces a `orm.execute` en una transacción).
- **Datos:** editor JSON (Monaco) para `data`. El botón **parameters** lo completa con los parámetros que pide la
  consulta, con su tipo.
- **Opciones:** `stage`, `view` y el resto de `QueryOptions`; para `executeQueued`, `topic` y `chunk`; para scripts,
  `timeout` y `maxIterations` (nunca más que los límites del gateway).
- **Acciones:** plan, metadata, model, parameters, constraints, execute, executeQueued y executeScript. Las que la
  credencial no tiene permitidas (`GET /whoami`) se muestran deshabilitadas con el motivo; executeScript también si el
  esquema tiene `scripts.enabled: false`.
- **Resultado (`ResultViewer`):**
  - vista JSON coloreada y plegable (árbol), vista cruda formateada y vista **YAML**;
  - vista de **tabla** cuando el resultado es un array de objetos;
  - copiar al portapapeles y **descargar** como `.json` o `.yaml`;
  - estado HTTP, duración, cantidad de filas y tamaño; los errores se muestran con su `name`, `status` y mensaje.
  - Respuestas muy grandes: la vista árbol / tabla se limita a las primeras N filas (con aviso) y la descarga trae
    todo.
- **Historial:** las últimas consultas por esquema en `localStorage` (texto de la consulta, `data` y opciones; nunca
  credenciales ni resultados), con opción de borrarlo.
- Atajos: `Ctrl/Cmd+Enter` ejecuta la acción principal (execute o executeScript).

### 10.3 Autocompletado y validación

- **Tipos del esquema:** `GET /{esquema}/typings` devuelve un `.d.ts` equivalente a `__queryable.d.ts` (ver
  `packages/lib/src/dev/northwind/model/`): una interfaz `QryX` por entidad con sus propiedades y relaciones
  (`ManyToOne`, `OneToMany`, `OneToOne`), y una declaración global por entidad raíz (`declare const Orders: QryOrders`)
  para que una consulta como `Orders.filter(p => p.…)` sea TypeScript válido para Monaco. Lo genera un
  **`TypingsGenerator`** del gateway (función pura: dominio del esquema → texto), sin depender del CLI; un test compara
  su salida con la del generador del CLI para northwind, para que no diverjan.
- **Declaraciones fijas:** `Queryable` y sus cláusulas, y las funciones del lenguaje (`desc`, `asc`, `between`,
  `includes`, `as`, …), tomadas del build de `@lambdaorm/base` (`repository/domain/queryable`) y empaquetadas en la
  librería en el momento del build.
- Monaco usa su servicio de TypeScript con esas declaraciones (`addExtraLib`): autocompletado de entidades,
  propiedades, relaciones y cláusulas, y ayuda de firmas.
- Se apagan los diagnósticos de TypeScript que no aplican a λORM (por ejemplo "nombre desconocido" para los parámetros
  como `id`, que vienen en `data`).
- **Validación real con λORM:** mientras se escribe (con una espera de ~500 ms), la UI llama a `constraints` /
  `metadata` y muestra los errores de λORM como marcas en el editor, con su posición.

### 10.4 Ya no la sirve el gateway (4.0.0)

Hasta 3.x el transporte `http` servía la app en `/ui` (`transports.http.ui`). Desde 4.0.0 la app es solo el
data-gateway-ide (§11.9), con su propia imagen, y sus cabeceras de seguridad (`Content-Security-Policy` sin orígenes
externos, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`) las pone su backend.

## 11. Administración de los workspaces (`admin`, 3.2.0)

`DATA_GATEWAY_ADMIN_PLAN.md`, fase 2. El transporte `management` (§12) expone `{basePath}/admin`, con la autenticación
de ese transporte (o la global) y los permisos de §6.2; sin `management` no hay administración (hasta 3.x estaba en
`http` con `admin.enabled`). **Solo escribe archivos del volumen**: lo que
escribe lo toma el monitor de los workspaces (`orm.watch`, §2.2), que agrega, recarga (blue-green) o quita el esquema.
Corre en el borde, sin conectar a ninguna base y sin ejecutar nada del esquema.

Un workspace se nombra por su ruta en **un** segmento, codificada: `iot%2Fv1` (`~` es el esquema en la raíz).

| Método | Ruta | Hace | Permiso |
| --- | --- | --- | --- |
| `GET` | `/admin` | `{ enabled, can }`: qué puede hacer esta credencial (la UI muestra las acciones con eso) | cualquiera autenticado |
| `GET` | `/admin/workspaces` | los esquemas con su estado y la versión de su `lambdaORM.yaml` | `schemaRead` |
| `POST` | `/admin/workspaces` | crea uno bajo `orm.workspacePath`: `{ path, template?: 'empty', copyOf?: <ruta>, name?, description? }` → `201` (`name` y `description` van arriba del `lambdaORM.yaml`); `409` si la carpeta existe; `400` si hay un esquema en la raíz (tiene que ser el único: se mueve a una carpeta para agregar otros) | `schemaAdmin` |
| `DELETE` | `/admin/workspaces/{ruta}?confirm={ruta}` | lo mueve a `<workspacePath>/.trash/<ruta>-<fecha>` (no borra nada) | `schemaAdmin` |
| `GET` | `/admin/workspaces/{ruta}/schema` | `{ text, version }` del `lambdaORM.yaml`, `ETag` | `schemaRead` |
| `PUT` | `/admin/workspaces/{ruta}/schema` | `{ text }` con `If-Match: <version>`: lo valida y lo escribe atómico | `schemaWrite` |
| `PATCH` | `/admin/workspaces/{ruta}/schema` | un cambio de un elemento (un formulario, §11.4): `{ op, at, value?, to?, expected? }` | `schemaWrite` |
| `POST` | `/admin/workspaces/{ruta}/references` | `{ at }` → quién usa ese elemento (antes de eliminarlo) | `schemaRead` |
| `GET` | `/admin/workspaces/{ruta}/variables` | las variables de las conexiones (§11.5): cuáles define el `.env` y quién las usa; **nunca su valor** | `schemaRead` |
| `PUT` | `/admin/workspaces/{ruta}/variables` | `{ set?: { NOMBRE: valor }, remove?: [NOMBRE] }` en el `.env`, conservando el resto | `schemaAdmin` |
| `POST` | `/admin/workspaces/{ruta}/build` | `{ language: node \| client-node, write? }`: el modelo y los repositorios (§11.5) | `build` (+ `read`) |
| `GET` | `/admin/workspaces/{ruta}/build.zip?language=` | lo mismo como `.zip`, sin escribir nada | `build` (+ `read`) |
| `GET` | `/admin/workspaces/{ruta}/files?dir=` / `…/files/content?path=` | los archivos de `data/` y de `src/` (recursivo) / el texto de uno; nunca el `.env`, `orm_state/` ni un oculto | `schemaRead` |
| `POST` | `/admin/validate` | `{ text }` → `{ valid, issues: [{ severity, message, line?, column? }] }` | `schemaRead` |
| `GET` | `/admin/session` | el estado de la UI de la credencial que pregunta: `{ state, updatedAt }` o `{ state: null }` (§11.8) | autenticado |
| `PUT` | `/admin/session` | `{ state }` lo guarda (un objeto, hasta 2 MB); `{ state: null }` lo olvida | autenticado |
| `GET` | `/admin/expressions` | el lenguaje de las expresiones (3xpr): `{ functions, operators, constants, contexts }`; `contexts.stageSource` son las variables de la condición de un source de un stage (`entity`, `action`, `category`, `type`, `read`, `write`, `dml`, `ddl`) | `schemaRead` |
| `POST` | `/admin/expressions/check` | `{ expression, context? }` → `{ valid, error?, variables, unknown }`: si parsea y si usa solo las variables de su contexto | `schemaRead` |
| `GET` | `/admin/workbench[?schema={ruta}]` | lo guardado en los workspaces (§11.1), `ETag`; con `If-None-Match` igual, `304` | `read` o `workbenchWrite` |
| `PUT` | `/admin/workbench` | `{ items }`: guarda, mueve o renombra; cada uno que existía dice su `version` | `workbenchWrite` |
| `POST` | `/admin/workbench/remove` | `{ ids }`: elimina (una carpeta con lo que tiene) | `workbenchWrite` |

**Concurrencia.** Cada lectura devuelve la versión (un hash del contenido) y cada escritura dice cuál cambia:

| Respuesta | Cuándo |
| --- | --- |
| `428 PreconditionRequiredError` | un `PUT` del esquema sin `If-Match` |
| `412 PreconditionFailedError` | otro lo cambió desde que se leyó; `details` trae lo que hay ahora (`{ version, text }` del esquema, `{ ids }` del workbench) |
| `422 SchemaValidationError` | el `lambdaORM.yaml` no es válido; `details.issues` con la línea de cada error (no se escribe nada) |
| `409 ConflictError` | el workspace está ocupado más de 10 s (otra escritura en curso), o la carpeta de uno nuevo existe |

Las escrituras a un workspace van de a una: en el proceso, en fila; entre réplicas sobre el mismo volumen, un
`.lambdaorm.lock` creado con `O_EXCL` (uno de más de 30 s se considera abandonado). Cada archivo se escribe atómico
(temporal + `rename`): quien lee ve el anterior o el nuevo, nunca la mitad.

**Validación.** El YAML (cada error en su línea), la forma, un nombre repetido en una lista (dos propiedades `id`), los
tipos de las propiedades (uno que λORM no conoce es una
advertencia, no un error: λORM lo acepta) y λORM completando el esquema sin conectar (`extends`, relaciones, mappings).
`application.start` y los listeners no se ejecutan: son código del esquema.

### 11.1 Lo guardado en un workspace (`workbench/`)

Las carpetas, consultas, scripts y diagramas de la UI, un archivo por elemento y carpetas reales (se versionan con git
junto al esquema):

```text
/workspaces/iot/v1/workbench/
  reportes/                       una carpeta; .folder.yaml con su id y su descripción
    ventas por mes.query.yaml     { id, description, mode: query, query, script, data, options, createdAt, updatedAt }
    cierre.script.yaml            una consulta en modo script
  modelo.diagram.yaml             { id, description, entities, positions, bends, compact, relationNames }
```

- Los elementos son los `SavedItem` de `@lambdaorm/ui`: `id`, `kind` (`folder`, `query`, `diagram`), `schema`,
  `parentId`, `name`, `description`. El lugar de cada uno sale de sus carpetas y su nombre; mover o renombrar una
  carpeta mueve lo que tiene.
- Un archivo escrito a mano (sin `id`) también es un elemento: su id es su lugar (`file:workbench/a.query.yaml`), y
  `data` / `options` pueden ser YAML en lugar de texto JSON.
- Un nombre no puede tener `/ \ : * ? " < > |`, empezar con un punto ni pasar de 120 caracteres; dos elementos del mismo
  tipo no pueden llamarse igual en una carpeta.
- Un archivo que no es YAML válido (escrito a mano) **no es un elemento**: va en `problems` (`{ schema, file, message }`)
  y la UI lo avisa. Guardar un elemento nunca pisa un archivo que no es suyo (`409`): lo que tiene no se pierde.

### 11.2 En la UI (`@lambdaorm/ui` 0.5.0)

- Con `schemaRead`, cada esquema del explorador (también uno en error, para arreglarlo) tiene **Esquema
  (lambdaORM.yaml)**: el archivo entero en Monaco, validado mientras se escribe (cada error en su línea) y, con
  `schemaWrite`, guardado con Ctrl+S con la versión leída. Si otro guardó otra versión, se muestran las dos lado a lado
  para elegir; si la gateway sirve una versión nueva y no hay cambios sin guardar, se toma sola.
- Con `schemaAdmin`, **Nuevo esquema** (vacío o copia de otro) y **Eliminar el esquema** (escribiendo su ruta).
- Con `workbenchWrite`, lo guardado (carpetas, consultas, scripts, diagramas) va a `workbench/` de cada workspace, en
  lugar del navegador, y se relee cuando cambia (`ETag`). Lo que el navegador tenía guardado se ofrece copiar al
  workspace. Sin `workbenchWrite`, se guarda en el navegador como antes.

### 11.3 Los comandos (`DATA_GATEWAY_ADMIN_PLAN.md` fase 3a)

Los comandos de la CLI sobre las bases de un stage, como **jobs**, en el worker del esquema (con su λORM y sus
conexiones). Uno a la vez por esquema: otro responde `409 BusyError` con el que está corriendo.

| Método | Ruta | Hace | Permiso |
| --- | --- | --- | --- |
| `GET` | `/admin/workspaces/{ruta}/commands` | `{ stages, can, running? }` | `read` |
| `POST` | `/admin/workspaces/{ruta}/commands/{comando}/preview` | qué haría (`push`, `drop`, `import`): `{ previewId, stage, sentences \| rows, expiresAt }` | el del comando |
| `POST` | `/admin/workspaces/{ruta}/commands/{comando}` | `{ stage?, previewId?, force?, save? }` → `202` con el job (`version` responde en el momento) | el del comando |
| `GET` | `/admin/workspaces/{ruta}/jobs[/{id}]` | los últimos jobs (sin resultado) / uno con su resultado | `read` |

| Comando | Qué hace | Vista previa | Permiso |
| --- | --- | --- | --- |
| `version` | la versión de la gateway y del esquema | — | `read` |
| `fetch` | las diferencias entre las bases y el modelo (ninguna: coinciden) | — | `read` |
| `export` | los datos del stage; con `save: true` además en `data/<stage>-<fecha>.json` del workspace (`workbenchWrite`) | — | `read` |
| `push` | crea o cambia las tablas según el modelo | las sentencias por source | `ddl` |
| `drop` | elimina los objetos de las bases del stage | las sentencias; la UI pide escribir el stage | `ddl` |
| `import` | importa un export | las filas por entidad | `stageImport` |
| `pull` | actualiza el esquema con la estructura de las bases (y el estado del stage, como λORM) | el diff del `lambdaORM.yaml` | `schemaWrite` |
| `introspect` | agrega al esquema las entidades de unos datos (`{ data, name }`) | el diff y las filas | `schemaWrite` |
| `incorporate` | `introspect`, y con el esquema recargado `push` e `import` de esos datos | el diff y las filas | `schemaWrite` + `ddl` + `stageImport` |

- `push`, `drop` e `import` ejecutan **la vista previa que se mostró**: sin `previewId` responden `409
  PreviewRequiredError`; cada vista previa sirve una vez, por 10 minutos, y solo con el mismo `lambdaORM.yaml` con que
  se hizo. `force` es `tryAllCan` (seguir aunque falle una sentencia).
- Cada job deja su registro (sin el resultado) en `orm_state/jobs/<id>.json` del workspace; `push`, `drop` e `import`
  se auditan como las escrituras (§8.1).
- **El `lambdaORM.yaml` que escriben `pull`, `introspect` e `incorporate`** (fase 3b): λORM calcula el esquema nuevo
  sin escribir nada (un λORM sobre una copia, sin conexiones ni archivo; `application.start` no corre) y la gateway lo
  escribe uniendo solo lo que cambió en el `Document` de `yaml`: comentarios, orden, estilo (`[a]` o `[ a ]`, listas
  indentadas o no) y las líneas largas plegadas a mano quedan como estaban. El modelo de Ilusor (10 mil líneas) sale
  idéntico byte a byte si no cambia nada. λORM sí normaliza lo que toca (saca lo que es igual al valor por defecto):
  el diff de la vista previa lo muestra.
- `incorporate` necesita la gateway del proceso con `orm.watch` (espera a que el esquema escrito se recargue para hacer
  `push` e `import`); en el runtime inline responde `409`.
- Pendiente: `build`.

### 11.4 Un elemento a la vez (`DATA_GATEWAY_ADMIN_PLAN.md` fase 4)

Lo que manda cada formulario de la UI: un cambio de **un** elemento, nombrado por nombres y no por posiciones
(`["domain", "entities", "Products", "properties", "price"]`).

| `op` | Hace |
| --- | --- |
| `set` | reemplaza el elemento por `value` (con el mismo nombre: para cambiarlo, `rename`) |
| `add` | agrega `value` (con su `name`) a la lista `at`; la crea si no está (`enums:` vacío, los `indexes` de una entidad) |
| `remove` | lo elimina; la respuesta dice quién lo usaba (`references`) |
| `rename` | le da el nombre `to` y renombra lo que lo nombra: de una entidad, las relaciones que la apuntan, su `extends`, sus mappings y views; de una propiedad, las claves, índices y relaciones de los dos lados y su mapping; de una relación, el `target` del otro lado; de un enum, las propiedades; de una source, los stages; de un mapping, las sources |

- **Concurrencia por elemento:** `expected` es el elemento como el formulario lo leyó. Si otro cambió ese mismo
  elemento, `412` con `details.current` (lo que tiene ahora); si cambió otro elemento, el cambio se aplica igual
  sobre el archivo de ahora.
- Se escribe con la misma unión de la fase 3b: el resto del archivo, sus comentarios y su estilo quedan como estaban.
  Un cambio que deja el esquema inválido no se escribe (`422`).
- En la UI, **Esquema (formularios)** de cada esquema: las secciones (entidades, enums, sources, mappings, stages),
  cada elemento en un formulario (las propiedades, relaciones, índices y valores en tablas), **Renombrar** y
  **Eliminar** (que antes muestra quién lo usa).

### 11.5 Conexiones y código (`DATA_GATEWAY_ADMIN_PLAN.md` fase 5)

- **Las variables de las conexiones** (`${NOMBRE}` en el `lambdaORM.yaml`) se definen en el `.env` del workspace: la
  gateway dice cuáles nombra el esquema, cuáles define el `.env` y qué sources las usan, y las define o quita sin tocar
  el resto del archivo (comentarios, orden, otras variables). **Ningún valor se devuelve**, ni en la API ni en la UI;
  el log y la auditoría solo nombran las variables. El monitor ve el `.env` cambiado y recarga el esquema
  (blue-green). Una variable también puede venir de `orm.schemas[].env` o del entorno de la gateway: `defined` es solo
  el `.env`.
- **`build`** genera lo mismo que `lambdaorm build -l node` (o `client-node`): `model.ts` y un repositorio por entidad,
  bajo `infrastructure.paths.src`/`domain` (`src/domain`). Con `write`, `model.ts` se reescribe siempre y un
  repositorio solo se crea si no está (una vez escrito es del usuario). No instala paquetes: eso es del proyecto que
  usa el código. El generador vive en `@lambdaorm/base` (`NodeCodeBuilder`) y lo comparten la CLI y la gateway.
- En la UI: **Variables (.env)** en los formularios del esquema (el valor nuevo en un campo de contraseña, que se vacía
  al guardar) y **Código (build)** en el panel de comandos (escribir en `src/` o descargar el `.zip`). El editor del
  `lambdaORM.yaml` sugiere las claves de cada lugar (entidad, propiedad, relación, source, mapping, stage…) y los
  valores conocidos (`type`, `dialect`, el `entity` de una relación, el `enum` de una propiedad, el `mapping` de una
  source).

### 11.6 Por MCP, solo lectura (`DATA_GATEWAY_ADMIN_PLAN.md` fase 6)

Con `management` expuesto, el MCP de cada esquema suma `admin_schema_get` (el `lambdaORM.yaml` como está escrito, con sus
comentarios; las conexiones como `${VARIABLES}`), `admin_schema_validate` (un cambio revisado sin guardarlo) y
`admin_stage_fetch` (las diferencias entre las bases y el modelo), solo para credenciales con `schemaRead`. Escribir
(el esquema, `push`, `drop`, …) no se ofrece por MCP: un modelo lo haría sin la vista previa ni la confirmación de la
UI. Un agente propone el cambio; una persona lo aplica.

La administración es una API REST para la UI: los clientes de la gateway (`@lambdaorm/data-gateway-client` y los que
vienen) no la cubren, y por eso no entra en la suite de conformidad de los clientes; la prueban las pruebas de
integración de la gateway.

### 11.7 El explorador como el workspace

En la UI, cada esquema se muestra como es su workspace: **config** (el `lambdaORM.yaml`, en lectura;
**Edit** con `schemaWrite`, y **Save** / **Cancel**), **domain** (entities, enums), **application**, **infrastructure** (mappings,
sources, stages y las variables del `.env`), **data** y **src** → **model** (sus archivos, en lectura) y **projects**
(las carpetas de primer nivel de `workbench/`, con consultas, scripts y diagramas). Cada elemento se abre en su pestaña,
en lectura, con **Edit**; seleccionar el esquema abre su pestaña: arriba los comandos en una barra de íconos (Lucide, del
color del tema; el nombre del comando y su descripción al pasar el mouse), debajo lo que el esquema es (su `name`,
`description` y `version`, claves del nivel superior del `lambdaORM.yaml` que λORM no usa salvo `version`) con
**Edit**; un esquema nuevo puede nacer con su nombre y descripción; `import`, `introspect`, `incorporate` y `build` abren un formulario
para elegir el archivo, la entidad o el lenguaje. Las pestañas se cierran de a una, todas menos la actual o todas (clic
derecho en una pestaña, o **⋯** al final de la barra).

En el árbol, cada esquema tiene **Metadata** (config, domain, application, infrastructure, data y src) y **Projects**, y
un botón para abrir su pestaña con los comandos.

### 11.8 Dónde estaba cada uno

La UI guarda dónde estaba cada persona: sus pestañas (lo que muestra cada una, y el texto de las consultas tal como se
escribió), la activa, lo desplegado del explorador y si está oculto. La gateway lo guarda por credencial en un SQLite del
workspace, `<orm.workspacePath>/.data-gateway/state.sqlite` (con `node:sqlite`; el monitor y el descubrimiento lo
ignoran), con `GET`/`PUT /admin/session`: un refresco, u otro navegador, empieza donde estaba. Sin `management` o sin
`orm.workspacePath` la UI lo guarda en el navegador. Los proyectos siguen siendo archivos de `workbench/`.

La credencial queda en la pestaña (`sessionStorage`: un refresco la mantiene, cerrar la pestaña la olvida), o en el
navegador con **Recordarme** (`localStorage`); al volver se verifica otra vez (`whoami`) y Logout la borra.

En un stage, cada source se elige de los sources del esquema y lleva su `condition`, una expresión de 3xpr que se
escribe con sugerencias (las variables de una sentencia, las funciones, y dentro de comillas las entidades o los valores
de `action`, `category` y `type`) y que la gateway verifica mientras se escribe. El orden importa: el primer source
cuya condición es verdadera toma la sentencia, y uno último sin condición toma el resto. El validador del esquema marca
como error una condición que no parsea y como advertencia una variable que no es de una sentencia.
En lectura, cada condición se ve con los colores de 3xpr; su botón de editar abre un formulario con el editor (colores,
sugerencias con Ctrl+Espacio, verificación) y, al costado, las variables de una sentencia (`entity`, `action`,
`category`, `type`, `read`, `write`, `dml`, `ddl`) con su tipo, qué son y sus valores, que se insertan con un clic.

En un diagrama de un proyecto, cada caja muestra todas las propiedades, las claves (PK y FK), solo la PK o solo el
nombre (`detail`, guardado con el diagrama); el **+** de una caja agrega sus tablas relacionadas que no estén, y
**exportar** lo da en PDF, PNG o SVG.

### 11.9 El data-gateway-ide

El IDE de la data-gateway es `packages/ide`, con su propia imagen (`flaviorita/data-gateway-ide`, Node, puerto 8080):
los estáticos de la app y un **backend** que la sirve y le hace de proxy. Como un IDE de bases de datos, **no tiene
workspaces**: se conecta a data-gateways, y sus esquemas, workspaces (`src/`, `data/`, `workbench/`) y proyectos están en
cada una. Abre directo en el área de trabajo, sin presentación ni login.

**Connections.** Cada **connection** tiene la URL del `management` de una gateway (protocolo `http`/`https`, host,
puerto y ruta base) **tal como la alcanza el backend del IDE** (en un compose, `http://data-gateway:9292`), y su
credencial (API key, bearer, basic o ninguna); su página muestra quién es esa credencial y sus roles (cada permiso con lo
que permite). El árbol empieza por las connections, cada una con sus esquemas; se pueden tener pestañas de varias a la
vez. Las connections quedan en el navegador (la clave solo si se pide recordarla; si no, en la pestaña): el backend no
guarda ninguna.

**El navegador solo habla con el backend del IDE** (mismo origen: la gateway no necesita CORS). Todo pedido a una
gateway va por el proxy, con la URL de destino en la ruta:

```text
{IDE}/gw/{base64url de la URL de destino}/{resto de la ruta}
  /gw/aHR0cDovL2RhdGEtZ2F0ZXdheTo5Mjky/admin/workspaces  →  http://data-gateway:9292/admin/workspaces
```

- Sirve igual para REST, para el upgrade de un WebSocket (la credencial en el subprotocolo, §7, se reenvía tal cual) y
  para MCP (Streamable HTTP y SSE).
- **Destinos permitidos:** `DATA_GATEWAY_IDE_TARGETS`, una lista de orígenes separados por coma
  (`http://data-gateway:9292,http://data-gateway:9291`), o `*` para cualquiera (un IDE local). Sin la variable el proxy
  no va a ningún lado (`403` que lo explica): un proxy abierto deja llegar a cualquier host de la red del IDE.
- Reenvía el método, el cuerpo y las cabeceras del pedido salvo `Cookie`, `Origin`, `Referer` y las de salto
  (`Connection`, `Host`, …); de la respuesta, todo salvo `Set-Cookie`. No guarda ni registra credenciales: el log nombra
  el destino, el método y el estado.
- Cabeceras de seguridad de la app: `Content-Security-Policy` sin orígenes externos (Monaco y sus workers van
  empaquetados), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. `GET /health` responde `ok`.

**Las pestañas de los transportes de datos.** Desde una connection se abren en pestañas, con su credencial y por el
proxy: su **API REST** (Swagger, con sus pedidos a la URL de `http`), su **WebSocket** (los métodos de su AsyncAPI, un
pedido JSON-RPC y lo que vuelve) y su **MCP** (sus tools de un esquema, llamadas con sus argumentos). Dónde están lo dice
`GET /transports` del `management`: con el host de la connection y el puerto de cada uno; si el backend del IDE los
alcanza por otras URLs, la connection las fija. Un transporte que la gateway no expone aparece deshabilitado.

Hasta 3.x la misma app, compilada en modo embebido, era la UI que la gateway servía en `{basePath}/ui`, y la gateway
respondía a cualquier origen (CORS). Las dos cosas se quitaron en 4.0.0 (§12).

## 12. El transporte `management` (4.0.0)

La API que usa el data-gateway-ide, en **su propio puerto**, separada de los transportes de datos para poder no
desplegarla: en producción los esquemas pueden venir ya configurados en los volúmenes, y entonces la gateway se despliega
sin `management` (sin administración, sin IDE) y solo con los transportes de datos.

```yaml
transports:
  http:
    port: $DATA_GATEWAY_HTTP_PORT          # los clientes
  management:
    port: $DATA_GATEWAY_MANAGEMENT_PORT    # el IDE; sin la variable, no se expone
    host: 0.0.0.0
    basePath: ''
    # authentication: …                    # como cualquier transporte; si no, la global
```

- **Como cualquier transporte** (§2.1): se expone si y solo si tiene puerto, con su `host`, su `basePath` y su
  `authentication` (o la global). Corre en el mismo proceso que la gateway, en el edge, y llega a los esquemas como
  `http`. Un puerto igual al de otro transporte es error de configuración.
- **Qué expone:** las rutas de `http` (las de nivel gateway salvo Swagger, y las de cada esquema: consultas, scripts,
  modelo, metadata, `typings`, stages…) **de todos los esquemas**, aunque `orm.schemas[].transports` no lo nombre, y la
  administración, `{basePath}/admin/…` (§11). Mismas rutas, mismos cuerpos y mismos permisos que en `http`: la UI usa el
  mismo adaptador REST.
- **Credenciales:** las mismas de la gateway y los mismos permisos (§6.2); la sesión de la UI sigue guardándose por
  credencial (§11.8). Sin `rateLimit`: es la API de una persona en un IDE, no de clientes.
- **Ya no en `http`:** `{basePath}/admin` y `{basePath}/ui`. `admin.enabled` y `transports.http.ui` se avisan y se
  ignoran; los demás `admin.*` (`allowAnonymous`, `maxFileBytes`, `commandTimeoutMs`) siguen y aplican a `management`.
  Las tools `admin_*` de MCP (§11.6) están si `management` está expuesto.
- **Sin CORS en ningún transporte:** ni `management` ni los de datos responden a un navegador de otro origen. Los
  clientes de servidor (`@lambdaorm/client`, `@lambdaorm/data-gateway-client`, agentes MCP) no lo usan; una app web que
  llamaba a la gateway desde el navegador pasa por su propio backend, como el IDE.
- **Red:** `management` escribe el esquema, sus variables (`.env`) y ejecuta DDL: se publica solo en la red del IDE (en
  un compose, sin `ports:`; en Kubernetes, un `Service` interno sin ingress).

### 12.1 Sesiones (plan)

> **Plan, no implementado:** [`DATA_GATEWAY_SESSIONS_PLAN.md`](DATA_GATEWAY_SESSIONS_PLAN.md).

`management` pasa a trabajar con **sesiones**: el IDE hace login (`POST /sessions`) con la credencial y recibe un
token; todo pedido lleva el token, no la clave (una clave directa se rechaza). La gateway guarda las sesiones en
`state.sqlite` y un WebSocket de eventos (`/events`) da la presencia y las notificaciones. Con eso:

- se sabe **quién está conectado** (credencial, IP real detrás del IDE web, cliente, qué está mirando);
- se **listan las sesiones**: las propias, y con el permiso nuevo `sessionAdmin`, todas;
- se **revoca** una sesión, o todas las de una credencial: su WebSocket se cierra al instante y su próximo pedido
  responde `401`;
- una sesión vence a los 30 minutos sin pedidos o a las 12 horas (configurable).

Los transportes de datos no cambian: siguen autenticando cada pedido con la clave.

**Migración desde 3.x:**

| 3.x | 4.0.0 |
| --- | --- |
| `admin: { enabled: true }` | `transports.management.port` |
| `transports.http.ui: { enabled: true }`, la UI en `{basePath}/ui` | el data-gateway-ide, con una connection al `management` |
| un navegador llamando a la gateway (CORS) | por un backend propio (el del IDE, o el de la app) |
