# Cuban League V33

Sitio oficial de la Cuban League con:

- Clasificación 2026/27 con jornadas, puntos, goles y clean sheets.
- Panel privado para registrar y publicar cada jornada desde el celular.
- Actualización automática de la clasificación mediante Supabase.
- Archivo histórico por temporadas y perfiles completos.
- Rankings, palmarés, récords, Champions y noticias.
- Aplicación web instalable en la pantalla de inicio.

## Panel privado

Después de configurar Supabase, el administrador entra mediante `admin.html`.
Los borradores permanecen privados; la web pública solamente consulta jornadas
marcadas como publicadas.

La contraseña y las reglas de acceso se administran exclusivamente en Supabase.
