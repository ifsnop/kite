---
title: "Una carpeta que coincide en el buscador enseña su contenido un nivel, con un único tope de construcción en dos fases; lo escrito se marca sin tocar el DOM"
author: Diego
date: 2026-11-19
branch: feat/filter-folder-content
cost: { minutes: 47, tokens: 561496 }
id: l-0f37ed75
scope: repo
status: active
src: agent
touches:
  - src/js/40-panel-actions.js
  - src/js/31-tree-node.js
  - tests/treefilter.js
  - tests/lazytree.js
  - tests/statics.js
  - src/js/45-tree-filter.js
  - src/styles.css
  - tests/browser/tree-filter.mjs
  - docs/img/filtro-arbol.png
---

## Decided
Decidido con el usuario (2026-11-19): en el filtro del panel, una carpeta que coincide por su nombre se ve abierta (`filter-open`, sin tocar `collapsed`) con todo lo que contiene, aunque sus hijas no coincidan; lo guardado abierto dentro se ve abierto, lo guardado cerrado sigue cerrado y al desplegarlo se construye ENTERO. Se admiten varias palabras (hasta 8, una máscara de bits): coincide quien lleva al menos una en su propio nombre y, con las de sus carpetas, todas. Lo escrito se marca con la CSS Custom Highlight API. Se descartó por ahora buscar en atributos (las fichas son lo pesado de un árbol real), seleccionar las coincidencias y los operadores `-palabra`/comillas (apuntados en `docs/pendientes…`, 3.12).
La construcción se PLANIFICA antes (un recorrido de filas y registros pendientes, 7 ms con 20 000) y va en dos fases bajo UN solo tope global de 300 filas: primero las coincidencias y su camino (si caben en total; si no, nada y «(n)» como antes) y después, en orden de documento y mientras quede presupuesto, el contenido de cada carpeta que coincide. La segunda fase se planifica OTRA vez, porque las carpetas que construyó la primera ya son filas con registros propios. Una carpeta que no cabe sale cerrada (`filterNoFit`) y se construye entera al abrirla: así una carpeta enorme que coincide no impide ver las coincidencias pequeñas de las demás.

## Tried and ruled out
Resaltar con `<mark>` dentro de la etiqueta: escribe en el DOM, despertaría el `MutationObserver` del filtro (que refiltra ante lo ajeno), chocaría con renombrar y con `updateMeasurement` (la etiqueta de una medición no es solo el nombre) y habría que deshacerlo al quitar el filtro. Con `CSS.highlights` solo hay rangos sobre el nodo de texto.
Dejar que una carpeta que coincide construya todo su contenido sin presupuesto: con 20 000 capas son ≈ 6,9 s. Contar el contenido enseñado como coincidencias: el contador y Intro saltarían por lo que solo se enseña.
Hacer visible el contenido solo mientras la subcarpeta esté abierta (`collapsed` de la fila): al desplegar a mano una subcarpeta ya construida sus hijas seguían `hidden` de la pasada anterior. La visibilidad por ámbito (`inScope`) vale para TODO el subárbol de la carpeta que coincide; lo que decide si se construye es otra cosa (`showing`, solo lo que se vería).

## Watch out
`kids` ya no puede significar «hay una fila hija visible»: dentro del ámbito todas lo son, y toda subcarpeta saldría abierta. `filterPass` devuelve dos bits: algo visible, y una coincidencia aquí o dentro (`deep`); solo `deep` abre una carpeta que no coincide.
En `planRecs` un registro solo entra en la lista de fase 2 si TODOS sus padres pendientes también (`reach`): `materializeMatching` elige primero los registros del nivel superior, así que un hijo cuyo padre no se construye no se construiría.
`tests/lazytree.js` y `tests/treefilter.js` extraen funciones por nombre (hay que añadir cada ayudante nuevo a las dos listas), `tests/statics.js` pide `WeakSet` y `Highlight` en `GLOBALS`, y un `const a = x, b = y;` confunde a esa comprobación (dos `const`). En los datos de prueba, una carpeta guardada `checked: true` con todas las hijas sin marcar cambia al construir su fila (la aplicación recalcula la casilla): no es el filtro, pero rompe «lo guardado es idéntico».

In the code: `src/js/45-tree-filter.js` (`planRows`, `planRecs`, `filterPass`, `paintHighlights`, `applyTreeFilter`), `src/js/40-panel-actions.js` (`searchTokens`, `tokenMask`, `maskMatches`, `highlightRanges`, `findMatches` con máscara heredada), `src/js/31-tree-node.js` (`expandFolder`, `li._fscope`), `src/styles.css` (`::highlight(kite-search)`, `--search-hl`), `tests/browser/tree-filter.mjs` (secciones 13-15).
