# Probabilidades basadas solo en las cuatro fuentes

`editorial-v6` calcula el porcentaje únicamente con las observaciones de
FutbolFantasy, Jornada Perfecta, Comuniate y los onces completos válidos de
Predicted11. El estado físico se publica por separado y solo añade su símbolo:
no excluye jugadores, no resta porcentaje y no decide posiciones ni alternativas.

| Fuente | Peso | Señal sin porcentaje explícito |
|---|---:|---|
| FutbolFantasy | 30 | Titular 90; alternativa 40; no listado 25 |
| Jornada Perfecta | 20 | Titular 90; alternativa 40; no listado 25 |
| Comuniate | 20 | Titular 50; alternativa 40; no listado 25 |
| Predicted11 | 30 | 100 × votos / onces completos válidos |

Un porcentaje publicado, incluido cero, prevalece sobre la señal de reserva.
Sin onces completos de Predicted11, se omite su señal y se normalizan los pesos
restantes sobre 70; no se interpreta la ausencia como un voto negativo.
El promedio ponderado se redondea al entero y se limita al intervalo 5–95.
No hay ajustes externos por salud, rotación, contexto o distancia al partido.
Los porcentajes siguen siendo estimaciones no calibradas.

La evaluación nueva tiene solo `method: "editorial-v6"` y `sources`. Si llegan
campos médicos o de ajustes heredados, no influyen en el cálculo ni son requisitos.
Las observaciones, votos, referencias, identidades y fechas conservan sus
validaciones. Un titular por debajo de 70 requiere una alternativa evaluada
fuera del once. Las coordenadas y las alternativas siguen la evidencia de las
alineaciones, sin utilizar salud para sustituirlas.

## Instalación y compatibilidad

`editorial-v6.sql` es mantenimiento interactivo; no debe ejecutarlo la tarea
periódica. Comprueba las huellas exactas de `assess` y `build_team` antes de
modificarlos. Conserva las ramas v1–v5 y sus resultados anteriores. La rama v6
reutiliza internamente el cálculo v5 con campos de compatibilidad fijos y neutros;
el usuario no aporta esos campos y no aparecen en la proyección pública.
La referencia de compatibilidad procede de las mismas fuentes validadas y no
representa una observación médica.

El constructor acepta v6 en titulares y candidatos. Solo para v6 deja de exigir
el campo redundante `assessment.horizon`; el partido, sus fechas, antigüedad de
las lecturas y ventana real siguen comprobándose en el payload y las fuentes.
La migración bloquea brevemente escrituras de las tablas de pronósticos y coteja
sus filas, ACL/RLS y metadatos de las dos funciones antes y después. No recalcula
ni reescribe publicaciones, borradores, registros, catálogo, modos o retiradas.
La espera por bloqueos está limitada a cinco segundos y cada sentencia a treinta;
si el sistema está ocupado o una comprobación falla, se revierte la transacción.

Estado: integrado mediante PR137 (`db76a86a2f340399475065dfa52b7059e2b57b1d`)
e instalado el 16/11/2026. La migración verificó que filas y permisos permanecieran
idénticos. Comprobación de solo lectura en producción: las mismas fuentes dan 66
sin metadatos, con lesión y con duda. Los recursos públicos de la web coinciden
con el código integrado. La republicación deportiva completa se verifica por
separado; esta prueba aritmética no acredita veinte clubes actualizados.
Una futura actualización de la fórmula v5 debe conservar también la semántica
v6 o sustituir esta delegación con pruebas de equivalencia explícitas.

## Comprobación de invariancia

Con las mismas cuatro observaciones y la misma selección, variar lesión, duda,
disponibilidad, `confirmed_out`, rotación, contexto o sus referencias no puede
cambiar porcentajes, titulares, candidatos, posiciones, alternativas ni
`source_summary`. La falta de esos metadatos tampoco bloquea v6.
Sí deben seguir fallando porcentajes o votos falsos, identidades ajenas,
evidencia antigua, versiones mezcladas, once incompleto y alternativas ausentes.

La regresión PostgreSQL local también recorre las definiciones existentes de
`save_draft`, `deliver` y `publish_team`, con el reloj del plan controlado solo en
la prueba. Comprueba la entrega intacta de un saved v5, publicación y lectura
pública de v6, cambios de salud entre guardado y entrega, reintentos idempotentes
y conservación de los modos manual/retirado. Esto valida integración local;
no acredita instalación, ejecución real ni una publicación de los veinte clubes.

Reversión: comparar primero las definiciones instaladas y restaurar ambas
definiciones anteriores revisadas, sin sobrescribir cambios posteriores. No
reescribir los datos v6 ya guardados como si fueran v5: conservar su versión y
sus trazas. No deshacer las publicaciones o estados físicos para revertir código.
