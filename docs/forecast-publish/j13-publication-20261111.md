# Publicación de la prueba J13 — 11 de noviembre de 2026

Los PR #81 y #82 incorporan el selector de veinte clubes y la versión 206 de los recursos públicos. La prueba sigue limitada a los diez partidos de la jornada 13 de LaLiga 2026/27; no amplía los horarios de actualización existentes.

## Datos publicados y verificados

- Publicación en Supabase: `2026-11-11T20:30:43.374795Z`.
- Nueva comprobación anónima de la API: `2026-11-11T20:51:48.386Z`.
- Resultado: 20 equipos, 220 jugadores y 60 registros de fuente; una alineación por club y tres fuentes por alineación.
- La publicación ya existe. Reintentar el despliegue de la web no requiere volver a guardar ni publicar el lote.

## Incidencia del despliegue web

Los despliegues [43095845655](https://github.com/ernestoperezfraga911024/Cuban-league/actions/runs/43095845655) y [43096073986](https://github.com/ernestoperezfraga911024/Cuban-league/actions/runs/43096073986) terminaron con `startup_failure` antes de crear trabajos. La anotación del último indica un error interno inesperado y recomienda reintentarlo. El intento de repetir los trabajos fallidos respondió HTTP 403: `This workflow run cannot be retried`.

La comprobación HTTP de la página pública todavía devolvía la versión anterior, modificada a las `19:44:05Z`, sin el módulo `forecast-round-core.js?v=206-20261111`. Por tanto, los datos publicados no bastan para confirmar que el nuevo selector está visible.

Este cambio de documentación solicita un nuevo despliegue mediante el flujo de publicación ya existente al integrarse en `main`. No cambia código de ejecución, datos, configuración, permisos ni servicios.

## Criterio de cierre

Comprobar que la nueva ejecución de Pages termina correctamente y que la URL pública sirve el HTML y los módulos de la versión 206. La API debe seguir devolviendo los veinte equipos y 220 jugadores. Las pruebas de navegador con respuestas controladas no sustituyen esta comprobación de producción.
