# Trazas privadas por fase — 16/11/2026

`automation_ops.run_log` conserva el resumen más reciente de cada ejecución. Sus
checkpoints no son un historial completo. `automation_ops.trace_events` añade el
historial de eventos sin modificar las colas, publicaciones ni validadores deportivos.

## Identidad y datos conservados

La invocación proporciona `FORECAST_EXECUTION_KEY` con la misma clave de su
bitácora y `FORECAST_CODE_SHA` con el SHA real del checkout. Ambos se proporcionan
juntos; nunca se deduce el SHA de una publicación anterior. Cada proceso recibe
un UUID diferente y secuencias crecientes. Un reinicio conserva la execution key,
pero crea otro process ID. La identidad de un evento es `(execution_key, process_id, seq)`.

Se conserva el run key, SHA, instante real del evento, instante de recepción de la
base, fase, estado, club, fuente, tipo de recurso, HTTP, ID de solicitud, duración,
contadores y hashes disponibles. Las descargas nuevas, reutilizaciones y errores
de cada fuente se registran individualmente sin su URL.
Los errores tienen códigos acotados, no mensajes sin filtrar. La lista de campos
es cerrada: SQL, cuerpos HTML, URLs, tokens y texto arbitrario no se admiten.
Los archivos privados del runner conservan el detalle de solicitudes, respuestas,
evidencia y revisión; `trace.jsonl` es el diario de metadatos que puede reenviarse.

No borrar los archivos de evidencia al cerrar: archivarlos mediante el proceso
de diagnóstico antes de depender de un entorno temporal. La base de trazas no
almacena esos cuerpos ni sustituye ese archivo. Los contadores de tokens de
ChatGPT siguen siendo desconocidos cuando no hay una medición real.

## Persistencia y fallos

`SeasonGateway` agrega al siguiente SQL un lote de hasta 64 eventos pendientes.
El lote se confirma en una transacción propia **antes** de la transacción
deportiva. Un rollback posterior del guardado no borra la traza anterior.
Un fallo del destino opcional de trazas se contiene y no impide el flujo deportivo.
El resultado del SQL deportivo conserva exactamente su forma anterior.

Ese envío combinado es de mejor esfuerzo: no se presenta como confirmación
duradera. El JSONL local nunca se borra al enviarlo. Al cerrar, `flushTrace()`
verifica el número, identidad y digest de los eventos recibidos. Reenvía solo las
secuencias faltantes en lotes y comprueba la respuesta de `record_trace`.
La función acepta un reenvío idéntico sin duplicarlo y rechaza que el mismo ID
reciba otro contenido. Un fallo de transporte admite reenviar **solo trazas**;
nunca repetir una escritura deportiva para obtener su respuesta.

El cierre declara `accepted`, `events` y `unconfirmed`, y el manifiesto muestra
`confirmed_events`. El transporte no añade al diario de metadatos el envío de ese
mismo diario; conserva sus archivos y eventos de protocolo locales. Así se evita
registrar el registro infinitamente. `accepted:false` obliga a informar la limitación y
preservar el JSONL para su envío posterior. No se infiere persistencia a partir
de la existencia del archivo ni de un proceso completado. Un error local de disco
queda como `local_error_code=trace_local_io` y conserva los eventos en memoria
para su envío a la base; no oculta el resultado deportivo ni afirma que el archivo
se guardó. El manifiesto distingue `local_events` de `confirmed_events`.

Una muerte abrupta puede impedir el último envío. La base conserva los prefijos
que ya recibió; el archivo local conserva el detalle posterior disponible. Un
último estado `started` sin su cierre señala dónde se cortó, no prueba que la
mutación no ocurrió. Consultar las tablas deportivas antes de reanudar.

## Instalación y permisos

Instalar `trace-events.sql` una sola vez sobre el esquema `automation_ops`
existente. La función usa privilegios del invocador, no `SECURITY DEFINER`.
Tabla con RLS y sin permisos para PUBLIC, anon, authenticated ni service_role;
la escritura usa exclusivamente el conector privado ya autorizado. No añadir
esta tabla a la API pública. El procedimiento de publicación no cambia.

Para desactivar la captura, omitir las dos variables de entorno. Conservar las
filas existentes y los archivos de diagnóstico. La reversión del código no
necesita borrar la tabla ni las trazas históricas.

Consultas de diagnóstico acotadas:

```sql
select execution_key, process_id, seq, occurred_at, recorded_at, event
from automation_ops.trace_events
where run_key = 'RUN_KEY_REAL'
order by occurred_at, process_id, seq;

select event->>'phase' as phase, event->>'status' as status,
       event->>'error_code' as error_code, count(*)
from automation_ops.trace_events
where execution_key = 'EXECUTION_KEY_REAL'
group by 1,2,3;
```

Las pruebas `automation-trace.test.cjs` y `automation-trace-db.test.cjs` cubren
redacción por lista permitida, permisos, replay idempotente, conflicto de IDs,
identidad fija por proceso, resultados deportivos intactos, respuesta perdida
y fallo del destino de trazas. Su aprobación no acredita una publicación real.
