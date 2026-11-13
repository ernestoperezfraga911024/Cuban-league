# Contexto de alineaciones por equipo

El once deja de esperar a que se descargue el archivo completo de noticias. La lectura de los 20 pronósticos y el catálogo conserva su comportamiento; después se inicia el contexto del equipo seleccionado.

- Cinco noticias iniciales por club, con una fila adicional para detectar si hay más. El botón solicita las siguientes veinte mediante cursor de fecha y clave, conservando los microsegundos del servidor.
- Noticias del jugador al abrir su detalle, con paginación independiente.
- Consulta separada de todos los artículos del club con salud estructurada, incluyendo altas, sin corte por antigüedad. El estado físico directo de FutbolFantasy también se filtra por club.
- Las reglas `health` y `currentHealth` permanecen intactas. Las consultas de salud deben estar completas antes de resolver avisos. Un error muestra información no verificada y permite reintentar.
- Las respuestas actualizan únicamente noticias y avisos. Se conservan el campo, el jugador abierto, los artículos desplegados y el foco. Cambiar de club, actualizar o abandonar la sección cancela el contexto anterior.
- Las lecturas usan la API pública existente, `no-store` y permisos existentes. No hay migraciones, escrituras en base de datos ni cambios en automatizaciones, porcentajes, catálogo o historial.

## Medición de datos públicos

Comprobación del 13 de noviembre de 2026, 17:24 UTC. Se midieron bytes del JSON sin comprimir de noticias y estado físico; no incluye el once, catálogo ni imágenes, cuyo volumen no cambió. No es una medición de latencia de usuarios.

| Consulta inicial | Noticias visibles | Artículos sanitarios adicionales | Estados físicos directos | Peticiones | Bytes JSON | Reducción |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Anterior: archivo de todos los clubes | 105 | Incluidos | 94 | 3 | 255.848 | — |
| Nueva: Real Madrid | 5 | 0 | 5 | 3 | 12.583 | 95,1 % |
| Nueva: Sevilla | 5 | 2 | 5 | 3 | 18.372 | 92,8 % |

Las cifras nuevas incluyen la fila de anticipación de noticias. Los filtros de equipo, jugador y contención JSONB sanitaria devolvieron HTTP 200 en la API real. La resolución de salud de 27 identidades de los dos clubes coincidió exactamente con la lectura anterior del archivo completo.

## Validación

Pruebas de aislamiento de equipos, contexto lento, lesiones antiguas, altas posteriores, fallo durante la paginación sanitaria, retirada de noticias/once al actualizar, cancelación, foco y panel abierto. La revisión completa pasó 366 de 367 pruebas; la única discrepancia es el hash esperado del catálogo en `editorial-redesign.test.cjs`, ya presente en la base. El archivo del catálogo no cambió.

Los assets públicos cambian a la versión 222. Revertir este PR y publicar los assets previos restaura la carga anterior sin operación sobre datos.
