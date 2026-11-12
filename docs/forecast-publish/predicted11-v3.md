# Predicted11 y pesos editorial-v3

Implementación autorizada el 12/11/2026 para LaLiga 2026/27, jornadas 13–38.

- Pesos nominales: FutbolFantasy 30, Jornada Perfecta 20, Comuniate 20, Predicted11 30. Sin rol.
- Dos listas de siete autores (club y global), unión por ID público, sin FutbolFantasy ni reemplazos desde el puesto 8.
- Los pronósticos pendientes/incompletos no cuentan. Sin votos P11, se normalizan las otras tres fuentes sobre 70.
- Se mantienen disponibilidad, rotación, contexto y límites de horizonte del método anterior, sin repetir descuentos ya incluidos en una fuente.
- Las fuentes base siguen verificando el calendario. Predicted11 se almacena con rankings, autores y onces individuales, no como un once artificial.
- Schema 4 / editorial-v3. Schema 3 / editorial-v2 conserva su validación para lectura y borradores anteriores.
- Automático/Manual, equipos retirados, roster, vencimiento e idempotencia se mantienen.

## Aplicación

Aplicar predicted11-v3.sql mediante la conexión existente y la herramienta de migraciones. Sus comprobaciones de aritmética y regresión se ejecutan en la misma transacción; no publican datos sintéticos.

La prueba extraordinaria autorizada se inicia una sola vez con forecast_season.begin_run('predicted11-20261112-v1'). El servidor genera season-extra-20261112-predicted11-v1, conserva el turno de las 09:00 y limita la prueba a dos horas desde su inicio. Reintentos mantienen la clave y el contenido. Las tareas normales siguen llamando begin_run() sin argumentos.

## Verificación

node --test tests/forecast-predicted11.test.cjs

node --test --test-name-pattern="v2 gives|categorical|v2 rejects|both versions" tests/forecast-source-method.test.cjs

El primer conjunto comprueba cálculo, ausencia de P11, duplicados, identidad, validación pública y renderizado compartido sin dependencias adicionales. No sustituye una comprobación visual en navegador.

## Reversión

predicted11-v3-rollback.sql revierte las funciones; no elimina datos ni reescribe publicaciones. No aplicarlo sobre publicaciones schema4 sin coordinar primero su conservación y la versión compatible de la interfaz. La reversión no es un procedimiento de publicación.
