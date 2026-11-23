# data-gateway-ide de escritorio (Electron) y su pestaña en la wiki

> **Estado (2026-11-23): plan, no implementado.** Sigue a [`DATA_GATEWAY.md`](DATA_GATEWAY.md) §11.9 (el IDE y su
> backend) y §12 (el transporte `management`). Las decisiones de §8 están cerradas (el usuario, 2026-11-23).

## 1. Objetivo

1. **El IDE como aplicación de escritorio**, construida con [Electron](https://www.electronjs.org/) a partir del mismo
   `packages/ide`, con ejecutables para **Linux**, **Windows** y **macOS**.
2. **Una pestaña IDE en la wiki**, con una página (`https://lambda-orm.github.io/wiki/ide/`) que presenta el IDE y
   lista todas sus versiones para descargar en los tres SO, y la guía de uso, que se muda desde la pestaña Data Gateway.
   Las versiones y los instaladores salen de los **GitHub Releases de este repositorio** (`lambda-orm/data-gateway`, tags `ide-v*`) desde el
   navegador, sin alojar ningún binario en la wiki.

La imagen `flaviorita/data-gateway-ide` sigue existiendo: el escritorio es otra forma de distribuir la misma app, para
quien quiere un IDE local (como un IDE de bases de datos) sin levantar un contenedor.

### 1.1 Las formas de usar el IDE

El mismo IDE (mismo código, misma versión, D6) se usa de dos formas, y la gateway en ningún caso sirve la UI:

| | Escritorio | Web |
| --- | --- | --- |
| Qué es | la app de Electron, con el proxy dentro | la imagen `flaviorita/data-gateway-ide`: la app y su backend proxy (Node) |
| Cómo se obtiene | se descarga de la pestaña IDE de la wiki (§5) | se despliega la imagen (`docker run`, compose, Kubernetes) |
| Quién la usa | una persona, en su máquina | quienes lleguen a la URL donde se publica |
| Actualización | sola en Windows y AppImage; aviso en macOS y `.deb` (§4.4) | se despliega la imagen nueva |
| Desde dónde llega al `management` | desde la máquina de la persona | desde la red del contenedor |

**Lo que se despliega en cada caso:**

| Se despliega | Para | `management` |
| --- | --- | --- |
| Solo la gateway, sin `management` | producción con los esquemas en los volúmenes: sin IDE ni administración | sin puerto |
| La gateway y la imagen web del IDE | un IDE compartido en el navegador | solo en la red interna, nunca publicado: lo alcanza el contenedor del IDE |
| Solo la gateway, con `management` | el IDE de escritorio (o la imagen web corriendo en la máquina de la persona) | la máquina de la persona tiene que llegar al puerto (abajo) |

**Cómo llega el escritorio a un `management` que no está en su máquina**, sin publicarlo abierto (escribe los esquemas
y sus variables y ejecuta DDL: es la puerta de la administración, aunque pida credencial):

| Dónde corre la gateway | Cómo llega | `management` publicado |
| --- | --- | --- |
| en la misma máquina (desarrollo) | `localhost:9090` | — |
| en una red interna o con VPN | `host-interno:9090` | solo hacia esa red |
| en un servidor, sin VPN | túnel SSH, `ssh -L 9090:localhost:9090 servidor`, y la connection a `localhost:9090` | solo en el loopback del servidor |
| en Kubernetes | `kubectl port-forward svc/data-gateway 9090`, y la connection a `localhost:9090` | un `Service` interno, sin ingress |

Las pestañas REST, WebSocket y MCP llegan a los puertos que la gateway dice en `/transports`, sobre el mismo host de la
connection; con un túnel, sus URLs se fijan en la connection ("Otras URLs de sus transportes") o se tunelizan también.

La guía de la wiki (`Deploying it`, que se muda a `/ide/Guide/` en §5.6) explica estas combinaciones.

## 2. Lo que ya hay y se reutiliza

| Pieza | Dónde | Qué aporta al escritorio |
| --- | --- | --- |
| La app (React, `@lambdaorm/ui`) | `packages/ide/src`, `npm run build` → `dist/` | la interfaz entera, sin cambios de pantalla |
| El backend proxy | `packages/ide/server/server.mjs` (`createServer`, `targetOf`, `targetsOf`) | REST, MCP y el upgrade de WebSocket hacia las gateways; sin dependencias |
| `viaProxy` | `packages/ide/src/proxy.ts` | arma `/gw/{base64url}/…`; hoy toma la base de `document.baseURI` |
| Las connections | `localStorage` y `sessionStorage` del origen de la app | se guardan por **origen**: el escritorio necesita un origen estable (§3.2) |

Las gateways no responden CORS (4.0.0), así que el escritorio también necesita el proxy: la página no puede llamar a una
gateway directamente.

## 3. La aplicación de escritorio

### 3.1 Paquete

`packages/ide-desktop` (`@lambdaorm/data-gateway-ide-desktop`, privado):

```text
packages/ide-desktop/
  package.json            electron, electron-builder (devDependencies); depende de @lambdaorm/data-gateway-ide (workspace)
  electron-builder.yml    destinos, nombres de los artefactos, publicación (§4)
  src/main.ts             el proceso principal: protocolo app://, el proxy local, la ventana, el menú
  src/preload.ts          contextBridge: solo { proxyBase, version, platform }
  build/                  íconos (icns, ico, png) y entitlements de macOS
  tests/                  pruebas del proceso principal (el proxy con token, la navegación bloqueada)
```

- Toma el `dist/` de `packages/ide` (lo copia en `resources/app/ide`) y `server/server.mjs`: **un solo código** para la
  imagen y el escritorio.
- TypeScript compilado a CommonJS para el proceso principal (Electron lo carga sin bundler); el renderer es el `dist/`
  de Vite tal cual.
- La versión de Electron se fija exacta (la estable del momento de la fase 1), con Node incluido: el usuario no instala
  nada.

### 3.2 Cómo se sirve la app y cómo llega a las gateways

**El problema:** si la ventana cargara `http://127.0.0.1:<puerto>`, el origen cambiaría con cada puerto. Con eso las
connections guardadas en `localStorage` se perderían en cada arranque. Y un puerto local abierto lo puede usar cualquier
proceso o página web de la máquina, por ejemplo como proxy hacia la red interna.

**El diseño:**

| Parte | Cómo |
| --- | --- |
| La página | `protocol.handle('app', …)` sirve `dist/` en `app://ide/`: un **origen fijo**, así `localStorage` persiste entre arranques y versiones |
| El proxy | `createServer` de `server.mjs` en `127.0.0.1`, puerto aleatorio (`listen(0)`), con `targets: '*'`: es el equipo del usuario llegando a sus gateways, como un IDE de bases de datos |
| La base del proxy | el preload expone `window.ideDesktop.proxyBase = http://127.0.0.1:<puerto>/t/<token>/`; `viaProxy` la usa si existe y si no, `document.baseURI` (la imagen web no cambia) |
| El token | 32 bytes aleatorios por arranque, en la ruta (`/t/<token>/gw/…`): sirve también para el WebSocket, que no puede mandar cabeceras. Sin token, `403` |
| CORS del proxy local | solo para `Origin: app://ide`. Es el único caso con CORS, y en un servidor que solo escucha en loopback |
| DNS rebinding | el proxy rechaza un `Host` que no sea `127.0.0.1:<puerto>` |
| WebSocket | el upgrade exige `Origin: app://ide` y el token |

Se descartó **solo `protocol.handle`, sin puerto**: un protocolo propio no admite el upgrade de WebSocket, y las
pestañas de WebSocket y MCP (sobre WebSocket) lo necesitan.

**Cambios en `packages/ide` que esto pide** (fase 1, compatibles con la imagen web):

- `server.mjs`: opciones `{ token, appOrigin }` en `createServer`. Con `token`, exige `/t/<token>` antes de `/gw/`; con
  `appOrigin`, responde CORS (y el preflight `OPTIONS`) solo para ese origen y verifica `Host` y `Origin`. Sin esas
  opciones se comporta como hoy.
- `proxy.ts`: la base sale de `window.ideDesktop?.proxyBase ?? document.baseURI`.
- Pruebas nuevas en `server.test.mjs`: sin token, otro origen, otro `Host`, el preflight, el WebSocket con token.

### 3.3 Seguridad del proceso principal

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. El preload expone solo datos, nunca `ipcRenderer`
  completo.
- La navegación se bloquea (`will-navigate`) fuera de `app://ide`. `setWindowOpenHandler` abre los enlaces externos
  (la wiki) con `shell.openExternal`, y solo `https:`.
- La Content-Security-Policy de `server.mjs` se repite en las respuestas de `app://`, con `connect-src` agregando la base
  del proxy local.
- Sin `webSecurity: false` ni `allowRunningInsecureContent`.

### 3.4 Lo propio del escritorio

| Qué | Fase | Cómo |
| --- | --- | --- |
| Menú | 2 | Archivo (nueva connection, salir), Editar (copiar y pegar; macOS lo necesita), Ver (recargar, zoom, devtools solo en desarrollo), Ayuda (la wiki, la versión) |
| Ventana | 2 | recuerda tamaño y posición (un JSON en `app.getPath('userData')`) |
| Una sola instancia | 2 | `requestSingleInstanceLock`: abrirla de nuevo enfoca la que está |
| La clave "recordada" | 5 (opcional) | en lugar de `localStorage`, `safeStorage` del sistema (Keychain, DPAPI, libsecret) por IPC |
| Actualizaciones | 3 | `electron-updater` con el proveedor GitHub en Windows y AppImage; en macOS y `.deb`, el aviso (§4.4) |

## 4. Ejecutables y publicación

### 4.1 Destinos (electron-builder)

| SO | Formatos | Arquitecturas | Notas |
| --- | --- | --- | --- |
| Linux | `.AppImage`, `.deb` | x64, arm64 | AppImage es el que se recomienda: no pide instalar y se actualiza solo; el `.deb`, para Debian y Ubuntu (se actualiza a mano) |
| Windows | instalador NSIS `.exe` | x64, arm64 | por usuario, sin pedir administrador; se actualiza solo |
| macOS | `.dmg`, `.zip` | x64 (Intel), arm64 (Apple Silicon) | uno por arquitectura en lugar de *universal*: la mitad de tamaño; el `.zip` lo usará el actualizador cuando la app esté firmada |

Los formatos son los de D3 (reducido): sin `.rpm`, `.tar.gz` ni el `.zip` portable de Windows. Se pueden sumar después
sin cambiar nada más que `electron-builder.yml` y la página `/ide/` ya los reconoce (§5.4).

**Nombres de los artefactos**, fijos porque la página `/ide/` de la wiki los clasifica por nombre (§5.4):

```text
data-gateway-ide-<versión>-<linux|win|mac>-<x64|arm64>.<ext>
  data-gateway-ide-1.1.0-mac-arm64.dmg
  data-gateway-ide-1.1.0-win-x64.exe
  data-gateway-ide-1.1.0-linux-x64.AppImage
```

### 4.2 CI

Workflow `ide-desktop.yml`, con la misma regla que `ide-image.yml`: corre cuando una versión de
`packages/ide/package.json` que no está publicada llega a `main` (o con *Run workflow* y `force`).

El repositorio es público: los runners que aloja GitHub son gratis y sin límite de minutos, en los tres SO y también
en arm64 nativo. Cada ejecutable se construye (y se prueba) en su propio SO y arquitectura, sin compilar en cruzado:

| Job | Runner | Produce |
| --- | --- | --- |
| `linux-x64` | `ubuntu-latest` | AppImage y deb (x64) |
| `linux-arm64` | `ubuntu-24.04-arm` | AppImage y deb (arm64) |
| `windows-x64` | `windows-latest` | exe (x64) |
| `windows-arm64` | `windows-11-arm` | exe (arm64) |
| `mac-arm64` | `macos-latest` (Apple Silicon) | dmg y zip (arm64) |
| `mac-x64` | `macos-13` (Intel) | dmg y zip (x64) |
| `release` | `ubuntu-latest`, después de los seis | crea en este repositorio el release del tag `ide-v<versión>` como borrador, sube los artefactos y sus `latest*.yml`, y lo publica con `make_latest: true` (§4.5) |

- macOS solo se construye en un Mac; Windows se podría construir en Linux con wine, pero en su runner se prueba de verdad.
- El plan gratuito permite unos 20 jobs a la vez (5 de macOS): alcanza.
- Los jobs construyen en cada pull request que toca `packages/ide*` (sin publicar), y publican solo desde `main`. Los
  secrets de firma (fase 5) no llegan a un pull request desde un fork.
- El release lo crea el `GITHUB_TOKEN` del workflow (`permissions: contents: write`): no hace falta ningún secret nuevo.
- El tag `ide-v<versión>` lo crea hoy `ide-image.yml`. Los dos workflows lo comparten: el que llega primero lo crea, y
  el otro lo usa si ya existe.

- Antes de construir: `pnpm build`, lint, typecheck y las pruebas del IDE y de `ide-desktop`.
- Una prueba de humo por SO: el ejecutable arranca en modo `--smoke-test`, sirve `app://ide/`, contesta el proxy local
  con su token y sale con 0. En Linux, con `xvfb-run`.
- La versión del escritorio es la del IDE (`packages/ide`): un solo número para la imagen y los ejecutables, con un solo
  CHANGELOG.

### 4.3 Firma

Sin firma, los ejecutables funcionan, pero el sistema avisa:

| SO | Sin firma | Para firmar |
| --- | --- | --- |
| macOS | Gatekeeper lo bloquea ("no se puede verificar el desarrollador"; en Apple Silicon, un `.app` descargado aparece "dañado"). Se abre con clic derecho → Abrir, o `xattr -dr com.apple.quarantine` | cuenta de Apple Developer (USD 99 por año), certificado *Developer ID Application* y notarización. Secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows | SmartScreen: "Windows protegió su PC" → Más información → Ejecutar de todos modos | un certificado de firma de código (OV/EV) o Azure Trusted Signing. Secrets según el proveedor |
| Linux | nada | (opcional) firmar el `.deb` con GPG |

**Decisión (D2): sin firma** en la primera versión, con la nota de instalación en la página `/ide/` de la wiki. Se firma
en la fase 5, cuando estén la cuenta de Apple Developer y el certificado de Windows.

### 4.4 Actualizaciones automáticas

`electron-updater` lee los `latest.yml`, `latest-mac.yml` y `latest-linux.yml` del release *latest* del repositorio.
Para eso:

- el *latest* de este repositorio tiene que ser siempre un release del IDE (§4.5);
- un canal beta (prerelease) no se usa: para encontrarlo, el actualizador recorre la lista de releases, que en este
  repositorio puede tener otros;
- en macOS solo funciona con la app firmada (Squirrel.Mac), y en Windows y Linux (AppImage), también sin firma.

**Decisión (D4): desde la primera versión en Windows y en el AppImage.**

| Instalado como | Al arrancar (y cada 6 horas) |
| --- | --- |
| Windows (`.exe`) | `electron-updater` descarga la versión nueva en segundo plano y ofrece reiniciar para instalarla; si no, se instala al salir |
| Linux (`.AppImage`) | igual que Windows: reemplaza el AppImage |
| macOS (`.dmg`), hasta firmar | aviso: consulta los releases `ide-v*` (como la página `/ide/`) y enlaza a la página para descargarla |
| Linux (`.deb`) | el mismo aviso: el paquete lo actualiza el usuario (o su gestor de paquetes) |

- La app sabe cómo fue instalada: `process.env.APPIMAGE` en Linux, y el instalador NSIS en Windows. El `.deb` y macOS
  usan el aviso.
- El job `release` sube `latest.yml` (Windows) y `latest-linux.yml` / `latest-linux-arm64.yml` (AppImage) con los
  ejecutables y sus `.blockmap` (descargas diferenciales). `latest-mac.yml` se sube desde el principio, aunque hasta
  firmar no lo use nadie.
- Preferencias → "Buscar actualizaciones automáticamente" (activado por defecto), y Ayuda → "Buscar actualizaciones".
- Un error del actualizador (sin red, el límite de la API) nunca molesta: queda en el log y se reintenta en el próximo
  ciclo.
- Una prueba en CI: con un release falso servido localmente (`electron-updater` acepta un proveedor `generic` en las
  pruebas), la versión vieja encuentra la nueva.

### 4.5 Los releases de este repositorio

Los releases del IDE comparten el repositorio con el código de todos los paquetes, y la regla es una sola: **el release
*latest* es siempre el del IDE**. La página `/ide/` de la wiki (su respaldo enlaza a `releases/latest`) y el actualizador
(§4.4) dependen de eso.

| Quién | Hoy | Qué cambia |
| --- | --- | --- |
| `release.yml` (Changesets: `@lambdaorm/ui`, `@lambdaorm/data-gateway-client`) | `changesets/action` crea por defecto un release por paquete publicado, y queda como *latest* | `createGithubReleases: false`. Las versiones de npm se siguen viendo en sus CHANGELOG y en npm |
| `data-gateway-image.yml` (la gateway) | crea solo el tag `data-gateway-v*`, sin release | nada; si algún día crea releases, con `make_latest: false` |
| `ide-image.yml` (la imagen del IDE) | crea el tag `ide-v*` | nada: el release lo crea `ide-desktop.yml` sobre ese tag |
| `ide-desktop.yml` (nuevo) | — | crea el release `ide-v<versión>` con `make_latest: true`; un prerelease (`-rc.N`), con `prerelease: true` y `make_latest: false` |
| un release creado a mano | — | no se marca como *latest* (lo dice `DEPLOY.md`) |

- El release del IDE lleva sus ejecutables y el "Source code" de GitHub, que es el monorepo en el commit del tag. Sus
  notas son la entrada de esa versión en `packages/ide/CHANGELOG.md`.
- La URL de un ejecutable queda
  `https://github.com/lambda-orm/data-gateway/releases/download/ide-v1.1.0/data-gateway-ide-1.1.0-win-x64.exe`.
- `DEPLOY.md` suma la fila de los ejecutables (workflow `ide-desktop.yml`) y la regla del *latest*.

## 5. La pestaña IDE de la wiki

### 5.1 El sitio

- MkDocs con el tema `readthedocs` y `mkdocs-static-i18n` (`docs_structure: suffix`): inglés en `Page.md`, traducciones
  en `Page.es.md`, `Page.pt.md` y `Page.de.md`.
- Los estilos y los scripts propios están en `docs/assets/`, con un nombre nuevo cuando cambian (`wiki-v4.css`,
  `wiki-v2.js`), declarados en `extra_css` / `extra_javascript` de `mkdocs.yml`.
- La navegación son pestañas en `nav:` (Home, Data Gateway, Queries, Schema, Usage, CLI), con sus títulos traducidos en
  `nav_translations`.

### 5.2 La pestaña

Una pestaña nueva en `nav`, **IDE** (el mismo título en los cuatro idiomas), entre Data Gateway y Queries:

```yaml
nav:
  - Data Gateway:
      - …                              # sin UI: se muda a IDE
  - IDE:
      - Overview: ide/index.md         # qué es, descargar, todas las versiones
      - Guide: ide/Guide.md            # la guía de uso (hoy data-gateway/Ui.md)
```

| Página | Ruta | Qué tiene |
| --- | --- | --- |
| `docs/ide/index.md` (+ `.es`, `.pt`, `.de`) | `/ide/` | qué es, el botón de descarga del SO detectado, **todas las versiones** por SO, la nota de instalación y la imagen Docker (§5.5) |
| `docs/ide/Guide.md` (+ `.es`, `.pt`, `.de`) | `/ide/Guide/` | la guía de uso, movida de `docs/data-gateway/Ui.md` (§5.6) |

`nav_translations` de cada idioma: `Overview` → Übersicht / Introducción / Visão geral (como la de Data Gateway),
`Guide` → Anleitung / Guía / Guia.

### 5.3 Archivos

| Archivo | Qué |
| --- | --- |
| `docs/ide/index.md` (+ traducciones) | el texto de la página y un bloque `<div id="ide-downloads" data-repo="lambda-orm/data-gateway" data-tag-prefix="ide-v" data-labels='{…}'>` con los textos que usa el script, en el idioma de esa página; un `<noscript>` con el enlace a los releases del IDE |
| `docs/ide/Guide.md` (+ traducciones) | `git mv` de `docs/data-gateway/Ui*.md`, con sus enlaces relativos ajustados |
| `docs/ide/images/` | `git mv` de las capturas `ui-*.png` de `docs/data-gateway/images/` que usa la guía (las que también usan otras páginas, como `ui-query.png` en la portada, se referencian desde su nuevo lugar) |
| `docs/assets/downloads-v1.js` | en `extra_javascript`; no hace nada si la página no tiene `#ide-downloads` |
| `docs/assets/wiki-v5.css` | los estilos de la página (reemplaza a `wiki-v4.css`, que se renombra según la convención del sitio) |
| `mkdocs.yml` | la pestaña IDE, sus `nav_translations` y el plugin de redirecciones (§5.6) |
| `requirements-docs.txt` | `mkdocs-redirects`, con versión fija |

Sin binarios en la wiki: todos los enlaces son `asset.browser_download_url`.

### 5.4 Lo que hace el script

1. **Lee los releases:** `GET https://api.github.com/repos/lambda-orm/data-gateway/releases?per_page=100`, sin token
   (60 pedidos por hora por IP).
   - Se queda con los de tag `ide-v*` que no son `draft`. Los `prerelease` van aparte, en un desplegable. Los demás
     releases del repositorio, si los hubiera, se ignoran.
   - Si en esa página no hay ninguno del IDE y la API dice que hay más (`Link: rel="next"`), pide la siguiente, hasta
     tres páginas.
   - No usa `releases/latest` para leer: la lista filtrada no depende de la regla del *latest* (§4.5).
   - Guarda la respuesta 10 minutos en `sessionStorage` (con `try/catch`), para no gastar el límite al navegar.
2. **Detecta el SO del visitante:**
   - con `navigator.userAgentData.platform` y, en Chromium, `getHighEntropyValues(['architecture'])` para la
     arquitectura;
   - si no, con `navigator.userAgent`.
   - Safari no distingue Apple Silicon de Intel: en macOS sin la arquitectura se ofrecen los dos, Apple Silicon
     primero.
3. **Clasifica los assets** por nombre (§4.1), y si un nombre no sigue la convención, por su extensión:

   | Plataforma | Extensiones | Arquitectura |
   | --- | --- | --- |
   | macOS | `.dmg`, `.pkg`, `-mac*.zip` | `arm64` / `aarch64` → Apple Silicon; `x64` / `x86_64` / `intel` → Intel |
   | Windows | `.exe`, `.msi`, `-win*.zip` | `arm64`; si no, x64 |
   | Linux | `.AppImage`, `.deb`, `.rpm`, `.tar.gz` | `arm64` / `aarch64`; si no, x64 |

   Los `latest*.yml` y `*.blockmap` (del actualizador) no se muestran.
4. **Muestra la última versión:**
   - el **botón principal** del SO detectado (el `.dmg` de su arquitectura, el `.exe` o el `.AppImage`);
   - debajo, las tres plataformas con cada archivo: nombre, arquitectura, tamaño en MB (`asset.size`) y enlace;
   - la versión (`tag_name` sin `ide-v`), la fecha (`published_at`, en el formato del idioma de la página) y las
     notas (`body`).
5. **Notas de la versión, sin riesgo:** el `body` es Markdown escrito en GitHub. Se renderiza con un conversor mínimo
   propio que escapa todo el HTML y solo arma títulos, listas, negrita, código y enlaces `https:`. Nada de `innerHTML`
   con el texto tal cual, y ninguna librería de un CDN.
6. **Todas las versiones**, una sección de la página (no un desplegable), la más nueva primero:

   | Versión | Fecha | Linux | Windows | macOS |
   | --- | --- | --- | --- | --- |
   | **1.2.0** (última) | 2026-12-10 | AppImage · deb — x64, arm64 | exe — x64, arm64 | dmg · zip — Apple Silicon, Intel |
   | 1.1.0 | 2026-11-30 | … | … | … |

   - Cada formato y arquitectura es un enlace directo al archivo (su tamaño en el `title`).
   - Cada fila se despliega para ver sus notas.
   - Los prerelease (`-rc.N`) van debajo, en "Versiones de prueba", plegados.
   - En el teléfono, cada versión es una tarjeta con sus tres SO uno debajo del otro.
   - Al final, el enlace a los releases del IDE en GitHub,
     `https://github.com/lambda-orm/data-gateway/releases?q=ide-v&expanded=true`.
7. **Si falla:**
   - Un error de red, un `403` / `429` con `x-ratelimit-remaining: 0`, o ningún release todavía muestran un mensaje
     amable que dice cuál de los casos es. En el de límite, dice hasta cuándo, con `x-ratelimit-reset`.
   - Incluye un botón a `https://github.com/lambda-orm/data-gateway/releases/latest`, que es el del IDE por la regla
     de §4.5.
   - Mientras carga, un esqueleto; sin JavaScript, el `<noscript>`.
8. **Nota de instalación:** la de Gatekeeper y SmartScreen de §4.3 mientras los ejecutables no estén firmados, y en
   Linux, `chmod +x` del AppImage.

### 5.5 La página `/ide/`

1. **Qué es:** el IDE en un párrafo y una captura (la de una consulta), con el enlace a la guía (§5.6).
2. **Descargar:** el botón del SO detectado y las tres plataformas de la última versión (§5.4, punto 4).
3. **Todas las versiones** (§5.4, punto 6).
4. **Instalación:** la nota de Gatekeeper y SmartScreen (§4.3) y `chmod +x` del AppImage.
5. **En un contenedor:** para el IDE web, la imagen `flaviorita/data-gateway-ide`, el `docker run` y el enlace a
   "Deploying it" de la guía.
6. **Cómo llega a una gateway:** las combinaciones de §1.1, en corto (la gateway sola con `management` y el túnel SSH
   para el escritorio; la imagen junto a la gateway para un IDE compartido), con el enlace a la guía.

Los puntos 1, 4, 5 y 6 son Markdown: se ven aunque la API de GitHub no responda o no haya JavaScript.

### 5.6 La guía de uso se muda

`docs/data-gateway/Ui.md` y sus traducciones pasan a `docs/ide/Guide.md` con `git mv` (conservan su historia):

- **Enlaces dentro de la wiki:** hoy apuntan a `Ui.md` 30 archivos (Admin, Clients, Configuration, GettingStarted,
  index y Transports de Data Gateway en los cuatro idiomas, las cuatro portadas, el CHANGELOG y `mkdocs.yml`); pasan a
  `../ide/Guide.md`, con sus anclas (`#in-your-own-application`, `#deploying-it`, `#connections`,
  `#administration-ui`). `mkdocs build --strict` falla si queda uno roto.
- **La URL vieja sigue andando:** `mkdocs-redirects` con `redirect_maps: { data-gateway/Ui.md: ide/Guide.md }` (y lo
  mismo por idioma). Un enlace viejo, de afuera o de un buscador, llega a la guía; un ancla en la URL vieja se pierde
  en la redirección.
- **Fuera de la wiki**, en este repositorio:
  - `packages/ui/README.md` enlaza a `https://lambda-orm.github.io/wiki/data-gateway/Ui/` y pasa a `…/wiki/ide/Guide/`;
  - `packages/ide` tiene en `wikiUrl` (`src/shared.tsx`) el enlace "Documentación" a `…/data-gateway/`, que pasa a
    `…/ide/`;
  - el README del IDE y el de la gateway suman el enlace a `…/wiki/ide/`.
- **El orden:** `scripts/check-wiki-links.mjs` comprueba los enlaces de los README contra la wiki **publicada**.
  Primero se publica la wiki con la pestaña IDE y las redirecciones; después se cambian los README de este repositorio.
  Al revés, el CI de este repositorio falla.

### 5.7 Presentación

- Mismos colores, tipografía y botones que el resto de la wiki (las variables de `wiki-v4.css`). El tema `readthedocs`
  no tiene modo oscuro, así que la página usa el mismo tema que las demás, sin inventar otro.
- *Responsive*: las tres plataformas en columnas en pantallas anchas y una debajo de la otra en el teléfono. Las tablas
  de archivos con scroll horizontal propio, nunca el de la página.
- Accesible: el botón principal es un enlace real (`<a href>`), con el texto de la plataforma; el estado de carga va en
  un `aria-live`.

## 6. Fases

| Fase | Qué | Hecho cuando |
| --- | --- | --- |
| 0 | cerrar las decisiones de §8 | hecho (2026-11-23) |
| 1 | `server.mjs` con token, origen de la app y verificación de `Host`; `viaProxy` con la base configurable | pruebas nuevas en verde; la imagen web sin cambios (sus pruebas y `ci-local.sh check`) |
| 2 | `packages/ide-desktop`: `app://`, el proxy local, la ventana, el menú, una sola instancia | `pnpm --filter …ide-desktop dev` abre el IDE; connections que persisten entre arranques; REST, WebSocket y MCP a una gateway local |
| 3 | electron-builder para los tres SO; prueba de humo; `electron-updater` en Windows y AppImage, el aviso en macOS y `.deb` | los ejecutables de Linux construidos y probados en local; los de Windows y macOS, en CI; la prueba del actualizador en verde |
| 4 | `ide-desktop.yml`, `release.yml` sin releases de Changesets y `DEPLOY.md` (§4.5); en la wiki, la pestaña IDE: `/ide/` con sus versiones y la guía mudada con sus redirecciones (cuatro idiomas); después, los enlaces de los README (§5.6) | un release de prueba (prerelease `ide-v1.1.0-rc.1`) que la página lista; `mkdocs build --strict` sin advertencias; la URL vieja de la guía redirige |
| 5 | firma y notarización; `electron-updater` también en macOS; `safeStorage` | los ejecutables firmados se abren sin avisos y macOS se actualiza solo |

Cada fase en su rama `feature/` con commits Conventional Commits y `#96` (u otro ticket que indique el usuario). Antes
de cada push, `scripts/ci-local.sh check`. Publicar (push, releases, la wiki) necesita el OK del usuario cada vez.

## 7. Criterios de aceptación

- [ ] Ejecutables para Linux (AppImage, deb), Windows (exe) y macOS (dmg, zip), en x64 y arm64, construidos por CI,
      con el nombre "Data Gateway IDE" y la versión del IDE.
- [ ] Windows y el AppImage se actualizan solos; macOS y el `.deb` avisan de la versión nueva.
- [ ] El escritorio usa el mismo `dist/` y el mismo `server.mjs` que la imagen. La imagen web sigue funcionando igual.
- [ ] Las connections persisten entre arranques y versiones de la app.
- [ ] El proxy local solo atiende a la app: sin token, desde otro origen o con otro `Host`, `403`.
- [ ] No hay binarios en la wiki: la página enlaza a los assets de los releases `ide-v*` de `lambda-orm/data-gateway`.
- [ ] El release *latest* del repositorio es siempre el del IDE: Changesets no crea releases.
- [ ] La pestaña IDE de la wiki tiene `/ide/`, que detecta el SO, destaca su descarga y lista **todas** las versiones
      con sus archivos para Linux, Windows y macOS (arquitectura y tamaño).
- [ ] La guía de uso está en `/ide/Guide/`; la URL vieja (`/data-gateway/Ui/`) redirige y no queda ningún enlace roto.
- [ ] Si la API de GitHub no responde, o no hay releases, la página muestra un estado amable y el enlace a los
      releases.
- [ ] Las notas de la versión se muestran sin ejecutar HTML del release.
- [ ] `mkdocs build --strict` sin advertencias; la página en los cuatro idiomas; *responsive*.

## 8. Decisiones

| # | Decisión | Opciones | Qué se decidió |
| --- | --- | --- | --- |
| D1 | **Dónde se publican los releases** (el `<NOMBRE_DEL_REPO_IDE>` de la tarea) | (a) un repositorio solo para los releases; (b) este repositorio, `lambda-orm/data-gateway`, con tags `ide-v*` | **Cerrada: (b), este repositorio** (decisión del usuario, 2026-11-23). Sin token nuevo, y con el código, el tag y el release juntos. A cambio: la regla del *latest* (§4.5), la página filtra por `ide-v*`, y no hay canal beta en el actualizador |
| D2 | Firma | sin firma al principio / firmar desde la primera / solo macOS | **Cerrada: sin firma al principio** (el usuario, 2026-11-23), con la nota de instalación en `/ide/`; firmar en la fase 5 (§4.3) |
| D3 | Destinos | completo / reducido / mínimo | **Cerrada: reducido** (el usuario, 2026-11-23): Linux AppImage y deb, Windows exe, macOS dmg y zip, en x64 y arm64 (§4.1) |
| D4 | Actualización automática en la primera versión | solo avisar / Windows y Linux ya | **Cerrada: Windows y Linux ya** (el usuario, 2026-11-23): `electron-updater` en Windows y el AppImage; en macOS y el `.deb`, el aviso hasta firmar. Sin canal beta (§4.4) |
| D5 | Dónde va en la wiki | una página `/downloads/` / una pestaña IDE | **Cerrada: la pestaña IDE** (decisión del usuario, 2026-11-23), con `/ide/` (qué es, descargar, todas las versiones) y la guía de uso mudada a `/ide/Guide/` (§5.2, §5.6) |
| D6 | Versión del escritorio | la del IDE / una propia | **Cerrada: la del IDE** (el usuario, 2026-11-23): un solo número y un solo CHANGELOG para la imagen y los ejecutables, en el release `ide-v<versión>` |
| D7 | Nombre de la app | "Data Gateway IDE" / "λORM IDE" / "λORM Data Gateway IDE" | **Cerrada: "Data Gateway IDE"** (el usuario, 2026-11-23), el del encabezado de la app; `appId` `io.github.lambda-orm.data-gateway-ide` |
