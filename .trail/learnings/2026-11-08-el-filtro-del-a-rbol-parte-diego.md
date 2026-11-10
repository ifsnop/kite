---
title: "El filtro del árbol parte los registros pendientes en filas y resto disjuntos, y guarda fusionando por la posición original"
author: Diego
date: 2026-11-08
branch: feat/filtro-arbol
cost: { minutes: 16, tokens: 133915 }
id: l-fb92a24e
scope: repo
status: active
src: agent
touches:
  - src/js/45-tree-filter.js
  - tests/browser/tree-filter.mjs
  - build.js
  - src/js/32-geojson.js
  - src/js/31-tree-node.js
  - src/js/30-tree-walk.js
  - docs/img/pie-panel.png
---

## Decided
Para construir solo las coincidentes, `li._pending` se PARTE en dos conjuntos disjuntos: lo elegido pasa a filas y el resto sigue pendiente. Cada registro lleva su índice original (`_pos`) y `serializeChildren` fusiona filas y pendientes por él, because si no las coincidentes saltarían al principio de la carpeta tras guardar y recargar. Tras reordenar las filas a mano no hay posición que respetar: van como están y los pendientes detrás. El filtro nunca toca `collapsed`: la carpeta se ve abierta con la clase `filter-open`, y lo oculto es `li.hidden`, que `isRow` salta (flechas, rangos y Ctrl+A sin más cambios). Tope global de 300 coincidencias a construir; por encima, carpeta cerrada con «(n)». Menos de 3 letras quita el filtro; teclear ya no salta a la primera coincidencia.

## Tried and ruled out
Dejar `_pending` entero y construir filas de algunos registros: fails porque `containerState`, `cascadeVisibility`, la tabla de atributos y los límites leen filas Y registros y contarían cada capa dos veces. Filas de solo vista en un `<ul>` aparte: renombrar o borrar no llegaría al registro. Abrir con `highlightNode` para enseñar coincidencias: quita `collapsed` y se guarda.

## Watch out
`serializeNode` tomaba hijos de `_pending` O del DOM, nunca de los dos: ya perdía filas al soltar un archivo en una carpeta colapsada con pendientes. `lazytree.js` y `navtest.js` extraen funciones por nombre: cada ayudante nuevo hay que añadirlo allí. `waitAppReady` no espera a que acabe la restauración tras recargar. Con el disco lleno, un script Python que reescribía `build.js` lo dejó truncado a 8 192 bytes: escribir a temporal, `fsync` y `rename`.

In the code: `src/js/32-geojson.js` (`serializeChildren`, `placementAnchor`), `src/js/31-tree-node.js` (`materializeMatching`), `src/js/45-tree-filter.js`, `tests/browser/tree-filter.mjs`.
