# Lector de mercado y equipo actual — primera prueba

Estado: **borrador de solo lectura, sin horario activo ni publicación**, 15/11/2026.
Destino previsto: primera división de Cuban League, comunidad Mister `649733`, temporada `2026-27`.

## Qué hace esta versión

Un programa de Node.js y Playwright abre su propio navegador, reutiliza una sesión iniciada por Ernesto y lee la web de Mister. No llama a ChatGPT ni a APIs de modelos. La lógica de importes, propiedad y diferencias es código determinista.

1. Comprueba comunidad, 20 participantes y 20 clubes del selector.
2. Limpia la búsqueda y los filtros; lee por separado **Libres** y **No libres**.
3. Recorre «Ver más» hasta que termina cada lista, con límites de tiempo y páginas. Espera una lista distinta y estable después de aplicar un filtro.
4. Recoge ID, nombre, posición, club, foto, valor, propietario y cláusula. La cláusula de un libre queda `null`, no cero. El precio de venta anunciado todavía no se recoge; no se confunde con valor de mercado.
5. Compara con la última lectura local: cambios de propietario, valor, cláusula y nuevas incorporaciones al catálogo. Deriva todos los equipos de esa misma lectura, con todos sus jugadores, sin depender del once de una jornada.
6. Lee el tramo visible del tablón antes y después. Solo llama «clausulazo» a un movimiento identificado expresamente por Mister. Guarda IDs de movimientos; no utiliza la fecha relativa de un comentario como fecha del traspaso.
7. Si faltan jugadores, hay identidades ambiguas, cambia el tablón durante la captura o falla la paginación, detiene la prueba y conserva la última lectura válida. No convierte una desaparición en una venta.

**Límite pendiente:** el tramo visible del tablón no acredita todos los movimientos desde la captura anterior. La comparación entre dos plantillas tampoco detecta por sí sola una ida y vuelta del mismo futbolista. Antes de publicar automáticamente, hay que verificar la paginación y cobertura del historial y añadir un registro duradero para deduplicar movimientos. La primera lectura establece una base, no anuncia todas las operaciones antiguas como nuevas.

`catalogComplete: true` significa que se agotaron ambas listas del buscador en esa captura. No equivale a una verificación independiente con cada plantilla, ni a cobertura completa del historial. Toda salida conserva `publicationReady: false`.

## Primera prueba en tu computadora

Para la alternativa desde el iPhone, consultar [Prueba desde el celular](mobile.md). Usa un escritorio privado temporal de Codespaces; requiere comprobar la cuota y el acceso real.

Requiere Node.js 22 o posterior, descargado desde [nodejs.org](https://nodejs.org/). En Windows, abrir PowerShell en la carpeta descargada del proyecto. El programa no necesita que escribas contraseñas en el chat.

Desde la raíz del proyecto:

```powershell
cd scripts/mister-market
npm ci --ignore-scripts
npm run install-browser
npm run login
```

Se abrirá una ventana de Chromium. Inicia sesión tú mismo en Mister, completa cualquier verificación y selecciona la **primera división de Cuban League**. Vuelve a PowerShell y pulsa Enter. No cierres la ventana antes de hacerlo.

Luego ejecuta:

```powershell
npm run collect
```

La consola muestra solo el resultado, contadores y duración. En una primera prueba correcta aparecerá `read_only_complete`, `baseline: true` y `publicationReady: false`. La segunda lectura comparable generará las diferencias.

Los archivos se guardan en `.mister-market/`, en la raíz del proyecto:

| Archivo | Uso |
| --- | --- |
| `auth.json` | Sesión privada del programa. No compartir ni subir. |
| `latest.json` | Última lectura local que superó los controles. |
| `candidate.json` | Última captura que llegó a comparación. Puede requerir revisión. |
| `report.json` | Diferencias, recuentos y faltantes. |
| `teams.json` | Plantillas derivadas de la última captura aceptada localmente. |
| `run.lock` | Impide dos ejecuciones simultáneas en esta instalación. |

La carpeta está excluida de Git. La sesión funciona como una credencial: conservarla en una computadora de confianza y fuera de carpetas compartidas. El programa no exporta la sesión del navegador de ChatGPT. [Playwright documenta esta separación y la protección del estado de autenticación](https://playwright.dev/docs/auth).

Una sesión puede caducar o necesitar nueva verificación. No se promete acceso perpetuo ni se sortean CAPTCHA o controles de acceso. Si el inicio de sesión real funciona pero la sesión guardada no, hay que diagnosticarlo antes de automatizar.

## Cómo avanzar a las dos actualizaciones diarias

| Paso | Estado y condición |
| --- | --- |
| Lector y comparación sin IA | 21 pruebas aprobadas; primera lectura real completada. Comparación entre dos capturas reales todavía pendiente. |
| Sesión independiente y captura real completa | Sesión propia confirmada y catálogo leído el 15/11; coherencia de archivos y plantillas derivadas comprobada. Contraste independiente con cada plantilla pendiente. |
| Historial completo de movimientos | Pendiente de validar cobertura entre capturas y persistencia de IDs. |
| Guardado privado en Cuban League | Pendiente de diseñar tablas y permisos mínimos; no usar credenciales en la web pública. |
| Mercado y «Equipo actual» | Pendiente de conectar las vistas aprobadas a la misma versión de datos. |
| Programación y publicación | Después de validar lo anterior, 04:00 y 17:00, zona `America/New_York`. |

Opción prevista: GitHub Actions con ejecutor estándar del repositorio público existente. [GitHub documenta su gratuidad en repositorios públicos](https://docs.github.com/en/billing/concepts/product-billing/github-actions). No se contrata un ejecutor de pago. Antes de activarlo hay que probar el acceso de Mister desde ese entorno, almacenar la sesión como secreto y usar almacenamiento privado para los datos; no adjuntar sesiones o lecturas como artefactos públicos, commits o logs.

El horario utilizará la zona de Miami para adaptarse al cambio de hora. [GitHub admite zonas horarias en `schedule`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), pero sus ejecuciones pueden retrasarse; no garantiza el minuto exacto. También desactiva los horarios de repositorios públicos tras 60 días sin actividad. Esta versión solo instala pruebas de código, **no un lector programado**.

**Usage:** la ejecución independiente de este programa no invoca IA y no consume cuota de ChatGPT. Crear, revisar o reparar el programa conversando con ChatGPT sí consume usage. Esto no significa que cualquier infraestructura o ampliación futura sea gratis; no se ha contratado ningún servicio ni activado un consumo adicional.

## Fallos y recuperación

| Código | Acción |
| --- | --- |
| `login_required` | Ejecutar `npm run login` y después volver a probar. |
| `wrong_league` | Iniciar sesión seleccionando primera división; no cambiar IDs para ocultar el problema. |
| `session_or_page_unavailable` / `browser_or_filesystem_error` | Revisar sesión, navegador instalado y cambios de formato. No publicar. |
| `page_not_settled` / `pagination_limit` | Revisar carga y paginación; no aceptar la primera página como catálogo. |
| `missing_owner_or_clause` / `unknown_owner` | Contrastar el campo real; no inventar propietario o cláusula. |
| `feed_changed_during_capture` | La lectura no fue estable; volver a probar una vez terminada la anterior. |
| `missing_players_review_required` | Revisar `report.json`; `latest.json` se conserva. Puede ser una baja real del catálogo o una lectura incompleta. |
| `already_running_or_stale_lock` | Esperar al proceso. Tras un cierre abrupto, verificar que ya no existe antes de retirar manualmente `run.lock`. No borrarlo solo por antigüedad. |

No hay reintentos ilimitados, acceso de escritura a Mister, Supabase, publicación o cambios de reglas. El bloqueo es local, no entre varias computadoras. Las escrituras de archivos individuales son atómicas; un cierre entre archivos puede dejar `report.json` y `teams.json` de capturas diferentes. Contrastar siempre `snapshotHash` con `latest.json` y regenerar vistas desde esta última antes de una integración futura.

## Comprobación y metodología

Desde la raíz: `npm ci --ignore-scripts` y `node --test tests/mister-market.test.cjs`.

Las pruebas usan participantes ficticios y DOM reducido con la estructura observada. Cubren importes, identidad, propiedad, detección explícita de cláusulas, capturas parciales, cambios concurrentes, paginación, espera tras filtros, aislamiento de datos no necesarios, diferencias y conservación de la base local. No prueban el acceso real independiente, la cobertura completa del tablón ni una publicación en producción.

Comprobación inicial del 15/11: 16 pruebas aprobadas, instalación reproducible con `npm ci` y salida `login_required` al intentar recoger sin sesión. Las correcciones posteriores de acceso móvil elevaron el total a **21 pruebas aprobadas**, localmente y en Actions. Base de desarrollo: `004f8db83f2fd451bd10a04323d7c526d157a71a`. No se guardaron credenciales ni lecturas reales en el repositorio.

Primera captura real, con código `66cce081270e5959b5256bd81818d431a3b7b4d4`, terminada el **15/11/2026 a las 17:59:34 UTC**: `read_only_complete`, **538 jugadores** (275 con propietario y 263 libres), **20 participantes**, **29 movimientos visibles**, **53.766 ms**, `baseline: true`, `aiCalls: 0` y `publicationReady: false`. Los 20 equipos derivados suman los mismos 275 jugadores, con entre 11 y 15 por equipo. Se verificaron el hash de la captura, la igualdad de hashes entre `latest`, `report` y `teams`, la regeneración exacta de las plantillas y la liberación del bloqueo. Es coherencia de esta captura, no contraste independiente con las 20 páginas de equipos ni cobertura histórica completa. GitHub confirmó que el Codespace quedó detenido al finalizar.

Observaciones de la inspección del 15/11 y su seguimiento:

| Incidente | Prevención | Estado |
| --- | --- | --- |
| `mister-filter-stale-list` | Esperar cambio y estabilidad de la lista tras «Aplicar»; cerrar el modal no basta. | Regresión sintética y primera captura independiente completada el 15/11. |
| `mister-reset-closes-popup` | Reabrir el selector después de «Limpiar». | Recorrido simulado y primera captura independiente completada el 15/11. |
| `mister-feed-relative-comment-time` | No tratar la antigüedad de un comentario como fecha del movimiento. | Regresión sintética; `occurredAt` queda null. |
| `mister-feed-visible-window` | Declarar cobertura parcial y bloquear publicación hasta validar historial. | Pendiente. |

Este flujo no reutiliza los contratos de puntos/jornadas ni la bitácora SQL existente: su enum todavía no admite mercado. Una integración futura definirá el contrato privado correspondiente en el proyecto Cuban League y conservará los históricos existentes.

Reversión: retirar esta carpeta y su workflow de pruebas. Ningún dato deportivo ni regla de la página depende todavía del lector.
