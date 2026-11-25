# Backoffice en el IDE (G6)

> **Estado (2026-11-25): decisiones de §6 cerradas (las recomendadas, el usuario); fases 1 a 3 hechas** (rama
> `feature/backoffice`): la tabla editable y exportar (CSV, JSON y un `.xlsx` escrito por el IDE, validado con
> openpyxl). Falta la wiki; archivos y paneles en G6b. G6 de [`PENDINGS.md`](PENDINGS.md) §3 (brecha 5.1). No
> depende de core: usa las operaciones de la gateway (`execute`) con la identidad de la connection (su vista, G2).

## 1. Objetivo

Que alguien que no escribe consultas pueda **ver y corregir los datos** de una entidad desde el IDE, como en un
backoffice (Directus, Hasura console): hoy la pestaña **Data** de una entidad es una tabla de solo lectura, de a páginas.

## 2. La tabla editable

En **Data**, con una credencial con `write` y una entidad con clave primaria (no abstracta):

- **Editar una celda** (doble clic): un input por su tipo (texto, número, sí/no, fecha, enum); Enter guarda con
  `Entity.update(p => ({ field: value })).filter(p => <la clave> && p.field == <el valor que se leyó>)`: si otro la
  cambió mientras tanto, no cambia nada y la tabla lo dice (decisión 2) y la recarga.
- **Agregar una fila:** un formulario con las propiedades de la entidad (las requeridas marcadas) → `Entity.insert()`.
- **Borrar una fila:** con confirmación → `Entity.delete().filter(p => <la clave>)`.
- **Ordenar** por una columna (clic en su encabezado) y **filtrar** con una condición (`p.price > 10`, con el
  autocompletado del editor).
- Los errores de la gateway (validación, `ViewError`, una restricción de la base) se muestran en la fila.
- Sin `write`: como hoy, de solo lectura.

Todo pasa por `execute` con la credencial de la connection: los permisos, la vista (lo enmascarado no se edita: una
propiedad con `readExp` en la vista es de solo lectura en la tabla) y la auditoría son los de la gateway.

## 3. Exportar

Desde **Data** y desde el resultado de una consulta: **la página** o **todo** (pidiendo de a páginas, hasta un tope, con
progreso y cancelar) en **CSV**, **JSON** y **Excel** (decisión 3).

## 4. Después (G6b)

- **Archivos** (S3, Azure Blob): subir y ver los archivos de una propiedad (una URL o una clave de objeto). Necesita
  una configuración de almacenamiento en la gateway y firmar URLs: una pieza propia.
- **Paneles:** un tablero con consultas guardadas como tarjetas (un número, una tabla, un gráfico).

## 5. Lo que no es

No es un editor de esquema (eso son los formularios de la administración) ni un importador masivo (eso es `import`).

## 6. Decisiones

| # | Tema | Recomendación | Alternativa |
| --- | --- | --- | --- |
| 1 | Alcance ahora | **Tabla editable y exportar**; archivos y paneles en G6b | Todo junto |
| 2 | Dos personas editan la misma celda | **Chequeo optimista**: el update filtra también por el valor leído; 0 filas → "cambió mientras tanto" | El último gana |
| 3 | Excel | **`.xlsx` real**, escrito por el IDE (un XLSX mínimo: un zip con XML, sin dependencias nuevas) | Solo CSV (Excel lo abre) |
| 4 | Exportar "todo" | **Hasta 100 000 filas**, de a páginas, con progreso y cancelar | Solo la página |

## 7. Fases

1. La tabla editable (editar, agregar, borrar; ordenar y filtrar) en `@lambdaorm/ui`.
2. Exportar CSV, JSON y Excel (la página y todo).
3. Tests (Vitest) y la wiki (IDE → Entities).
