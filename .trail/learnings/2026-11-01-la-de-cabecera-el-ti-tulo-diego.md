---
title: "La × de cabecera: el título que el código reescribe va en un span, y la × pulsa el botón de Cancelar"
author: Diego
date: 2026-11-01
branch: feat/servicios-arcgis-mapserver
cost: { minutes: 8, tokens: 52779 }
id: l-d886e60e
scope: repo
status: active
src: agent
touches:
  - tests/browser/i18n.mjs
  - docs/img/registro-avisos.png
  - docs/img/propiedades-preferencias.png
  - docs/img/calculos-geodesicos.png
---

## Decided
Todos los diálogos llevan `<h2 class="dlg-head"><span class="dlg-title">…</span><button class="dlg-close" data-cancel="<id>">×</button></h2>`, y un único escuchador delegado (`43-points-editor.js`) hace `.click()` del botón que dice `data-cancel`, porque así la × hace exactamente lo que ya hace Cancelar/Cerrar (y Escape) sin duplicar lógica. El pie con sus botones se queda.

## Tried and ruled out
Escribir el título con `h2.textContent = …`: fails porque borra la × (el botón es hijo del `<h2>`); por eso los títulos que el código reescribe (`style-title`, `desc-title`, `ktp-title`, `points-title`, `attr-title`) llevan su `id` en el `<span class="dlg-title">`. Dar a cada × su propio manejador: habría repetido la lógica de cancelar de 17 diálogos.

## Watch out
Un test que lea el título del diálogo debe leer `h2 .dlg-title`, no `h2`: el `textContent` del `<h2>` acaba en «×» (rompió `tests/browser/i18n.mjs`). La × cambia el aspecto de TODAS las figuras con diálogo del manual: hay que regenerar con `npm run capturas` (necesita red para el mapa).
