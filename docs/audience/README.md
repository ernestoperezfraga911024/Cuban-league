# Audiencia por perfil y sección

Ampliación independiente del contador anónimo V58. La elección de perfil es declarativa, nunca autenticación ni autorización. Se envían únicamente UUID aleatorio de navegador/visita, ID público del participante (1..20; 0 sin identificar) y una sección de la lista cerrada. No se guardan nombres, IP, URL completa, búsquedas, fingerprint, credenciales ni datos de partidos en esta tabla. Los nombres se resuelven desde `data.json` en el panel privado.

## Conteos

- `site_visits` conserva los totales existentes. Las visitas nuevas se comparten entre pestañas del navegador y se renuevan tras 30 minutos sin actividad observada. Versiones antiguas conservan su contador por sesión de pestaña, por lo que los totales históricos no tienen exactamente la nueva definición.
- Una sección se cuenta una vez por visita y día Miami, con independencia de recargas o reintentos. El primer/último instante los fija el servidor. No mide duración de lectura ni garantiza atención humana.
- Cada perfil cuenta visitas distintas; cambiar de perfil no cambia registros anteriores. Una visita puede incluir varios perfiles. El resumen de visitas identificadas cuenta esa visita una sola vez; “sin identificar” cuenta visitas sin ningún perfil elegido en el periodo. Los totales por perfil no necesariamente suman el total de visitas.
- La actividad anónima anterior a elegir un perfil sigue anónima. Las visitas antiguas V58 nunca se rellenan ni se atribuyen retrospectivamente.
- Los nombres son autodeclarados y las métricas aproximadas: almacenamiento bloqueado/borrado, bots o peticiones falsificadas pueden distorsionarlas. No se usan para premios, clasificación, autenticación o decisiones de acceso.
- Sin almacenamiento disponible se mantiene una sesión en memoria; una recarga puede contar de nuevo. El navegador marcado como propietario sigue excluido.
- Olvidar la elección detiene la asociación futura; no borra estadísticas ya registradas. Invitado no envía ID de participante. El selector y el menú explican esta diferencia.

## Seguridad y despliegue

`docs/audience/upgrade.sql` es aditivo. Aplicar al proyecto Cuban League antes del frontend. Mantiene intactas funciones V58, datos fantasy, catálogo, publicaciones y permisos administrativos. La nueva tabla privada tiene RLS y ningún acceso directo para anon/authenticated. `track_site_activity` es un endpoint público de escritura acotado, security definer justificado para no conceder INSERT/SELECT a visitantes: valida sección/ID, conserva el vínculo sesión/navegador y no devuelve datos. `get_site_audience` exige el guard existente `private.is_league_admin() IS TRUE`, además del permiso authenticated. Un perfil elegido nunca satisface este guard.

El panel consulta 1/7/30 días por fecha Miami. Se depuran hasta 200 filas con más de 90 días por petición válida; al no existir tarea nueva, la depuración es progresiva y depende de actividad. Las estadísticas recientes están separadas del histórico anónimo.

Rollback: restaurar el frontend anterior mantiene el contador V58; dejar tabla y funciones nuevas inactivas conserva datos. No requiere borrarlos ni revertir otras migraciones.

## Verificación

`npm test` usa PGlite 0.3.14 (dependencia de desarrollo fijada) y JSDOM. Pruebas de roles reales en PostgreSQL local: visitante sin SELECT, authenticated sin condición admin rechazado incluso con NULL, guard de administrador, identidad no reasignada, reintentos, períodos, invitados, retención y UUID no expuestos. Pruebas cliente: navegación, recarga, pestañas, inactividad, invitados, perfil retirado, propietario excluido, almacenamiento bloqueado, errores de red y render seguro.

La prueba heredada de hash `catalog/players.json` ya falla en main; este cambio no modifica ese catálogo. Las pruebas visuales usan datos ficticios fuera del repositorio y jamás registran visitas de prueba en producción.
