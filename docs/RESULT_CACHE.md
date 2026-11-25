# Caché de resultados (G3)

> **Estado (2026-11-25): decisiones de §7 cerradas (las recomendadas, el usuario); fases 1 a 3 hechas** (rama
> `feature/result-cache`); faltan Redis (fase 4) y la wiki. Probado con la conformidad con el caché activo: 195/195,
> con aciertos e invalidaciones reales (45 hits, 20 invalidaciones en una corrida). G3 de [`PENDINGS.md`](PENDINGS.md) §3 (brecha 2.1). Se
> apoya en los eventos de datos de λORM: `lambda-orm/core` → `docs/DATA_EVENTS.md` (`orm.onDataChange`, un
> `DataChange` por escritura, después del commit).

## 1. Objetivo

Que una lectura repetida no vuelva a la base mientras nada de lo que lee cambió:

- se guarda el resultado de un `execute` que **solo lee** (y de una [consulta con nombre](NAMED_QUERIES.md) que solo
  lee), nunca el de una escritura, un script o un `execute-queued`;
- una escritura que pasa por λORM **invalida** al instante los resultados que leen sus entidades (también por un
  `include` o una relación de otra fuente);
- lo que escribe otra aplicación en la base no se ve: un **TTL** acota cuánto puede estar viejo un resultado;
- REST responde con **`ETag`**, y un `If-None-Match` igual es `304` sin cuerpo.

## 2. Configuración

```yaml
cache:                          # global; también orm.schemas[].cache
  enabled: true
  ttl: 60s                      # cuánto vive un resultado (el tope para lo que se escribe por fuera)
  maxEntries: 10000             # en memoria: los más viejos se van primero (LRU)
  maxRowBytes: 1MB              # un resultado más grande no se guarda
  entities:                     # por entidad: otro ttl, o ninguno (no se guarda lo que la lee)
    Prices: { ttl: 5s }
    AuditLogs: { enabled: false }
  store: memory                 # memory (cada réplica) o redis (decisión 2)
```

## 3. La clave

Un resultado es de: el texto de la consulta, sus `data`, el `stage`, **la vista y el contexto de quien llama** (G2, G1)
y las opciones que cambian el resultado. Dos identidades con distinta vista o distinto tenant nunca comparten un
resultado. La clave es un hash de todo eso (nunca contiene los datos en claro).

## 4. La invalidación

- Al guardar un resultado se anotan **las entidades que lee** (de su `metadata`: la raíz, sus `include` y las
  relaciones que recorre su `map`/`filter`).
- Un `DataChange` de una entidad borra todos los resultados que la leen (por entidad, no por fila: un evento puede no
  tener claves).
- Con varias réplicas, cada una se entera de las escrituras de las otras (decisión 2).

## 5. HTTP

- `ETag`: el hash del resultado; `Cache-Control: private, no-cache` (el cliente puede guardarlo y debe revalidar).
- `If-None-Match` igual al de ahora: `304` sin cuerpo (también si el resultado salió de la base y no cambió).
- (Sin `X-Data-Gateway-Cache`: el transporte no sabe si el resultado salió del caché del worker; las métricas lo dicen.)

## 6. Métricas

`data_gateway_cache_requests{schema, result="hit|miss"}`, `data_gateway_cache_invalidations{schema}` y
`data_gateway_cache_entries{schema}` en `/metrics` (del registro del worker del schema).

## 6a. Las entidades que lee una consulta

Las de sus sentencias (su `metadata`: la raíz y sus `include`) y las que alcanza por una relación que nombra
(`p.category.name` en un `map` o un `filter` es un JOIN, no una sentencia): se recorren las relaciones del dominio cuyo
nombre aparece en el texto. Puede nombrar de más (una palabra de un texto que también es una relación): solo invalida de
más, nunca de menos.

## 7. Decisiones

| # | Tema | Recomendación | Alternativa |
| --- | --- | --- | --- |
| 1 | Activa por defecto | **No**: `cache.enabled: true` donde se quiera (el TTL cambia lo que ve un cliente) | Activa con un TTL corto |
| 2 | Varias réplicas | **Memoria ahora; Redis en una fase siguiente** (la caché en Redis y la invalidación entre réplicas por su pub/sub) | Redis desde el principio |
| 3 | Granularidad de la invalidación | **Por entidad** (simple y correcta; un evento puede no tener claves) | Por fila cuando hay claves |
| 4 | `ETag` y `304` | **Sí**, en REST (`execute`, `/queries/{name}`) | No |

## 8. Fases

1. El caché en memoria (LRU, TTL, por entidad), la clave, la invalidación por `onDataChange`; `execute` y las
   consultas con nombre que leen.
2. REST: `ETag`, `If-None-Match` → `304`, `X-Data-Gateway-Cache`.
3. Métricas.
4. Redis (decisión 2).
5. Conformidad y wiki.
