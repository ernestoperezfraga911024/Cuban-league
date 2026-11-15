# Lector de mercado y equipo actual — primera prueba

Estado: **borrador con archivo privado duradero y vistas preparadas; sin horario activo ni publicación**, 15/11/2026.

Detalle de implementación, permisos, recuperación y validación: [integración del 15/11](integration-2026-11-15.md).
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
8. `verify` contrasta la pestaña **Equipo** de los 20 participantes con esa captura (IDs, nombres, posición, club y valor), y lee **Últimos movimientos** en las fichas de futbolistas, incluidos los libres. Conserva fecha, tipo explícito, origen, destino e importe. No usa el once histórico como plantilla actual.
9. `history` amplía el portal hasta que desaparece su marcador de carga y la lista permanece estable. No se detiene por encontrar un ID conocido: los comentarios pueden alterar el orden. Conserva un registro privado por ID de operación; una operación que desaparece del portal permanece en ese registro.

10. `clause-stats` calcula clausulazos realizados y recibidos, importe gastado y cobrado, saldo y operaciones más caras, sin abrir el navegador. Conserva empates en los rankings. Usa importes históricos de operaciones explícitas, nunca la cláusula actual ni compras normales. Los rankings del portal y de fichas son independientes mientras su conciliación esté pendiente; no existe un total combinado.

**Límite de cobertura:** `collect` conserva el tramo inicial del portal; `history` agota lo que Mister permite cargar en ese momento, no necesariamente toda la temporada. La primera inicialización del registro establece una base y no anuncia operaciones antiguas como nuevas. En lecturas posteriores exige conservar todos los IDs del tramo inicial anterior y un intervalo máximo de 24 horas para marcar `previous_head_retained`; sin ese solapamiento queda `review_required`. Los huecos detectados se conservan acumulados en `coverageGaps`; una lectura posterior correcta no borra la revisión pendiente. Es una comprobación conservadora sobre la ventana disponible, no garantía de historia ilimitada.

En el recorrido real de 538 fichas, el máximo observado fue **cinco movimientos por ficha**. Se recuperaron 443 clausulazos fechados, pero este límite impide acreditar todo el histórico de temporada. Las fichas se titulan **Últimos movimientos** y no exponen un ID de operación en las filas observadas. Sus fechas se conservan como día (`occurredOn`), sin inventar hora o zona, y sus filas se guardan en orden, incluso si parecen duplicadas. Los nombres antiguos no identificables quedan sin resolver. No se suman estas filas al registro del portal ni se deduplican por una combinación de fecha/importe/nombres: dos operaciones reales podrían coincidir en esos campos. Antes de publicar falta definir y validar su conciliación y la política ante huecos de cobertura.

`catalogComplete: true` significa que se agotaron ambas listas del buscador en esa captura. No equivale a una verificación independiente con cada plantilla, ni a cobertura completa del historial. Toda salida conserva `publicationReady: false`.

## Qué guardaremos para los rankings

Para cada operación: liga y temporada, futbolista, participante de origen (recibe el clausulazo y cobra), participante de destino (lo hace y paga), importe histórico, fecha cuando la fuente la ofrece e identidad/evidencia del movimiento. Cada fuente conserva su cobertura y su fecha de lectura. Los cambios de propietario sin tipo explícito no se convierten en clausulazos. Los nombres antiguos sin ID resuelto quedan pendientes, sin adjudicar dinero a alguien por similitud.

Las vistas previstas son realizados, recibidos, gastado y cobrado; saldo = cobrado − gastado. Los rankings conservan empates. Hasta conciliar portal y fichas, sus resultados se presentan por separado y no hay clasificación combinada publicable. El destino permanente y sus copias de recuperación forman parte de la integración pendiente; el Codespace es un entorno de prueba.

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

Después, para el contraste completo inicial y el registro del portal:

```sh
npm run verify
npm run history
npm run clause-stats
```

`verify` guarda el avance cada diez fichas y al fallar; conserva cada ejecución en `verification-runs/`. Puede reanudar las fichas ya leídas únicamente si el hash de captura y el tramo inicial del portal coinciden y el inicio tiene menos de 24 horas. Siempre vuelve a contrastar equipos y portal. No reutiliza un avance de otro catálogo, otra ventana o datos alterados. Un avance parcial nunca se llama verificación completa. Las fichas sin datos biográficos se reconocen por sus dos secciones finales observadas.

`verify` es una comprobación completa de fichas y puede tardar varios minutos. No se ha programado como lectura repetida de los 538 perfiles en cada actualización. El recorrido periódico y la selección de fichas que requieran conciliación se definirán antes de activar los horarios.

La consola muestra solo el resultado, contadores y duración. En una primera prueba correcta aparecerá `read_only_complete`, `baseline: true` y `publicationReady: false`. La segunda lectura comparable generará las diferencias.

Los archivos se guardan en `.mister-market/`, en la raíz del proyecto:

| Archivo | Uso |
| --- | --- |
| `auth.json` | Sesión privada del programa. No compartir ni subir. |
| `latest.json` | Última lectura local que superó los controles. |
| `captures/` | Capturas conservadas por hash para respaldar las evidencias antiguas al avanzar la base. |
| `candidate.json` | Última captura que llegó a comparación. Puede requerir revisión. |
| `report.json` | Diferencias, recuentos y faltantes. |
| `teams.json` | Plantillas derivadas de la última captura aceptada localmente. |
| `verification.json` | Contraste completo de equipos y movimientos visibles por futbolista, ligado al hash de la captura. |
| `verification-progress.json` / `verification-runs/` | Avance y evidencia archivada por ejecución; no equivalen a un resultado completo. |
| `clause-stats.json` | Rankings privados por fuente, hash de la captura y límites de cobertura; sin sumar fuentes solapadas. |
| `feed-ledger.json` | Registro acumulado del portal, IDs observados, cobertura y hash, en un único archivo atómico. |
| `run.lock` | Impide dos ejecuciones simultáneas en esta instalación. |

La carpeta está excluida de Git. Estos archivos sobreviven a detener el Codespace. El 15/11 se exportó una copia privada externa sin credenciales con ambas capturas, verificación, registro del portal y estadísticas (2.028.467 bytes), y se comprobó su lectura e integridad. Es un respaldo puntual. También se instaló un archivo privado inmutable en la base de Cuban League, con restauración por hash comprobada. La conexión recurrente del lector con ese archivo y la conciliación de fuentes siguen pendientes. La sesión funciona como una credencial: conservarla en una computadora de confianza y fuera de carpetas compartidas. El programa no exporta la sesión del navegador de ChatGPT. [Playwright documenta esta separación y la protección del estado de autenticación](https://playwright.dev/docs/auth).

Una sesión puede caducar o necesitar nueva verificación. No se promete acceso perpetuo ni se sortean CAPTCHA o controles de acceso. Si el inicio de sesión real funciona pero la sesión guardada no, hay que diagnosticarlo antes de automatizar.

## Cómo avanzar a las dos actualizaciones diarias

| Paso | Estado y condición |
| --- | --- |
| Lector y comparación sin IA | 35 pruebas del lector aprobadas localmente y en Actions, más 5 controles de metodología locales. Segunda captura real: 538 jugadores, 20 participantes, cero cambios y cero faltantes; 49.980 ms. |
| Sesión independiente y captura real completa | Sesión propia confirmada y catálogo leído el 15/11; coherencia de archivos y plantillas derivadas comprobada. Los 20 equipos fueron contrastados con su pestaña Equipo, junto con las 538 fichas. |
| Historial de movimientos | Dos lecturas reales conservan 391 operaciones sin duplicados. 538 fichas aportan 1.842 movimientos, entre ellos 443 clausulazos fechados. Conciliación entre fuentes pendiente. La fuente limita su historia disponible. |
| Guardado privado en Cuban League | Instalado y comprobado: archivo gzip inmutable, hashes, restauración y permisos. Primera importación real conservada; todavía sin carga recurrente. |
| Mercado y «Equipo actual» | Implementados en PR119 sobre una misma proyección; búsqueda, filtros, precios exactos y rankings parciales. Proyección preparada y oculta hasta revisión/publicación. |
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
| `roster_manager_mismatch` / `roster_player_mismatch` | Revisar la discrepancia con las vistas Equipo; no cambiar propietarios para hacer coincidir los resultados. |
| `unknown_player_movement` / `invalid_movement_date` | Contrastar el formato real de Últimos movimientos antes de añadir soporte. |
| `feed_pagination_changed` / `feed_pagination_limit` | Conservar el registro previo; una lista que no crece con el marcador presente no demuestra el final. |
| `feed_event_changed` / `feed_ledger_hash_mismatch` | Revisar la identidad o integridad de la operación; no reemplazar el registro válido. |
| `invalid_verification_checkpoint` | Conservar la evidencia; revisar integridad antes de reanudar. |
| `verification_snapshot_mismatch` | Las estadísticas requieren la verificación de la misma captura; no mezclar versiones. |

No hay reintentos ilimitados, acceso de escritura a Mister, Supabase, publicación o cambios de reglas. El bloqueo es local, no entre varias computadoras. Las escrituras de archivos individuales son atómicas; un cierre entre archivos puede dejar `report.json` y `teams.json` de capturas diferentes. Contrastar siempre `snapshotHash` con `latest.json` y regenerar vistas desde esta última antes de una integración futura.

## Comprobación y metodología

Desde la raíz: `npm ci --ignore-scripts` y `node --test tests/mister-market.test.cjs`.

Las pruebas usan participantes ficticios y DOM reducido con la estructura observada. Cubren importes, identidad, propiedad, detección explícita de cláusulas, capturas parciales, cambios concurrentes, paginación, espera tras filtros, aislamiento de datos no necesarios, diferencias y conservación de la base local. No prueban el acceso real independiente, la cobertura completa del tablón ni una publicación en producción.

Comprobación inicial del 15/11: 16 pruebas aprobadas, instalación reproducible con `npm ci` y salida `login_required` al intentar recoger sin sesión. Las correcciones posteriores de acceso móvil elevaron el total a **21 pruebas aprobadas**, localmente y en Actions. Base de desarrollo: `004f8db83f2fd451bd10a04323d7c526d157a71a`. No se guardaron credenciales ni lecturas reales en el repositorio.

Primera captura real, con código `66cce081270e5959b5256bd81818d431a3b7b4d4`, terminada el **15/11/2026 a las 17:59:34 UTC**: `read_only_complete`, **538 jugadores** (275 con propietario y 263 libres), **20 participantes**, **29 movimientos visibles**, **53.766 ms**, `baseline: true`, `aiCalls: 0` y `publicationReady: false`. Los 20 equipos derivados suman los mismos 275 jugadores, con entre 11 y 15 por equipo. Se verificaron el hash de la captura, la igualdad de hashes entre `latest`, `report` y `teams`, la regeneración exacta de las plantillas y la liberación del bloqueo. Es coherencia de esta captura, no contraste independiente con las 20 páginas de equipos ni cobertura histórica completa. GitHub confirmó que el Codespace quedó detenido al finalizar.

Validación posterior del 15/11: `verify` con `dde1f181` completó 20 equipos y 538 perfiles en **699.056 ms**, con **1.842 movimientos**. Incluyen **443 Cláusula**, desde **15/08/2026** hasta **14/11/2026**, sin nombres de partes de cláusulas pendientes de identidad. El máximo observado fue cinco filas por perfil. El hash coincide con la captura original. No se volvió a iniciar sesión al reiniciar Codespaces.

`history` inicial con `9c7992d` guardó 391 operaciones en 20 páginas y 51.396 ms; su repetición con `137881f6` conservó 391 y detectó cero IDs nuevos, sin duplicar el registro. `clause-stats` terminó con 132 cláusulas del portal y 443 de fichas, por separado. La comparación diagnóstica encuentra coincidencia por jugador/partes/importe para 131 de las 132 del portal; una no está entre las filas de fichas. No es una conciliación de IDs ni una clasificación combinada.

Segunda captura con `137881f6`, finalizada el **15/11/2026 a las 19:05:16.845 UTC**: 538 jugadores, 20 participantes, `baseline: false`, cero cambios y cero faltantes en **49.980 ms**. Hashes de latest/report/teams coincidentes, plantillas regeneradas exactamente, ambas capturas conservadas por hash y bloqueo liberado. Las estadísticas quedan ligadas a la primera captura verificada, que sigue archivada; no se mezclan sus hashes con la nueva. Respaldo privado exportado sin sesión ni credenciales; Codespace detenido y confirmado al cierre.

35 pruebas del lector y 5 controles locales de metodología aprobados; ambos workflows de Actions aprobados en `137881f6`. No hay publicación, migración, horario nuevo ni llamadas de IA.

Observaciones de la inspección del 15/11 y su seguimiento:

| Incidente | Prevención | Estado |
| --- | --- | --- |
| `mister-filter-stale-list` | Esperar cambio y estabilidad de la lista tras «Aplicar»; cerrar el modal no basta. | Regresión sintética y primera captura independiente completada el 15/11. |
| `mister-reset-closes-popup` | Reabrir el selector después de «Limpiar». | Recorrido simulado y primera captura independiente completada el 15/11. |
| `mister-feed-relative-comment-time` | No tratar la antigüedad de un comentario como fecha del movimiento. | Regresión sintética; `occurredAt` queda null. |
| `mister-feed-visible-window` | `history` pagina hasta el marcador final, registra IDs duraderos y declara límites de retención/solapamiento. | Regresión probada; verificación real documentada por separado. |

Este flujo no reutiliza los contratos de puntos/jornadas ni la bitácora SQL existente: su enum todavía no admite mercado. Una integración futura definirá el contrato privado correspondiente en el proyecto Cuban League y conservará los históricos existentes.

Reversión: retirar esta carpeta y su workflow de pruebas. Ningún dato deportivo ni regla de la página depende todavía del lector.
