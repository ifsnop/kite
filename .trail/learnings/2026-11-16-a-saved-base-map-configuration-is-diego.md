---
title: "A saved base-map configuration is applied without deleting anything, and a server new to this browser arrives switched off"
author: Diego
date: 2026-11-16
branch: feat/base-layers-export
cost: { minutes: 19, tokens: 101375 }
id: l-57356b14
scope: repo
status: active
src: agent
touches:
  - README.md
  - docs/img/anadir-url.png
  - docs/img/anillos-resultado.png
  - docs/img/aviso-movil.png
  - docs/img/barra-herramientas.png
  - docs/img/borrar-capas.png
  - docs/img/buscador-lugares.png
  - docs/img/cabecera-panel.png
  - docs/img/calculos-geodesicos.png
  - docs/img/capa-base-propia.png
---

## Decided
- The base-map list has a 💾 (next to «+ Añadir capa…») that saves the order, on/off state, opacity, chosen WMS layer, the user's own servers and the background colour to a `.kite.json`; dropping that file on the navigation panel applies it to the base-map panel (nothing enters the tree). The Copernicus credential never travels.
- Chosen with the user: loading applies the file WITHOUT deleting anything. A server with the same type and address is reused (no duplicate); the user's own layers the file does not name stay, switched off, at the end.
- A server that had not been used in this browser arrives SWITCHED OFF and a notice names it, the same rule as ArcGIS services from someone else's file: opening another person's file must not contact a server they chose.

## Tried and ruled out
- Replacing everything (deleting the user's layers missing from the file): base maps are not in undo, so a slip would lose addresses for good.
- Only adding the user's servers: the user wanted the order, state and opacity restored too.

## Watch out
- No undo for loading (like deleting a user layer): the way back is loading an older saved file.

In the code: src/js/11-base-panel.js (basesExportDoc, parseBasesExport, planBasesImport, applyBasesImport, buildSaveBasesButton), src/js/33-kml-import.js (drop branch before parseTreeExport, sniffJsonKind "bases"), tests/basesexport.js, tests/browser/bases-export.mjs, rule .claude/rules/base-maps.md.
