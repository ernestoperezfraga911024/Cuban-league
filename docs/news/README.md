# Noticias

Sección pública de actualidad para los 20 clubes de LaLiga 2026/27. Diseño compacto con escudos, fotografías del catálogo, filtros, detalle adaptable a móvil, fuentes y fechas. El contenido se consulta solo al entrar en Noticias. La paginación y los filtros en servidor evitan descargar todo el histórico; las imágenes se cargan de forma diferida.

## Publicación

El esquema nuevo `league_news` mantiene borradores, estado editorial, claves estables y reintentos. Las tablas públicas ofrecen solo lectura con RLS; las retiradas quedan ocultas. Los administradores autorizados pueden elegir Automático o Manual, publicar en un clic y retirar/restaurar noticias. No se alteran registros de pronósticos, historial, puntos ni catálogo.

La migración `migration.sql` es aditiva y se aplica una vez en el proyecto existente. El recolector utiliza las funciones privadas mediante la conexión ya disponible. No hay función de escritura anónima ni credenciales nuevas. El RPC de administración comprueba la sesión y la autorización existente, controla versiones y conserva el mismo identificador tras una respuesta perdida.

## Lectura editorial

El protocolo actual está en `coverage-automation.txt`. Se incorpora a la tarea horaria existente: el servidor abre noticias a las 08:00, 11:00 y 14:00 America/New_York y retoma pendientes en las ejecuciones horarias, sin alterar los turnos de alineaciones ni el historial. La ampliación y actualización extraordinaria del 13/11/2026 están autorizadas. No se añade otra tarea ni servicio.

Se leen índices y artículos de FutbolFantasy, Jornada Perfecta y Comuniate; las confirmaciones se contrastan en fuentes oficiales cuando están disponibles. Los rumores se identifican como tales. Resúmenes y lectura fantasy son propios; no se copian artículos o fotos. Una ausencia en Copa/selección no se convierte en baja de LaLiga. Las fechas de consulta no sustituyen las fechas de publicación. Si falta zona horaria, se conserva la fecha observada como etiqueta sin inventar una hora UTC.

Los jugadores de la primera carga ya están en el catálogo. Un rumor no cambia su club. La tarea periódica no inventa identidades ni modifica por sí sola los archivos del catálogo: una alta futura requiere verificar identidad y club real y utilizar el flujo de catálogo autorizado. Si todavía falta esa ficha, la noticia puede aparecer sin fotografía ni ID inventado.

## Verificación y límites

`tests/news-db.test.cjs` ejecuta PostgreSQL local con PGlite: permisos, validación, Automático/Manual, reintentos, retirada persistente y conservación del roster. `tests/news.test.cjs` comprueba carga diferida, filtros, contenido escapado, error de refresco y repetición segura de comandos administrativos con JSDOM. Se usan dependencias ya instaladas, sin instalaciones ni servicios adicionales.

Las actualizaciones dependen de que la tarea y las fuentes estén disponibles; no se promete ejecución exacta al minuto. La ampliación `coverage.sql` exige registrar los 20 clubes y los acontecimientos publicados, descartados o pendientes. No hay límite editorial de dos por club ni de 20 por turno. El cierre exige terminar la revisión y resolver la cola; leer tres índices por sí solo no acredita cobertura completa. La página distingue progreso, cobertura parcial y última revisión.

Despliegue: revisar y probar la migración aditiva, aplicarla conservando filas y permisos, activar únicamente el bloque de Noticias de la tarea existente y verificar publicaciones reales. El lector anterior sigue siendo compatible; los turnos incompletos mantienen `result=partial`. Alineaciones, historial, puntos y catálogo permanecen intactos. Los cambios de otros PR pendientes no forman parte de esta ampliación.

Una reversión visual debe conservar la cola y el recolector compatibles. No eliminar tablas, pendientes ni noticias publicadas. El lector anterior puede seguir mostrando las publicaciones; una reversión del productor exige mantener el registro y la recuperación del trabajo ya iniciado.
