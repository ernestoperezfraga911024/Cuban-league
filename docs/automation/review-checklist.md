# Revisión íntegra de evidencia por club

Este índice de lectura reduce búsquedas repetidas sin sustituir la revisión
editorial, el compilador, la validación SQL ni la comparación pública exacta.
No hace red, no escribe datos, no propone un once y no certifica el calendario.

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
3. **Una observación por jugador y fuente.** Los cuerpos pueden repetir un titular
   como alternativa de otro puesto. Verificarlo en el cuerpo, conservar su
   observación titular y explicar la redundancia revisada en `limitations`.
   Conservar el archivo y geometría originales; no deduplicar a ciegas ni alterar
   porcentajes. Una alternativa que no duplica un titular no puede desaparecer. El control de
   `.alternativo` de Comuniate sigue exigiendo todas sus entradas capturadas; si
   sus datos son contradictorios, no omitirlas para eludir ese control.
4. **Disponibilidad conciliada.** Revisar las lesiones y sanciones FF de ese lado
   del partido, las noticias JP del equipo y las fichas Comuniate. El índice
   conserva iconos y texto: “Tocado/Duda” puede coexistir con “Baja”. Las etiquetas
   `signals` son indicios textuales, no diagnóstico ni confirmación de ausencia.
   Una noticia vieja, entrenamiento parcial o presencia en un once probable no
   prueba alta médica. Una discrepancia exige comparar fechas y evidencia más
   específica del próximo partido; si es necesario, seguir un enlace público
   auténtico mediante el protocolo del runner. Documentar la resolución con
   referencias en `facts`, `confirmed_out` y/o `limitations`; no asignar una baja
   definitiva ni ignorar otra fuente por conveniencia.
5. **Puestos y alternativas.** `alternative_pairs` conserva parejas que realmente
   comparten celda o puesto y las coordenadas observadas. Los porcentajes son los
   publicados; `null` no significa cero ni `100 - titular`. FF busca porcentajes
   en las tarjetas del mismo equipo, también en su banquillo; si hay varios
   distintos los enumera y deja `probability:null` con alerta de ambigüedad.
   `alternative_checks` requiere revisión táctica cuando no encuentra pareja
   directa. Es una pista, no prueba de incompatibilidad. El catálogo aporta solo
   posición amplia; una pareja MC/DL puede ser correcta cuando el cuerpo la
   respalda. No reutilizar un suplente para todas las posiciones automáticamente.
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

También faltaba conciliación documentada para Lemar (Elche, incluido pese a baja
FF y entrenamiento parcial JP), Bright Ede (Deportivo, excluido aunque FF decía
Disponible para J13), Lookman y Cristian Romero (Atlético), Jofre Carreras
(Espanyol) y Del Castillo (Osasuna); para estos cuatro últimos casos FF decía
Duda para J13 mientras Comuniate motivaba la exclusión. Es evidencia de revisión
incompleta, no confirmación de que todas esas bajas fueran incorrectas.

Estas observaciones describen capturas históricas del turno; no constituyen una
revisión actual de los veinte clubes. Una corrección completa requiere lectura
nueva autorizada, revisión de todos los clubes y cotejo exacto de sus publicaciones.
Las pruebas sintéticas del índice/preflight no acreditan ese recorrido real.
