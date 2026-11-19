# Rendimiento de clausulazos — primera fase

Clausulazos > Rendimiento muestra los 20 participantes por identidad estable,
sus compras por cláusula y un diálogo con cada operación. Cada referencia del
historial se conserva, incluso compras repetidas del mismo futbolista. Las
listas se reconstruyen desde la captura compartida al actualizar. Sin escrituras
en datos históricos, sin consultas por participante y sin cambios al recolector.

## Límite de atribución comprobado

El historial público solo incluye cláusulas, no todas las compraventas. Los XI
publicados permiten obtener puntos por propietario, pero no tienen fechas de
juego. `updated_at` es fecha de edición, no de juego. La consulta de solo lectura
del 19-11-2026 a `matchday_milestones` devolvió fechas fuera de orden (J5:
2026-09-17; J6: 2026-09-04; J9: 2026-10-20; J10: 2026-10-16). No se usan para
atribuir puntos a compras. El calendario de pronósticos empieza en J13.

Por ello, los puntos de una operación quedan pendientes de atribuir. El diálogo
muestra una referencia claramente separada de todas las etapas con el mismo
participante, con base, extra de capitán y total aportado. No se presenta ese
subtotal como rentabilidad de una compra ni se ordena una clasificación falsa.
Se conserva provisionalidad y cobertura parcial. Ausencia de datos no es cero.

## Próxima fase necesaria para el ranking deportivo

Publicar ventanas verificadas de juego de las jornadas históricas y movimientos
completos de entrada/salida por jugador. Resolver cruces de fecha, recompras,
partidos aplazados y transferencias durante una jornada usando los XI reales.
Solo entonces ordenar por puntos atribuibles a cada etapa. Los pagos por punto,
gol y portería a cero y el tratamiento económico del capitán aún no están
definidos: no se inventan ingresos, ventas ni balances.

## Verificación

`node --test tests/market-performance.test.cjs tests/market-public.test.cjs tests/player-points.test.cjs tests/service-worker.test.cjs`

Casos: 20 participantes, compras recibidas por el comprador, recompras, fechas
nulas, ceros, negativos, capitán, escape HTML, navegación, detalle modal,
actualización y ausencia de escrituras sobre las fuentes.
