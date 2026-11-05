---
title: "Un KML grande bloqueaba la página por construir eagerly las capas de lo apagado y por el límite de heap, no por la CPU"
author: Diego
date: 2026-11-05
branch: perf/capas-perezosas-kml-grande
cost: { minutes: 39, tokens: 730984 }
id: l-3e24ee29
scope: repo
status: active
src: agent
touches:
  - src/js/20-kml-geom.js
  - tests/browser/lazy-layers.mjs
  - tests/parsecoords.js
  - docs/pendientes-y-propuestas-kite-local.md
  - tests/statics.js
  - src/js/33-kml-import.js
  - src/js/30-tree-walk.js
---

## Decided
Un registro `layer` apagado, sin marcadores y de este navegador no construye su capa Leaflet hasta que alguien lee `rec._layer` (`defineLazyLayer`, `buildRecordLayer`, `recLayerPending` en `32-geojson.js`). Al importar un KML, `buildPlacemarkGeo` (20-kml-geom.js) saca el GeoJSON sin pasar por Leaflet; al restaurar, `buildRecordsFromStorage` lo decide con `geoIsLazyable`. Medido con `20261103_P2.kmz` (309 MB, 62 673 placemarks, 9,66 M de vértices, todos `visibility 0`): construir 9,4 → 4,7 s, `serializeTree` 1,3 s → 14 ms, heap 1,5 → 1,08 GB, recargar 15 s/3,1 GB → 5,3 s/1,46 GB. Se cede el hilo por tiempo (`yieldIfDue`, 50 ms) y no cada 150 capas: cada cesión cuesta un fotograma (418 cesiones eran 6,5 s de espera).

## Tried and ruled out
Pensar que era CPU: con 12 GB de heap `serializeTree` tardaba 1,3 s; con `--max-old-space-size=3000` pasaba a 66,8 s (el GC contra el techo) y con 4 GB de VM la pestaña moría. Construir la capa y soltarla tras sacar `toGeoJSON()`: no quita los 9 s de construir. Partir el guardado en varios segmentos y acelerar el DOMParser: se dejan como pendiente medido (`docs/pendientes-y-propuestas-kite-local.md` 1.10), tocan `segmentPlan` o son del navegador.

## Watch out
Todo código que recorra registros pendientes sin necesitar la capa debe preguntar `recLayerPending(rec)` antes de leer `_layer`, o la construye (cascadas, quitar del mapa, encuadre, `recMapLayer`, atributos). `buildPlacemarkGeo` debe dar EXACTAMENTE `toGeoJSON()` (redondeo a 6 decimales, cierre de anillo a 1e-9): lo vigila `tests/browser/lazy-layers.mjs` contra Leaflet real. Mide siempre con un límite de heap bajo, no solo con el de la máquina. `new Array(n)` falla `tests/statics.js`.
