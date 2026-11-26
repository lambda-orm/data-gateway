# Vectores y puntos en el IDE, y SQLite para desarrollo (resto de R3)

> **Estado (2026-11-26): decisiones de §4 cerradas (las recomendadas, el usuario); fases 1 a 3 hechas** (rama
> `feature/vector-point-sqljs`). El gateway de desarrollo arranca con `npm run dev` (o la tarea de VS Code) sobre un
> SQLite propio; un `dev/workspace` que ya existía queda como estaba (borrarlo para volver a sembrar). Lo que quedó sin hacer de la tabla de R3 en
> [`PENDINGS.md`](PENDINGS.md): λORM 3.15 trae `vector` (con su `length`) y `point` (GeoJSON), y SQLite con sql.js
> funciona (archivo o memoria). El autocompletado de `cosineDistance`, `distance`, `within`, `inside` y `jsonSet`
> espera a que core los declare en el `queryable.d.ts` de `@lambdaorm/base`: fuera de esta pieza.

## 1. `vector` y `point` en el IDE

**Al editar el schema** (el formulario de una propiedad): los tipos `vector` (con **Dimensiones**, su `length`) y
`point`; un índice `vector` (con su distancia: coseno, L2, producto interno) y `spatial`.

**En los datos** (la tabla de *Data* y el formulario de una fila):

| Tipo | Se muestra | Se edita |
| --- | --- | --- |
| `point` | `-58.38, -34.60` (longitud, latitud) y un enlace al mapa (OpenStreetMap) | dos campos, **Longitud** y **Latitud**, validados (−180…180, −90…90); se manda como GeoJSON |
| `vector` | `[0.12, -0.03, …] (1536)` | no en la celda (nadie escribe 1536 números); en el formulario, como JSON, validado contra sus dimensiones |

## 2. SQLite para desarrollo

- **El gateway de desarrollo** (`packages/data-gateway/dev`): hoy su Northwind apunta a un Postgres que no hay
  (`checkConnections: false`). Pasa a SQLite (`dialect: SQLjs`, `connection: data/northwind.sqlite`), con el esquema
  creado (`push`) y los datos de Northwind importados la primera vez: `npm run dev` funciona sin Docker.
- **Los tests** que hoy corren sin base (y mockean λORM) pueden usar una base en memoria de verdad.

## 3. Lo que no

El mapa no se dibuja en el IDE (un enlace basta por ahora); polígonos (`inside`) se pasan como parámetros GeoJSON en
una consulta, sin editor.

## 4. Decisiones

| # | Tema | Recomendación | Alternativa |
| --- | --- | --- | --- |
| 1 | Editar un `point` | **Longitud y latitud en dos campos** (y el GeoJSON por debajo) | El GeoJSON como texto |
| 2 | Editar un `vector` | **Solo en el formulario de la fila, como JSON** | También en la celda |
| 3 | La base del gateway de desarrollo | **Un archivo SQLite que se crea la primera vez** (los datos persisten entre corridas) | En memoria (empieza vacía cada vez) |

## 5. Fases

1. El formulario de la propiedad y del índice (tipos, dimensiones, distancia).
2. La tabla y el formulario de la fila: `point` y `vector`.
3. El gateway de desarrollo con SQLite (esquema y datos) y su documentación; los tests que ganan una base.
