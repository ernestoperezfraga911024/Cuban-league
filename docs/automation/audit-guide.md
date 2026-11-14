# Bitácora privada

Solo `automation_ops.record_run(jsonb)` y lecturas de `automation_ops.run_log` en Cuban League. No exponer esta tabla al navegador ni otorgar permisos a anon/authenticated/service_role. Máximo 16 KiB por entrada. No requiere servicios ni suscripciones nuevos.

`execution_key`: `cuban-league-` + scheduled_for UTC sin puntuación (minúsculas), o el inicio real si falta scheduled_for. No sustituye el run_key deportivo. Una invocación usa una sola clave. `scheduled_for` es el contexto real o null. `code_sha` es el SHA de main realmente leído/ejecutado; no un mínimo ni ejemplo. Mantenerlo fijo toda la invocación. Cambios de metodología/código no se hacen a mitad de una ejecución.

Registrar estado inicial running, checkpoints después de cada flujo y cierre completed/partial/failed/idle. `maintenance` solo para revisión interactiva sin ejecución deportiva. Conservar incidentes anteriores en los checkpoints. Una entrada running sin cierre indica interrupción; nunca es publicación completa. `first_recorded_at` y `updated_at` los pone la base; no simular inicio del programador con ellos.

Esquema del argumento (sustituir los marcadores, no ejecutar el ejemplo):

```json
{
  "execution_key":"CLAVE_REAL",
  "scheduled_for":null,
  "methodology_version":"ops-v1",
  "code_sha":"SHA_REAL_DE_40_HEX",
  "status":"running",
  "report":{
    "flows":{},
    "metrics":{"wall_ms":null,"downloads":null,"reused":null,"bytes":null,"retries":null,"chatgpt_tokens":null},
    "incidents":[],
    "checks":[]
  }
}
```

`flows` acepta forecasts/news/health/history/set_pieces. Cada entrada contiene status (running/completed/partial/failed/idle/not_due), run_key opcional y contadores enteros observados: expected,published,ready,blocked,missing,saved,verified,checked,pending. Publicado exige verificación pública. Los contadores de noticias no son equipos.

Métricas permitidas: wall_ms,read_ms,review_ms,sql_ms,downloads,reused,bytes,retries,tool_calls,chatgpt_tokens; solo enteros medidos o null. Incidentes: `{code,flow,summary}`; code estable de incidents.json o nuevo identificador descriptivo, flow uno de los anteriores o dispatcher/audit y summary de 10..500 caracteres propios. No copiar respuestas, HTML, secretos ni datos personales. Checks: lista de comprobaciones realmente realizadas, máximo 40 frases de 180 caracteres.

Antes de trabajar, consultar las últimas cinco entradas por `updated_at desc`. Para estudiar una falla, filtrar por `report->'incidents'`; no leer todos los payloads privados de los 20 clubes solo para obtener métricas. Los tiempos del runner y métricas del lector se conservan tal como se midieron, distinguiendo tiempo acumulado de descarga y tiempo de pared.

Un fallo del registro permite un reintento con la misma clave y reporte. Si persiste, comunicar `audit-write-failed` en el resultado del chat, conservar reporte local cuando sea posible y continuar los flujos independientes autorizados. No modificar permisos ni bloquear equipos para reparar el diario. El registro complementa attempts/coverage; no reemplaza ni reabre sus estados.

Reversión de esta función: dejar de llamarla y restaurar el prompt anterior. Conservar las filas para auditoría. No hace falta borrar tablas o datos deportivos.
