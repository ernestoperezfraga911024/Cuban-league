# Revisión privada de alineaciones

Segunda etapa del piloto Real Madrid–Celta. PR independiente desde main;
depende del esquema privado ya instalado y documentado en PR #75, no de
fusionar sus archivos. No modifica jornadas, catálogo ni predicciones guardadas.

## Recorrido

Administrador → Herramientas → Alineaciones probables. Reutiliza la sesión y
la verificación `is_league_admin` del panel. Abrir el apartado hace una consulta
de resúmenes (máximo 20); el detalle solo se descarga para la versión seleccionada
y la anterior comparable. Sin sondeo, investigación web ni escrituras desde UI.
Cerrar y abrir reutiliza la memoria; Recargar invalida esa memoria y vuelve a leer.
Al salir o perder autorización se vacían DOM, selectores y caché; respuestas
pendientes de otra sesión o selección se descartan. No usa almacenamiento local.

Un intento bloqueado no dibuja un once ni lo sustituye silenciosamente por uno
antiguo. Permite elegir la versión válida anterior, con sus fechas originales.
Las comparaciones solo aceptan equipo y partido iguales, nunca rellenan datos.
Las fechas visibles indican Madrid; consulta y actualización de fuente se muestran
por separado. Los nombres, motivos y enlaces se representan sin interpretar HTML.

El campo muestra un 4-2-3-1 esquemático. Los registros antiguos no tienen coordenadas;
se reconoce el doble pivote de este piloto por identidad. No es posición de tracking
ni clasificación de Mister. Menos de 70 muestra alternativa; desde 70, solo principal.
Tocar un jugador muestra su razón y, si existe, el desglose del método.

## Método reproducible editorial-v1

No es un modelo estadístico entrenado, no acredita precisión ni transforma votos
en probabilidades. Los siguientes pesos son decisiones editoriales iniciales,
conservadoras y **sin calibración**. Su utilidad inmediata es impedir que una misma
evaluación estructurada produzca porcentajes diferentes entre ejecuciones.
La clasificación de la evidencia sigue necesitando juicio editorial.

Cada jugador añade `assessment` al contrato existente. Cada factor requiere
`value`, `reason` y `refs` (URLs HTTPS de evidencias). `confirmed_out` debe ser
explícitamente false: un jugador con baja confirmada se retira de la propuesta,
no se mantiene con una probabilidad ficticia. Un dato desconocido no es una baja.

| Factor | Valores y puntos |
|---|---|
| role | established 85; preferred 75; contested 55 (base) |
| availability | clear 0; concern −15; unknown −10 |
| rotation | low 0; possible −10; high −20 |
| agreement | consistent 0; disputed −10 |
| quality | primary 0; secondary −5; limited −10 |
| horizon | near 0; medium −5; distant −10 |

Resultado: suma entera, limitada a 5–90. Sin porcentajes de 100, medias de medios,
normalización entre alternativas ni bonificación por varias noticias del mismo
origen. `established` exige continuidad sustentada por evidencia verificable;
`preferred` ventaja razonada; `contested` competencia abierta. `clear` necesita
disponibilidad apoyada por evidencia; ausencia de noticias no basta. `low` exige
revisión de cargas/contexto; si faltan datos, documentar `possible`. `primary`
requiere evidencia original pertinente; una noticia que cita a otra no basta.
`limited` incluye falta de fecha editorial o información incompleta. `consistent`
describe compatibilidad entre propuestas, no independencia estadística.

Horizonte desde la fecha de la evidencia deportiva relevante hasta el partido:
near ≤48h, medium >48h y ≤120h, distant >120h. La razón debe registrar ambas
fechas; repetir una consulta no renueva esa evidencia. Fecha de actualización
desconocida se mantiene null y limita la calidad. Si aparece evidencia nueva,
se registran nuevos motivos/referencias; si cambia la rúbrica, nueva versión de
método. Nunca se retocan filas antiguas.

Ejemplo de un factor: `"availability":{"value":"concern","reason":"Molestias
reportadas; no hay baja confirmada para este partido","refs":["https://…"]}`.
Para preparar un futuro borrador con todos los factores explícitos:

```sh
node scripts/prepare-forecast.cjs borrador-con-evidencia.json
```

Imprime JSON; no guarda, publica ni consulta webs. Rechaza inputs incompletos,
once/formación inválidos o alternativas ausentes cuando el resultado baja de 70.
El guardado posterior sigue pasando por el validador SQL del piloto. Los dos
borradores existentes NO contienen esa evaluación estructurada y conservan sus
porcentajes bajo la etiqueta «Estimación original del piloto». No se inventa
evidencia ni se muestra una recalificación retrospectiva como noticia nueva.

## Acceso y despliegue

`migration.sql` está **pendiente de aplicar después de revisar el PR**.
Se ha probado dentro de una transacción con ROLLBACK sobre el esquema existente.
No reaplicar la creación del piloto de PR #75.

Una RPC pública SECURITY INVOKER llama a una función privada SECURITY DEFINER
con search_path vacío, nombres cualificados y comprobación de auth.uid más la
lista real de administradores. Solo authenticated puede ejecutar; el rol por sí
solo no autoriza. Anon y service_role no tienen ejecución. Nadie obtiene permisos
directos nuevos sobre la tabla ni la función save_draft. El definer es necesario
para leer el esquema cerrado sin otorgar acceso general al navegador.

1. Revisar y aplicar `migration.sql` una vez, en una transacción administrativa.
2. Verificar acceso del administrador y rechazo de otros roles.
3. Integrar el frontend mediante el PR revisado y verificar inicio de sesión real.

Sin migración, el apartado informa que no está habilitado; las otras herramientas
siguen funcionando. Reversión: revertir frontend y ejecutar `rollback.sql`.
Conserva todos los borradores. No modifica esquema, claves ni configuración de USATAX.

## Verificación y rendimiento

- `node --test tests/*.test.cjs`: incluye permisos de UI, respuestas tardías,
  bloqueo, reintento, comparación, XSS y método reproducible, además de regresiones.
- DB: concatenar BEGIN + migration.sql + tests/forecast-review-db.sql. Termina en
  ROLLBACK; comprueba JWT ausente, no administrador, helper directo, privilegios,
  lectura del administrador, límites y clave inválida.
- `node scripts/check-forecast-browser.cjs`: Chrome local con RPC sintética,
  todas las solicitudes externas bloqueadas; escritorio 1280 y móvil 390,
  once visible, detalles y ausencia de desbordamiento. No sustituye una sesión
  autenticada contra la futura RPC instalada.
- Cero consultas del módulo al iniciar sesión o desde la página pública.
  Primera apertura: lista + detalle (+ anterior si existe). Límite por detalle
  ya existente: 64 KiB. No nuevos servicios, imágenes ni librerías de producción.
- Se conserva el hash del código anterior de administración al retirar únicamente
  los cuatro puntos de integración aprobados. No cambios a cálculos públicos.

No incluye edición, publicación, nuevos equipos, tareas diarias, servicios de pago
ni afirmaciones de precisión deportiva. El siguiente paso será revisar esta
etapa y verificar la lectura autenticada real antes de ampliar el alcance.

## Resultado de esta revisión (11/11/2026)

- Suite general: 189/190; único fallo en el hash histórico de catalog/players.json.
  Reproducido en el checkout anterior sin cambios del módulo. Catálogo sin modificar.
  Esperado antiguo: 5c5a08bbef9cd69ac118736904d160a630cc5d5d41bcf8180e6b5b61b217be4b;
  actual de main: b32ea7462eef71107c6a7c4d943a636fb95b11d2a41279bf1fc857f8c52ae0ec.
- Pruebas específicas finales: 10/10, incluido contrato completo del admin de main.
- Navegador: 390px y 1280px; 11 jugadores, sin desbordamiento; dos RPC de lectura
  para una versión sintética y ninguna petición externa.
- SQL transaccional: acceso permitido/rechazado y límites verificados, ROLLBACK
  comprobado. Ambas funciones nuevas siguen ausentes en producción y los dos
  hashes de borradores coinciden antes/después.
- Archivos nuevos de interfaz: 17.6 kB sin comprimir; 6.2 kB gzip medidos localmente
  (la transferencia real depende del servidor). Solo los solicita admin.html.
