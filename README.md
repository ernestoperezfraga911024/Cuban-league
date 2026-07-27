# Cuban League V56

Sitio oficial de la Cuban League con:

- Clasificación 2026/27 con jornadas, puntos, goles y clean sheets.
- Zona de descenso dinámica: los puestos 16 al 20 quedan resaltados en rojo y
  se actualizan automáticamente después de cada jornada.
- Centro de clasificación con selector entre tabla general, ranking de
  goleadores y ranking de clean sheets, todos actualizados automáticamente.
- Vista Jornada dentro de Clasificación, con selector de todas las fechas
  publicadas y tabla independiente de puntos, goles y clean sheets por jornada.
- Museo Histórico rediseñado con podio dinámico, tablas reales de filas y
  columnas, posiciones destacadas y archivo de campeones.
- En el celular las tablas históricas conservan sus encabezados y las columnas
  de posición y jugador permanecen visibles mientras se desplazan.
- El ranking histórico elimina el Score y se ordena de forma transparente por
  títulos, podios, Top 5 y puntos acumulados.
- La portada elimina el bloque decorativo de “Fútbol y datos” para dar prioridad
  al estado de la temporada, los accesos rápidos y el contenido dinámico.
- Sección Historia unificada: Temporadas, Histórico y Récords viven ahora en un
  mismo espacio con navegación interna clara y accesos compatibles.
- Centro de Jornada con selector, podio semanal, líderes, movimientos,
  promedio, récord y archivo de todas las jornadas publicadas.
- Movimiento en la clasificación y forma de las últimas cinco jornadas.
- Panel privado para registrar y publicar cada jornada desde el celular.
- Actualización automática de la clasificación mediante Supabase.
- Archivo histórico por temporadas y perfiles completos.
- Rankings, palmarés, récords, Champions y noticias.
- Tablas horizontales de Champions adaptadas al celular con J1–J8, puntos,
  goles y clean sheets, sin espacio sobrante al terminar el desplazamiento.
- Aplicación web instalable en la pantalla de inicio.
- Portada minimalista premium con estadio nocturno, accesos rápidos y resumen
  automático de la temporada.
- Sistema visual minimalista unificado en clasificación, jornadas, temporadas,
  participantes, museo histórico, récords, Champions, noticias y perfiles.
- Pulso dinámico en la portada con pretemporada, Top 5, MVP de jornada, líderes
  de goles y clean sheets y mayor subida en la clasificación.
- Libro de Récords reorganizado con resumen del archivo, categorías, tarjetas
  compactas y un Salón de la Fama editorial optimizado para móvil.
- Grupos oficiales de Champions con cuatro grupos de cinco competidores, fase
  de ida y vuelta, casillas J1–J8 y total automático por participante.
- Control privado independiente para registrar, guardar y publicar los puntos
  goles y clean sheets de cada jornada de Champions sin mezclarlos con la liga.
- Centro de tarjetas oficiales para WhatsApp con Podio de Jornada, Top 10,
  líderes de temporada y tabla de cada grupo de Champions.
- Generación automática en PNG de 1080 × 1350 con fotos, nombres y estadísticas,
  además de descarga directa y menú nativo para compartir desde el celular.
- La tarjeta de podio incluye promedio, máximo goleador y líder de clean sheets
  de la jornada, evitando repetir los puntos del ganador como récord.
- La portada muestra cinco tarjetas dinámicas: primero, segundo, tercero, líder
  goleador y líder de clean sheets. Durante la pretemporada conserva el podio
  final de 2025/26 y cambia automáticamente a 2026/27 tras la Jornada 1.
- El bloque de líderes adopta un podio vertical premium: campeón elevado en el
  centro, segundo y tercero a los lados, con goleador y clean sheets debajo.
- El podio se presenta directamente sobre el fondo, sin un marco exterior,
  para ganar espacio y conservar solamente las tarjetas individuales.
- Récord dinámico de mayor puntuación en una sola temporada, calculado desde el
  archivo histórico y acompañado por el jugador, la cifra y la temporada.

## Panel privado

Después de configurar Supabase, el administrador entra mediante `admin.html`.
Los borradores permanecen privados; la web pública solamente consulta jornadas
marcadas como publicadas.

La contraseña y las reglas de acceso se administran exclusivamente en Supabase.
