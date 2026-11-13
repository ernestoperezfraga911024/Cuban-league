# Lecturas compartidas dentro de una ejecución

Primera mejora del recolector: compartir páginas públicas descargadas durante el
turno, conservando el cuerpo y `fetched_at` originales. No cambia el cálculo,
selección, identidad, validación, calendario, recuperación ni publicación.

## Uso por el productor

`scripts/forecast/read-session.cjs` exporta `ReadSession`. Crear **una instancia por
ejecución**, después del control de reloj/plan y con la clave y ventana reales del
servidor. No arrancar una instancia por club: se perdería la reutilización.

```js
const {ReadSession} = require('./scripts/forecast/read-session.cjs');
const reader = new ReadSession({runKey, notBefore, expiresAt});
try {
  for (const team of missingTeams) {
    // No releer saved; entregar su borrador intacto. Saltar intentos terminales.
    const pages = await Promise.all(team.urls.map(url => reader.read(url)));
    // Interpretar cuerpo y verificar partido, once probable e identidades.
    // Crear assessment/candidates, assess/build_team, save_draft/deliver/verificación.
    await completeAndVerifyTeam(team, pages);
  }
} finally { reader.close(); }
```

El bloque anterior muestra dónde integrar el transporte; `completeAndVerifyTeam`
es el productor existente, **no una función incluida ni un permiso para publicar**.
La base de datos sigue siendo la autoridad sobre ventana, concurrencia, estados y
modos. El reloj local es una defensa adicional y no sustituye su reloj real.

Para un agente/otro proceso hay un puente persistente de líneas JSON:

```text
node scripts/forecast-read-session.cjs RUN_KEY NOT_BEFORE_ISO EXPIRES_AT_ISO
{"id":"ff-home","op":"read","url":"URL_REAL_DE_PARTIDO"}
{"id":"metrics","op":"stats"}
{"op":"close"}
```

Escribir los comandos en la misma entrada estándar abierta. El puente devuelve
URL, hora, `reused`, SHA-256 y ruta al cuerpo HTML en un directorio temporal nuevo;
no vuelca todo el HTML en el contexto del modelo. Los extractores leen esa ruta.
La API de módulo permite hasta cuatro lecturas simultáneas; el puente procesa
comandos individuales en orden. Una segunda lectura explícita usa `refresh:true`.

## Reglas que conserva

- No importa archivos/cachés de ejecuciones anteriores, ni siquiera al reiniciar
  con la misma clave. Un reinicio inicia lecturas nuevas.
- Una página de partido sirve a sus dos rivales. El ranking global y cada perfil
  público pueden compartirse mientras siga vigente la misma ejecución.
- Cada pronóstico P11 de autor/equipo/jornada sigue necesitando su propia consulta
  pública. Este módulo no descarga ni deduplica las respuestas de esa API.
- La clave es la URL exacta sin fragmento; no elimina parámetros ni mezcla URLs
  de perfiles diferentes. `fetched_at` nunca se renueva por un acierto de caché.
- Solo sigue una redirección permanente observada que añade o quita la barra
  final, conservando origen, ruta y parámetros. Guarda la URL final real y la hora
  inicial. No sigue cadenas, cambios de dominio/ruta ni accesos privados; tampoco
  accede con cookies/credenciales personales ni reintenta bloqueos.
- Una respuesta HTTP 200 es solo un cuerpo recibido. No establece `status:read`,
  `fixture_verified:true`, un once válido, ni la ausencia de un pronóstico. El
  extractor debe detectar retos de acceso y verificar la evidencia semántica.
- Los fallos se devuelven al productor; no se almacenan como lecturas válidas ni
  se convierten automáticamente en `not_created` o en bloqueos de clubes.
- Cerrar o vencer la ventana impide incluso servir páginas guardadas. Una lectura
  que termina fuera de la ventana falla. La ventana no puede exceder dos horas.

## Medición y despliegue

`stats()` devuelve solicitudes, descargas, reutilizaciones, errores, bytes y tiempo
acumulado de descargas, con desglose de descargas/bytes por dominio. El tiempo
acumulado puede superar el tiempo de pared cuando hay paralelismo; **no mide uso
de ChatGPT**. No incluye cuerpos, credenciales ni parámetros de URL en métricas.

Pruebas sin red: `node --test tests/forecast-read-session.test.cjs`.
Los datos de prueba son sintéticos y no se pueden registrar ni publicar.

## Recolector conectado y diagnóstico sin publicación

`scripts/forecast/collect-team.cjs` conecta una única sesión al recorrido de cada
club. Descarga las tres páginas de partido y la página del equipo de Comuniate;
extrae nombres y porcentajes de sus once propuestos, y descubre partido, rankings
y perfiles P11 mediante enlaces reales. No ejecuta JavaScript de las páginas.
La jornada se toma del cuerpo de la página del partido: el perfil puede abrir
por defecto la última jornada publicada por ese autor. La temporada se contrasta
con la opción LaLiga del perfil; no se toma su once antiguo como pronóstico nuevo.

Lee el script público enlazado por el perfil P11 una vez por URL y descubre el
lector anónimo que usa la propia página. `readScript` solo admite ese script;
`readBallot` solo admite el endpoint público observado de participaciones, sin
cookies ni credenciales personales. Cada respuesta autor/equipo/jornada se
consulta de nuevo y conserva su hora real; no se guarda su URL con el identificador
del invitado en los informes. Si cambia el origen, contrato o acceso, falla sin
buscar credenciales ni otra ruta privada.
Al construir un payload editorial, `predicted11.fetched_at` debe ser la menor
fecha entre partido, ambos rankings y perfiles/consultas incluidos. Un ranking o
perfil compartido puede ser anterior a la página del partido de ese club; no usar
automáticamente la fecha del partido ni la de finalización del recolector.

El proceso de diagnóstico se inicia explícitamente así, con dependencias del
proyecto instaladas (`jsdom` ya figura en package.json):

```text
node scripts/collect-forecast-readonly.cjs --read-only manifest.json
```

El manifiesto tiene `teams:[{team,comuniate_team_url,fixture:{key,season,matchday,
home,away,kickoff_at,source_urls:{futbolfantasy,jornadaperfecta,comuniate}}}]`, con
URLs consultadas del catálogo/plan autorizado. Se usan como puntos de partida,
**no como evidencia nueva del calendario**. El diagnóstico crea un directorio
temporal vacío, procesa un club por vez, conserva cuerpos/fechas, y escribe
resúmenes por club y `report.json`. No contiene cliente de Supabase, SQL ni ruta de
guardado/entrega. Su identificador `READ_ONLY_DIAGNOSTIC` no es un run de la base.

Las salidas marcan siempre `publication_ready:false` y `fixture_verified:false`.
`complete_unvalidated` solo significa once nombres distintos recibidos: todavía
requiere identidad en roster, calendario contrastado, bajas, propuestas y
alternativas/candidatos, `assess/build_team` y los controles de publicación. Una
respuesta JSON vacía real de P11 se registra como `not_created`; errores de red,
perfil o contrato como `unavailable`; jornada/equipo discrepante como `mismatch`.

Esta entrega conecta el transporte al recolector de lectura. No modifica ni
activa la automatización principal, ni completa el productor editorial/publicador.
El ahorro del 41% estimado en la auditoría previa no es una promesa de tiempo o
créditos. Comparar una lectura sin publicación con los 39 minutos de un recorrido
editorial completo no demuestra ese ahorro total.
