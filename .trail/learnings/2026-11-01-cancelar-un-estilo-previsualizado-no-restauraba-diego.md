---
title: Cancelar un estilo previsualizado no restauraba stroke ni opacity de un polígono importado
author: Diego
date: 2026-11-01
branch: feat/servicios-arcgis-mapserver
cost: { minutes: 17, tokens: 714696 }
id: l-9df76fed
scope: repo
status: active
src: agent
touches:
  - src/js/42-hittest.js
  - tests/browser/multiedit.mjs
---

## Decided
`applyPolygonStyle` aplica `{ ...PATH_STYLE_DEFAULTS, ...li._style }` (los valores por defecto de `L.Path`) en vez de `li._style` a secas (`src/js/42-hittest.js`).

## Tried and ruled out
Restaurar la foto de Cancelar tal cual (`t._style = snap.style; applyPolygonStyle(t)`): fails with «false,true,0.3» tras Cancelar porque `L.Path.setStyle` solo añade las claves que recibe y un estilo importado (`geojsonStyle`, KML) no trae `stroke`, `opacity` ni `fillColor` hasta que el usuario los toca. Se midió con un GeoJSON: «Solo relleno» + opacidad 0,3 y Cancelar dejaba `stroke:false, opacity:.3`. Usar `normalizePathStyle` para aplicar: cambiaría el `fillOpacity` de lo que no lo trae (0,35 en vez del 0,2 de Leaflet).

## Watch out
Salió al añadir la opción «Ninguno» (`pg-mode` = `none`, `stroke:false, fill:false`): sin este arreglo, Cancelar dejaba el polígono invisible. `tests/browser/multiedit.mjs` lo cubre con un estilo SIN esas claves (el de un archivo importado): con un estilo completo el fallo no se ve.
