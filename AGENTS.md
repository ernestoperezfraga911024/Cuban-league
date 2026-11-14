# CubanLeaguefantasy

Conservar datos reales, históricos, catálogo, conexiones y funciones existentes. Priorizar velocidad y cambios pequeños verificables.

Para tareas de automatización, mantenimiento de recolectores o diagnóstico de ejecuciones, leer `docs/automation/README.md` y `docs/automation/incidents.json`. Consultar solo los contratos del flujo necesario. Cada corrección de un fallo conocido debe conservar una prueba de regresión y actualizar su estado honestamente. No declarar comprobación en producción a partir de un test sintético.

Las tareas periódicas registran metodología, SHA, resultados, métricas disponibles e incidencias en la bitácora privada descrita en `docs/automation/audit-guide.md`. No necesitan editar código ni abrir PR en cada ejecución. Las correcciones permanentes se revisan por separado, conservando todos los controles de publicación.
