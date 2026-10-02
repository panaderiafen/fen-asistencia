# fën asistencia · v5.1.0 (seguridad + llavero de Fën)

**App:** v5.0.1 · **Apps Script:** v5.1.0 · 1 de octubre de 2026

Es la primera entrega de la Fase 0 de Sistema Fën: cierra las puertas de seguridad de Asistencia sin cambiar cómo trabaja el equipo. La tablet y el panel se ven y se usan igual que antes. Lo único nuevo es que **cada dispositivo se autoriza una vez** con la contraseña del administrador.

## Novedades de v5.1.0 (respecto a v5.0.1)

Asistencia pasa a ser el "llavero" de Fën: otras apps le preguntan si la contraseña del dueño o el PIN de una persona son correctos. La primera en usarlo es Producción v2.0.0.

- Hay **una sola contraseña de dueño** (la del panel de Asistencia) y **un solo PIN por persona** para todas las apps. Se cambian aquí y valen en todas.
- Cada app se conecta con su propia **clave de servicio**. Se crea con la función `crearClaveServicioProduccion()` y aquí queda guardada solo su huella, en las propiedades del script.
- Los bloqueos son compartidos: 5 intentos fallidos bloquean igual, se hagan desde la tablet, el panel o Producción.
- Se agregó una defensa extra contra nombres de acción raros (`__proto__` y similares).
- **Solo cambia `Code.gs`.** La tablet, el panel y `config.js` siguen igual que en v5.0.1, así que en GitHub solo se actualiza `Code.gs` como respaldo.

### Instalar v5.1.0
1. En la planilla real, ve a **Extensiones → Apps Script**, reemplaza todo el código por `Code.gs` (v5.1.0) y guarda.
2. **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar.** La URL no cambia.
3. Elige la función `crearClaveServicioProduccion` y presiona **Ejecutar**. En el **Registro de ejecución** aparece una clave que empieza con `fsv-`. Cópiala directo en Producción (ver el README de Producción) y no la guardes en ningún documento.
4. Comprueba que la tablet sigue marcando: alguien marca entrada y la marca aparece en la planilla.

Si algún día crees que la clave de servicio se filtró, ejecuta otra vez `crearClaveServicioProduccion`: la anterior deja de servir y pegas la nueva en Producción.

## Novedades de v5.0.1 (respecto a v5.0.0)

- **Corrige** el error "Esta versión solo acepta POST" al marcar entrada, que apareció en la prueba. A veces Google desvía la llamada y le llega al script sin datos, sobre todo en navegadores con varias cuentas de Google abiertas. Ahora la app lo detecta y reintenta sola por otra vía.
- **Cada escritura lleva una clave única,** así que aunque llegue dos veces se registra una sola vez: un turno, un bono o un PIN nunca quedan duplicados.
- **Permiso de correo más acotado:** el script ahora pide solo "enviar correos en tu nombre", y ya no "leer, enviar y borrar todos tus correos". Google pedirá autorizar de nuevo una vez.

Solo cambian `Code.gs` y `config.js`; `tablet.html` y `admin.html` son iguales a los de v5.0.0.

## Qué cambia

| Antes (v4) | Ahora (v5) |
| --- | --- |
| La contraseña del panel se comparaba en el navegador, contra un `config.js` público, y seguía siendo la del ejemplo | Se revisa en el Apps Script y se guarda cifrada en las propiedades del script. Tras 5 intentos fallidos, el panel se bloquea 15 minutos |
| Cualquiera con la dirección del script podía cambiar PIN, horas y bonos | Ninguna acción funciona sin sesión. Solo el panel puede editar; la tablet solo marca |
| Los PIN estaban a la vista en la columna H, y la planilla abierta a cualquiera con el enlace | Los PIN quedan cifrados y la planilla se cierra. El panel ya no usa clave de API |
| Un PIN como `0123` quedaba guardado como `123` y no funcionaba | El PIN se guarda como texto. La instalación repara los que perdieron el 0 |
| Marcar entrada o salida solo pedía el correo | Exige haber ingresado el PIN correcto hace menos de 2 minutos. Tras 5 PIN malos, esa persona queda bloqueada 10 minutos |
| Editar un registro reemplazaba la hora original | El antes y el después quedan en la hoja `historial_cambios`. Nada se borra |
| Las acciones viajaban en la URL (con el PIN incluido) | Todo va por POST. Solo si Google desvía la llamada, la app reintenta por la URL, y aun así exige sesión |
| — | Sección **Seguridad** en el panel: cambiar la contraseña y ver o revocar dispositivos |

## Archivos

```
tablet.html   pantalla de marcación (Fully Kiosk)
admin.html    panel de administración
config.js     configuración pública: ya no lleva ninguna clave
Code.gs       Apps Script v5 (reemplaza al v4 completo)
pruebas/      simulador, pruebas automáticas y capturas (no hace falta subirla al repo)
```

`logosecundario.jpg` y la carpeta `fotos/` del repo no cambian.

## Instalación

Conviene hacerla fuera de horario, porque la tablet y el script deben actualizarse juntos.

### 1. Probar primero en una copia (15 minutos)
1. En Drive, abre la planilla **fen asistencia** y ve a **Archivo → Crear una copia**. Llámala `fen asistencia PRUEBA`. La copia trae su propio Apps Script.
2. En la copia, ve a **Extensiones → Apps Script**. Reemplaza todo el código por `Code.gs` y guarda.
3. Elige la función `instalarSeguridad` y presiona **Ejecutar**. Acepta los permisos. En el **Registro de ejecución** aparece la contraseña inicial: anótala.
4. Ve a **Implementar → Nueva implementación → Aplicación web**, con "Ejecutar como: Yo" y "Acceso: Cualquier persona". Copia la URL.
5. En el repo, crea una carpeta `prueba/` con `tablet.html`, `admin.html` y `config.js`. En `prueba/config.js` cambia `APPS_SCRIPT_URL` por la URL del paso 4.
6. Revisa la lista de verificación de más abajo en `panaderiafen.github.io/fen-asistencia/prueba/admin.html` y `.../prueba/tablet.html`.

### 2. Pasar a producción
1. **Respaldo:** haz otra copia de la planilla real (`fen asistencia RESPALDO 2026-10`). Contiene los PIN sin cifrar, así que bórrala apenas confirmes que todo funciona (paso 3.3).
2. En la planilla real, ve a **Extensiones → Apps Script**, reemplaza el código por `Code.gs` y guarda.
3. Ejecuta `instalarSeguridad` y anota la contraseña inicial.
4. Ve a **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar**. Así la URL no cambia.
5. Sube `tablet.html`, `admin.html` y `config.js` a la raíz del repo, reemplazando los de v4.
6. En la tablet, recarga la página e ingresa la contraseña inicial y un nombre (por ejemplo "Barros Arana"). Queda autorizada por un año.
7. En el panel, entra con la contraseña inicial y cámbiala en **trabajadores → seguridad**.

### 3. Cerrar lo que quedó abierto
1. **Planilla privada:** en la planilla real, ve a **Compartir → Acceso general → Restringido**. El panel v5 ya no la lee directamente, así que no necesita estar abierta.
2. **Clave de API:** en [console.cloud.google.com](https://console.cloud.google.com) → **APIs y servicios → Credenciales**, elimina la clave de API que estaba en el `config.js` antiguo. De las apps que revisé, solo Asistencia la usaba.
3. **Respaldo:** cuando todo funcione, borra la copia de respaldo del paso 2.1 y vacía la papelera.
4. **Recomendado:** como los PIN estuvieron legibles, asigna PIN nuevos desde el panel en **trabajadores → gestión de PINs**.

### Si algo sale mal
- **La tablet no marca:** revisa que `config.js` tenga la URL correcta y que la implementación sea una "Nueva versión".
- **Olvidaste la contraseña:** en el editor de Apps Script, ejecuta `restablecerClaveAdmin`. Crea una nueva, la muestra en el registro y cierra todas las sesiones, así que hay que autorizar la tablet de nuevo.
- **Volver a v4:** en **Gestionar implementaciones**, elige la versión anterior y restaura los HTML anteriores desde el historial de GitHub. Como v5 cifró los PIN, v4 no podrá leerlos: tendrías que asignarlos de nuevo en la planilla.
- **Fully Kiosk:** si está configurado para borrar los datos del navegador al reiniciar, la tablet pedirá autorización cada vez. Desactiva **Clear Cache/Web Storage on Reload**.

## Lista de verificación en la copia de prueba

- [ ] La tablet pide autorización; una contraseña mala da error y la correcta muestra al equipo.
- [ ] Una persona marca entrada con su PIN y aparece en la planilla de prueba con su nombre.
- [ ] Un PIN que empieza con 0 funciona.
- [ ] Un PIN incorrecto avisa "PIN incorrecto".
- [ ] La misma persona marca salida y se calculan las horas.
- [ ] El panel rechaza la contraseña `CAMBIA_ESTA_CLAVE` y acepta la inicial.
- [ ] En **resumen**, **contrato** y **honorarios**, los números coinciden con los de v4 para el mismo mes.
- [ ] Editar un turno deja una fila en `historial_cambios` con el antes y el después.
- [ ] Asignar un PIN deja en la columna H un texto que empieza con `h1$`.
- [ ] En **seguridad** aparecen el computador y la tablet. Al revocar la tablet, esta vuelve a pedir autorización.
- [ ] Abrir `URL_DEL_SCRIPT?action=setPin&email=x&pin=1234` en el navegador no cambia nada y responde "Solicitud sin datos".

## Pruebas automáticas

Corren en un simulador de Apps Script con datos ficticios: sin internet y sin tocar tus planillas.

```
node --test pruebas/asistencia/backend.test.js        # 19 pruebas del script
NODE_PATH=$(npm root -g) node --test pruebas/asistencia/e2e.test.js   # 9 pruebas en navegador + capturas
```

Las capturas quedan en `pruebas/capturas/asistencia/`: tablet en 1280 px y en celular, y panel en 1440 px y en celular.

Estas pruebas no cubren el envío real del correo con PDF de `solicitarEstado` (que no cambió respecto a v4) ni la velocidad real de Google: un ingreso al panel puede tardar 1 o 2 segundos más que antes, por el cifrado.
