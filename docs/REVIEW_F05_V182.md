# V182 — F05 Tres franjas

## Alcance aprobado

Ernesto eligió el logo F05 (escudo con tres franjas, balón y CL) y pidió sustituir
todos los usos activos y adaptar los colores de la página, sin romper datos y
priorizando rendimiento. Se mantiene la distribución oscura de V181.

Base: `f172dce4dbba2e8580a2a281a02de1652a76e19f`.
Respaldo remoto: `backup/pre-f05-logo-v181-20261018`.

## Implementación

- SVG autocontenido, sin fuentes, filtros ni bitmap, de menos de 2 KB.
- Cabecera pública, cabecera privada, favicon, ayuda de instalación, PWA y
  generador central de tarjetas usan la marca F05.
- PNG de 32, 180, 192 y 512 píxeles; maskable separado con margen del 20%.
- `brand-f05.css`: menos de 7 KB, sin librerías, medidas JS, cambios de geometría,
  visibilidad o fuentes. La paleta usa `#075638`, `#f4efdc` y `#071910` con tonos
  derivados legibles. Conserva rojas, alertas, descenso, medallas y rarezas.
- Manifests: solo iconos y theme/background colors. Se conservan IDs, scope,
  start URLs, accesos, display y separación entre app pública y panel.
- Caché `cuban-league-v182-f05-brand`, con recursos actuales precargados.
- Se conservan los logos y demás recursos anteriores en el repositorio para
  compatibilidad y recuperación; no se descargan los antiguos en el shell nuevo.
- Regeneración: `node scripts/build-brand-icons.cjs` (requiere Inkscape en el
  equipo de desarrollo, no en los dispositivos de los usuarios ni para servir la web).

## Garantías comprobadas

`npm test`: 103 pruebas aprobadas. Incluye:

- Datos JSON, catálogo, configuración, importador, admin.js y CSS anteriores
  idénticos al contrato V174; 627 fotos/escudos/iconos originales preservados.
- Cálculos deportivos y normalizadores sin cambios. Pruebas de capitanes/MVP,
  Liga sin bonus, Copa, navegación y sincronización existentes aprobadas.
- Manifests comparados con el hash anterior tras deshacer únicamente los campos
  de marca autorizados; ningún otro cambio del manifest queda permitido.
- Rutas activas de marca, dimensiones PNG y presupuestos de tamaño.
- CSS limitado por prueba a propiedades de pintura y contención del logo.
- Contraste de texto normal de al menos 4,5:1 en las combinaciones principales.
- Generador de tarjetas comprobado con imágenes simuladas, sin consultas de red.
- Caché precargada y versiones de recursos coherentes.

La vista previa local administrada no arrancó por una limitación del entorno:
`bwrap: Can't mount proc on /newroot/proc: Operation not permitted`.
No se desactivaron protecciones ni se sustituyó el supervisor.
Las pruebas DOM no sustituyen una comprobación visual en dispositivos reales.

## Datos y seguridad

Sin migraciones, consultas nuevas, escrituras Supabase, cambios de permisos,
credenciales, datos históricos, fotos, catálogos ni publicación de jornadas.
No se modifica la extensión Mister ni su paquete.

## Reversión

Revertir solo el commit/PR V182 mediante un nuevo commit. El respaldo V181
identifica el estado previo; no hacer reset destructivo ni restaurar la base de
datos. Si ya existen cambios posteriores, revertir únicamente las referencias
de marca, paleta y manifests, conservando las funciones y datos nuevos.
Al revertir, rotar otra vez CACHE_NAME para que la PWA no retenga la paleta F05.

Los iconos ya instalados en iOS/Android pueden renovarse con retraso controlado
por el sistema. No borrar almacenamiento local, sesiones o borradores para
forzar el cambio de un icono.
