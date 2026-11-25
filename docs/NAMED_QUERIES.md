# Consultas con nombre y guardrails de MCP (G7)

> **Estado (2026-11-25): decisiones de §7 cerradas (las recomendadas, el usuario); fases 1 a 5 hechas** (rama
> `feature/named-queries`); faltan la wiki (fase 6), la confirmación de mutaciones (G7b) y que `lambdaorm build -l
> client-node` use las rutas (core). G7 de [`PENDINGS.md`](PENDINGS.md) §3 (brecha 5.3). Sigue
> a G1 ([`JWT.md`](JWT.md)) y G2 ([`VIEWS_BY_IDENTITY.md`](VIEWS_BY_IDENTITY.md)). Las consultas con nombre, en core:
> `lambda-orm/core` → `docs/RESULT_TYPES.md` §2 (`application.queries`, validadas al cargar el schema).

## 1. Objetivo

Que un agente (y un cliente) use **consultas curadas** en lugar de escribir la suya:

- cada consulta con nombre del schema (`application.queries: [{ name, description, query }]`) es una **herramienta
  MCP** con su descripción, sus parámetros tipados (de `orm.parameters`) y su resultado (de `orm.model`), y una ruta
  **REST** y un método **WebSocket**;
- un schema (o una credencial) puede dejar a los agentes **solo** con esas consultas, sin `orm_execute` libre;
- cada consulta puede tener **sus límites** (filas, tiempo) además de `mcp.maxRows`;
- (después) una escritura de un agente puede quedar **pendiente de aprobación**.

Hoy un agente tiene `orm_execute` con cualquier expresión dentro de sus permisos, su vista y `mcp.maxRows`.

## 2. Las consultas, por transporte

| Transporte | Lista | Ejecuta |
| --- | --- | --- |
| REST | `GET /queries` (nombre, descripción, parámetros, modelo) | `POST /queries/{name}` con `{ data, options }` |
| WebSocket | `queries.list` | `queries.execute { name, data, options }` |
| MCP | las herramientas `query_<name>` en `tools/list` | `tools/call query_<name>` con los parámetros como argumentos |
| Cliente Node | `client.queries()` | `client.query(name, data)` |

- **La vista de quien llama** (G2): los parámetros y el modelo se calculan en su vista; una consulta que usa algo que
  su vista excluye **no se le lista** (y ejecutarla es el `ViewError` 403).
- **Los permisos:** los de la consulta, como `execute` (una que escribe pide `write`).
- **El texto de la consulta no se muestra** a quien la usa (solo nombre, descripción, parámetros y modelo): `plan`
  sigue disponible para quien tiene `plan`.
- **La auditoría** dice el nombre de la consulta (`operation: query`, `query: deviceWithType`).

## 3. Solo consultas curadas

```yaml
mcp:
  freeQueries: false          # sin orm_execute, orm_execute_script ni orm_plan: solo las query_<name> (y schema_*)
orm:
  schemas:
    - path: shop
      mcp: { freeQueries: false }
```

Decisión 2: por schema/global, o también por credencial.

## 4. Límites por consulta

```yaml
orm:
  schemas:
    - path: shop
      queries:
        deviceWithType: { maxRows: 100, timeout: 5s }
```

En la configuración de la gateway (decisión 3), no en el `lambdaORM.yaml`: son límites de servicio, no del modelo.

## 5. Confirmación de mutaciones (human-in-the-loop)

Una escritura que hace un agente por MCP queda **pendiente**: la herramienta responde `pending` con un id; alguien con
el permiso la aprueba (o la rechaza) desde el IDE o `POST /approvals/{id}`; el agente consulta su estado. Es otra pieza
(estado, expiración, notificación): decisión 4.

## 6. El código generado

`lambdaorm build -l client-node` ya escribe `queries.ts` desde `/model` y `/parameters`. Cuando existan las rutas,
que el código generado llame a `POST /queries/{name}` en vez de mandar el texto: es un cambio en `@lambdaorm/cli`
(core), después de esto.

## 7. Decisiones

| # | Tema | Recomendación | Alternativa |
| --- | --- | --- | --- |
| 1 | Qué consultas se exponen | **Todas** las de `application.queries` (las filtra `mcp.tools.include/exclude` como cualquier herramienta) | Solo las marcadas (`expose: true`) |
| 2 | Sin consultas libres | **`mcp.freeQueries: false`, global o por schema** | También por credencial |
| 3 | Dónde van los límites | **En `data-gateway.config.yaml`**, por schema y consulta | En `application.queries` del `lambdaORM.yaml` |
| 4 | Confirmación de mutaciones | **Después** (G7b): primero las consultas y `freeQueries`; un agente que no debe escribir, sin `write` | Ahora |

## 8. Fases

1. Leer `application.queries` del schema; `GET /queries` y `POST /queries/{name}` (vista, permisos, auditoría).
2. WebSocket (`queries.list`, `queries.execute`) y MCP (`query_<name>`, `freeQueries`).
3. Límites por consulta.
4. Cliente Node (`queries()`, `query(name, data)`).
5. Conformidad: consultas con nombre en el schema de la suite, por los cinco transportes.
6. Wiki.
