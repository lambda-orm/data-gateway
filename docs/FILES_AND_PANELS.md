# Archivos y paneles (G6b)

> **Estado (2026-11-26): diseño; decisiones de §5 por cerrar.** La fase siguiente del backoffice
> ([`BACKOFFICE.md`](BACKOFFICE.md) §4).

## 1. Archivos

Una propiedad de texto guarda la **clave de un objeto** en un almacenamiento (S3 o Azure Blob): la foto de un
producto, el PDF de una factura. La gateway firma URLs de vida corta para subirlo y para verlo; los bytes van directo
entre quien los sube o los ve y el almacenamiento, nunca por la gateway.

```yaml
# data-gateway.config.yaml (global o por schema)
files:
  storages:
    images:
      type: s3                         # s3 (AWS, MinIO, R2…) o azureBlob
      bucket: shop-images
      region: eu-west-1
      endpoint: http://minio:9000      # opcional: otro S3
      accessKeyId: $S3_KEY
      secretAccessKey: $S3_SECRET
      prefix: products/                # las claves que crea van bajo esto
      maxBytes: 10MB
      types: [image/png, image/jpeg]   # opcional
      expires: 5m                      # la vida de una URL
    invoices:
      type: azureBlob
      account: shopfiles
      container: invoices
      accountKey: $AZURE_KEY
  properties:
    Products.photo: images             # la propiedad y su almacenamiento
    Orders.invoice: invoices
```

- `POST /{schema}/files/{Entity}/{property}/upload` `{ name, type, size }` → `{ key, url, method, headers }`: una URL
  para un `PUT` (el tipo y el tamaño, dentro de lo permitido). Después se guarda `key` en la propiedad con un
  `update`, como cualquier valor. Permiso: `write`.
- `GET /{schema}/files/{Entity}/{property}/url?key=…` → `{ url }`: una URL para leerlo. Permiso: `read`, y la
  propiedad debe estar en la vista de quien pide (lo que su vista excluye o enmascara no se firma).
- También por WebSocket (`files.upload`, `files.url`) y en `management` para el IDE.
- **El IDE:** en la pestaña *Data*, una propiedad con almacenamiento muestra el archivo (una miniatura si es imagen, si
  no su nombre con un enlace) y, con `write`, **Subir** y **Quitar** (quitar borra la clave, no el objeto).

## 2. Paneles

Un **panel** es una grilla de tarjetas en el IDE; cada tarjeta es una consulta guardada o una consulta con nombre y
cómo se muestra:

| Forma | Muestra |
| --- | --- |
| Número | el primer valor del resultado (un `count`, un `sum`) |
| Tabla | las filas |
| Barras, líneas | una columna de etiquetas y una o más de valores |
| Torta | etiqueta y valor |

- Se guarda en el workbench como las consultas y los diagramas (`workbench/panels/<nombre>.yaml`, con
  `workbenchWrite`; si no, en el navegador).
- Se actualiza cada `refresh` (o a mano); con una connection que tiene WebSocket, una tarjeta puede **suscribirse** a
  su consulta (G4) y cambiar sola.
- Corre con la credencial de la connection: su vista y sus permisos.

## 3. Lo que no es

No es un BI (sin cruces, sin filtros globales ni drill-down por ahora) ni un gestor de archivos (no lista un bucket:
solo los objetos que una fila nombra).

## 4. Seguridad

Las claves de los almacenamientos quedan en la gateway; una URL firmada vence en `expires` y sirve para ese objeto y
ese método. Una subida no puede elegir la clave: la arma la gateway (`prefix` + un id + la extensión), así nadie pisa
el objeto de otro.

## 5. Decisiones

| # | Tema | Recomendación | Alternativa |
| --- | --- | --- | --- |
| 1 | Los bytes | **URLs firmadas, directo al almacenamiento** | Subir y bajar por la gateway (más simple para el cliente, la gateway carga los bytes) |
| 2 | La firma | **Propia** (SigV4 de S3 y SAS de Azure, sin SDK; probadas contra MinIO y Azurite) | Los SDK de AWS y Azure (varios MB más en la imagen) |
| 3 | Qué propiedad es un archivo | **En la configuración de la gateway** (`files.properties`) | Un atributo en el `lambdaORM.yaml` (core) |
| 4 | Los gráficos | **SVG propio** (barras, líneas, torta; sin librería) | Una librería de gráficos |

## 6. Fases

1. Firmar: SigV4 (S3) y SAS (Azure), con sus vectores de prueba; la configuración.
2. Las rutas (`upload`, `url`) en `http`, WebSocket y `management`, con permisos y vista; pruebas contra MinIO y
   Azurite en Docker.
3. El IDE: el archivo en la tabla, subir y quitar.
4. Paneles: el modelo, el editor de tarjetas, los gráficos SVG, guardarlos en el workbench, refrescar y suscribirse.
