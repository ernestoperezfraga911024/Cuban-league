# Diagnóstico de lectura de probables — 13/11/2026

Esta medición corresponde al recolector de lectura del PR #108. No abrió un run
de publicación, no llamó a Supabase para escribir y no modificó la automatización.
El manifiesto de URLs y próximos encuentros se consultó en el catálogo autorizado;
todos los cuerpos usados en esta pasada se descargaron después de su inicio.

- Inicio Miami: **16:45:08.953**.
- Fin Miami: **16:57:52.663**.
- Duración de la pasada completa: **763,710 segundos (12 min 43,710 s)**.
- Equipos: **20/20**; propuestas base extraídas: **60/60**, con once nombres
  distintos por propuesta (660 observaciones de titulares entre las tres fuentes).
- Archivos de páginas públicas únicos verificados: **138**.
- Comprobaciones P11 por autor/equipo: **220**.

## Solicitudes medidas

| Tipo | Peticiones del recolector | Peticiones HTTP | Reutilizaciones |
|---|---:|---:|---:|
| Páginas de fuentes, rankings y perfiles | 380 | 139 | 242 |
| Script público anónimo de P11 | 220 | 1 | 219 |
| Pronósticos autor/equipo/jornada | 220 | 220 | 0 |
| Total | 820 | 360 | 461 |

La diferencia de una petición corresponde a la redirección canónica observada
de `/es/laliga/` a `/es/laliga`. Peticiones HTTP incluye intentos fallidos; no
significa 360 respuestas exitosas. Las 219 reutilizaciones del script se muestran
separadas: el recolector anterior también usaba una copia local de ese script y no
sería correcto atribuirlas todas como ahorro frente a aquella ejecución.

Por dominio: FutbolFantasy 10, Jornada Perfecta 10, Comuniate 30, web P11 90 y
endpoint público P11 220. Se mantuvieron todas las consultas de pronósticos por
autor/equipo; el ahorro no procede de omitir autores ni convertir faltantes en cero.

## Resultado P11 y límites de interpretación

| Estado de lectura | Cantidad |
|---|---:|
| Once de 11 nombres distintos, todavía sin validar roster/editorial | 93 |
| Respuesta pública sin pronóstico creado | 124 |
| Once incompleto | 1 |
| Fallo de acceso | 2 |

Los dos fallos fueron HTTP 503, uno en Atlético y otro en Espanyol. Se conservaron
como `unavailable`, separados de `not_created`. No se asignaron votos, porcentajes,
bloqueos de clubes ni publicaciones a partir de ellos.

Se verificaron los 20 IDs esperados, la unión elegible de autores de los rankings,
las fechas dentro de esta pasada, los hashes SHA-256 y la igualdad de cuerpo,
ruta y fecha cuando se reutilizó una misma URL. No se encontraron discrepancias.

Esto **no** verifica todavía calendario en las tres fuentes, identidad canónica,
bajas, selección editorial, alternativas/candidatos ni `assess/build_team`. Todas
las salidas mantienen `publication_ready:false` y `fixture_verified:false`.
Por eso tampoco se interpreta como 220 titulares nuevos publicados.

## Preparación y pruebas

Durante la integración se interrumpieron tres pasadas preliminares al detectar:
redirección canónica, colisión entre escrituras simultáneas y perfiles que abrían
por defecto la última jornada del autor. Se corrigieron y se inició esta medición
desde una carpeta vacía. Los 12:44 no incluyen ese trabajo de desarrollo y
diagnóstico, ni tiempos de publicación.

Pasaron 50 pruebas de transporte, recolector, métodos editoriales, candidatos y
Predicted11. Se cubrieron específicamente concurrencia de archivos, separación de
jornadas, consultas de pronósticos sin caché, errores frente a ausencia de pronóstico,
fechas originales y rechazo de lecturas fuera de ventana.

La ejecución anterior de 39:10 incluía trabajo editorial, validación y publicación.
**No son mediciones equivalentes**; este diagnóstico no demuestra una reducción
porcentual del tiempo total ni del consumo del plan de ChatGPT. No se accedió a
un contador de créditos/tokens atribuible a esta pasada.
