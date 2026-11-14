# Corrección de orientación de las publicaciones del 13 de noviembre

El recovery `season-recovery-bd734402-9b27-45be-9cbc-c18cc76be1db`
publicó 20 onces válidos numéricamente, pero la selección manual enumeró muchas
filas de derecha a izquierda. El renderer siempre ha mostrado slots crecientes
de izquierda a derecha, con portero abajo. No era una inversión del CSS.

Se contrastaron las 20 proyecciones anteriores y actuales, y los cuerpos de FF/JP
conservados de aquella ejecución. Esos cuerpos se usan **solo para diagnosticar
la colocación del incidente**, nunca como nuevas lecturas ni para cambiar fechas.

`forecast-layout-repair.js` corrige exclusivamente la presentación de esas 20
publicaciones: exige equipo, partido, formación, método, evidence_at, once ordenado
y porcentajes exactos; también published_at cuando el caller lo proporciona.
La vista previa privada usa la misma corrección por identidad de la proyección.
Solo permuta slots dentro de cada fila. No modifica las filas de Supabase, los
borradores, candidatos, porcentajes, alternativas, modo, retiradas ni evidencias.
El run cerrado no se reabre. No hay nueva publicación ni flujo de historial.
Una publicación con evidencia o fecha nuevas no recibe esta corrección.

Se restaura el orden anterior dentro de cada fila, con estas decisiones revisadas:

- Elche: conservar Sangaré y Buonanotte, los cambios reales del once; defensa
  Revivo–Redondo–Chust–Sangaré. Valera–Buonanotte–Cepeda ya coincide con ambos
  dibujos de fuente (Buonanotte ocupa el puesto de Lemar), y no se invierte.
- Real Sociedad: Guedes–Oyarzabal–Sučić coincide con ambos dibujos. Se conserva
  Soler–Gorrotxategi, el orden de JP de esta ejecución; no se invierte ese pivote.
- Villarreal: conservar el 4-3-3 elegido; JP sitúa Macià–Gueye–Comesaña y
  Moleiro–Mikautadze–Buchanan. No volver al antiguo 4-4-2.
- Sevilla: corregir solo la defensa. Sus otras filas no estaban invertidas.

Las discrepancias entre fuentes no justifican invertir indiscriminadamente otras
filas. El resto conserva la colocación de la publicación anterior del mismo partido.

Para lecturas nuevas, `collect-team.cjs` conserva geometría en el paquete y
`lineup-layout.cjs` ordena cada fila según la fuente revisada y su hash. No agrega
peticiones ni modifica editorial-v5. Una posición obligatoria sin resolver queda
pendiente; no se transforma trabajo incompleto en un bloqueo. El contrato completo
de revisión está en `season-runner.md`. Entregar un saved sigue sin recompilarlo.

Regresión: los siete sistemas, inversión de filas, anclas de sustitución, geometría
ausente/ambigua, las 20 correcciones, no mutación de datos y exclusión de futuras
publicaciones se comprueban en `tests/forecast-layout.test.cjs`.
