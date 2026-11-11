# Prueba completa de la jornada 13

La sección pública permite elegir los veinte clubes del catálogo y muestra un solo once cada vez. Las formaciones conservan sus líneas, las fotos y escudos proceden del catálogo existente y los motivos se abren al tocar un jugador. La carga requiere dos lecturas públicas al entrar; cambiar de club no genera consultas adicionales. Un error o una retirada elimina el once de la pantalla.

La ampliación está limitada a los diez partidos del 20–23 de noviembre de 2026. No configura nuevos horarios ni amplía la automatización del Madrid. Los porcentajes mantienen editorial-v2: fuentes 80%, rol 20%, ajustes explícitos y alternativas fuera del once bajo 70. Son estimaciones provisionales sin calibrar.

## Almacenamiento y publicación

`round.sql` agrega un esquema privado con una copia de identidades del catálogo y los partidos comprobados. No cambia el catálogo de la liga. Admite como máximo tres lotes de prueba, veinte equipos por lote y 64 KiB por equipo. Las funciones son invoker y no están concedidas a roles de cliente.

`forecast_league.save_batch(key, payload)` exige tres fuentes distintas por equipo, URLs del partido/equipo registrado, lectura de menos de dos horas, once identidades del club, evaluación reproducible y alternativas válidas. Una fuente no verificada obliga a `blocked` y `proposal:null`. Se conserva la lectura en privado y se prepara una proyección pública sin evaluaciones internas. La misma clave solo admite el mismo contenido.

`forecast_league.publish_batch(key, request_uuid)` vuelve a comprobar antigüedad y comienzo del partido y publica las proyecciones válidas en una sola transacción. El mismo UUID no duplica la publicación. Rechaza sobrescribir una publicación posterior al lote. El lector anónimo solo accede a la proyección; no obtiene borradores, claves administrativas ni permisos de escritura.

El Madrid sigue pasando por `forecast_pilot.save_draft` y `forecast_publish.command_delivery`, con sus límites y controles existentes. Solo los otros diecinueve equipos entran en `forecast_round_public`. Así, retirar manualmente la publicación del Madrid sigue siendo definitivo y las próximas entregas usan la misma autoridad. El modo de entrega no cambia. Esta prueba no añade un editor administrativo para los otros diecinueve clubes.

Para revertir la presentación basta revertir el PR: el Madrid sigue disponible por su ruta anterior. Los registros privados permanecen como auditoría. La retirada de publicaciones de esta prueba se hace mediante la conexión administrativa y filtrando su `run_key`; no desde el navegador ni borrando otras tablas.

## Comprobaciones

Pruebas unitarias: partidos, fuentes, puestos, alternativas, retirada del Madrid, veinte selectores, errores y consultas diferidas. Prueba de base de datos: proyecciones de los veinte equipos, fechas inválidas, cruces de identidades, porcentajes inconsistentes, fuentes repetidas, bloqueo, permisos, guardado/publicación e idempotencia; todas las escrituras de prueba se revierten antes del commit de la migración.

`scripts/check-forecast-round-browser.cjs` recorre los veinte clubes y 220 nombres, comprueba el sistema mostrado y mide el diseño a 320, 390, 768 y 1280 píxeles. Puede usar proyecciones reales preparadas mediante `FORECAST_REAL_BATCH`; todas sus respuestas de publicación están interceptadas y no envía escrituras reales. La verificación final de producción debe consultar por separado la web desplegada y la API pública.

La suite general contiene una aserción histórica desactualizada sobre el hash del catálogo en `editorial-redesign.test.cjs`. El catálogo de esta rama coincide byte a byte con su base; no se modifica esa aserción para ocultar el fallo.
