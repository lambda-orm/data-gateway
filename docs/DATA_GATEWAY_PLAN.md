# Plan: de `service` a `data-gateway`

Objetivo: renombrar `packages/service` a `packages/data-gateway` (paquete e imagen) y que exponga λORM **por
configuración**:

- por API REST HTTP, MCP (Streamable HTTP + SSE viejo, y WebSocket) y WebSocket JSON-RPC;
- para **varios esquemas** (descubiertos en un directorio o declarados uno a uno), cada uno en su ruta;
- con cada esquema en **su propio hilo o proceso**, supervisado e independiente, y los transportes en un edge aislado
  de los esquemas;
- con **credenciales con permisos** aplicados igual en todos los transportes, límite de operaciones simultáneas por
  esquema y auditoría de escrituras;
- con una **UI web de consultas** (Monaco con autocompletado del modelo) construida como librería React reutilizable
  `@lambdaorm/ui` y servida por el gateway en `/ui`;
- con un MCP cuya utilidad real (que los modelos usen bien el lenguaje de λORM) se mide con un conjunto de evaluación.

Implementación propia en TypeScript con arquitectura limpia / hexagonal y SOLID, sin depender de blazedpath. **Todo
el desarrollo está en este paquete; `@lambdaorm/lib` y `@lambdaorm/base` no se modifican.** Los otros paquetes
que se agregan o cambian: **`@lambdaorm/ui`** (nuevo, 3.1.0) y `@lambdaorm/client` (adaptador WebSocket, 3.2.0). Qué se construye y cómo se comporta:
[`DATA_GATEWAY.md`](DATA_GATEWAY.md). Este documento dice en qué orden, qué archivos y cuándo está terminado.

> **Estado (2026-11-17): fases 1 a 7 implementadas, sin publicar. Ticket: #96.** Base: `develop` con service 2.4.0
> (lib 3.5.0). Rama: `feature/data-gateway-core` (todas las fases, sobre `feature/data-gateway-rename`). Desvíos
> respecto de este plan: ver "Hecho" en cada fase.

## 0. Punto de partida

| Qué | Hoy |
| --- | --- |
| Entrada | `src/lib/index.ts` → `Server.start()` (`infrastructure/server.ts`): todo en un método — `orm.init(WORKSPACE)`, config de `infrastructure.service` + env, express, rutas, swagger, `listen` |
| Configuración | `infrastructure.service` dentro de `lambdaORM.yaml` + variables (`PORT` con default 80, `SERVICE_TOKEN`, `RATE_LIMIT_*`, `SCRIPT_*`, …); `withoutUnresolved` descarta `$VAR` sin definir |
| Esquemas | uno solo (`WORKSPACE`) |
| Ejecución | un proceso, un hilo: HTTP y λORM comparten el event loop |
| Transportes | solo HTTP (express) en un puerto |
| Capas | `application/services` (General, Query, Schema, Stage) dependen directamente de `IOrm` de `@lambdaorm/lib`; `application/ports` tiene `Logger`, `Metric`, `Queue`; `infrastructure/controllers` + `routes` |
| Auth | `serviceTokenMiddleware` (un bearer, tiempo constante, excepciones `/ping` `/health` `/metrics`); sin permisos |
| Cola | `QueueBuilder` / `kafkaQueue` desde `infrastructure.queue` |
| Shutdown | `Server.stop()` existe pero nada lo llama en `SIGTERM` |
| Build | Grunt (`lint` / `build` / `test` / `dist`), excluido de Changesets |
| Tests | `tests/*.test.ts` (5 archivos, unitarios) + laboratorio `packages/lib/src/dev/labs/ilusor-cloud/tests/service.spec.ts` contra la imagen en CI |
| Imagen | `flaviorita/lambdaorm-svc`, `.github/workflows/service-image.yml`, tag `service-v<v>` |

Verificado en `lib` / `base` (sin cambios necesarios):

- cada `new Orm()` tiene su propio estado, incluida su instancia de 3xpr (`orm/infrastructure/expressionsBuilder.ts`):
  un `Orm` por schema worker funciona con la API pública actual;
- `orm.metadata(query)` devuelve cada sentencia con `classtype: 'Sentence'` y `name` = acción
  (`base/src/lib/sentence/domain/sentence.ts`): alcanza para clasificar lectura / escritura (a confirmar con un test al
  inicio de la fase 2).

## 1. Decisiones

| # | Decisión | Por qué |
| --- | --- | --- |
| D1 | Implementación propia en TypeScript, sin dependencia ni código de blazedpath | `blz-ai-gateway` fue solo el ejemplo de la idea |
| D2 | **`@lambdaorm/lib` y `@lambdaorm/base` no se modifican** | `lib` se mantiene independiente; el gateway usa su API pública |
| D3 | Hexagonal con reglas de dependencia verificadas (ESLint `no-restricted-imports` + test de arquitectura) | que la separación no dependa de la disciplina de cada PR |
| D4 | Extensión por registro (transportes, autenticadores, tools, runtimes), no por `switch` | abierto/cerrado |
| D5 | **Sin puertos por defecto**; un puerto por transporte | decisión explícita del despliegue; transportes activables por variables |
| D6 | MCP por HTTP = **Streamable HTTP** (sin estado por defecto) + HTTP+SSE viejo en el mismo puerto (`mcpHttp`); `mcpWebSocket` documentado como no estándar | SSE quedó obsoleto en la especificación; sin estado escala sin afinidad de sesión |
| D7 | MCP expone **todos** los métodos, incluidas las escrituras, con anotaciones; `mcp.maxRows` 500 | paridad entre transportes; lo que limita son los permisos |
| D8 | **Sin modo legado**: YAML obligatorio desde 3.0.0 | imagen nueva, la 2.4.0 sigue disponible |
| D9 | **Varios esquemas**: descubrimiento + explícito, combinables; ajustes por esquema (esquema → transporte → global) | varias versiones o dominios en un gateway, o uno por instancia |
| D10 | **Supervisor + edge compartido + un worker por esquema**; `process` configurable (global y por esquema); transportes separables con `runtime.transports: thread / process` | aislar lo que tiene riesgo (los esquemas) sin multiplicar canales por transporte |
| D11 | Esquema caído no impide el arranque: `503` y reintento con espera creciente; **heartbeat** para workers colgados; el proceso nunca muere por un esquema | independencia entre esquemas |
| D12 | `UV_THREADPOOL_SIZE` dimensionado por esquemas; tabla de garantías por nivel (`thread` / `process` / instancia) documentada | el threadpool de libuv es compartido en `thread` |
| D13 | **Variables de entorno aisladas por esquema** (`schemas[].env`, `.env` del workspace, `passthrough`) | un esquema no puede leer credenciales de otro ni secretos del gateway |
| D14 | **Credenciales con permisos** (`read`, `write`, `script`, `queue`, `stageImport`), autorización en el schema worker; lectura / escritura clasificada con `orm.metadata` | un agente puede tener solo lectura sin depender de que el cliente respete anotaciones |
| D15 | Resultados serializados en el schema worker y pasados como `Buffer` transferido; respuestas REST en partes; `maxResponseBytes` | evitar copias y no cargar el edge con la serialización |
| D16 | Un servidor MCP por esquema (`/{esquema}/mcp`) | descripciones con un solo dominio |
| D17 | `@lambdaorm/client` y `@lambdaorm/cli` sin cambios en 3.0.0; adaptador WebSocket en `client` en 3.2.0 como primer consumidor del `webSocket` | compatibilidad; el WebSocket nace con consumidor |
| D18 | **Publicación por etapas**: `3.0.0-rc.1`, `3.0.0-rc.2`, `3.0.0`, `3.1.0` (UI), `3.2.0` (WebSocket), `3.3.0` (observabilidad); las `-rc` sin mover `latest` | uso real temprano, errores de diseño detectados antes |
| D19 | Tests en tres niveles; lógica de supervisión probada con fakes y reloj falso; tests intermitentes se arreglan, no se reintentan | workers y procesos son propensos a tests lentos y frágiles |
| D20 | Se mantiene Grunt en esta migración | migrar a `scripts/dist.mjs` es independiente |
| D21 | **`server.maxConcurrent` por esquema** (por defecto 64): el edge responde `429` por encima | una ráfaga a un esquema no llena su cola y su pool hasta el timeout |
| D22 | **Auditoría de escrituras** por `AuditPort` (línea JSON `type: audit` en 3.0.0), sin datos salvo `audit.includeData` | saber qué escribió cada credencial, en especial los agentes |
| D23 | **Conjunto de evaluación del MCP** como condición de `3.0.0-rc.2` y de la 3.0.0 | los modelos no conocen el lenguaje de λORM; la guía y las descripciones se ajustan midiendo |
| D24 | **UI como librería React separada (`@lambdaorm/ui`, `packages/ui`)**, publicada en npm por Changesets y consumida por una app mínima del gateway | reutilizable como componente en otros proyectos (Portal) |
| D25 | React **web** (Vite) + Monaco empaquetado sin CDN; la librería depende de un puerto `QueryApiPort` con adaptador REST por defecto e inyectable | Monaco necesita DOM; redes cerradas y CSP; un Portal puede usar su propio backend |
| D26 | Tipos del esquema generados por el gateway (`GET /{esquema}/typings`, `TypingsGenerator` propio, sin depender del CLI), comparados con el CLI en un test | autocompletado del modelo sin acoplar el gateway al CLI |
| D27 | UI desactivada por defecto (`transports.http.ui.enabled`) | exponer un editor que ejecuta consultas es una decisión explícita |
| D28 | MCP (fase 3) antes que varios esquemas y workers (fase 4) | medir pronto lo más incierto (uso del lenguaje por los modelos) antes de invertir en el runtime; los puertos permiten agregar el canal después sin tocar las tools |

## 2. Estructura final

```
packages/data-gateway/src/lib/
  domain/
    config/            dataGatewayConfig.ts, transportConfig.ts, authenticationConfig.ts, mcpConfig.ts,
                       runtimeConfig.ts, schemaConfig.ts, serverConfig.ts,
                       configValidator.ts, effectiveSettings.ts, schemaEnv.ts
    schema/            schemaDescriptor.ts, schemaStatus.ts, schemaPath.ts
    runtime/           restartPolicy.ts, heartbeatPolicy.ts, channelMessage.ts
    auth/              principal.ts, permission.ts, authenticationResult.ts, authorizationPolicy.ts
    audit/             auditEntry.ts
    errors/            gatewayError.ts (+ NotFound, Forbidden, Validation, Timeout, SchemaUnavailable, ResponseTooLarge, TooManyRequests)
    mcp/               toolDefinition.ts, toolResult.ts, resourceDefinition.ts
  application/
    ports/
      input/           dataGatewayPort.ts, mcpServerPort.ts, rpcDispatcherPort.ts
      output/          ormQueryPort.ts, ormScriptPort.ts, ormSchemaPort.ts, ormStagePort.ts, queuePort.ts,
                       authenticatorPort.ts, loggerPort.ts, metricsPort.ts, configSourcePort.ts,
                       schemaDiscoveryPort.ts, envFilePort.ts, schemaRuntimePort.ts, transportRuntimePort.ts,
                       schemaChannelPort.ts, auditPort.ts, clockPort.ts
    usecases/          generalUseCases.ts, queryUseCases.ts, scriptUseCase.ts, schemaUseCases.ts, stageUseCases.ts,
                       queryClassifier.ts (lectura / escritura vía metadata)
    facade/            dataGateway.ts
    serialization/     resultSerializer.ts (bytes, partes, maxResponseBytes, recorte maxRows)
    rpc/               rpcDispatcher.ts
    mcp/               tool.ts, toolCatalog.ts, domainDescription.ts, dataGatewayMcpServer.ts, tools/, resources/
    supervision/       supervisor.ts, schemaRouter.ts
  infrastructure/
    output/
      orm/             lambdaOrmAdapter.ts
      queue/           kafkaQueueAdapter.ts
      auth/            noneAuthenticator.ts, bearerAuthenticator.ts, apiKeyAuthenticator.ts, basicAuthenticator.ts
      logger/          winstonLogger.ts, consoleLogger.ts
      audit/           stdoutAuditAdapter.ts
      metrics/         promClientMetrics.ts, metricsAggregator.ts
      config/          yamlFileConfigSource.ts, envResolver.ts, dotEnvFileReader.ts
      discovery/       fileSystemSchemaDiscovery.ts
      runtime/         workerThreadSchemaRuntime.ts, childProcessSchemaRuntime.ts,
                       workerThreadTransportRuntime.ts, childProcessTransportRuntime.ts
      channel/         messageChannelSchemaChannel.ts, unixSocketSchemaChannel.ts, dataGatewayProxy.ts, mcpServerProxy.ts
    input/
      transport.ts     interfaz Transport { name, start(), stop() }
      http/            httpTransport.ts, routes/, controllers/, middleware/, swagger.yaml
      mcp/             mcpHttpTransport.ts, mcpWebSocketTransport.ts, http.openapi.yaml, asyncapi.yaml
      webSocket/       webSocketTransport.ts, asyncapi.yaml
      channel/         schemaChannelReceiver.ts
    build/             supervisorMain.ts, edgeWorkerMain.ts, schemaWorkerMain.ts,
                       transportRegistry.ts, authenticatorRegistry.ts, runtimeRegistry.ts
  index.ts             arranca supervisorMain
tests/
  unit/                dominio, aplicación con fakes, contratos con fakes
  integration/         workers reales (thread / process), transportes con clientes reales
  helpers/             waitForStatus, freePort, sqliteWorkspace, fakeClock
bench/                 benchmark de resultados grandes contra 2.4.0
eval/                  conjunto de evaluación del MCP (preguntas, respuestas esperadas, runner)
```

Reglas de import (ESLint por carpeta + `tests/unit/architecture.test.ts`):

| Carpeta | No puede importar |
| --- | --- |
| `domain/**` | `application`, `infrastructure`, `@lambdaorm/lib`, cualquier paquete externo (solo tipos de `@lambdaorm/base`) |
| `application/**` | `infrastructure`, `@lambdaorm/lib`, `express`, `ws`, `@modelcontextprotocol/*`, `kafkajs`, `winston`, `prom-client`, `fs`, `http`, `net`, `worker_threads`, `child_process` |
| `infrastructure/input/**` | `infrastructure/output/**` (los transportes solo conocen puertos de entrada) |

## 3. Estrategia de tests

| Nivel | Comando | Qué corre | Tiempo objetivo |
| --- | --- | --- | --- |
| Unitario y contrato | `npm test` (dentro de lint → build → test, como hoy) | dominio; aplicación con puertos falsos; `Supervisor`, `RestartPolicy`, heartbeat y `SchemaRouter` con runtimes falsos y `ClockPort` falso; contratos con fakes | < 1 min |
| Integración | `npm run test:integration` (job aparte en CI) | workers reales en `thread` y `process`; transportes con clientes reales (supertest, SDK de MCP, `ws`); bases SQLite (`sql.js`) en memoria | < 5 min |
| Extremo a extremo | workflow de la imagen | laboratorio `ilusor-cloud` + smoke tests que suma cada fase | como hoy |

- **Tests de contrato:** una misma suite contra cada adaptador de un puerto (`SchemaRuntimePort`: thread / process;
  `SchemaChannelPort`: `MessageChannel` / socket unix; `DataGatewayPort`: fachada real / proxy con canal).
- **Sin esperas fijas:** cada espera es por evento (`waitForStatus('iot/v1', 'ready', { timeout })`); en tests,
  heartbeat de 200 ms y reinicios desde 50 ms; puertos libres elegidos al momento.
- Cada test apaga su gateway en `afterEach`; CI corre con `--detectOpenHandles`.
- **Un test intermitente se arregla, no se reintenta** (sin `jest.retryTimes`): en este diseño suele ser una condición
  de carrera real.
- Benchmark aparte (`npm run bench`): al cerrar la fase 4 y antes de cada release.

## 4. Fases y publicación

| Fase | Contenido | Se publica |
| --- | --- | --- |
| 1 | Renombrar | nada (sigue 2.4.0) |
| 2 | Núcleo hexagonal, config, auth con permisos, `http`, imagen y workflow, infraestructura de tests | `3.0.0-rc.1` |
| 3 | MCP (`mcpHttp`, `mcpWebSocket`) con un esquema y en un hilo, conjunto de evaluación | `3.0.0-rc.2` |
| 4 | Varios esquemas, supervisor, edge y schema workers, env aislado, heartbeat, canal con bytes transferidos, benchmark | **`3.0.0`** + `latest`, documentación externa |
| 5 | UI: librería `@lambdaorm/ui` + app del gateway en `/ui`, `typings`, `whoami` | `3.1.0` (y `@lambdaorm/ui` 0.1.0 en npm) |
| 6 | WebSocket JSON-RPC con notificaciones + adaptador WebSocket en `@lambdaorm/client` | `3.2.0` (y menor de `client`) |
| 7 | Observabilidad completa | `3.3.0` |
| 8 | Opcional | — |

Cada fase es un PR contra `develop` (rama `feature/data-gateway-<fase>`) con los tres niveles de tests en verde; cada
publicación, una rama `release/data-gateway-<versión>` → `main` con su entrada en el CHANGELOG y su tag. Ninguna fase
toca `packages/lib` ni `packages/base`.

### Fase 1 — Renombrar (sin cambio funcional)

1. `git mv packages/service packages/data-gateway`.
2. `package.json`: `name: @lambdaorm/data-gateway`, `description`, `keywords`, `repository` / `homepage`; versión
   2.4.0 hasta la fase 2.
3. Referencias en el repo: `tsconfig.json` (raíz), `package.json` (raíz: `build:service` → `build:data-gateway`,
   quitar `release:service`), `.changeset/config.json` (`ignore: ["@lambdaorm/data-gateway"]`), `pnpm-lock.yaml`,
   `CLAUDE.md`, `DEPLOY.md`, `DEVELOPER.md`, `packages/client/README.md`, `packages/data-gateway/README.md`,
   `DEVOPS.md`, `config/northwind/README.md`, README y scripts del laboratorio `ilusor-cloud` (no es código de `lib`).
4. Workflow: `git mv .github/workflows/service-image.yml .github/workflows/data-gateway-image.yml`;
   `paths: packages/data-gateway/**`, `IMAGE: flaviorita/data-gateway`, `working-directory`, tag `data-gateway-v<v>`.
   No debe publicar `data-gateway:2.4.0`.
5. `doc/source/**` (typedoc generado): regenerar.

**Terminado:** `grep -rn "lambdaorm-svc\|@lambdaorm/service\|packages/service"` en `core` solo encuentra CHANGELOGs y
estos documentos; `pnpm build`, `pnpm test`, `pnpm lint` y `npx grunt dist` en verde.

### Fase 2 — Núcleo hexagonal, configuración, permisos y `http` → `3.0.0-rc.1`

En esta fase todo corre en un hilo: `http` conectado directo a la fachada, un esquema en la raíz.

> **Hecho (2026-11-17, `feature/data-gateway-core`).** Verificado: 54 tests unitarios, 16 de integración (sockets
> reales y `@lambdaorm/lib` real sobre el fixture northwind, sin base), y los 14 tests de servicio del laboratorio
> `ilusor-cloud` con Postgres contra el gateway por `tsx`, contra el `dist` y contra la imagen Docker construida
> localmente. Desvíos:
>
> - **Reglas de capas solo con el test de arquitectura** (`tests/unit/architecture.test.ts`), sin ESLint: ESLint 8.57
>   no admite `regex` en `no-restricted-imports` y los patrones tipo gitignore no aplican a imports relativos. El test
>   recorre todos los imports de `src/lib`.
> - **`executeQueued` pide `queue` y además `write` cuando la consulta escribe**, para que `[read, queue]` no pueda
>   escribir por la cola (`DATA_GATEWAY.md` §6.2 decía solo `queue`).
> - **Swagger público** (`/doc`, `/api-docs`; `/` redirige a `/doc/`): solo es documentación; en 2.x quedaba detrás del
>   token. La API sigue protegida.
> - **La imagen corre `node index.js`** en lugar de `npm run start`: con npm como PID 1 el SIGTERM no llegaba al gateway
>   y el contenedor terminaba con error en lugar de apagarse ordenadamente.
> - **`doc/source` (typedoc) no se regeneró**: typedoc no está entre las dependencias y no se pudo descargar; quedó
>   desactualizado (describe las clases del service 2.x). Pendiente: regenerarlo o eliminarlo.
> - **Pendiente para publicar `3.0.0-rc.1`**: rama `release/data-gateway-3.0.0-rc.1` con la versión y el CHANGELOG
>   (el workflow ya publica prereleases sin mover `latest`).

1. **Dominio:** configuración completa (incluidos `orm`, `runtime`, `schemas`, `server`) y `configValidator`;
   `GatewayError` y derivados; `Principal`, `Permission`, `AuthorizationPolicy`.
2. **Puertos de salida:** `OrmQueryPort`, `OrmScriptPort`, `OrmSchemaPort`, `OrmStagePort`, `QueuePort`, `LoggerPort`,
   `MetricsPort`, `AuthenticatorPort`, `ConfigSourcePort`.
3. **Casos de uso** (los services actuales, sobre puertos) con autorización antes de ejecutar; `QueryClassifier`
   (lectura / escritura con `metadata`). Primer test: confirmar con northwind que `metadata` da la acción de cada
   sentencia, incluidas las de un `include`.
4. **Fachada** `DataGateway`: un método por operación, recibe el `Principal`, aplica `server.timeout`.
   **Auditoría:** `AuditEntry` (dominio), `AuditPort` y `StdoutAuditAdapter`; los casos de uso de `execute` con
   escritura, `executeScript`, `executeQueued` y `stageImport` registran la entrada después de ejecutar (también si
   fallan); `audit.enabled` / `includeData`.
5. **Adaptadores de salida:** `LambdaOrmAdapter`, `KafkaQueueAdapter`, loggers, métricas, autenticadores
   `none` / `bearer` / `apikey` / `basic` con credencial única o lista con permisos, `timingSafeEqual`.
6. **Configuración:** `envResolver`, `YamlFileConfigSource` (sin archivo → `exit(1)`; warning por
   `infrastructure.service`); `local` sin secreto → error.
7. **`HttpTransport`:** middlewares, rate limit, auth → `Principal`, rutas libres `/ping` `/health` `/metrics`,
   `403` sin permiso, Swagger, `basePath`.
8. **Composition root provisorio** (un hilo) e `index.ts` con `SIGTERM` / `SIGINT`.
9. Borrar `server.ts` y `serviceTokenMiddleware.ts` (mover sus tests); `ServiceConfig` / `ServiceInfrastructureSchema`
   desaparecen.
10. Reglas ESLint, `architecture.test.ts`, carpetas `tests/unit` / `tests/integration` / `tests/helpers`, script
    `test:integration` y su job en CI.
11. **Imagen y workflow:** `Dockerfile` (`ENV DATA_GATEWAY_CONFIG_PATH=/config/data-gateway.config.yaml`,
    `VOLUME ["/workspace", "/config"]`, sin `EXPOSE`); workflow con la regla de prerelease (versión `-rc.N` → se
    publica sin mover `latest`); laboratorio `ilusor-cloud` con su `data-gateway.config.yaml` (equivalente 2.x de
    `DATA_GATEWAY.md` §2.7) montado en `/config`; smoke test con una credencial `read` que no puede escribir.

**Tests:** `envResolver`, `configValidator` (puertos), `yamlFileConfigSource`, autenticadores (tipos, credencial
única / lista, header ausente / incorrecto, `local` sin secreto), `AuthorizationPolicy` y `QueryClassifier` (`select`
pasa con `read`; `insert`, `delete`, `include` con escritura se rechazan; `script` / `queue` / `stageImport`
requieren su permiso), auditoría (qué operaciones generan entrada, sin secreto ni `data` salvo `includeData`, entrada con `result: error` si falla), casos de uso con puertos falsos, `httpTransport` (supertest), `architecture`.

**Terminado:** el laboratorio `ilusor-cloud` pasa sin cambios en los tests contra la imagen; `3.0.0-rc.1` publicada.

### Fase 3 — MCP (un esquema, un hilo) → `3.0.0-rc.2`

Va antes que los workers para medir temprano lo más incierto: si los modelos usan bien el lenguaje de λORM. Corre como
la fase 2 (un hilo, un esquema), pero las rutas MCP ya llevan el prefijo de esquema (`/{esquema}/mcp`, o `/mcp` con
esquema en la raíz) para que la fase 4 no cambie URLs. Las tools y el catálogo se escriben sobre `DataGatewayPort` /
`McpServerPort`; en la fase 4 solo se agrega el proxy del canal.

Dependencias: `@modelcontextprotocol/sdk`, `ws`, `@types/ws`.

1. Interfaz `Tool` (`definition`, `permission`, `execute`); una clase por tool (`DATA_GATEWAY.md` §5.1) con su
   `inputSchema`, permiso y anotaciones.
2. `ToolCatalog` (registro; filtro por permisos del `Principal` y por `include` / `exclude` efectivos),
   `DomainDescription` (con tamaño máximo), resources, `ResultSerializer` con el recorte `maxRows` y
   `structuredContent` solo bajo 1 MB.
3. `DataGatewayMcpServer implements McpServerPort`, conectado directo a la fachada.
4. `McpHttpTransport`: Streamable HTTP sin estado en `/{esquema}/mcp` (opción `stateful`), SSE viejo en
   `/{esquema}/sse` + `/{esquema}/messages` con `legacySse`, `maxConnections`, `/status`.
5. `McpWebSocketTransport` en `/{esquema}/mcp`.
6. `http.openapi.yaml` y `asyncapi.yaml`.
7. **Conjunto de evaluación** (`eval/`): unas 30 preguntas en lenguaje natural sobre northwind (filtros, agregaciones,
   `include`, fechas, enums, escrituras simples) con su resultado esperado, y un runner que conecta un agente (Claude
   por la API, con el MCP del gateway) y compara resultados. Se itera sobre la guía `lambdaorm://guide/expressions`,
   los ejemplos en la descripción de `orm_execute` y los mensajes de error de λORM que devuelve el gateway, hasta
   alcanzar el objetivo. El runner es manual / previo al release, no corre en cada PR (usa la API de un LLM).

**Tests:** catálogo (filtro por permisos, include / exclude, anotaciones), servidor MCP con fakes (paginación,
`isError`, permisos, recorte `maxRows`, `maxRows: 0`). Integración con el **cliente del SDK** con
`StreamableHTTPClientTransport` y con `SSEClientTransport`, y un cliente `ws` crudo: `initialize` → `tools/list`
(dominio del esquema; credencial `read` no ve `orm_execute_script`) → `tools/call orm_execute`; escritura con
credencial `read` → `isError`; 401 sin credenciales.

**Smoke test en el workflow:** MCP Streamable HTTP y WebSocket contra la imagen; dos instancias detrás de un
balanceador sin afinidad de sesión (docker-compose) atendiendo Streamable HTTP.

**Terminado:** el conjunto de evaluación resuelve al menos el **80%** de las preguntas en el primer intento y el
**95%** con hasta dos reintentos del agente tras un error; Claude Code conectado con `claude mcp add --transport http`
a `/mcp` del laboratorio lista las tools según la credencial y responde consultas, incluida una escritura y un
`orm_execute_script` con una credencial que lo permite; `3.0.0-rc.2` publicada.

**Hecho (2026-11-17).** `@modelcontextprotocol/sdk` 1.32.2, `ws` 8.18.3. Tests: 72 unitarios (catálogo por
credencial, anotaciones, include / exclude, paginación, `maxRows`, `isError` vs error JSON-RPC, recursos, descripción
del dominio) y 27 de integración (clientes del SDK con Streamable HTTP sin y con estado y con SSE, cliente `ws` crudo,
401 / 405 / 503 / 426, `/status`, `/asyncapi`, y MCP en el arranque con λORM real). Desvíos:

- Las 22 tools son **especificaciones declarativas** (`ToolSpec`) de una sola clase `GatewayTool`, no una clase por
  tool: cada una es nombre, esquema, permisos, anotaciones y una función sobre `DataGatewayPort`.
- Sin `http.openapi.yaml` para `mcpHttp`: Streamable HTTP lo define la especificación MCP; sí `asyncapi.yaml` para
  `mcpWebSocket`, servido en `/asyncapi` y `/asyncapi.json`.
- Ya en la fase 3: `/status` y `/health` abiertos en los dos transportes MCP; en `stateful` y en SSE una sesión solo
  acepta mensajes de la credencial que la abrió (404 si no).
- El **conjunto de evaluación** (`packages/data-gateway/eval/`, 30 preguntas sobre northwind con datos en MySQL) tiene
  runner y modo `--check` (sin modelo: referencias, comparador, escrituras y limpieza; 30/30). **La medición con Claude
  (80% / 95%) está pendiente:** no hay credenciales de la API en el equipo donde se implementó.
- Al escribir la guía y el set aparecieron tres errores de `@lambdaorm/lib` (no se corrigen acá, la lib no se toca):
  `like` con patrón literal no lo pone entre comillas; `includes` sobre texto genera `IN`; una expresión junto a un
  agregado agrupa por el campo y no por la expresión. La guía los evita; están en `eval/README.md`.
- Pendiente: smoke test de MCP contra la imagen en el workflow, prueba con Claude Code (`claude mcp add`) y publicar
  `3.0.0-rc.2`.

### Fase 4 — Varios esquemas y runtime aislado → `3.0.0`

1. **Dominio:** `SchemaDescriptor`, `SchemaStatus`, `SchemaPath` (segmentos, reservados), reglas de combinación
   (duplicados, raíz única, ajuste sin esquema), `effectiveSettings`, `schemaEnv` (resolución del `env` de un esquema),
   `RestartPolicy`, `HeartbeatPolicy`, `ChannelMessage` (incluido `principal` y `deadline`).
2. **Descubrimiento y env:** `FileSystemSchemaDiscovery` (corta en cada `lambdaORM.yaml`), `DotEnvFileReader`.
3. **Runtimes:** `WorkerThread*Runtime` (`resourceLimits`, `env` propio) y `ChildProcess*Runtime`
   (`--max-old-space-size`, `env` propio); modo por esquema; edge compartido por defecto y separable;
   `UV_THREADPOOL_SIZE` desde `runtime.threadpoolSize`.
4. **Canal:** `MessageChannelSchemaChannel` y `UnixSocketSchemaChannel`; `ResultSerializer` en el schema worker
   (`JSON.stringify` → `Buffer` transferido; partes de 1 MB por encima de `streamThresholdBytes`; `413` por encima de
   `maxResponseBytes`); `DataGatewayProxy` y `McpServerProxy` (las tools y el catálogo de la fase 3 pasan al schema
   worker sin cambios); `SchemaChannelReceiver`; respuesta tardía (pasado el `deadline`)
   descartada.
5. **`Supervisor`:** arranca schema workers y el edge, un canal por esquema, difunde estados, heartbeat, reinicios
   con `RestartPolicy` (no arranca, se cae, supera memoria, colgado), nunca termina el proceso por un esquema.
6. **`SchemaRouter`** en el edge: ruta → (canal, estado, ajustes efectivos); `404` / `503`; contador de operaciones
   en curso por esquema y `429` con `Retry-After` por encima de `server.maxConcurrent` efectivo.
7. **`http` multi-esquema:** endpoints bajo `/{esquema}` (incluidas las rutas generales), raíz con `/health`
   agregado, `/schemas`, `/version`, `/doc`; respuestas en partes; auth efectiva por esquema.
8. **Composition roots definitivos** (`supervisorMain`, `edgeWorkerMain`, `schemaWorkerMain`) y apagado ordenado.
9. Ejemplo `config/multi-schema/` (northwind `v1` y `v2` sobre SQLite, más un explícito con `env` propio).
10. **Benchmark** contra 2.4.0 (1.000 / 100.000 / 500.000 filas, SQLite): hasta 10.000 filas, latencia p95 agregada
    menor al 10%; con 500.000 filas, pico de memoria menor a 1,5× el de 2.4.0. Si no se cumple, se ajusta antes de
    publicar.

**Tests unitarios:** dominio (rutas, reservados, duplicados, raíz única, prioridad de ajustes, `schemaEnv`,
`RestartPolicy`, `HeartbeatPolicy`), `Supervisor` con fakes y reloj falso, `ResultSerializer` (partes, límite),
contratos de runtimes y canales.

**Tests de integración** (en `thread` y en `process`):

- dos esquemas; se mata el worker de uno: el otro sigue respondiendo y el caído vuelve a `ready`;
- un esquema con base inaccesible arranca en `error`, el resto `ready`; `/schemas` y `/health` lo reflejan;
- script con loop pesado en un esquema: el otro responde en tiempo normal;
- worker con loop síncrono infinito: el heartbeat lo detecta y lo reinicia;
- worker que supera `maxMemoryMb`: se reinicia solo ese;
- se mata el edge: se reinicia y vuelve a responder, los schema workers no se reinician;
- el worker de `iot/v1` no ve `IOT_V2_DB` ni `DATA_GATEWAY_TOKEN`; dos esquemas con el mismo `$DB_CONNECTION` se
  conectan a bases distintas;
- respuesta mayor a `streamThresholdBytes` llega completa en partes; mayor a `maxResponseBytes` → `413`;
- ráfaga sobre un esquema con `maxConcurrent: 4`: las operaciones de más reciben `429` y otro esquema responde normal;
- MCP con dos esquemas: `tools/list` de cada uno trae su propio dominio; esquema caído → error JSON-RPC sin afectar al
  otro.

**Smoke test en el workflow:** imagen con `config/multi-schema`; REST y MCP por esquema; matar un schema worker y
verificar que el otro responde.

**Release 3.0.0:** `package.json` → `3.0.0`, `CHANGELOG.md` (rename, transportes, MCP, varios esquemas, hilos /
procesos, env aislado, permisos, auditoría, config obligatoria, migración desde 2.x con la tabla de
`DATA_GATEWAY.md` §2.7), `DEPLOY.md`, `latest` en Docker Hub, descripción de `flaviorita/lambdaorm-svc` apuntando a la
nueva. Documentación externa (PRs aparte): wiki (`docs/api/index.md`, `docs/api/Use/Configuration.md`,
`docs/Features.md`, `docs/cli/index.md`, página nueva de MCP y de varios esquemas) y `lambdaorm-labs` (`README.md`,
`labs/svc/**`, `labs/client-node/**`, `labs/cli/09-client`). `DATA_GATEWAY.md`: estado con la versión publicada.

**Terminado:** laboratorio igual que en la fase 2; `config/multi-schema` sirve `/northwind/v1` y `/northwind/v2` con
`@lambdaorm/client` apuntando a cada URL y con Claude Code conectado a `/northwind/v1/mcp` y `/northwind/v2/mcp`;
benchmark dentro del criterio; conjunto de evaluación sigue en el objetivo; imagen `3.0.0` verificada descargándola de
Docker Hub.

**Hecho (2026-11-17).** Supervisor en el hilo principal, edge (todos los transportes) en un worker thread, un worker
por esquema en `thread` o `process`, canal directo edge ↔ esquema (`MessagePort` con el resultado transferido como
bytes; socket unix con frames en `process`), estados difundidos al edge, heartbeat, reinicios con espera creciente,
`maxConcurrent` (`429` con `Retry-After`; `isError` en MCP), `maxResponseBytes` (`413`), env por esquema (`schemas[].env`,
`.env` del workspace, variables base y `passthrough`), `UV_THREADPOOL_SIZE`, descubrimiento (sigue enlaces simbólicos),
ajustes por esquema y `config/multi-schema`. Tests: 86 unitarios (rutas, combinación de esquemas, prioridad de ajustes,
`schemaEnv`, políticas, despachador, `SchemaRouter`, `Supervisor` con fakes) y 33 de integración, 6 de ellos con
workers reales: esquema con base caída en `error` con su motivo (cada worker con su valor de `$DB_CONNECTION`), REST y
MCP por esquema, script pesado en uno sin frenar al otro, worker colgado (`SIGSTOP`) terminado por el heartbeat y
reiniciado, proceso matado y reiniciado solo. Verificado además con el build compilado: laboratorio `ilusor-cloud`
14/14 y `eval --check` 30/30 a través de los workers, `config/multi-schema` con MySQL, smoke MCP y `SIGTERM` en 53 ms.
Desvíos:

- **`runtime.checkConnections`** (nuevo, `true` por defecto, ajustable por esquema): λORM no conecta en `init`, así
  que para que una base caída deje al esquema en `error` el worker abre una conexión de cada fuente al arrancar.
- **`runtime.transports`: solo `shared`.** `thread` / `process` avisan y usan el edge compartido.
- **Sin respuestas en partes** (`streamThresholdBytes`): el resultado viaja entero como bytes transferidos; sí está el
  límite `maxResponseBytes`.
- Los scripts de 3xpr ceden el event loop: un `while` largo no cuelga el worker. El test del heartbeat congela el
  proceso con `SIGSTOP`; no hay test de `maxMemoryMb` (se aplica con `resourceLimits` / `--max-old-space-size`) ni de
  reinicio del edge con workers reales (cubierto con fakes).
- Errores por el canal: viajan `status` (solo si el error lo tiene), `code` de la base y lo que lanzó un script, para
  que REST responda igual que sin workers (409 por clave duplicada, el `status` de un `throw`).
- El runtime en línea (`DataGatewayBuilder`, todos los esquemas en el mismo hilo) queda para tests y para embeber.
- El adaptador `sql.js` de λORM no funciona (crea la conexión con `null`): los tests no usan SQLite.
- Pendiente: benchmark contra 2.4.0, smoke multi-esquema en el workflow de la imagen (está el de MCP), release 3.0.0
  (versión, CHANGELOG, `latest`) y la documentación externa.

### Fase 5 — UI de consultas (`@lambdaorm/ui`) → `3.1.0`

**Gateway:**

1. `TypingsGenerator` (aplicación, función pura: dominio del esquema → `.d.ts` con interfaces `QryX`, relaciones y
   `declare const <Entidad>: Qry<Entidad>`) y `GET /{esquema}/typings` (permiso `read`).
2. `GET /whoami` y `GET /{esquema}/whoami` (nombre y permisos del `Principal`).
3. `transports.http.ui.enabled`: servir los estáticos de la app en `/ui` con caché e integridad, y las cabeceras de
   seguridad (`DATA_GATEWAY.md` §10.4).
4. `packages/data-gateway/ui-app`: app Vite mínima (credencial en memoria, selector de esquema, `QueryWorkbench`); su
   build se copia a la imagen en el `dist`.

**Librería `packages/ui` (`@lambdaorm/ui`):**

```
packages/ui/src/
  domain/          tipos de la librería (operaciones, resultado, historial), conversión JSON ↔ YAML, armado de tipos para Monaco
  application/     ports/queryApiPort.ts; estado de la consulta y acciones; historial (sobre un puerto de storage)
  infrastructure/  restQueryApi.ts (fetch), localStorageHistory.ts, monaco/ (carga local, addExtraLib, marcas de error)
  components/      QueryWorkbench, QueryEditor, ScriptEditor, DataEditor, OptionsPanel, ResultViewer, SchemaSelector
  index.ts
```

5. Build con Vite en modo librería (ESM + tipos + `styles.css`); `react` / `react-dom` como `peerDependencies`;
   declaraciones fijas de `Queryable` y funciones tomadas del build de `@lambdaorm/base` en el momento del build;
   Monaco y sus workers empaquetados (sin CDN).
6. Las ocho acciones (plan, metadata, model, parameters, constraints, execute, executeQueued, executeScript), modo
   consulta / script, `DataEditor` completado por `parameters`, opciones, botones deshabilitados según `whoami` y
   `scripts.enabled`.
7. `ResultViewer`: árbol JSON, crudo, YAML, tabla para arrays, copiar, descargar `.json` / `.yaml`, estado / duración /
   filas / tamaño, límite de filas en las vistas con descarga completa.
8. Validación con λORM mientras se escribe (`constraints` / `metadata`, con espera) como marcas de Monaco.
9. Historial por esquema en `localStorage` (sin credenciales ni resultados).
10. Integración al monorepo: `pnpm-workspace`, `tsconfig.json` (raíz), lint, `scripts/dist.mjs`, changeset inicial
    (`@lambdaorm/ui` 0.1.0), `CLAUDE.md` (tabla de paquetes), README con ejemplos de uso en otro proyecto.

**Tests:**

- gateway: `TypingsGenerator` contra el `__queryable.d.ts` de northwind y contra la salida del generador del CLI
  (mismas interfaces, propiedades y relaciones); los tipos generados compilan con `tsc` junto a las declaraciones de
  `Queryable`; `typings` y `whoami` con y sin permiso; `/ui` deshabilitada por defecto, cabeceras de seguridad.
- librería: unitarios de dominio y aplicación (Vitest) con un `QueryApiPort` falso; componentes con Testing Library
  (acciones habilitadas según permisos, `parameters` completa `data`, `ResultViewer` en sus vistas y descargas);
  un test de humo en navegador (Playwright) contra un gateway real con northwind: escribir `Orders.` muestra
  `filter`, `include`, …, ejecutar, ver la tabla y descargar YAML.

**Terminado:** la UI servida en `/ui` permite escribir con autocompletado, ejecutar las ocho acciones y ver / convertir
/ descargar el resultado sobre `/northwind/v1`; un proyecto React de ejemplo (fuera del gateway) instala
`@lambdaorm/ui` desde npm y monta `QueryWorkbench` contra el gateway; `3.1.0` y `@lambdaorm/ui` 0.1.0 publicadas.

**Hecho (2026-11-17).** Gateway: `TypingsGenerator`, `GET /{esquema}/typings` y `/{esquema}/whoami` (también por el
canal de los workers), `transports.http.ui.enabled` con CSP / `X-Frame-Options` / `Referrer-Policy` y caché larga de los
assets, `ui-app` (Vite) dentro del build. Librería `packages/ui` (`@lambdaorm/ui`, changeset inicial a 0.1.0):
dominio, `WorkbenchController`, `RestQueryApi`, `LocalStorageHistory`, Monaco diferido con las declaraciones de
`Queryable` de `base` generadas en el build, `QueryWorkbench` y sus piezas; ESM + CJS + tipos + `styles.css`;
`dist` que carga por su nombre. Tests: gateway (los typings de northwind compilan con `Queryable` y detectan una
propiedad inexistente; `whoami`; `/ui` apagada por defecto y sus cabeceras) y librería (16 con Vitest y Testing Library).
Verificado en Chrome headless contra el gateway compilado con northwind en MySQL: autocompletado de entidades,
cláusulas y propiedades de relaciones, `parameters` completa `data`, `execute` con tabla y YAML, marca de λORM en el
editor, sin errores de CSP. Desvíos:

- La prueba en navegador fue manual (`playwright-core` con el Chrome del equipo), no un test de Playwright del repo.
- `OptionsPanel` es un editor JSON de las opciones (más `topic` / `chunk`), no un formulario.
- Los errores de λORM no traen posición: la marca cubre la consulta entera.
- Los typings no se comparan con la salida del generador del CLI (se verifica que compilan y tipan las consultas).
- Monaco y sus workers los pone la aplicación (en `ui-app`, con `?worker` de Vite); la librería no los empaqueta.
- Encontrado y corregido de paso: la config de ESLint ignoraba toda carpeta `build` (no se linteaba
  `src/lib/infrastructure/build`); `scripts/dist.mjs` traduce `main` / `module` / `types` en lugar de fijarlos.
- Pendiente: proyecto React de ejemplo fuera del gateway, publicar `@lambdaorm/ui` 0.1.0 y la imagen 3.1.0.

### Fase 6 — WebSocket JSON-RPC + adaptador en `@lambdaorm/client` → `3.2.0`

1. `RpcDispatcher` (tabla registrable `{sección}.{método}` → `DataGatewayPort`; `-32601`; `GatewayError` → `-32000`
   con `data: { name, status }`).
2. `WebSocketTransport`: conexión por ruta de esquema (raíz: `general.*`, `gateway.schemas`), auth en el upgrade,
   `-32700`, timeout por mensaje, `maxPayload`, `maxConnections`; esquema no `ready` → `503` sin cerrar la conexión.
3. Notificaciones: `queue.completed` / `queue.failed` (con `notify: true` en `executeQueued`, emitidas por el schema
   worker por el canal hacia la conexión que encoló) y `schema.statusChanged` (desde el edge).
4. `asyncapi.yaml`.
5. **`@lambdaorm/client`:** adaptador WebSocket (`orm.init('ws://…/iot/v1')`, `orm.on(...)`), con su changeset y
   tests contra el gateway real.

**Terminado:** la misma consulta del laboratorio por REST, por WebSocket y con el cliente en modo WebSocket da el
mismo resultado; una ejecución encolada notifica su fin; `3.2.0` publicada.

**Hecho (2026-11-17).** `RpcDispatcher` (tabla registrable, `-32601` / `-32602`, el resto `-32000` con `name`,
`status` y `code` como REST), `WebSocketTransport` (conexión por ruta de esquema; la raíz con `general.*` y
`gateway.schemas`; `-32700`, `-32600` para lotes; `maxPayload`, `maxConnections`; esquema no `ready` → `503` sin cerrar),
notificaciones `queue.completed` / `queue.failed` (la cola informa el fin; el schema worker lo manda por el canal como
evento; el edge lo reenvía solo a la conexión que pidió `notify`) y `schema.statusChanged`, `asyncapi.yaml`, y el modo
WebSocket de `@lambdaorm/client` (`orm.init('ws://…')`, `orm.on(...)`, changeset). Tests: 6 de integración del
transporte (métodos, errores, notificaciones solo a quien las pidió, fin antes de la respuesta, handshake, 503 y
`schema.statusChanged` con el router del edge) y el cliente por REST y por WebSocket con λORM real dando lo mismo. En
el laboratorio con Postgres, la misma consulta por REST y por WebSocket con el cliente da el mismo resultado. Desvíos:

- El timeout por mensaje es el de la operación (`server.timeout` en la fachada y en el edge), no uno propio del
  transporte.
- Sin lotes JSON-RPC (un array responde `-32600`).
- Las notificaciones de cola no se probaron con Kafka real (sin Kafka en el equipo); sí con la cola falsa y el canal.
- Corregido de paso en el cliente: `general.version()` llamaba a `/ping`.
- Pendiente: publicar `@lambdaorm/client` y la imagen 3.2.0.

### Fase 7 — Observabilidad completa → `3.3.0`

- Métricas por worker y agregación en `GET /metrics` vía supervisor; `/{esquema}/metrics`; lag del event loop por
  worker; `credential` y `forbidden_total`.
- Logs etiquetados por worker; configuración efectiva con secretos enmascarados.
- Prueba de carga: un esquema saturado no degrada la latencia de otro más allá de un umbral acordado.

**Hecho (2026-11-17).** `MeasuredSchemaDirectory` mide toda operación de todo transporte en un solo lugar
(`data_gateway_requests_total{transport,schema,method,status,credential}`, `data_gateway_request_duration_seconds`,
`data_gateway_forbidden_total{credential,permission}`, `data_gateway_throttled_total`), más
`data_gateway_connections{transport}`, `data_gateway_schema_status` y `data_gateway_schema_restarts`; cada worker con su
registro (`worker="edge"`, `"schema:iot/v1"`: lag del event loop, memoria, GC) y el edge los junta en `/metrics` pidiéndolos
por el canal; `/{esquema}/metrics` filtra. Logs etiquetados (`[supervisor]`, `[edge]`, `[schema:…]`) y la configuración
efectiva al arrancar con secretos y `env` enmascarados. Tests: unitarios de medición y enmascarado; con workers reales,
`/metrics` con los tres workers, `/{esquema}/metrics`, y la carga: con 30 scripts sobre un esquema, el p95 de otro queda
por debajo de 250 ms. Desvíos:

- Las métricas se piden a los schema workers por el canal del edge, no por el supervisor (que sigue sin red ni datos).
- Reinicios: `data_gateway_schema_restarts{schema}` (gauge de lo que el edge sabe) en lugar de
  `data_gateway_worker_restarts_total{kind,name,reason}`; los del edge no se cuentan.

### Fase 8 (opcional)

- `authentication.adapter: jwt` (JWKS: Keycloak, Entra ID) con roles / scopes mapeados a permisos.
- Permisos por entidad (`write:Orders`) con el árbol de metadata.
- Ajustes por esquema × transporte (`schemas[].transportOverrides.<t>`).
- Recarga de esquemas sin reiniciar.
- OpenTelemetry (`TracerPort` + adaptador).
- `page` automático en las consultas MCP (λORM no tiene `take`).
- Prompts MCP y `completion/complete`.
- `@lambdaorm/client` / `cli`: `orm.init(url, { schema })`, `orm.schemas()`, `--schema`.
- Migrar el build de Grunt a `scripts/dist.mjs`.

## 5. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Despliegues con `lambdaorm-svc` configurados por variables | imagen con otro nombre; `lambdaorm-svc:2.4.0` sigue disponible; guía de migración (`DATA_GATEWAY.md` §2.7) |
| La clasificación lectura / escritura por `metadata` no cubre algún caso | se confirma con tests al inicio de la fase 2; ante duda se trata como escritura (requiere `write`) |
| Un LLM ejecuta escrituras no deseadas o consultas pesadas | credenciales `read`; `schemas[].transports`; `mcp.tools.exclude`; anotaciones; `scripts` off por defecto; `server.timeout`; `mcp.maxRows`; `maxResponseBytes`; permisos del usuario de BD |
| Costo de pasar resultados entre hilos | serialización en el schema worker, `Buffer` transferido, partes; benchmark como condición de la fase 4 |
| Threadpool de libuv compartido en `thread` | `threadpoolSize` dimensionado; `process` para esquemas críticos |
| Crash nativo u OOM del contenedor en `thread` | `process` por esquema o instancia aparte; tabla de garantías documentada |
| Memoria con muchos esquemas | `maxMemoryMb` por worker; repartir esquemas entre instancias |
| Los modelos no usan bien el lenguaje de λORM (lo conocen mucho menos que SQL) | conjunto de evaluación como condición de la 3.0.0; guía, ejemplos en descripciones y mensajes de error ajustados midiendo |
| Ráfaga de operaciones sobre un esquema | `server.maxConcurrent` por esquema con `429` |
| Tipos de la UI que divergen del generador del CLI | test que compara ambas salidas para northwind |
| Tamaño del bundle (Monaco pesa varios MB) | carga diferida del editor y de sus workers; caché larga con nombres con hash |
| Versión de las declaraciones de `Queryable` en la UI distinta de la del gateway | la librería declara la versión de `@lambdaorm/base` con la que se construyó; `GET /version` informa la del gateway y la UI avisa si no coinciden en la versión menor |
| Escrituras sin trazabilidad | auditoría por credencial y esquema (`DATA_GATEWAY.md` §8.1) |
| Tests de workers lentos o intermitentes | estrategia de §3: fakes y reloj falso, esperas por evento, sin reintentos |
| SSE viejo requiere afinidad de sesión con réplicas | Streamable HTTP sin estado es el principal; `legacySse: false` donde no haga falta |
| Descripciones de tools muy largas en esquemas grandes | tamaño máximo; por encima se remite al resource `lambdaorm://schema/domain` |

## 6. Pendientes de decidir

Ninguno. Resueltos el 2026-11-17: `mcp.maxRows`, modo legado, varios esquemas, runtime y aislamiento, MCP por esquema,
clientes; y en la revisión crítica: edge compartido, heartbeat y threadpool, env por esquema, Streamable HTTP,
permisos, publicación por etapas, WebSocket con consumidor, serialización entre hilos, estrategia de tests;
y después: `maxConcurrent` por esquema, auditoría de escrituras, conjunto de evaluación del MCP, UI como librería
`@lambdaorm/ui` (React web, `executeQueued` y `executeScript` incluidos).
