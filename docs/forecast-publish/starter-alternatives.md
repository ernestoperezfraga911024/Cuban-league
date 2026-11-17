# Titular y alternativa en distintos puestos

Regla de Ernesto del 17/11/2026: un regular puede ser alternativa de otro
jugador, incluso en nuestro once, porque representa otro puesto o dibujo.
Una alternativa de sí mismo es una relación errónea: ignorarla y conservar
su aparición titular. Se exige evidencia táctica, nunca información médica.

El productor conserva todas las alternativas en la revisión, incluido el
control de completitud de Comuniate. Para calcular usa una señal por jugador
y fuente: la aparición titular tiene prioridad con su porcentaje original,
incluidos cero y null. No suma ni promedia sus dos apariciones. Devuelve además
`source_roles` para diagnóstico; los cuerpos, relaciones y revisiones originales
conservan la evidencia. El inspector marca las autorreferencias resueltas por ID
y no las presenta como apoyo táctico. No se omiten observaciones para eludir el
validador ni se inventan identidades.

Bajo70 sigue siendo necesaria una alternativa distinta y evaluada. En v6 su
evaluación puede estar en los once o entre los candidatos; un mismo ID no se
duplica en esas dos listas. La vista muestra su único porcentaje junto al relevo.
La selección mantiene once IDs y puestos distintos. Una autorreferencia ignorada
no justifica inventar una alternativa si falta otra observada.

## Despliegue y reversión

Instalar `starter-alternatives.sql` como mantenimiento interactivo, nunca desde
la tarea periódica. Exige la huella v6 previa
`5136698aeb7ea9eb7d7beed48a97033b` y cambia únicamente dos condiciones de
`forecast_season.build_team`: permite otro titular como relevo v6 y reconoce
su evaluación entre los jugadores. El cálculo, validación de fuentes, fechas,
modos, recuperación y contratos de guardado/entrega permanecen intactos.

La migración conserva identidad y permisos de la función y verifica dentro de
la transacción que no cambien filas de pronósticos, catálogo ni salud. Conserva
las reglas v2–v5; no reescribe saved, publicaciones o históricos. Su huella
resultante es `105206b17439613a07159868f261bc9e`. Desplegar también productor,
preflight, inspector y assets públicos versionados, y actualizar las instrucciones
de la tarea existente conservando sus horarios y estado.

La reversión `starter-alternatives-rollback.sql` exige esa huella exacta y
restaura la definición anterior, sin reescribir datos. No revierte contenido ya
publicado. Coordinar cualquier reversión con las publicaciones v6 que puedan
contener relaciones nuevas; nunca degradarlas silenciosamente.

## Validación

Regresiones de las tres fuentes, conservación de cero y null, alternativas de
Comuniate completas, alias de autorreferencia, otra titularidad como relevo,
igualdad JS/PostgreSQL, metadatos/filas intactos y presentación con once jugadores.
Los porcentajes continúan siendo independientes de salud. Se mantienen errores
por identidad ajena, dos titulares con el mismo ID, falta de evaluación y
porcentajes inconsistentes. Las pruebas locales no acreditan una nueva ejecución
deportiva ni la recuperación de los tres equipos bloqueados a las 06:00.
