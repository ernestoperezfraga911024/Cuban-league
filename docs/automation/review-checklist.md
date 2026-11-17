# Revisión íntegra de evidencia por club

**Nueva regla del17/11/2026:** ante un jugador ausente, investigar identidad y
club, comprobar duplicados y añadir la ficha verificada al catálogo y roster.
Está autorizado persistir esa alta y sus alias; la falta de catálogo por sí sola
no bloquea. Tras el alta devolver `catalog_updated:true` e identidades explícitas
para releer el roster sin alterar evidencia ni fechas. Ver la regla de alta
verificada en docs/automation/README.md. Prevalece sobre los límites anteriores
de catálogo de este contrato.

**Prioridad vigente de Ernesto (17/11/2026):** después de calcular, ocupa cada
puesto la opción compatible con mayor porcentaje final. No conservar el titular
inicial si su alternativa lo supera. Revisar todas las opciones del puesto,
conservar once únicos y coordenadas; empates mantienen la selección revisada.
El productor promueve y SQL rechaza inversiones. Salud no interviene.
Ver [../forecast-publish/selection-priority.md](../forecast-publish/selection-priority.md).

Este índice de lectura reduce búsquedas repetidas sin sustituir la revisión
editorial, el compilador, la validación SQL ni la comparación pública exacta.
No hace red, no escribe datos, no propone un once y no certifica el calendario.

Regla vigente de Ernesto del 16/11/2026: las alineaciones son un cálculo de
FF/JP/Comuniate/P11. El estado físico solo añade un símbolo separado procedente
del estado directo de FutbolFantasy; nunca elimina una observación, cambia un
porcentaje o decide titular, suplente, posición o alternativa. Cualquier texto
médico directo FF que el índice muestre solo ayuda al flujo separado del icono.
El índice no extrae noticias médicas JP ni estados de Comuniate, ni genera
conflictos clínicos entre fuentes para resolver el once.

```sh
node scripts/forecast/inspect-review.cjs RUTA_REVIEW.json [RUTA_RESPUESTA_REVIEW.json]
```

La segunda ruta es opcional. Acepta una revisión o el sobre `{"result":...}` del
puente. Las identidades proporcionadas allí permiten agrupar nombres entre
fuentes; nunca se aplican equivalencias por similitud. El índice comprueba SHA256
del cuerpo local antes de interpretarlo. Un archivo cambiado o ausente aparece
como error y no genera evidencia. No reutilizar un índice anterior como lectura
nueva, ni cambiar hashes o fechas para aceptar un cuerpo.

## Qué se revisa antes del primer envío

1. **Encuentro y estado probable/oficial.** `planned_fixture` es el plan de la
   base, no confirmación de las páginas. Contrastar `fixture_text`, título, fecha,
   jornada y equipos en los cuerpos de las tres fuentes. `fixture_verified:false`
   del índice es intencional: la decisión debe documentarla el revisor.
2. **Identidades completas.** Resolver todos los nombres de titulares, papeletas
   completas, alternativas capturadas y alternativas añadidas. Acentos y
   abreviaturas no se completan automáticamente. `identity_reference` y los
   perfiles del mismo club son ayuda, no una nueva lectura ni un mapeo aprobado.
3. **Titular y alternativa pueden coexistir.** Regla de Ernesto del 17/11:
   un regular puede ser alternativa de otro jugador/dibujo, incluso estando en
   nuestro once. Conservar todas las entradas capturadas en la revisión. El
   productor usa una sola señal por jugador/fuente, priorizando su aparición
   titular y su porcentaje original; no sumar ni promediar apariciones. Si el
   jugador es alternativa de sí mismo, ignorar únicamente esa relación y
   conservar el titular. El índice la marca `ignored_self_alternative` tras
   resolver IDs. Conservar cuerpos, parejas y revisión para auditoría, incluidos
   ceros y null. Las alternativas de Comuniate siguen completas en la revisión;
   no eliminarlas manualmente. Dos identidades titular duplicadas, alternativas
   sin identidad o porcentajes inválidos siguen requiriendo corrección.
4. **Cálculo independiente de salud.** Usar editorial-v6 con las observaciones
   reales de las cuatro fuentes. No exigir `availability_reviewed`, no preparar
   `confirmed_out` para filtrar jugadores ni introducir ajustes de salud en
   `facts`, rotación o contexto. Si FF muestra un porcentaje junto a un icono,
   conservar ese porcentaje; no corregir a la fuente con un parte médico. El
   símbolo se actualiza por el flujo FF directo separado, sin noticias de otras
   fuentes. No seguir enlaces clínicos para decidir la alineación.
5. **Puestos y alternativas.** `alternative_pairs` conserva parejas que realmente
   comparten celda o puesto y las coordenadas observadas. Los porcentajes son los
   publicados; `null` no significa cero ni `100 - titular`. FF busca porcentajes
   en las tarjetas del mismo equipo, también en su banquillo; si hay varios
   distintos los enumera y deja `probability:null` con alerta de ambigüedad.
   `alternative_checks` requiere revisión táctica cuando no encuentra pareja
   directa. Es una pista, no prueba de incompatibilidad. El catálogo aporta solo
   posición amplia; una pareja MC/DL puede ser correcta cuando el cuerpo la
   respalda. Elegir once y alternativas por el cálculo y el puesto observado,
   nunca por salud. Un titular puede cubrir otro puesto con evidencia, pero nunca
   ser alternativa de sí mismo. No reutilizar un suplente para todas las posiciones automáticamente.
6. **Geometría.** Elegir por fila la fuente cuyo dibujo corresponde a la formación
   revisada. Un valor horizontal repetido puede proceder de dos líneas tácticas
   diferentes. No desplazarlo arbitrariamente ni invertir filas: revisar otra
   fuente o una sustitución táctica explícita, conforme al contrato.

`review-preflight.cjs` reúne todos los nombres sin resolver, duplicados de cada
fuente, porcentajes inválidos y errores de todas las filas antes de consumir la
única corrección. El productor enumera también todas las alternativas obligatorias
faltantes. La corrección recibe `issues` completos y usa los mismos cuerpos,
fechas y roster. No aumenta el número de intentos ni relaja el compilador/SQL.

## Evidencia del fallo del 16/11/2026, turno 14:00 Miami

La ejecución original publicó y verificó 9/20; once quedaron pendientes. El
checkpoint preservado fue `season-20261116-1400`, `forecast-season-XU41ml`.

- **Athletic:** revisión creada 19:10:47.510 UTC, respuesta de archivo a
  19:15:48.372 UTC: 300,862 segundos frente al límite de 300. El timeout no fue una
  baja, ausencia de fuente ni publicación.
- **Celta:** el cuerpo FF mostraba Carreira y Durán como titulares y también
  alternativas. La primera corrección quitó solo Carreira; Durán quedó duplicado.
- **Barcelona:** la revisión omitió “Eric García” y “Joan García”, aunque ambos
  estaban en `identity_names`. La corrección agregó solo Eric y falló con Joan.
- **Getafe:** se resolvió “Ünal” en la corrección, pero no la geometría. La selección
  5-3-2 mezcló en JP A. García y Carvajal con el mismo x=87,5 en líneas diferentes;
  el dibujo FF sí ofrecía posiciones horizontales distintas para ese once.

Auditoría de los **nueve publicados**, sin nuevas lecturas: 24 alternativas
necesarias bajo70; 22 tenían apoyo de mismo puesto capturado. Elche Fer Niño69 →
Tete Morente y Málaga Larrubia65 → Joaquín Muñoz carecían de pareja directa o
justificación escrita. No se concluye que sean tácticamente imposibles.

La auditoría inicial también intentó conciliar estados médicos de Lemar, Bright
Ede, Lookman, Cristian Romero, Jofre Carreras y Del Castillo. Ese criterio quedó
corregido por la instrucción posterior de Ernesto: ni una lesión FF ni una duda
de otra fuente justifican alterar las señales de alineación. La reparación debe
recuperar las observaciones que se hubieran filtrado por salud y resolver once y
alternativas con el cálculo y los puestos, sin otra revisión clínica. Incluir a
Lemar en un pronóstico no constituye por sí mismo un error porque tenga un icono.

Estas observaciones describen capturas históricas del turno; no constituyen una
revisión actual de los veinte clubes. Una corrección completa requiere lectura
nueva autorizada, revisión de todos los clubes y cotejo exacto de sus publicaciones.
Las pruebas sintéticas del índice/preflight no acreditan ese recorrido real.
