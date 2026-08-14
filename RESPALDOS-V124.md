# Respaldos de Cuban League V124

V124 usa dos capas distintas. Las copias rápidas permiten recuperar un error
desde Cuban Admin. Las copias externas cifradas protegen la liga si el proyecto
completo de Supabase deja de estar disponible.

## 1. Activar la restauración rápida

Hazlo en este orden: primero publica/carga los archivos V124 del repositorio y
después ejecuta el SQL. Al terminar, cierra y vuelve a abrir Cuban Admin en
todos los teléfonos y pestañas antes de editar. Una pestaña V123 no puede dañar
los datos, pero sus escrituras serán rechazadas hasta recargar.

1. Abre el proyecto de Cuban League en Supabase.
2. Entra en **SQL Editor**.
3. Abre `SUPABASE-V124-RESPALDOS-COPIAR-Y-PEGAR.txt` desde GitHub.
4. Copia todo el archivo, pégalo en SQL Editor y pulsa **Run** una sola vez.
5. Cierra y vuelve a abrir Cuban Admin para cargar V124.
6. Toca **Actualizar** dentro de Centro de respaldos.

Al instalarse se crea inmediatamente el primer respaldo. Después, Supabase
conserva automáticamente las últimas 7 copias diarias y 4 semanales. También
puedes crear copias manuales sin esperar al horario automático; se conservan
las 10 manuales y las 5 preventivas más recientes.

Las copias rápidas incluyen:

- jornadas publicadas de Liga y Champions;
- alineaciones, capitanes y partidos aplazados;
- borradores de estadísticas y alineaciones;
- fechas y cierres de premios, incluidos los cambios aún no publicados de una
  corrección;
- historial de publicaciones y correcciones.

No incluyen las visitas, los usuarios de Authentication ni las fotografías. El
catálogo, las fotos y el código ya conservan su historial en GitHub.

Si en el futuro vuelves a ejecutar V57, V59, V114 o V116, ejecuta V124 otra vez
al final: las migraciones antiguas vuelven a conceder acceso a las funciones
anteriores y V124 debe reinstalar sus protecciones de restauración.

## 2. Activar la copia externa cifrada

No escribas ninguno de estos valores en un archivo del proyecto, un mensaje o
una captura. Deben guardarse como secretos de GitHub.

### Secreto `SUPABASE_DB_URL`

1. En Supabase abre **Connect**.
2. Selecciona la conexión **Session pooler**, puerto 5432.
3. Copia la URL completa y reemplaza el marcador `[YOUR-PASSWORD]` por la
   contraseña real de la base de datos.
4. Si la contraseña contiene símbolos, utiliza la URL ya codificada que muestra
   Supabase o codifica esos caracteres para una URL.

### Secreto `BACKUP_ENCRYPTION_KEY`

Crea una clave verdaderamente aleatoria de al menos 32 caracteres. Lo
recomendado son 64 caracteres generados por un administrador de contraseñas;
no uses una frase inventada. Guarda una segunda copia fuera de GitHub: sin esta
clave nadie podrá descifrar los respaldos, ni siquiera GitHub.

### Guardarlos en GitHub

1. Abre el repositorio **Cuban-league**.
2. Entra en **Settings → Secrets and variables → Actions**.
3. Pulsa **New repository secret**.
4. Crea `SUPABASE_DB_URL` con la conexión de Supabase.
5. Crea `BACKUP_ENCRYPTION_KEY` con la clave aleatoria.
6. Entra en **Actions → Cuban League · Respaldo cifrado**.
7. Pulsa **Run workflow** para probarlo inmediatamente.

El workflow genera roles, esquema y datos por separado, calcula checksums
SHA-256, cifra el paquete, lo descifra en un área temporal para comprobar su
integridad y solo entonces lo guarda como artifact. Los archivos SQL sin cifrar
se limpian del runner. Se conserva una copia diaria durante 7 días y otra
dominical durante 28 días.

El repositorio principal es público. Por eso el artifact se cifra antes de
subirlo, pero cualquier persona podría descargar el archivo cifrado e intentar
un ataque fuera de línea. La protección depende de que la clave sea aleatoria,
larga y permanezca fuera del repositorio. Como mejora futura, se puede trasladar
la copia a un repositorio privado sin cambiar el respaldo interno.

Después de la primera ejecución comprueba que el workflow quede verde y descarga
el artifact una vez. Revisa Actions al menos semanalmente. Un checksum correcto
demuestra que el archivo no se corrompió; no sustituye una restauración de prueba
en un proyecto temporal, que conviene realizar una vez al mes.

GitHub puede desactivar los workflows programados de un repositorio público tras
60 días sin actividad. Si ocurre, abre **Actions**, entra en este workflow y
pulsa **Enable workflow**; el respaldo interno de Supabase continúa funcionando.

## 3. Restaurar un error normal

1. Entra en Cuban Admin.
2. Abre **Centro de respaldos**.
3. Localiza la fecha correcta y toca **Restaurar**.
4. Revisa la comparación entre los datos actuales y la copia.
5. Escribe `RESTAURAR` y confirma.

La operación es atómica: si cualquier parte falla, no se aplica ningún cambio.
Además, antes de sustituir los datos se crea una copia `Antes de restaurar` para
poder volver al estado anterior. Cuban Admin fuerza primero la sincronización
de la jornada abierta y pone en cuarentena los borradores locales previos de
este navegador. Además, Supabase cambia una generación de restauración común a
todos los dispositivos: si otro teléfono conserva abierta una versión vieja,
su autoguardado, publicación o acción «Deshacer» se rechazan y la jornada se
recarga antes de que pueda sobrescribir los datos recuperados.

La comparación también queda ligada a una revisión global de los datos. Si
otro teléfono guarda o publica algo después de abrirla, la confirmación se
detiene y obliga a revisar de nuevo el respaldo. Cada jornada usa además su
propio token persistente, por lo que dos móviles nunca pueden guardar,
publicar o deshacer silenciosamente uno encima del otro.

Las copias internas contienen los datos sincronizados con Supabase. V124 guarda
por separado la fecha y los premios todavía no publicados de una corrección, de
modo que también entren en las copias manuales, automáticas y preventivas sin
adelantarlos en la web pública.

## 4. Recuperación ante pérdida completa de Supabase

Esta restauración debe hacerse primero sobre un proyecto Supabase nuevo, nunca
directamente sobre producción.

1. Descarga el artifact cifrado desde GitHub Actions. GitHub entrega un ZIP
   contenedor; descomprímelo para obtener
   `cuban-league-AAAAMMDDTHHMMSSZ.tar.gz.enc`.
2. Descífralo usando exactamente la misma `BACKUP_ENCRYPTION_KEY`.
3. Verifica `SHA256SUMS`.
4. En el proyecto nuevo habilita `pgcrypto` y `pg_cron` y aplica privilegios
   predeterminados seguros.
5. Restaura `roles.sql`, `schema.sql` y `data.sql` en una sola transacción.
6. Ejecuta otra vez `SUPABASE-V124-RESPALDOS-COPIAR-Y-PEGAR.txt` para recrear
   las dos tareas de cron, rotar las generaciones de seguridad y crear el
   primer respaldo interno. Esa rotación impide que un borrador local creado
   después del artifact vuelva a inyectar datos anteriores.
7. Crea nuevamente el usuario administrador en Supabase Authentication y
   registra su UUID en `private.league_admins`.
8. Comprueba cantidades, las dos tareas llamadas
   `cuban-league-daily-backup` y `cuban-league-weekly-backup`, acceso del
   administrador, RLS y la web pública.
9. Solo después cambia `supabase-config.js` para apuntar al proyecto recuperado.

Comandos de inspección y restauración para un proyecto temporal:

```bash
artifact_dir="$(mktemp -d)"
restore_dir="$(mktemp -d)"
unzip cuban-league-daily-*.zip -d "$artifact_dir"

read -rsp 'Clave de cifrado: ' BACKUP_ENCRYPTION_KEY
export BACKUP_ENCRYPTION_KEY
echo
read -rsp 'URL de la base temporal: ' NEW_SUPABASE_DB_URL
export NEW_SUPABASE_DB_URL
echo

openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 \
  -in "$artifact_dir/cuban-league-AAAAMMDDTHHMMSSZ.tar.gz.enc" \
  -out Cuban-League-Backup.tar.gz \
  -pass env:BACKUP_ENCRYPTION_KEY

tar -C "$restore_dir" -xzf Cuban-League-Backup.tar.gz
(cd "$restore_dir" && sha256sum -c SHA256SUMS)

psql "$NEW_SUPABASE_DB_URL" <<'SQL'
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;
alter default privileges in schema public revoke all on tables from anon, authenticated;
SQL

psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$restore_dir/roles.sql" \
  --file "$restore_dir/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$restore_dir/data.sql" \
  --dbname "$NEW_SUPABASE_DB_URL"

unset BACKUP_ENCRYPTION_KEY NEW_SUPABASE_DB_URL
rm -f Cuban-League-Backup.tar.gz
rm -rf "$artifact_dir" "$restore_dir"
```

Los dos directorios se crean con `mktemp` y se eliminan al terminar para que no
queden copias SQL sin cifrar en el equipo usado para la recuperación.

Después de una recuperación en un proyecto nuevo, los campos históricos
`saved_by`, `changed_by` y `undone_by` pueden apuntar al UUID del administrador
anterior. Se pueden dejar como referencia histórica o ponerlos en `null` antes
de volver a validar los datos. La restauración rápida de V124 ya convierte en
`null` automáticamente las referencias a usuarios que no existan.
