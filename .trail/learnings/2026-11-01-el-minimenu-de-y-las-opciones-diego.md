---
title: "El minimenú de 💾 y las opciones de su fila son UNA zona: se cierran juntos al salir el ratón"
author: Diego
date: 2026-11-01
branch: fix/menu-guardar-texto-y-hover
cost: { minutes: 8, tokens: 40258 }
id: l-fb194c21
scope: repo
status: active
src: agent
touches:
  - build.js
  - README.md
  - tests/browser/export-menu.mjs
  - tools/capturas.mjs
---

## Decided
Mientras el menú de 💾 está abierto, la fila lleva `.menu-open` y sus botones (`.actions`, que solo se ven con el ratón encima) siguen a la vista; fila y menú son una zona, y solo cuando el ratón no está sobre ninguna de las dos (`mouseleave` + `:hover`, pasados `EXPORT_MENU_LEAVE_MS` = 300 ms) se cierran las dos a la vez. Pedido por el usuario tras el arreglo anterior (mover el ratón no cerraba nada): ahora salir sí cierra, pero no ir de la fila al menú ni volver.

## Tried and ruled out
Cerrar al instante con `mouseleave` de la fila: fails porque entre el 💾 y el menú hay un hueco de unos píxeles y el cursor sale de las dos zonas un instante; por eso el margen. Seguir sin cerrar con el ratón fuera (lo del arreglo anterior): el usuario quiere que se cierre al salir.

## Watch out
`mouseleave` solo salta con movimiento real del ratón: una prueba que abre el menú con `.click()` de JavaScript no arma ningún temporizador y no se entera. En `tests/browser/export-menu.mjs`, las coordenadas de la fila se miden de nuevo antes de cada bloque con el ratón: los avisos («Descargado») empujan el árbol hacia abajo y con coordenadas viejas el clic abría el menú de OTRA fila. El texto del botón es «Guardar a un archivo» (se quitó «o exportar»): los selectores `aria-label^="Guardar a un archivo"` de los tests y de `tools/capturas.mjs` dependen de él.
