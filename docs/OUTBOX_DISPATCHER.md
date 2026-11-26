# Despachador del outbox (G5)

> **Estado (2026-11-25): decisiones de §6 cerradas (las recomendadas, el usuario); fases 1 a 4 hechas** (rama
> `feature/outbox-dispatcher`); falta la wiki. Probado contra PostgreSQL (`tests/integration/commands.test.ts`): una
> escritura deja su evento, el webhook falla y queda `dead`, se lista y se reintenta, se entrega. Kafka, con un productor
> de prueba. El webhook firma `timestamp.body` (`X-Data-Gateway-Timestamp`): un receptor puede rechazar firmas viejas. G5 de [`PENDINGS.md`](PENDINGS.md) §3 (brecha 3.3). Se
> apoya en el outbox de λORM: `lambda-orm/core` → `docs/OUTBOX.md` (`infrastructure.outbox`, la entidad
> `LambdaOrmOutbox`, `orm.outbox.pending/done/failed`).

## 1. Objetivo

Que los cambios de los datos lleguen a otros sistemas **aunque el proceso se caiga**: λORM escribe el evento en la
misma transacción que el cambio (outbox); la gateway lo entrega a sus destinos, reintenta lo que falla y deja muerto
(`dead`) lo que falla demasiado, para revisarlo.

Hoy la `queue` (Kafka) es un envío explícito de un `execute`; nadie entrega los cambios de los datos.

## 2. Configuración

```yaml
# lambdaORM.yaml: qué cambios se escriben en el outbox (core)
infrastructure:
  outbox: { entities: [Orders], maxAttempts: 10 }

# data-gateway.config.yaml: a dónde van (global o por schema)
orm:
  schemas:
    - path: shop
      outbox:
        interval: 1s          # cada cuánto busca pendientes
        batch: 100            # cuántos por vuelta
        destinations:
          - type: webhook
            url: https://billing.example.com/hooks/orders
            secret: $BILLING_HOOK_SECRET      # firma HMAC-SHA256 del cuerpo
            timeout: 5s
            entities: [Orders]                # opcional: solo estos
          - type: kafka
            topic: shop-changes               # con infrastructure.queue del schema (sus brokers)
```

## 3. La entrega

- **Webhook:** un `POST` por evento con el evento como JSON (`id`, `entity`, `action`, `keys`, `actor`, `tx`, `time`;
  **nunca los datos**), y los headers `X-Data-Gateway-Event` (su id: la clave de idempotencia),
  `X-Data-Gateway-Signature: sha256=<HMAC del cuerpo con el secret>` y `X-Data-Gateway-Timestamp`. Un `2xx` es
  entregado; otro status, un timeout o un error de red, fallido.
- **Kafka:** un mensaje por evento al `topic`, con la clave `<entity>:<keys>` (los de una fila, en orden en su
  partición) y el evento como valor.
- **Varios destinos:** un evento está entregado cuando lo aceptaron **todos** los que lo toman; si uno falla, se
  reintenta entero (los destinos deben ser idempotentes: el id del evento lo permite).
- **Reintentos:** los de λORM (`failed`: 1, 2, 4… segundos, una hora como mucho); después de `maxAttempts`, `dead`
  con su error.

## 4. Una réplica despacha

λORM no bloquea filas (`SKIP LOCKED`): dos despachadores podrían tomar el mismo evento. Decisión 1.

## 5. Ver y reintentar lo muerto

`GET /admin/workspaces/{schema}/outbox?status=dead` lista los eventos muertos con su error; `POST
…/outbox/{id}/retry` los vuelve a `pending`. Con `schemaRead` y `ddl`. Decisión 3.

## 6. Decisiones

| # | Tema | Recomendación | Alternativa |
| --- | --- | --- | --- |
| 1 | Varias réplicas | **Un flag por réplica**: `outbox.dispatch: true` (o `DATA_GATEWAY_OUTBOX_DISPATCH=true`) en la que despacha; por defecto la única réplica sí | Un lock en la base (una fila con vencimiento) |
| 2 | Un evento por request | **Sí** (simple, idempotente por id) | Lotes por destino |
| 3 | Lo muerto | **Listar y reintentar desde la administración ahora** | Solo en la base, después |
| 4 | Kafka | **Ahora, con el Kafka de `infrastructure.queue`** | Solo webhooks primero |

## 7. Fases

1. El despachador en el worker del schema: `pending` → destinos → `done` / `failed`; webhooks con firma.
2. Kafka.
3. Administración: lo muerto, reintentar; métricas (entregados, fallidos, muertos, pendientes).
4. Pruebas contra Postgres (un webhook de prueba que falla y después acepta) y wiki.
