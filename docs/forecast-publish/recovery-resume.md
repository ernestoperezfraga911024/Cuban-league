# Recuperación de turnos anteriores pendientes

La comprobación del 16/11/2026 encontró el turno vacío de las 18:00 y respondió
`complete`, aunque el de las 14:00 conservaba cuatro pendientes. La selección de
`resume_incomplete` y la guarda de `begin_recovery` solo admitían el último turno.

`recovery-resume.sql` selecciona el turno incompleto más reciente de las últimas
24 horas. Un turno vacío o de otros equipos no oculta trabajo anterior. Para cada
equipo, un turno programado posterior asume su trabajo; el anterior no lo vuelve
a procesar aunque el posterior siga pendiente. Los terminales publicados,
privados ready y bloqueados siguen siendo terminales dentro de su familia.

Se conservan prioridad del plan programado, dos horas de recuperación/evidencia,
saved intactos, guardas de concurrencia, límites de temporada y permisos privados.
No se alteran filas deportivas, históricos, cálculo v6 ni horarios. Los ocho
equipos que aún usaban v5 requieren una reparación interactiva autorizada con
lecturas nuevas; la recuperación automática de pendientes no reclasifica ni
reescribe publicaciones terminales antiguas.

La migración verifica las tres definiciones revisadas antes de reemplazarlas en
una transacción. Reversión: `recovery-resume-rollback.sql`, que conserva las
definiciones anteriores y no toca datos. No revertir durante un lector activo.

La regresión PostgreSQL reproduce el fallo previo y prueba selección anterior,
turnos parciales, terminales, idempotencia, saved, caducidad, recuperación manual,
ventana programada y conservación de filas/permisos. Estas pruebas locales no
acreditan una publicación real; el cierre de la ejecución se registra aparte.
