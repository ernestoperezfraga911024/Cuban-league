# Segunda División · V189 / extensión 1.1.1

El lector 1.1.0 comenzaba al encontrar una tarjeta de la jornada correcta, pero después recorría todas las tarjetas, incluidas las ocultas o las que seguían cargando. Eso podía producir «La alineación no corresponde a la jornada solicitada». No se pudo inspeccionar la sesión de Mister de la captura, por lo que no se atribuye su causa exacta sin una prueba real.

## Cambios
- Espera 11 puestos visibles de cuatro líneas, del mismo participante y jornada, estables durante tres lecturas. Una posición vacía requiere señal explícita y −4. No acepta un once de otra jornada.
- Puede seleccionar un enlace histórico visible de Mister para ese participante y jornada. No construye endpoints privados ni abre estadísticas.
- El fallo identifica participante, jornada y puestos confirmados. No publica datos parciales.
- Captura fotos de la fila de Mister, validadas en cliente y base de datos. Si faltan al reimportar, conserva la foto anterior o de General. Fallos de imagen muestran iniciales.
- Fotos diferidas de 40 px (34 px móvil), sin consultas adicionales. Una foto que carga tarde no se confunde con un cambio de puntos.
- La llamada administrativa existente devuelve las jornadas publicadas. Cada opción muestra Guardada/Pendiente.
- El panel exige la capacidad secondHistory de la extensión 1.1.1. Cache V189, ZIP y guía actualizados. El lector y las reglas de Primera no cambian.

## Datos y despliegue
Aplicar `supabase-second-division-history-photos.sql` después del esquema V188. Reemplaza solo las dos funciones de Segunda y añade un validador privado de URL. No modifica filas deportivas. Conserva autorización por administrador, RLS de lectura pública, revisión esperada y publicación atómica por temporada/jornada.

Digest de matchday_stats antes/después: `15aee0856d9edd3f4d33b44dd335f97b`.
Digest de second_division_standings antes/después: `fbbda9400d7be7739377e1bbc1eb79bd`.
General real: 19 participantes y administrador excluido. No hay jornadas publicadas al verificar.

## Validación
- 134 pruebas pasan con `node --test --test-concurrency=1 tests/*.test.cjs`. La ejecución concurrente tuvo una intermitencia del test existente de transporte; pasó aislado y en la ejecución completa secuencial, sin modificar ese test.
- Fixtures: J5 real archivada; J1 seleccionada desde J9; once que termina de cargar; tarjetas ocultas de J9; rechazo de un once que permanece en J9; fotos y respaldo.
- SQL con rollback: J9/J1 no sobrescriben J5/General; correcciones atómicas; fotos persistentes; rechazo de URLs inseguras y accesos no autorizados.
- ZIP extraído y comparado con los nueve archivos fuente. Revisión visual en escritorio y móvil de 390 px.
- Sin prueba real autenticada en Mister: el usuario debe actualizar a 1.1.1, reimportar General y probar J1.

## Uso
Actualizar los archivos de la extensión instalada, recargarla en chrome://extensions y recargar Mister/administración. Reimportar y publicar General para las fotos. Después importar, revisar y publicar J1, J2… J9 una por una. General conserva el acumulado de Mister; no crea automáticamente el historial. Jornadas posteriores no borran las anteriores.
