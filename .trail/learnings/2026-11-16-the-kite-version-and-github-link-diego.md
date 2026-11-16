---
title: "The KITE version and GitHub link go last on the attribution line and never shrink; the old line overflowed past the map's left edge"
author: Diego
date: 2026-11-16
branch: feat/attribution-right-ors-sources
cost: { minutes: 18, tokens: 889273 }
id: l-2d497ebb
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - README.md
  - build.js
  - docs/estudio-seguridad-kite-local.md
  - docs/img/capturas.json
  - docs/img/itinerario.png
  - docs/img/menu-consultas.png
  - docs/img/propiedades-preferencias.png
  - docs/manual-usuario-kite-local.md
  - docs/pendientes-y-propuestas-kite-local.md
---

## Decided
- The attribution line shows the sources' credits first and KITE's block last, at the far right: «Leaflet | v<version> (<build>) | GitHub», which never shrinks; the sources are cut with an ellipsis and their full list is in the tooltip. Requested: the version and the GitHub link must always fit.
- Done by replacing the attribution control's `_update` (before `setPrefix`, which calls it), since Leaflet always puts the prefix first.

## Tried and ruled out
- Only reordering the text: the line kept overflowing, because Leaflet's bottom-right corner is anchored only on the right and grows past the map's LEFT edge, so `max-width` and the ellipsis never applied. That is why the version, then at the start of the line, disappeared. `.leaflet-bottom.leaflet-right { left: 0 }` makes the corner as wide as the map (corners take no pointer events).

## Watch out
- In a flex item the spaces at the edges are trimmed: the separator needs padding, not spaces.
- Changing the attribution line changes almost every screenshot of the manual: regenerate them all.

In the code: src/js/10-map.js (map.attributionControl._update, setPrefix), src/styles.css (.attr-sources, .attr-kite, .attr-sep, .leaflet-bottom.leaflet-right), tests/attribution.js, tests/browser/app.mjs.
