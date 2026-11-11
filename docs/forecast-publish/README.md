# Publicación editorial del piloto Madrid–Celta

Este cambio permite preparar una revisión privada y publicarla después de ver su
vista previa. La página pública incorpora **Más → Alineaciones probables** con
campo 4-2-3-1, fotos del catálogo, explicación por jugador y alternativa bajo 70.
Solo admite Real Madrid–Celta, LaLiga 2026/27 J13, 21/11/2026 20:00Z.

## Flujo

1. En Administración → Herramientas → Alineaciones probables, abrir una lectura
   con `method_version=editorial-v1` y pulsar **Editar borrador seleccionado**.
2. Revisar jugadores, puestos, porcentajes enteros, alternativas y motivos.
   La nota y los motivos son públicos. Las fuentes y sus fechas permanecen
   vinculadas a la lectura guardada; el navegador no puede renovarlas.
3. **Guardar revisión privada** crea una fila nueva. No modifica los borradores
   originales ni cambia la versión publicada. Después se lee la revisión guardada
   desde el servidor y se abre automáticamente su vista previa, con la misma
   presentación que utilizará la página pública. El historial permite abrirla
   de nuevo si falla esa lectura, sin guardar otra copia.
4. Revisar, marcar la casilla de confirmación y pulsar **Publicar revisión**.
   Una segunda confirmación identifica el número exacto de revisión.
5. **Retirar** elimina únicamente la proyección pública. **Restaurar** publica una
   revisión anterior del mismo piloto que ya se hubiera publicado. Conserva sus
   fechas originales y exige la misma vigencia que una publicación nueva.

Un cambio en el formulario o en la selección de revisión invalida la confirmación.
Cambiar texto, jugador, puesto, alternativa o probabilidad se identifica como
`editorial-manual-v1`; no se atribuye el resultado al método automático. La base
de datos vuelve a calcular la evaluación del borrador original y comprueba su
antelación real. El método sigue siendo editorial, provisional y no calibrado.
No se afirma precisión demostrada ni se convierte una duda física en baja.

## Separación y permisos

- `forecast_pilot` y su límite de 20 lecturas permanecen intactos.
- `forecast_publish` guarda un catálogo de identidades de Madrid (27), revisiones
  inmutables desde las RPC, estado y eventos privados. Límite 100 revisiones y
  500 comandos, sin ampliación automática. No modifica el catálogo existente.
- `public.forecast_public` contiene solo una proyección seleccionada: once propio,
  nota, enlaces y fechas. No incluye onces ajenos, evaluaciones completas, autor,
  solicitudes, claves de lectura ni historial privado.
- RLS y permisos explícitos: visitantes y usuarios autenticados solo pueden leer
  la proyección pública. No tienen permisos directos sobre las tablas privadas ni
  permisos de escritura sobre la pública.
- Las RPC públicas son SECURITY INVOKER. Sus auxiliares en `private` son SECURITY
  DEFINER, con `search_path=''`, `auth.uid()` y `private.is_league_admin()`.
  No usan metadatos editables del JWT. Las funciones puras de validación no están
  concedidas a roles del navegador. No hay claves secretas nuevas.
- Cada comando bloquea la fila de estado, exige la versión esperada y guarda un
  UUID de solicitud con sus argumentos y resultado. Reintentar la misma solicitud
  devuelve su resultado; reutilizar el UUID con otros argumentos se rechaza.
  Un resultado de red incierto bloquea la edición y conserva el mismo comando
  para el reintento. Cerrar sesión elimina los datos y descarta respuestas tardías.

## Vigencia, fotos y funcionamiento público

Publicar/restaurar requiere las tres consultas dentro de las últimas 24 horas,
ninguna más de cinco minutos en el futuro y partido aún no iniciado. Guardar una
revisión no rejuvenece la evidencia. Una lectura bloqueada no puede publicarse.
Pasadas 24 horas la vista avisa de datos antiguos; tras el inicio se identifica
como archivo de una previsión, nunca como once oficial. No hay borrado programado.

Se consulta la publicación al entrar en la sección, al pulsar Actualizar y al
volver a una pestaña visible. No hay sondeo, tareas, API de modelos ni servicios
nuevos. Una retirada se refleja en la siguiente consulta; una pestaña ya abierta
no recibe actualizaciones en tiempo real. La respuesta pública no se guarda en
localStorage ni en el service worker. Ante error de conexión se retira la vista
previa local para no atribuirle vigencia sin comprobarla.

Las imágenes se resuelven por ID contra `player-catalog.js`, con rutas locales o
el CDN ya permitido por el catálogo. Se ignoran URLs de imagen del payload. Son
imágenes decorativas en botones etiquetados, con dimensiones, carga diferida e
iniciales de reserva. No se descarga ni incorpora ninguna fotografía nueva.
El catálogo conserva exactamente su hash de main. Se añade aproximadamente
7.7 kB gzip de JS/CSS público (medición local, no transferencia real del servidor).

## Despliegue revisable y reversión

`migration.sql` es el SQL revisable para `apply_migration` en el proyecto existente
`pyahosamoisqcbpvzwka` de Cuban League. **Aplicada con autorización del usuario el
11/11/2026**, como `forecast_pilot_publication`, versión `20261111181315`.
No necesita proyectos, ramas Supabase, Edge Functions, planes ni infraestructura.

La migración ya se aplicó una vez y se comprobaron permisos y ausencia de
publicación inicial. El frontend se integra mediante el PR #77 y debe verificarse
en GitHub Pages. No se debe volver a aplicar el mismo SQL de creación.
La migración no publica ningún borrador. Un administrador debe abrir, guardar,
previsualizar y confirmar una publicación. Hasta disponer de la migración el
editor muestra un aviso y el visor privado anterior sigue funcionando.

Para retirar contenido usar el comando del administrador. Para desactivar la
funcionalidad completa se puede revertir el commit de interfaz conservando el
historial en la base. Retirar primero la proyección pública: revertir HTML/JS por
sí solo no revoca el acceso de lectura de una publicación ya existente. No se
incluye una eliminación destructiva de historial como reversión automática.

## Verificación del 11/11/2026

- Suite completa: **198/199**. Único fallo: contrato histórico de
  `catalog/players.json`, ya documentado antes de este PR. No se ha cambiado el
  catálogo ni relajado esa comprobación. Esperado antiguo:
  `5c5a08bbef9cd69ac118736904d160a630cc5d5d41bcf8180e6b5b61b217be4b`;
  hash de main y de esta rama:
  `b32ea7462eef71107c6a7c4d943a636fb95b11d2a41279bf1fc857f8c52ae0ec`.
- Pruebas nuevas: estructura, fuentes, XSS, fotos/iniciales, carga diferida,
  retirada/error, permisos de interfaz, guardado sin publicar, reintento con el
  mismo UUID, vista previa y confirmación, invalidación de cambios y logout.
- Chrome local: navegación real desde Más, 11 fotos cargadas; anchos 320, 390 y
  1280 sin desbordamiento, detalle accesible, retirada, guardado privado, vista
  previa y publicación explícita con respuestas **sintéticas**. No es una prueba
  de sesión real de administrador contra producción.
- SQL: `BEGIN` + migración + `tests/forecast-publish-db.sql` + `ROLLBACK` pasó en
  el proyecto existente tras la confirmación del usuario. Verifica identidad,
  permisos, reintento, conflicto de versión, validación, proyección, publicación,
  retirada, restauración y caducidad. No prueba dos conexiones simultáneas;
  comprueba el rechazo de una versión obsoleta y el bloqueo está en el comando.
- Comprobación posterior 18:03:10Z: `forecast_publish` y `public.forecast_public`
  ausentes, confirmando que el ensayo no dejó la migración instalada. Los dos
  borradores antiguos conservaron sus hashes.
- Nueva lectura real guardada en privado a las **17:39:55Z**, clave
  `pilot-interactive-20261111-madrid-celta-editorial-v1`: tres fuentes, once
  jugadores, `publication_allowed=false`. No se incluye su payload en GitHub.

Reproducir UI: `node --test tests/forecast-publish.test.cjs` y
`node scripts/check-forecast-publish-browser.cjs` (Playwright y Chrome disponibles;
opcional `CHROME_PATH`). La prueba SQL requiere un administrador existente y una
lectura privada con evaluación. Ejecutarla siempre junto con el ROLLBACK.

Las tres páginas se leyeron en esta ejecución. Se verificaron equipo, rival,
jornada y fecha; en Comuniate se corroboró el año en el enlace de su partido.
La lectura conserva discrepancias en el lateral izquierdo y mediocentro, dudas
físicas, antelación superior a diez días y fecha de actualización desconocida.
Los porcentajes bajos del método v1 requieren revisión editorial; no demuestran
que un futbolista vaya a ser suplente. No se activan actualizaciones diarias.

## Aplicación autorizada y comprobaciones posteriores

El 11/11/2026 a las 18:13Z se instaló el SQL revisado sin cambios respecto del
ensayo. La comprobación posterior confirmó RLS en las cinco tablas nuevas,
27 identidades de catálogo y cero revisiones, eventos o publicaciones iniciales.
Los tres borradores privados conservaron sus hashes. Las referencias anteriores
a objetos ausentes describen la prueba con ROLLBACK, previa a esta instalación.

El ensayo de permisos sobre las funciones instaladas permitió la lectura de un
administrador y rechazó identidad ausente, no administrador y acceso anónimo a
funciones privadas. La API real devolvió HTTP 200 con `[]` para la publicación,
y HTTP 401 / código 42501 para lectura y comando privados sin autenticación.
No se ejecutó ningún comando de publicación permanente.

El asesor de seguridad mantuvo los mismos avisos WARN previos (2 para funciones
anónimas, 23 para funciones autenticadas y 1 de protección de contraseñas). Añadió
cuatro INFO por RLS sin políticas en las tablas privadas de `forecast_publish`:
es intencional, ya que no se concede acceso directo y las RPC verifican al
administrador. Véase la
[explicación del asesor de RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
No se añadieron políticas que permitan leer el historial privado.

`tests/forecast-publish-db.sql` es el ensayo previo a instalar el esquema. No se
debe volver a concatenar la migración de creación en una base donde ya existe.
Las comprobaciones posteriores de instalación fueron de lectura y autorización,
sin crear revisiones ni publicar datos.

## Corrección de los controles del editor

Se reprodujo un problema de entrada al editor: «Edición y publicaciones» abría
un formulario sin la lectura seleccionada, dejando Guardar desactivado cuando
todavía no existían revisiones. La prueba de navegador anterior abría el editor
directamente con un borrador y no cubría ese botón real.

El botón visible ahora recibe la lectura seleccionada del visor y se bloquea
durante un cambio de selección para impedir reutilizar una lectura anterior.
El guardado abre la vista previa de la revisión devuelta por el servidor; todavía
exige casilla y confirmación explícita para publicar. Los botones explican el
paso que falta. Si el guardado tiene éxito pero falla una lectura posterior,
se conserva su identificador para volver a abrirlo sin duplicarlo. Una pérdida
de permisos durante ese paso limpia los datos privados.

No se modifica SQL, permisos, reglas de vigencia ni contenido de los borradores.
La regresión del botón falló antes del cambio (cero campos en lugar de once) y
pasó después. El ensayo de navegador usa ahora el botón visible y comprueba
el guardado, la vista previa automática y la confirmación de publicación con
respuestas sintéticas. No se publica nada en producción durante estas pruebas.

Validación de esta corrección: 23/23 pruebas específicas y 203/204 generales.
El único fallo general sigue siendo el contrato histórico del catálogo descrito
arriba, sin cambios en su archivo ni en esa comprobación. El flujo del navegador
se completó desde el botón visible con once campos y guardado habilitado.
