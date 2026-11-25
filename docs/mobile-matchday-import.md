# Importación de jornadas desde el celular

La guía pública está en `mister-mobile.html`. El administrador guarda una vez el
ayudante como marcador JavaScript, lo ejecuta en la clasificación de Mister,
guarda un JSON en Archivos y lo carga en la misma jornada de administración.
Primera conserva el circuito de normalización, revisión de conflictos, copia
local y RPC de borrador con revisión. Segunda conserva revisión y publicación
manual con la revisión vigente y exclusión de administrador configurada.

El marcador se genera con `node scripts/build-mobile-mister.cjs`. Incluye sin
modificaciones los dos lectores de `mister-extension` y sus reglas compartidas.
No carga scripts remotos, no accede a cookies/contraseñas, no envía capturas a
servidores y no sustituye el runtime de una extensión real. La descarga ocurre
solo cuando termina la lectura completa. La pestaña debe permanecer visible;
si el sistema la descarga, se repite la captura conservando el borrador anterior.
El archivo permite volver a cargar sin depender de que sobreviva otra pestaña.

Al actualizar lectores hay que regenerar el marcador; la prueba de igualdad
hace fallar CI si el archivo generado queda obsoleto. Los usuarios con un
marcador anterior deben volver a copiarlo desde la guía.

Verificación 25/11/2026: 81 pruebas relacionadas aprobadas localmente. Incluyen
los lectores de escritorio y móvil sobre DOM de prueba, igualdad de capturas de
Primera, Segunda histórica, rechazo de jornada/temporada/liga incorrectas,
archivo inválido o mayor de 2 MB, borrador sin publicación y decisiones al
reimportar. También contratos de catálogo, core, worker, transporte y PWA.
No se usó una sesión real de Mister ni se modificaron datos deportivos.
La instalación del marcador y la transferencia mediante Archivos en un iPhone
real siguen pendientes de comprobación. No se pudo ejecutar la revisión visual
local: no había binario Chromium/WebKit y la descarga fue rechazada por la red.
