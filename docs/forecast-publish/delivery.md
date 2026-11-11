# Entrega del piloto Madrid–Celta

La administración ofrece Automático y Manual. En manual, la lectura validada
queda lista y el único paso necesario es Publicar. La vista previa es opcional.
Historial, comparación, edición, retirada y restauración siguen disponibles en
el desplegable avanzado. El cambio de modo no publica ni relee fuentes.

El proceso programado consulta las tres páginas, verifica el mismo partido,
conserva observaciones privadas, calcula editorial-v2, guarda con
`forecast_pilot.save_draft` y llama a `forecast_publish.command_delivery`.
En automático se construye y publica una revisión inmutable en una transacción;
en manual se registra el resultado `ready` y se espera el clic del administrador.
Una lectura bloqueada o caducada deja intacta la publicación anterior. El visor
público conserva la fecha real y advierte cuando la evidencia supera 24 horas.

## Contrato y permisos

`delivery.sql` añade dos tablas privadas con RLS y sin acceso de clientes,
dos auxiliares INVOKER reservados a la conexión de confianza y dos RPC de
administración. Los wrappers públicos son INVOKER; los privados comprueban
`auth.uid()` y `private.is_league_admin()` antes de elevar privilegios. Ninguna
clave secreta se añade a JavaScript. El proceso automático usa una identidad
de auditoría generada para él, nunca un JWT ni el UUID del administrador.

Todos los comandos bloquean el estado compartido, exigen su versión esperada
y una UUID idempotente. El bloqueo de guardado del piloto también se comparte
para impedir publicar una fuente antigua mientras entra una lectura nueva.
Los reintentos conservan exactamente parámetros y UUID. Una respuesta de red
perdida no crea otro guardado. Un conflicto obliga a volver a leer el estado.
La última lectura bloqueada impide usar una anterior en el flujo rápido.

El servidor vuelve a calcular cada porcentaje y coteja las observaciones
registradas. Solo permite editorial-v2, once jugadores del catálogo, tres
fuentes verificadas y partido sin comenzar. Automático exige evidencia de las
últimas dos horas; el clic manual admite hasta 24 horas. La proyección pública
excluye onces copiados, evaluaciones privadas, UUID y claves de ejecución.
La fuente privada conserva `publication_allowed=false`; solo el comando
separado y autorizado crea la proyección pública.

Los límites existentes permanecen: 20 lecturas, 100 revisiones, 500 eventos.
El registro de entrega añade su propio límite de 500 comandos. No cambian el
catálogo, jornadas, permisos de otras herramientas ni el resto de la liga.

## Calendario acotado

Zona America/New_York (Miami). Del 12 al 21/11/2026, a las 09:00; además,
19 y 20/11 a las 18:00, y 21/11 a las 13:00 (dos horas antes del partido).
Son 13 lecturas como máximo: con las cuatro ya existentes, 17 de 20.
No hay lecturas después del inicio: 21/11/2026 20:00Z, 21:00 Madrid.
Este calendario no abarca otros equipos ni la futura sección de noticias.

La tarea se configura aparte mediante las conexiones existentes de ChatGPT.
La migración no crea cron, infraestructura, API de modelos ni servicios.
Si falta acceso o hace falta reconectar/aprobar, el proceso se detiene y
comunica el bloqueo. Un horario programado no demuestra ejecución exitosa:
se comprueba cada resultado y su fila guardada. No se garantiza disponibilidad
de las fuentes ni precisión deportiva. No se contratan recursos adicionales.

## Despliegue y reversión

La migración empieza en Manual. Aplicar `delivery.sql` con el bloque
`tests/forecast-delivery-db.sql` dentro de la misma migración: una prueba
fallida aborta la migración y las pruebas válidas revierten sus datos. Pueden
quedar huecos normales en la secuencia de revisiones, sin filas sintéticas.
Verificar permisos, hashes de datos previos y asesores antes de fusionar.
Después del despliegue, crear y verificar el calendario; activar Automático
mediante `command_delivery('automatic', version, uuid)` sin suplantar usuarios.

Para detener publicación automática: seleccionar Manual. Para detener también
las lecturas: pausar la tarea identificada al activarla. El modo manual sigue
permitiendo Publicar. Para revertir la interfaz, revertir el PR y dejar Manual;
conservar historial y tablas. No borrar publicaciones ni restaurar respaldos.

## Verificación reproducible

- `node --test tests/forecast-publish.test.cjs tests/forecast-review.test.cjs tests/forecast-source-method.test.cjs`
- `node scripts/check-forecast-delivery-browser.cjs`
- `node scripts/check-forecast-publish-browser.cjs`
- `tests/forecast-delivery-db.sql`, bloque con reversión automática: permisos,
  administrador, automatización, manual, publicación atómica, idempotencia,
  conflicto, datos bloqueados/caducados, proyección y restauración existentes.

Las pruebas de navegador usan respuestas sintéticas y no escriben en Supabase.
Se comprueban 320, 390, 768 y 1280 px, reintento tras respuesta perdida,
conflictos y cierre de sesión con una respuesta todavía pendiente.
