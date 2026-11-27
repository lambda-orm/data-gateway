# JWT / OIDC (G1)

> **Estado (2026-11-25): decisiones de §8 cerradas (las recomendadas, el usuario); fases 1 a 5 hechas** (rama
> `feature/jwt`); falta la wiki (fase 6). La conformidad usa HS256 con un secreto de la suite; el criterio de un IdP
> real (Keycloak) queda para el lab.
> G1 de [`PENDINGS.md`](PENDINGS.md) §3 (brecha 1.1 del
> análisis de core). Sigue a R2: hoy la gateway **borra** `view` y `context` de lo que manda el cliente y λORM corre sin
> ellos; con G1 el contexto sale de la identidad (y con G2, la vista).

## 1. Objetivo

Que un usuario (o un servicio) llegue con un **token de su proveedor de identidad** (Keycloak, Auth0, Entra ID, Cognito,
Google…) y la gateway:

- **lo valide** sin llamar al proveedor en cada pedido: firma con las claves públicas del emisor (JWKS, con caché y
  rotación), emisor, audiencia, vencimiento;
- **sepa quién es y qué puede**: el principal con su nombre y sus permisos, sacados de los claims;
- **le dé a λORM su contexto**: `context.tenant = token.tenant_id`, para los filtros de fila de las vistas (C2), los
  defaults, las condiciones y el `forward` de las fuentes Http (C7), que ya leen `context`.

Hoy la autenticación es `adapter: none` o `local` con una lista fija de claves (`bearer`, `apikey`, `basic`): sirve para
servicios, no para usuarios de un IdP. Desde 5.0.0 una clave local puede decir su contexto, fijo (`context: { username:
ana@acme.com }`, ver §4); sin él, no da contexto.

## 2. Configuración

```yaml
authorization:
  roles:                                                  # los roles que nombra el claim (docs/ROLE_SCOPES.md)
    reader: [read]
    backend: [read, write, script, queue]
    admin: [read, write, script, queue, stageImport, ddl, schemaRead, schemaWrite]
authentication:
  adapter: jwt
  issuer: https://auth.example.com/realms/ilusor          # iss; con él se descubre el jwksUri (OIDC discovery)
  audience: data-gateway                                  # aud (uno o una lista)
  jwksUri: https://auth.example.com/…/certs               # opcional: si falta, el de /.well-known/openid-configuration
  algorithms: [RS256, ES256]                              # por defecto RS256, ES256, PS256 (nunca none)
  clockTolerance: 30s
  principal:
    name: preferred_username                              # el claim del nombre (por defecto sub)
    permissions:
      claim: realm_access.roles                           # una lista (o un texto separado por espacios, como scope)
  context:                                                # claim → variable del contexto de λORM
    tenant: tenant_id
    region: address.region
```

- Con claves locales al lado (decisión 1), en orden; el primero que reconoce la credencial decide (un JWT mal firmado
  no se prueba como clave, una clave mal escrita no se prueba como token):

  ```yaml
  authentication:
    methods:
      - { adapter: jwt, issuer: https://auth.example.com/realms/ilusor, audience: data-gateway, … }
      - { adapter: local, type: apikey, keys: [ { name: billing, value: '${BILLING_KEY}', roles: [backend] } ] }
  ```

- Los roles del claim son los de `authorization.roles` (docs/ROLE_SCOPES.md): un rol del token que no está ahí no da
  nada. Desde 5.0.0 es el único lugar: `roles` dentro del método es un error de configuración. Un rol dice sus
  permisos; uno sin lista es un error (nunca *todos*).
- Como hoy, por schema: `orm.schemas[].authentication` reemplaza a la global.
- Un secreto compartido (HS256), solo para desarrollo y tests: `secret: ${JWT_SECRET}` (siempre de una variable).

## 3. Cómo llega el token, por transporte

| Transporte | Dónde | Hoy |
| --- | --- | --- |
| REST (`http`), MCP (`mcpHttp`) | `Authorization: Bearer <token>` | igual que el `bearer` local |
| WebSocket, MCP WebSocket | `Authorization` en el upgrade, o el subprotocolo (un navegador no manda headers) | igual que el `bearer` local (`protocolCredential`) |
| `management` | `POST /sessions` con el token; la sesión vale hasta `min(idle, exp del token)` | la sesión vale hasta su `maxLifetime` |

Una conexión larga (WebSocket, MCP) se corta cuando vence el token (código 4401), como una sesión revocada.

## 4. El principal y el contexto

- **Nombre:** el claim de `principal.name` (por defecto `sub`). Es el `credential` del actor, de la auditoría y de las
  métricas.
- **Permisos:** los de los roles del claim, unidos. Un token válido sin ningún rol conocido no tiene permisos (403 en
  todo, no 401).
- **Contexto:** cada variable de `context` toma el valor del claim (una ruta con puntos). Viaja con el principal al
  worker del schema (como hoy el actor) y `requestOptions` lo pone en `options.context`: el cliente sigue sin poder
  mandarlo (R2). Un claim que falta deja la variable sin valor: si una vista la necesita, λORM responde
  `ContextError` (400).
- **Contexto de una clave local** (5.0.0): una entrada de `keys`, `tokens` o `users` puede tener `context` (variable →
  texto, número o booleano), el que tendría el token de esa persona: `context: { username: ana@acme.com }` llena el
  `default: context.username` o el `writeValue` de un schema. Viaja igual que el de un token (también a una sesión
  abierta con la clave) y el cliente tampoco puede reemplazarlo. Una clave sin `context` no da ninguno.

## 5. Errores

- **401** con el motivo en `reason`: `expired`, `not yet valid`, `signature`, `issuer`, `audience`, `malformed`,
  `algorithm`, `unknown key`; y `WWW-Authenticate: Bearer error="invalid_token"`.
- El emisor que no responde (JWKS caído y sin claves en caché): **503**, no 401.
- **El token nunca** en logs, auditoría, spans ni errores: solo su `sub`, su `iss` y su `jti` si lo hay.

## 6. Librería

[`jose`](https://github.com/panva/jose) (MIT, sin dependencias, la que usan los SDK de los IdP): `jwtVerify`,
`createRemoteJWKSet` (caché, rotación: una clave nueva por `kid` desconocido refresca, con un mínimo entre refrescos).

## 7. El IDE y el cliente

- **IDE:** la autenticación de una connection suma *Bearer token (JWT)*: se pega el token; al vencer, el IDE lo dice y
  pide otro. (Login con el IdP desde el IDE, con PKCE, queda fuera: decisión 5.)
- **Cliente Node** (`@lambdaorm/data-gateway-client-node`): ya manda `Authorization: Bearer`; suma una función que da el token
  en cada pedido (para refrescarlo).

## 8. Decisiones

| # | Tema | Recomendación | Alternativa |
| --- | --- | --- | --- |
| 1 | JWT y claves locales | **Juntas**: `authentication.methods: [jwt, local]`, el primero que reconoce la credencial decide (un servicio sigue con su API key, los usuarios con su token) | Solo una por schema (más simple; un servicio necesitaría un token del IdP) |
| 2 | De dónde salen los permisos | **Roles del claim → permisos en la configuración** (el IdP no sabe de `stageImport`) | Los permisos tal cual en un claim (`dg_permissions`) |
| 3 | Claims → contexto | **Rutas con puntos** (`tenant: tenant_id`) | Expresiones 3xpr sobre los claims (más poder, más superficie) |
| 4 | Token vencido en una conexión larga | **Cortarla al vencer** (4401) | Dejarla hasta que se cierre |
| 5 | Login con el IdP desde el IDE (PKCE) | **Después** (fase 2): primero pegar el token | Ahora |
| 6 | `jwksUri` | **Descubrirlo** del `issuer` si falta | Siempre explícito |

## 9. Fases

1. `JwtAuthenticator` (jose) + configuración y validación + errores; tests con claves generadas (RS256, ES256) y un
   JWKS servido por el test (rotación, `kid` desconocido, caída).
2. Principal: nombre, permisos por rol, contexto; el contexto al worker y a `requestOptions`; el actor.
3. Transportes: WebSocket (vencimiento), `management` (la sesión hasta `exp`), `methods` (decisión 1).
4. IDE (Bearer token) y cliente Node (token dinámico).
5. Conformidad: un IdP de prueba en el compose (o un JWKS estático) y los casos por transporte.
6. Wiki (cuatro idiomas): la página de autenticación.

## 10. Criterios de aceptación

- Un token válido de un IdP real (Keycloak en el compose de la conformidad) ejecuta según sus roles en los cinco
  transportes; uno vencido, de otra audiencia o con otra firma, 401 con su motivo.
- `context.tenant` del token llega a λORM: una vista con filtro de fila por `tenant` devuelve solo las filas de ese
  tenant, y un `context` mandado por el cliente sigue sin llegar.
- La rotación de claves del IdP no corta el servicio.
- Ningún token en logs, auditoría ni spans.
