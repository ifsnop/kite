---
description: Regla de los diálogos cuyo único botón es el de cerrar — × arriba a la derecha en la cabecera, sin pie.
paths:
  - "src/index.html"
  - "src/styles.css"
  - "src/js/43-points-editor.js"
  - "src/js/44-dialogs.js"
---

## Diálogos con un solo botón, el de cerrar

**REGLA: un diálogo cuyo ÚNICO botón es el de cerrar no lleva pie; el
botón va como × ARRIBA A LA DERECHA**, dentro de la cabecera, y el
espacio del pie se lo queda el contenido (pedido expreso, para
aprovechar el espacio: en el perfil de una ruta, lo que ocupaba el pie
es gráfica). Vale para todo diálogo nuevo; uno que gane un segundo
botón vuelve al pie `.dlg-actions` (con el orden de botones de
`style-dialogs-ui.md`).

Marcado: `<div class="dlg-box no-actions">` y `<h2 class="dlg-head"><span class="dlg-title">Título</span><button type="button" class="dlg-close" id="…-close" title="Cerrar" aria-label="Cerrar">&#215;</button></h2>`. Hoy: chuleta de atajos (`shortcuts-close`), cálculos geodésicos (`geocalc-close`) y perfil de una ruta (`profile-close`; su × se llama «Cancelar la descarga» mientras descarga y «Cerrar» después, con `title`/`aria-label`, que no hay texto visible que lo diga). Un diálogo con más botones (aunque uno sea «Cerrar», como la ficha o el registro) sigue con su pie `.dlg-actions`.

Detalles que no son adorno:

- **Dentro del `<h2>`**, que ya es fijo (`sticky`): se ve con cualquier scroll, sin otra barra.
- **El `<h2>` es el asa de arrastre**: `makeDialogMovable` ignora el `pointerdown` sobre `.dlg-close`, o su captura de puntero se comería el clic.
- **El nombre del diálogo es el `.dlg-title`**, no el `<h2>` entero: `setupDialog` apunta `aria-labelledby` a él, o el diálogo se llamaría «… Cerrar». Un título que cambia (el del perfil) se escribe en el `<span>` (`id` en él), nunca en el `<h2>`, o se borraría el botón.
- **El foco al abrir no va al ×** aunque sea el primero del marcado: `focusDialog` busca el primer control VISIBLE que no sea `.dlg-close`, y solo si no hay ninguno (el perfil mientras descarga) va al ×.
- **Sin pie, el relleno de abajo lo pone la caja** (`.dlg-box.no-actions { padding-bottom }`).
- `tests/statics.js` lo comprueba sobre el HTML (ningún `.dlg-actions` de un solo botón; todo `.dlg-close` en la cabecera de una caja `no-actions`) y `tests/browser/dialogs.mjs` en el navegador (la chuleta: × arriba a la derecha y visible con el scroll arriba y abajo).
