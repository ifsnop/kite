---
title: La casilla de una fila seleccionada no actuaba sobre la selección porque el click llega a la fila antes que el change
author: Diego
date: 2026-11-09
branch: fix/casilla-seleccion-multiple
cost: { minutes: 12, tokens: 721481 }
id: l-3bbd4f41
scope: repo
status: active
src: agent
touches:
  - README.md
  - build.js
  - docs/estudio-seguridad-kite-local.md
  - docs/img/capturas.json
  - docs/img/filtro-arbol.png
  - docs/img/pie-panel.png
  - docs/manual-usuario-kite-local.md
  - kitelocal.html
  - kitelocal.min.html
  - src/index.html
---

## Decided
Pulsar la casilla de una fila que forma parte de una selección múltiple aplica el estado que se acaba de elegir a toda la selección (`propagateCheck`, que dispara el `change` de cada casilla para reutilizar la cascada, el mapa y el guardado) y no la deshace. Gana el estado de la pulsada, no se invierte cada una. Una casilla de una fila fuera de la selección sigue igual: solo esa, y queda como única seleccionada.

## Tried and ruled out
Propagar solo en el `change`: fails porque el `click` sube a la fila ANTES de que se dispare el `change`, y el manejador de la fila (`moveCursorTo`) reduce la selección a esa fila, así que al llegar el `change` ya solo había una. Hacen falta las dos mitades: cortar ese manejador para la casilla y propagar en el `change`.

## Watch out
El Espacio (`toggleVisibility`) pulsa cada casilla con `.click()`: activaba todas, pero cada pulsación subía a la fila y dejaba como selección solo la última. Se arregla con lo mismo. Con el `change` re-disparado hace falta un indicador de re-entrada (`propagatingCheck`) o cada casilla volvería a propagar. Comprobar `c.indeterminate` además de `c.checked`: una carpeta a medias cuyo `checked` ya vale el estado pedido sigue necesitando la cascada. `new Event` es un global nuevo para `tests/statics.js`.

In the code: `src/js/31-tree-node.js` (manejadores `click` y `change` de `makeNode`, `propagateCheck`), `tests/browser/multiedit.mjs`.
