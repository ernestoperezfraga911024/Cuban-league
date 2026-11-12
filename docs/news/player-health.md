# Noticias del club y situación del jugador

La pestaña de alineaciones consulta exclusivamente `public.news_public`, filtra por club e identidad del catálogo y muestra las mismas noticias publicadas que Noticias. No copia artículos a otra tabla ni expone borradores. Cambiar de club no añade consultas. Una retirada desaparece en la siguiente lectura de la vista; no se conserva una copia de noticias en el navegador. Un fallo de noticias deja disponible el once y muestra un aviso breve en el bloque de noticias.

El once conserva sus once jugadores y porcentajes. Debajo aparece **Resto de la plantilla**, agrupado por posición del catálogo y excluyendo a los once propuestos. No representa una convocatoria ni el banquillo oficial. Las fotos proceden del catálogo existente; no se importan jugadores ni imágenes nuevas.

## Estado explícito por jugador

Una noticia puede incluir `health` dentro de cada entrada de `players`. La función instalada `league_news.save_draft` conserva el objeto de jugador completo, por lo que esta ampliación opcional no requiere migraciones. La lectura pública comprueba estado, fecha, detalle y referencias antes de mostrar una marca.

```json
{
  "id": "ID_REAL_DEL_ROSTER",
  "name": "NOMBRE_CANONICO",
  "health": {
    "status": "doubt",
    "event_date": "YYYY-MM-DD",
    "detail": "Hecho breve y atribuido, con plazo estimado si consta.",
    "refs": ["URL_PRESENTE_EN_SOURCES"]
  }
}
```

| Estado | Marca | Cuándo usarlo |
| --- | --- | --- |
| `doubt` | Interrogación ámbar | La lectura describe una duda física actual: molestias, prueba pendiente o disponibilidad incierta. |
| `injured` | Cruz roja | La lectura acredita una lesión vigente o baja física; una lesión diagnosticada no se rebaja a simples molestias. |
| `available` | Sin marca | Una información posterior confirma el alta o que puede jugar. Entrenar parcialmente, trabajar solo o entrar en una convocatoria por sí solos no bastan. |

`detail` tiene entre 10 y 500 caracteres, sin fórmulas genéricas. `event_date` es la fecha **del hecho**, no la fecha de consulta, importación o republicación. Se conservan diagnóstico, evolución y plazos atribuidos cuando existan. Las referencias deben estar en las fuentes realmente leídas de esa misma noticia. No se admite estado físico procedente de rumores de fichajes.

La observación con fecha de hecho más reciente gobierna la marca. Para dos cambios del mismo día se usa el orden de sus actualizaciones factuales guardadas; el editor debe comprobar la secuencia en las fuentes y evitar publicar una versión anterior como actualización posterior. Un artículo antiguo importado hoy no desplaza un alta de fecha posterior. Una recuperación parcial sin alta mantiene el estado anterior. La ausencia de noticias no significa que esté sano.

Una noticia sobre varios jugadores etiqueta únicamente a quien corresponda: el posible sustituto de un lesionado no hereda su lesión. Si hay versiones incompatibles sin orden comprobable, registrar `doubt` y explicar la discrepancia; no dar un alta por inferencia. Los estados no modifican probabilidades, convocatorias, catálogo, alineaciones publicadas ni comparaciones históricas.

## Incorporación al flujo existente de Noticias

El anexo en `player-health-automation.txt` se añade a las instrucciones de la tarea existente. Mantiene horarios, fuentes, funciones permitidas, turnos, deduplicación, modo Manual/Automático y retiradas. No crea una tarea nueva ni reabre la carga inicial o un turno finalizado.

Los artículos anteriores sin `health` siguen visibles en club y jugador, pero no producen marcas por deducción de titulares. El próximo turno válido puede registrar estados al leer novedades verificadas de cada jugador; no se renuevan noticias ni sus fechas solo para rellenar iconos. Esto limita la cobertura inicial de marcas a los estados expresamente comprobados y publicados. Un alta posterior se guarda en el mismo evento cuando corresponda y elimina la marca al actualizar la vista.

## Verificación y reversión

- Pruebas de separación por jugador/club, lesión–alta–recaída, recuperación parcial, referencias y fechas inválidas, noticias retiradas, seguridad de enlaces/texto y consultas paginadas.
- Pruebas de once intacto, catálogo activo sin duplicados, detalle y retorno por teclado, carga local por club, errores independientes y respuestas tardías tras abandonar la sección.
- Administración e historial no reciben `playerContext`: conservan sus vistas y datos históricos. El renderer compartido solo añade plantilla y noticias cuando recibe ese contexto.
- Para revertir la presentación basta revertir este PR; el campo opcional `players[].health` es ignorado por las vistas anteriores. No hay cambios de tablas o configuración de base de datos que deshacer.
