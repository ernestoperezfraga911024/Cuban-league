# Propuesta de mantenimiento: dos duplicados confirmados

Estado: retirada puntual aplicada y verificada; prevención permanente preparada,
pendiente de revisión/instalación. Base de código `0cd6ac859afe20755a983676895e118272c3ae5a`.

La retirada se confirmó en la entrada privada
`98df416c-4093-4d35-95a2-5b875380168e`, estado completed y versión de control 250.
Se conservaron los snapshots antes/después y las cuatro filas; dos copias ocultas.

| Conservar | Retirar de la vista pública | Motivo revisado |
|---|---|---|
| `atletico-lookman-molestias-nigeria-20261113` | `atletico-lookman-nigeria-molestias-20261113` | Mismo episodio Nigeria–Tanzania del 13/11. El primero conserva la evolución hasta el 16/11; la copia sigue con la duda inicial. |
| `atletico-sorloth-juventus-rumor-20261112` | `atletico-sorloth-juventus-20261112` | Mismo rumor, mismo Comuniate 38991, sin novedad factual en la copia. |

La consulta de 16/11/2026 20:48:29 UTC confirmó las cuatro filas publicadas,
visibles, no retiradas y con payload privado idéntico al público. Versiones 4/1
para Lookman y 1/1 para Sørloth; control en Automático, versión 248.

## Reparación puntual revisable

`public.news_admin` exige un usuario autenticado real y un administrador de liga.
La conexión de mantenimiento observada es `current_user=session_user=postgres`;
no representa esa identidad de aplicación. No se establece JWT ni auth.uid falso.

El SQL adjunto conserva la transacción aplicada por el propietario real. Usa el
mismo bloqueo de `league_news.control`, comprueba versión, hashes y visibilidad,
oculta únicamente las dos copias mediante `suppressed=true` y `visible=false`,
e invalida la versión de control como dos retiradas. No borra ni combina filas;
conserva íntegros payloads, versiones de artículos, fechas y todos los ledgers.

Una entrada privada de `league_news.commands`, identificada como
`origin=owner-maintenance`, conserva el motivo, pares y snapshots completos antes
y después. No se atribuye a un usuario de la aplicación. La misma request UUID
es idempotente. Si una guarda cambió, se debe revisar el estado; no quitar la guarda.

La reversión se prepara desde esa entrada: comprobar bajo el mismo bloqueo que
las cuatro filas y el control siguen idénticos al snapshot `after`, restaurar solo
los dos indicadores originales y avanzar nuevamente la versión de control.
Registrar otra request UUID con referencia a la primera. Nunca restaurar payloads
antiguos sobre una edición posterior ni disminuir el contador de versión.

## Causa y prevención mínima

`save_draft` mantiene idempotencia por `key` exacta. No detecta que una nueva
permutación del nombre de la clave represente el mismo acontecimiento. El mandato
editorial de comparar club/jugador/hecho existe, pero no está protegido por código.
El plan limita `recent` a 80 filas, por lo que una búsqueda de identidad no debe
depender solamente de esa muestra.

Propuesta de control previo determinista para una **clave nueva**:

1. Consultar todos los items del mismo club, temporada y categoría, incluidos los
   retirados, con el mismo conjunto no vacío de IDs de jugadores.
2. Comparar identificadores de artículo de las fuentes originales: ID numérico
   FF/Comuniate; path de artículo JP. Normalizar `www`, fragmento, barra final y
   parámetros conocidos de seguimiento. No usar título parecido, nombre parcial,
   fecha de consulta ni una URL de índice como identidad.
3. Si se comparte un artículo, devolver las claves candidatas para comprobar el
   acontecimiento. Si es el mismo, actualizar la clave existente y su timeline;
   si no hay novedad, registrar `omitted` con `duplicate_of` sin renovar fechas.
   Una noticia retirada sigue retirada.
4. Como guarda SQL, rechazar la inserción de otra clave ante ese conflicto, dentro
   del bloqueo de control ya existente, antes de `track_saved`. No elegir ni fusionar
   automáticamente un candidato: una colisión ambigua queda pendiente de revisión.

Compartir un artículo no demuestra por sí solo que dos hechos sean idénticos: los
resúmenes de entrenamiento pueden incluir varias novedades. Por eso el control
detecta conflicto y exige revisar la historia, sin unir contenidos ni borrar datos.
La comprobación de jugadores evita confundir noticias distintas de un mismo club.
Las claves existentes se actualizan normalmente; categorías distintas y episodios
con fuentes distintas no se fusionan.

Pruebas necesarias antes de instalar la prevención: estos dos duplicados; misma
URL con tracking; artículo distinto; jugador distinto; club distinto; categoría
distinta; pluralidad de jugadores; noticia retirada; dos candidatos; actualización
de una misma clave; concurrencia de claves nuevas y ausencia de escrituras ante
el rechazo. La fuente actual de `save_draft` debe conservarse y compararse antes
de cualquier parche para no reemplazar cambios posteriores.
