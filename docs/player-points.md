# Puntos vinculados a futbolistas

`player-points.js` construye una vista de solo lectura de los XI publicados de
`matchday_stats`, filtrada por temporada y participantes activos. No modifica
alineaciones, resultados, catálogo, propietarios ni importaciones de Mister.

- Identidad: `lineup.player_id` → ID del catálogo → `misterId` verificado. Nunca se
  enlazan nombres aproximados. Los registros sin ID de Mister permanecen bajo su
  ID local; no se atribuyen a otro jugador del mercado.
- El acumulado sigue al futbolista cuando cambia de participante. Cada aparición
  conserva jornada, participante histórico, puntos aportados y bonus de capitán.
- «Puntos en liga» suma la puntuación normal en las jornadas registradas. El extra
  del capitán se calcula con la función ya utilizada por Liga sin bonus y se
  muestra separado. No representa las jornadas en que nadie alineó al jugador.
- Una puntuación individual se cuenta una vez por futbolista/jornada. Si figura
  en dos participantes se mantienen ambas aportaciones; si las puntuaciones
  normales discrepan, el acumulado queda pendiente de verificar.
- Las correcciones sustituyen los registros anteriores y despublicar elimina
  esa jornada de la vista. Los empates contradictorios de versión, XI inválidos,
  bonus desconocidos y ausencia de registros nunca se convierten en ceros.
- Las penalizaciones por posiciones vacías y los ajustes oficiales de equipo
  no se asignan a futbolistas. Las jornadas con saldo negativo no les suman puntos.
- Se conserva la precisión almacenada. Los números visibles se redondean como
  el resto de las estadísticas; no se corrige el histórico desde esta vista.

## Actualización y carga

La vista se solicita al abrir Mercado, Equipo actual o estadísticas. Los tres
consumidores comparten una petición de las alineaciones publicadas y un índice
en memoria. La portada no descarga XI por esta función.

El sondeo público existente (cada 60 segundos con la página visible, al volver
a la pestaña o recuperar conexión) detecta cambios mediante `updated_at`,
incluyendo correcciones que dejan igual el total del participante. Invalida la
vista y actualiza las cifras abiertas sin esperar a la captura del mercado.
Actualizar Mercado también fuerza la lectura de puntos. Una respuesta antigua
en vuelo no puede reemplazar una revisión más nueva.

## Comprobación inicial, 17 de noviembre de 2026

Lectura de producción sin escrituras: 240 registros publicados, J1–J12, 239 XI
completos y una jornada con saldo negativo. Hay 420 futbolistas con apariciones:
414 enlazan al mercado por ID verificado; seis registros antiguos sin ID de
Mister no aparecen en la captura actual y se conservan por su ID local:
`k-tunde`, `c-perez`, `u-konare`, `g-puerta`, `k-arriaga`, `c-alvarez`.
No se encontraron filas inválidas, versiones ambiguas ni puntos base pendientes.

Pruebas en `tests/player-points.test.cjs`: identidades, cambios de dueño,
capitanes, negativos/cero, correcciones, despublicación, conflictos, solicitudes
compartidas, respuestas fuera de orden y actualización de las dos vistas.
