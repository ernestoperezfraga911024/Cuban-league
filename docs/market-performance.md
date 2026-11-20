# Rendimiento de clausulazos según los XI

Clausulazos > Rendimiento muestra los 20 participantes, sus compras y el detalle
por operación. Se ordenan las compras por aporte total descendente, incluido el
capitán, con los casos pendientes al final. Se mantienen importes, fechas y
referencias, incluidas las recompras.

## Regla de atribución

La fuente principal es el XI publicado: identidad de catálogo/Mister,
participante estable, jornada y contribución real. No se utilizan `updated_at`
ni `matchday_milestones` como fechas de juego. Tampoco se consulta el valor actual
ni se inventan puntos durante jornadas sin alinear.

1. Por futbolista se recorren los XI por jornada y se forman etapas observadas
   por participante. Una ausencia no separa etapas; aparecer con otro equipo sí.
2. Se vinculan las etapas observadas con las compras por cláusula del mismo
   comprador. Si solo hay una etapa y una compra, no hace falta fecha para
   distinguirlas. Si hay recompras, deben coincidir sus cantidades y el orden
   de las compras debe estar definido por fechas distintas.
3. El vendedor se contrasta con el equipo de la etapa inmediatamente anterior,
   cuando existe. Se retienen como pendientes los cambios incompatibles y los
   órdenes de compra contrarios al orden de las etapas atribuidas.
4. Una misma jornada con varios propietarios no impone un orden ficticio: los
   participantes implicados conservan su subtotal contextual, sin atribuirlo a
   una compra. Otros participantes y futbolistas se calculan independientemente.
5. Se suma `contributionPoints` exactamente una vez por aparición. Base y bonus
   se muestran separados. Cero y negativos son resultados válidos; ausencia de
   evidencia es null. Un bonus desconocido no borra la contribución publicada.
6. Cada aparición se utiliza como máximo en una compra del mismo participante.
   Las etapas que no coinciden con las compras, fechas repetidas/desconocidas en
   recompras y futbolistas sin apariciones permanecen pendientes con motivo.

## Alcance

Es una atribución por secuencia de XI e historial registrado, no una certificación
de tenencia completa. Ventas normales, entradas sin alinear o movimientos omitidos
pueden no dejar huella en los XI. Por ello la interfaz dice «según las etapas
observadas» y explica que nuevos movimientos pueden modificar la atribución.
No se confunde una etapa observada con todas las fechas de propiedad.

## Bonificaciones y balance

Tarifas confirmadas por Ernesto en la captura de Bonificaciones de Mister
adjunta el 19/11/2026 (Miami): 100.000 por punto de jornada, 250.000 por gol,
1.000.000 por jugador en el once ideal, sin premio por clasificación y
1.000.000 fijo por jornada. El fijo es del participante y no se reparte entre
futbolistas. La captura no configura un premio por portería a cero.

El dinero generado jugando suma los puntos aportados (capitán incluido una sola
vez), los goles individuales publicados en `player_goals` y las apariciones en
el once ideal oficial de las jornadas atribuidas a la operación. Goles y once
ideal no se multiplican por capitán. Se conservan ceros y contribuciones negativas.
El XI ideal histórico del perfil y los MVP internos no sirven como fuente.

Si faltan goles o un once oficial, aparece «Subtotal conocido» con las jornadas
pendientes. No se sustituye lo desconocido por cero ni se presenta un total
completo. Los aplazados mantienen la marca provisional; es un cálculo según
las reglas, no una comprobación de un ingreso bancario en Mister.

Una salida solo se vincula si es el siguiente clausulazo del futbolista, sale
del comprador, tiene fecha posterior distinguible y no hay movimientos sin fecha
ni empates en las fechas de compra/salida. Las ventas normales no están cubiertas.
Con ingresos completos y esa salida se muestra el balance:
generado jugando + importe de salida − precio pagado. Sin salida vinculable no
se inventa su precio ni se calcula un balance final. Persiste la limitación del
historial parcial indicada arriba.

Los goles viajan en la lectura compartida existente de los XI, con degradación
si el campo no está disponible. El once oficial se lee solo al abrir Rendimiento,
una vez por jornada y modelo publicado, con hasta tres solicitudes concurrentes.
Todas las personas y operaciones comparten la caché; una corrección publicada
invalida el cálculo. Los fallos conservan los importes conocidos y permiten
reintentar con Actualizar mercado. No se cambia ningún dato, tabla ni recolector.

## Actualización y eficiencia

Se reutilizan la captura y el almacén de XI ya existentes. Los resultados se
calculan una vez por pareja de captura/modelo y se invalidan al actualizar o
corregir los XI. La lista se reordena y el diálogo se actualiza conservando el
foco y el desplegable de jornadas, sin solicitudes por participante ni operación.

## Comprobación del 19 de noviembre de 2026 (Miami)

Lectura pública de 461 cláusulas y 240 XI: 242 compras atribuidas; 87 sin
apariciones con el comprador, 9 sin XI del futbolista, 70 con número de etapas
incompatible, 46 con vendedor distinto, 5 con orden de movimientos incompatible
y 2 con recompras sin orden distinguible. Estas cantidades son una instantánea,
no una medida de exactitud contra una verdad externa.

Ejemplo: Mbappé con Ernesto, J4–J12, 99 base + 19 extra de capitán = 118 puntos.
Dinero generado con las tarifas confirmadas: 118 × 100.000 + 9 goles × 250.000
+ 4 onces ideales × 1.000.000 = 18.050.000. J8 conserva su marca provisional.
Cálculo en el entorno local: aproximadamente 20 ms para esa instantánea; no es
una medición de velocidad en teléfonos.

## Validación

`node --test tests/market-performance.test.cjs tests/market-public.test.cjs tests/player-points.test.cjs tests/service-worker.test.cjs`

Pruebas: etapa única, huecos sin alineación, recompras, reparto sin duplicar,
ambigüedades, orden contradictorio, cero, negativos, bonus desconocido,
provisionalidad, identidad, escape HTML, ordenación, carga asíncrona, correcciones,
foco, diálogo y PWA. La ampliación económica comprueba tarifas, capitán sin
duplicar, exclusión del fijo, goles desconocidos, XI oficiales incompletos,
salidas ambiguas, caché compartida y fallos de carga. 78 pruebas locales pasan
incluyendo las suites de instalación, navegación, perfiles y XI oficial.
