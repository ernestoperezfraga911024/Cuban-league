# Relectura de fechas pendientes

El worker busca las cláusulas que la conciliación ya cuenta pero cuya fecha es
desconocida. Solo visita las fichas de esos jugadores, usando los enlaces leídos
del catálogo y la sesión existente. No recorre las 538 fichas en cada turno.

La fecha procede de Últimos movimientos: tipo Cláusula, jugador, vendedor,
comprador e importe deben coincidir exactamente con un grupo pendiente. No se
deduce del propietario actual, del valor de mercado ni del día de captura.
Los nombres ambiguos o antiguos sin ID resuelto no se asignan por semejanza.

Las filas no tienen ID estable. Se conserva el criterio de mínimo confirmado:
multiconjunto por jugador/partes/importe y, para las filas fechadas, fecha real.
Las filas anteriores y sus referencias quedan intactas; las nuevas se añaden al
final de la ficha, respetando duplicados observados. Solo se añaden tantas fechas
como unidades desconocidas admite ese grupo. Si hay más candidatos nuevos que
pendientes, no se elige arbitrariamente ninguno. Nunca se afirma que una fila
concreta sea idéntica a un ID del portal.

Antes de publicar, un control compara todos los grupos y exige igual número de
operaciones, participantes e importes, y la conservación exacta de cada fecha
conocida. Solo pueden disminuir las fechas desconocidas. El historial sigue sin
acreditar cobertura completa de la temporada. Las fechas recuperadas y su
evidencia se guardan en el mismo archivo privado e inmutable de cada ejecución;
se conserva el hash de la lectura, URL, fila, momento y snapshot de procedencia.
La verificación completa original mantiene su fecha y snapshot; las relecturas
parciales tienen sus propios tiempos y no renuevan la antigüedad de toda la base.

Cada ejecución admite hasta 20 fichas y dos minutos de trabajo de perfiles,
además de las comprobaciones del portal. Los pendientes nunca visitados se
priorizan; después, los comprobados hace más tiempo. No hay reintentos en bucle
dentro del mismo turno. Una ficha ausente, ambigua o con error conserva el dato
anterior y queda pendiente para otra ejecución. Un jugador nuevo fuera del
catálogo verificado queda pendiente sin ampliar ese catálogo. Un cambio de liga,
sesión o movimientos concurrentes mantiene el bloqueo de publicación original.

Se verifica el portal antes y después de las fichas. Una vez recuperadas todas
las fechas, ese paso no abre páginas. Una cláusula futura sin fecha vuelve a
activar la lectura de su jugador. Los horarios, OIDC, lease, exclusión mutua,
publicación atómica y modo test permanecen iguales. No necesita nuevas tablas,
migraciones, credenciales ni servicios.

Métricas: profileReads, profileDatesRecovered, profileDatesPending,
profileReadFailures y profileReadMs. El modo test guarda la evidencia privada y
mantiene la publicación anterior; después debe comprobarse la publicación sync
y la reutilización del archivo. Las pruebas sintéticas están en
tests/market-profile-refresh.test.cjs; el resultado real se registra en el PR de
entrega y la bitácora. No declarar una fecha recuperada antes de observarla.

## Verificación real del 16/11/2026

PR133, SHA c13b2844d4a5475779445997eb9db8e547736bca. Ambos controles CI
aprobados: 75 pruebas del lector/BD/interfaz/disparador y paginación Chromium.

- [Test 43900127968](https://github.com/ernestoperezfraga911024/Cuban-league/actions/runs/43900127968): terminó a las 10:49:42 Miami; dos fichas en 4.163 ms, una fecha recuperada y cero errores. La revisión pública anterior permaneció intacta.
- [Sync 43900969655](https://github.com/ernestoperezfraga911024/Cuban-league/actions/runs/43900969655): publicó a las 10:54:48 Miami, visible=true, 538 jugadores, 20 participantes, 445 cláusulas, 444 fechadas, cero gaps y aiCalls=0. Solo releyó la ficha aún pendiente, en 2.778 ms; Kubo mantuvo su fecha desde el archivo.

La fecha recuperada de **T. Kubo es 15/11/2026**, Yovany R9 a ANDOBA THE BEST,
10.598.000. Se compararon las 443 fechas anteriores y el multiconjunto completo
de jugador/partes/importes: idénticos. Revisión pública final:
642c37c4973466e4588e8a8b23235f993cea94352c565b6261ca8fcb0066079d.

**F. De Jong sigue sin fecha** para Arian Mirandez Li a Rivaldo, 2.952.000.
La lectura real mostró cinco movimientos, del 23/10 al 04/11; ninguno acredita
esa operación. Queda not_found y se conserva la fecha desconocida. Esto describe
la ventana observada, no demuestra que el dato sea inaccesible por cualquier
otra vista de Mister. No se usó la fecha de otro clausulazo ni de captura.

El reloj continúa enabled=true/sync con los cinco horarios. Estas dos ejecuciones
extraordinarias verifican lector y publicación; no prueban recurrencia futura.
