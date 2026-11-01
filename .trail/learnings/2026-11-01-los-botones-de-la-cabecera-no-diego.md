---
title: "Los botones de la cabecera no podían cerrar su diálogo modal: el fondo los tapaba"
author: Diego
date: 2026-11-01
branch: feat/servicios-arcgis-mapserver
cost: { minutes: 12, tokens: 43348 }
id: l-a2c81d15
scope: repo
status: active
src: agent
touches:
  - kitelocal.html
  - kitelocal.min.html
  - src/js/10-map.js
  - src/js/35-export-formats.js
  - tests/README.md
  - tests/browser/export-menu.mjs
  - tests/browser/dialogs.mjs
---

## Decided
Los cinco botones de la cabecera (`HEADER_DIALOGS`, `43-points-editor.js`) alternan su diálogo: con el diálogo a la vista, un escuchador en captura sobre `document` intercepta el clic y pulsa el Cerrar/Cancelar del diálogo (`url-close`, `props-cancel`, `log-close`, `shortcuts-close`, `geocalc-close`), porque así cierra exactamente igual que la × y Escape. Abrir un modal cierra antes el que hubiera. En `styles.css` los botones suben por encima del fondo (`z-index: 2100`, con `:has()`) solo mientras haya UNO de esos cuatro modales abierto y ningún otro.

## Tried and ruled out
Tocar el manejador de cada botón para que alterne: fails porque era imposible pulsarlos, ya que el `.dlg-overlay` del modal cubre toda la pantalla (`elementFromPoint` en el centro del botón devolvía el diálogo, medido); el de geodésicos era el único que cerraba solo porque es flotante, sin fondo. Subir siempre los botones sobre el fondo: dejaría cerrar Propiedades con el selector del nombre pendiente encima y sin responder.

## Watch out
Probar con el ratón real (`page.mouse`): con `.click()` de JavaScript el fondo no estorba y el fallo no se ve. Sin el cambio, la prueba de `tests/browser/dialogs.mjs` falla en 21 comprobaciones.
