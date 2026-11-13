# Noticias por día

El feed se agrupa en «Hoy», «Ayer» y fechas completas, desde la más reciente. Las fechas relativas usan el calendario de Miami. Cada día es una sección accesible; los filtros de club/tipo y el detalle móvil/escritorio siguen funcionando dentro de los grupos.

## Fecha utilizada

`news_public.news_day` se calcula al publicar o cambiar el payload. Representa el día de la información más reciente entre las fuentes de la noticia:

- Se priorizan `published_at` y `source_updated_at` con zona explícita, convertidos a Miami.
- Si la fuente carece de timestamp válido, se conserva el día escrito en `published_label` (DD/MM/YYYY o fecha española), sin inventar una zona.
- `fetched_at`, la fecha de importación/publicación interna y el nombre de la clave nunca deciden el grupo.
- Las noticias sin fecha verificable aparecen al final en «Sin fecha confirmada».

La columna es derivada: no modifica el payload, las fuentes, el historial editorial ni las lesiones. Las publicaciones existentes con columnas explícitas siguen funcionando; las futuras obtienen el día automáticamente. La función no usa la fecha actual ni depende de la zona o formato de fecha de la sesión.

## Rendimiento y compatibilidad

La consulta conserva 40 noticias más una de comprobación por petición y pide las siguientes solo con «Ver más noticias». Orden global en Postgres: `news_day DESC NULLS LAST, updated_at DESC, key ASC`. El cursor contempla días conocidos y desconocidos, conserva los microsegundos originales y evita descargar el archivo completo. Índices parciales para el feed visible y para club. Los índices anteriores se conservan porque las alineaciones siguen consultando su contexto con el orden anterior.

Los encabezados relativos se actualizan al cambiar de día sin nuevas consultas ni reconstruir los artículos. El temporizador se detiene al salir de Noticias.

## Despliegue

1. Aplicar `by-day.sql` antes de publicar el cliente v223. Es una migración aditiva y transaccional, con límite de espera de bloqueo; no cambia RLS, permisos de tablas ni datos editoriales.
2. Comprobar los hashes de los datos protegidos y consultar el nuevo orden con la clave pública, incluyendo las páginas siguientes y filtros.
3. Publicar los archivos del PR, comprobar la web y la caché v223.

Para revertir la presentación basta con volver a los archivos del cliente anteriores; la columna e índices adicionales son compatibles con ellos. No es necesario borrar ni reescribir noticias.

## Pruebas

`tests/news-days-db.test.cjs` cubre extracción de fechas, errores tolerados, inmutabilidad, compatibilidad de publicación e índices. `tests/news-days.test.cjs` cubre grupos, fechas antiguas importadas hoy, páginas que comparten día, transición a fechas desconocidas, filtros, detalles, datos inválidos, medianoche en Miami y horario de verano. Las pruebas previas de noticias siguen cubriendo cancelación, errores, reintentos, carga diferida y estado de cobertura.
