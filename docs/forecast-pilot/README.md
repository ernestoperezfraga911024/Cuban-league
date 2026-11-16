# Piloto privado de alineaciones probables

Prueba acotada a Real Madrid–Celta, LaLiga 2026/27, jornada 13. Comprueba
lectura de tres fuentes, análisis editorial y guardado privado con las conexiones
existentes. No añade una sección pública ni modifica las jornadas de la liga.

## Estado y alcance

- Migración `private_forecast_pilot`, versión `20261111163650`, aplicada al
  proyecto Cuban League el 11 de noviembre de 2026.
- `schema-reference.sql` conserva el SQL aplicado. Es una referencia para
  revisión: **no debe ejecutarse de nuevo sobre el proyecto existente**.
- Borrador interactivo guardado y leído de vuelta: tres fuentes, once jugadores,
  publicación deshabilitada. El contenido deportivo permanece en la base privada.
- La tarea de ChatGPT de ejecución única terminó sin intervención. El registro
  de la tarea indica inicio a las 16:46:51 UTC y finalización a las 16:48:27 UTC
  del 11/11/2026, sin acción requerida. La base confirma un segundo borrador
  `scheduled`, guardado a las 16:48:14 UTC: tres fuentes consultadas de nuevo,
  once jugadores y publicación deshabilitada.
- Sin cambios en HTML, CSS, JavaScript, catálogo, políticas existentes o
  configuración de despliegue. No hay tarea diaria ni publicación automática.

## Coste y límites

La organización existente está en Supabase Free. No se han contratado servicios,
usado APIs comerciales o de modelos, cambiado planes ni creado proyectos.
La tarea utiliza las prestaciones y límites de la cuenta de ChatGPT existente;
esto no promete uso ilimitado ni gratuidad futura de servicios ajenos.

El único punto de escritura del piloto admite hasta 20 registros de un máximo
de 64 KiB de JSON cada uno. Al alcanzar el límite falla sin ampliar capacidad.
No se guardan imágenes ni páginas completas. No hay procesos nuevos que se
ejecuten al abrir la web, por lo que este piloto no añade peticiones a sus visitas.

## Recorrido

1. Leer las páginas del partido en FútbolFantasy y Jornada Perfecta y la ficha
   española del equipo en Comuniate. Verificar equipo, rival, jornada y fecha.
2. Registrar hechos breves, URL consultada y hora de lectura. Una hora de lectura
   reciente no demuestra que el editor haya actualizado su alineación: conservar
   `source_updated_at: null` si no se conoce.
3. Preparar un análisis propio. Los porcentajes iniciales son estimaciones
   editoriales **sin calibración histórica**, no una precisión demostrada ni la
   conversión de votos de medios a probabilidades.
4. Si falta una fuente o el partido no coincide, guardar `blocked`, con causa y
   `proposal: null`. No rellenar huecos como si la lectura hubiera funcionado.
5. Guardar mediante `forecast_pilot.save_draft` y consultar la fila resultante.
   Una tarea creada o un mensaje que dice «guardado» no bastan como verificación.

La ejecución programada debe volver a leer las fuentes. No puede reutilizar
el análisis interactivo para aparentar una consulta nueva.

## Contrato y privacidad

El esquema `forecast_pilot` está separado de `public`. La tabla tiene RLS activo,
sin políticas de aplicación. Es intencional: `anon`, `authenticated` y
`service_role` carecen de acceso al esquema, tabla y función. No se ha creado
un endpoint público. La conexión administrativa autorizada ejecuta una función
`SECURITY INVOKER`, sin elevar los permisos del llamante.

Campos fijos del JSON:

| Campo | Valor del piloto |
| --- | --- |
| `schema_version` | `1` |
| `team` / `opponent` | `real-madrid` / `celta` |
| `fixture_key` | `laliga-2026-27-j13-real-madrid-celta` |
| `matchday` | `13` |
| `kickoff_at` | `2026-11-21T20:00:00Z` |
| `probability_kind` | `editorial_uncalibrated` |
| `publication_allowed` | `false` |

`sources` requiere los tres identificadores distintos `futbolfantasy`,
`jornadaperfecta` y `comuniate`, con URL de su dominio, `fetched_at`, estado y
evidencia breve. Un estado `read` requiere once nombres distintos y
`fixture_verified: true`. Los demás estados son `unavailable`, `stale` y
`mismatch`; impiden guardar un pronóstico completo.

La propuesta de este piloto utiliza `4-2-3-1`: 1 GK, 4 DF, 5 MF y 1 FW. Son
roles del dibujo, no categorías del catálogo de Mister. Cada jugador necesita
identificador, nombre, motivo y porcentaje entero de 0 a 100. Por debajo de 70
se exige alternativa fuera del once; desde 70 se exige `alternative: null`.

`run_key` distingue ejecuciones. Repetir la misma clave y contenido no duplica;
cambiar el contenido de una clave existente se rechaza. Esto preserva el
historial a través de la función, pero no limita los privilegios del propietario
de la base de datos. `execution_kind` identifica `interactive` o `scheduled`;
es una etiqueta, por lo que la autonomía debe corroborarse también en el
registro de ejecución de la tarea.

El validador comprueba estructura y coherencia del piloto. No demuestra que un
hecho deportivo sea verdadero ni que el porcentaje esté bien calibrado.

## Verificación

`tests/forecast-pilot-db.sql` utiliza datos sintéticos y una transacción con
`ROLLBACK`. Debe ejecutarse con una conexión administrativa autorizada sobre
un entorno que tenga el esquema; no se ejecuta desde el navegador.

Comprueba el once, umbral 69/70, probabilidades inválidas, cobertura de fuentes,
partido verificado, antigüedad de lectura, bloqueo de publicación, idempotencia,
colisiones, resultados bloqueados y acceso denegado a los tres roles de la app.
También verifica el rechazo de JSON de más de 64 KiB y del registro número 21.

La lectura de comprobación del borrador se hace con:

```sql
select run_key, execution_kind, status, created_at, publication_allowed,
       jsonb_array_length(payload->'sources') as source_count,
       case when status = 'draft'
         then jsonb_array_length(payload->'proposal'->'players') else 0
       end as player_count
from forecast_pilot.drafts
order by created_at;
```

Las huellas del contenido de `matchday_stats`, `matchday_drafts`,
`matchday_change_log`, `matchday_milestones`, `second_division_lineups` y
`second_division_standings` coincidieron antes y después de ambos guardados.
No se ejecuta la suite de interfaz: el piloto no modifica código de la web.

El asesor de seguridad añade un aviso informativo de RLS sin políticas para
la tabla privada. La ausencia de políticas es deliberada para negar acceso;
los avisos previos del proyecto se evalúan por separado.

## Antes de ampliar

La primera ejecución autónoma está verificada. Quedan por evaluar la consistencia
de varias lecturas y la calidad del pronóstico frente a onces oficiales con cortes
temporales comparables. También habrá que revisar las condiciones de uso de
las fuentes antes de automatizar a escala o publicar contenido derivado.

Los dos borradores conservan el mismo once principal y muestran diferencias en
los porcentajes editoriales. No se interpreta esa variación como nueva evidencia
deportiva: antes de publicar se necesita un criterio reproducible y calibración.

Una prueba con un equipo no garantiza cobertura de veinte equipos ni todos los
días. Cualquier integración del panel, publicación y programación diaria queda
fuera de esta migración. Si cambia el partido de las fuentes, este piloto debe
bloquear el resultado en lugar de actualizar silenciosamente su alcance.
