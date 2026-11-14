# Balón parado

Referencia por club dentro de Alineaciones probables, después de la plantilla y antes de las noticias. Incluye penaltis, faltas directas y faltas laterales. No recoge ni muestra córners.

## Fuentes y criterio

- Jornada Perfecta: https://www.jornadaperfecta.com/lanzadores/ aporta los candidatos de las tres categorías para los 20 clubes. Su orden visual no se interpreta como jerarquía.
- Comuniate: https://www.comuniate.com/lanzadores/penaltis aporta penaltis. Solo su marca explícita «Recomendación responsable» se presenta como «Preferencia de Comuniate». Los otros nombres se distinguen como lanzadores registrados, no como alternativas confirmadas.
- La coincidencia entre páginas significa «Citado en ambas fuentes», no una probabilidad. Si la preferencia de Comuniate no figura entre los candidatos de Jornada Perfecta, se muestra la discrepancia.
- Cada club se identifica por nombre explícito. Nunca se asigna por posición de la página o por el orden de los escudos. Un nombre de jugador solo se vincula al catálogo dentro de ese mismo club; una coincidencia ambigua conserva el nombre sin foto.
- Se muestran fechas de consulta por fuente. No se confunden con fechas de actualización del autor. Las lecturas de más de 48 horas o fallidas llevan aviso.

## Actualización y rendimiento

`.github/workflows/set-pieces.yml` verifica los tests y actualiza diariamente a las 12:37 UTC. También admite ejecución manual desde Actions. En pull requests solo verifica: no publica. No usa IA, API de Mister, nuevas dependencias ni secretos adicionales.

El proceso realiza dos descargas HTML compartidas por los 20 clubes mediante el lector existente. Valida equipos, categorías, fechas, identidades y duplicados antes de publicar. Conserva los datos y la fecha original de cualquier fuente que falle; si fallan ambas no escribe nada. Una modificación inesperada del HTML se trata como fallo, nunca como una lista vacía.

La salida se guarda exclusivamente en `set-pieces.json` de la rama `set-pieces-feed`, creada desde el commit de origen si aún no existe. Usa el SHA del archivo para evitar sobrescrituras concurrentes. No modifica `main`, las publicaciones de alineaciones, las noticias ni Supabase. La rama separada evita reconstruir GitHub Pages con cada consulta.

El navegador descarga el JSON público al abrir el desplegable, comparte una caché de cinco minutos entre clubes y conserva los datos en memoria ante un fallo. Si no existe una publicación accesible, usa `data/set-pieces.json` como respaldo con un aviso explícito. Ese respaldo es la lectura inicial, no se presenta como consulta recién realizada. El botón Actualizar vuelve a comprobar la publicación guardada; no dispara lecturas de terceros desde el navegador.

Las fotos proceden del catálogo existente. El componente es opcional y sus errores no deben impedir mostrar el once o las noticias. El JSON no se almacena en la caché del service worker.

## Validación y mantenimiento

```sh
node --test tests/set-pieces.test.cjs tests/forecast-context.test.cjs
node scripts/collect-set-pieces.cjs /tmp/set-pieces.json data/set-pieces.json
```

El segundo comando solo lee las fuentes y escribe el archivo local indicado. El publicador exige el repositorio y la rama `main` esperados, `GITHUB_SHA` y el token efímero de Actions.

El colector se detiene el 1 de julio de 2027 hasta revisar la siguiente temporada y sus clubes. Las correspondencias de apodos están limitadas al club y se mantienen en `scripts/set-pieces/parse.cjs`. No se introducen jugadores ni se cambian nombres/fotos en el catálogo original.

Para revertir la función, revertir este cambio y desactivar el nuevo workflow. No hay migraciones ni datos de la liga que revertir. La rama del feed puede conservarse como historial independiente.
