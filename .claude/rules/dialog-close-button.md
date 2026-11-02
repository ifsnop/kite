---
description: Regla: TODO diálogo lleva una × arriba a la derecha (misma que la de cálculos geodésicos); equivale a Cancelar o, si no lo tiene, a Cerrar. Sin pie si su único botón sería Cerrar.
paths:
  - "src/index.html"
  - "src/styles.css"
  - "src/js/43-points-editor.js"
  - "src/js/44-dialogs.js"
---

## Todo diálogo lleva una × arriba a la derecha

**REGLA (pedida expresamente): todas las ventanas/diálogos tienen una × en la
esquina superior derecha, con la misma posición, tamaño y tipo que la de
«Cálculos geodésicos». Pulsarla equivale a CANCELAR o, si el diálogo no tiene
cancelar, a CERRAR.** Hoy, los 21 de `index.html` (`dlg-overlay`/`dlg-float`).
Un diálogo nuevo la lleva desde el primer día; `tests/statics.js` y
`tests/browser/dialogs.mjs` fallan si falta o si no es igual.

Marcado (el mismo en los 21):
`<h2 class="dlg-head"><span class="dlg-title" [id]>Título</span><button type="button" class="dlg-close" data-cancel="<id del botón>" title="Cancelar|Cerrar" aria-label="Cancelar|Cerrar">&#215;</button></h2>`.

- **Qué hace**: un único escuchador delegado (`43-points-editor.js`, junto a `makeDialogMovable`) hace `.click()` del botón que dice `data-cancel`, así que es EXACTAMENTE lo que ya hacía ese botón (y Escape: `52-measure.js` llama a las mismas funciones). Nada de lógica propia de la ×. Se llama «Cancelar» si el botón es el de cancelar (`style-cancel`, `icon-cancel`, `ktp-cancel` «Dejarlas», `kdp-cancel` «Mantener todos», `gnp-cancel` —aborta la carga, como Escape—, `restore-cancel` (confirmación de Propiedades › Restaurar), `props-cancel`, `points-cancel`, `rg-cancel`, `as-cancel`, `sh-cancel`, `custom-*-cancel`) y «Cerrar» si no hay cancelar (`desc-close`, `mobile-close`, `log-close`, `url-close`, `attr-close`). Los tres que ya la tenían de antes (atajos, cálculos geodésicos, perfil) llevan su manejador propio por `id` y no `data-cancel`.
- **El pie con sus botones SE QUEDA** en los diálogos que lo tienen (Cancelar/Aceptar, Cerrar/Copiar/Borrar…): la × es un camino más, no sustituye a nada. Orden de botones del pie: `style-dialogs-ui.md`.
- **Si el único botón del pie sería «Cerrar», no hay pie**: la × es ese botón, la caja lleva `no-actions` y el espacio del pie se lo queda el contenido (pedido expreso: en el perfil de una ruta, lo que ocupaba el pie es gráfica). Un diálogo que gane un segundo botón vuelve al pie `.dlg-actions`. Hoy sin pie: atajos, cálculos geodésicos y perfil.

## Los cinco botones de la cabecera abren Y cierran

🔗 (`url-btn`), 🏷️ (`gnp-editor-btn`), 📐 (`geocalc-btn`), 📋 (`log-btn`) y ? (`help-btn`) alternan su diálogo (`HEADER_DIALOGS`, `43-points-editor.js`): con el diálogo a la vista, pulsar el botón **pulsa su Cerrar o su Cancelar** (`url-close`, `props-cancel`, `geocalc-close`, `log-close`, `shortcuts-close`), no un segundo «abrir», así que cierra exactamente igual que la × y que Escape (Propiedades deshace lo previsualizado; el 🔗 cancela la descarga en vuelo). Es un escuchador en CAPTURA sobre `document` que intercepta el clic (`stopImmediatePropagation`) antes del manejador de «abrir» de cada botón; antes solo el de geodésicos cerraba, porque era el único NO modal (los otros cuatro quedaban tapados por el fondo).
- **Alcanzables bajo un modal** (`styles.css`, junto a `.dlg-overlay`): el fondo de un `.dlg-overlay` cubre toda la pantalla, así que mientras haya a la vista UNO de los cuatro modales de la cabecera y NINGÚN otro, los botones pasan por encima (`z-index: 2100`, con `:has()`). Con otro modal además (el selector del nombre abierto desde Propiedades, p. ej.) no: ese pide una respuesta y no se deja a medias.
- **No se apilan**: abrir un modal de la cabecera cierra antes, por su Cerrar/Cancelar, el que hubiera abierto. El de geodésicos es flotante y no se cierra ni cierra a los demás.
- Se prueba con el ratón de verdad (`tests/browser/dialogs.mjs`): un `.click()` de JavaScript se salta justo lo que falla (el fondo que tapa el botón).

Detalles que no son adorno:

- **Dentro del `<h2>`**, que ya es fijo (`sticky`): se ve con cualquier scroll, sin otra barra.
- **El `<h2>` es el asa de arrastre**: `makeDialogMovable` ignora el `pointerdown` sobre `.dlg-close`, o su captura de puntero se comería el clic.
- **El nombre del diálogo es el `.dlg-title`**, no el `<h2>` entero: `setupDialog` apunta `aria-labelledby` a él, o el diálogo se llamaría «… Cancelar». **Un título que el código reescribe** (`style-title`, `desc-title`, `ktp-title`, `points-title`, `attr-title`, `rg-title`, `profile-title`) lleva su `id` en el `<span class="dlg-title">` y se escribe ahí, NUNCA en el `<h2>`: `h2.textContent = …` borraría la ×. Un test que lea el título lee `h2 .dlg-title`, no `h2` (el `textContent` del `<h2>` acaba en «×»).
- **El foco al abrir no va a la ×** aunque sea el primero del marcado: `focusDialog` busca el primer control VISIBLE que no sea `.dlg-close`, y solo si no hay ninguno (el perfil mientras descarga) va a ella.
- **Sin pie, el relleno de abajo lo pone la caja** (`.dlg-box.no-actions { padding-bottom }`).
- **`title` y `aria-label`** (traducidos como cualquier atributo del HTML estático, ver `i18n.md`) son «Cancelar» o «Cerrar»; la × no tiene texto visible que lo diga. El perfil la renombra («Cancelar la descarga» mientras descarga).
- `tests/statics.js` lo comprueba sobre el HTML: TODO diálogo tiene exactamente una `.dlg-close` en su `<h2 class="dlg-head">`, con `title` y `aria-label`, y su `data-cancel` apunta a un botón de la MISMA caja; ningún pie de un solo botón; una caja `no-actions` no lleva pie. `tests/browser/dialogs.mjs` mide en el navegador la × de los 21 (misma posición, tamaño y tipo que la de geodésicos, ±1 px) y que pulsarla llega al botón que dice y a ninguno más.
