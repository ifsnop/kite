---
title: "Llegar a una coincidencia en una carpeta sin desplegar construye la carpeta entera (6,9 s con 20 000 capas); construir solo las coincidentes cuesta milisegundos"
author: Diego
date: 2026-11-08
branch: feat/apple-design-motion
cost: { minutes: 18, tokens: 437435 }
id: l-8c38625e
scope: repo
status: active
src: agent
touches:
  - src/js/40-panel-actions.js
  - src/js/31-tree-node.js
  - src/js/32-geojson.js
  - src/js/30-tree-walk.js
---

## Decided
El usuario quiere que el buscador del panel deje en el árbol SOLO lo que coincide (sin mayúsculas, dentro de las palabras), en vez de saltar de una coincidencia a otra. Medido con 20 000 polígonos perezosos (Chromium sin GPU, cada caso en página limpia): hoy llegar a UNA coincidencia construye las 20 000 filas, ≈ 6,9 s, coincidan 38 o 4 000; construir solo las coincidentes cuesta 5 ms (38), 18 ms (200), 84 ms (1 000), 0,46 s (4 000) y 1,9 s (10 000), proporcional a las coincidencias. Por eso se propone construir solo las coincidentes con un tope (~300, < 100 ms) y, por encima, la carpeta cerrada con un contador, because teclear «z» coincide con media carpeta y construirla antes de acabar la palabra cuesta ~2 s. Recorrer los datos para encontrarlas es barato: 5 ms con 38 coincidencias, 29 ms con una sola letra (por el array que `findMatches` copia en cada registro).

## Tried and ruled out
Construir la carpeta entera y ocultar lo que no coincide: fails porque suma 6,9 s de construcción más 134 ms de ocultar 20 000 filas; solo vale para filas que ya existen. Mantener la búsqueda en vivo que salta a la primera coincidencia: ya hoy dispara esos 6,9 s mientras se teclea.

## Watch out
`ensureMaterialized` es todo o nada: toma el `_pending` entero, así que construir solo algunas filas NO existe y hay que escribirlo. `serializeNode` toma los hijos de `_pending` O del DOM, nunca de los dos, y `materializeRecords` añade al final: con construcción parcial el guardado perdería filas o rompería el orden, otherwise. La idea es serializar recorriendo `_pending` en orden y, para cada registro con fila, serializar la fila (puede estar editada). Revisar también `containerState` y `cascadeVisibility`, que ya miran las dos fuentes. Con 20 000 filas ya construidas, construir 400 más tardó 213 ms frente a 18 ms en página limpia: un árbol grande ralentiza lo que se construya después (causa sin investigar). Las filas ocultas hay que sacarlas de `isRow` o las flechas, Mayús+rango y Ctrl+A aterrizan en ellas.

In the code: `src/js/40-panel-actions.js` (`findMatches`, `searchMatches`, `resolveMatch`), `src/js/31-tree-node.js` (`ensureMaterialized`), `src/js/32-geojson.js` (`materializeRecords`, `serializeNode`, `serializePendingRecords`), `src/js/30-tree-walk.js` (`isRow`, `nextRow`).
