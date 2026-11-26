# Keycloak real y login con PKCE en el IDE (G1b)

> **Estado (2026-11-26): decisiones de §4 cerradas (las recomendadas, el usuario); fases 1 a 4 hechas** (rama
> `feature/oidc-login`). Lo que quedó de [`JWT.md`](JWT.md): la prueba contra un IdP real (criterio de aceptación de
> §10) y el login desde el IDE (decisión 5). `scripts/ci-local.sh oidc` (y su job de CI): 31 chequeos contra Keycloak
> 26.4 en los cinco transportes, la rotación incluida. El login, de punta a punta en el IDE (Chrome, el formulario de
> Keycloak en su ventana, la gateway lo ve como carla). **Después (2026-11-26):** la renovación, en vivo en el IDE (Chrome, tokens de 70 s: el temporizador lo cambió solo y la gateway lo tomó); el login de la app de escritorio, en el runner de Keycloak (el loopback en `ide-desktop/src/oidcLoopback.mjs`, el formulario del realm por HTTP, el canje con PKCE) y la renovación con el cliente público. Cambios
> respecto del diseño: el IDE llega al IdP **por su backend** (su CSP no deja a la página hablar con otro origen): en la
> imagen web, el origen del IdP va en `DATA_GATEWAY_IDE_TARGETS` y el IdP no necesita CORS; la ventana del login se abre
> en el clic (después de un `await` el navegador la bloquea). De paso, `DATA_GATEWAY_IDE_CONNECT_SRC` suma a la CSP de
> la imagen web los almacenamientos de los archivos (G6b); la app de escritorio permite `https:`.

## 1. Keycloak en la conformidad

- Un Keycloak en un compose propio, con un realm importado (`data-gateway`): un cliente público para el IDE (PKCE), uno
  confidencial para la prueba, los roles `reader` y `writer`, dos usuarios, y un mapper que pone `country` en el token.
- La gateway de la prueba con `authentication.adapter: jwt` y solo `issuer` (el `jwksUri` se descubre, RS256).
- El runner pide tokens de verdad (con usuario y contraseña, el *direct access grant* del cliente de prueba) y corre
  los casos de JWT y de vista en los cinco transportes: roles → permisos, `country` → la vista, un token vencido o de
  otra audiencia → `401`. La rotación de claves: se rota la clave del realm y la gateway sigue aceptando tokens nuevos.

## 2. Login desde el IDE (OpenID Connect con PKCE)

- La autenticación de una connection suma **OpenID Connect**: el `issuer`, el `clientId` (un cliente público) y los
  `scopes`. **Iniciar sesión** abre el login del IdP; vuelve con un código que el IDE cambia por los tokens (PKCE: sin
  secreto en el navegador).
- **Navegador:** en una ventana emergente que vuelve a `<el IDE>/oidc-callback.html` y le pasa el código a la ventana
  del IDE (`postMessage`, solo de su mismo origen): no se pierde lo que estaba abierto.
- **Escritorio:** el navegador del sistema, que vuelve a `http://127.0.0.1:<puerto>/oidc-callback` del proxy de la app
  (RFC 8252, *loopback*).
- **Los tokens:** en la memoria de la pestaña (y `sessionStorage` para sobrevivir un recargar); el *refresh token*
  renueva el de acceso antes de que venza; sin él, al vencer se pide iniciar sesión otra vez. **Cerrar sesión** llama
  al `end_session_endpoint` del IdP.
- Las llamadas al IdP (descubrimiento, token) van por el backend del IDE (`/gw/…`, como las de la gateway): en la imagen
  web, su origen va en `DATA_GATEWAY_IDE_TARGETS`.

## 3. Lo que no

El IDE no guarda contraseñas del IdP ni usa el flujo implícito; los secretos de un cliente confidencial no van al
navegador.

## 4. Decisiones

| # | Tema | Recomendación | Alternativa |
| --- | --- | --- | --- |
| 1 | Keycloak en las pruebas | **Un paso propio** (`scripts/ci-local.sh oidc` y un job de CI): tarda en arrancar | Dentro de `clients` |
| 2 | El login en el navegador | **Ventana emergente** (no se pierde lo abierto) | Redirigir la página entera |
| 3 | El escritorio | **Ahora, con loopback** | Solo el navegador por ahora |
| 4 | Dónde quedan los tokens | **La pestaña** (memoria y `sessionStorage`; se cierra y se vuelve a iniciar sesión) | Recordados en `localStorage` |

## 5. Fases

1. Keycloak: el compose, el realm, el runner con tokens reales; la rotación.
2. El IDE: la autenticación OpenID Connect, el login (emergente), el cambio del código, renovar, cerrar sesión.
3. El escritorio: el loopback en el proxy de la app.
4. Pruebas del IDE (el flujo con un IdP falso) y el login contra el Keycloak del compose.
