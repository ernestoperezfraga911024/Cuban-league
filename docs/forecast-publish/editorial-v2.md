# Lectura editorial v2 y vista compacta

El método v1 acumulaba descuentos por rol, disponibilidad, rotación, acuerdo,
calidad y antelación. Podía convertir una preferencia compartida en un porcentaje
demasiado bajo. Se conserva para interpretar el historial, pero las nuevas
lecturas deben usar `editorial-v2`.

## Cálculo reproducible, sin calibración demostrada

- 80%: media de las señales de FútbolFantasy, Jornada Perfecta y Comuniate,
  con el mismo peso dentro del bloque. No hay evidencia para afirmar que una
  de ellas tenga mejor precisión que las otras.
- Si una fuente publica un porcentaje de titularidad, se registra ese número.
  Si no lo publica, `probability:null` distingue el dato ausente. Se convierte
  su observación en una **señal editorial**, no un porcentaje atribuido al medio:
  titular 90, alternativa 40, no incluido en el once 25. Ausencia del once no
  significa lesión, cero minutos ni ausencia de la convocatoria.
- 20%: rol/continuidad. Se usa frecuencia de titularidades cuando está verificada;
  en otro caso se documenta explícitamente una valoración editorial del rol.
- Disponibilidad: sin alerta 0, duda -8, desconocida -4. Rotación: baja 0,
  posible -3, alta -8. No volver a descontar una disputa ya contenida en las
  señales. Cada ajuste exige motivo y referencias.
- Antelación: hasta 48 h, 0; hasta 120 h, -1; más de 120 h, -2. Máximo 90
  cuando falta más de cinco días, 95 después. Mínimo 5. Redondeo al entero.
- Contexto específico: entre -10 y +10, con motivo y referencias. No sustituye
  una fuente ausente. Una baja confirmada impide proponer al jugador.

Esta escala y estos pesos son decisiones editoriales provisionales. No son un
modelo calibrado ni prometen porcentajes de acierto. No convertir tres menciones
en 100%, sumar puestos hasta 100%, o interpretar una opción desde el banquillo
como titularidad. Las alternativas bajo 70 siguen siendo obligatorias y deben
estar fuera de los once. Desde 70, `alternative:null`.

`forecast-source-method.js` calcula la versión nueva; `forecast-review-core.js`
despacha por versión sin alterar v1. `source-weighted.sql` sustituye solamente
los auxiliares puros `forecast_publish.assess` y `forecast_publish.build`.
Mantiene SECURITY INVOKER y sus permisos privados. No cambia tablas, políticas,
roles, autenticación, comandos, vigencia, límites ni datos históricos. La
construcción pública vuelve a comprobar cálculo, antelación y coincidencia con
las observaciones de cada fuente conservadas en el borrador.

La base guarda el método v2 solo si la revisión coincide con el borrador; una
edición posterior sigue identificándose como revisión manual. Las observaciones
completas quedan privadas. La publicación incluye los motivos propios, fuentes
y fechas habituales. Guardar no publica.

## Presentación

Selector con el escudo local del Real Madrid, único equipo del piloto. Cabecera
del partido con los dos escudos, tipografía menor, fotos del catálogo y campo
compacto. Ancho máximo de tarjeta 880 px; explicación al lado en escritorio y
debajo en móvil. Contexto y fuentes desplegables. Se conserva la navegación por
teclado, foco, estados de error/retirada y carga al entrar en el apartado.
No se incorporan librerías, imágenes externas nuevas ni peticiones adicionales
al seleccionar un equipo ya cargado.

## Verificación

- 28 pruebas específicas; 208/209 generales. El único fallo general es el hash
  histórico del catálogo, previo al cambio. El catálogo y esa comprobación no
  se modifican.
- Chrome con respuestas sintéticas: 320, 390, 768 y 1280 px, once fotos,
  escudos, selector sin otra consulta, detalle, guardado, vista previa,
  confirmación y cierre de sesión. No se publica contenido real en la prueba.
- SQL dentro de una transacción revertida: v1 intacto, cálculo v2, rechazo de
  duplicados/fuentes ajenas/datos incompletos/baja confirmada y discrepancias
  entre observación y evaluación; permisos privados conservados.
- Nueva lectura real guardada el 11/11/2026 a las 19:00:25Z en
  `pilot-interactive-20261111-madrid-celta-editorial-v2`, tres fuentes y once
  jugadores, `publication_allowed=false`. Su payload no se incorpora a GitHub.

Para usarla: abrir el último borrador en administración, editar, guardar la
revisión privada, revisar la vista previa y confirmar la publicación. La
publicación anterior conserva sus cifras hasta esa acción del administrador.
No hay actualizaciones programadas ni ampliación a otros equipos.

Reversión de interfaz: revertir el PR. Si ya se publicó v2, conservar su lector
en la interfaz o restaurar primero una publicación compatible y vigente mediante
el control existente. No borrar historial. Para revertir solo los auxiliares,
usar las definiciones originales `assess` y `build` como CREATE OR REPLACE;
esto impediría preparar nuevas revisiones v2, pero no cambia las guardadas.
