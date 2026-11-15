# Mercado automático · metodología v2

Alcance: comunidad649733, temporada2026-27, veinte participantes. Solo lecturas de Mister y publicación de la proyección de mercado. Los puntos, reglas, catálogo editorial y demás automatizaciones no se modifican.

GitHub Actions ejecuta `.github/workflows/mister-market-sync.yml` cinco veces al día: **04:00, 09:00, 13:00, 17:00 y 21:00**, en `America/New_York` (hora de Miami), con ajuste automático de horario de verano. Esta ampliación, autorizada el 15/11/2026, conserva las lecturas de 04:00 y 17:00 y añade tres horarios al mismo workflow, sin crear otra tarea. GitHub puede retrasar una ejecución programada. No usa modelos ni APIs de IA. Los recursos de GitHub y Supabase conservan sus límites propios.

## Conciliación

El archivo conserva íntegros los538 perfiles iniciales y el portal acumulado, con IDs estables. Una coincidencia jugador/origen/destino/importe no prueba identidad individual. Para cada grupo se publica el máximo de las cantidades observadas en cada fuente, nunca su suma. Las fechas conocidas se conservan; los mínimos adicionales sin fecha se muestran como tales. Las fuentes originales permiten revisar cualquier coincidencia. El resultado es un mínimo documentado, no toda la temporada garantizada.

La lectura inicial de15/11 recuperó443 cláusulas de perfiles y132 del portal.131 son candidatas a coincidencia. Una operación adicional de Frenkie de Jong(Arian→Rivaldo,2.952.000) no está entre sus últimos cinco movimientos. Total mínimo conciliado:444. No se le atribuye fecha inventada.

## Ejecución

1. Un único trabajo por vez. Identidad OIDC firmada por GitHub: repositorio e ID exactos, rama main, archivo exacto, evento schedule/manual y runner alojado por GitHub. Se rechazan PRs/forks/otras ramas, tokens vencidos o modificados.
2. El servidor obtiene el archivo privado y la sesión sellada. La clave privada queda en Vault. La sesión se descifra dentro de la función y viaja por TLS únicamente al trabajo autenticado; permanece en memoria, sin logs ni artefactos públicos.
3. Leer Libres/No libres hasta agotar ambas listas y verificar los filtros; comprobar los20 equipos. Leer todo el portal conservado y contrastar que su cabecera no cambió respecto al mercado.
4. Comparar contra la última captura. Falta de jugadores, cambios de contexto o nombres ambiguos bloquean la publicación. Altas y cambios de dueño/valor/cláusula quedan archivados; no se deduce una venta por desaparición.
5. Conciliar determinísticamente, comprimir y verificar hashes. Guardar un archivo nuevo inmutable. Actualizar mercado, equipos y rankings en una única transacción, con revisión esperada y protección contra trabajos antiguos. Refrescar la sesión sellada.
6. Registrar SHA, metodología, inicio/fin, estado, cantidades, tiempo de lectura, gaps y errores controlados en `mister_market.worker_runs`. Un inicio sin cierre permanece visible. Si se pierde la respuesta al publicar, no se repite la escritura ni se declara fallo: revisar la bitácora.

## Activación, prueba y reversión

La configuración privada nace deshabilitada. Un despacho manual `test` recupera y guarda evidencia real, sin sustituir la página. Tras comprobarlo, el operador habilita la configuración y despacha `sync`. Verificar salida, bitácora y captura pública. La recurrencia no requiere ChatGPT ni mantener Codespaces encendido.

Ante sesión vencida, cambiar de formato, falta de filas o revisión en conflicto se conserva la publicación válida anterior y se registra el fallo. No sortear bloqueos de Mister. Renovar la sesión mediante inicio de sesión del titular y sellarla con la clave pública; nunca incluir cookies, contraseña o claves de Supabase en el repositorio. Para pausar, deshabilitar `mister_market.worker_config.enabled`; no borrar archivos. Las ejecuciones tienen20min de límite y el servidor invalida su lease tras30min, por lo que una ejecución vieja no puede publicar sobre una nueva.

## Validación

Regresiones offline: unión conservadora con multiplicidad, IDs repetidos, fechas desconocidas, firma y claims OIDC, alteración de sesión cifrada, permisos privados, activación, bloqueo concurrente, publicación atómica y conservación ante fallo. La prueba real y sus métricas se registran en la bitácora privada; estas pruebas sintéticas no acreditan funcionamiento recurrente.
