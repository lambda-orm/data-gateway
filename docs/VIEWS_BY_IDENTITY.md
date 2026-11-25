# La vista por identidad (G2)

> **Estado (2026-11-25): decisiones de §7 cerradas (las recomendadas, el usuario); fases 1 a 5 hechas** (rama
> `feature/views-by-identity`); falta la wiki (fase 6). La conformidad tiene la vista `sales` (filtro de fila por el
> `country` del token, `city` enmascarada, `Categories` excluida) en los cinco transportes. G2 de [`PENDINGS.md`](PENDINGS.md) §3 (brechas 1.2 y
> 1.3). Sigue a R2 (la gateway borra el `view` del cliente) y a G1 ([`JWT.md`](JWT.md): el principal y su contexto).
> Lo que es una vista, en core: `lambda-orm/core` → `docs/VIEWS.md`, `CONTEXT.md`, `MASKING.md`.

## 1. Objetivo

Que **la gateway elija la vista de λORM de cada pedido según quién llama** (su credencial, sus roles), para que:

- un usuario de soporte vea `Customers` con el email enmascarado y sin `taxId`, y no vea `Invoices`;
- las filas se limiten por su contexto (`filter: 'tenantId == context.tenant'`, el `tenant` de su token, G1);
- **todo lo que describe el schema** muestre el dominio de **esa** vista: `/schema`, `/domain`, `/entities`, `model`,
  `metadata`, `parameters`, `constraints`, `plan`, los typings del IDE (autocompletado) y las descripciones de las
  herramientas de MCP (lo que un agente cree que existe).

Hoy (R2) λORM corre sin vista: el dominio entero para todos.

## 2. Configuración

Una clave local dice su vista; un token, por sus roles (G1: los roles ya dan los permisos):

```yaml
authentication:
  methods:
    - adapter: jwt
      issuer: https://auth.example.com/realms/shop
      principal:
        permissions:
          claim: realm_access.roles
          roles:
            support: { permissions: [read], view: support }       # un rol: sus permisos y su vista
            analyst: { permissions: [read], view: analytics }
            admin: [read, write, script]                          # sin vista: la del schema (abajo)
      context: { tenant: tenant_id }
    - adapter: local
      type: apikey
      keys:
        - { name: billing, value: '${BILLING_KEY}', permissions: [read, write], view: billing }
orm:
  schemas:
    - path: shop
      view: public            # la de quien no trae una: por defecto, default (el dominio)
```

- La forma de lista (`admin: [read, write]`) sigue valiendo: un rol sin vista.
- Varias vistas posibles (un usuario con `support` y `analyst`): decisión 2.

## 3. Qué hace la gateway

| Dónde | Qué cambia |
| --- | --- |
| El principal | Lleva `view` (de su clave o de sus roles); viaja al worker como el contexto (G1) |
| `requestOptions` | Pone `options.view` del principal (el del cliente se sigue borrando, R2) en `execute`, `script`, `execute-queued`, `plan` |
| `metadata`, `model`, `parameters`, `constraints` | Pasan `{ view }` a λORM |
| `/schema`, `/domain`, `/entities`, `/entity/{name}`, `/schema/search`, `/schema/describe` | El dominio de la vista (`getSchemaDomain(view)`, `getSchemaEntities(view)`) |
| `/typings` (el IDE) | Los typings del dominio de la vista |
| MCP | Las descripciones de las herramientas y los recursos con las entidades de la vista: el catálogo se arma por vista |
| Lo que la vista enmascara (`readExp`, `pii: mask/hash`) | Sale enmascarado por cualquier transporte (lo hace λORM); `hash` con clave necesita `LAMBDAORM_HASH_KEY` en el worker |
| Errores | Una entidad que la vista excluye, `ViewError` 403 (R3); una vista que el schema no tiene, decisión 3 |

## 4. Lo que la vista no restringe

Como dice core (`VIEWS.md` §9): las **acciones** (eso lo dan los permisos) y los **comandos de stage** (`export`,
`import`, `push`, `drop`…), que trabajan con el schema entero. Por eso:

- `stageExport` e `import` no pasan por la vista: son de administración, y una credencial con vista no debería tener
  esos permisos (la gateway lo **avisa** al leer la configuración: decisión 4);
- la administración (`management`: el YAML del schema, los formularios, los comandos) muestra el schema entero; el
  explorador de datos del IDE (consultas, entidades) usa la vista de la credencial.

## 5. El IDE

- Ve el dominio de la vista de su credencial en el explorador, el autocompletado y los resultados (enmascarados).
- La página de la connection dice qué vista tiene la credencial (`/whoami` la suma).

## 6. Alternativas descartadas

- **Reglas con expresiones** (`authorization.views: [{ when: 'claims.role == "support"', view: support }]`): más
  flexibles, pero otra superficie que validar; los roles ya cubren el caso. Se puede sumar después sin romper esto.

## 7. Decisiones

| # | Tema | Recomendación | Alternativa |
| --- | --- | --- | --- |
| 1 | Dónde se dice la vista | **En la clave local y en el rol** (`roles: { support: { permissions, view } }`) | Reglas con expresiones sobre los claims (§6) |
| 2 | Un token con roles de varias vistas | **Error 403** (`the roles support and analyst give two views`): una vista por pedido, sin adivinar | La primera en el orden de `roles` |
| 3 | Una vista que el schema no tiene | **El schema la avisa al cargar** (un issue, como una variable que falta) y el pedido es 403 | Ignorarla (el dominio entero: inseguro) |
| 4 | Una credencial con vista y permisos de stage (`stageExport`, `stageImport`, `ddl`) | **Aviso al leer la configuración** (esos comandos ven todo) | Error |
| 5 | Sin vista asignada | **`orm.schemas[].view`**, si no `default` (el dominio) | Siempre `default` |

## 8. Fases

1. Configuración (`view` en claves, roles y schemas) y el principal con su vista; `requestOptions` y los metadatos.
2. El dominio de la vista en `/schema`, `/domain`, `/entities`, `/typings`, `/whoami`.
3. MCP: el catálogo por vista.
4. IDE: la vista en la connection.
5. Conformidad: una vista con una propiedad enmascarada, una excluida y un filtro de fila por `context.tenant` (el
   tenant del token de la suite), en los cinco transportes.
6. Wiki.

## 9. Criterios de aceptación

- Con el token de un usuario `support`, `Customers` trae el email enmascarado y sin `taxId`, `Invoices` es 403, y el
  dominio, los typings y las herramientas de MCP no muestran lo excluido.
- Con `filter: 'tenantId == context.tenant'`, dos usuarios de tenants distintos ven sus filas y no las del otro, por
  los cinco transportes, y un `context` o un `view` mandado por el cliente no cambia nada.
- Una credencial sin vista ve el dominio (o la del schema).
