# Probabilidad de candidatos fuera del once

Los jugadores que alguna fuente propone de titular o alternativa pueden mostrar
su propia estimación, aunque no estén entre los once elegidos. Se ve junto a la
alternativa en el campo, en «Resto de la plantilla» y en la explicación al tocar.
Las fichas siguen cerradas inicialmente. No se ordena ni cambia el once por esta
ampliación y el historial sigue comparando exclusivamente sus once titulares.

## Contrato del productor

En cada lectura nueva válida de alineaciones, forma la unión de los IDs que
cualquiera de las tres fuentes base observa como `starter` o `alternative`, más
los seleccionados por al menos un once completo válido de Predicted11. Excluye
los once elegidos, las bajas confirmadas y las identidades sin resolver. Incluye
las alternativas elegidas para los titulares con porcentaje inferior a 70.

Añade `proposal.candidates` al payload privado editorial-v4. Cada entrada contiene
exclusivamente `id`, `name`, `probability`, `reason` y `assessment`; no lleva `slot`,
posición táctica ni otra alternativa. Son como máximo 39 candidatos, manteniendo
el límite total de 64 KiB. Si no hay candidatos, envía un array vacío.

Cada candidato requiere observaciones propias en las cuatro fuentes y el mismo
assessment completo de los titulares: método, disponibilidad, rotación,
horizonte, contexto y referencias realmente consultadas. Recalcula cada uno con
`forecast_publish.assess`. Todos los votos y denominadores deben coincidir con
los onces completos de los autores y con `player_observations`.

- Conserva editorial-v4: FF 30%, JP 20%, Comuniate 20%, P11 30%. Sin onces completos
  de P11 se renormalizan las tres fuentes base, sin sustituir la ausencia por cero.
- Disponibilidad y horizonte tienen ajuste cero. No reintroduzcas sus descuentos
  por contexto o rotación. Conserva las marcas y explicaciones físicas.
- El porcentaje es de titularidad, no de tener minutos. Nunca uses
  `100 - porcentaje_del_titular` ni obligues a sumar 100 entre candidatos.
- No inventes observaciones o porcentajes. Documenta en `limitations` cualquier
  candidato sin evaluación verificable. Si falta la evaluación de una alternativa
  obligatoria, el lote no está completo y se aplican las reglas de bloqueo vigentes.
- Los candidatos sin puesto no requieren alternativas recursivas aunque su
  probabilidad sea inferior a 70. El once conserva exactamente 11 jugadores.

Esta extensión no autoriza reabrir turnos, rejuvenecer fechas, releer un `saved`,
retocar publicaciones anteriores ni usar escrituras directas. Se mantienen
`save_draft`/`deliver`, los modos, las retiradas, las ventanas y la deduplicación.
Noticias, salud, catálogo y el historial no cambian. Los payloads anteriores sin
`candidates` conservan exactamente su proyección y no reciben porcentajes inferidos.

## Validación y proyección

`candidates.sql` reemplaza únicamente `forecast_season.build_team(jsonb,interval)`.
Exige el checksum de la función inspeccionada antes de aplicar el cambio. Conserva
su firma, estabilidad, invocación, search_path y permisos. No escribe filas ni
añade tablas, políticas, servicios o endpoints. El cálculo existente no cambia.

El servidor valida identidad del mismo club, nombre canónico, unicidad fuera del
once, señal positiva de fuente, score recalculado, método, antelación real,
observaciones, votos y referencias. La lista pública contiene solo
`id`, `name`, `probability`, `reason`, `method`; las evaluaciones y onces ajenos
permanecen privados. El navegador valida la proyección y la muestra sin recalcular.

## Aplicación y reversión

1. Ejecutar las pruebas PostgreSQL locales y de interfaz; revisar el diff.
2. Aplicar la función con `apply_migration` exclusivamente al proyecto existente
   `pyahosamoisqcbpvzwka`, conexión `link_6aad67ea13208191b8315f9bb7f2cce7`.
3. Verificar definición, permisos y que las publicaciones existentes no cambien.
4. Integrar el frontend por PR y verificar GitHub Pages y las versiones de caché.
5. Incorporar el contrato anterior al prompt de la automatización existente,
   preservando horario, estado, entorno y todos sus flujos independientes.

La próxima lectura autorizada puede producir candidatos. Este despliegue no
publica datos de ejemplo ni reconstruye estimaciones a partir de consultas viejas.

Para revertir, retirar esta extensión del productor, revertir el frontend y
aplicar `candidates-rollback.sql` tras revisar su checksum. Restaura solo la función
anterior; no borra publicaciones, borradores, candidatos guardados o historial.
No ejecutar el rollback si otra modificación posterior ha cambiado la función.

## Verificación local

Pruebas PostgreSQL reales con PGlite: compatibilidad exacta sin el nuevo campo,
renormalización sin P11, votos de autores completos, identidad, fuentes y motivos,
duplicados, bajas confirmadas, números inconsistentes, referencias ajenas,
alternativas incompletas y reversión protegida. Son fixtures sintéticos locales.

Pruebas de interfaz: porcentaje independiente compartido entre campo, plantilla y
detalle; ausencia de selección inicial; compatibilidad sin candidatos y vista
previa privada. Revisión visual a 320 y 390 píxeles.

La suite usa la dependencia de pruebas existente PGlite cuando está disponible:
`node --test tests/forecast-candidates*.test.cjs`. No añade dependencias de producción.
