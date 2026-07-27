# Cuban League V44

Sitio oficial de la Cuban League con:

- Clasificación 2026/27 con jornadas, puntos, goles y clean sheets.
- Centro de Jornada con selector, podio semanal, líderes, movimientos,
  promedio, récord y archivo de todas las jornadas publicadas.
- Movimiento en la clasificación y forma de las últimas cinco jornadas.
- Panel privado para registrar y publicar cada jornada desde el celular.
- Actualización automática de la clasificación mediante Supabase.
- Archivo histórico por temporadas y perfiles completos.
- Rankings, palmarés, récords, Champions y noticias.
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
  de cada jornada de Champions sin mezclarlos con los datos de la liga.
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

## Panel privado

Después de configurar Supabase, el administrador entra mediante `admin.html`.
Los borradores permanecen privados; la web pública solamente consulta jornadas
marcadas como publicadas.

La contraseña y las reglas de acceso se administran exclusivamente en Supabase.
