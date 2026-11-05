---
title: "Icono «Ninguno» de un marcador: caja transparente de 20 px y texto fijo marcado solo; los iconos MDI no incluyen NO_ICON"
author: Diego
date: 2026-11-05
branch: fix/atributos-valores-y-nombres-arcgis
cost: { minutes: 36, tokens: 1398855 }
id: l-aeaaef2d
scope: repo
status: active
src: agent
touches:
  - fetch-icons.js
  - tests/icons.js
  - tests/attrstyle.js
  - docs/img/selector-iconos.png
---

## Decided
`NO_ICON = "none"` (`41-selection.js`) es un marcador sin icono para ver solo el texto. `buildMarkerIcon` lo trata antes del `!svg` (que cae en la gota): `L.divIcon` vacío de `NO_ICON_HIT` = 20 px, para que se pueda pulsar, medir y acertar con el clic derecho, y el nombre va centrado (`applyMarkerText`). Elegirlo marca «Mostrar el texto siempre» (`syncTextForIcon`, `textAutoOn`) porque sin texto fijo no se ve nada; se desmarca al elegir otro icono o cancelar. KML: `<scale>0</scale>`.

## Tried and ruled out
Un icono vacío sin caja: no habría nada que clicar. Dejar el texto fijo al usuario: un marcador invisible.

## Watch out
`NO_ICON` está en `MDI_ICONS`, que lee `fetch-icons.js`: sin excluirlo pide un icono «none» a Iconify y falla; `tests/icons.js` y `tests/attrstyle.js` extraen funciones y necesitan la constante. En `35-export-formats.js` (carga ANTES que `41`) se compara con el literal `"none"`.
