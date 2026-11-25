---
title: "A label-only KML point must get its name on the raw layer, because a folded folder has no rows to bind it"
author: Diego
date: 2026-11-25
branch: fix/kml-label-points-folded-folder
cost: { minutes: 94, tokens: 1830760 }
id: l-e839c9b0
scope: repo
status: active
src: agent
touches:
  - docs/estudio-seguridad-kite-local.md
  - docs/img/anadir-url.png
  - docs/img/anillos-dialogo.png
  - docs/img/anillos-resultado.png
  - docs/img/arbol-estructura.png
  - docs/img/aviso-movil.png
  - docs/img/barra-herramientas.png
  - docs/img/borrar-capas.png
  - docs/img/buscador-lugares.png
  - docs/img/cabecera-panel.png
---

## Decided
The permanent name (and the click popup) of a marker is now bound on the raw layer, together with its icon, for an imported KML point and for one restored from storage. Before, only building a tree ROW bound the text, so a marker with no icon whose name is its whole content (a label-only point, common in KML) showed nothing while its folder stayed folded, and again after every reload. A real file (the user's test.kml, now a fixture) showed it: its two banners (empty `<Icon></Icon>`, icon scale 0, label scale 0.8) were invisible. Binding again when the row is built is harmless because the binding unbinds first.

## Tried and ruled out
Leaving it as the documented limitation of "always show the text" in a folder never expanded: that limitation was rare while a marker could only be custom-styled by hand, but importing IconStyle makes "no icon, name shown" the default for such points, so it would hit every label-only KML. Measured cost of binding the text on the raw layer: about 60 ms per 5000 markers (6 % of the import); the icon itself is the bigger part (about 350 ms per 5000).

## Watch out
- A test written to confirm a fix by MUTATING the source must restore it from a copy kept outside the repo, never with `git checkout <file>`: that also throws away the uncommitted work in the same file (it happened here and the refactor had to be redone).
- A mutation that makes an earlier check throw (a `.color` read on `null`) hides every later block: guard the reads so each block reports on its own.
- In the code: `bindMarkerText` and `styleRawMarker` (`src/js/42-hittest.js`), called from `buildKmlRecords` (`31-tree-node.js`) and `buildRecordLayer` (`32-geojson.js`); the fixture is `tests/fixtures/msda-lemd-marker-styles.kml`, byte for byte the user's file.
