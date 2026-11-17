# Ausencias de jugadores libres — 17/11/2026

El disparador interno arrancó a las 04:00 y 09:00 Miami. El bloqueo fue del lector:
missing_catalog_players. El diagnóstico 44107565397 repitió el catálogo completo:
529 jugadores (253 libres/276 con dueño), frente a 538 previos. Los mismos nueve
IDs faltaron en ambas lecturas:67931,70499,71019,71505,71622,1153038,2586746,
3368896,4947928. Todos estaban libres y ninguno participa en cláusulas guardadas.
La ausencia observada en el buscador no demuestra una retirada deportiva.

La regla previa exigía que el catálogo nunca perdiera un ID. Ahora una captura
incompleta se repite una sola vez. Solo se evalúa como ausencia persistente un
conjunto de hasta 20 jugadores, como máximo 5% del catálogo previo, antes libres
y sin referencia en el historial público. Los dos catálogos completos deben
coincidir en jugadores, valores, propietarios, contexto y movimientos.

Antes de aceptar esas ausencias, otra búsqueda de libres por cada club afectado
debe devolver exactamente los jugadores actuales esperados, incluidos sus valores,
posición e identidad, sin ninguno de los ausentes. Se comprueban filtros,
paginación, liga y portal estable. Un club sin ninguna fila legible queda bloqueado.
Después se verifican las 20 plantillas y se concilia todo el historial habitual.

El archivo conserva catalogAbsences de forma acumulativa: filas anteriores exactas,
última fecha de observación y pruebas de ambos catálogos y búsquedas por club.
Mantiene también la captura base y todos sus perfiles. El catálogo público muestra
solo datos leídos ahora; no inventa valores actuales, ventas, retiros ni fechas.
Si un jugador tiene cláusulas o estaba en una plantilla, continúa el bloqueo.
No cambia esquema público, puntos, participantes, calendario ni reloj.

Pruebas: market-catalog y market-public, además del resto del lector.
Estado: confirmado en búsqueda real por siete clubes y publicación verificada; evidencia abajo.

## Comunidad activa al iniciar

El diagnóstico 44111187399 encontró el portal abierto y una comunidad activa, pero
la espera del enlace activo de 649733 agotó veinte segundos. El lector ahora
selecciona al empezar el enlace existente de esa comunidad, con origen y destino
exactos, y verifica el resultado. Si no existe ese acceso, se detiene. Un cambio
de liga durante la captura bloquea la lectura; nunca se mezcla información.
Arranque en la liga correcta y publicación real verificados. La rama que cambia desde otra comunidad está probada por regresión; no se forzó la selección del usuario en producción.

## Comprobación real

Test 44112318960: 17/11/2026, 10:20:17 Miami. Dos catálogos, siete búsquedas
por club, nueve ausencias confirmadas y veinte plantillas verificadas. La copia
pública anterior permaneció idéntica durante la prueba.

Sync 44113488818: publicó a las 10:24:47 Miami, SHA 05f840e73cb2db67f0f8ed349b2a2f9be5bebf04,
revisión 7133d9e9a709c620bec214ca51ab7a858d840960612f62745e9c5babe2c24f0b.
529 jugadores, 20 participantes, 447 cláusulas y 446 fechas. Conservó las 445
fechas previamente conocidas y recuperó L. Rioja, 17/11/2026, por 3.282.000.
La fecha antigua de F. De Jong sigue pendiente; no se inventó. Se verificaron
importe/partes por grupo, perfiles completos, captura base y las nueve filas
archivadas, también después de esta segunda ejecución. Cero gaps, errores de
perfiles e IA. Un catálogo, una ficha pendiente y 136.669 ms de lectura.

El reloj interno y el worker permanecen habilitados; cron por minuto y modo sync.
Esta recuperación fue extraordinaria. No acredita por sí sola el próximo turno
programado. 89 regresiones locales del lector aprobadas; la prueba intermitente
de Predicted11 del control general consta como ajena en las revisiones.
