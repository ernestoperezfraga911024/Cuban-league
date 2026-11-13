# Comuniate: titular sin porcentaje publicado

Autorizado por Ernesto el 13/11/2026. Schema 4; las lecturas nuevas usan
`method_version: editorial-v5` y el mismo método en todos los assessments.

Solo cambia la señal de Comuniate cuando `prediction=starter` y
`probability=null`: pasa de 90 a 50. Un porcentaje publicado válido, incluido 0,
se utiliza tal cual. La observación conserva null si no existe porcentaje:
50 es una regla del modelo, nunca un dato atribuido a la fuente.

FutbolFantasy y Jornada Perfecta mantienen starter=90 sin porcentaje. Las tres
fuentes conservan alternative=40 y not_listed=25 cuando falta una cifra explícita.
Pesos: FF30 / JP20 / Comuniate20 / P1130. Se conservan la renormalización sin P11,
rotación/contexto, disponibilidad y horizonte informativos, redondeo y límites.

Ejemplo con las observaciones ya explicadas al usuario: Lemar permanece en 38;
Diangana pasa de 39 a 31. Es una comparación de fórmulas sobre la misma evidencia,
no una lectura nueva ni una publicación. No implica precisión calibrada.

Las evaluaciones v2/v3/v4 conservan exactamente sus resultados. La migración no
reescribe publicaciones, borradores, candidatos, intentos, archivos o historial.
El navegador admite v5 junto a los métodos anteriores y muestra la probabilidad
almacenada, sin recalcular datos antiguos. Un borrador saved conserva su método.

## Despliegue verificado

1. Ejecutar las pruebas de cálculo, PostgreSQL, candidatos, vista previa e
   historial; revisar el diff por separado. Mantener los permisos existentes.
2. Integrar el PR y comprobar que GitHub Pages sirve el validador/renderer v5
   y las URLs de caché actualizadas antes de producir publicaciones v5.
3. Aplicar `editorial-v5.sql` en el proyecto existente y verificar fórmulas,
   hashes de datos y permisos. Los checksums impiden cambiar funciones distintas.
4. Actualizar únicamente las reglas de cálculo de la tarea existente, manteniendo
   horarios, recuperación, fuentes, modo, retiradas y flujos independientes.
5. En nuevas lecturas, recalcular titulares y candidatos; volver a elegir el once
   y sus alternativas. Una caída por debajo de 70 exige una alternativa válida
   fuera del once, con evaluación propia. No editar porcentajes directamente ni
   presentar un recálculo de evidencia vieja como una consulta reciente.

La reversión del productor debe mantener compatible el lector público con v5
mientras existan publicaciones o históricos de ese método. No borrar ni convertir
datos para facilitar un rollback.
