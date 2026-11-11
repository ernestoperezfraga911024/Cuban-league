# Alineaciones de los veinte clubes · temporada 2026/27

La publicación de veinte equipos deja de depender de la prueba fija de J13. Cada club sigue su próximo partido de LaLiga verificado en las tres fuentes. Puede haber clubes en jornadas diferentes si aún quedan encuentros pendientes o aplazados. Solo se aceptan J13-J38 de 2026/27 y los veinte clubes del catálogo actual; otra temporada requiere preparar su alcance.

## Horario y continuidad

La tarea existente sustituye al piloto individual del Madrid. Comienza el 12/11/2026 a las 09:00, America/New_York. Cada día tiene cuatro turnos: 06:00 para partidos de esa mañana; 09:00 para todos los clubes pendientes de terminar la temporada; 13:00 para partidos todavía no iniciados ese día; 18:00 para encuentros dentro de 48 horas. Los turnos sin equipos no leen fuentes. El calendario termina como máximo el 30/06/2027. La publicación ocurre al terminar cada lectura validada, no necesariamente al minuto de comienzo del turno.

En la lectura general se revisa el calendario próximo desde páginas públicas, no se incrementa la jornada por una fecha fija. Se necesitan tres comprobaciones coincidentes de temporada, jornada, local, visitante y comienzo. Una fecha no confirmada, rival discordante, fuente inaccesible o jugador ajeno al catálogo bloquea ese equipo. Otros equipos válidos pueden publicarse y el resumen conserva los pendientes. Nunca se presenta una ejecución parcial como completa. Las fuentes pueden discrepar sobre titulares; el método editorial-v2 mantiene el peso del 80% de fuentes, 20% de rol y ajustes documentados, sin calibración demostrada.

Después de comenzar un partido no se actualiza ni republica su previsión. La siguiente lectura busca el próximo encuentro del club. Las publicaciones anteriores conservan su fecha y se identifican como archivo. Un cambio de horario verificado invalida una propuesta con el horario anterior. No se inventan fechas, enlaces ni plantillas; una transferencia no reflejada en el catálogo autorizado requiere corregir ese catálogo antes de usar el jugador.

## Datos y límites

`forecast_season` es un esquema privado separado. El piloto, sus límites, tablas y publicaciones permanecen intactos. La migración copia las veinte publicaciones existentes con sus fechas originales al nuevo lector público; no las considera lecturas nuevas.

- Veinte borradores actuales, hasta 64 KiB cada uno.
- Como máximo 260 partidos J13-J38, 1.000 turnos, 20.000 resultados de equipo y 5.000 comandos de administrador.
- Archivo de la última publicación por partido, equipo y horizonte: distante, medio, cercano y últimas seis horas. Conserva propuesta, fechas y titulares observados por fuente para una evaluación posterior; no calcula todavía la precisión ni cambia pesos automáticamente.
- Solo las proyecciones y el estado resumido de revisión son públicos. Las observaciones completas, borradores y motivos de bloqueo detallados permanecen privados.

El guardado y la entrega son independientes. `begin_run` fija equipos esperados; `register_fixture` registra verificaciones coincidentes; `save_draft` valida identidades, formación, alternativas, fuentes y cálculo; `deliver` respeta el modo elegido; `block_team` registra una causa sin fabricar un once; `finish_run` cuenta publicados, preparados, bloqueados y ausentes. Una clave de turno y equipo admite un solo contenido. Los reintentos conservan esa clave y los comandos manuales su UUID.

La retención está acotada dentro del proyecto Free existente. No se instala cron, API comercial/de modelos, infraestructura o servicios nuevos. No se modifican clasificación, puntos, jornadas de la liga fantasy ni el catálogo. No se crean tareas adicionales.

## Control del usuario

Administración → Alineaciones muestra los veinte clubes, modo Automático/Manual, consulta, publicación, bloqueos y resumen del último turno. En Manual basta Publicar por equipo o Publicar listos; la vista previa es opcional. Retirar un equipo elimina su proyección pública y pausa su publicación automática; las lecturas continúan y un clic explícito en Publicar lo reactiva. El botón Publicar listos no reactiva equipos retirados.

La web pública realiza una sola lectura al entrar y reutiliza los veinte resultados al cambiar de club. Muestra las fechas reales de comprobación y publicación en hora de Miami. Las fechas dentro del detalle de fuentes/partido conservan su etiqueta Madrid. El botón Actualizar y volver a una pestaña visible consultan la base; no ejecutan un análisis nuevo. No hay sondeo continuo ni respuestas privadas en caché. Una retirada o error de lectura limpia el once; no se recupera silenciosamente el antiguo piloto.

El historial del piloto anterior sigue disponible como solo lectura. Sus controles de edición/publicación se ocultan para evitar dos autoridades distintas en el mismo panel. Las funciones antiguas se conservan para una reversión explícita, pero la nueva tarea y la web de temporada usan exclusivamente el nuevo flujo.

## Verificación y reversión

`tests/forecast-season.test.cjs` cubre jornadas posteriores, veinte clubes, una consulta pública, retirada sin recuperación de datos antiguos, modo Manual, respuesta perdida e idempotencia, limpieza al salir y recursos publicados. `tests/forecast-season-db.sql` se ejecuta en la misma transacción que la migración: usa los datos ya guardados como fixtures sintéticos, un reloj de prueba limitado a una subtransacción y revierte todos los intentos/publicaciones de prueba. Comprueba veinte propuestas, permisos, bloqueo, frescura, reintentos, progreso parcial y avance independiente a J14. Ninguna fecha sintética puede quedar guardada.

Para detener la actividad, pausar la tarea existente y seleccionar Manual. Para revertir la interfaz, conservar la base nueva y volver a los recursos anteriores; no borrar el archivo ni restaurar respaldos. La reversión de interfaz vuelve a mostrar las publicaciones del piloto, que conservan sus fechas originales. No es una restauración deportiva automática.

La primera ejecución programada real permanece pendiente hasta el 12/11/2026. Una programación habilitada no demuestra éxito. Deben cotejarse el resumen del turno y las filas públicas de cada equipo.
