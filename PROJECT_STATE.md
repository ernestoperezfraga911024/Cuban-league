# PROJECT STATE — Cuban League

> Memoria técnica operativa del proyecto. Mantener compacta y centrada en el estado actual. No guardar passwords, tokens, claves de cifrado, cookies, API secrets ni credenciales de Supabase/GitHub.

## Snapshot

- **Proyecto:** Cuban League
- **Repositorio:** `ernestoperezfraga911024/Cuban-league`
- **Rama principal:** `main`
- **Versión:** V185: buscador del ranking general y desglose por jornada al tocar puntos de capitanes. Conserva el redondeo V184 y todos los cálculos existentes.
- **Publicación:** GitHub Pages desde `main`, mediante PR y comprobación del despliegue. Rama V185: `codex/captain-search-details-v185`; comprobar Pages del commit integrado antes de dar la publicación por terminada.
- **Base de esta actualización:** `00391da` (main V184). Revertir únicamente el PR V185 retira estos controles sin restaurar datos.
- **Respaldo anterior:** `backup/pre-editorial-redesign-v174-20261015`, commit `24bc164f6d860b4bb4d1e441807da9530b0a0583`. Revertir solo el código para conservar jornadas nuevas.
- **Fecha de verificación del código:** 2026-10-19 UTC / 2026-10-18 Miami. Auditoría de lectura sobre 160 filas publicadas, 20 participantes y 8 jornadas: 7.466 puntos oficiales. Se comprobaron 697 acumulados por futbolista/participante contra sus jornadas; estadísticas, perfiles, rankings y HTML de tablas oficiales/históricas idénticos antes y después. Pruebas: `npm test` (112 casos).
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

## Búsqueda y desglose de capitanes (V185)

- Ranking general: búsqueda por futbolista, participante o ambos, sin distinguir acentos/mayúsculas. Busca también fuera del top 20 y mantiene los puestos del criterio elegido. Limpiar devuelve la lista anterior; cambiar criterio conserva la consulta.
- Filtra rankings ya calculados y reemplaza solo los resultados, conservando el campo, el foco y el teclado. No realiza consultas de red al buscar.
- Puntos es un botón en ambas vistas de capitanes (mejores y peores). Abre un detalle dentro de la tarjeta; el contenido se genera solo al abrirlo. Cada jornada enlaza al modal de XI existente y conserva el foco al regresar.
- El detalle reutiliza las filas publicadas obtenidas por `ensureLeagueStatsData`. Índice diferido en WeakMap por snapshot; aplica las mismas reglas de deduplicación, última corrección, XI completo e identidad por participante/futbolista. Libera las filas crudas al crear el índice y no mezcla snapshots.
- Verifica número de apariciones y suma contra el agregado antes de mostrarlo. Base estimada, multiplicador y final; los totales se suman antes de redondear. Aplazados señalados. No altera `buildLeagueStats`, consultas, normalización, clasificación, perfiles, administración, catálogo, datos ni históricos.
- Recursos app/CSS/SW: `185-20261019-captain-details`; caché `cuban-league-v185-captain-details`. Sin dependencias nuevas ni escrituras de datos.
- Pruebas: `npm test` (117 casos). Cinco casos nuevos de búsqueda fuera del top, posiciones/foco, datos congelados, traspasos, correcciones, XI incompletos, negativos/cero/redondeos, apertura/cierre de XI y actualización fallida. Contratos de datos/cálculos y 627 imágenes originales conservados.

## Redondeo visual de estadísticas (V184)

- Capitanes (ambas vistas y todos los criterios), Bonos acumulados, Líneas, MVP, Liga sin bonus y Comparador muestran enteros con `leagueStatsFormat`.
- Redondeo al entero más cercano, mitades alejándose de cero; evita `−0`/`+0` y conserva `—` para valores desconocidos. Una única instancia de `Intl.NumberFormat`.
- Primero se suman y dividen los puntos completos de las jornadas; solo se formatea el resultado final. Nunca se suman valores ya redondeados.
- Orden, empates y corte del top 20 conservan toda la precisión. La nota visible explica por qué dos valores mostrados iguales pueden ocupar puestos distintos.
- `profileSeasonFormat`, normalización, todas las funciones de cálculo, perfiles, jornadas, clasificación oficial e históricos permanecen intactos. El bono estimado de las tarjetas sigue identificado como estimado; no sustituye el bono verificado.
- Sin consultas adicionales, dependencias, cambios de datos, SQL de escritura o migraciones. Se actualizan únicamente presentación, caché y pruebas/documentación.
- Recursos `app.js`/registro SW: `184-20261019-rounded-stats`; caché `cuban-league-v184-rounded-stats`. CSS, catálogo y datos mantienen sus versiones.
- Pruebas nuevas: una sola operación de redondeo, negativos/mitades/cero/ausencias, suma de dos bonos de 2,5 = 5, todas las vistas con datos congelados y rankings sin empates artificiales.

## Ranking general de capitanes (V183)

- Estadísticas → Capitanes: «Por participante» conserva las cuatro opciones existentes; «Ranking general» reúne todas las parejas futbolista–participante, con Más puntos, Mejor promedio y Peor promedio.
- Abre en Más puntos; cada vista conserva su criterio. Muestra los primeros 20 puestos con todos los empates del corte y permite Ver todos / Ver primeros 20 puestos.
- Deriva exclusivamente de `buildLeagueStats().teams[].captains`; no modifica esa función, las alineaciones, el ranking oficial ni los historiales. Solo cuenta actuaciones como capitán en XI publicados completos, conforme al cálculo existente.
- Reutiliza identidad, foto, métricas y bono estimado de las tarjetas existentes; el bono se identifica como estimado y no reemplaza el extra verificado de la tabla Bonos acumulados.
- Ranking calculado al abrir y guardado en WeakMap por snapshot y criterio. Nuevos datos publicados invalidan naturalmente el ranking. Sin nuevas consultas, dependencias, escrituras o migraciones.
- Tarjeta compacta con futbolista principal, foto a la derecha, participante enlazado debajo y cuatro métricas. Aplazados indicados como provisionales.
- Caché y recursos actualizados a `183-20261018-global-captains`.

## Stack

- **Frontend:** HTML, CSS y JavaScript vanilla.
- **Web pública:** `index.html` + `app.js` + `styles.css`; `mobile-navigation.css` y `editorial-ui.js` solo para la barra y el menú Más.
- **Tarjetas compactas:** `stats-compact.css`, limitado a Capitanes y MVP; incluye búsqueda, tarjetas del ranking general y desglose de capitanes. Sin nuevas dependencias.
- **Marca F05:** `cuban-league-f05-logo.svg` (menos de 2 KB, sin fuentes, imágenes embebidas ni filtros) + iconos PNG generados en distintos tamaños. `brand-f05.css` (menos de 8 KB) solo cambia colores/efectos; mantiene geometría, responsive y contenidos. `node scripts/build-brand-icons.cjs` regenera los iconos con Inkscape, solo en desarrollo.
- **Admin:** `admin.html` + `admin.js` + `admin.css`, con su aspecto anterior. Los archivos del tema editorial se conservan como referencia, sin cargarse.
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

**V180 — Capitanes:**
- «Bonos acumulados» se sitúa junto a «Mejor promedio» y muestra todos los
  participantes por bono total descendente; suma el extra de todos sus capitanes.
- Reutiliza `data.noBonus.teams[].bonus` y su validación, sin alterar los cálculos
  existentes. Respeta redondeo, bonos negativos, saldo negativo y ausencia de capitán.
- Empates comparten puesto. Si faltan datos se ocultan el total incompleto y los
  puestos; las jornadas aplazadas quedan señaladas como provisionales.
- «Peores capitanes» selecciona el menor `captainAverage` de cada participante
  y ordena ascendente. Usa puntos finales por jornada, muestra todos los empatados
  y conserva jornadas, puntos y bono estimado de las tarjetas existentes.
- Sin capitanes no se inventa un puesto. Las nuevas opciones siguen accesibles
  aunque no haya XI; la tabla distingue datos pendientes de bonos verificados en 0.
- Vistas de lectura con datos ya cargados; sin nuevas consultas, escrituras,
  dependencias ni cambios en Liga oficial, Copa, Champions o perfiles.

**V181 — Presentación compacta:**
- Participante a la izquierda y futbolista con su foto a la derecha. Debajo,
  una banda compacta con etiquetas y métricas; el escritorio amplio usa una fila.
- Aplicado a Más puntos, Mejor promedio, Peores capitanes y MVP. La tabla de
  bonos acumulados, Líneas, comparador y perfiles mantienen su presentación.
- Nombres completos y notas de empate pueden envolver a varias líneas;
  no se recortan ni se fija una altura que oculte información.
- Se conserva la lógica de ranking y todas las métricas/fotos existentes.
- CSS aislado, sin consultas nuevas, librerías, mediciones JS ni cambios de datos.

## PWA / cache

`sw.js` mantiene app shell y recursos estáticos.
- HTML/navigation: network-first con fallback.
- `data.json` y catálogo: network-first.
- JS/CSS principales: network-first.
- resto de assets: stale-while-revalidate.
- Cada release importante debe rotar `CACHE_NAME`/version strings cuando cambien assets que deban invalidarse.

Cache de V182: `cuban-league-v182-f05-brand-2`. La web registra el worker y
carga `app.js` con `182-20261018-f05` y `brand-f05.css` con `182-20261018-f05-2`; `stats-compact.css` conserva `181-20261018-compact-stats`. Los datos y el catálogo conservan
`174-20261014-mister-j8-catalog`; panel y extensión (1.0.2) no cambian.
Los dos manifests mantienen identidad, URL de inicio, scope y accesos; solo cambian
los iconos y colores de marca. Icono maskable específico con margen seguro del 20%.
Los iconos antiguos se conservan para compatibilidad y reversión, pero ninguna
referencia activa los usa. Los sistemas operativos pueden tardar en renovar el
icono de una PWA ya instalada; no borrar almacenamiento ni datos para forzarlo.
El fallback de un script usa su propio archivo precargado, nunca `index.html`.
Las respuestas 5xx/408 pueden recuperar la copia local del recurso.

## Carga pública y sincronización — V179

- El HTML inicial y la portada muestran carga neutra hasta confirmar las jornadas.
- El podio anterior solo se muestra si una consulta correcta confirma cero jornadas.
- Un fallo inicial muestra error/reintento; un fallo posterior conserva el último
  resultado recibido e indica que no pudo actualizarse.
- Catálogo en paralelo: solo las consultas de alineaciones/estadísticas detalladas
  esperan sus fotos/metadatos. Portada y navegación no dependen de esa descarga.
- Temporizador, reconexión y regreso a pestaña comparten una única sincronización.
  Datos base, jornadas e insignias tienen un límite de petición de 15 segundos.
- La portada se actualiza antes de esperar insignias. Sin cambios confirmados no
  se reconstruyen tablas, tarjetas, perfiles ni el podio.
- Una consulta fallida de milestones conserva la última respuesta válida; una
  respuesta correcta vacía sí puede retirar milestones. No se escriben datos.
- La firma de cambios incluye `misterRank` para detectar correcciones de Copa.
- El refresco del modal de alineación tiene su propio bloqueo y no retiene el de
  las jornadas si su consulta tarda.
- Alcance, evidencia y reversión: `docs/REVIEW_V179.md`.

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

- **V182:** marca F05 y paleta bosque/crema en web pública y panel, manteniendo
  estructura oscura. Logo nuevo también en tarjetas para compartir, favicon,
  instalación y manifests PWA. CSS aislado de pintura; se conservan colores
  semánticos de rojas/descenso, alertas y medallas. No se modifican cálculos,
  administración JS, importación, configuración, datos ni los 627 recursos
  originales. Contrato V174 intacto, salvo normalización estricta de las rutas
  de iconos y los dos colores permitidos en los manifests. Detalles y reversión:
  `docs/REVIEW_F05_V182.md`.

- **V181:** presentación compacta de Capitanes/MVP aprobada mediante imagen.
  Cambio de distribución y CSS aislado; 95 pruebas aprobadas y comprobación
  de valores/fotos antes y después. Ninguna función de cálculo modificada.

- **V180:** tabla de bonos acumulados y vista de peores capitanes. Reutiliza los
  datos y estilos existentes; pruebas de navegación, empates, negativos,
  redondeo, correcciones, datos incompletos e inmutabilidad. Se conservan
  intactas las funciones protegidas de cálculo y todos los datos V174.

- **V179:** revisión de carga/sincronización y PWA; sin cambios en los datos,
  cálculos deportivos, panel, importación, SQL, credenciales ni conexiones.
  Pruebas de comportamiento sustituyen únicamente las seis comprobaciones de
  hash de funciones de I/O modificadas; la referencia V174 se conserva intacta.

- **V176:** se recupera el diseño anterior de portada, tablas, perfiles y panel.
  Se conserva únicamente la barra clara de cinco accesos y el menú Más de las
  capturas aprobadas. CSS aislado de 4 KB, sin nuevas dependencias. En PC se
  mantiene la navegación anterior; en móvil la barra sustituye a la superior
  solo si el navegador soporta el diálogo. Caché V176, sin restaurar datos.

- **V175 (publicada y luego sustituida por petición del usuario):** tema marfil/verde bosque para web y admin, navegación
  móvil de cinco accesos + menú nativo, fuentes de sistema, carga diferida de
  fotos y menor precarga de fondos. No cambia datos, reglas, importación ni
  publicaciones. Respaldo remoto `backup/pre-editorial-redesign-v174-20261015`
  en `24bc164f6d860b4bb4d1e441807da9530b0a0583`. Detalles de regeneración,
  pruebas y reversión sin restaurar datos: `design/REDESIGN_AND_ROLLBACK.md`.
  73 tests locales aprobados; QA visual real pendiente por herramienta no disponible.

- **V174:** añadidos A. Mayol (Valencia, ID Mister `5340038`, MC) y X. Olaiz
  (Alavés, ID `5235247`, DF), los dos ausentes del error de importación de J8
  aportado por el administrador el 14 de octubre. Catálogo: 572 activos.
  Sus IDs y clubes se verificaron en la captura; las posiciones del catálogo
  se contrastaron con fuentes oficiales y el importador mantiene la posición
  de Mister en cada snapshot. Recargar el panel y recuperar la captura permite
  reintentar; las validaciones de identidad y el guardado solo en borrador siguen.
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

**2026-10-19 UTC / 2026-10-18 Miami** — V184: presentación de estadísticas
sin decimales; auditoría de jornadas publicadas y conservación exacta de cálculos,
rankings, perfiles y tablas. Sin operaciones de escritura en Supabase.

**2026-10-18 UTC / 2026-10-17 Miami** — V182: logo F05 elegido por Ernesto,
adaptación de paleta y recursos PWA. Basado en V181, con respaldo remoto previo.
Sin nuevas dependencias de ejecución ni operaciones sobre Supabase.

**2026-10-18 UTC / 2026-10-17 Miami** — V181: tarjetas compactas de mejores y
peores capitanes y MVP, sobre V180 ya publicado. Conserva datos, cálculos,
conexiones y el CSS anterior; nueva hoja de estilos específica y caché V181.

**2026-10-18 UTC / 2026-10-17 Miami** — V180: dos opciones nuevas dentro de
Estadísticas → Capitanes, preparadas en rama separada desde V179 para PR.
No se ha escrito en Supabase; no se han restaurado datos ni modificado estilos.

**2026-10-16** — V179: corrección del podio histórico al arrancar y optimizaciones
verificadas de las consultas públicas. Rama separada desde V178; sin migraciones
ni operaciones de escritura sobre Supabase.

**2026-10-15 UTC / 2026-10-14 Miami** — V176: restauración selectiva de la
presentación V174 con la barra inferior y el menú Más conservados. Se parte
del main vigente; no se restauran datos, fotos, catálogo ni Supabase.
V175 se había publicado en PR #45 y Ernesto pidió volver al diseño anterior.

**2026-10-14** — V174: catálogo de J8, invalidación de caché y comprobación del
flujo de borrador con los 20 participantes y los dos nuevos jugadores. Cambio
exclusivamente en el repositorio; no requiere migración ni modifica Supabase.

**2026-09-23** — Bootstrap inicial de `PROJECT_STATE.md`, verificado contra `main`, README V173, código principal, Supabase vivo, Edge Functions, migraciones registradas, Security Advisor y sistema de backups.
