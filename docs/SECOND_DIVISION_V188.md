# Segunda División · v188

Añade Más → Segunda División con General y Por jornada. Cada jornada publicada abre el once titular de cada participante, puntos, capitán y formación. La cuenta de administrador se excluye por su ID de Mister, solo en Segunda.

## Datos e importación

- Segunda: comunidad Mister 978196. Primera conserva 649733.
- General usa los puntos totales oficiales de Mister; no suma las jornadas importadas.
- Publicar primero General permite confirmar la cuenta de Ernesto y guardar su ID.
- Luego se importa y publica cada jornada elegida, con sus once históricos. No se usa la plantilla actual.
- Una corrección sustituye la tabla y sus alineaciones en una sola transacción. Repetir la misma solicitud no duplica puntos.
- Revisión explícita ante cambios en la lista de participantes; control de revisión contra publicaciones simultáneas.
- Se conservan el orden y los desempates que muestra Mister, renumerados tras excluir al administrador.
- Los puntos pendientes, el indicador de no jugó, las posiciones vacías y el saldo negativo tienen estados distintos.
- Sin alineación disponible por saldo negativo se informa de esa ausencia.
- La captura se detiene si cambia la liga, jornada o clasificación durante la lectura.
- No hay sincronización automática ni publicación sin revisión.

## Separación y seguridad

La migración supabase-second-division.sql se aplicó en Cuban League (pyahosamoisqcbpvzwka). Es aditiva.

- public.second_division_standings: una tabla por temporada/jornada; 0 = General.
- public.second_division_lineups: una alineación por temporada/jornada/participante.
- Ambas permiten solo lectura a anon/authenticated. Escrituras exclusivamente por RPC con private.is_league_admin().
- private.second_division_settings: ID excluido, sin exposición pública.
- private.second_division_history: cada revisión publicada con tabla y alineaciones.
- El importador original, catálogo, cálculos deportivos y datos históricos no se modificaron.
- El sistema de respaldos/restauración anterior sigue cubriendo Primera. Segunda tiene su historial privado independiente; restaurar un respaldo anterior de Primera no cambia Segunda.
- La extensión mantiene sus permisos y orígenes existentes. Los trabajos de Segunda tienen mensajes y almacenamiento propios; solo se permite una lectura de Mister a la vez.

## Rendimiento y diseño

Estilos con prefijo second; sin dependencias adicionales. No se consulta Segunda al cargar Inicio. Caché en memoria de tablas durante 60 segundos, peticiones simultáneas compartidas y respuestas antiguas descartadas. Cada once se consulta solo al abrirlo y su caché está ligada a la revisión publicada.

General, selector y alineaciones se revisaron en navegador de escritorio y a 390 px. Se corrigieron cabeceras partidas y se verificó el retorno del foco al cerrar el once. Los datos de la revisión visual eran locales y no se publicaron.

## Verificación

- npm test: 131 pruebas aprobadas; incluye las 122 anteriores.
- Pruebas nuevas de captura del DOM usando una alineación real archivada, contratos, capitanes/no jugó, exclusión, propietario/origen de trabajos, cancelación, selección de jornadas, respuestas tardías, carga diferida y publicación revisada.
- tests/second-division-db.sql: publicación, reimportación, idempotencia, conflicto de revisión, exclusión estable, alineación incompleta/duplicada rechazada, corrección atómica, lectura anónima y denegación a usuarios no administradores. Todo dentro de BEGIN/ROLLBACK.
- ZIP 1.1.0 extraído con tar; los nueve archivos coinciden byte a byte con el código.
- Primera antes/después: 180 matchday_stats, digest 15aee0856d9edd3f4d33b44dd335f97b; cero matchday_drafts; nueve matchday_milestones, digest 7aa0b70225cd1c0acc6f5f609da5f695.
- Segunda quedó vacía tras las pruebas: ningún participante, punto ni once inventado.
- Pendiente: captura real desde la sesión autenticada del propietario en Mister, que no está disponible en el navegador de prueba. Debe actualizar la extensión, recargar Mister/panel e importar General y las jornadas deseadas.

## Instalación y recuperación

Guía: mister-extension-install.html#segunda. Paquete: downloads/Cuban-League-Mister-1.1.0.zip.

Empaquetar: node scripts/package-mister-extension.cjs (o el script Python existente). Ambos sincronizan los dos módulos compartidos antes de crear el ZIP.

Para retirar la interfaz, revertir el commit de v188 y desplegar con un nombre nuevo de caché del service worker. Las tablas de Segunda pueden permanecer sin uso; no hace falta borrar datos ni revertir objetos de Primera. El historial privado permite recuperar revisiones de Segunda con revisión administrativa de la tabla y sus alineaciones.
