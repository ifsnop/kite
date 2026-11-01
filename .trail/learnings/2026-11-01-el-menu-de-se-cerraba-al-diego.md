---
title: "El menú de 💾 se cerraba al mover el ratón: el blur de un elemento llega al oyente de captura de window"
author: Diego
date: 2026-11-01
branch: feat/servicios-arcgis-mapserver
cost: { minutes: 2, tokens: 24720 }
id: l-8b0c6900
scope: repo
status: active
src: agent
touches:
  - tests/browser/export-menu.mjs
---

## Decided
En `openExportMenu` (`35-export-formats.js`) el oyente de `blur` de `window` va SIN captura, y el de `scroll` sigue con captura pero ignora el del propio menú. Moverse del 💾 a una entrada ya no cierra el menú.

## Tried and ruled out
Pensar que el menú (que cuelga de `document.body`) se ocultaba con la fila: no, `tests/browser/export-menu.mjs` lo daba por bueno porque pulsaba con `.click()` de JavaScript, y por eso el fallo se escapó. Se reprodujo solo con el ratón real y moviéndolo en pasos hacia la primera entrada.

## Watch out
La causa: un oyente de `blur` en `window` con captura recibe también el `blur` de cualquier ELEMENTO (no burbujea pero la captura baja desde `window`). Los botones de una fila solo se ven con el ratón encima, así que al salir de la fila el 💾, que tiene el foco tras pulsarlo, se oculta, pierde el foco y su `blur` cierra el menú porque llegaba al oyente. Cualquier menú o popover abierto desde un botón de fila que cierre por `blur` de `window` puede tener lo mismo: usar `capture: false`, y probarlo con `page.mouse`, no con `.click()`.
