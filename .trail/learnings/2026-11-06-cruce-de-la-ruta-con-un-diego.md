---
title: "Cruce de la ruta con un polígono: un extremo del lado sobre la recta cuenta como no positivo, y en las pruebas de navegador eval() solo vale antes del primer a…"
author: Diego
date: 2026-11-06
branch: feat/obstaculos-en-perfil
cost: { minutes: 43, tokens: 985477 }
id: l-b4a9df94
scope: repo
status: active
src: agent
touches:
  - src/js/20-kml-geom.js
  - tests/profileobstacles.js
  - tests/browser/elev-obstacles.mjs
  - src/js/63-route-profile.js
  - src/js/31-tree-node.js
  - src/js/42-hittest.js
  - src/js/43-points-editor.js
  - src/js/33-kml-import.js
  - src/js/35-export-formats.js
  - src/js/60-elevation.js
---

## Decided
En `routePolygonSpans` un lado del polígono cruza la recta de la ruta solo si `(s0 > 0) !== (s1 > 0)`, con `s` el lado de la recta en que cae cada extremo y un extremo SOBRE la recta contado como no positivo. Así un vértice del polígono en la ruta o un lado paralelo dan siempre un número par de cruces.

## Tried and ruled out
Intervalos semiabiertos `t` y `u` en [0, 1) sobre la intersección de dos segmentos: una ruta que corre exactamente sobre un lado daba un cruce de más y una entrada falsa hasta el final.

## Watch out
En `page.evaluate` de Playwright, `eval(texto)` solo funciona en la parte síncrona, hasta el primer `await`: después la CSP de la aplicación lo bloquea (`unsafe-eval`). Evaluar el selector de la ruta antes de esperar nada.
Una suite de navegador lanzada con `| head` parece colgada hasta que termina: escribir la salida a un archivo.
Un GeoJSON de prueba con `properties` abre el selector de nombre y bloquea `handleDroppedFiles`: usar `properties: null`.

In the code: `src/js/63-route-profile.js` (`routePolygonSpans`), `tests/profileobstacles.js`, `tests/browser/elev-obstacles.mjs`.
