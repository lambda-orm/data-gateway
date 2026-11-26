# Pendientes de la Data Gateway

Lo que queda por hacer en este repositorio, para seguir de punta a punta. Estado al **2026-11-25**, después de terminar
en core la serie de features (C0–C12), sus pendientes (P1–P8) y la revisión completa de la wiki.

Las fuentes:

- El análisis de brechas: `lambda-orm/core` → `docs/anlisis_de_brechas_y_hoja_de_ruta_orm_y_data_gateway.md` (lo que
  falta frente a Hasura, Directus, Prisma, PostgREST, Apollo y Google MCP Toolbox).
- Lo que se repartió entre core y la gateway: `lambda-orm/core` → `docs/PENDING_FEATURES.md` (§3, G1–G7).
- Lo que core ya hizo: `lambda-orm/core` → `docs/PENDING_FEATURES.md` (C0–C12), `docs/CORE_PENDING.md` (P1–P8) y un
  documento por feature (`VIEWS.md`, `CONTEXT.md`, `MASKING.md`, `DATA_EVENTS.md`, `CROSS_SOURCE.md`,
  `HTTP_SOURCE.md`, `OUTBOX.md`, `RESULT_TYPES.md`, `MIGRATIONS.md`, `JSON_VECTOR.md`, `GEO.md`, `SEED.md`,
  `OBSERVABILITY.md`).
- La wiki, ya revisada: <https://lambda-orm.github.io/wiki/data-gateway/> y <https://lambda-orm.github.io/wiki/ide/>.

## 1. Dónde está cada cosa hoy

| Qué | Estado |
| --- | --- |
| `develop` | `c7604e9` (merge de `feature/observability`, #11): gateway 4.0.0 + *Unreleased* (OpenTelemetry, historia del schema, actor), IDE 1.0.0 + *Unreleased*, 17 changesets de `@lambdaorm/ui` pendientes |
| `main` | `804747f` (hotfix de conformidad): gateway 4.0.0 e IDE 1.0.0 en sus `package.json`; 37 commits detrás de `develop` |
| Imagen `flaviorita/data-gateway` | En Docker Hub solo hasta **3.2.0**. La **4.0.0 no se publicó**: el workflow `data-gateway-image.yml` falló el 2026-11-23 en el paso *Test the image (conformance suite)* y no se volvió a correr ([run 45222346894](https://github.com/lambda-orm/data-gateway/actions/runs/45222346894)) |
| Imagen `flaviorita/data-gateway-ide` | `1.0.0` publicada (y el release `ide-v1.0.0` del escritorio) |
| `@lambdaorm/ui` | 0.5.0 en npm; 17 changesets en `.changeset/` |
| `@lambdaorm/data-gateway-client` | 0.1.1, nunca publicado (la primera vez necesita un token Automation de npm) |
| λORM que usa la gateway | `@lambdaorm/base ^3.7.0`, `lib ^3.9.0`, `client ^0.10.8` |
| λORM disponible | `base` 3.11.1, `lib` 3.15.0 (3.15.1 en camino: `merge` como `upsert`, secuencias de MongoDB desde 1, funciones de SQLite), `client` 0.10.13, `cli` 1.10.0 |
| La wiki | Ya describe la gateway 4.0.0 y la UI de `develop` del IDE: lo que necesita la 4.1.0 está marcado como *"not in the image 4.0.0"* |

## 2. Primero: lo que bloquea o es un riesgo

### R1. Publicar la imagen 4.0.0

> **Estado (2026-11-25): hecho.** La causa no era solo el uid: el `dist` instalaba λORM con rangos `^` y la imagen traía
> `lib` 3.15, cuyo `model` agrega `required`; el caso de `model` usa `match` (`hotfix/conformance-model-match`, #13) y
> un cambio de la conformidad también dispara el workflow. `flaviorita/data-gateway:4.0.0` está en Docker Hub y la guía
> de la wiki se siguió de punta a punta contra ella (los diez pasos, con la imagen del IDE 1.0.0).

La guía de inicio de la wiki (`docs/data-gateway/northwind/docker-compose.yml`) usa `flaviorita/data-gateway:4.0.0`,
que no existe en Docker Hub: hoy falla para cualquiera que la siga.

1. Ver por qué falló la conformidad contra la imagen (los logs del run de arriba; con la sesión de GitHub, o
   `scripts/ci-local.sh clients` contra la imagen construida localmente). Es probable que sea lo mismo que arregló
   `hotfix/conformance-workspace-owner` (el dueño del workspace en la imagen, uid 1000), que llegó a `main` después
   del run y no lo volvió a disparar.
2. Correr de nuevo el workflow (*Run workflow*, con `force` si hace falta) o hacer que un push a `main` lo dispare.
3. Verificar `docker pull flaviorita/data-gateway:4.0.0` y la guía de la wiki de punta a punta (compose, `push`,
   `import`, Swagger, IDE).

### R2. El cliente elige su vista y su contexto (seguridad)

> **Estado (2026-11-25): hecho** (#14). `requestOptions` borra `view` y `context` en los casos de uso de todos los
> transportes; `plan` lleva el actor; el IDE ya no ofrece la vista. **Sin decidir:** si el cliente puede elegir
> `stage`, `maxRows` y `allowDestructive`.

`queryUseCases.execute` pasa a λORM las `options` del pedido tal como llegan, más el actor
(`application/usecases/actor.ts`, `withActor`); `plan` ni eso. Con λORM ≥ 3.10 eso incluye:

- `options.view`: la vista de λORM (C0). Un cliente con `read` puede pedir la vista que quiera, o ninguna (el
  dominio entero), y saltarse lo que una vista oculta o enmascara.
- `options.context`: el contexto (C1) que leen los filtros de fila de las vistas (C2), los defaults y las
  condiciones. Un cliente puede mandar `{ context: { tenant: 'otro' } }` y leer las filas de otro tenant.
- `options.stage`, `options.maxRows` (C6), `options.allowDestructive` (C10): conviene decidir cuáles puede elegir el
  cliente.

Hasta G1/G2: la gateway **borra** `view` y `context` de las `options` del cliente en todos los transportes (REST,
WebSocket, MCP, scripts, `plan`, `model`, `metadata`, `parameters`, `constraints`, `queue`) y los pone ella (sin vista
y sin contexto, o los de la configuración). Con G1/G2 los pone desde la identidad. Un test por transporte que pruebe
que un `view`/`context` del cliente no llega a λORM.

### R3. Subir a la λORM actual

> **Estado (2026-11-25): hecho** (#16). Hecho: `base` 3.11.1,
> `lib` 3.15.0, `client` 0.10.13; los cuatro errores nuevos con su status y `details`; `push` muestra lo destructivo y
> lo corre solo con `allowDestructive`; comandos `migrations`, `migrate` y `seed` en la administración y en el IDE
> (probados contra PostgreSQL); `observeWith`; JSON, vectores y puntos en la guía de MCP; **la imagen fija las
> versiones probadas** (el `dist` sin rangos: la 4.0.0 se probó con `lib` 3.9 y su imagen instalaba 3.15). `check` y
> `clients` (también contra la imagen) en verde.
>
> **Arreglado en core** (`bugfix/gateway-findings`, en el `develop` de core; falta su release: `lib` y `base` *patch*).
> Cuando se publique: subir la versión acá, quitar el cast de `observeWith` en `lambdaOrmAdapter` y volver el caso de Ilusor a
> `Areas.map(p => p.areaType.nme)` (entre fuentes). Lo que se arregló:
> - Desde `lib` 3.13, un `map` sobre una relación a **otra fuente** se resuelve en memoria y **no valida sus campos**:
>   `Areas.map(p => p.areaType.nme)` no da error (antes: *did you mean name?*). El test de Ilusor usa ahora una
>   relación de la misma fuente.
> - `observeWith` está en `Orm` pero no en `IOrm` (la gateway castea).
> - `cosineDistance`, `l2Distance`, `innerProduct`, `distance`, `within`, `inside`, `jsonSet` no están en el
>   `queryable.d.ts` de `base`: el autocompletado del IDE no los conoce hasta que core los declare.
>
> **Hecho después (2026-11-26, [`VECTOR_POINT_SQLJS.md`](VECTOR_POINT_SQLJS.md)):** formularios del IDE para `vector` y
> `point`; SQLite (sql.js) para el gateway de desarrollo. **Sin hacer de esta tabla:** lo que depende de G1–G7 (consultas con nombre, eventos, outbox, `forward` con la identidad, límites por
> credencial). **Fuera de este repo:** el lab falla en *model ilusor*, que lee el modelo real de Ilusor
> (`~/ilusor/…`): 8 relaciones compuestas que no emparejan `locationId` (aviso para Ilusor, no de λORM).

Subir `@lambdaorm/base`, `lib` y `client` (y el `cli` que instala la imagen) a lo último, y adaptar:

| Qué trae core | Qué hace la gateway |
| --- | --- |
| Errores nuevos: `ContextError` (falta un valor del contexto), `ViewError` (una escritura que sale del filtro de su vista), `CrossSourceError` (una consulta entre fuentes que trae más de `maxRows`), `DestructiveChangeError` (`push` que pierde datos sin `allowDestructive`) | Mapearlos en `domain/errors/errorStatus.ts`: `ContextError` 400, `ViewError` 403, `CrossSourceError` 422 (o 400), `DestructiveChangeError` 409 con el detalle de los cambios |
| `push` frena los cambios destructivos (C10) | El comando `push` de la administración: su preview muestra los destructivos (`query.destructive`) y pide confirmarlos (`allowDestructive`); el IDE lo muestra |
| Migraciones (C10): `infrastructure.migrations`, `stage.migrate`, `U<version>__push.sql`, `lambdaorm migrate --list/--to` | Comandos `migrate` (lista e ir a una versión, con preview) en la administración y el IDE |
| Seed (C12): `stages[].seed`, `orm.stage.seed`, `push --seed` | Comando `seed` (con preview) en la administración y el IDE |
| Consultas con nombre (C9): `application.queries`, validadas al cargar | Ver G7 y §4 (REST y MCP) |
| Eventos de datos (C4): `orm.onDataChange` | Base de G3 y G4 |
| Outbox (C8): `infrastructure.outbox`, `LambdaOrmOutbox`, `OutboxService` | Base de G5 |
| Fuentes Http (C7, P7): `dialect: Http`, `connection.auth` (OAuth2), `connection.forward` (headers desde el contexto) | Que el principal llegue al contexto (G1) para que `forward` reenvíe la identidad; los secretos de `auth` en el `.env` del workspace |
| Entre fuentes (C6, P6): relaciones de cualquier nivel, en memoria hasta `maxRows` | `infrastructure.crossSource.maxRows` o un límite propio por credencial/herramienta (G7) |
| JSON, vectores, geo (C11, P4, P5): `jsonSet`, `cosineDistance`…, `point`, `distance`, `within`, `inside` | Que las descripciones de MCP y el autocompletado del IDE los conozcan; formularios del IDE para `vector` y `point` |
| SQLite con sql.js (P2): `{ file }` o en memoria | Usarlo para el gateway de desarrollo (hoy `checkConnections: false` y sin base) y para tests que hoy no tienen base |
| `orm.observeWith` (lib 3.10.0) | Usarlo en `lambdaOrmAdapter` en vez de armar la observabilidad a mano (pendiente de `OBSERVABILITY_HANDOFF.md` de core) |
| `merge()` = `upsert` (3.15.1); textos escapados por dialecto; `jsonSet` | Nada que cambiar; correr la conformidad y el lab con la versión nueva |

Después: `scripts/ci-local.sh check`, `clients` y `lab`.

### R4. Liberar 4.1.0 y el IDE 1.1.0

> **Estado (2026-11-25):** ramas `release/data-gateway-4.1.0` y `release/ide-1.1.0` listas para `main` (los workflows
> publican las imágenes; el PR de versiones de Changesets, `@lambdaorm/ui` y `@lambdaorm/data-gateway-client`). La wiki
> de la 4.1.0 en `lambda-orm/wiki` → `feature/data-gateway-4.1.0`. **Después de publicar:** llevar `main` a `develop`,
> la guía de la wiki a `flaviorita/data-gateway:4.1.0` (y el IDE 1.1.0), y quitar sus marcas *"not in the image
> 4.0.0"*. La corrección de core de R3 (validación entre fuentes, `IOrm.observeWith`, typings) sale en una 4.1.1.

Con R1–R3: `release/data-gateway-4.1.0` y `release/ide-1.1.0` desde `develop` (como dice `DEPLOY.md`), y el PR de
versiones de Changesets para `@lambdaorm/ui` (17 changesets). La wiki ya documenta todo lo de la 4.1.0: después de
publicar, quitar las marcas *"not in the image 4.0.0"* de sus páginas de la gateway y del IDE.

### R5. Liberar 4.2.0 y el IDE 1.2.0

> **Estado (2026-11-26):** G3–G6 en `develop`; `main` llevado a `develop` (`chore/main-into-develop-4.1.0`, los
> CHANGELOG). Ramas `release/data-gateway-4.2.0` y `release/ide-1.2.0` sobre esa, listas para `main`. La wiki en
> `lambda-orm/wiki` → `feature/data-gateway-4.2.0` (la página nueva *Data changes*, el caché en *Configuration*, la
> pestaña *Data* del IDE; ya con las imágenes `4.2.0` / `1.2.0`: mergearla **después** de publicarlas). Changesets:
> `@lambdaorm/ui` (la tabla) y `@lambdaorm/data-gateway-client` (`subscribe`). Fuera: caché y suscripciones entre
> réplicas (Redis), G6b.

### R6. Liberar 4.3.0 y el IDE 1.3.0

> **Estado (2026-11-26):** réplicas con Valkey, archivos y paneles (G6b), escrituras que esperan aprobación (G7b),
> Keycloak y el login con PKCE, vectores y puntos en el IDE y SQLite para desarrollo, en `develop` (#36–#40). Ramas
> `release/data-gateway-4.3.0` y `release/ide-1.3.0`, listas para `main`. La wiki en `lambda-orm/wiki` →
> `feature/data-gateway-4.3.0` (mergearla **después** de publicar las imágenes). Changesets: `@lambdaorm/ui` (vectores
> y puntos, archivos, paneles, la fila de la connection) y `@lambdaorm/data-gateway-client` (`approval`).

## 3. Las features (G1–G7)

El orden de §5. Cada una con su documento de diseño (`docs/<FEATURE>.md` y su plan), decisiones de a una con una
recomendación, tests por transporte y la conformidad.

### G1. JWT / OIDC (brecha 1.1)

> **Estado (2026-11-25): fases 1 a 5 hechas** en `feature/jwt` ([`JWT.md`](JWT.md), decisiones cerradas): `adapter:
> jwt` y `methods`, roles → permisos, claims → contexto (llega a λORM por el worker), 401 con motivo y
> `WWW-Authenticate`, 503 si el emisor no responde, sesiones y WebSockets que terminan con el token, el cliente Node con
> un token que se renueva, y cuatro casos JWT en la conformidad. **Falta:** la wiki (fase 6) y probarlo contra un IdP
> real (Keycloak) y el login con PKCE desde el IDE: hechos el 2026-11-26, [`OIDC_LOGIN.md`](OIDC_LOGIN.md). El efecto del contexto en las filas
> se prueba con G2 (hoy la gateway no elige vista).

- Un autenticador `jwt`: `issuer`, `audience`, `jwksUri` (con caché y rotación de claves), algoritmos permitidos,
  tolerancia de reloj.
- Del token sale el principal: su nombre (un claim), sus permisos (de un claim o de una tabla rol → permisos en la
  configuración) y su **contexto** de λORM: `claims → context` (por ejemplo `context.tenant = token.tenant_id`).
  λORM ya lee `context` en filtros de vistas, defaults, condiciones y en `forward` de las fuentes Http.
- En todos los transportes: REST y MCP por `Authorization: Bearer`, WebSocket en el upgrade o el subprotocolo,
  `management` al crear la sesión.
- Errores: 401 con el motivo (vencido, firma, audiencia); el token nunca en logs ni auditoría.
- Base de core: C1 (`QueryOptions.context`), C2 (filtros de fila).

### G2. La vista por identidad (brecha 1.2 y 1.3)

> **Estado (2026-11-25): fases 1 a 5 hechas** en `feature/views-by-identity` ([`VIEWS_BY_IDENTITY.md`](VIEWS_BY_IDENTITY.md),
> decisiones cerradas): la vista de la clave o del rol (o la del schema), en las consultas, sus metadatos, el dominio,
> los typings, los mappings, MCP y `/whoami`; dos vistas de un token, 403; una vista que el schema no tiene, aviso al
> cargar y 403. Con G1, el contexto del token filtra las filas (probado en la conformidad). **Falta:** la wiki.

- La gateway elige la vista de λORM (`QueryOptions.view`) por credencial, rol o claim:
  `authorization.views: [{ when: 'claims.role == "support"', view: support }, …]`, o la vista en cada credencial.
- El cliente nunca la elige (R2). `model`, `metadata`, `parameters`, el dominio de `/schema`, las herramientas de MCP
  y el autocompletado del IDE muestran el dominio de **esa** vista.
- Lo que la vista enmascara (C3: `mask`, `hash`, `pii`) sale enmascarado por cualquier transporte; `hash` con clave
  necesita `LAMBDAORM_HASH_KEY` en el entorno del worker.
- Base de core: C0 (vistas), C2 (filas), C3 (enmascarado).

### G3. Caché de resultados (brecha 2.1)

> **Estado (2026-11-25): fases 1 a 3 hechas** en `feature/result-cache` ([`RESULT_CACHE.md`](RESULT_CACHE.md),
> decisiones cerradas): caché en memoria (LRU, TTL, por entidad), clave con la vista y el contexto, invalidación por
> `orm.onDataChange`, `ETag`/`304` en REST, métricas. Entre réplicas, con Valkey: [`REPLICAS.md`](REPLICAS.md) (2026-11-26). De paso: `view`,
> `queries` y `cache` de un schema ya no dan el aviso *unknown key* (falso en 4.1.0).

- Por schema o entidad, en memoria o Redis, con `ETag`/`Cache-Control` en REST.
- La clave incluye la consulta, los datos, la vista y el contexto (dos identidades no comparten un resultado).
- La invalidan los eventos de escritura (C4, `orm.onDataChange`): las entidades que la consulta lee, incluidas las de
  sus `include` y las de otras fuentes.
- Métricas de aciertos y fallos.

### G4. Suscripciones (brecha 2.2)

> **Estado (2026-11-25): fases 1 a 4 hechas** en `feature/subscriptions` ([`SUBSCRIPTIONS.md`](SUBSCRIPTIONS.md),
> decisiones cerradas): `subscribe.entity`, `subscribe.query` (también una consulta con nombre) y `unsubscribe` por
> WebSocket, `GET /subscribe` (SSE), con la identidad de quien se suscribe (una vista con filtro de fila: solo las
> claves que ve); el cliente Node (`client.subscribe`). Entre réplicas, con Valkey: [`REPLICAS.md`](REPLICAS.md) (2026-11-26).

- `subscribe`/`unsubscribe` por WebSocket (JSON-RPC) y SSE: a una entidad (sus cambios) o a una consulta (se vuelve a
  correr cuando cambia una entidad que lee).
- Con los permisos, la vista y el contexto de la credencial: un cambio que el suscriptor no puede ver no le llega.
- Fuente: los eventos de datos de C4. Los cambios que no pasan por λORM (otra aplicación escribiendo en la base) no se
  ven: documentarlo, o sumar CDC por motor más adelante.

### G5. Despachador del outbox (brecha 3.3)

> **Estado (2026-11-25): hecho** en `feature/outbox-dispatcher` ([`OUTBOX_DISPATCHER.md`](OUTBOX_DISPATCHER.md),
> decisiones cerradas): webhooks firmados (HMAC) y Kafka (los brokers de `infrastructure.queue`), por schema; los
> reintentos y `dead` de λORM; `GET …/outbox?status=dead` y `POST …/outbox/{id}/retry` en la administración; una réplica
> despacha (`outbox.dispatch`, `DATA_GATEWAY_OUTBOX_DISPATCH`). **Falta:** la wiki.

- Lee el outbox (C8: `LambdaOrmOutbox`, `OutboxService.pending/done/failed/dispatch`) y entrega a webhooks HTTP o a
  Kafka, con reintentos exponenciales y una cola de fallidos (DLQ).
- Configuración por schema: destinos, firmas de los webhooks (HMAC), concurrencia, reintentos.
- Una réplica despacha (o un lock en la base) para no entregar dos veces; los consumidores deben ser idempotentes.
- La `queue` actual queda como envío explícito.

### G6. Backoffice en el IDE (brecha 5.1)

> **Estado (2026-11-25): hecho** (la tabla editable y exportar) en `feature/backoffice` ([`BACKOFFICE.md`](BACKOFFICE.md),
> decisiones cerradas): en **Data** de una entidad, con `write`, editar una celda (chequeo optimista), agregar y borrar
> filas, ordenar y filtrar; exportar la página o todo (hasta 100 000 filas) en CSV, JSON y Excel. **Falta:** la wiki y
> G6b (archivos S3/Blob y paneles): hecho el 2026-11-26, [`FILES_AND_PANELS.md`](FILES_AND_PANELS.md).

- Tabla con edición en línea (sobre `update` por clave), exportar CSV/Excel/JSON, archivos (S3/Blob) y paneles
  simples.
- No depende de core; cuando el producto lo pida.

### G7. Guardrails de MCP (brecha 5.3)

> **Estado (2026-11-25): fases 1 a 5 hechas** en `feature/named-queries` ([`NAMED_QUERIES.md`](NAMED_QUERIES.md),
> decisiones cerradas): `GET /queries`, `POST /queries/{name}`, `queries.list`/`queries.execute` por WebSocket, las
> herramientas `query_<name>` de MCP con sus parámetros tipados, todo en la vista de quien llama; `mcp.freeQueries:
> false`; límites por consulta (`orm.schemas[].queries`); el cliente Node (`queries()`, `query()`). **Falta:** la wiki,
> la confirmación de mutaciones (G7b, decisión 4) y que el código generado por `lambdaorm build -l client-node` use las
> rutas (core).

- Herramientas curadas: las **consultas con nombre** del schema (C9, `application.queries`) como herramientas MCP, con
  su descripción, sus parámetros tipados (de `orm.parameters`) y su resultado (de `orm.model`). Lo mismo por REST
  (`POST /queries/{name}`) y WebSocket.
- Límites por herramienta (filas, tiempo, costo) además de `mcp.maxRows`.
- Confirmación de mutaciones (*human-in-the-loop*) para agentes: una escritura de un agente queda pendiente hasta que
  alguien la aprueba (desde el IDE o un endpoint), o se limita a herramientas de escritura curadas.
  **Hecho (2026-11-26):** [`MUTATION_APPROVAL.md`](MUTATION_APPROVAL.md) (`mcp.approval`, `approval: writes`, el permiso
  `approve`, `approval_status`, la pestaña del IDE).
- El cliente Node (`lambdaorm build -l client-node` ya genera `queries.ts` desde `/model` y `/parameters`): cuando
  existan las rutas de consultas con nombre, que el código generado las use en vez de mandar el texto.

## 4. Deuda y bugs vistos (de la revisión de la wiki)

> **Estado (2026-11-25):** todos hechos en `bugfix/wiki-review` (desde `develop`), **falta el PR**. El de `plan` y el
> actor, con R2. Para el i18n se eligió una regla: los nombres del `lambdaORM.yaml` y de la API (source, stage, view,
> mapping, domain, plan, metadata, execute, Workbench) quedan en inglés en todos los idiomas; lo demás se traduce.

| Qué | Dónde |
| --- | --- |
| `GET /transports` da `schemaPath: "/{schema}"` para `mcpWebSocket`, pero su upgrade es `/{schema}/mcp` | gateway |
| La descripción de `swagger.yaml` lista menos rutas abiertas que las que el código sirve sin credencial | gateway |
| `plan` no lleva el actor (`withActor`) como `execute` | gateway |
| El README de la gateway enlaza `wiki/data-gateway/Ui/`, que ya no existe (ahora `wiki/ide/`) | `packages/data-gateway/README.md` |
| Los `data.json` de Northwind perdieron sus letras no ASCII (`Mnchen`, `Kln`): `packages/conformance/data.json` y `packages/data-gateway/config/northwind/data.json` | copiar el de la wiki (`docs/data-gateway/northwind/data.json`, ya corregido) y ajustar lo que la conformidad compare |
| El IDE en español deja en inglés las pestañas del resultado (`tree/table/json/yaml`), los botones de acción (`plan`, `metadata`, `execute`…), `Metadata`, `domain` y `Workbench`; en alemán mezcla *Über/Informationen*, *Quellen/Source*; en español *Información* y *Acerca de* para About | `packages/ui`, `packages/ide` (i18n) |
| **Workbench → New project** abre un diálogo titulado **New folder** | IDE |
| La pestaña **Relations (n)** de una entidad cuenta también *Referenced by*; el explorador no | IDE |
| La pestaña de la vista se llama **Keys and indexes** y la del formulario **Indexes** | IDE |
| La ayuda del filtro del wizard es genérica (habla de `p.price` y `p.category` en cualquier entidad) | IDE |
| La lista de Variables (.env) no tiene encabezado en la columna de uso | IDE |

## 5. Orden sugerido

1. **R1** (la imagen 4.0.0) y **R2** (vista y contexto del cliente): hoy son un problema para quien la usa.
2. **R3** (λORM actual) y **R4** (4.1.0, IDE 1.1.0, `@lambdaorm/ui`), con los bugs chicos de §4.
3. **Seguridad:** G1 (JWT) → G2 (vista por identidad) → G7 (MCP curado, que usa las consultas con nombre).
4. **Escala:** G3 (caché) y G4 (suscripciones), los dos sobre los eventos de C4.
5. **Ecosistema:** G5 (outbox), y exponer bien las fuentes Http (C7) y las consultas entre fuentes (C6).
6. **G6** (backoffice) cuando el producto lo pida.

Al terminar una feature: su página en la wiki (`~/personal/lambdaorm/wiki`, cuatro idiomas), o juntar varias y
actualizarla al final de la serie, como se hizo con core.

## 6. Cómo trabajar acá

- `CLAUDE.md`, `DEPLOY.md` y `docs/HANDOFF.md` de este repo: comandos, ramas, releases, el entorno con Ilusor.
- Antes de cada push: `scripts/ci-local.sh check` (y `clients`, `lab` cuando toque la gateway o λORM).
- Git Flow: ramas `feature/…`, `bugfix/…`, `release/…` desde `develop`; PRs a `develop`; nunca push directo a `main`
  ni a `develop`. Commits Conventional, con el número de ticket.
- Las imágenes las publica el workflow cuando una versión nueva llega a `main`; npm, Changesets. Nada se publica sin
  el OK del dueño.
- Un cambio que necesita λORM se hace y se libera primero en `lambda-orm/core`, y después se sube la versión acá.
- En pruebas con navegador o con el gateway de desarrollo: nunca borrar ni pisar la sesión del usuario
  (`/admin/session`, `.data-gateway/state.sqlite`); usar un workspace y puertos propios, y detener procesos por PID.

## 7. Visto en core (para lambda-orm/core)

- **SQLjs, `year()` y el agrupamiento (2026-11-26):** `Orders.map(p => ({ year: year(p.orderDate), n: count(1) }))`
  genera `EXTRACT(YEAR FROM …)`, que SQLite no tiene (`strftime('%Y', …)`), y agrupa por `o.OrderDate` en vez de por la
  expresión del año (`GROUP BY` de la columna y no de lo que el `map` calcula). Visto en un panel del IDE sobre el
  Northwind de desarrollo.

