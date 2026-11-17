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
Estado: pruebas sintéticas; confirmación real por club y publicación pendientes.

## Comunidad activa al iniciar

El diagnóstico 44111187399 encontró el portal abierto y una comunidad activa, pero
la espera del enlace activo de 649733 agotó veinte segundos. El lector ahora
selecciona al empezar el enlace existente de esa comunidad, con origen y destino
exactos, y verifica el resultado. Si no existe ese acceso, se detiene. Un cambio
de liga durante la captura bloquea la lectura; nunca se mezcla información.
Validación real de esta selección y recuperación del mercado todavía pendientes.
