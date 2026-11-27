# El estado de la gateway: un schema de λORM propio

> **Estado (2026-11-26): decisiones de §8 cerradas (las recomendadas, el usuario); fases 1 a 4 hechas** (rama
> `feature/gateway-state`). Lo que cambió respecto del diseño:
> - **SQLite sigue en `node:sqlite`, no en λORM.** El dialecto SQLjs de λORM tiene la base en memoria y la escribe al
>   archivo solo al cerrar el pool: una caída pierde lo de la corrida y dos workers se pisan. `SqlLite` está en el enum
>   de λORM sin adaptador. Con `dialect: SQLite` la gateway usa `node:sqlite` (durable, seguro entre procesos); con
>   PostgreSQL (o MySQL, MariaDB, SqlServer, Oracle), el schema de sistema por λORM. Cuando core tenga un SQLite nativo,
>   SQLite puede pasar también por λORM (§7 de [`PENDINGS.md`](PENDINGS.md)).
> - **Sin migraciones versionadas todavía:** al arrancar, `push` del schema de sistema (crea lo que falta, agrega
>   columnas; nunca borra). Dos réplicas a la vez: la segunda reintenta y no encuentra nada que crear.
> - **`Settings` (valores en caliente) queda para cuando haya una opción que lo use;** hecho: `Roles`, `ConfigChanges`,
>   `StateVersions`, y las sesiones, el estado de la UI y las aprobaciones en el mismo schema.
> - **Entre réplicas, por versión cada `state.refresh`** (30 s); el aviso por Valkey, después. En la réplica que guarda,
>   al instante.
>
> Probado: los mismos almacenes en `node:sqlite`, λORM sobre SQLjs y λORM sobre PostgreSQL
> (`tests/integration/gatewayState.test.ts`, con `DATA_GATEWAY_TEST_POSTGRES`).

## 1. Objetivo

La gateway guarda cada vez más cosas propias: las sesiones del IDE y de la administración, el estado de la UI de cada
credencial, las escrituras que esperan aprobación y, ahora, los roles. Hoy van a un SQLite del volumen
(`<orm.workspacePath>/.data-gateway/state.sqlite`, con `node:sqlite` y SQL escrito a mano, una tabla por store), que:

- con varias réplicas solo sirve si comparten el volumen, y SQLite sobre un volumen de red (NFS, EFS, Azure Files) no es
  confiable: sus locks no se respetan;
- no tiene migraciones: cada store hace su `CREATE TABLE IF NOT EXISTS`, y cambiar una columna no tiene camino;
- no sirve para configuración que se cambia en caliente y tiene que llegar a todas las réplicas.

La propuesta: **un schema de λORM propio de la gateway** (el *schema de sistema*), con su fuente en la configuración:
SQLite (sql.js) para una sola instancia, PostgreSQL (o cualquier dialecto relacional de λORM) para varias. Ahí va todo
el estado de la gateway: lo que hay hoy y la configuración que vaya surgiendo.

## 2. La configuración

```yaml
# data-gateway.config.yaml
state:
  source:
    dialect: SQLite                                   # una sola instancia: un archivo, sin servidor
    connection: { file: /data/.data-gateway/state.sqlite }
  # varias instancias:
  # source:
  #   dialect: PostgreSQL
  #   connection: ${DATA_GATEWAY_STATE_URL}           # postgres://user:pass@host:5432/gateway
  #   schema: data_gateway                            # opcional: las tablas en un schema propio de la base
  refresh: 30s                                        # sin Valkey: cada cuánto una réplica mira si cambió algo
```

- **Sin `state`:** SQLjs en `<orm.workspacePath>/.data-gateway/state.sqlite` (el archivo de hoy, ver §6); sin
  `workspacePath`, en memoria (como hoy las sesiones y las aprobaciones).
- **Varias réplicas y SQLite:** con `cluster.valkey` (la señal de que hay réplicas, [`REPLICAS.md`](REPLICAS.md)) y una
  fuente SQLite, la configuración da un **error**: varias réplicas sobre un SQLite pierden datos.
- Los secretos de la conexión, de variables (`${…}`), enmascarados en `/admin/config` como las demás.

## 3. El schema de sistema

No es un workspace: su `lambdaORM.yaml` viene **dentro de la gateway** (en su código, versionado con ella), y lo que
cambia de una instalación a otra es solo la fuente.

| Regla | Por qué |
| --- | --- |
| **Interno:** sin rutas de datos (REST, WebSocket, MCP, GraphQL), no aparece en `/schemas` ni en el IDE como un schema | Nadie lo consulta ni lo escribe con `execute`: solo los casos de uso de la gateway |
| **Sin autorización:** la gateway lo lee y lo escribe como ella misma, sin vista ni credencial | No depende de lo que autoriza (si no, para saber quién puede leer los roles habría que leer los roles) |
| **Arranca primero:** conectar, migrar, cargar; después se componen los schemas de los usuarios | Los roles y la configuración tienen que estar antes del primer pedido |
| **Un modelo chico:** entidades simples, sin relaciones entre fuentes, sin vistas, sin `forward` | Un bug de λORM en un rincón complejo no puede tocar la autorización; lo que usa, la conformidad lo prueba |
| **Migraciones de λORM** (`infrastructure.migrations`, C10): cada release de la gateway trae las suyas y se aplican al arrancar | Cambiar una entidad tiene camino; una réplica vieja no rompe las tablas de una nueva (§7) |

### Las entidades

Entidades tipadas para lo que tiene forma propia, y una genérica para los valores de configuración:

| Entidad | Qué guarda | Hoy |
| --- | --- | --- |
| `Roles` | los roles agregados o extendidos desde la administración ([`ROLE_SCOPES.md`](ROLE_SCOPES.md)) | — |
| `Settings` | un valor de la configuración cambiado en caliente: `scope` (`global` o un schema), `key` (el camino, `cache.ttl`, `mcp.maxRows`…), `value` (JSON) | — |
| `ConfigChanges` | cada cambio de `Roles` y `Settings`: quién, cuándo, el valor anterior y el nuevo, el motivo | — |
| `Sessions`, `SessionConnections` | las sesiones de `management` (el hash del token, nunca el token) | `sessions`, `session_connections` |
| `UiStates` | el estado de la UI de cada credencial | `session` |
| `Approvals` | las escrituras que esperan una persona | `approval` |
| `StateVersion` | un número por área (`roles`, `settings`): sube con cada cambio; las réplicas lo comparan | — |

Más adelante, cuando hagan falta: claves de API creadas desde la administración (su hash, sus permisos, su rol),
la historia de los schemas (hoy en `changes.jsonl` de los logs de cada workspace), lo que la gateway necesite
recordar.

`Settings` existe para no necesitar una migración por cada opción nueva: una opción de la configuración que se puede
cambiar en caliente se declara en el código (su camino, su tipo, su validación) y su valor va a `Settings`. Una
opción con estructura propia (los roles) tiene su entidad.

## 4. El YAML y la base: quién gana

La configuración efectiva de un área es **el YAML extendido por la base**:

1. **El YAML es la base.** Lo define quien despliega; la administración no lo borra ni lo cambia. Si la base se pierde,
   la gateway sigue con el YAML.
2. **La base extiende:** agrega (un rol nuevo, un valor que el YAML no dice) o cambia lo que el YAML deja cambiar.
3. **`locked`:** un rol o un valor del YAML marcado `locked: true` no se extiende ni se cambia desde la base (para lo
   crítico: el rol `admin`, `authentication`, `transports`).
4. **Lo que nunca va a la base:** `authentication` (los emisores, las claves locales del YAML), `transports`, `state`
   mismo, `cluster`. Cambiar cómo se autentica o por dónde se escucha es del despliegue.

Cada cambio desde la administración se valida como el YAML (los mismos chequeos de `ConfigReader`), se guarda con su
`ConfigChanges` y sube la versión de su área. **Volver atrás:** aplicar el valor anterior de un `ConfigChanges` (un
cambio más, también registrado).

## 5. Entre réplicas

- **Con Valkey:** el que guarda publica `<prefix>:state` con el área y la versión; cada réplica recarga esa área.
- **Sin Valkey:** cada réplica lee `StateVersion` cada `refresh` (30 s) y recarga lo que cambió. Una sola instancia no
  tiene a quién avisar: recarga al guardar.
- Hasta recargar, una réplica atiende con lo anterior: un rol quitado puede valer hasta `refresh` más (con Valkey,
  instantes). Las sesiones y las aprobaciones no tienen ese problema: se leen de la base en cada pedido, como hoy.

## 6. De `state.sqlite` al schema de sistema

- La fuente por defecto **es el mismo archivo** (`.data-gateway/state.sqlite`): la primera migración del schema de
  sistema crea sus tablas y **copia** lo que haya en las de hoy (`session`, `sessions`, `session_connections`,
  `approval`); las viejas quedan hasta la versión siguiente, por si hay que volver.
- Una fuente nueva (Postgres) empieza vacía: las sesiones abiertas se pierden (se vuelve a iniciar sesión) y las
  aprobaciones pendientes quedan en el archivo viejo. Opcional: `data-gateway state copy --from <archivo>`.
- Los stores de hoy (`SqliteSessionStore`, `SqliteApprovalStore`, `SqliteSessionState`) se reemplazan por
  implementaciones de los mismos ports sobre el schema de sistema; sus casos de uso no cambian.

## 7. Si la fuente falla

- **Al arrancar, sin conexión:** la gateway arranca con el YAML solo (sin los roles ni los valores de la base), lo dice
  en `/health` (`state: unavailable`, `503` en `/health/ready` si `state.required: true`) y reintenta. **Nunca da más
  permisos de los que da el YAML**: un rol de la base que no se pudo leer no existe.
- **Las sesiones y las aprobaciones sin base:** iniciar sesión en `management` y aprobar dan `503` hasta que vuelva.
- **Una base de una versión más nueva** (otra réplica ya migró): si el schema que encuentra es más nuevo que el suyo,
  la réplica no migra hacia atrás; arranca si las migraciones nuevas son compatibles (solo agregan), si no da error.
  Las migraciones del schema de sistema solo agregan dentro de una versión mayor.

## 8. Decisiones

| # | Tema | Recomendación | Alternativa |
| --- | --- | --- | --- |
| 1 | El motor del estado | **Un schema de λORM propio** con su fuente en `state.source` (cualquier dialecto relacional) | Un driver propio por base (`node:sqlite` y `pg`) |
| 2 | La fuente por defecto | **SQLjs en el archivo de hoy** (`.data-gateway/state.sqlite`) | En memoria hasta que se configure |
| 3 | Varias réplicas con SQLite | **Error** al leer la configuración (con `cluster.valkey`) | Aviso |
| 4 | Cómo se modela la configuración | **Entidades tipadas + `Settings` genérica** (clave, valor JSON) | Solo entidades tipadas (una migración por opción) |
| 5 | El YAML y la base | **El YAML es la base, la base extiende; `locked` lo impide** | La base reemplaza al YAML |
| 6 | Qué nunca va a la base | **`authentication`, `transports`, `state`, `cluster`** | Todo editable |
| 7 | Sin la fuente al arrancar | **Arranca con el YAML solo y lo avisa** (`state.required` para no arrancar) | No arrancar |
| 8 | Entre réplicas | **Valkey si está; si no, `StateVersion` cada `refresh`** | Siempre leer de la base |
| 9 | Las sesiones y aprobaciones de hoy | **Al schema de sistema en la misma serie**, copiadas del archivo | Dejarlas en `node:sqlite` |

## 9. Fases

1. El schema de sistema: su `lambdaORM.yaml` interno, `state.source`, arrancar primero, las migraciones; la validación
   (SQLite con réplicas).
2. Sesiones, estado de la UI y aprobaciones sobre él (los mismos ports), la copia de `state.sqlite`; pruebas en SQLite y
   PostgreSQL.
3. `Settings`, `ConfigChanges`, `StateVersion`; la recarga entre réplicas (Valkey y `refresh`); `/health`.
4. Los roles ([`ROLE_SCOPES.md`](ROLE_SCOPES.md)).
5. La administración y el IDE: ver y cambiar la configuración en caliente, su historia, volver atrás.

## 10. Criterios de aceptación

- Una gateway sin `state` funciona como hoy y conserva sus sesiones y aprobaciones (copiadas del archivo).
- Dos réplicas con `state.source` en PostgreSQL ven las mismas sesiones, aprobaciones, roles y valores; un cambio en
  una llega a la otra (con Valkey al instante, sin él en `refresh`).
- Con la base caída la gateway arranca con el YAML y no da ningún permiso de más.
- La integración en SQLite y en PostgreSQL; `scripts/ci-local.sh check` y `clients`.
