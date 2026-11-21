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

- **para varios esquemas a la vez** (varios `lambdaORM.yaml`: distintos dominios o distintas versiones de uno), cada
  uno en su ruta: `/iot/v1`, `/iot/v2`, `/accounts/v1` (§2.2, §4);
- con **cada esquema en su propio hilo (o proceso)**, supervisado: que uno falle, se cuelgue o no responda no afecta a
  los demás (§3);
- con **credenciales con permisos** (`read`, `write`, `script`, `queue`, `stageImport`) aplicados igual en todos los
  transportes (§6), y **auditoría** de cada escritura (§8.1);
- con una **UI web para escribir y probar consultas** (Monaco con autocompletado del modelo del esquema), construida
  como librería React reutilizable `@lambdaorm/ui` y servida por el gateway en `/ui` (§10).

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
`3.1.0` (+ UI), `3.2.0` (+ `webSocket`), `3.3.0` (observabilidad completa). Las versiones `-rc.N` se publican en Docker Hub **sin**
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

- Hay que declarar al menos uno de `orm.workspacePath` u `orm.schemas` con `workspace`, y tiene que resultar al menos
  un esquema.
- Descubiertos + explícitos se sirven todos. Dos esquemas con la misma ruta son error de configuración.
- Cada segmento de la ruta: `[a-zA-Z0-9_.-]`, y ninguno puede ser un nombre reservado: `health`, `ping`, `metrics`,
  `version`, `schemas`, `mcp`, `sse`, `messages`, `status`, `doc`, `api-docs`, `swagger`, `asyncapi`, `ui`, `whoami`,
  `typings`.
- La ruta de un esquema no puede ser prefijo de la de otro (`iot` e `iot/v1` a la vez es error de configuración).
- **Esquema en la raíz:** si `workspacePath` tiene `lambdaORM.yaml` en su raíz (o un explícito usa `path: ""`), ese
  esquema se sirve en la raíz (`/execute`), como hoy. Solo se permite si es el **único** esquema.
- Sin recarga en caliente: un esquema nuevo en el directorio se toma al reiniciar.
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
    ui: { enabled: true }          # 3.1.0; por defecto false
  mcpHttp:
    port: $DATA_GATEWAY_MCP_HTTP_PORT
    legacySse: true
  mcpWebSocket:
    port: $DATA_GATEWAY_MCP_WS_PORT
  webSocket:                       # 3.2.0
    port: $DATA_GATEWAY_WS_PORT
```

### 2.6 Referencia

| Clave | Por defecto | Notas |
| --- | --- | --- |
| `orm.workspacePath` | — | raíz donde se descubren esquemas (§2.2) |
| `orm.schemas[]` | `[]` | `path` (obligatorio), `workspace` (define un esquema) y ajustes (§2.2) |
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
| `transports.http.ui.enabled` | `false` | sirve la UI en `/ui` (§10) |
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
| `http` | `POST /iot/v1/execute`, `GET /iot/v1/entities`, … (todos los endpoints actuales bajo el prefijo) | `GET /health`, `/ping`, `/metrics`, `/version`, `/schemas`, `/whoami`, `/doc`, `/ui` |
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
| `schema.statusChanged` | el esquema de la conexión pasó a `error` / `restarting` o volvió a `ready` |

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
| **app del gateway** | app mínima (Vite) que usa la librería: ingreso de la credencial, selector de esquema y el componente; se compila a estáticos que van en la imagen | `packages/data-gateway/ui-app` |

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

### 10.4 Servida por el gateway

```yaml
transports:
  http:
    port: $DATA_GATEWAY_HTTP_PORT
    ui: { enabled: true }      # por defecto false
```

- La sirve el transporte `http` en `/ui` (estáticos con caché larga y nombres con hash). Usa la API REST del mismo
  origen: sin CORS.
- La credencial la ingresa la persona y queda solo en memoria de la pestaña; la app no trae ninguna. Ejecuta con los
  permisos de esa credencial, con auditoría, `maxConcurrent` y las demás reglas de REST.
- Cabeceras de seguridad en `/ui`: `Content-Security-Policy` sin orígenes externos (Monaco y sus workers van
  empaquetados, sin CDN), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- Desactivada por defecto: exponer una herramienta para escribir y ejecutar consultas es una decisión explícita del
  despliegue.

