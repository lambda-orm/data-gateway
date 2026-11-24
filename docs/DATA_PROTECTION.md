# Protección de datos — schema de Ilusor

Datos del dominio de Ilusor (`packages/data-gateway/tests/fixtures/ilusor/lambdaORM.yaml`) que, según las políticas de
protección de datos (GDPR, Ley 25.326 de Argentina y equivalentes), **no deben almacenarse en texto plano** en la base de
datos.

Hoy ninguna propiedad del schema está marcada como encriptada.

## Marco legal: RGPD y LOPDGDD

Ilusor opera en España y la Unión Europea: se aplican el **RGPD** (Reglamento UE 2016/679) y la **LOPDGDD** (Ley
Orgánica 3/2018). La autoridad de control es la **AEPD**.

Este documento es una guía técnica, no asesoramiento legal. La EIPD de la biometría la valida el DPO o un asesor
especializado en RGPD.

### Qué exige la norma

- **Seguridad según el riesgo (RGPD art. 32).** La norma no obliga a cifrar campos concretos: exige medidas "apropiadas
  al riesgo" y cita el cifrado como ejemplo. La AEPD sanciona cuando, tras una brecha, las medidas no estaban a la
  altura del riesgo; que los datos estuvieran en claro agrava la sanción.
- **Responsabilidad proactiva (art. 5.2).** Cada decisión de cifrar o no un dato se documenta en el análisis de riesgos.
- **Categorías especiales (art. 9).** Los vectores biométricos de identificación son categoría especial: requieren una
  base legal reforzada (normalmente consentimiento explícito) y una **EIPD obligatoria** (art. 35).
- **Encargado del tratamiento (art. 28).** Para los datos que los clientes cargan (`Subjects`, `BiometricSamples`,
  eventos), Ilusor es encargado del tratamiento: necesita un contrato de encargo con cada cliente, y las medidas de
  seguridad descritas en él deben coincidir con las de este documento.
- **Brechas (arts. 33 y 34).** Aviso a la AEPD en 72 horas. A cada persona afectada hay que avisarle si hay riesgo
  alto, salvo que los datos fueran ininteligibles para quien los obtuvo (art. 34.3.a). Los datos cifrados quedan
  exentos; los que estén en claro, no.
- **Videovigilancia (LOPDGDD arts. 22 y 89).** Cámaras y reconocimiento en zonas comunes o lugares de trabajo: carteles
  informativos, plazos de borrado y, en el trabajo, aviso a los empleados.
- **Transferencias internacionales (RGPD cap. V).** Si la base de datos o los backups están fuera del EEE, hacen falta
  garantías para la transferencia; cifrar con claves que se guarden en la UE ayuda a cumplirlas.
- **ENS (Real Decreto 311/2022).** Solo con clientes del sector público; exige cifrado según la categoría del sistema.

### Decisiones

| Dato | Decisión | Justificación |
| --- | --- | --- |
| `BiometricSamples.vector` | Cifrar; plazo de borrado con `expiresAt` | Categoría especial (art. 9); EIPD obligatoria. |
| `Subjects.attributes`, `observations` | Cifrar | Se pueden unir con la biometría y con la actividad de la casa. |
| Email, teléfono y dirección (P2) | Cifrar; columnas HMAC para buscar | Contacto y localización directa de la persona. |
| `name` y `nameNormalized` de todas las entidades (y `Installations.contactName`) | **No se cifran** | Para que se pueda filtrar por ellos (`contiene`, `empieza con`), que con el valor cifrado es imposible. Riesgo bajo por sí solos, con el resto del dato personal cifrado. Decisión documentada en el análisis de riesgos (art. 5.2). |
| Nombres de empresas, ubicaciones, dispositivos y catálogos | En claro | No son datos de personas físicas. |

### Medidas obligatorias para todo el sistema

Independientemente del cifrado por campo:

- disco y backups cifrados;
- TLS en todas las conexiones;
- control de acceso a la base de datos y registro de quién consulta;
- claves de cifrado y de HMAC fuera de la base de datos, guardadas en la UE;
- minimización y plazos de conservación definidos para cada dato.

## Niveles

| Nivel | Significado | Tratamiento |
| --- | --- | --- |
| **P1 — Secreto / categoría especial** | Credenciales, biometría, firmas. Su fuga compromete sistemas o personas de forma irreversible. | Encriptación obligatoria. |
| **P2 — Dato personal (PII)** | Identifica o localiza a una persona. | Encriptación obligatoria; si se busca por él, además una columna de búsqueda con hash (ver [Búsqueda](#búsqueda-sobre-datos-encriptados)). |
| **P3 — Condicional** | Sensible según el contenido o el titular. | Encriptar si se confirma el riesgo. |

## P1 — Secretos y categorías especiales

| Entidad | Propiedad | Tipo | Motivo |
| --- | --- | --- | --- |
| `WifiCredentials` | `passwordSealed` | text | Contraseña de la red wifi. Si la aplicación ya la sella, que λORM no la vuelva a encriptar. |
| `WifiCredentials` | `ssId` | text | Junto con la contraseña permite entrar a la red. |
| `BiometricSamples` | `vector` | buffer | Plantilla biométrica (categoría especial, GDPR art. 9). |
| `Integrations` | `config` | json | API keys, tokens y credenciales de terceros. |
| `ParameterValues` | `value` | json | Cuando `type` es un secreto (contraseña, token). Si no se puede separar por tipo, encriptar siempre. |
| `EdgeHubConfigurations` | `document` | json | Puede incluir credenciales del hub, MQTT o wifi. |
| `InstallationReports` | `signature` | json | Firma manuscrita del cliente. |

## P2 — Datos personales

### Contacto

| Entidad | Propiedades |
| --- | --- |
| `Identities` | `email`, `phone` |
| `Customers` | `email`, `phone` |
| `Companies` | `email`, `phone` |
| `CompanyBranches` | `email`, `phone` |
| `ContactMessages` | `email`, `phone` |
| `Invitations` | `email` |
| `PhoneVerifications` | `phone` |
| `Subjects` | `username`, `email` |
| `Installations` | `contactPhone` |

Los nombres (`name`, `nameNormalized`, `contactName`) **no se cifran en ninguna entidad**, para que se pueda filtrar
por ellos: ver [Nombres: sin cifrar para poder filtrar](#nombres-sin-cifrar-para-poder-filtrar).

### Domicilio y geolocalización

| Entidad | Propiedades |
| --- | --- |
| `Locations` | `addressStreet`, `addressNumber`, `addressUnit`, `addressPostalCode`, `positionLatitude`, `positionLongitude`, `positionAltitude`, `proposedPositionLatitude`, `proposedPositionLongitude`, `proposedPositionAltitude` |
| `Invitations` | `addressStreet`, `addressNumber`, `addressUnit`, `addressPostalCode` |
| `CompanyBranches` | `addressStreet`, `addressNumber`, `addressUnit`, `addressPostalCode`, `positionLatitude`, `positionLongitude`, `positionAltitude` |

`addressCity`, `addressProvince` y `addressCountryCode` pueden quedar en texto plano: por sí solos no identifican a nadie.

### Personas monitoreadas

| Entidad | Propiedades |
| --- | --- |
| `Subjects` | `attributes`, `observations` |

### Identificadores de red y de dispositivos

| Entidad | Propiedad |
| --- | --- |
| `ContactMessages` | `ip` |
| `DeviceConnections` | `macAddress` |
| `Devices` | `serialNumber` |

### Copias en JSON

Si se encriptan los campos originales y estas copias quedan en texto plano, la protección no sirve.

| Entidad | Propiedades |
| --- | --- |
| `Quotes` | `customerSnapshot`, `locationSnapshot`, `acceptedBy` |
| `InstallationReports` | `customerSnapshot`, `locationSnapshot`, `contact`, `technician` |

### Texto libre

Los usuarios suelen escribir datos personales en estos campos.

| Entidad | Propiedades |
| --- | --- |
| `ContactMessages` | `message` |
| `Installations` | `notes`, `ratingComment`, `suspendedReason`, `cancelReason`, `reopenReason` |
| `InstallationReports` | `notes`, `summary` |
| `Quotes` | `notes` |

## P3 — Condicional

| Entidad | Propiedad | Condición |
| --- | --- | --- |
| `Companies` | `taxId`, `licenseNumber` | De una persona jurídica suelen ser públicos; si la empresa es unipersonal, son datos de una persona. |
| `Identities` | `subject` | Id del usuario en el IdP; lo vincula con cuentas externas. |
| `Identities`, `Companies`, `CompanyDocuments`, `Files`, `InstallationFiles` | `pictureKey`, `licenseFileKey`, `objectKey` | No hace falta encriptarlos si el bucket es privado y se accede con URLs firmadas. |

## No requieren encriptación

- `codeHash` en `Invitations` y `PhoneVerifications`: ya está hasheado, que es mejor que encriptado.
- Catálogos (`Countries`, `Currencies`, `Units`, `DeviceModels`, `Capabilities`, …).
- Ids, fechas, estados y contadores.

## Búsqueda sobre datos encriptados

Con encriptación aleatoria (por ejemplo AES-GCM) ya no se puede filtrar, ordenar ni usar como clave única el campo
encriptado. Para los campos por los que se busca (`email`, `phone`, `username`):

- guardar el valor encriptado y una columna con un hash HMAC con clave (`emailHash`, `phoneHash`, `usernameHash`) para
  buscar por igualdad y para las claves únicas; o
- usar encriptación determinística, que permite la igualdad pero revela qué filas tienen el mismo valor.

### Nombres: sin cifrar para poder filtrar

**`name` y `nameNormalized` no se cifran en ninguna entidad** (tampoco `Installations.contactName`). Los nombres se
filtran por partes (`contiene`, `empieza con`) y con el valor cifrado eso es imposible: el cifrado de λORM es aleatorio,
y ni un HMAC ni un cifrado determinístico permiten buscar por partes.

`nameNormalized` es una copia del nombre normalizada para filtrar: sigue la misma regla que `name`.

Es una decisión de riesgo aceptado (RGPD art. 32): un nombre solo no localiza ni contacta a la persona; el email, el
teléfono, la dirección y las coordenadas, sí, y esos van cifrados. Queda documentada en el análisis de riesgos.

Si en el futuro hiciera falta cifrarlos, las alternativas son un índice de prefijos con HMAC (`nameTokens`) o filtrar
en la aplicación sobre conjuntos acotados (por ejemplo, los `Subjects` de una `Location`).

| Entidad | Propiedad | Búsqueda | Mecanismo |
| --- | --- | --- | --- |
| `Identities`, `Customers`, `Companies`, `CompanyBranches`, `Invitations`, `Subjects` | `email` | igualdad, única | `emailHash` (HMAC) |
| `Identities`, `Customers`, `Companies`, `PhoneVerifications` | `phone` | igualdad | `phoneHash` (HMAC) |
| `Subjects` | `username` | igualdad, única | `usernameHash` (HMAC) |
| Todas | `name`, `nameNormalized` | cualquiera (`contiene`, `empieza con`, orden) | texto plano |

Las claves de HMAC son distintas de la clave de encriptación y se guardan fuera de la base de datos.

Las coordenadas encriptadas no admiten consultas por rango. Si se necesitan consultas geográficas, guardar una versión
de menor precisión (por ejemplo, un geohash corto) en texto plano.

## Longitud de columnas

El valor encriptado ocupa más que el original (IV, tag y base64). Hay que ampliar las propiedades `string` con `length`
(por ejemplo, `phone` tiene `length: 32` y no le alcanza) o pasarlas a `text`.

## Implementación en el schema de Ilusor

El schema (`ilusor/dev/cloud/data-gateway/workspace/ilusor/lambdaORM.yaml`) cifra cada propiedad de las listas P1 y P2
con `writeValue`/`readValue`. λORM usa `CryptoJS.AES` con una frase de paso: el resultado es aleatorio (`U2FsdGVkX1…`,
base64), así que no se puede filtrar, ordenar ni usar como clave única el campo cifrado.

| Tipo original | Tipo nuevo | `writeValue` | `readValue` |
| --- | --- | --- | --- |
| `string`, `text`, `buffer` | `text` | `if(isNull(x)){null}else{encrypt(x,$DATA_SECRET_KEY)}` | `if(isNull(x)){null}else{decrypt(x,$DATA_SECRET_KEY)}` |
| `decimal` | `text` | `…encrypt(toString(x),…)…` | `…toNumber(decrypt(x,…))…` |
| `json` | `text` | `…encrypt(stringify(x),…)…` | `…parse(decrypt(x,…))…` |

- **Nulos.** `iif` evalúa sus dos ramas y `decrypt(null)` lanza un error: la guarda es un bloque `if(isNull(x)){…}`, que
  se evalúa de forma perezosa. Sin ella, `encrypt(null)` además guardaría un texto cifrado en lugar de `null`.
- **La clave.** Se escribe `$DATA_SECRET_KEY`: **un solo `$` y sin comillas**. Es una variable de ambiente de 3xpr,
  que la lee de `process.env` al evaluar la expresión, así que el schema cargado nunca contiene la clave.

  | Cómo se escribe | Con qué clave cifra λORM |
  | --- | --- |
  | `encrypt(x,$DATA_SECRET_KEY)` | ✅ el valor de la variable de ambiente |
  | `encrypt(x,"${DATA_SECRET_KEY}")` | el valor, pero reemplazado al cargar el schema: `/schema`, `/domain` y el IDE lo muestran |
  | `encrypt(x,"$$DATA_SECRET_KEY")` | ❌ el texto literal `"$$DATA_SECRET_KEY"`: cifra y descifra sin error, pero con una frase escrita en el schema |
  | `encrypt(x,$$DATA_SECRET_KEY)` | ❌ error de sintaxis |

  Probado con λORM 3.8.1 (la versión del gateway) escribiendo y leyendo un registro en Postgres. Los ejemplos de core
  que usan `"$$…"` (`devicenet`, `devicenet-sync`) cifran con el texto literal.

  `DATA_SECRET_KEY` (64 caracteres hexadecimales, `openssl rand -hex 32`) está en `cloud/.env`, el compose se la pasa al
  contenedor y `data-gateway.config.yaml` solo al worker del schema `ilusor` (su `process.env`). **Si se pierde la
  clave, se pierden los datos cifrados**: guárdala fuera del servidor, aparte de los backups.
- **Los buffers** (`BiometricSamples.vector`) se guardan como el base64 del contenido, cifrado.
- **Las columnas** pasaron a `text` en Postgres (sin los `dbType` `double precision`, `jsonb`, `bytea` e `inet`).
- **Los datos existentes** se cifraron una vez con el mismo algoritmo y las mismas conversiones (`String(n)`,
  `JSON.stringify`). El backup previo está en `~/ilusor-backups/pre-encryption-<fecha>/`.
- **Los servicios Go** leen y escriben Postgres directamente y no conocen el cifrado: quedan detenidos hasta que sus
  repositorios trabajen a través del Data Gateway.

### Resuelto: la clave ya no se expone en el schema

Con `"${DATA_SECRET_KEY}"` el Data Gateway devolvía la clave en `/schema`, `/domain`, `/entities`, `describe` y la
herramienta MCP, porque reemplaza `${…}` al cargar el schema. Con `$DATA_SECRET_KEY` el schema cargado solo tiene el
nombre de la variable. La clave estuvo expuesta mientras se usó `${…}`: conviene rotarla (y volver a cifrar los datos).
