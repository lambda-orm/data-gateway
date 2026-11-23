# Sesiones de `management`

> **Estado (2026-11-23): fases 1 a 4 hechas** (rama `feature/management-sessions`); falta la documentación de usuario (fase 5). Sigue a [`DATA_GATEWAY.md`](DATA_GATEWAY.md) §12 (el transporte
> `management`), que lo resume en §12.1. Aplica igual al IDE web (la imagen) y al de escritorio
> ([`DATA_GATEWAY_IDE_DESKTOP_PLAN.md`](DATA_GATEWAY_IDE_DESKTOP_PLAN.md)). Las decisiones de §9 están cerradas (el
> usuario, 2026-11-23).

## 1. Objetivo

Tener control sobre quién usa `management`:

- **saber quién está conectado** ahora: qué credencial, desde dónde, desde cuándo y qué está haciendo;
- **listar las sesiones**, las propias y, con permiso, las de todos;
- **cortar una sesión** al instante, o todas las de una credencial.

Hoy `management` autentica cada pedido con la clave (`X-Api-Key`, `Bearer`, `Basic`). No hay "conexión": no se puede
saber quién está ni cortar a nadie, solo rechazar su próximo pedido cambiando la clave en la configuración.

## 2. El modelo

| Pieza | Qué da |
| --- | --- |
| **Sesión** | el login con la credencial devuelve un token; desde ahí, todo pedido a `management` lleva el token, no la clave. La sesión es lo que se lista y se revoca |
| **HTTP** | todas las operaciones, como hoy (con `ETag`, `If-Match`, códigos de estado, descargas) |
| **WebSocket de eventos** | la presencia (una sesión con su WebSocket abierto está *conectada*), el corte inmediato y las notificaciones que reemplazan el polling |

Cortar el WebSocket solo no alcanza para echar a alguien: el IDE reconectaría con la misma clave. Revocar la **sesión**
sí: su WebSocket se cierra y su próximo pedido HTTP responde `401`; para volver tiene que hacer login otra vez. Para que
no pueda volver, la clave se cambia en la configuración (y se revocan sus sesiones).

Las sesiones son solo de `management`. Los transportes de datos (`http`, `webSocket`, MCP) siguen autenticando cada
pedido con la clave: sus clientes son programas, no personas en un IDE. Las pestañas REST, WebSocket y MCP del IDE usan
la clave de la connection, como hoy.

## 3. API

Todo en `management`, bajo `{basePath}`:

| Método | Ruta | Hace | Permiso |
| --- | --- | --- | --- |
| `POST` | `/sessions` | **login**: la credencial en sus cabeceras de siempre → `201 { id, token, credential, permissions, createdAt, idleTimeoutMs, expiresAt }` | cualquier credencial válida |
| `GET` | `/sessions/current` | la sesión del token (renueva la inactividad) | la sesión |
| `DELETE` | `/sessions/current` | **logout** | la sesión |
| `GET` | `/sessions` | las sesiones de la misma credencial; con `?all=true`, todas | la sesión; `all` necesita `sessionAdmin` |
| `DELETE` | `/sessions/{id}` | revoca una sesión | la propia credencial, o `sessionAdmin` |
| `DELETE` | `/sessions?credential={nombre}` | revoca todas las de una credencial (con `&except=current`: "cerrar las otras") | la propia credencial, o `sessionAdmin` para otra |

- **El token** va en `X-Data-Gateway-Session: <token>`. En el WebSocket, que no puede mandar cabeceras desde un
  navegador, en el subprotocolo `lambdaorm.session.<token>`, como la credencial de §7 de `DATA_GATEWAY.md`.
- **El `id`** de una sesión es público (se lista, se revoca por él); **el token** es secreto y no se lista nunca.
- **Solo sesiones** (D6): en `management`, todo pedido salvo `POST /sessions`, `/health` y `/ping` necesita una sesión.
  Una clave directa responde `401 SessionRequiredError` ("haga login en POST /sessions"). Un script hace login primero.
- **Errores:** `401 SessionExpiredError` (venció por inactividad o duración), `401 SessionRevokedError` (con quién y
  cuándo la revocó), `401 SessionRequiredError`. El IDE distingue los tres.

Una sesión listada:

```json
{
  "id": "s_7Hq2…",
  "credential": "modeler",
  "current": false,
  "createdAt": "2026-11-23T10:02:11Z",
  "lastSeenAt": "2026-11-23T10:41:57Z",
  "expiresAt": "2026-11-23T22:02:11Z",
  "connected": true,
  "ip": "10.8.0.14",
  "client": { "app": "data-gateway-ide", "version": "1.1.0", "kind": "web", "userAgent": "Mozilla/5.0 …" },
  "activity": { "schema": "ilusor", "tab": "schema:ilusor" }
}
```

- `connected`: su WebSocket de eventos está abierto (en alguna réplica, §6).
- `client`: lo dice el IDE en el login (`kind`: `web` o `desktop`); `userAgent` es el del navegador o de Electron.
- `activity`: lo que el IDE cuenta por el WebSocket (§4); orientativo, no es auditoría.

## 4. El WebSocket de eventos

`ws(s)://…{basePath}/events`, en el puerto de `management`, autenticado con la sesión en el upgrade. Solo empuja
eventos (JSON-RPC 2.0 sin `id`, como las notificaciones de `DATA_GATEWAY.md` §7); el IDE no pide operaciones por ahí,
salvo contar su actividad.

| Evento | Cuándo |
| --- | --- |
| `session.revoked` | revocaron esta sesión: `{ by, at }`; la gateway cierra el socket enseguida (`4401`) |
| `session.expiring` | faltan 2 minutos para que venza por su duración máxima: el IDE avisa (y, con la clave recordada, hace login otra vez sin molestar) |
| `schema.statusChanged` | un esquema pasó a `ready` / `error` / `restarting`, o quedó `pending` (reemplaza releer `/schemas` cada 5 s) |
| `workspace.changed` | cambió algo en un workspace: `{ path, kind, files?, at }` (reemplaza releer `workbench/` con `ETag`) |

- Del IDE a la gateway: `session.activity` `{ schema?, tab? }` cuando cambia lo que se está mirando, como mucho cada
  10 s. Llena `activity` de la sesión.
- **Ping** cada 25 s (por los proxies que cortan una conexión inactiva). Un socket sin pong en 60 s se cierra y la
  sesión pasa a `connected: false`.
- **Inactividad:** el WebSocket abierto no renueva la sesión; solo los pedidos HTTP. Una pestaña abierta y olvidada
  vence a los 30 minutos (D3).
- **Si no conecta**, o se corta, el IDE vuelve al polling de hoy y reintenta con espera creciente. Nada deja de
  funcionar.
- Los jobs (`push`, `import`, …) siguen consultándose como hoy (D9).

## 5. Configuración

```yaml
transports:
  management:
    port: 9090
    trustedProxies: [ 172.30.98.32/28 ]   # de dónde se acepta X-Forwarded-For (el IDE web)
    sessions:
      idleTimeout: 30m          # sin pedidos HTTP
      maxLifetime: 12h          # desde el login
      maxPerCredential: 0       # 0 = sin límite; al superarlo, el login cierra la más vieja de esa credencial
      store: auto               # auto: <orm.workspacePath>/.data-gateway/state.sqlite; memory: solo esta réplica
```

| Clave | Por defecto | Notas |
| --- | --- | --- |
| `sessions.idleTimeout` | `30m` | D3 |
| `sessions.maxLifetime` | `12h` | D3 |
| `sessions.maxPerCredential` | `0` | D8: sin límite; con límite, cierra la más vieja (con `session.revoked`, `by: "limit"`) |
| `sessions.store` | `auto` | sin `orm.workspacePath`, `memory` (aviso: con varias réplicas, cada una tiene las suyas) |
| `trustedProxies` | `[]` | D7: IPs o redes (CIDR); de ellas se toma la IP de `X-Forwarded-For`; de las demás, la de la conexión |

## 6. Dónde se guardan, y varias réplicas

- **SQLite**, en el `state.sqlite` donde ya se guarda dónde estaba la UI (`DATA_GATEWAY.md` §11.8), tabla `sessions`:
  `id`, el **hash** del token (SHA-256: un token robado del volumen no sirve), la credencial, las fechas, IP, cliente,
  actividad, `revokedAt`/`revokedBy`. Una sesión vencida o revocada se borra a las 24 h (queda en la auditoría).
- **Validar** un pedido es leer la fila por el hash del token. `lastSeenAt` se escribe como mucho una vez por minuto
  por sesión, no en cada pedido.
- **Presencia entre réplicas:** cada réplica escribe, cada 15 s, en `session_connections` sus sockets abiertos
  (`sessionId`, réplica, `seenAt`). Una sesión está `connected` si alguna réplica la vio hace menos de 45 s.
- **Revocar entre réplicas:** revocar escribe `revokedAt`. Cada réplica revisa cada 5 s las revocadas que tienen un
  socket suyo y los cierra. El HTTP lo ve en el pedido siguiente, en cualquier réplica.
- La sesión de la UI (`GET`/`PUT /admin/session`, dónde estaba cada persona) sigue siendo por **credencial**: dos
  sesiones de la misma credencial comparten dónde estaban, como hoy.

## 7. Auditoría y log

- Login, logout, vencimiento, revocación (quién revocó a quién) y un login rechazado: una línea de auditoría cada uno
  (`DATA_GATEWAY.md` §8.1), con la credencial, la IP y el `id` de la sesión. Nunca el token.
- Métricas: `data_gateway_management_sessions{state="active|connected"}` y
  `data_gateway_management_logins_total{result}`.

## 8. En el IDE

### 8.1 La connection

- **Probar / Conectar** hace el login (`POST /sessions`) con la credencial de la connection y guarda el token **en
  memoria de la pestaña** (`sessionStorage`), nunca en `localStorage`. Todo pedido a `management` lleva el token.
- **Al vencer** (inactividad, duración máxima) con la clave a mano (recordada, o en la pestaña), el IDE hace login solo
  y repite el pedido (una vez); con `session.expiring`, antes de que venza. Sin la clave, la pide en la página de la
  connection.
- **Al ser revocada**, no vuelve a entrar solo, aunque tenga la clave (si no, revocar no serviría): dice el motivo
  ("la revocó *admin* a las 10:42", "se superó el límite de sesiones") y espera a que la persona guarde la connection
  otra vez.
- Las pestañas REST, WebSocket y MCP siguen usando la clave (son transportes de datos).
- El IDE manda en el login `client` (`data-gateway-ide`, su versión, `web` o `desktop`).

### 8.2 Las sesiones en la página de la connection

- **Mis sesiones:** las de la misma credencial (la actual marcada), con cliente, IP, conectada o no, última actividad y
  vencimiento; **Cerrar** una y **Cerrar las otras**.
- **Sesiones activas** (con `sessionAdmin`): todas, agrupadas por credencial, con lo que está mirando cada una;
  **Revocar** una, o **Revocar todas** las de una credencial (con confirmación). Se actualiza sola con los eventos.
- El encabezado de la connection muestra cuántas sesiones hay conectadas.

## 9. Decisiones

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| D1 | Dónde va | este plan, resumido en §12.1 de `DATA_GATEWAY.md`; el plan del escritorio lo referencia |
| D2 | Token | **opaco**, aleatorio (32 bytes), con su hash en SQLite: revocar es inmediato en todas las réplicas |
| D3 | Duración | **30 minutos de inactividad, 12 horas como máximo**, configurables |
| D4 | Quién ve y revoca todas | un permiso nuevo, **`sessionAdmin`**, nunca dado por defecto (como los de administración, `DATA_GATEWAY.md` §6.2) |
| D5 | Las propias | toda sesión ve las de su credencial y puede cerrarlas ("cerrar las otras") |
| D6 | Clave directa en `management` | **no**: solo sesiones (salvo el login, `/health` y `/ping`) |
| D7 | La IP del navegador | **`trustedProxies`**: `X-Forwarded-For` solo desde ellos; el proxy del IDE la agrega |
| D8 | Límite por credencial | `maxPerCredential`, **sin límite** por defecto; al superarlo, se cierra la más vieja |
| D9 | Eventos de la primera versión | **sesión** (`session.revoked`, `session.expiring`) y **estado** (`schema.statusChanged`, `workspace.changed`); los jobs, como hoy |
| D10 | Dónde en el IDE | en la **página de la connection**: Mis sesiones y, con `sessionAdmin`, Sesiones activas |

## 10. Fases

| Fase | Qué | Hecho cuando |
| --- | --- | --- |
| 1 ✅ | **Gateway:** la tabla `sessions` (puerto `SessionStorePort`, adaptador SQLite y en memoria), las rutas de §3, el middleware que exige la sesión en `management`, `sessionAdmin`, la configuración de §5, la auditoría | unitarios (vencimientos, límite, permisos) e integración (login, pedidos con token, `401` de cada tipo, revocar, clave directa rechazada) |
| 2 ✅ | **Gateway:** `/events` (presencia, `session.*`, `schema.statusChanged`, `workspace.changed`), presencia y revocación entre réplicas | integración con dos gateways sobre el mismo volumen: revocar en una cierra el socket de la otra |
| 3 ✅ | **IDE:** login, token por pestaña, re-login, motivos; eventos en lugar del polling; Mis sesiones / Sesiones activas | pruebas de la UI; en Ilusor, dos navegadores con la misma clave se ven y se cortan |
| 4 ✅ | **Proxy del IDE:** `X-Forwarded-For` (y el subprotocolo de la sesión, que ya pasa) | `server.test.mjs` |
| 5 | **Documentación:** `DATA_GATEWAY.md` §12.1 completo, el CHANGELOG (cambio que rompe: `management` exige sesión), la guía del IDE y "Configuration" en la wiki (cuatro idiomas) | `mkdocs build --strict` |

Es un cambio que rompe para quien llame a `management` con la clave directa: va en la misma 4.0.0 si sale antes de
publicarla; si no, en una major.

Cada fase en su rama `feature/`, Conventional Commits con `#96` (u otro ticket que indique el usuario),
`scripts/ci-local.sh check` antes de cada push, y el OK del usuario para publicar.

## 11. Criterios de aceptación

- [ ] `management` no acepta una clave directa: solo el login y una sesión.
- [ ] Con `sessionAdmin` se listan todas las sesiones, con credencial, IP real (detrás del IDE web), cliente, si está
      conectada y qué está mirando.
- [ ] Revocar una sesión cierra su WebSocket al instante y su próximo pedido HTTP responde `401 SessionRevokedError`,
      también con varias réplicas.
- [ ] Sin `sessionAdmin`, una credencial ve y cierra solo las suyas.
- [ ] Una sesión vence a los 30 minutos sin pedidos y a las 12 horas, y el IDE lo dice (o re-autentica con la clave
      recordada).
- [ ] El token nunca aparece en el log, la auditoría, la lista ni el volumen (solo su hash).
- [ ] Sin WebSocket, el IDE funciona con el polling de hoy.
