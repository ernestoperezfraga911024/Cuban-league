# Editorial v4: situación física y antelación informativas

Autorizado por Ernesto el 12/11/2026. Schema 4; method_version y assessment.method editorial-v4.

Disponibilidad y horizonte son datos informativos obligatorios, con ajuste numérico 0 en todos sus estados. No restes puntos por molestias, lesión, incertidumbre física ni días hasta el partido; tampoco reintroduzcas esos descuentos mediante context o rotation. Conserva los ajustes por rotación deportiva low0,possible-3,high-8 y contexto -10..10 con evidencia ajena a condición física/antelación. Mantén la clasificación temporal real <=48h near,<=120h medium,resto distant para trazabilidad, sin descuentos ni topes distintos. Redondea solo al final; mínimo5 y máximo95 para cualquier horizonte. No dupliques descuentos ya reflejados en fuentes. No propongas bajas confirmadas. Mantén símbolos y explicaciones físicas. No cambies los pesos por supuesta precisión sin evaluación real.

Pesos intactos: FutbolFantasy 30%, Jornada Perfecta 20%, Comuniate 20%, Predicted11 30%. Sin onces P11 completos, normalizar las tres fuentes base entre 70. Sin rol/continuidad. Las señales editoriales sin porcentaje publicado siguen siendo 90/40/25.

Ejemplo con las mismas evidencias: 50×0,30 + 40×0,20 + 50×0,20 + (4/6×100)×0,30 = 53. Una duda física y horizonte distante no restan 8 ni 2. V3 sigue devolviendo 43; v4 devuelve 53.

Desplegar primero la interfaz compatible y después editorial-v4.sql. La migración comprueba que las dos funciones coinciden con las revisadas y conserva validaciones de evidencia, ausencia confirmada, once, roster, alternativas y ventanas. No modifica publicaciones, borradores, histórico, permisos, calendario ni horarios. Actualizar el método del prompt existente después de verificar SQL. Los próximos borradores se elaboran con lecturas nuevas y v4; nunca presentar un recálculo antiguo como consulta nueva.

Los métodos v1/v2/v3 mantienen sus cálculos y registros. La reversión restaura las dos funciones previas; requiere coordinar borradores v4 existentes.
