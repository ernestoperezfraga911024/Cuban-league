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

No se generan ingresos monetarios ni balances hasta definir los pagos y disponer
de las salidas necesarias. No se cambia ningún dato, catálogo, tabla ni recolector.

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
Cálculo en el entorno local: aproximadamente 20 ms para esa instantánea; no es
una medición de velocidad en teléfonos.

## Validación

`node --test tests/market-performance.test.cjs tests/market-public.test.cjs tests/player-points.test.cjs tests/service-worker.test.cjs`

38 pruebas: etapa única, huecos sin alineación, recompras, reparto sin duplicar,
ambigüedades, orden contradictorio, cero, negativos, bonus desconocido,
provisionalidad, identidad, escape HTML, ordenación, carga asíncrona, correcciones,
foco, diálogo y PWA.
