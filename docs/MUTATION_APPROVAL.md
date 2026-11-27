# Aprobación de escrituras de agentes (G7b)

> **Estado (2026-11-26): decisiones de §7 cerradas (las recomendadas, el usuario); fases 1 a 5 hechas** (rama
> `feature/mutation-approval`). La decisión 4 de [`NAMED_QUERIES.md`](NAMED_QUERIES.md): una escritura de un agente
> espera a que una persona la apruebe. Probado con λORM sobre SQLite (`tests/integration/approvals.test.ts`) y de punta
> a punta en el IDE (aprobar desde la pestaña corre la escritura como quien la pidió). Cambios respecto del diseño: las
> rutas de la administración van por schema (`/admin/workspaces/{schema}/approvals`), REST responde `202` y tiene
> `GET /{schema}/approvals/{id}` (WebSocket: `approvals.status`), y el IDE relee la lista cada 15 s en vez de un evento.

## 1. Objetivo

Un agente (MCP) puede proponer cambios, pero no hacerlos solo: su escritura queda **pendiente**, una persona la ve
(qué consulta, con qué datos, qué sentencias correría) y la **aprueba** o la **rechaza**; aprobada, corre con la
identidad del agente (su vista, su contexto) y queda en la auditoría con quién la aprobó.

## 2. Configuración

```yaml
mcp:
  approval: writes         # none (hoy) | writes: toda escritura por MCP espera una aprobación
  approvalExpires: 1h      # una pendiente que nadie aprueba vence
# también por schema (orm.schemas[].mcp.approval) y por rol:
authorization:
  roles:
    agent: { permissions: [read, write], approval: writes }
    ops:   { permissions: [read, approve] }
authentication:
  keys:
    - { name: agent, value: $AGENT_KEY, roles: [agent] }
    - { name: ops,   value: $OPS_KEY,   roles: [ops] }
```

`approve` es un permiso nuevo: aprobar o rechazar las pendientes del schema.

## 3. El agente

- `orm_execute` con una escritura, `query_<name>` de una consulta que escribe y `orm_execute_script` (un script puede
  escribir y no se sabe antes) responden **al instante**: `{ "approval": "a-123", "status": "pending", "expiresAt" }`
  con un texto que le dice al modelo que espera a una persona.
- La herramienta `approval_status { id }` dice si está `pending`, `approved` (con su resultado), `rejected` (con el
  motivo) o `expired`.

## 4. Quien aprueba

- `GET /admin/workspaces/{schema}/approvals?status=pending`: las pendientes, cada una con quién la pidió, cuándo, la consulta o el
  script, sus datos y **el plan** (las sentencias que correría, de `plan`).
- `POST /admin/workspaces/{schema}/approvals/{id}/approve` y `…/reject { reason }`, con `approve`. **No se aprueba la propia** (otra
  credencial, decisión 2).
- El IDE: la pestaña **Escrituras que esperan** de la connection (con `approve`) con las pendientes, su plan, sus datos,
  Aprobar y Rechazar (con un motivo); se relee cada 15 s.

## 5. Dónde viven

En el estado de la gateway (`.data-gateway/state.sqlite`, como las sesiones: compartido por las réplicas que usan el
mismo volumen; `memory` si no). Una aprobada se ejecuta una sola vez, aunque dos personas aprueben a la vez.

## 6. Auditoría

La escritura queda auditada como siempre, con el agente como actor y `approvedBy`; un rechazo y un vencimiento también
quedan (`approval.rejected`, `approval.expired`).

## 7. Decisiones

| # | Tema | Recomendación | Alternativa |
| --- | --- | --- | --- |
| 1 | Qué espera aprobación | **Las escrituras por MCP** (`mcp.approval`), y una credencial o un rol con `approval: writes` en cualquier transporte | Solo por credencial |
| 2 | La propia | **Otra credencial aprueba** (cuatro ojos) | Cualquiera con `approve` |
| 3 | El agente espera | **Respuesta al instante + `approval_status`** (un modelo no queda colgado) | La herramienta bloquea hasta la aprobación o un tiempo |
| 4 | Quién aprueba | **Un permiso nuevo, `approve`** | Quien tenga `ddl` |

## 8. Fases

1. El dominio: una pendiente, sus estados, su vencimiento; el almacén (SQLite y memoria).
2. El gateway: las escrituras que esperan (MCP y credenciales), `approval_status`, ejecutar una aprobada con la
   identidad que la pidió; la auditoría.
3. La administración: listar, aprobar, rechazar; el evento de una nueva.
4. El IDE: la vista Aprobaciones.
5. Pruebas por transporte y la conformidad.
