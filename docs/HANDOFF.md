# Handoff: seguir trabajando en el repositorio de la Data Gateway

Contexto para quien continúe este trabajo, sea una persona o una sesión de Claude. Estado al **2026-11-23**, el día en
que la Data Gateway se separó de [lambda-orm/core](https://github.com/lambda-orm/core).

## 1. Estado de las ramas (nada está pusheado)

| Repositorio | Rama | Commits | Qué tiene |
| --- | --- | --- | --- |
| `~/personal/lambdaorm/data-gateway` (público) | `feature/monorepo`, desde `develop` | `bcb2122` trae los paquetes con su historia; `12d52dd` arma el monorepo y los workflows; `5db26f6` agrega el `env.d.ts` del IDE; `073ef1d` es este documento; `389fe02` trae el lab ilusor-cloud con su historia; `96b006e` lo convierte en `packages/lab-ilusor` | Todo lo de la Data Gateway |
| `~/personal/lambdaorm/data-gateway` | `feature/management-sessions`, desde `feature/management` | las sesiones de `management` (fases 1 a 5 de `DATA_GATEWAY_SESSIONS_PLAN.md`) y la depuración en VS Code (`.vscode/launch.json`) | Lo último: es la rama a seguir |
| `~/personal/lambdaorm/data-gateway` | `feature/management`, desde `feature/monorepo` | desde `a1f2c0d` (el diseño, §12) | La gateway 4.0.0 con `management`, sin `/ui` ni CORS, y el IDE con su backend proxy |
| `~/personal/lambdaorm/core` (privado) | `feature/ui-workspace-tree` | `50d4164` (sobre `9edff0f`) | El IDE, sus conexiones y sus herramientas, todavía dentro de core |
| `~/personal/lambdaorm/core` | `feature/split-data-gateway`, sobre la anterior | `900eb20` y `3f9695e` | Saca de core los paquetes, docs y workflows que se mudaron, y el lab ilusor-cloud. El test `crossSourceFilter` de lib conserva una copia del modelo del lab en `tests/fixtures/ilusor-cloud` |
| `~/ilusor/dev` | `feat/data-gateway` | 45 commits sin upstream, el último `ed3e5ee0` | El modelo de Ilusor con las relaciones renombradas |

Verificado en checkouts limpios:

- **Este repo**, con `scripts/ci-local.sh check`:
  - unitarios: gateway 140, ui 97, client-node 55;
  - integración de la gateway: 86 pasan y 8 se saltean;
  - suite de conformidad (`scripts/ci-local.sh clients`): 140 de 140.
- **Core** (`scripts/ci-local.sh check` de core): pasa.

Orden sugerido para subir, siempre con el OK del usuario:

1. En core, PR de `feature/ui-workspace-tree` y después de `feature/split-data-gateway`, ambos a `develop`. También se
   puede abrir uno solo de `feature/split-data-gateway`, que contiene los dos.
2. Acá, PR de `feature/monorepo` a `develop`, y después de `feature/management` (o uno solo de `feature/management`,
   que contiene los dos).

## 2. Qué hay en este repositorio

Lo que dicen [`CLAUDE.md`](../CLAUDE.md), [`README.md`](../README.md) y [`DEPLOY.md`](../DEPLOY.md), en resumen:

| Paquete | Nombre | Se publica como |
| --- | --- | --- |
| `packages/data-gateway` | `@lambdaorm/data-gateway` 3.2.0, con *Unreleased* en su CHANGELOG | la imagen `flaviorita/data-gateway` (workflow `data-gateway-image.yml`) |
| `packages/ide` | `@lambdaorm/data-gateway-ide` 1.0.0, sin publicar | la imagen `flaviorita/data-gateway-ide` (`ide-image.yml`) |
| `packages/ui` | `@lambdaorm/ui` 0.5.0, con el changeset pendiente `.changeset/ui-workspace-tree.md` (minor) | npm (`release.yml`, Changesets) |
| `packages/client-node` | `@lambdaorm/data-gateway-client` 0.1.1, nunca publicado | npm (`release.yml`): la primera publicación necesita un token Automation |
| `packages/conformance` | — | no se publica: los clientes la pasan |
| `packages/lab-ilusor` | `@lambdaorm/lab-ilusor`, privado | no se publica: es el lab ilusor-cloud que estaba en `packages/lib/src/dev/labs/ilusor-cloud` de core, traído con su historia. Usa λORM de npm, Postgres y FerretDB (`npm run up && npm run setup && npm run lab`, o `scripts/ci-local.sh lab`; el workflow es `lab-ilusor.yml`) |

- **Dependencias de core:** `@lambdaorm/base`, `lib` y `client` vienen **de npm**. Si la gateway necesita un cambio de
  λORM, primero se libera desde core y después se sube la versión acá.
- **El changeset pendiente de core:** `schema-name-description.md` (base minor: `Schema.name` y `description`). La
  gateway no lo necesita para compilar, porque escribe esos campos en el YAML.
- **Actions:** a diferencia de core, donde están pausadas, acá funcionan porque el repo es público.
- **Secrets que hay que crear en GitHub:**
  - `NPM_TOKEN`
  - `CHANGESET_TOKEN`
  - `DOCKERHUB_TOKEN`

## 3. Comandos

```bash
pnpm install
pnpm build                     # ui → tsc -b (data-gateway, client-node) → ide
pnpm lint && pnpm test
pnpm --filter @lambdaorm/data-gateway run test:integration
pnpm --filter @lambdaorm/data-gateway-ide run typecheck
scripts/ci-local.sh check      # todo lo anterior, en un checkout limpio de HEAD: antes de cada push
scripts/ci-local.sh clients    # la suite de conformidad (Docker, puertos 19080-19083 y 19432)
scripts/ci-local.sh lab        # el lab ilusor-cloud (Docker, puertos 55432 y 57017)
```

Si `pnpm` no está en el PATH, se usa `corepack pnpm`. `ci-local.sh` ya lo resuelve por su cuenta.

## 4. El entorno local con Ilusor

Ilusor usa la gateway de este repo, construida a mano. Su compose está en `~/ilusor/dev/cloud`.

- **Contenedor `cloud-data-gateway`** (gateway 4.0.0, rama `feature/management`)
  - Corre la imagen `ilusor/data-gateway:4.0.0-management`, puesta por `~/ilusor/dev/cloud/docker-compose.override.yml`
    (local, sin trackear: el `docker-compose.yml` es generado).
  - Su REST se llega por el proxy `cloud-admin-gateway` en `http://localhost:8097/data-gateway`. Ya no sirve `/ui`, ni
    `/admin` en `http`, ni responde CORS.
  - Su `management` escucha en el puerto 9292, solo en la red interna `admin`: no está publicado.
  - Su configuración es `~/ilusor/dev/cloud/data-gateway/data-gateway.config.yaml`, con `path: ilusor` y
    `transports.management.port: 9292` (la de 3.2.0 quedó en `data-gateway.config.yaml.bak-3.2.0`).
  - Su workspace está en `~/ilusor/dev/cloud/data-gateway/workspace/ilusor/`.
- **Contenedor `cloud-data-gateway-ide`** (el IDE, imagen `flaviorita/data-gateway-ide:local`), del mismo override:
  - en `http://localhost:18098`, en las redes `admin` (para llegar a la gateway) e `ilusor-cloud-ide-local` (para
    publicarse);
  - `DATA_GATEWAY_IDE_TARGETS=http://data-gateway:9292,http://data-gateway:9291`;
  - la conexión a Ilusor es `http://data-gateway:9292` con la clave del modeler (que tiene `sessionAdmin`); el IDE
    hace login y trabaja con una sesión (`management` no acepta la clave directa). `trustedProxies` es la red `admin`. Su pestaña REST usa el `http`
    (`data-gateway:9291/data-gateway`, de `/transports`); WebSocket y MCP aparecen deshabilitados porque Ilusor no los
    expone.
- **Para reconstruirlos:**

  ```bash
  cd packages/data-gateway && npx grunt dist
  docker build -q --build-arg CLI_VERSION=1.6.18 -t ilusor/data-gateway:4.0.0-management .
  cd ../ide && npm run build && docker build -q -t flaviorita/data-gateway-ide:local .
  cd ~/ilusor/dev/cloud && docker compose up -d data-gateway data-gateway-ide
  ```

- **Las claves:** están en `~/ilusor/dev/cloud/.env`, en `DATA_GATEWAY_MODELER_KEY`, `DATA_GATEWAY_READER_KEY` y
  `DATA_GATEWAY_OPERATOR_KEY`. **Nunca se imprimen.** A un script se le pasan por una variable de entorno, por ejemplo
  `KEY=$(grep '^DATA_GATEWAY_MODELER_KEY=' ~/ilusor/dev/cloud/.env | cut -d= -f2-)`.
- **Depurar en VS Code:** "IDE: all" de `.vscode/launch.json` levanta una gateway desde el código
  (`packages/data-gateway/dev`, management en `127.0.0.1:19199`, clave `dev-modeler-key`), el backend del IDE (8080) y
  el IDE con vite (5173) en Chrome.
- **Pruebas en Chrome headless:** se manejan por CDP con scripts propios de cada sesión, que no se guardan en el repo.
- **La sesión del usuario:** la gateway la guarda por credencial (`GET/PUT /admin/session`, en
  `.data-gateway/state.sqlite` del workspace). Una prueba headless con la clave del modeler pisa la sesión del
  usuario, así que hay que seguir estos pasos:
  1. Antes, guardar una copia con un nombre de archivo nuevo.
  2. Al terminar, matar Chrome y esperar unos 5 segundos.
  3. Restaurar la copia y volver a verificarla.
  4. Nunca mandar `{state:null}`.

## 5. Reglas de trabajo con el usuario

- Responderle en **español**.
- Push, PR, publicaciones en npm o Docker Hub y cualquier publicación en un sitio externo necesitan su **OK
  explícito** cada vez.
- Antes de un push o un PR, verificar en un checkout limpio (`scripts/ci-local.sh check`).
- Commits: Conventional Commits con `#96` en el cuerpo (u otro ticket que indique el usuario) y Git Flow.
- Nunca `pkill -f`, porque mata el propio shell: los procesos se detienen por PID.
- No imprimir secretos ni valores de variables de entorno; solo comprobar si están definidas.
- El email del usuario es privado.
- La documentación de usuario está en el repo de la wiki, `~/personal/lambdaorm/wiki`, publicada en
  `https://lambda-orm.github.io/wiki/`, con la página de la gateway en `/es/data-gateway/`.

## 6. Pendientes

1. **Licencia:** el LICENSE del repo es Apache-2.0, pero los `package.json` dicen MIT. `scripts/dist.mjs` copia el
   LICENSE del repo dentro de cada paquete publicado, así que conviene unificarlas antes de publicar. Lo decide el
   usuario.
2. **Secrets de GitHub y push**, como dice la §1.
3. **Releases**, cada uno con su OK:
   - gateway **4.0.0**: su *Unreleased* empieza por los cambios que rompen (`management`, sin `/ui`, sin `/admin` en
     `http`, sin CORS) y sigue con `/transports`, `/openapi.json`, la credencial por subprotocolo, la sesión en SQLite,
     las expresiones y los temas;
   - IDE **1.0.0**, la primera imagen;
   - `@lambdaorm/ui`, la minor del changeset pendiente;
   - la primera publicación de `@lambdaorm/data-gateway-client`.
4. **El lab encontró un problema en el modelo de Ilusor:** `model.spec.ts` lee el modelo real, en
   `~/ilusor/dev/cloud/data-gateway/workspace/ilusor/lambdaORM.yaml`. Antes se salteaba sin avisar, porque buscaba el
   modelo en la raíz del workspace y ese archivo ya no existía.
   - **Resultado:** ahora falla con 8 relaciones que unen entidades cuyas claves empiezan por `locationId` sin emparejar
     ese campo.
   - **Relaciones:**
     - `GalleryVectors.sample` y `BiometricSamples.galleryVectors`;
     - `RecognitionVectors.sample` y `DeviceStateSamples.recognitionVectors`;
     - `ScanJobs.scan` y `ScanJobs.areaScans`;
     - `AreaScans.job` y `AreaScans.scanJobs`.
   - **Qué hay que hacer:** corregir el modelo, en `ci/deploy/` de Ilusor y en `tests/fixtures/ilusor`, o revisar la
     regla de L34.
   - **Resto del lab:** pasa, con 79 tests en verde.
5. **Bug de `yamlMerge`:** al renombrar, el administrador de schemas reescribe líneas que no cambiaron. En Ilusor, un
   cambio de 113 líneas salió como un diff de 557.
6. **Ilusor:**
   - llevar a `ci/deploy/` del repo de Ilusor la configuración local: `path: ilusor`, `admin`, la clave del modeler, y
     el `.data-gateway/` ignorado;
   - la rama `feat/data-gateway` sigue sin pushear; lo decide el usuario.
7. **Anteriores:**
   - las fases siguientes del plan de clientes ([`DATA_GATEWAY_CLIENTS_PLAN.md`](DATA_GATEWAY_CLIENTS_PLAN.md):
     Python, Go, Rust, CLI);
   - los mensajes de 3xpr para paréntesis sin cerrar;
   - L44 (el dialecto SQLjs), que es de core: `docs/LAMBDAORM_PENDING.md` de core.

## 7. Dónde está el diseño

[`DATA_GATEWAY.md`](DATA_GATEWAY.md) es el documento de diseño; está en español:

| Sección | Tema |
| --- | --- |
| §2 | Configuración |
| §5 | MCP |
| §6 | Autenticación |
| §7 | WebSocket: la credencial por subprotocolo y `/transports` |
| §10 | La UI de consultas |
| §11 | La administración de workspaces |
| §11.7 | El explorador |
| §11.8 | La sesión |
| §11.9 | El IDE: su backend y su proxy (`/gw/…`) |
| §12 | El transporte `management` (4.0.0) |

Los demás planes:

- [`DATA_GATEWAY_PLAN.md`](DATA_GATEWAY_PLAN.md): el rediseño de la gateway;
- [`DATA_GATEWAY_ADMIN_PLAN.md`](DATA_GATEWAY_ADMIN_PLAN.md): la administración;
- [`DATA_GATEWAY_CLIENTS_PLAN.md`](DATA_GATEWAY_CLIENTS_PLAN.md): los clientes;
- [`DATA_GATEWAY_IDE_DESKTOP_PLAN.md`](DATA_GATEWAY_IDE_DESKTOP_PLAN.md): el IDE de escritorio (Electron) y su pestaña en la wiki;
- [`DATA_GATEWAY_SESSIONS_PLAN.md`](DATA_GATEWAY_SESSIONS_PLAN.md): las sesiones de `management`.

Puntos para tener en cuenta:

- **El IDE:** `packages/ide/src/main.tsx` elige el modo:
  - `ide.tsx` es el IDE independiente: guarda las conexiones en localStorage y los secretos en sessionStorage;
  - `proxy.ts` (`viaProxy`) arma las URLs del proxy; `server/server.mjs` es el backend (estáticos y proxy, con sus tests
    en `server/server.test.mjs`);
  - `tools.tsx` tiene las pestañas de Swagger, WebSocket y MCP de una conexión.
- **La UI (`packages/ui`):**
  - `Workspace.tsx` maneja varias conexiones (`connections`, `WorkspaceConnection`);
  - el explorador, los formularios del schema, los diagramas y las sugerencias de λORM están en `lambdaCompletion.ts`
    y en las expresiones de 3xpr.
- **La gateway:**
  - `protocolCredential.ts`: la credencial por `Sec-WebSocket-Protocol`;
  - `registries.ts`, `transportsOf`: alimenta `GET /transports`;
  - `sqliteSessionState.ts`: la sesión;
  - `domain/admin/expressions.ts`: los contextos de las condiciones de los stages.
