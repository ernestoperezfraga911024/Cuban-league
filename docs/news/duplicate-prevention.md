# Prevención de claves duplicadas

Instalada el 16/11/2026 a las 16:06 de Miami mediante mantenimiento revisado.
La comparación transaccional antes/después confirmó que los datos protegidos
permanecieron iguales. El MD5 posterior de `save_draft` es
`369b15311db0e3e74cd70a3abbe0fc52`.

La comprobación posterior confirmó la guarda y que ambos helpers son invoker,
sin ejecución para anon, authenticated o service_role. Las copias retiradas de
Lookman y Sørloth devolvieron sus claves originales como candidatos; ambas
continuaron retiradas. Esto verifica instalación y detección, pero todavía no
acredita el rechazo de un nuevo conflicto durante una ejecución periódica real.

El incidente de Lookman y Sørloth generó dos claves diferentes para cada mismo
acontecimiento. `save_draft` ya era idempotente con una clave idéntica, pero admitía
una nueva permutación. La retirada de las dos copias está documentada en
`duplicate-maintenance-20261116.md`.

## Comportamiento

Antes de crear una clave nueva, la tarea consulta
`league_news.duplicate_candidates(PAYLOAD)` con la propuesta revisada. La función
es de lectura y examina todo `league_news.items`, no solo los 80 items de `recent`.
Coincidencia exige:

- Mismo club, temporada y categoría.
- Mismo conjunto no vacío de IDs de jugadores; orden indiferente.
- Al menos un mismo artículo original: ID numérico de FutbolFantasy o Comuniate,
  o path de artículo de Jornada Perfecta. Se ignoran fragmentos, `www`, barra final
  y parámetros conocidos de seguimiento; otros parámetros conservan su significado.

No se comparan títulos por similitud ni nombres de jugadores aproximados. Índices,
portadas y otras fuentes no crean automáticamente una identidad de artículo.
Los candidatos incluyen su clave, versión, estado de retirada e identidades de
artículo coincidentes. No seleccionan una clave ganadora ni modifican contenido.

Si es el mismo acontecimiento, conservar la clave existente y actualizar su
evolución con una `change_note` real. Si no hay novedad, registrar la omisión con
`duplicate_of` sin rejuvenecer fechas. Un candidato retirado sigue privado.
Si los hechos son distintos o hay varios candidatos, revisar las historias y sus
fuentes antes de guardar: compartir un artículo puede ser una señal de conflicto,
no una prueba semántica de equivalencia. No fusionar automáticamente dos episodios.

`save_draft` repite esa comprobación bajo el bloqueo de control que ya protege sus
escrituras. Una clave nueva en conflicto produce SQLSTATE `23505` con las claves
candidatas en `DETAIL`, antes de cambiar el ledger o guardar. Las actualizaciones
de una clave existente siguen el recorrido anterior. Un error se registra como
pendiente/revisión necesaria; no se cambia la clave o se omiten fuentes para eludirlo.

## Revisión e instalación

`duplicate-prevention.sql` verifica antes el MD5 de la definición realmente
instalada: `6f328c212c1b0b27cd5912b154a1fdf5`. Si cambió, aborta la transacción.
Se inserta una comprobación pequeña en `save_draft`, conservando sus controles de
evidencia, identidad, salud, ventanas, cronología y publicación. Las funciones nuevas
son privadas, invoker y sin permisos para PUBLIC, anon, authenticated o service_role.
No cambian filas existentes, permisos públicos, modos, horarios ni catálogo.

La instalación toma el bloqueo de control de noticias y conserva en una tabla
temporal los fingerprints de items, publicaciones, runs, eventos, cobertura por
club, comandos y estado, además de modo/versión. Antes del commit vuelve a
compararlos y aborta si cambió cualquier fila protegida. Devuelve esa prueba,
el nuevo fingerprint de `save_draft` y las ACL de los helpers; la tabla temporal
se elimina al confirmar. No se conserva otra copia pública de los datos.

La instalación debe hacerse como mantenimiento revisado, no desde la tarea
periódica. Después, comprobar definiciones/ACL y consultar los candidatos reales
de las dos copias retiradas sin guardarlas de nuevo. Eso verifica la protección
instalada; la siguiente noticia real en conflicto verifica su uso operativo.

```sql
select i.key, league_news.duplicate_candidates(i.payload) as candidates
from league_news.items i
where i.key in (
 'atletico-lookman-nigeria-molestias-20261113',
 'atletico-sorloth-juventus-20261112'
);
```

Reversión: restaurar la definición anterior de `save_draft` solo después de
comparar la definición instalada para conservar cambios posteriores. Los helpers
pueden permanecer privados y sin llamadas. No reponer las noticias duplicadas ni
alterar sus snapshots para revertir esta prevención.

Las pruebas cubren los dos incidentes, tracking, identidades distintas, conjuntos
de jugadores, actualizaciones, retiradas, ambigüedad, preservación de datos/ACL y
rechazo antes del ledger. PGlite serializa las llamadas concurrentes de la prueba;
el test también comprueba que la guarda se ejecuta después del bloqueo de control
existente y antes de escribir. No es una prueba de dos sesiones de producción.
