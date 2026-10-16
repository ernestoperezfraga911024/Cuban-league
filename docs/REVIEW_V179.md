# Revisión V179 — carga pública y estabilidad

Fecha: 2026-10-16. Base: `aa5e06b` (V178, PR #48).
Rama: `codex/loading-audit-v179`. Publicación pendiente de integrar el PR.

## Alcance

Abrir la página → leer configuración e historia → consultar jornadas publicadas
en Supabase → calcular con las reglas existentes → mostrar clasificación actual.
Revisión centrada en este recorrido, su actualización periódica, las insignias
y la caché de la PWA. No es una certificación de ausencia de errores en todo el
repositorio ni una auditoría completa de seguridad de la base de datos.

## Hallazgos y correcciones

| Hallazgo comprobado | Corrección |
| --- | --- |
| `index.html` contenía nombres y puntos del podio 2025/26. | Marcado inicial neutro, sin identidades ni puntuaciones antiguas. |
| `renderHeroKpis(null)` interpretaba tanto «consulta pendiente» como «temporada vacía» como pretemporada. | Estados explícitos de carga, éxito, error y datos previamente recibidos. El podio histórico solo aparece tras confirmar cero jornadas. |
| El catálogo bloqueaba todo `init()` y la consulta de milestones retrasaba el podio. | Catálogo en paralelo, esperado solo por las vistas que lo necesitan; clasificación visible antes de milestones. |
| Temporizador, visibilidad y conexión podían lanzar actualizaciones solapadas. | Una promesa compartida y timeout de 15 segundos para consultas base/jornadas/milestones. El modal de alineaciones no bloquea esa promesa. |
| Cada polling reconstruía tablas aunque no cambiaran los datos. | Redibujado solo cuando cambian jornadas, milestones o estado de conexión. |
| Un fallo de milestones vaciaba premios ya confirmados. | Conservar la última respuesta válida ante errores; seguir aceptando respuestas vacías correctas. |
| La firma usada para detectar cambios omitía el puesto de Mister. | Incluir `misterRank`, manteniendo las reglas existentes de desempate de Copa. |
| Un script sin caché podía recibir `index.html` al estar offline. | Fallback al mismo recurso de la app shell, o 504 si falta. Versiones del catálogo público y precaché alineadas. |
| HTTP 5xx ignoraba la copia local; un error al guardar caché descartaba una descarga buena. | Fallback ante 5xx/408 y conservación de respuestas de red correctas aunque falle el almacenamiento. |
| Revalidaciones de imágenes no mantenían vivo el worker hasta terminar de guardar. | Esperar la escritura de caché mediante `event.waitUntil`. |
| Un fallo de `data.json` dejaba un rechazo sin interfaz de recuperación. | Comprobar HTTP y ofrecer un botón para volver a cargar. |

## Verificación

- Base antes del cambio: 74/74 pruebas aprobadas.
- V179: 88/88 pruebas aprobadas con `npm test`; sintaxis de JS y `git diff --check`.
- Pruebas nuevas: HTML inicial, red lenta, petición compartida, podio antes de
  milestones, error inicial, temporada vacía confirmada, recuperación, DOM sin
  reconstrucciones cuando no cambia, historial intacto, milestones fallidos,
  timeout, puesto Mister, catálogo lento, lectura de alineaciones, modal lento,
  fallo inicial de datos y cuatro casos de service worker.
- Los tests heredados verifican Copa, Champions, Liga sin bonus, catálogo,
  importación controlada, guardado en borrador, navegación y perfiles.
- Se mantienen hashes de datos, catálogo, panel, configuración, importador,
  estilos y 627 imágenes/iconos. Se conservan 22 funciones protegidas; seis
  funciones de I/O modificadas ahora se comprueban mediante comportamiento.
- Lectura real con el código V179: ambas consultas HTTP 200, 160 filas publicadas,
  jornadas 1–8, ocho milestones; estado `ready` y «Podio actual» renderizado en
  jsdom. Solo se hicieron lecturas de jornadas y milestones.
- No hay navegador Chromium instalado en este entorno. La interfaz se comprobó
  mediante jsdom; quedan pendientes la inspección visual y la instalación/offline
  reales en Safari/iPhone y Chrome/PC. No se afirma que esos controles se hicieron.

## Preservación y límites

Sin cambios en `data.json`, `catalog/players.json`, imágenes, `admin.js`,
configuración de Supabase, SQL/RLS, credenciales, extensión Mister o fórmulas
de clasificación, Copa, Champions, bonus e históricos. No se ejecutaron
publicaciones de jornadas, migraciones, restores ni escrituras de negocio.

La portada requiere la primera respuesta de Supabase para conocer el podio
actual; durante ese tiempo muestra carga. Si no hay conexión al abrir desde
cero, informa que no pudo consultar los resultados. No inventa clasificación
ni guarda otra copia persistente de jornadas en el navegador.

No se realiza una reestructuración global del gran `app.js` ni de los estilos:
eso requiere un trabajo separado por módulos y pruebas específicas. Los cambios
de esta revisión se limitan a errores reproducidos y mejoras medibles de carga.

## Reversión

Antes de integrar: cerrar el PR no afecta a la web publicada.
Después de integrar: revertir únicamente el commit del PR V179 mediante GitHub.
No restaurar `data.json` ni una copia de Supabase: las jornadas posteriores deben
conservarse. La referencia de código anterior es `aa5e06b`.
