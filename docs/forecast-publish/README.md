# Publicación editorial del piloto Madrid–Celta

Este cambio permite preparar una revisión privada y publicarla después de ver su
vista previa. La página pública incorpora **Más → Alineaciones probables** con
campo 4-2-3-1, fotos del catálogo, explicación por jugador y alternativa bajo 70.
Solo admite Real Madrid–Celta, LaLiga 2026/27 J13, 21/11/2026 20:00Z.

## Flujo

1. En Administración → Herramientas → Alineaciones probables, abrir una lectura
   con `method_version=editorial-v1` y pulsar **Editar y preparar publicación**.
2. Revisar jugadores, puestos, porcentajes enteros, alternativas y motivos.
   La nota y los motivos son públicos. Las fuentes y sus fechas permanecen
   vinculadas a la lectura guardada; el navegador no puede renovarlas.
3. **Guardar revisión privada** crea una fila nueva. No modifica los borradores
   originales ni cambia la versión publicada. Cargar esa revisión abre la misma
   presentación que utilizará la página pública.
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
`pyahosamoisqcbpvzwka` de Cuban League. **No se ha aplicado permanentemente**.
No necesita proyectos, ramas Supabase, Edge Functions, planes ni infraestructura.

Orden al integrar: aplicar esta migración una vez, comprobar permisos y ausencia
de publicación inicial, fusionar el PR y verificar los assets de GitHub Pages.
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
