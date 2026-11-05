---
title: "Buscar unas coordenadas crea marcador en Lugares y va a zoom 17 (antes: zoom 9 y sin marcador)"
author: Diego
date: 2026-11-05
branch: fix/buscar-coordenadas-crea-marcador
cost: { minutes: 7, tokens: 175454 }
id: l-ded9e88f
scope: repo
status: active
src: agent
touches:
  - README.md
  - docs/manual-usuario-kite-local.md
  - docs/pendientes-y-propuestas-kite-local.md
  - kitelocal.html
  - kitelocal.min.html
  - src/js/10-map.js
  - src/js/40-panel-actions.js
  - tests/README.md
  - tests/browser/place-coords.mjs
  - tests/run-all.js
---

## Decided
En `40-panel-actions.js`, `goToCoordinates(at, text)` crea un marcador en «Lugares» con `createPlaceMarker` (compartido con `addPlaceMarker`, el de un resultado de Nominatim) y hace `map.setView` a `COORD_SEARCH_ZOOM` = 17. El nombre del marcador es el texto escrito. La caja del buscador se vacía, igual que al elegir un resultado, para que repetir la búsqueda no deje marcadores duplicados; esto último lo elegí yo y el usuario no lo pidió expresamente.

## Tried and ruled out
El comportamiento anterior (solo `setView` a zoom 9, sin marcador, texto en la caja) estaba documentado como decisión en `.claude/rules/tree-navigation-selection.md`; el usuario lo dio por un fallo y pidió lo contrario. No se conserva ninguna opción para volver a él.

## Watch out
`tests/browser/place-coords.mjs` ahora cuenta marcadores de forma acumulada (cada búsqueda con coordenadas suma uno, la de un lugar de Nominatim no); la capa de una fila está en el checkbox (`input[type=checkbox]._layer`), no en `li._layer`. Un `git add` que incluya `.claude/...` devuelve error por estar en `.gitignore` aunque el archivo ya esté seguido, y corta una cadena con `&&` antes del commit.
