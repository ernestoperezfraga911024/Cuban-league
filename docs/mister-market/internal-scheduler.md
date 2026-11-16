# Reloj interno de mercado

El reloj de Supabase solicita el workflow existente en GitHub. Mantiene las
04:00, 09:00, 13:00, 17:00 y 21:00 de America/New_York, incluido horario de verano.
No lee Mister, usa IA ni cambia datos deportivos. El lector sigue ejecutándose
en GitHub, con su identidad OIDC, sesión sellada, lease y publicación atómica.

## Estado de esta entrega

Implementación preparada y pruebas locales; **no activada**. La configuración
nace deshabilitada y en modo `test`. No se ha instalado una credencial de GitHub.
El éxito del 16/11 a las 04:05 Miami corresponde al cron nativo anterior, no a
este disparador. No se da por resuelta la incidencia hasta verificar recorridos
reales del reloj nuevo.

## Funcionamiento y límites

Un job SQL privado se despierta cada minuto. Resuelve el último turno mediante
el reloj real de la base y la zona de Miami; no admite fechas de ejecución
proporcionadas por clientes. Solo trabaja durante los primeros 90 minutos de
ese turno. No reproduce todos los turnos perdidos tras una interrupción.

Cada turno y modo tiene una fila única. Cada solicitud tiene un UUID asociado
al turno y registrado antes de salir. Una solicitud aceptada (HTTP 200/204) no
equivale a un inicio ni a una publicación. Se guardan únicamente metadatos
controlados de la respuesta, nunca su cuerpo ni credenciales. El worker confirma
inicio y final en la misma base. Un final confirmado sobrevive a una respuesta
perdida; no se vuelve a publicar.

Como máximo se encolan tres solicitudes por turno, separadas al menos diez
minutos. Un worker con lease vigente detiene nuevos despachos. Una solicitud
duplicada o tardía se salta antes de leer Mister si el turno está completo u
ocupado. Las solicitudes que llegan después de 90 minutos no se ejecutan. El
lease y los validadores originales siguen rechazando publicaciones de trabajos
vencidos. Si GitHub está indisponible o no proporciona un runner, este reloj no
puede garantizar puntualidad ni éxito.

El cron nativo de GitHub permanece como respaldo. Con el reloj interno activo
en `sync`, cualquier evento nativo solo puede reclamar el turno actual pendiente
dentro de su ventana; usa la misma clave única. Un evento antiguo no reabre su
turno original. En modo de prueba no se cambia el cron nativo ni su publicación.
Las ejecuciones manuales sin `dispatch_id` conservan el funcionamiento existente.

## Activación por etapas

1. Revisar/fusionar los archivos de workflow y worker; desplegar la función
   `mister-market-sync` actualizada conservando `verify_jwt=false` porque verifica
   explícitamente el token OIDC. Aplicar la migración nueva. No volver a aplicar
   las migraciones anteriores ni modificar la sesión de Mister.
2. Crear una credencial GitHub **fine-grained** limitada al repositorio
   `ernestoperezfraga911024/Cuban-league`, con **Actions: read and write** y
   Metadata de lectura. No necesita permiso de escritura de código. Darle una
   fecha de vencimiento conocida. Guardarla directamente mediante la interfaz
   privada de Supabase Vault con nombre `mister_market_github_dispatch_token`.
   No pegarla en el chat, repositorio, archivos ni consultas SQL visibles.
3. Con `dispatch_mode='test'`, habilitar `scheduler_config.enabled` en una ventana
   real de un turno. Verificar `scheduler_attempts`, el run de GitHub y el estado
   `tested` en `worker_runs` y `scheduler_slots`. Este modo conserva la publicación
   previa. Comparar su revisión y sus fechas antes/después.
4. Después de comprobar la prueba real, cambiar `dispatch_mode='sync'`. Verificar
   una publicación y después un turno posterior iniciado por el cron interno,
   sin intervención manual. `tested` tiene otra clave de modo y nunca cuenta
   como `published`. Revisar SHA, cantidades, gaps, fechas y tiempo real.
5. Mantener el incidente abierto hasta acreditar recurrencia. Revisar los
   intentos agotados y la caducidad de la credencial en el panel; no se crean
   mensajes ni alarmas externas en esta entrega.

Lecturas de diagnóstico (solo operador):

```sql
select enabled, dispatch_mode, last_tick_at, last_error
from mister_market.scheduler_config;
select scheduled_for, mode, status, worker_run, started_at, completed_at, error_code
from mister_market.scheduler_slots order by scheduled_for desc limit 10;
select slot_id, requested_at, request_id, response_at, http_status, github_run_id, error_code
from mister_market.scheduler_attempts order by requested_at desc limit 20;
```

## Reversión

Poner `mister_market.scheduler_config.enabled=false`. El job deja de hacer HTTP,
los despachos pendientes se saltan y el cron nativo/manual sigue disponible.
Un worker que ya comenzó conserva su lease y puede terminar. Mantener tablas,
archivos y bitácoras para auditoría; no hace falta borrar datos ni restaurar
publicaciones. Para parar también las publicaciones existentes se usa el control
separado `worker_config.enabled`, como antes.

## Fechas de clausulazos

La fecha del traspaso procede de `occurredOn` en los movimientos del perfil;
`capturedAt`/`firstSeenAt` solo registran cuándo lo leyó el programa. Este cambio
no reemplaza ni recalcula esas fechas. La prueba compara las filas históricas
antes y después de publicar por el nuevo gate. En la lectura de producción del
16/11 se observaron 443 cláusulas fechadas de 445 documentadas. Las dos sin fecha
siguen siendo desconocidas: este disparador no las inventa ni añade un lector
nuevo de perfiles. La ampliación para recuperar fechas faltantes debe contrastar
el detalle real del jugador y conservar multiplicidad y evidencia.

## Dependencias y seguridad

Se reutilizan GitHub Actions y el proyecto Supabase existente. No hay servicio
nuevo, cambio de plan ni API de IA. El job SQL, las tablas y las funciones internas
no tienen permisos para anon/authenticated/service_role. RLS permanece activado.
El RPC público del worker conserva acceso exclusivo para service_role detrás
del verificador OIDC. Vault y la cola HTTP no se exponen al cliente.

Referencias: [Supabase Cron](https://supabase.com/docs/guides/cron),
[pg_net](https://supabase.com/docs/guides/database/extensions/pg_net),
[GitHub workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
