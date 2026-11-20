---
title: Al quitar el filtro del panel solo se queda abierto lo que el filtro abría para enseñar lo seleccionado
author: Diego
date: 2026-11-19
branch: feat/filter-folder-content
cost: { minutes: 1, tokens: 2159 }
id: l-ee24b946
scope: repo
status: active
src: agent
touches:
  - tests/browser/tree-filter.mjs
  - src/js/45-tree-filter.js
---

## Decided
Al quitar el filtro (×, Escape o menos de tres letras), las carpetas que EL FILTRO tenía abiertas (`filter-open`) y que contienen una fila seleccionada, o que están seleccionadas ellas mismas, se abren de verdad (`collapsed` fuera, `syncExpanded`, `scheduleSave`) y la fila del cursor se lleva a la vista, because antes volvían a su `collapsed` guardado y el resultado elegido desaparecía dentro de una carpeta cerrada.

## Tried and ruled out
Abrir todos los ancestros de lo seleccionado (como hace `highlightNode`): fails porque una selección anterior al filtro dentro de una carpeta cerrada a mano la abriría, y la carpeta que el usuario cerró con el filtro puesto (`filterClosed`) se reabriría contra su gesto. Solo cuenta lo que abrió el filtro.

## Watch out
Abrir una carpeta que quedó a medio construir la completa (el bucle de `partialFolders` que sigue), otherwise quedaría con solo parte de sus hijas: revelar un resultado dentro de una carpeta de 20 000 capas cuesta lo que abrirla a mano. En `tests/browser/tree-filter.mjs` la sección 14 deja «Madrid» seleccionada y por tanto abierta al quitar el filtro; la 16 parte de ahí. Tras recargar, «Interior» vuelve a ser carpeta pendiente y con «zon» hay más de 300 coincidencias pendientes, so no se construye: para probar esto se usa «zona c».

In the code: `src/js/45-tree-filter.js` (`foldersToKeepOpen`, `clearTreeFilter`), `tests/browser/tree-filter.mjs` (sección 16).
