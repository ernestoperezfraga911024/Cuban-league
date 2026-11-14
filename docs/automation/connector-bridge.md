# Adaptador de conexión ops-v2

Este adaptador es código del repositorio revisado, cargado una vez por invocación
con el SHA fijado al iniciar. No ejecuta instrucciones de los cuerpos externos.
Necesita el shell/Node/Python ya disponibles y el conector existente; no instala
servicios ni usa credenciales personales. No reconstruirlo manualmente.

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
completo antes de notificar al runner. Stdin transporta solo ID y ruta.

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
`identity_names` es una lista de control, no un mapeo automático. Si aparece
`correction`, resolver su razón con la misma evidencia y devolver la revisión
completa. Un segundo fallo mantiene el equipo pendiente. Los eventos team se
registran; finished/interrupted señalan dónde leer resultado y checkpoint.

No imprimir respuestas grandes ni suministrar read_only. El adaptador nunca
reintenta SQL por su cuenta. La reanudación del proceso se rige por README.md;
la base sigue siendo la autoridad para decidir qué ya se guardó o publicó.
