# Pendientes de Ilusor

Lo que hay que ajustar en Ilusor (`~/ilusor/dev`, rama `feat/data-gateway`) por lo que se hizo en este repositorio y en
λORM. No es trabajo de acá: es la lista para llevar allá. Estado al **2026-11-27**.

Las fuentes:

- Lo que necesita λORM: `~/ilusor/dev/docs/LAMBDAORM_PENDING.md` (L45–L53, commit `d677a163` de Ilusor).
- La gateway 5.0 sin publicar: la rama `feature/credential-context` de este repo, [`ROLE_SCOPES.md`](ROLE_SCOPES.md) y
  [`GATEWAY_STATE.md`](GATEWAY_STATE.md).
- El entorno local con Ilusor: [`HANDOFF.md`](HANDOFF.md) §4.

## 1. Dónde está cada cosa hoy

| Qué | Estado |
| --- | --- |
| El modelo versionado | `ci/deploy/files/data-gateway/workspace/lambdaORM.yaml` (7957 líneas, último cambio `ed3e5ee0`): **sin entidades abstractas** |
| El modelo del gateway que corre | `cloud/data-gateway/workspace/ilusor/lambdaORM.yaml` (7836 líneas), **fuera de git**: `Audited` (con `default` y `writeValue`), `Catalog`, `Located` y `LocatedCatalog`, más las constraints agregadas desde el IDE |
| Backup | `cloud/data-gateway/workspace/ilusor/lambdaORM.yaml.bak-pre-located` (el modelo antes de `Catalog` / `Located`) |
| El gateway de Ilusor | `ilusor/data-gateway:4.0.0-management` (`@lambdaorm/base` 3.6.0), con claves que dicen sus `permissions` |
| `docs/LAMBDAORM_PENDING.md` | Commiteado en Ilusor (`d677a163`); falta pasarlo a core |

## 2. El modelo con entidades abstractas

### I1. Llevar el modelo del workspace al versionado

El modelo que corre ya tiene las cuatro abstractas. El versionado no tiene ninguna: si el deploy lo copia, se pierden.

- Decidir de dónde sale el modelo: si `ci/lambdaorm/model-from-database.py` lo genera, las abstractas se escriben
  **en el script** (si no, la próxima generación las pisa); si se edita a mano, copiar el del workspace encima del
  versionado.
- El del workspace trae también lo cambiado desde el IDE antes de las abstractas (`Audited` con `default: now()` /
  `context.username` y `writeValue`, constraints): revisar ese diff aparte, no mezclado con las abstractas.
- Verificar como se hizo hasta ahora: `orm.schema.complete` sobre el modelo anterior y el nuevo, comparados entidad
  por entidad, propiedad y relación por nombre: iguales.
- Después, borrar `lambdaORM.yaml.bak-pre-located`.

### I2. Las familias del modelo

| Abstracta | Extiende | Entidades | Qué trae |
| --- | --- | --- | --- |
| `Audited` | — | 75 directas (148 con las de abajo) | `createdAt`, `createdBy`, `updatedAt`, `updatedBy` |
| `Catalog` | `Audited` | 23 de iot_catalog | `code` (64, requerido), `name`, `nameNormalized` |
| `Located` | `Audited` | 43 | `locationId` y la relación `location` (débil) a `Locations` |
| `LocatedCatalog` | `Located` | 7: Areas, Integrations, Parameters, ScheduledTaskCategories, ScheduledTasks, Subjects, Zones | `code`, `name`, `nameNormalized` |

Los rodeos que quedan en el modelo mientras λORM no los arregle (cada abstracta lo dice en un comentario):

- Cada hija repite `weak: true` en su relación `location` (L45).
- Cada hija de `Catalog` y `LocatedCatalog` repite su `primaryKey` (L46).
- Areas, Subjects y Zones repiten `{name: name, type: text, required: true}`.

### I3. El mapping de `Audited` una vez, ya

Hoy funciona (`L50 today`, `packages/lab-ilusor/tests/extends.spec.ts`): una entidad abstracta `Audited` en cada
mapping con sus columnas, y cada entidad del mapping con `extends: Audited`, toma `created_at`, `created_by`,
`updated_at`, `updated_by` y su `dbType`. Son 4 líneas por entidad que pasan a 1 (588 → 147, más una abstracta por
mapping). Lo que falta en λORM (L50) es no tener que repetir `extends` en el mapping. Verificar igual: el schema
completado antes y después, iguales (también los mappings).

## 3. Cuando λORM publique L45–L53

Pasar antes `docs/LAMBDAORM_PENDING.md` de Ilusor a core (como §8 de su `docs/LAMBDAORM_PENDING.md`, renumerando si
L45–L53 ya están tomados). Sus tests ya están en este repo: `packages/lab-ilusor/tests/extends.spec.ts` (`npm run
model`, sin Postgres), uno o dos por ítem, todos fallando hoy (`@lambdaorm/lib` 3.15.0, `base` 3.11.1).

| # | Qué cambia en el modelo de Ilusor |
| --- | --- |
| L45 | Quitar `weak: true` de las 50 relaciones `location` de las hijas |
| L46 | Quitar `primaryKey` de las 30 hijas de `Catalog` y `LocatedCatalog` |
| L47 | Abstractas para las constraints repetidas: el `color` hex de las 6 *ThresholdBands* y `periodUnit` / `periodValue > 0` de las 5 *RateThresholds* |
| L48 | Con `extends: [Audited, Located]`: un `Located` sin auditoría para las 25 entidades de iot_location que no la tienen (bindings, vértices, contextos, `DeviceLinks`…) |
| L50 | Quitar el `extends: Audited` de las 147 entidades de los mappings (I3) |
| L52 | Mover `Audited`, `Catalog`, `Located` y `LocatedCatalog` a `domain.abstracts` |

Cada paso, verificado igual: el schema completado antes y después, iguales. Fijar la versión de `@lambdaorm/base` de
la imagen que use Ilusor.

## 4. Pasar a la gateway 5.0

La 5.0 (rama `feature/credential-context`, sin publicar) no arranca con la configuración de hoy de Ilusor
(`cloud/data-gateway/data-gateway.config.yaml`): los permisos van solo por roles.

- Pasar las tres claves a roles de `authorization.roles`: `reader` (`read`), `operator` (`read`, `write`, `script`) y
  `modeler` (`read`, `write`, `script`, `schemaRead`, `schemaWrite`, `schemaAdmin`, `workbenchWrite`, `ddl`, `build`,
  `sessionAdmin`); cada clave nombra sus `roles` en vez de sus `permissions`.
- `Audited` usa `context.username` (`createdBy`, `updatedBy`): hace falta una clave por usuario con su `context`
  (`{ username }`); con claves compartidas, todos los cambios quedan a nombre de la clave.
- Si el modeler tiene que administrar la gateway desde el IDE: los permisos nuevos que correspondan (`roles`,
  `persist`, `observability`).
- Cambiar la imagen de `docker-compose.override.yml` a la 5.0 cuando se publique.

## 5. Otros avisos

- El lab de este repo falla en *model ilusor* (`npm run model`): 8 relaciones del modelo real que no emparejan
  `locationId` — `GalleryVectors.sample`, `RecognitionVectors.sample`, `ScanJobs.scan` / `areaScans`, `AreaScans.job` /
  `scanJobs`, `BiometricSamples.galleryVectors`, `DeviceStateSamples.recognitionVectors`: una fila llega a la de otra
  location (y Postgres lee todas las particiones). Es del modelo de Ilusor, no de λORM.
- `ed3e5ee0` y los 45 commits de `feat/data-gateway` no tienen upstream.
- La rama tiene muchos cambios sin commitear (`ci/deploy`, `local-*`, `cloud/docker-compose.yml`…), aparte de esto.
