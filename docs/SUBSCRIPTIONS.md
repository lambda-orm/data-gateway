# Suscripciones (G4)

> **Estado (2026-11-25): decisiones de §7 cerradas (las recomendadas, el usuario); fases 1 a 4 hechas** (rama
> `feature/subscriptions`, sobre `feature/result-cache`); falta la wiki. Probado contra Postgres
> (`conformance/runner/subscriptions.mjs` y el runner del cliente Node): WebSocket, SSE, una consulta y el filtro de
> claves de una vista con el contexto de un token. `subscriptions.debounce` es fijo (200 ms) y
> `transports.webSocket.maxSubscriptions`, por ahora, 100. G4 de [`PENDINGS.md`](PENDINGS.md) §3 (brecha 2.2). Se
> apoya en los eventos de datos de λORM (`lambda-orm/core` → `docs/DATA_EVENTS.md`), como el caché
> ([`RESULT_CACHE.md`](RESULT_CACHE.md)), y en la vista y el contexto de quien se suscribe (G1, G2).

## 1. Objetivo

Que un cliente se entere de un cambio sin preguntar cada tanto:

- **a una entidad:** cada escritura de `Orders` (la acción, las claves cuando se conocen, cuántas filas), sin los
  datos (los lee él, con su vista);
- **a una consulta:** cuando cambia algo que la consulta lee, la gateway la vuelve a correr con la identidad de quien
  se suscribió y le manda el resultado nuevo, solo si cambió.

Hoy no hay forma: un cliente hace polling.

## 2. Por WebSocket (JSON-RPC)

```json
→ { "id": 1, "method": "subscribe.entity", "params": { "entity": "Orders" } }
← { "id": 1, "result": { "subscription": "s1" } }
← { "method": "data.changed", "params": { "subscription": "s1", "entity": "Orders", "action": "insert", "keys": [{ "id": 11078 }] } }

→ { "id": 2, "method": "subscribe.query", "params": { "query": "Orders.filter(p => p.customerId == c).map(p => p.id)", "data": { "c": "ALFKI" } } }
← { "id": 2, "result": { "subscription": "s2", "result": [10643, 10692, …] } }
← { "method": "query.changed", "params": { "subscription": "s2", "result": [10643, 10692, …, 11079] } }

→ { "id": 3, "method": "unsubscribe", "params": { "subscription": "s1" } }
```

- Una suscripción vive mientras su conexión (al cerrarse, se van todas; al vencer el token, la conexión se cierra:
  G1).
- Una consulta con nombre también: `subscribe.query { name, data }` (G7).

## 3. Por SSE

`GET /subscribe?entity=Orders` o `GET /subscribe?query=…&data=…` (o `?name=…`) en el transporte `http`:
`text/event-stream` con los mismos eventos (`event: data.changed` / `query.changed`). Para un navegador o un backend
que no quiere WebSocket. Decisión 1.

## 4. Seguridad

- **Permiso:** `read`; la consulta de `subscribe.query` se autoriza como un `execute` (una que escribe no se suscribe).
- **La vista:** una entidad que la vista de quien se suscribe excluye es `403 ViewError`; una consulta corre en su
  vista y con su contexto, siempre (sus filas filtradas).
- **Un cambio que no puede ver no le llega** (decisión 2): un `data.changed` de una entidad con filtro de fila en su
  vista se manda solo con las claves que su vista ve (se leen esas claves en su vista); sin claves (un update por
  filtro), sin ellas.

## 5. Límites

`transports.webSocket.maxSubscriptions` (por conexión, `100`), y una consulta suscrita se vuelve a correr **a lo sumo
una vez cada** `subscriptions.debounce` (`200ms`) aunque lleguen muchas escrituras.

## 6. Lo que no se ve

Lo que no pasa por λORM (otra aplicación escribiendo en la base) no se ve; con varias réplicas, cada una ve sus
escrituras (como el caché: con Redis, después). CDC de la base, más adelante.

## 7. Decisiones

| # | Tema | Recomendación | Alternativa |
| --- | --- | --- | --- |
| 1 | SSE | **Sí**, en `http` (`GET /subscribe`) | Solo WebSocket |
| 2 | Un cambio que la vista no ve | **Filtrar por las claves en su vista** (una lectura por commit y suscriptor con filtro de fila) | Mandar todos los cambios de la entidad (sin datos, pero dice que algo cambió) |
| 3 | `query.changed` | **Con el resultado nuevo**, solo si cambió | Solo avisar; el cliente vuelve a preguntar |
| 4 | Varias réplicas | **Las escrituras de esta réplica ahora**; entre réplicas con Redis, después (como G3) | Ahora |

## 8. Fases

1. Los `DataChange` del worker al edge (como los eventos de la cola).
2. WebSocket: `subscribe.entity`, `subscribe.query`, `unsubscribe`, con permisos, vista y contexto.
3. SSE.
4. Cliente Node (`client.subscribe…`).
5. Conformidad y wiki.
