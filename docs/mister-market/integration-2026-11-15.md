# Mercado y archivo histórico: integración del 15/11/2026

Estado: PR119 en borrador. Código preparado y probado; archivo privado real instalado. La proyección pública sigue **oculta** y no hay lector programado activo. No se han cambiado reglas, puntos, catálogo ni resultados deportivos.

## Datos y límites

- Una misma captura alimenta Mercado y las 20 plantillas: 538 futbolistas, 275 con propietario y 263 libres. Fecha observada: `2026-11-15T19:05:16.845Z` (14:05 Miami).
- La verificación anterior contrastó las 20 plantillas y 538 fichas. La captura posterior no tenía cambios ni faltantes; el preparador solo admite ese avance sin una nueva verificación si propietarios, importes, catálogo, participantes y clubes siguen iguales.
- Se conservan las dos capturas, 1.842 movimientos de fichas y 391 operaciones del portal. Las fichas contienen 443 clausulazos explícitos; el portal contiene 132. No se suman ambas fuentes: 131 coincidencias por tupla no equivalen a una conciliación de IDs. Una operación del portal aún no tiene correspondencia en las fichas.
- La interfaz etiqueta las estadísticas como **Historial recuperado / Cobertura parcial**, calculadas exclusivamente con las 443 operaciones de fichas. Gastos y cobros suman por separado 4.425.536.642; cada subtotal de los 20 participantes coincide con el informe original. Son importes históricos de operaciones, no valores actuales ni dinero real.
- Mister solo expuso hasta cinco movimientos por ficha; 226 fichas alcanzaron ese límite. No afirmar cobertura completa de la temporada ni que se recuperaron todos los clausulazos anteriores.

## Almacenamiento y privacidad

Migración `supabase/migrations/20261115193913_mister_market_archive.sql`, creada con CLI y alineada con la versión registrada por la base. **Ya aplicada** exclusivamente a Cuban League (`pyahosamoisqcbpvzwka`). No volver a ejecutarla en ese proyecto.

- `mister_market.archives`: exportación explícita del lector, comprimida con gzip, hash SHA-256 del cuerpo comprimido y del JSON sin comprimir. Una clave por contenido; UPDATE y DELETE rechazados. RLS activado y sin privilegios para visitantes, usuarios autenticados o service_role.
- `public.mister_market_public`: proyección limitada a participantes, futbolistas, precios, propietarios y operaciones necesarias para la vista. SELECT para visitantes/usuarios solo cuando `visible=true`; sin escritura desde el cliente.
- `mister_market.stage`: operación privada, invoker, sin EXECUTE para roles de la web. Archivo y proyección se guardan en una transacción; control de revisión, captura antigua y duplicados. Cada revisión nueva queda oculta. Repetir la misma publicación no duplica el archivo; archivos nuevos se conservan incluso si la proyección no cambió.
- `mister_market.publish`: operación privada que exige la revisión exacta. **No ejecutada**. No se crea una credencial de automatización ni se distribuye una clave privilegiada.
- La migración añade objetos nuevos; no toca tablas, funciones o permisos anteriores.

Archivo real verificado en la base: SHA-256 `493eb50a95714a80e41ad825381d81069aa43c89d49a86e5feb0fb8eff597f86`; 105.329 bytes comprimidos y 1.234.034 bytes de JSON compacto. El archivo original formateado ocupa 2.028.467 bytes. La diferencia es formato/compresión, no pérdida de registros.

Revisión preparada: `9c706a412d4c1fa1bd4e9845fbcbcc78bc3608c5c8803afe0a33dc85967783d9`. Lectura SQL comprobada: 538 jugadores, 20 participantes, 443 operaciones de fichas, integridad correcta, `visible=false`. La consulta como `anon` devuelve cero filas.

## Preparación y restauración

Preparar desde una exportación privada ya validada; nunca incluir `auth.json`:

```sh
node scripts/mister-market/publication.cjs backup.json data.json prepared.json
```

El preparador resuelve participantes por nombre normalizado exacto y exige una relación de uno a uno. Los nombres ambiguos, participantes desconocidos, verificación incompleta o cambios sin contrastar bloquean la preparación. `prepared.json` es privado y no debe entrar en Git, logs o artefactos públicos.

Para recuperar un archivo, un operador autorizado exporta **una sola fila** con estos alias desde la base privada a `archive.json`:

```sql
select sha256, raw_sha256 as "rawSha256", raw_bytes as "rawBytes",
       encode(body,'base64') as "compressedBase64"
from mister_market.archives
where sha256 = '<hash del archivo elegido>';
```

```sh
node scripts/mister-market/restore-archive.cjs archive.json recovered-backup.json
```

El restaurador valida ambos hashes, tamaño, liga, temporada, capturas, registro del portal e informe de cláusulas. Limita la descompresión a 30 MB y se niega a sobrescribir un destino existente. La recuperación real comprobó las dos capturas, 391 eventos del portal y 1.842 movimientos de fichas.

## Vista y rendimiento

Mercado se abre desde Más o `?section=market`. Busca por futbolista, club o propietario; filtra libres, participante y posición; ordena por valor, cláusula o nombre. Precios exactos, cláusula de libres como `—`, sin convertir ausencias en cero. Render inicial limitado a 40 filas y ampliable.

Clausulazos ordena por dados, recibidos, gastado o cobrado; conserva empates y permite consultar las operaciones fechadas. No inventa una fecha para el portal. Equipo actual se añade a cada perfil sin sustituir la pestaña Equipo ni sus estadísticas de temporada; agrupa plantilla completa por posición.

Una sola solicitud diferida comparte la captura entre Mercado y perfiles. Caché únicamente en memoria durante dos minutos; sin consulta en Inicio. Respuestas inválidas o errores no se muestran como plantilla vacía. Capturas de más de 24 horas llevan aviso. No hay consulta a Mister desde la página pública ni llamadas a modelos de IA.

## Validación y pendientes

Pruebas de lector, preparación/restauración, PGlite, interfaz DOM, navegación, PWA, perfil, marca y alineaciones: 126 casos relevantes; la comprobación de versión de instalación se actualizó y se volvió a ejecutar después de detectar su referencia antigua a app.js.

Revisión visual en navegador: Mercado de escritorio, filtro Ernesto (11 jugadores), búsqueda/ordenación, ranking de clausulazos y perfil con Equipo actual (11 jugadores, valor 83.317.000). Vista de 390 px: Mercado, ranking y perfil; sin desbordamiento horizontal del documento. El entorno de prueba usa la proyección preparada y no escribe visitas ni datos deportivos de producción.

La comprobación heredada de `tests/editorial-redesign.test.cjs` que compara el catálogo con V174 sigue fallando por un hash anterior a este PR; `catalog/players.json` es idéntico al HEAD de partida. Los otros 12 casos de ese archivo aprobaron. No se actualizó esa referencia histórica para ocultar la discrepancia. También permanecen idénticos `data.json`, `admin.js`, `supabase-config.js` y `styles.css`.

Antes de activar 04:00/17:00 Miami: conciliar fuentes sin duplicar operaciones, probar lectura desde el ejecutor elegido, instalar transporte privado con permisos mínimos, probar recuperación de sesión/errores y publicación completa. La periodicidad debe usar `America/New_York`. No crear una automatización recurrente de ChatGPT para reemplazar el programa. Esta integración no activa horarios ni consume IA durante las futuras ejecuciones deterministas.

La revisión/publicación del PR y de la proyección se hará por separado. Retirada reversible de la vista: `visible=false`; se conserva el archivo histórico y no se elimina evidencia.
