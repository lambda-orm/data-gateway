# Varias réplicas con Redis (G3b, G4b)

> **Estado (2026-11-26): diseño; decisiones de §6 por cerrar.** La fase siguiente del caché
> ([`RESULT_CACHE.md`](RESULT_CACHE.md), decisión 2) y de las suscripciones ([`SUBSCRIPTIONS.md`](SUBSCRIPTIONS.md),
> decisión 4), y de paso el despachador del outbox ([`OUTBOX_DISPATCHER.md`](OUTBOX_DISPATCHER.md), decisión 1).

## 1. Objetivo

Hoy cada réplica ve solo las escrituras que pasan por ella:

- **el caché** de una réplica sigue sirviendo un resultado que otra ya cambió (hasta su `ttl`);
- **una suscripción** no se entera de una escritura hecha por otra réplica;
- **el outbox** necesita un flag a mano para que una sola réplica despache.

Con un Redis compartido, cada réplica publica los cambios de datos que hace y escucha los de las otras: el caché se
invalida en todas, las suscripciones avisan en todas, y una sola réplica despacha el outbox sin configurarlo.

## 2. Configuración

```yaml
cluster:
  redis:
    url: $REDIS_URL            # redis://[:password@]host:6379[/db] o rediss:// (TLS)
    prefix: data-gateway       # para compartir un Redis con otras cosas
```

Sin `cluster.redis`, todo sigue como hoy (una réplica, o cada una con lo suyo).

## 3. Los cambios de datos entre réplicas

- Cada escritura que pasa por λORM (`orm.onDataChange`) se publica en el canal `<prefix>:<schema>:changes` con el id de
  la réplica (`DataChangeSummary`: entidad, acción, claves, cuántas filas).
- Cada réplica recibe los de las otras (descarta los suyos) y los trata como propios: **invalida su caché** y **avisa a
  sus suscripciones**, con el mismo filtro por la vista de cada suscriptor.
- Los datos de las filas nunca viajan: solo entidad, acción y claves.

## 4. El outbox: una réplica despacha sola

Con Redis, el despachador de cada schema toma un lock con vencimiento (`SET <prefix>:<schema>:outbox <réplica> NX PX
15000`, renovado cada 5 s): la que lo tiene despacha; si se cae, otra lo toma al vencer. `outbox.dispatch: false`
sigue sacando a una réplica.

## 5. Si Redis se cae

La gateway sigue: cada réplica vuelve a ver solo lo suyo (el caché queda acotado por su `ttl`), lo dice en el log y en
`/metrics` (`data_gateway_cluster_connected`), y se reconecta sola. El outbox: sin lock, no despacha nadie hasta que
vuelve (mejor que dos a la vez).

## 6. Decisiones

| # | Tema | Recomendación | Alternativa |
| --- | --- | --- | --- |
| 1 | El caché | **En memoria de cada réplica, invalidado entre réplicas por Redis** (un resultado no viaja por la red; cada réplica arma el suyo) | Los resultados en Redis, compartidos |
| 2 | Cliente de Redis | **`redis` (node-redis, el oficial)**: reconexión, TLS, autenticación | Un cliente RESP propio, sin dependencias |
| 3 | Outbox | **Lock en Redis** (una réplica despacha sola) | Seguir con el flag |
| 4 | Redis caído | **Seguir sin él** (cada réplica lo suyo, avisado) | Responder `503` |

## 7. Fases

1. Puerto `ClusterBus` (publicar, escuchar, lock) y su adaptador Redis; la configuración `cluster.redis`.
2. Los cambios de datos entre réplicas: el caché y las suscripciones.
3. El lock del outbox.
4. Pruebas: dos gateways contra un Redis y un Postgres en Docker (una escribe, la otra invalida y avisa; el lock pasa
   de una a otra al detener la primera).
