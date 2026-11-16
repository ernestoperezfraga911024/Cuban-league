# Auditoría del arranque programado · 15/11/2026

Última consulta de ejecuciones: 15/11/2026 después de las 22:00 Miami (16/11 después de las 03:00 UTC). Main inspeccionado: `d0e3695313d7c14b0e9f982f60274efe5a8cc106`. Diagnóstico de lectura; no se modificaron horarios, permisos, credenciales, lectores ni datos de producción.

## Conclusión y límite de la evidencia

La demora observada está antes de que se cree la ejecución en GitHub. Otros dos workflows del mismo repositorio acumulan retrasos de varias horas con cron UTC y minutos distintos de cero. Esto apunta al despacho de eventos `schedule`, no a un problema exclusivo del cron de mercado o de su zona horaria. No conocemos la causa interna de GitHub ni podemos distinguir todavía entre eventos de mercado demorados y descartados. El incidente permanece `investigating`.

## Comparación con otros workflows

Se contrastó cada cron con el archivo en el `head_sha` de su ejecución, no solo con la versión actual. Todos los horarios locales siguientes son `America/New_York`, UTC−5 en estas fechas. La columna «Creada» corresponde a `created_at` de la API de GitHub; no se interpreta como hora de publicación de datos.

| Día | Workflow | Cron UTC comprobado | Hora prevista Miami | Creada Miami | Demora | Ejecución |
| --- | --- | --- | --- | --- | --- | --- |
| 15/11 | Balón parado | `37 12 * * *` | 07:37:00 | 14:03:39 | 6h26m39s | [43750249427](https://github.com/ernestoperezfraga911024/Cuban-league/actions/runs/43750249427) |
| 15/11 | Respaldo cifrado | `17 9 * * *` | 04:17:00 | 11:23:42 | 7h06m42s | [43735230076](https://github.com/ernestoperezfraga911024/Cuban-league/actions/runs/43735230076) |
| 14/11 | Balón parado | `37 12 * * *` | 07:37:00 | 13:26:54 | 5h49m54s | [43626647104](https://github.com/ernestoperezfraga911024/Cuban-league/actions/runs/43626647104) |
| 14/11 | Respaldo cifrado | `17 9 * * *` | 04:17:00 | 10:50:48 | 6h33m48s | [43612358463](https://github.com/ernestoperezfraga911024/Cuban-league/actions/runs/43612358463) |

Archivos contrastados: `.github/workflows/set-pieces.yml` y `.github/workflows/supabase-backup.yml`. Ambos runs del 15/11 usan `004f8db83f2fd451bd10a04323d7c526d157a71a`; los del 14/11 usan respectivamente `50f8c2a2be8310b49458adcd00b601c48c506ed2` y `d1e252b0c6d79ae016b26ca5901bc4b58c893848`.

El primer job de Balón parado del 15/11 comenzó a las 19:03:41 UTC, dos segundos después de crearse el run. El del respaldo comenzó a las 16:23:45 UTC, tres segundos después. Las horas de demora no corresponden a instalar dependencias ni a esperar un runner después de crear esos runs. El respaldo terminó con un fallo independiente en «Comprobar configuración privada», antes de exportar; ese resultado no explica su arranque tardío y requiere una revisión separada.

## Mercado

- Workflow `419455324`, estado `active`, archivo `.github/workflows/mister-market-sync.yml` en la rama predeterminada `main`.
- Cron vigente: `0 4,9,13,17,21 * * *`, `timezone: America/New_York`. Configurado para las 04:00, 09:00, 13:00, 17:00 y 21:00 de Miami, con ajuste estacional.
- Al cierre de la consulta seguían constando cinco ejecuciones, todas `workflow_dispatch`; ninguna `schedule`, en cola ni en curso. Los turnos de las 17:00 y 21:00 del 15/11 no acreditan arranque automático.
- La ampliación de horarios se fusionó a las 17:02:08 del 15/11, pero el cron anterior ya incluía las 17:00. El horario original se creó en `d78f5c8150eca35e0e641202c39c065377ed36c2`; la ampliación está en `cae9de7ec0ab06e14de341b9922a70a74d93cf83`, ambos asociados a `ernestoperezfraga911024`.
- La última recuperación manual, [43770209824](https://github.com/ernestoperezfraga911024/Cuban-league/actions/runs/43770209824), se creó a las 17:36:11, inició su job a las 17:36:15 y publicó a las 17:38:58 Miami. Verificó 538 jugadores, 20 equipos, 445 cláusulas documentadas, cero gaps y `aiCalls=0`. Confirma la corrección previa del lector; no prueba el disparador automático.

## Configuración comprobada

Repositorio público, no fork, no archivado ni deshabilitado, con actividad reciente; no aplica la desactivación por 60 días de inactividad. En Settings → Actions estaban permitidas las acciones, sin política de ejecución adicional ni aviso de bloqueo. Se conservaron los permisos existentes. La identidad de los commits de cron coincide con el usuario activo que ejecutó los trabajos manuales; no se encontró evidencia de suspensión o eliminación del actor. No hay evidencia de una concurrencia de mercado pendiente que impida arrancar.

GitHub documenta [soporte de zonas IANA](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) y [demoras o descartes de eventos schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), con mayor carga posible al inicio de la hora. Esto acredita una limitación del mecanismo, no prueba saturación como causa particular. [GitHub Status](https://www.githubstatus.com/) no mostraba un incidente de Actions del 14 o 15/11 en la consulta. No atribuir la incidencia a una caída global confirmada.

## Recomendación de diseño, aún no instalada

Conservar el lector y sus protecciones. Separar el reloj del `schedule` de GitHub, utilizando un programador independiente para solicitar `workflow_dispatch` en `main` y modo `sync`. Supabase Cron, en el proyecto existente, permite llamadas HTTP y registros de cada turno; es una opción viable a revisar antes de implementar. No supone introducir IA recurrente. El plan, disponibilidad y límites de infraestructura deben verificarse; no se promete puntualidad absoluta ni coste adicional cero sin comprobarlos.

La implementación deberá resolver el turno mediante hora real de Miami, guardar una clave única por fecha/hora, registrar despacho y respuesta, acotar reintentos, reconciliar resultados inciertos y comprobar inicio y publicación. La exclusión concurrente actual evita solapamiento, pero no sustituye la deduplicación de un mismo turno: también debe protegerse ante la llegada tardía de un `schedule` antiguo. Usar una credencial GitHub limitada al repositorio y Actions write, conservada como secreto, sin permisos de escritura de código. Mantener OIDC, lease, revisión esperada y validadores existentes. No activar dos relojes sin estas guardas ni retirar el anterior antes de comprobar el sustituto.

Referencias: [Supabase Cron](https://supabase.com/docs/guides/cron), [programación y Vault](https://supabase.com/docs/guides/functions/schedule-functions), [GitHub workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

Cambiar únicamente el minuto del cron no ofrece evidencia suficiente de reparación: los workflows de comparación ya usan los minutos 17 y 37 y se retrasaron varias horas. Tampoco aumentar el timeout del lector puede crear un evento que aún no existe. La siguiente verificación debe medir por separado hora prevista, despacho, creación del run, inicio del job y publicación; no cerrar esta incidencia por una ejecución manual correcta.
