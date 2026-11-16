# Reparación del pronóstico basado exclusivamente en fuentes — 16/11/2026

Estado de este informe: diagnóstico y regresiones locales; **republicación nueva
pendiente**. No acredita despliegue, validación SQL ni verificación pública del
método corregido. La revisión de Deportivo se detuvo y el proceso de recuperación
se pausó al recibir la instrucción nueva. Los cuatro resultados examinados son
Alavés, Athletic, Atlético y Celta; no representan una revisión completa de los
veinte clubes.

## Regla vigente y precedencia

La instrucción actual de Ernesto sustituye las reglas anteriores que ordenaban
conciliar noticias médicas y excluir bajas: el pronóstico se calcula únicamente
con las observaciones de FútbolFantasy, Jornada Perfecta, Comuniate y Predicted11.
La salud se muestra como información adicional procedente exclusivamente de FF;
no elimina jugadores ni modifica porcentajes, elección del once, posición o
alternativa. Tampoco puede entrar indirectamente a través de rotación o contexto.

Una probabilidad explícita de FF, incluido 0%, sigue siendo una observación de
pronóstico. Conservar ese número no es introducir una penalización médica. El
texto o icono médico es un dato distinto y no puede anular la observación. Una
persona mencionada solo en la sección médica tampoco adquiere por ello una señal
de pronóstico: no se inventan candidatos a partir de bajas.

## Evidencia y alcance

Se examinaron el checkout congelado `0cd6ac8` y las revisiones/compilaciones locales
de la recuperación `/tmp/forecast-season-LScwTg`: solicitudes 5 (Alavés), 16
(Athletic, con artículo adicional), 27 (Atlético, con artículo adicional) y 37
(Celta). La auditoría leyó los cuerpos capturados, sus tarjetas de banquillo FF,
las observaciones normalizadas, votos, decisiones y resultados compilados. No
consultó ni modificó la base de datos. La confirmación operativa de que esos
cuatro equipos habían publicado pertenece al coordinador de la recuperación.

Los cambios de `availability` entre `clear`, `concern` y `unknown` se probaron en
memoria para todos los titulares y candidatos de esos cuatro resultados: ninguna
probabilidad cambió. Todos tenían `rotation:low` y `context.points:0`. Por tanto,
la anomalía encontrada no fue una resta médica numérica en v5, sino exclusiones
de candidatos y decisiones editoriales condicionadas por lesiones.

## Equipos y decisiones que deben repararse

| Equipo | Evidencia y efecto anterior | Reparación pendiente |
| --- | --- | --- |
| Alavés | `confirmed_out` enumeró `f-garces` y `m-rodriguez-alaves-2`. Ninguno entró en la unión revisada. Garcés sí tiene una tarjeta FF de 0%; Mikel no aparece en las señales de pronóstico examinadas. | Quitar el veto médico. Recuperar la observación real de Garcés sin fabricar una para Mikel. Revisar todas las tarjetas de banquillo, no solo las tres alternativas incorporadas. |
| Athletic | Se borraron `d-vivian`, `g-guruzeta`, `u-egiluz` y `m-sannadi`. FF muestra 0% para los cuatro. Vivian sigue titular en Comuniate y aparece en dos de cinco onces P11. | Restituir las observaciones y candidatos. Recalcular el relevo de Yeray sin excluir a Vivian por salud. |
| Atlético | No hubo `confirmed_out`. Se eligió Romero (49%) frente a Pubill (55%), justificándolo con JP/Comuniate y con información médica; no fue una elección exclusivamente aritmética. Le Normand (18%) quedó como relevo aunque Pubill (55%) figura como alternativa directa en JP/Comuniate. | Resolver titular y relevo mediante puntuación y puesto observado. El parte médico no puede dar prioridad a Romero ni apartar a Pubill. |
| Celta | `b-iglesias` y `m-roman` se eliminaron de candidatos y observaciones compiladas, pese a sus tarjetas FF de 0% presentes en la revisión y el cuerpo. | Restituir ambas observaciones y candidaturas; conservar salud únicamente como información FF separada. |

Detalles necesarios para no ampliar indebidamente el diagnóstico:

- **Alavés:** el veto médico fue redundante en el payload concreto porque las dos
  identidades ya estaban fuera de la unión. La revisión incorporó tres de doce
  tarjetas FF: Rebbach (50%), Denis Suárez (50%) y Jonny (40%). También dejó fuera Aleñá (30%),
  Protesoni (20%), Mariano (20%), Novoa (20%), Aitor Mañas (20%), Adrián (5%), Miguel (0%), Diallo (0%) y
  Garcés (0%). No se atribuye toda esa omisión a salud. Miguel y Mikel Rodríguez son
  identidades diferentes y no deben confundirse para completar candidatos.
- **Athletic:** Yeray (62%) supera por fuentes a Vivian (27%); retirar el veto médico no
  obliga a cambiar ese titular. Sí afecta al conjunto de relevos centrales:
  Vivian (27%) supera Paredes (25%) bajo el cálculo actual y debe poder ser considerado.
  Galarreta (48%) → Gerenabarrena (47%) y Sancet (66%) → Navarro (37%) son parejas observadas en las
  fuentes, no descuentos médicos. Las condiciones de recuperación en los textos
  de Yeray/Paredes y la conciliación médica de Galarreta, Sancet y Serrano deben
  salir de la lógica de selección.
- **Atlético:** Lookman (25%) y Grimaldo (82%) no recibieron descuento ni bonificación
  médica. Las explicaciones médicas de Romero, Pubill, Lookman y Grimaldo deben
  desacoplarse del pronóstico. La nueva elección debe usar las observaciones
  auténticas de posiciones y alternativas; no fabricar coordenadas al cambiar
  una identidad seleccionada.
- **Celta:** no se identificó otra modificación del once o sus alternativas
  causada por salud. Starfelt (13%), Álvaro Núñez (13%) y El-Abdellaoui (10%) no fueron
  descontados; Moriba (73%), Radu (87%), Rueda (73%) y Javi Rodríguez (79%) tampoco fueron
  bonificados. Su información médica de JP/Comuniate no debe convertirse en el
  icono FF. Las redundancias Carreira/Durán y la falta de identidad de Burcio son
  problemas de datos distintos: no se resuelven mediante criterios médicos.

Los valores que resultarían al restituir las observaciones eliminadas, usando
los mismos pesos y señales v5 y sin ajustes adicionales, son:

| Jugador | FF | JP | Comuniate | P11 | Cálculo resultante |
| --- | --- | --- | --- | --- | --- |
| Dani Vivian | 0% observado | No listado | Titular sin porcentaje | 2/5 votos | 27% |
| Guruzeta, Egiluz, Sannadi | 0% observado | No listado | No listado | 0/5 votos cada uno | 10% cada uno |
| Borja Iglesias, Miguel Román | 0% observado | No listado | No listado | 0/5 votos cada uno | 10% cada uno |
| Garcés, incorporando su tarjeta FF omitida | 0% observado | No listado | No listado | 0/7 votos | 10% |

Los porcentajes finales de esta tabla son reconstrucciones locales, no nuevas
publicaciones. La señal interna existente de “no listado” y el tratamiento del
titular de Comuniate explican que un 0% FF no equivalga a un 0% compuesto; no se
inventó una probabilidad médica ni se sustituyó el cero observado.

## Causas de código

En el checkout congelado, `scripts/forecast/editorial-producer.cjs` exigía
`availability_reviewed` (línea 25), construía un conjunto `out` desde
`confirmed_out` (48–50), prohibía seleccionarlo (133) y lo eliminaba de la unión
de candidatos (135). Después reconstruía `player_observations` sobre esa unión.
El bloque 142–145 rescataba titulares de fuentes, pero no las alternativas
eliminadas: por eso Vivian conservaba el titular CM y los votos en las papeletas
originales, mientras perdía su observación FF 0% y el resumen P11 individual.

`forecast-predicted11-method.js:37–68` ya ignoraba la disponibilidad y el horizonte
para v5, pero rechazaba `confirmed_out:true` y permitía ajustes de rotación y
contexto. El SQL `forecast_publish.assess`, definido en `editorial-v4.sql` y
ampliado en `editorial-v5.sql`, conservaba esos contratos. La reparación exige una
versión nueva y coherente entre JS/SQL; no cambiar cálculos históricos ni
reinterpretar borradores `saved`.

`forecast-context.js:66–73` permitía que una noticia posterior sustituyera el
estado directo FF del icono. Su aplicación en 151–158 añadía icono/texto accesible
y no modificaba el once. La fuente del icono necesita corregirse separadamente.

Los contratos anteriores, `docs/forecast-publish/season-runner.md`, el checklist
de revisión y pruebas de exclusión médica contienen reglas ahora sustituidas.
Conservarlas sin actualizar reintroduciría el fallo en la siguiente ejecución.

## Flujo y comprobaciones de reparación

1. Capturar y conservar fuentes, fechas, hashes, porcentajes y votos completos.
2. Resolver identidades y redundancias reales, sin filtrar por salud.
3. Calcular el método nuevo exclusivamente con las cuatro fuentes. Predicted11
   sin onces completos no aporta señal negativa; 0% publicado sigue siendo 0%.
4. Resolver once y alternativas mediante una regla determinista basada en el
   cálculo y puestos observados, sin instrucciones médicas ni coordenadas
   inventadas. Mantener los controles de once completo y alternativas por debajo de 70%.
5. Añadir el estado FF como anotación independiente. Cambiarlo o eliminarlo debe
   dejar idénticos jugadores, porcentajes, posiciones y alternativas.
6. Validar JS/SQL, tamaño real JSONB, entrega y lectura pública antes de declarar
   reparados los clubes. Conservar las revisiones anteriores para auditoría.

Las regresiones de esta reparación se incorporan a
`tests/forecast-producer.test.cjs` y `tests/forecast-predicted11.test.cjs`:
invariancia de propuesta/fuentes/geometría ante metadatos médicos y editoriales,
conservación de candidatos y ceros, evaluación mínima v6, pesos y ausencia P11,
guardas de fuentes y compatibilidad numérica de los métodos anteriores.
La prueba del productor mantiene fija `review.selection`: demuestra que los
metadatos médicos no cambian su resultado, pero no demuestra que una persona haya
elegido ese once sin razonamiento médico. La elección y los relevos deben revisarse
también bajo la regla nueva; un selector automático necesita una regresión propia.

Se conserva además la regresión de tamaño hallada durante Deportivo: su payload
medía 63.441 bytes como JSON compacto y 67.340 estimados como `jsonb::text`, por los
espacios estructurales. El servidor lo rechazó antes de guardar. La nueva prueba
exige rechazar localmente un payload que quepa en JSON compacto pero supere el
límite de 65.536 bytes en la representación JSONB; no se omiten jugadores para
superar ese límite.
El contador cubre el esquema actual de enteros y cadenas; no pretende sustituir
la serialización PostgreSQL de números arbitrarios con notación exponencial.

Validación local del 16/11: `node --test tests/forecast-producer.test.cjs
tests/forecast-predicted11.test.cjs` terminó con **44 pruebas aprobadas y cero
fallos**, después de actualizar la comprobación de entrega nueva a v6. Una revisión
independiente también comprobó nueve pruebas dirigidas y el contenido de este
informe. Estas comprobaciones usan ejemplos sintéticos; no prueban entrega real.

Estado pendiente: integración, validación SQL, despliegue y nueva publicación
comprobada. Este informe no da ninguno de esos pasos por realizado.


## Revisión del índice de lectura

El índice anterior extraía noticias médicas de JP y estados de Comuniate y
creaba `potential_availability_conflicts` con `requires_review:true`. Aunque no
cambiaba números directamente, esa petición de conciliación podía volver a
inducir exclusiones médicas. La corrección deja las alternativas y porcentajes
observados, omite esas entradas médicas y conserva exclusivamente el estado
directo FF marcado `icon_only`, sin comparación entre fuentes. Las pruebas de
`forecast-inspect-review.test.cjs` verifican esta separación y mantienen las
comprobaciones de hash y de equipo. No se han publicado datos con este índice
corregido durante esta auditoría local.
