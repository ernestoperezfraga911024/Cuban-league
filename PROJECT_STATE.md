# PROJECT STATE — Cuban League

> Memoria técnica operativa del proyecto. Mantener compacta y centrada en el estado actual. No guardar passwords, tokens, claves de cifrado, cookies, API secrets ni credenciales de Supabase/GitHub.

## Snapshot

- **Proyecto:** Cuban League
- **Repositorio:** `ernestoperezfraga911024/Cuban-league`
- **Rama principal:** `main`
- **Versión funcional actual:** V173
- **Último commit verificado:** `7ee8d6dcceb5f7dbac08e01858f63d994988b506`
- **Fecha de verificación:** 2026-09-23
- **Temporada configurada:** 2026/27
- **Supabase:** proyecto activo y saludable verificado en vivo.
- **Estado:** web pública + panel privado de administración + PWA + integración asistida con Mister mediante extensión Chrome y Supabase.

## Objetivo

Gestionar y publicar Cuban League, una liga fantasy con:
- clasificación y jornadas;
- alineaciones y capitanes;
- goles, clean sheets y tarjetas rojas;
- Liga, Copa y Champions;
- perfiles, estadísticas, récords e insignias;
- archivo histórico;
- tarjetas para compartir;
- panel privado para preparar/publicar jornadas;
- importación controlada desde Mister.

La web pública nunca debe mostrar borradores no publicados.

## Stack

- **Frontend:** HTML, CSS y JavaScript vanilla.
- **Web pública:** `index.html` + `app.js` + `styles.css`.
- **Admin:** `admin.html` + `admin.js` + `admin.css`.
- **Datos estáticos/históricos:** `data.json`.
- **Catálogo:** `catalog/players.json` + `player-catalog.js`.
- **Backend:** Supabase Auth + Postgres + RLS + RPCs.
- **Edge Function:** `mister-import-collector`.
- **PWA/offline:** `sw.js`, manifests e iconos.
- **Mister integration:** extensión Chrome en `mister-extension/` + `mister-import-core.js`/helper.
- **Tests:** Node test runner + jsdom.
- **Packaging extensión:** script Python.
- **Backups externos:** GitHub Actions + Supabase CLI + cifrado OpenSSL.

Comandos principales:
```bash
npm ci
npm test
npm run package:extension
```

## Arquitectura de datos

Hay dos fuentes complementarias:

1. **Repositorio / `data.json`:** configuración, participantes, historia, Champions, récords, contenido editorial y datos que no dependen de publicación inmediata.
2. **Supabase:** jornadas vivas/publicadas, borradores, milestones, historial de cambios, visitas, backups y estado de concurrencia/importación.

La web pública consulta solamente jornadas publicadas. El panel privado administra drafts y publicación.

## Supabase vivo

Proyecto verificado: Postgres 17, región US East.

### Tablas públicas

- `matchday_stats`
  - Jornada publicada por participante.
  - Puntos, goles, clean sheets, red cards.
  - `lineup` JSONB.
  - `has_postponed_matches`.
  - `negative_balance_no_score`.
  - `mister_rank`.
  - `published`.
  - RLS habilitado.

- `matchday_drafts`
  - Datos de jornada antes de publicar.
  - Permite valores incompletos/null durante revisión.
  - Guarda lineup, postponed, negative balance y Mister rank.
  - RLS habilitado.

- `matchday_change_log`
  - Historial de publicación/corrección.
  - Snapshots before/after.
  - Soporta undo y tracking de milestones.
  - RLS habilitado.

- `matchday_milestones`
  - Fecha de jornada.
  - Cierre mensual/anual.
  - Base de premios automáticos como Jugador del Mes/Campeón de Invierno.
  - RLS habilitado.

- `site_visits`
  - IDs anónimos de visitor/session y path.
  - No guardar nombres, emails ni IPs.
  - RLS habilitado; escrituras públicas pasan por RPC.

### Tablas privadas

- `private.league_admins`
- `private.league_backups`
- `private.league_backup_state`
- `private.matchday_write_state`
- `private.matchday_milestone_drafts`
- `private.mister_import_requests`

Estas tablas sostienen administración, backups, optimistic concurrency, milestones no publicados y solicitudes efímeras de importación Mister.

## Autenticación y permisos

- Admin autenticado con Supabase Auth.
- La autorización real del panel se basa en la lista privada `private.league_admins`.
- `private.is_league_admin()` es la comprobación central.
- Visitantes anónimos solo deben leer información pública/publicada.
- Escrituras de jornada, backups, restore, imports y analytics privados deben pasar por RPCs que validen al administrador.
- No añadir un segundo camino de escritura directa desde el navegador.

## Publicación de jornadas

Principios:
- Draft primero, publicación después.
- Una jornada publicada no se reemplaza silenciosamente.
- Correcciones y undo quedan registradas en `matchday_change_log`.
- V124 añadió restore generation + write revisions para impedir que pestañas/dispositivos viejos sobrescriban datos restaurados o más recientes.
- Las operaciones críticas deben seguir siendo atómicas.
- Los datos de milestone no publicados se mantienen separados hasta la publicación correspondiente.

RPCs importantes observados:
- `save_matchday_draft_v124`
- `publish_matchday_revision_v124`
- `undo_last_matchday_publication_v124`
- `save_matchday_milestone`
- `get_matchday_write_state`
- RPCs de backup/restore
- RPCs de importación Mister

## Integración Mister

**No es una integración oficial de Mister.**

### Componentes
- Extensión Chrome: versión requerida 1.0.2.
- Liga Mister verificada por ID: `649733`.
- Panel inicia una solicitud controlada.
- Supabase/collector usa solicitudes efímeras.
- Captura se revisa antes de guardar.
- El resultado se guarda como **draft**, nunca se publica automáticamente.

### Datos importados
- 20 participantes de la liga.
- XI titular, sin suplentes.
- Capitán opcional.
- Puntos visibles.
- Goles.
- Clean sheets del portero.
- Tarjetas rojas, incluida doble amarilla.
- Estado no jugó = 0 cuando Mister muestra el indicador explícito.
- Saldo negativo = equipo no puntúa cuando está marcado.
- Orden de la tabla de Mister guardado como `mister_rank`.

### Reglas de identidad
- Resolver primero por Mister player ID.
- No adivinar identidades por nombres ambiguos.
- Un ID desconocido no se asigna a un jugador que ya tenga otro ID.
- Club/posición capturados se preservan en el snapshot de esa jornada.
- Incidencias de catálogo se agrupan para revisión antes de aplicar.
- Reimportar no debe acumular puntos ni duplicar filas.
- Si falla la lectura, conservar el draft existente.
- Antes de aplicar una captura, el panel conserva una referencia local de la versión previa.

### Edge Function
- `mister-import-collector` está activa.
- El gateway está configurado con `verify_jwt=false`; por tanto, su seguridad depende del protocolo propio de request/token y de las comprobaciones internas. No modificar esta frontera sin revisar el flujo completo.

## Liga

Clasificación acumulada usa:
1. puntos;
2. goles;
3. clean sheets;
4. desempate estable definido por la aplicación.

Funciones visibles:
- clasificación general;
- clasificación de jornada;
- forma reciente;
- movimiento de posiciones;
- alineaciones por jornada;
- goleadores / clean sheets;
- perfiles y estadísticas;
- comparador;
- récords y palmarés.

## Liga sin bonus

Añadida en V173 dentro de Clasificación → Estadísticas.

- Solo informativa/read-only.
- Parte del total oficial publicado.
- Elimina únicamente el extra del capitán; conserva los puntos base del jugador y demás ajustes/penalizaciones.
- Respeta las reglas de redondeo de los multiplicadores de capitán.
- Si faltan jornadas, XI o datos de capitán, no inventa totales/puestos.
- Los aplazados pueden mostrar resultado provisional.
- No escribe en Liga oficial, Copa, Champions, insignias ni estadísticas existentes.

## Copa

Código actual:
- inicia en Jornada 4;
- final prevista en Jornada 22;
- eliminación progresiva según las reglas del torneo;
- en empate de puntos se usa `mister_rank` cuando corresponde;
- saldo negativo/no-score debe aplicarse incluso con postponed matches;
- si faltan datos de Mister necesarios para un desempate, no inventar el resultado.

## Champions

- Configuración vive en `data.json`.
- Fase de grupos configurada con 4 grupos de 5 participantes.
- 8 jornadas de Champions se derivan de jornadas específicas de Liga.
- Los puntos/goles/clean sheets/rojas usados por Champions se derivan de datos publicados de Liga según el mapping configurado.
- Fases posteriores, histórico, premios y campeón defensor dependen de la configuración/histórico del proyecto.
- No duplicar manualmente estadísticas que ya pueden derivarse de Liga.

## Estadísticas, perfiles e insignias

Incluye:
- estadísticas acumuladas y por jornada;
- capitanes;
- líneas/posiciones;
- MVP y líderes;
- récords históricos;
- Jugador del Mes;
- Campeón de Invierno;
- perfiles históricos;
- Pizarra del Míster;
- tarjetas/share cards.

**V172:** la insignia `El Muro` fue eliminada del catálogo, cálculo y perfiles. No reintroducirla por datos históricos viejos.

## PWA / cache

`sw.js` mantiene app shell y recursos estáticos.
- HTML/navigation: network-first con fallback.
- `data.json` y catálogo: network-first.
- JS/CSS principales: network-first.
- resto de assets: stale-while-revalidate.
- Cada release importante debe rotar `CACHE_NAME`/version strings cuando cambien assets que deban invalidarse.

Cache actual: V173 League No Bonus.

## Backups

### Backups rápidos internos
V124 mantiene:
- últimas 7 copias diarias;
- 4 semanales;
- hasta 10 manuales;
- 5 preventivas/pre-restore.

Incluyen jornadas, lineups, capitanes, postponed, drafts, milestones e historial de cambios. No incluyen visitas, Auth users ni fotos.

### Backup externo cifrado
Workflow:
`.github/workflows/supabase-backup.yml`

- Schedule diario: `17 9 * * *` UTC.
- Dump de roles, schema y data.
- Schemas: `public` y `private`.
- Checksums SHA-256.
- Cifrado AES-256-CBC/PBKDF2 antes de subir artifact.
- Daily artifact: 7 días.
- Sunday/weekly artifact: 28 días.
- Secrets obligatorios permanecen solo en GitHub Actions.

El repositorio es público. Nunca guardar `SUPABASE_DB_URL` ni `BACKUP_ENCRYPTION_KEY` en el código, documentación operativa con valores reales, chat o screenshots.

## Seguridad — estado observado 2026-09-23

- RLS está habilitado en todas las tablas públicas principales.
- Las tablas `private.*` no tienen RLS, pero una verificación adicional mostró:
  - `anon` no tiene USAGE sobre schema `private`;
  - no se observaron grants directos de tablas `private` para `anon`, `authenticated` o `PUBLIC`;
  - el Security Advisor de Supabase no reportó esas tablas privadas como exposición externa.
- Aun así, mantener `private` fuera de schemas expuestos y conservar los `REVOKE` existentes.

Security Advisor sí reporta puntos a revisar:
1. `public.site_visits` tiene RLS sin policies; el diseño actual escribe mediante `track_site_visit`, por lo que no “arreglar” creando una policy abierta sin revisar el modelo.
2. `public.rls_auto_enable()` y `public.track_site_visit(...)` aparecen como SECURITY DEFINER ejecutables por `anon`. `track_site_visit` es intencionalmente público para métricas; revisar si `rls_auto_enable` necesita EXECUTE público.
3. Varias RPC SECURITY DEFINER son ejecutables por usuarios autenticados. Muchas forman parte del panel admin; conservar comprobaciones internas de administrador y revisar grants al tocarlas.
4. Leaked Password Protection de Supabase Auth aparece deshabilitado; considerarlo como hardening del único acceso administrativo.

No aplicar automáticamente cambios de RLS/grants sin probar el panel, la web pública, backups y Mister import.

## Migraciones Supabase registradas recientemente

- `allow_matchday_lineups_without_captain`
- `secure_mister_draft_import_bridge_v162`
- `add_negative_balance_no_score`
- `v170_cup_mister_order`

Los SQL históricos V57/V58/V59/V65/V114/V116/V124 siguen en el repo. No reejecutar versiones antiguas indiscriminadamente; algunas fueron reemplazadas o requieren volver a instalar protecciones V124.

## Cambios recientes relevantes

- **V173:** Liga sin bonus read-only con reconstrucción verificada del bonus de capitán.
- **V172:** retirada de El Muro.
- **V171:** saldo negativo elimina correctamente en Copa aunque haya postponed.
- **V170:** Mister rank usado/persistido para desempates de Copa.
- Extensión 1.0.2: indicador “no jugó” se convierte correctamente en 0.
- Auditoría amplia del catálogo Mister y correcciones de identidades/clubes.
- D. Otorbi incorporado al catálogo tras validación de J5.

## Trabajo pendiente / verificación futura

- Primera importación/recorrido real de cada cambio importante de extensión debe validarse en Chrome con el admin; tests simulados no sustituyen ese control.
- Vigilar cambios de DOM de Mister.
- Revisar periódicamente Security Advisor y grants de RPCs.
- Probar restauración externa en un proyecto temporal periódicamente.
- Confirmar que GitHub Actions programado siga activo; GitHub puede desactivar schedules en repos públicos inactivos.
- Mantener catálogo e IDs Mister como fuente de identidad; no resolver errores futuros con aproximaciones agresivas de nombres.

## Precauciones al modificar

- Leer este archivo primero y luego comprobar el código/Supabase implicado.
- Si hay contradicción, el código actual + Supabase vivo tienen prioridad.
- Nunca publicar automáticamente una jornada importada.
- No convertir valores desconocidos/null de Mister en 0 salvo una regla explícita y verificada.
- No cambiar reglas históricas o estadísticas existentes al añadir una vista informativa.
- No mezclar Liga oficial con Liga sin bonus.
- No romper restore generation/write revision de V124.
- No desactivar validaciones de catálogo para “hacer pasar” una importación.
- No exponer tablas privadas ni secretos.
- Cambios visuales triviales no requieren actualizar este archivo.

## Última actualización

**2026-09-23** — Bootstrap inicial de `PROJECT_STATE.md`, verificado contra `main`, README V173, código principal, Supabase vivo, Edge Functions, migraciones registradas, Security Advisor y sistema de backups.
