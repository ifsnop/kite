---
title: "Las capas de un servicio ArcGIS comparten campos: la asociación de nombre va por capa (huella con origen)"
author: Diego
date: 2026-11-01
branch: feat/servicios-arcgis-mapserver
cost: { minutes: 12, tokens: 797245 }
id: l-d1ad7a17
scope: repo
status: active
src: agent
touches:
  - docs/img/capturas.json
  - docs/img/servicio-arcgis-atributos.png
  - docs/manual-usuario-kite-local.md
  - kitelocal.html
  - kitelocal.min.html
  - src/js/04-i18n-en.js
  - src/js/10-map.js
  - src/js/31-tree-node.js
  - src/js/41-selection.js
  - src/js/66-arcgis.js
---

## Decided
`propsFingerprint(props, scope)` antepone un origen `arcgis:<servicio>#<id de capa>` + «\n» a las claves, y `addFileNode` lo recibe como `nameScope` (`file.kiteNameScope`, puesto por `arcgisFetchLayerData`). Cada capa traída de un servicio tiene su propia asociación en «Índices de GeoJSON»; sin origen la huella es la de siempre, así que no sube `GNP_SCHEMA`.

## Tried and ruled out
Dejar la huella solo con las claves: fails porque las capas de un mismo servicio comparten casi todos sus campos (`OBJECTID`, `NAME_TXT`, `TYPE_CODE`…) y la asociación elegida para una se aplicaba en silencio a las demás, que no tienen por qué llamarse igual (bug reportado al traer capas de ENAIRE). Subir `GNP_SCHEMA` para añadir el origen: habría descartado las asociaciones que el usuario ya tiene guardadas sin necesidad.

## Watch out
`splitFingerprint` separa por «\n»: es inequívoco porque el JSON de las claves escapa los saltos de línea y empieza por «[». El test de navegador (`tests/browser/arcgis.mjs`) necesita DOS capas con los mismos campos (la 10 y la 0 del servicio simulado); con una capa de otra forma no se ve el fallo.
