# Prueba desde el celular

Esta configuración prepara un escritorio temporal en GitHub Codespaces. El iPhone muestra el escritorio; el programa se ejecuta en Codespaces. **No es todavía el programador de las 04:00 y 17:00 ni publica datos.**

Antes de crear el entorno, comprobar la cuota incluida y el presupuesto de Codespaces en GitHub. Mantener bloqueado el gasto de pago. No añadir una tarjeta ni subir el presupuesto para completar esta prueba.

## Preparación

Crear el Codespace del repositorio Cuban-league, rama `feature/mister-market-reader`, seleccionando la configuración **Mister · prueba desde el celular** y la máquina más pequeña disponible. No activar prebuilds.

La preparación instala Playwright y Chromium desde sus distribuidores oficiales. Al abrir el editor se lanza una ventana de Mister, salvo que ya exista una sesión guardada o un proceso bloqueado. No comparte cookies con ChatGPT ni con Safari.

## Iniciar sesión

1. En **Ports**, comprobar que el puerto **6080** figure como **Private**, y abrir su enlace. Debe estar protegido por tu inicio de sesión en GitHub. Nunca cambiarlo a Public ni compartirlo con terceros.
2. En el escritorio web de noVNC, pulsar **Connect**. En la prueba de Codespaces se conectó sin un segundo formulario de contraseña; la protección externa es el acceso privado de GitHub. Si otra instalación solicita la contraseña predeterminada de desktop-lite, es `vscode`, distinta de la de Mister o GitHub. Mantener siempre el puerto Private.
3. Dentro de la ventana de Mister, iniciar sesión y seleccionar la **primera división de Cuban League**. El programa espera hasta 60 minutos y guarda su sesión privada cuando confirma la comunidad correcta. No hace falta volver a una terminal para pulsar Enter.
4. Para verlo cómodo en el celular, usar **Settings → Scaling mode → Remote resizing** en noVNC. La ventana de entrada se abre maximizada y adapta su contenido al escritorio; la lectura automática conserva su tamaño fijo.
5. La ventana del programa se cierra al terminar. La sesión se guarda únicamente en `.mister-market/auth.json`, excluida de Git. No copiar ese archivo al chat, a commits o a artefactos de Actions.

Si el inicio de sesión caduca o la ventana se cierra antes, desde la terminal del Codespace se puede iniciar otra prueba con:

```sh
npm --prefix scripts/mister-market run login-mobile
```

No se sortean CAPTCHA, rechazos de acceso ni verificaciones de Mister. Si una verificación requiere intervención, la completa Ernesto.

## Lectura y cierre

Una vez autenticado:

```sh
npm --prefix scripts/mister-market run collect
```

El resultado sigue siendo local y de solo lectura. Verificar las plantillas y la cobertura de movimientos antes de cualquier integración con la página. El código de lectura no invoca IA; la asistencia por ChatGPT durante esta preparación sí consume usage.

Al terminar, **detener el Codespace** desde GitHub para que deje de consumir tiempo de ejecución. El almacenamiento sigue contando mientras exista. No usarlo como servidor permanente ni prometer disponibilidad cuando esté detenido; el horario futuro se configurará por separado.

Estado de validación del 15/11: acceso manual de GitHub comprobado; 19 pruebas sintéticas aprobadas localmente y en Actions. El primer Codespace con imagen universal permaneció en «Opening Remote / Building codespace» y terminó en modo de recuperación. El registro de creación identificó la causa: `no space left on device` al extraer `torch/lib/libtorch_cpu.so` de la imagen universal. En ese primer intento el escritorio 6080 no estuvo disponible.

Se cambió a la imagen oficial de Node 22 y se eliminó la instalación redundante de Node. La regresión de configuración impide volver a la imagen universal en esta prueba. Se actualizó el mismo Codespace mediante fast-forward y se solicitó **Full Rebuild**, que conserva el código y limpia las imágenes en caché. La reconstrucción posterior sí arrancó: se verificó el puerto 6080 como Private, la conexión a noVNC y una ventana de Chromium abierta en Mister. Posteriormente se confirmó la sesión propia y la primera lectura real descrita al final de esta guía. No hay publicación validada. El código está conservado en el PR #119.

Para otra espera larga, leer primero el registro de creación; no atribuirla a Mister ni crear máquinas adicionales. Si está en recuperación, corregir la causa y reconstruir el mismo entorno. Al terminar o bloquearse la prueba, detenerlo y comprobar el estado. GitHub puede rechazar detenerlo mientras está construyéndose; nunca informar que se detuvo sin verificarlo.

La instalación de Chromium en el entorno de desarrollo de ChatGPT también falló al descargar su archivo; eso no acredita un bloqueo de Mister ni verifica que la descarga funcione en Codespaces. No activar publicación ni horarios basándose en estos resultados parciales.

Referencias: [escritorio oficial desktop-lite](https://github.com/devcontainers/features/tree/main/src/desktop-lite), [puertos privados](https://docs.github.com/en/codespaces/reference/security-in-github-codespaces), [cuota y facturación](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces).

## Incidencia del primer inicio de sesión móvil

El registro confirmó `manual_login_timeout`: el límite inicial de 15 minutos venció antes de confirmar la comunidad y no se guardó `auth.json`. El cierre de la ventana por sí solo no demuestra éxito. Se amplió la espera a 60 minutos y se eliminó el tamaño fijo de la ventana interactiva; solo el recolector mantiene 1280×900. Dos regresiones nuevas verifican ambos comportamientos (21 pruebas aprobadas localmente y en Actions). El intento posterior confirmó la comunidad correcta, emitió el mensaje de sesión guardada y dejó `sessionSaved: true`, sin bloqueo activo. No guardar contraseñas ni entradas de formulario en registros o código.

## Letras desde el iPhone

En la prueba, el teclado del iPhone no permitía introducir letras en el escritorio remoto. Se instaló `matchbox-keyboard` desde el repositorio de Debian y se abrió un teclado de pantalla dentro del mismo escritorio:

```sh
sudo apt-get install -y --no-install-recommends matchbox-keyboard
matchbox-keyboard --fontptsize 8 --rowspacing 0 --colspacing 0
```

Se redujo la ventana, se colocó debajo del formulario y se eligió **Layer → Top** en el menú de su barra de título para que no se ocultara al seleccionar el campo. Ernesto completó la entrada manual y el lector guardó la sesión. El programa no introduce ni registra contraseñas. Esta solución está comprobada manualmente en ese escritorio; el paquete todavía no forma parte de la configuración reproducible y deberá reinstalarse tras una reconstrucción completa.

## Resultado real del 15/11/2026

El lector reutilizó su sesión sin pedir otra entrada y terminó a las **17:59:34 UTC**, en **53.766 ms**: 538 jugadores, 20 participantes y 29 movimientos del tramo visible. La base contiene 275 jugadores con propietario y 263 libres; las 20 plantillas derivadas suman esos mismos 275 jugadores. Hashes de captura y archivos, regeneración de equipos y ausencia de bloqueo comprobados. `baseline: true`, `publicationReady: false`, `aiCalls: 0`.

La primera lectura no demuestra aún la cobertura histórica de clausulazos ni sustituye el contraste con cada equipo. Los archivos permanecen privados en el Codespace, excluidos de Git. GitHub confirmó **Codespace stopped** al finalizar; no quedaron horarios activos. Véanse los límites y próximos pasos en [README.md](README.md).
