---
title: "A layer built from a never-expanded folder lost its mouseout: the waiting listener and the definitive one were the same function"
author: Diego
date: 2026-11-11
branch: feat/info-card-stack
cost: { minutes: 51, tokens: 805154 }
id: l-feefe12a
scope: repo
status: active
src: agent
touches:
  - src/js/32-geojson.js
  - src/js/44-dialogs.js
  - src/index.html
  - src/js/43-points-editor.js
  - src/js/70-view-controls.js
  - src/styles.css
  - tests/toolstest.js
  - tests/browser/info-stack.mjs
  - src/js/40-panel-actions.js
  - tools/capturas.mjs
---

## Decided
The waiting hover listeners that a pending record gets (`wirePendingLayerEvents`) must be functions of their own, never the shared handler itself. The mouseout one is now `() => scheduleLayerInfoHide()`.

## Tried and ruled out
Registering `scheduleLayerInfoHide` directly as the waiting mouseout. It fails because `makeNode` registers that very function when the row is built, Leaflet's `on` ignores a listener that is already there (same fn and context), and the `off` of the waiting one in `materializeRecords` then removes the only copy. Every layer that came out of a collapsed folder (reload, import) silently had no mouseout, so the info card never heard the pointer leave it. It only showed up once the card's behaviour depended on mouseout (hover intent and the stack of recent cards): a fast sweep left the last crossed marker on the card.

## Watch out
Any listener swapped between a pending record and its row must not share the function object with the definitive one, or the `off` takes both. In the info card's stack, nothing above the rows may change size between compact and normal mode: looking at a row leaves compact mode, and a label or button appearing above the rows slid them under the pointer onto the neighbour (the label is screen-reader only, the pin keeps its room with `visibility`).

In the code: src/js/40-panel-actions.js `wirePendingLayerEvents`; src/js/32-geojson.js `materializeRecords` (the `off` calls); src/js/44-dialogs.js `renderInfoStack`; tests/browser/info-stack.mjs checks exactly one mouseout and that rows do not move.
