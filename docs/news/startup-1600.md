# Noticias: arranque completo y horario16:00

Ernesto autorizó el 17/11/2026 corregir el turno omitido y mover15:00 a16:00
America/New_York. Se conservan08:00 y11:00.

Causa: plan() devuelve run_key válido, completed=false y teams=[] antes de
inicializar un turno. La tarea interpretó ese vacío como ausencia de trabajo,
aunque el contrato exigía begin_run y nueva consulta.

La migración `../../supabase/migrations/20261117213744_news_startup_1600.sql`
comprueba las huellas de slot_at, plan y begin_run; cambia únicamente la ventana
15–16 por16–17 y añade prepare_run(), privada, invoker e idempotente. Esta consulta
abre el turno mediante begin_run y devuelve20 clubes y has_work=true. No publica
ni marca una revisión como completada. Su respuesta compacta excluye recent,
cuyo histórico se consulta por club cuando haga falta.

La instalación compara las huellas de noticias, publicaciones, cobertura,
ledger, modos y turnos antes/después; no renombra ni elimina claves antiguas.
No reinstala esquema ni modifica permisos existentes. La tarea horaria sigue
siendo la misma y conserva los horarios de los otros flujos.

Las regresiones cubren el plan vacío, idempotencia,20 clubes, turno completado,
fuera de ventana, pendientes antiguos, modo manual, permisos y cambio de hora
estacional. No equivalen a comprobar una lectura editorial real. La bitácora
registra por separado instalación y publicaciones verificadas de la recuperación.

Reversión: volver a llamar plan/begin_run/reconsultar de forma explícita;
restaurar schedule-1500.sql únicamente si el usuario revoca el nuevo horario.
Conservar prepare_run privada y todos los turnos/artículos existentes.
