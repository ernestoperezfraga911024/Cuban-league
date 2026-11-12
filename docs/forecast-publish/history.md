# Historial de alineaciones: LaLiga 2026/27, J13–J38

El historial conserva el pronóstico publicado y compara sus once jugadores con los titulares reales verificados en FutbolFantasy. No modifica el cálculo editorial, las publicaciones vigentes, los puntos, el catálogo ni las jornadas fantasy.

## Pronóstico comparable

Cada publicación de forecast_season.archive se copia a una instantánea privada e inmutable con su fecha original y su evidencia. La importación inicial conserva las publicaciones reales existentes; no se considera lectura nueva.

La referencia de evaluación es la última publicación anterior al cierre preventivo: dos horas antes del comienzo verificado, o la hora de anuncio oficial si se verifica una anterior. Todas sus fuentes deben haberse leído antes del cierre. Este límite es una convención conservadora, no una garantía de que nadie conociera el once. Los bloques expresamente confirmados dejan de ser válidos para alimentar previsiones. Una comprobación posterior nunca puede adelantar el cierre ni modificar retroactivamente el pronóstico para mejorar el acierto.

Los horarios aplazados conservan la clave del partido. El historial conserva las instantáneas de las fechas anteriores, pero solo compara una publicación correspondiente al horario vigente. Un partido ya iniciado no admite reabrir el pronóstico por una reanudación.

## Recogida y entrega

La tarea existente comprueba el historial cada hora entre las 06:00 y las 23:00 de Miami, hasta el 30/06/2027. Solo abre páginas cuando forecast_history.plan() devuelve encuentros pendientes. Las previsiones mantienen sus turnos de las 06:00, 13:00 y 18:00, con las claves y límites de reintento existentes. Las comprobaciones adicionales no crean ejecuciones ni intentos de forecast_season.

Primero se entregan los resultados guardados que el plan permite publicar. Después se consulta la URL pública de partido registrada de FutbolFantasy. Una lectura real puede servir para ambos rivales. Se exige coincidencia de temporada, jornada, clubes, fecha/hora, un bloque de once confirmado, estado de encuentro realmente iniciado/finalizado y once identidades válidas del roster. Los suplentes y los jugadores que entran después no son titulares.

La lectura al inicio genera una comparación inicial. Se vuelve a comprobar después para verificar el final y posibles cambios tardíos del once. No se garantiza ejecución al minuto del saque inicial. Si falta evidencia, se conserva pendiente y se recupera en comprobaciones posteriores, incluida la del día siguiente. La ventana de dos horas afecta a la frescura de la lectura y a los turnos de probables, no a la antigüedad de un partido pendiente.

Automático publica las comparaciones validadas. Manual conserva el resultado privado hasta pulsar «Publicar resultados pendientes». Las retiradas ocultan el historial también desde la base de datos. Volver a publicar el pronóstico de un equipo no restaura silenciosamente sus comparaciones retiradas; estas pueden publicarse expresamente cuando el equipo esté activo.

## Vista pública

Dentro de Alineaciones se alterna entre Próximo partido e Historial. El historial incluye selector J13–J38, escudos con el porcentaje de la jornada o el acumulado, fotografías del catálogo y marcas de acierto/fallo. El porcentaje original del jugador permanece separado del resultado real.

Por partido, acierto = titulares previstos que realmente empezaron / 11. El acumulado suma aciertos y divide entre 11 por cada partido evaluado. Pendientes y «Sin pronóstico comparable» quedan fuera, sin convertirse en ceros. Una comparación inicial aparece identificada hasta la revisión final. No se modifican pesos de fuentes por estos resultados.

La página carga el historial solo al abrirlo: una consulta compacta de resúmenes y otra de la jornada seleccionada. Cambiar de club o de métrica usa los datos ya cargados. Al volver a la pestaña o actualizar se renueva la lectura para respetar retiradas.

## Contratos y seguridad

- forecast_history.plan(): selección independiente de encuentros y entregas pendientes.
- forecast_history.save_official(jsonb): valida y conserva hechos de once confirmado.
- forecast_history.record_failure(jsonb): registra el intento fallido sin borrar resultados válidos.
- forecast_history.deliver(fixture_key,team): respeta modo y retiradas.
- public.forecast_history_public: proyección pública limitada, SELECT con RLS; ninguna escritura anónima.
- get_forecast_history_admin() y publish_forecast_history(expected,request_id): comandos con identidad real de administrador, control de versión e idempotencia.

La tarea no llama a los comandos de administrador ni usa JWT suplentes. Las nuevas funciones internas no se exponen a los roles web. Las evidencias, instantáneas y comandos permanecen privados. No se crean servicios, proyectos, ramas Supabase ni tareas adicionales.

## Validación y despliegue

history.sql es aditivo y se aplica al proyecto existente una vez revisado el PR. Las pruebas de base de datos usan PostgreSQL en memoria ya disponible; sus datos ficticios nunca se envían a producción. Las pruebas de interfaz cubren carga diferida, identidad de partidos J13, conteos, navegación, errores, fotos ausentes y publicación manual. Se comparan las huellas de las tablas existentes antes y después de aplicar.

La validación visual con navegador real requiere un navegador de pruebas autorizado disponible; no se sustituye por una sesión privada del usuario. Una prueba DOM/CSS no equivale a una captura visual de escritorio y móvil.

