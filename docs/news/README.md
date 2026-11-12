# Noticias

Sección pública de actualidad para los 20 clubes de LaLiga 2026/27. Diseño compacto con escudos, fotografías del catálogo, filtros, detalle adaptable a móvil, fuentes y fechas. El contenido se consulta solo al entrar en Noticias; filtrar no produce peticiones adicionales.

## Publicación

El esquema nuevo `league_news` mantiene borradores, estado editorial, claves estables y reintentos. Las tablas públicas ofrecen solo lectura con RLS; las retiradas quedan ocultas. Los administradores autorizados pueden elegir Automático o Manual, publicar en un clic y retirar/restaurar noticias. No se alteran registros de pronósticos, historial, puntos ni catálogo.

La migración `migration.sql` es aditiva y se aplica una vez en el proyecto existente. El recolector utiliza las funciones privadas mediante la conexión ya disponible. No hay función de escritura anónima ni credenciales nuevas. El RPC de administración comprueba la sesión y la autorización existente, controla versiones y conserva el mismo identificador tras una respuesta perdida.

## Lectura editorial

El protocolo completo está en `automation.txt`. Se incorpora a la tarea horaria existente: el servidor abre noticias a las 08:00 y 14:00 America/New_York, con hasta dos horas de margen, sin alterar los turnos de alineaciones ni el historial. La primera carga es extraordinaria el 12/11/2026. No se añade otra tarea ni servicio.

Se leen índices y artículos de FutbolFantasy, Jornada Perfecta y Comuniate; las confirmaciones se contrastan en fuentes oficiales cuando están disponibles. Los rumores se identifican como tales. Resúmenes y lectura fantasy son propios; no se copian artículos o fotos. Una ausencia en Copa/selección no se convierte en baja de LaLiga. Las fechas de consulta no sustituyen las fechas de publicación. Si falta zona horaria, se conserva la fecha observada como etiqueta sin inventar una hora UTC.

Los jugadores de la primera carga ya están en el catálogo. Un rumor no cambia su club. La tarea periódica no inventa identidades ni modifica por sí sola los archivos del catálogo: una alta futura requiere verificar identidad y club real y utilizar el flujo de catálogo autorizado. Si todavía falta esa ficha, la noticia puede aparecer sin fotografía ni ID inventado.

## Verificación y límites

`tests/news-db.test.cjs` ejecuta PostgreSQL local con PGlite: permisos, validación, Automático/Manual, reintentos, retirada persistente y conservación del roster. `tests/news.test.cjs` comprueba carga diferida, filtros, contenido escapado, error de refresco y repetición segura de comandos administrativos con JSDOM. Se usan dependencias ya instaladas, sin instalaciones ni servicios adicionales.

Las actualizaciones dependen de que la tarea y las fuentes estén disponibles; no se promete ejecución exacta al minuto. La selección editorial no equivale a revisar los 20 clubes individualmente. La página muestra fecha de revisión, cobertura parcial y aviso de antigüedad. El control visual automatizado con navegador no está disponible en esta ejecución; la validación de interacción utiliza DOM.

Para revertir la interfaz se revierte el commit del PR y se retira únicamente el bloque Noticias del prompt existente. No eliminar tablas ni noticias publicadas como parte de una reversión visual.
