---
title: "Every pin, shape and measurement has an info card (a basic one if it carries no attributes), but hovering still opens only a layer's own card"
author: Diego
date: 2026-11-12
branch: feat/info-card-stack
cost: { minutes: 47, tokens: 1876296 }
id: l-58b2bcd8
scope: repo
status: active
src: agent
touches:
  - src/js/32-geojson.js
  - tests/browser/info-stack.mjs
  - src/js/41-selection.js
  - src/js/31-tree-node.js
  - tests/browser/context-menu.mjs
  - tests/browser/sun-times-info.mjs
  - tests/browser/dialogs.mjs
  - src/js/44-dialogs.js
  - docs/img/ficha-pila.png
  - tests/toolstest.js
---

## Decided
«Mostrar atributos» must list the same layers as «Ir al nodo» and «Editar propiedades». A pin made by hand or a drawn shape has no description and no properties, so it used to be left out (reported with a polygon with attributes and three pins inside it). Now such a layer shows a basic card: name, kind, and its position (marker) or measures (shape, measurement), in the units and coordinate format of Properties. The row's ℹ and the «Atributos» tab follow the same rule. Hovering still opens only a layer's OWN card, or crossing any pin would open a window.

## Tried and ruled out
Asking `styleKind(li)` in `makeActions` to decide whether a row gets the basic card: it fails because `li._measure` (and the other kind flags) are set after `makeNode`, and `styleKind` caches its first answer, so a measurement would be cached as a marker for good. The decision is made there from `styleable` and `layerKind(layer)` instead, stored as `li._basicInfo`.

## Watch out
Tests that count `.props-grip` or read `.props td` across the whole page now also see the «Atributos» tab of a style dialog opened earlier (it holds the basic card): scope them to `#desc-dialog`.

In the code: src/js/41-selection.js `basicInfoProps`, `basicInfoHtml`, `infoHtmlFor`, `hasInfo`; src/js/31-tree-node.js `makeActions` (`li._basicInfo`); tests/browser/context-menu.mjs (the reported case), tests/browser/sun-times-info.mjs, tests/browser/dialogs.mjs (scoped selectors).
