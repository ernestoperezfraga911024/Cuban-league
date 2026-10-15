# V178 · Diseño anterior con navegación móvil conservada

## Estado actual

V178 unifica los colores del menú Más con la página: fondo oscuro, texto claro,
iconos verdes y foco visible. Conserva sus opciones, medidas y funcionamiento;
no modifica JavaScript de navegación ni datos. La caché de estilos pasa a V178.

V177 ajusta únicamente los colores de la barra inferior a la paleta oscura y
verde del sitio. No cambia el menú Más, la navegación, las medidas ni los datos.
La caché V177 invalida el recurso de estilos para mostrar el ajuste.

Ernesto rechazó el aspecto V175 después de publicarlo y pidió recuperar V174,
conservando únicamente la barra inferior clara y el menú Más mostrados en sus
dos capturas (2026-10-14, Miami).

V176 parte del main `0073a709b50d91d0de3f09934415c79dfd53d2b8` y restablece
`styles.css`, las fuentes, los fondos y `admin.css` del diseño anterior.
`mobile-navigation.css` contiene solo estilos de los dos elementos conservados;
`editorial-ui.js` mantiene el diálogo nativo, el foco y la sección activa.
En escritorio se conserva la navegación anterior. La lógica de `app.js` vuelve
a V174, salvo los atributos accesibles de la sección activa. Las fotografías,
`data.json`, el catálogo, Supabase y el código administrativo no se restauran
ni se modifican. El service worker usa una caché nueva V176.

Los recursos del tema V175 quedan archivados en el repositorio, pero no se
cargan ni se precargan. No ejecutar `build:design` para cambiar V176: editar
únicamente `mobile-navigation.css` si se ajusta esta barra o este menú.

Se comprueban conservación de datos y fotos, cálculos, perfiles, rutas reales
al pulsar los accesos, cierre del menú, foco y recursos de caché. La revisión
visual en navegador/dispositivos reales sigue pendiente por falta de la
herramienta compatible. No se afirma haber realizado Lighthouse ni un login
administrativo real.

## Historial de V175 y recuperación de código

El contenido siguiente documenta la versión sustituida, no el tema activo.


## Estado y alcance

Preparado sobre V174, commit `24bc164f6d860b4bb4d1e441807da9530b0a0583`.
Publicación autorizada expresamente por Ernesto el 2026-10-15 mediante PR #45.
La revisión visual en dispositivos reales sigue pendiente; esta autorización
no implica que se haya realizado. No se han ejecutado escrituras ni migraciones
en Supabase.
El código de administración, importación Mister, publicación, restauración,
reglas y cálculos permanece intacto. `app.js` solo cambia navegación visual,
estado accesible de navegación y atributos de carga de imágenes.

Dirección visual: marfil, verde bosque, tipografía de sistema, superficies
planas y menor densidad decorativa. Se aplica a las secciones existentes,
sus subapartados, perfiles, insignias, alineaciones y panel administrativo.
Las imágenes exportadas por el Centro de Tarjetas conservan su generador
actual; se rediseña el entorno de edición, no su formato de exportación.

Las 25 imágenes aprobadas son referencias, no capturas del sitio terminado.
No se copian cifras, reglas, fotografías regeneradas ni datos ilustrativos.

## Respaldo recuperable

Rama remota anterior al cambio:
`backup/pre-editorial-redesign-v174-20261015`

Commit: `24bc164f6d860b4bb4d1e441807da9530b0a0583`.
Conserva el código completo, las fotos y los archivos del sitio anterior.
Es **respaldo de código**, no un nuevo respaldo de la base de datos.
Los respaldos de datos V124 existentes no se alteran ni se restauran.

## Volver al diseño anterior después de publicar

1. Identificar el commit de integración de este rediseño.
2. Crear una rama nueva desde el `main` vigente y revertir ese cambio como
   un nuevo commit. Para un merge commit se debe seleccionar correctamente
   el padre principal. Revisar conflictos si hubo cambios posteriores.
3. Revisar que la reversión restaure solo presentación, navegación, caché,
   documentación y tests asociados. **No restaurar `data.json`, el catálogo,
   las fotografías, ni Supabase desde una copia antigua.**
4. Ejecutar los tests de la versión resultante y revisar web/panel.
5. Integrar la reversión y esperar a que termine GitHub Pages. Recargar la
   PWA y confirmar que actualizó su service worker.

No hacer `reset --hard`, no forzar `main`, no desplegar todo el árbol antiguo
encima del actual y no restaurar backups de datos para deshacer un diseño.
Las nuevas jornadas y publicaciones permanecen en Supabase durante este flujo.

## Construcción del tema

```sh
npm ci
npm run build:design
npm test
```

- `styles.css` y `admin.css` se conservan sin cambios como base histórica.
- `scripts/build-editorial.cjs` conserva geometría, visibilidad y estados;
  sustituye colores y decoración; elimina declaraciones exactas redundantes.
- Editar `design/editorial-overrides.css` y
  `design/editorial-admin-overrides.css`, y regenerar.
- Se sirven `editorial.css` y `editorial-admin.css`, **no ambos temas juntos**.
- El parser es una dependencia de desarrollo, nunca se descarga en la web.
- `editorial-ui.js` no accede a red, datos, autenticación ni almacenamiento.
  Usa el diálogo nativo; si no existe soporte, conserva la navegación anterior.

## Optimización aplicada

- Sin solicitudes a Google Fonts; tipografía de sistema.
- Sin fondos de estadio, blur de pantalla completa ni resplandores costosos.
- Cinco fondos decorativos (~1,3 MB) salen de la precarga del service worker;
  los archivos originales siguen en el repositorio.
- Fotos fuera de la portada: `loading="lazy"` y `decoding="async"`.
- Avatares del podio de portada siguen con carga prioritaria normal/eager.
- Navegación editorial inmediata, sin el retraso de entrada/salida anterior.
- Estilos públicos gzip aproximadamente 28 % menores; admin ~20 % menores.
  Son medidas de archivos locales, **no resultados Lighthouse ni Core Web Vitals**.

## Verificado automáticamente

- 73 tests locales aprobados (61 existentes + 12 del rediseño).
- 627 imágenes, escudos e iconos idénticos byte a byte.
- `data.json`, catálogo, admin/importación/configuración y CSS anterior intactos.
- 350 IDs originales conservados, sin IDs duplicados.
- 28 funciones de cálculo, normalización y sincronización idénticas.
- Navegación de las nueve secciones, perfiles y pestañas, fallback del menú.
- CSS parseable, recursos locales presentes, caché de recursos nuevos,
  contraste de los seis pares principales y ausencia de nuevas escrituras.

## Verificación visual pendiente

No se pudo realizar QA visual en navegador en este entorno porque no estaba
disponible la herramienta de navegador requerida. **Estos tests no certifican
la geometría renderizada, el tacto real ni una sesión administrativa en vivo.**

Revisar al menos:

| Entorno | Comprobaciones |
| --- | --- |
| 320 / 360 / 390 / 430 px | Cabecera, menú Más, tabla con columnas fijas, nombres largos y safe area |
| 768 px y orientación horizontal | Rejillas, selectores, navegación y panel de revisión de poca altura |
| 1024 / 1440 px | Portada, tablas completas, perfiles, comparador, Champions y Copa |
| iPhone / Android | Teclado sin zoom de inputs, cierre de modales, scroll y navegación atrás |
| Teclado y zoom 200 % | Orden de foco, Escape, textos y botones sin recortes |
| Administración | Login, importación a borrador, revisión, cancelar, publicaciones existentes y herramientas |
| PWA | Actualización de caché, reapertura offline y carga de fotos al entrar a cada sección |

Usar datos de prueba para cualquier validación de escritura. No publicar una
jornada real ni restaurar datos como parte de la revisión de un diseño.
El usuario autorizó publicar después de conocer esta limitación. Mantener esta
revisión pendiente y registrar sus resultados cuando se realice.
