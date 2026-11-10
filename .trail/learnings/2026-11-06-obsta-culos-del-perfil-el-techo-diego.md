---
title: "Obstáculos del perfil: el techo AGL se suma al terreno que el propio perfil ya descargó, sin pedir nada más, y se guarda como foto con el perfil"
author: Diego
date: 2026-11-06
branch: feat/obstaculos-en-perfil
cost: { minutes: 43, tokens: 985477 }
id: l-e031c111
scope: repo
status: active
src: agent
touches:
  - src/js/20-kml-geom.js
  - tests/profileobstacles.js
  - tests/browser/elev-obstacles.mjs
  - docs/pendientes-y-propuestas-kite-local.md
  - src/js/63-route-profile.js
  - src/js/31-tree-node.js
  - src/js/42-hittest.js
  - src/js/43-points-editor.js
  - src/js/33-kml-import.js
  - src/js/35-export-formats.js
---

## Decided
Un polígono con altitud entra en el perfil de una ruta como obstáculo SOLO si está visible (casilla marcada) al obtener el perfil. Su techo se guarda ya en AMSL dentro del `profile` de la capa (`obstacles`), junto con las torres (`towers`): es una foto, y «Actualizar obstáculos» la rehace sin red. Si el modo de altitud del polígono es AGL (`relativeToGround`), la altura se suma al terreno de la serie MDT de ESE perfil en cada punto del tramo, no al terreno de los vértices del polígono. Z sin modo (GeoJSON, KML sin `<altitudeMode>`) = AMSL. Los modos del fondo marino se descartan con un aviso por archivo importado.

## Tried and ruled out
Pedir el terreno de cada vértice del polígono para convertir AGL a AMSL: los vértices pueden estar lejos de la ruta, habría más peticiones y el resultado casi no cambia. Se anota como límite en `docs/pendientes-y-propuestas-kite-local.md` (1.11).
Guardar el modo en `properties` del Feature: saldría en la tabla de atributos y en `ExtendedData`. Va como miembro propio `kiteAlt` del Feature.

## Watch out
Cambiar el modo en la lista de puntos o las torres en el perfil exige SUSTITUIR el objeto (`path.feature`, `group._profile`), nunca mutarlo: el guardado sabe qué ha cambiado por identidad. Mientras la carpeta no se despliega, el `profile` vive en `group._rec`, no en la fila.

In the code: `src/js/63-route-profile.js` (`profileObstacleFrom`, `collectProfileObstacles`, `persistProfileEdit`), `src/js/20-kml-geom.js` (`kmlAltitudeMode`, `featureAltMode`), `tests/profileobstacles.js`, `tests/browser/elev-obstacles.mjs`.
