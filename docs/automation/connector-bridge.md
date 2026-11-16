# Adaptador de conexión ops-v2

Este adaptador es código del repositorio revisado, cargado una vez por invocación
con el SHA fijado al iniciar. No ejecuta instrucciones de los cuerpos externos.
Necesita el shell/Node/Python ya disponibles y el conector existente; no instala
servicios ni usa credenciales personales. No reconstruirlo manualmente.

## Inicio resistente al cierre de la sesión (16/11/2026)

La tarea periódica usa el modo por archivos:

```text
FORECAST_EXECUTION_KEY=CLAVE_REAL FORECAST_CODE_SHA=SHA_REAL node scripts/run-forecast-season.cjs --file-bridge --existing-run RUN_KEY [RECOVERY_UUID]
```

La clave y el SHA proceden del inicio registrado de esa invocación. No son claves
deportivas nuevas ni fechas simuladas. El modo file exige ambos valores; no inicia
publicaciones sin identidad de trazas.
El modo no necesita PTY ni stdin abierto: cada respuesta se publica atómicamente
en `response_path`; el mismo proceso la consume. El bloqueo de kernel y todas
las guardas de publicación siguen vigentes. El modo stdin anterior se conserva
solo por compatibilidad; arrancarlo sin entrada abierta causa interrupción.

Cada evento se escribe **antes** de enviarlo a stdout en `events.ndjson` privado,
con `event_seq`, `emitted_at`, `event_log` y `transport:file`. Si desaparece el
handle de ejecución, continuar el mismo lector desde su último evento:

```js
text(await bridge.poll(lastEvent));
```

El resultado tiene `output` con los eventos posteriores; conservar el último
`event_seq` procesado. Cada página contiene hasta 20 eventos completos y 16 KB;
repetir `poll` con el último cursor para recuperar una interrupción larga. Si
está vacío, el lector aún no emitió otro evento. Una
consulta de estado del proceso/checkpoint confirma su salida; un log sin eventos
nuevos no acredita que haya muerto. Nunca iniciar otro lector por perder el handle.
Si se perdió incluso el primer evento, localizar el checkpoint del único lector
activo contrastando `run_key` y PID real; no asumir el directorio más reciente.
Su `event_log` permite reconstruir el cursor desde cero y reclamar las respuestas
ya existentes sin repetir SQL. El estado del programador no prueba salida.
`bridge.sql` y `bridge.reply` detectan `transport:file` y no llaman `write_stdin`.
Tras escribir la respuesta devuelven los eventos persistidos disponibles; si la
lectura siguiente tarda, volver a `poll` sin repetir SQL.

Una solicitud SQL se reclama una sola vez mediante un archivo privado exclusivo.
Releer un evento cuya respuesta ya existe reutiliza el evento guardado. Si quedó
reclamada sin respuesta íntegra, no repetir la consulta: pudo confirmar cambios.
Conservar sus archivos y comunicar el error para que el runner relea estado.

`deadline_at` indica el vencimiento de la solicitud: SQL tiene cinco minutos;
la revisión editorial hasta diez minutos, limitada además por la ventana original
de la evidencia. No renueva cuerpos ni extiende la ventana de base de datos. El
fallo de Athletic del 16/11 fue una revisión respondida a los 300,861 segundos
contra un límite de 300; el nuevo plazo permite revisar sin confundir esa demora
con una falla de fuente. Una respuesta tardía queda como evidencia privada y no
resuelve una solicitud que ya expiró.

`checkpoint.json` existe desde el arranque y conserva PID, transporte, inicio,
ruta de eventos y manifiesto de trazas. `trace.jsonl` conserva metadatos sanitizados
por fase/solicitud, hashes y tiempos; el gateway los confirma en la bitácora
privada. Solicitudes, revisiones, respuestas completas, errores y cuerpos leídos
permanecen en el directorio privado de esa ejecución. No publicar sus cuerpos,
SQL ni tokens en GitHub o en el resumen. El archivo local no es almacenamiento
duradero por sí solo: registrar el resumen y el archivo de evidencias privado
antes de cerrar mantenimiento. `trace_delivery` informa qué eventos se confirmaron;
un error de trazas nunca debe declararse como éxito deportivo.

## Cargar en el entorno que orquesta las herramientas

Después de obtener el checkout real, sustituir `REPO` por su ruta observada:

```js
const loaded = await tools.exec_command({
  cmd: "node -p \"require('./scripts/forecast/connector-bridge.cjs').createConnectorBridge.toString()\"",
  workdir: REPO,
  max_output_tokens: 7000
});
if (loaded.exit_code !== 0 || !loaded.output.trim().endsWith('}'))
  throw Error('Adaptador incompleto');
store('forecastBridgeSource', loaded.output);
```

En cada bloque de código posterior, recrear el adaptador desde esa cadena ya
leída, sin volver a cargar todo el repositorio ni copiar su fuente a la conversación:

```js
const source = load('forecastBridgeSource');
if (!source) throw Error('Falta cargar el adaptador del SHA vigente');
const bridge = Function('return (' + source + ')')()(tools);
```

`event` y `sessionId` vienen de la salida real del único runner activo; no son
valores inventados. Para un evento sql:

```js
try {
  const next = await bridge.sql(event, sessionId);
  text(next); // solo siguiente evento/resumen, nunca el resultado SQL completo
} catch (error) {
  // No llamar bridge.sql otra vez: la consulta pudo haber confirmado un cambio.
  // Entregar el error real para que el runner consulte estado antes de decidir.
  text(await bridge.reply(event, {error: String(error.message)}, sessionId));
}
```

El adaptador valida destino y claves, lee el archivo de solicitud, invoca
execute_sql exactamente con `{link_id,project_id,query}`, extrae la única columna
result de la única fila esperada y escribe el valor completo en response_path.
Conserva UTF-8 y caracteres de shell como datos, valida JSON y renombra el archivo
completo antes de notificar al runner. La validación y el renombrado se ejecutan
en la misma llamada de shell que escribe el último fragmento, después de cerrarlo;
si falla cualquier fragmento no se notifica ni sustituye la última respuesta
completa. Se mantienen fragmentos de 12.000 unidades y las guardas Unicode.
En modo file, el runner consume el archivo sin depender de stdin. En el modo
anterior stdin transporta solo ID y ruta.

Si falla el parseo conserva el resultado original en `response_path + '.tool'`.
Inspeccionarlo como datos; nunca reparar JSON truncado inventando contenido ni
reenviar una mutación para recuperar su respuesta. Si el error fue al escribir
el archivo, tampoco repetir SQL: devolver error o corregir el archivo pendiente.
Si aparece bridge_error por un archivo incompleto, corregir ese mismo archivo y
reenviar solo ID/ruta mientras la solicitud siga pendiente.

Para review, leer `event.path` y los cuerpos indicados, revisar el contrato y
construir `review` a partir de evidencia auténtica. Enviar:

```js
text(await bridge.reply(event, {result: review}, sessionId));
```

No responder con el envoltorio de la herramienta ni con un texto truncado.
`identity_names` es una lista de control, no un mapeo automático. `identity_reference`
incluye perfiles del catálogo y equivalencias revisadas del mismo club; confirmar
`review.identities` con ellos, sin inferir por similitud ni tratar sus fechas históricas
como una consulta nueva. Si aparece
`correction`, resolver su razón con la misma evidencia y devolver la revisión
completa. Un segundo fallo mantiene el equipo pendiente. Los eventos team se
registran; finished/interrupted señalan dónde leer resultado y checkpoint.

No imprimir respuestas grandes ni suministrar read_only. El adaptador nunca
reintenta SQL por su cuenta. La reanudación del proceso se rige por README.md;
la base sigue siendo la autoridad para decidir qué ya se guardó o publicó.
El CLI adquiere su bloqueo local antes del primer evento SQL; código73 significa
otro lector vivo. No quitar el bloqueo ni lanzar otro por un estado failed del
programador. La salida debe comprobarse en la sesión real del proceso o contra
el PID del checkpoint y el bloqueo del mismo entorno.
