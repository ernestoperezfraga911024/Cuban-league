# Mayor porcentaje por puesto — regla de Ernesto, 17/11/2026

En cada puesto, el titular es quien tiene **el mayor porcentaje final calculado**
entre las opciones tácticamente compatibles respaldadas por las fuentes. Una
alternativa nunca puede tener mayor porcentaje que el titular al que acompaña.
Ejemplo: Bernal 55% titular; De Jong 43% alternativa. No se cambia ninguno de
los dos porcentajes para corregir el orden.

Primero se recogen todas las señales y se calcula editorial-v6 con los pesos
vigentes; después se elige el ocupante del puesto. La selección inicial de una
fuente o del revisor no tiene prioridad sobre el resultado final. Se revisan
todas las opciones observadas para cada puesto, indicándolas en `alternative_id`
y, cuando hay más, en `alternative_ids`. El productor ordena esas opciones por
su porcentaje calculado. No ordena globalmente los once ni compara jugadores de
posiciones incompatibles. En empate conserva la selección revisada y el orden
de alternativas, sin inventar diferencias.

Una promoción ocupa el mismo puesto y posición de la pareja revisada. Conserva
el orden izquierda/derecha; el informe de geometría mantiene `source_slot_ids`
y registra `promotions`. El anterior titular pasa a candidato con su propia
evaluación intacta y puede quedar como alternativa. Por debajo de70 se exige
una alternativa evaluada; desde70 no se muestra. Los candidatos se recomputan
con los once finales, no con los once iniciales.

Si un jugador gana dos puestos, el productor elige la combinación de once
identidades distintas con mayor suma de porcentajes dentro de los puestos
revisados. A igualdad de suma prefiere conservar más titulares en sus plazas
iniciales. El revisor debe comprobar las parejas en los dos sentidos sobre el
dibujo observado. Por ejemplo, si Jornada Perfecta sitúa a Canales como relevo
de Galarreta en la izquierda, comparar a ambos para esa plaza aun cuando otra
fuente proponga a Canales de inicio. Conservar todos los vínculos en la revisión
y comprobar las alternativas bajo 70 después de repartir los puestos.

La salud no participa: los símbolos proceden exclusivamente del estado directo
de FutbolFantasy y no cambian cálculo, orden ni disponibilidad en el pronóstico.
Se conservan todos los votos, porcentajes explícitos, ceros, nulos y observaciones.

## Controles y despliegue

`selection-priority.cjs` decide después de calcular todos los jugadores.
`selection-priority.sql` añade un rechazo independiente en `build_team`: un
payload v6 con una pareja invertida no puede validarse, guardarse ni publicarse,
aunque se haya construido fuera del productor. No cambia métodos v1–v5, pesos,
permisos, datos, fechas ni tablas. Exige la huella exacta del builder posterior
a `starter-alternatives.sql`. La reversión verifica la huella posterior y
restaura exactamente la definición anterior.

Los datos históricos no se recalculan. Los saved válidos se entregan intactos;
si un saved contiene esta inversión, se informa del fallo y no se publica una
pareja incorrecta. Su corrección requiere el contexto autorizado, no reabrir
automáticamente una ejecución ni retocar fechas.

La corrección interactiva del 17/11 sobre publicaciones actuales es mantenimiento
explícitamente solicitado: compara huellas de cada fila antes de escribir,
revalida con SQL las mismas observaciones y conserva fechas de lectura y
publicación, archivo histórico, intentos originales, catálogo y salud. La
bitácora identifica pares y huellas anteriores/posteriores. No cuenta como
una lectura nueva ni como una ejecución deportiva completa.

Regresiones: caso exacto43/55 con cinco papeletas P11, empate, varias opciones,
promoción desde70, candidato/titular, conflicto de dos puestos, conservación de
fuentes, invariancia médica, validación SQL independiente y reversión exacta.
