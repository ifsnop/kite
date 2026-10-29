---
title: "Las capturas del manual se generan con tools/capturas.mjs, no a mano, y los recuentos de docs/ los vigila tests/docs.js"
author: Diego
date: 2026-10-29
branch: main
cost: { minutes: 84, tokens: 1336356 }
id: l-e695de2a
scope: repo
status: active
src: agent
touches:
  - src/js/65-cadastre.js
  - tests/cadastretest.js
  - tests/browser/cadastre.mjs
  - tests/docs.js
  - tools/capturas.mjs
  - docs/img/08-menu-contextual-generico.png
  - docs/img/02-cabecera-panel.png
  - docs/img/01-vista-general.png
  - docs/img/15-medicion-mapa.png
---

## Decided
- Todas las capturas de `docs/img/` se regeneran con `npm run capturas` (`tools/capturas.mjs`, un escenario por captura, datos en `docs/ejemplos/`, manifiesto `docs/img/capturas.json` con sha256 y versión por imagen). Funcionalidad nueva con algo visible = escenario nuevo en el mismo cambio (punto 13 del checklist, `docs-maintenance.md`).
- Los recuentos de suites, las versiones de las cabeceras, las figuras y las anclas de `docs/` los vigila `tests/docs.js`, con pruebas negativas sobre copias estropeadas.

## Tried and ruled out
- Capturas a mano (o solo las que faltan): sin escenario no se pueden repetir y la interfaz las deja desfasadas sin que nadie lo note (las de septiembre aún enseñaban «Modo elevación»).
- Solo corregir los números del estudio: ya se habían desfasado cuatro veces (60, 61, 61 de 61, 60 frente a 97 reales).

## Watch out
- No fijar el reloj con `page.clock.setFixedTime`: Leaflet mide el fundido de teselas con `Date` y el mapa sale en blanco. Se normaliza el texto de fecha y hora (`stamps`).
- `blinkLayer` no cancela su temporizador al borrar una fila: la capa vuelve al mapa si se borra en sus 600 ms.
- El fondo es OpenStreetMap real (hace falta red; `--sin-fondo` para iterar). `ortofoto-cog.png` es externa y no se regenera.
