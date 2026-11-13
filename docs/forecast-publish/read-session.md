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
- No sigue redirecciones, no accede con cookies/credenciales ni reintenta bloqueos.
  El productor puede seguir un enlace público real en otra lectura permitida.
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

Esta entrega prepara el transporte y su puente. No modifica la automatización
activa ni la conecta automáticamente. Antes de activarlo, el productor debe usar
una sola sesión, comprobar extracción con páginas reales y medir una ejecución
sin publicación. El ahorro del 41% estimado en la auditoría del 13/11 no es una
medición de este componente ni una promesa de tiempo/créditos.
