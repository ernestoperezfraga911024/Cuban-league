# Reloj interno de mercado

El reloj de Supabase solicita el workflow existente en GitHub. Mantiene las
04:00, 09:00, 13:00, 17:00 y 21:00 de America/New_York, incluido horario de verano.
No lee Mister, usa IA ni cambia datos deportivos. El lector sigue ejecutándose
en GitHub, con su identidad OIDC, sesión sellada, lease y publicación atómica.

## Estado de esta entrega

**Activado en producción el 16/11/2026**, enabled=true y dispatch_mode=sync.
PR131 integrado en b951a3780d99c797aab6dd3fe5eafdfa61e2d9cc; migración instalada,
Edge Function versión 2 desplegada y job privado cada minuto. Credencial limitada
a Actions de este repositorio guardada en Vault; vence el **14/02/2027** y debe
renovarse antes de esa fecha manteniendo el mismo alcance.

El cron interno, sin ejecutar scheduler_tick manualmente, solicitó ambos trabajos:

- Prueba [43894481782](https://github.com/ernestoperezfraga911024/Cuban-league/actions/runs/43894481782): solicitud 10:16:00 Miami, HTTP200, worker 10:16:42–10:18:51,
  resultado tested, 538 jugadores, 20 participantes, 396 eventos acumulados,
  445 cláusulas, 0 gaps y aiCalls=0. Lectura 130.417 ms.
  La revisión pública anterior permaneció intacta.
- Publicación [43895193458](https://github.com/ernestoperezfraga911024/Cuban-league/actions/runs/43895193458): solicitud 10:20:00 Miami, HTTP200, worker 10:20:50–10:22:52,
  resultado published y visible=true, 538 jugadores, 20 participantes,
  396 eventos, 445 cláusulas, 0 gaps y aiCalls=0. Lectura 121.730 ms.
  Revisión 30466300a4dc005e917e6fd61b4ce404227002adce636769607fbb9e1ff804b1.

El hash íntegro del historial (fechas, partes e importes) siguió siendo
1c0ac3fe60dea302f88507f2b42365d47f794c6b489dad3d6060e6641dba053f.
En esa activación conservó 443 cláusulas fechadas y dos desconocidas; no se inventaron fechas.
Ambas ejecuciones pertenecen a la ventana real del turno de 09:00; la activación
ocurrió después de esa hora. Acreditan el recorrido del disparador, **todavía no
la recurrencia de un turno posterior**. Próximo turno: 16/11/2026 13:00 Miami.
Mantener la incidencia abierta hasta verificar esa recurrencia; no se promete
puntualidad garantizada ni vigilancia externa.

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

La fecha procede de occurredOn en el detalle del perfil; capturedAt/firstSeenAt
solo indican cuándo se leyó. El disparador no reemplaza ni recalcula fechas.
Al activar el reloj se conservaron 443 fechas de 445 cláusulas. La posterior
[relectura selectiva de perfiles](profile-date-refresh.md) quedó incorporada y
publicada mediante PR133 el 16/11/2026 a las 10:54:48 Miami: 444 fechas de 445,
Kubo recuperado (15/11/2026) y De Jong pendiente porque la operación antigua
no apareció entre los cinco movimientos observados en su ficha. Las 443 fechas
anteriores, todos los participantes, importes y conteos permanecieron intactos.

## Dependencias y seguridad

Se reutilizan GitHub Actions y el proyecto Supabase existente. No hay servicio
nuevo, cambio de plan ni API de IA. El job SQL, las tablas y las funciones internas
no tienen permisos para anon/authenticated/service_role. RLS permanece activado.
El RPC público del worker conserva acceso exclusivo para service_role detrás
del verificador OIDC. Vault y la cola HTTP no se exponen al cliente.

Referencias: [Supabase Cron](https://supabase.com/docs/guides/cron),
[pg_net](https://supabase.com/docs/guides/database/extensions/pg_net),
[GitHub workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
