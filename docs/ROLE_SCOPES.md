# Los roles: sus vistas, sus stages y lo que pueden hacer

> **Estado (2026-11-26): decisiones de §9 cerradas (las recomendadas, el usuario); fases 1 a 4 hechas** (rama
> `feature/gateway-state`): `authorization.roles`, `orm.schemas[].roles` y `.stage`, `roles` en las claves; la vista y
> el stage elegidos en la fachada de cada schema (el edge pone los grants del principal: sabe el schema); `/whoami` con
> lo que puede elegir; `allowDestructive` es el permiso `destructive`; las rutas `/admin/roles` y el panel **Roles de la
> gateway** del IDE; en sus opciones, la vista cuando hay más de una. Un detalle que cambió: primero se elige el stage y
> después la vista entre los roles que permiten ese stage (si no, un rol de otro stage podía decidir la vista y dejar el
> pedido sin permisos). Probado de punta a punta (`tests/integration/roleScopes.test.ts`, el IDE en Chrome). Sobre el
> estado de la gateway
> ([`GATEWAY_STATE.md`](GATEWAY_STATE.md)): los roles del YAML, extendidos desde la administración. Cierra lo que R2
> ([`PENDINGS.md`](PENDINGS.md)) dejó sin decidir: si el cliente elige `stage`, `maxRows` y `allowDestructive`.

## 1. Objetivo

Hoy un rol (de los tokens de un emisor) o una clave local da **permisos**, **una vista** y `approval`
([`VIEWS_BY_IDENTITY.md`](VIEWS_BY_IDENTITY.md), [`MUTATION_APPROVAL.md`](MUTATION_APPROVAL.md)). El **stage** lo elige
el cliente sin control (`options.stage`, cualquiera del schema), igual que `maxRows` y `allowDestructive`.

La propuesta: un rol dice **dónde** puede trabajar (las vistas y los stages permitidos, y cuáles por defecto) y
**qué** puede hacer ahí (los permisos y sus límites). El cliente elige solo dentro de eso.

Es de la gateway, no de core: λORM define qué existe (las vistas, sus filtros por el contexto, los stages); quién
recibe qué depende del despliegue (el IdP, sus roles, las claves) y de acciones que λORM no conoce (`script`,
`approve`, `ddl`, los transportes).

## 2. La configuración

Los roles salen de cada método de autenticación y pasan a un lugar propio, `authorization.roles`, que usan los tokens
(por el nombre del rol en su claim) y las claves locales (por `roles`):

```yaml
authorization:
  roles:
    support:
      schemas: [shop]                  # dónde vale; sin schemas, en todos
      views: [support, public]         # la primera, la de quien no elige
      permissions: [read]
    analyst:
      views: [analytics, support]
      stages: [default, reporting]     # sin stages: solo el del schema
      permissions: [read]
      maxRows: 5000                    # el cliente puede pedir menos, nunca más
    backend:
      permissions: [read, write]       # sin views: la del schema
    operator:
      stages: [default, staging]
      permissions: [read, ddl, destructive]
    admin:
      permissions: [read, write, script, schemaRead, schemaWrite, roles]
      locked: true                     # no se extiende desde la administración
authentication:
  methods:
    - adapter: jwt
      issuer: https://auth.example.com/realms/shop
      principal:
        permissions: { claim: realm_access.roles }   # los nombres del claim son los de authorization.roles
    - adapter: local
      type: apikey
      keys:
        - { name: billing, value: '${BILLING_KEY}', roles: [backend] }
orm:
  schemas:
    - path: shop
      view: public                     # la vista del schema (como hoy)
      stage: default                   # el stage del schema
```

- **Un rol es del gateway (5.0.0):** dice en qué schemas vale (`schemas: [shop, sales]`, sus rutas; sin `schemas`, en
  todos) y en otro no da nada. `orm.schemas[].roles` ya no existe (la gateway no arranca y el error dice que va en
  `authorization.roles` con `schemas`): si en dos schemas un rol necesita otros permisos o vistas, son dos roles.

- **Un solo camino (5.0.0):** los permisos, las vistas, los stages y la aprobación los dice un rol. Una clave (o un
  token local, o un usuario basic) solo nombra sus `roles` (obligatorio) y puede decir su `context`; un método `jwt`
  solo dice el claim de los roles (`principal.permissions.claim`). Con `permissions`, `view` o `approval` en una clave,
  o `roles` dentro de un método `jwt`, la gateway no arranca y el error dice dónde van. `view` en un rol sigue siendo
  `views: [view]`.
- Un rol que no dice `views` tiene la vista del schema; uno que no dice `stages`, el stage del schema. Así una
  instalación de hoy no cambia de comportamiento.
- Un nombre de `views` o `stages` que el schema no tiene: aviso al cargar y `403` en el pedido (como hoy la vista).

## 3. Qué elige el cliente

En las `options` de cualquier operación (REST, WebSocket, MCP, scripts, `plan`, `metadata`…), como hoy:

| Opción | Hoy | Con esto |
| --- | --- | --- |
| `view` | la borra la gateway | **elige entre las de sus roles**; fuera de ellas, `403` |
| `stage` | la que quiera | **elige entre las de sus roles**; fuera de ellas, `403` |
| `maxRows` | el que quiera | **solo menor o igual** al de su rol (o el del schema, o `mcp.maxRows`); más, se recorta al máximo |
| `allowDestructive` | el que quiera (en `push`) | **lo borra la gateway**: lo da el permiso `destructive` (con `ddl`) |
| `context` | la borra la gateway | igual: solo del token (sus claims) |

- **Sin elegir:** la primera vista (y el primer stage) de sus roles. Si sus roles dan defaults distintos, la del
  schema si está permitida; si no, `403` (`choose a view: support, analytics`).
- **MCP:** un agente no elige (sus herramientas no lo ofrecen): usa los defaults. Decisión 6.
- **`/whoami`** dice lo que puede elegir: `{ views: [...], stages: [...], view, stage, maxRows }`; el IDE ofrece un
  selector en la connection solo si hay más de uno.

## 4. Los permisos dependen de lo elegido

Los permisos de un pedido son los de **los roles que permiten esa vista y ese stage**, no la suma de todos sus roles:

| Roles de carla | Pide | Permisos |
| --- | --- | --- |
| `support` (read, vista support) y `backend` (read, write, vista del schema) | vista `support` | `read` (solo `support` la permite) |
| los mismos | sin vista (la del schema) | `read`, `write` (solo `backend`) |
| `analyst` (read; stages default, reporting) y `operator` (ddl; stages default, staging) | `push` en `staging` | `ddl` (solo `operator`) |

Así un rol es un permiso **con alcance**: nadie escribe dentro de una vista que solo le dieron para leer, ni corre DDL
en un stage que solo le dieron para consultar. La suma de todo (como hoy) se puede pedir por rol con `scope: any`
(decisión 2).

Los comandos de stage (`export`, `import`, `push`, `drop`, `migrate`, `seed`) también quedan dentro de los `stages` del
rol: hoy cualquiera con `ddl` los corre en cualquier stage del schema.

## 5. Extenderlos desde la administración

Sobre [`GATEWAY_STATE.md`](GATEWAY_STATE.md) §4 (el YAML es la base, la base extiende):

- **Un rol nuevo:** su nombre, sus permisos, `schemas`, vistas, stages, `maxRows`, `approval`. Un token que trae ese
  nombre en su claim ya lo tiene; una clave local, si la clave es de la base (después).
- **Extender un rol del YAML:** agregar schemas (a uno que nombra algunos; uno sin `schemas` sigue valiendo en todos),
  vistas, stages o permisos, cambiar el default o `maxRows`. No se le quita lo que el YAML le da (eso es del
  despliegue); un rol `locked` no se toca. Un rol que la 4.4 guardó para un schema no vale: se lista como ignorado
  para quitarlo (`DELETE /admin/roles/{name}?schema=`).
- **El permiso `roles`:** ver y cambiar los roles; nadie se da a sí mismo un permiso que no tiene (un cambio que suma
  permisos que quien lo hace no tiene, `403`), y nadie se quita `roles` a sí mismo si es el último.
- Cada cambio, en `ConfigChanges` (quién, cuándo, antes y después) y en la auditoría; llega a las réplicas
  (`GATEWAY_STATE.md` §5).
- `GET/PUT/DELETE /admin/roles[/{name}]` (un `PUT` con `schema`, `400`: el rol dice sus `schemas`).
- `GET /admin/access` (5.0.0, con `roles`): quién puede entrar, como lo dice la configuración: las autenticaciones
  global, de cada transporte y de cada schema, con sus claves (nombre, `roles`, `context`), el emisor y los claims de
  un método `jwt`, y los permisos que existen. Nunca un secreto (clave, token, contraseña, secreto de un jwt).
- En el IDE, la pestaña **Configuración** de una conexión (con `roles`): los roles (los del YAML de solo lectura, con
  lo que la base les suma, y los de la base), el acceso (cada clave o token con sus roles y su contexto) y los
  permisos por rol (una matriz rol × permiso, con sus schemas).

## 6. El caché, las suscripciones, la auditoría

- La clave del caché ya lleva el stage, la vista y el contexto ([`RESULT_CACHE.md`](RESULT_CACHE.md)): nada cambia.
- Una suscripción guarda la vista y el stage con que se hizo; si el rol deja de permitirlos, se cierra en la recarga.
- La auditoría suma `stage` (ya tiene la vista) y el rol que dio el permiso.

## 7. Lo que no

No son reglas con expresiones sobre los claims (`when: claims.x == …`): los roles cubren el caso
([`VIEWS_BY_IDENTITY.md`](VIEWS_BY_IDENTITY.md) §6); se pueden sumar después. Los roles no van al `lambdaORM.yaml`.

## 8. Compatibilidad

| Hoy | Después |
| --- | --- |
| `roles` en un método `jwt` | 4.4: se leía como `authorization.roles`; **5.0.0: error**, van en `authorization.roles` |
| `permissions`, `view`, `approval` en una clave | 4.4: un rol propio; **5.0.0: error**, van en un rol que la clave nombra en `roles` |
| `view` en un rol | `views: [view]` |
| `options.stage` del cliente, cualquiera | **solo los del rol**: un cliente que hoy pide otro stage recibe `403` (el único cambio que rompe: va en el CHANGELOG; `authorization.stages: open` lo deja como hoy por una versión) |
| `options.maxRows` mayor | recortado |
| `options.allowDestructive` | ignorado: hace falta `destructive` |

## 9. Decisiones

| # | Tema | Recomendación | Alternativa |
| --- | --- | --- | --- |
| 1 | Dónde van los roles | **`authorization.roles`**, compartidos por los métodos (desde 5.0.0 el único lugar) | Dentro de cada método, como en 4.3 |
| 2 | Los permisos con varios roles | **Los de los roles que permiten la vista y el stage elegidos** (`scope: any` para sumar todo) | La suma de todos sus roles (como hoy) |
| 3 | Los roles de un schema | **Extienden los globales** (agregan vistas, stages, permisos) | Reemplazan al global del mismo nombre |
| 4 | El stage del cliente | **Solo entre los de sus roles**, `403` fuera; `authorization.stages: open` por una versión | Abierto como hoy |
| 5 | `maxRows` mayor que el permitido | **Se recorta al máximo** (y lo dice el resultado) | `400` |
| 6 | MCP | **Los defaults del rol** (el agente no elige) | Un argumento `view`/`stage` en las herramientas |
| 7 | `allowDestructive` | **El permiso `destructive`** (con `ddl`); la opción del cliente se borra | Una opción del cliente con `ddl` |
| 8 | Cambiar roles | **El permiso `roles`**; nadie se da lo que no tiene | Solo `schemaAdmin` |

## 10. Fases

1. `authorization.roles` y la lectura de los de hoy; `views`, `stages`, defaults, `maxRows`; el principal con sus roles
   (no solo sus permisos).
2. La elección: `options.view` y `options.stage` validados, los permisos por alcance, `maxRows`, `destructive`; los
   comandos de stage dentro de sus `stages`; `/whoami`; tests por transporte y casos en la conformidad.
3. Los roles en el schema de sistema ([`GATEWAY_STATE.md`](GATEWAY_STATE.md) fase 4): extenderlos, `ConfigChanges`,
   la recarga; las rutas de administración.
4. El IDE: el selector de vista y stage en la connection; la página de roles.
5. La wiki (cuatro idiomas): *Security*, *Configuration*, *Admin*, el IDE.
