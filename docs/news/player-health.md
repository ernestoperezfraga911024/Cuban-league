# Noticias del club e iconos de FutbolFantasy

Actualización autorizada: 16/11/2026. El estado físico es una decoración independiente del pronóstico. No altera porcentajes, selección del once, alternativas, posiciones, catálogo ni datos históricos.

## Fuente de los iconos

La vista pública obtiene el icono exclusivamente de `public.forecast_health_public`, a partir de una observación directa del equipo en FutbolFantasy. Valida el club, ID del jugador, temporada, jornada, dominio de la fuente, fecha de lectura y estado. No consulta Comuniate o Jornada Perfecta para decidir este icono y ninguna noticia, aunque sea posterior, puede sustituirlo.

| Estado FF guardado | Presentación |
| --- | --- |
| `injured` | Cruz roja |
| `doubt` | Interrogación ámbar |
| `available` | Sin marca; detalle FF disponible al abrir el jugador |

Un estado sin lectura FF válida no genera símbolo. La ausencia de símbolo no acredita por sí sola un alta médica. El detalle conserva la observación propia atribuida a FutbolFantasy, su enlace y la fecha real de revisión. El icono no es una señal de probabilidad y no determina qué jugador ocupa un puesto.

El flujo de salud conserva las funciones existentes `forecast_health.save_batch` y `forecast_health.deliver`, su control de identidad y su modo Automático/Manual. Esta presentación no añade escrituras ni cambia los contratos SQL. Lecturas fallidas y casos no resueltos deben conservarse con su trazabilidad, nunca resolverse cambiando el pronóstico.

## Noticias independientes

Las noticias siguen procediendo de `public.news_public` y conservan sus fuentes habituales. Se filtran por club y por identidad al abrir la ficha, con paginación propia. Un objeto opcional `players[].health` en una noticia sigue siendo información histórica de esa publicación; la vista no lo transforma en icono, no lo cruza con FF y no lo utiliza para calcular o corregir una alineación.

La carga de iconos solo consulta el estado FF del club seleccionado. No descarga el historial completo de noticias médicas. Un fallo de Noticias conserva los iconos FF disponibles; un fallo de Salud conserva el once y las noticias, muestra el error y permite reintentar sin deducir un estado de los artículos.

## Once y plantilla

El once conserva sus once jugadores, porcentajes, alternativas y posiciones publicados. **Resto de la plantilla** muestra las identidades activas del catálogo fuera del once y sus estimaciones publicadas cuando existen. Los iconos pueden acompañar tanto a titulares como a jugadores de esa lista; no los excluyen ni los reordenan.

Las publicaciones `editorial-v6` se muestran con sus cuatro fuentes y explican que el cálculo depende solo de esas observaciones. Las publicaciones antiguas mantienen sus cifras y método. Administración e historial no reciben este contexto público y conservan su comportamiento.

## Verificación y reversión

Las pruebas comprueban fuente FF exclusiva, ausencia de sustitución por noticias recientes, errores de Salud y Noticias independientes, identidad por club/jugador, once y alternativas intactos, compatibilidad v6 y antigua, cancelación de respuestas tardías, foco y paginación. Para revertir la presentación basta restaurar los assets anteriores; no hay tablas o publicaciones que revertir por este cambio de interfaz.
