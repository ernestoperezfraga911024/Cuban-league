# Estado físico y dos revisiones generales
La revisión de los 20 clubes de LaLiga 2026/27, J13–38, ocurre a las 06:00 y 14:00 de America/New_York. Los controles de 13:00 (partidos de hoy) y 18:00 (48 horas) se conservan. La automatización existente ya comprueba cada hora de 06:00 a 23:00: no se crea otra tarea ni infraestructura.

FutbolFantasy aporta un estado físico independiente de las noticias. Duda muestra ?, lesionado muestra una cruz roja y disponible quita el símbolo, manteniendo la explicación. Tocado pero disponible no implica alta médica. Los nombres, fotos, porcentajes, historial y datos fantasy se conservan.

El feed público solo contiene observaciones entregadas. En Manual, Publicar en el panel existente entrega también los estados físicos listos. Retirar el club oculta sus observaciones mediante RLS; no cambia el modo ni lo restaura una lectura. Una petición fallida conserva la publicación anterior con su fecha. Una observación antigua o un conflicto de igual hora no reemplaza evidencia más reciente.

Se consulta el feed una vez al abrir/actualizar Alineaciones, con paginación. Cambiar de escudo no hace peticiones. Un fallo del feed físico no impide mostrar el once ni las noticias. La interfaz no infiere estados a partir de titulares o porcentajes; solo muestra datos explícitos. Una noticia de acontecimiento posterior puede superar una observación de FF; actualizar la fecha de importación de una noticia antigua no lo consigue.

## Aplicación y comprobación
1. Revisar `health-and-two-daily.sql`: tablas nuevas aisladas, RPC privados sin permisos para clientes y extensión guardada de las funciones existentes. Las definiciones originales deben coincidir exactamente.
2. Ejecutar migración + `tests/forecast-health-db.sql` dentro de una transacción de prueba y terminar con ROLLBACK. Las pruebas internas revierten sus datos, modos y retiradas.
3. Aplicar la migración en una transacción y repetir las comprobaciones antes del COMMIT. Nunca guardar evidencia sintética.
4. Integrar el frontend v212 mediante PR; comprobar los recursos desplegados y las lecturas públicas.
5. Anteponer `physical-status-automation.txt` al protocolo existente y sustituir su frase de horario general. Mantener el resto del prompt y el VEVENT horario.
6. Primera lectura autorizada: consultar páginas públicas, resolver identidades, guardar con save_batch, entregar con deliver y verificar cada fila.

Las pruebas SQL cubren ventanas, horario de verano, límite de temporada, frescura, estados, identidad, duplicados, Manual/Automático y retiradas. Las pruebas DOM cubren símbolos, disponibilidad posterior, separación de noticias y peticiones locales al cambiar de club.

## Reversión
Revertir el PR del frontend y restaurar las tres definiciones originales incluidas en los bloques guard de la migración, tras comparar sus versiones actuales. Quitar solo la ampliación del prompt y restaurar la frase del horario. Mantener las tablas aditivas sin uso conserva la evidencia; no requiere borrar datos ni alterar el catálogo.
