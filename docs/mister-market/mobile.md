# Prueba desde el celular

Esta configuración prepara un escritorio temporal en GitHub Codespaces. El iPhone muestra el escritorio; el programa se ejecuta en Codespaces. **No es todavía el programador de las 04:00 y 17:00 ni publica datos.**

Antes de crear el entorno, comprobar la cuota incluida y el presupuesto de Codespaces en GitHub. Mantener bloqueado el gasto de pago. No añadir una tarjeta ni subir el presupuesto para completar esta prueba.

## Preparación

Crear el Codespace del repositorio Cuban-league, rama `feature/mister-market-reader`, seleccionando la configuración **Mister · prueba desde el celular** y la máquina más pequeña disponible. No activar prebuilds.

La preparación instala Playwright y Chromium desde sus distribuidores oficiales. Al abrir el editor se lanza una ventana de Mister, salvo que ya exista una sesión guardada o un proceso bloqueado. No comparte cookies con ChatGPT ni con Safari.

## Iniciar sesión

1. En **Ports**, comprobar que el puerto **6080** figure como **Private**, y abrir su enlace. Debe estar protegido por tu inicio de sesión en GitHub. Nunca cambiarlo a Public ni compartirlo con terceros.
2. En el escritorio web de noVNC, pulsar **Connect**. El componente oficial desktop-lite utiliza la contraseña de escritorio predeterminada `vscode`; la protección externa es el acceso privado de GitHub. Esa contraseña de escritorio no es la de Mister ni la de GitHub.
3. Dentro de la ventana de Mister, iniciar sesión y seleccionar la **primera división de Cuban League**. El programa espera hasta 15 minutos y guarda su sesión privada cuando confirma la comunidad correcta. No hace falta volver a una terminal para pulsar Enter.
4. La ventana del programa se cierra al terminar. La sesión se guarda únicamente en `.mister-market/auth.json`, excluida de Git. No copiar ese archivo al chat, a commits o a artefactos de Actions.

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

Estado de validación: acceso manual de GitHub comprobado; inicio de sesión en Mister desde este escritorio y captura real todavía pendientes. Las pruebas del detector de sesión son sintéticas. La instalación de Chromium en el entorno de desarrollo de ChatGPT falló al descargar su archivo; eso no acredita un bloqueo de Mister ni verifica que la descarga funcione en Codespaces.

Referencias: [escritorio oficial desktop-lite](https://github.com/devcontainers/features/tree/main/src/desktop-lite), [puertos privados](https://docs.github.com/en/codespaces/reference/security-in-github-codespaces), [cuota y facturación](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces).
