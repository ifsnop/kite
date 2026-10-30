---
title: "Menú contextual del visor: cuatro filas con submenús, sin entradas que repitan botones"
author: Diego
date: 2026-10-30
branch: feat/menu-contextual-reordenado
cost: { minutes: 1, tokens: 1724 }
id: l-7ee8d062
scope: repo
status: active
src: agent
touches:
  - tools/capturas.mjs
  - tests/docs.js
---

## Decided
- `CTX_MENU_ITEMS` (sin capa bajo el cursor) son cuatro filas sin separadores: «Copiar coordenadas», «Consultas ▸» (Elevación, Parcela catastral), «Medir ▸» (Ruta, Círculo, Arco) y «Crear ▸» (Polígono o línea, Pin). Un grupo del mismo tema es un submenú con hojas independientes, because con catorce filas sueltas el menú desbordaba.
- Fuera del menú, a propósito: los tres «Centrar…», «Paralelos y meridianos» y «Exportar PNG», because ya tienen su botón en la barra del visor y repetirlos estorba.
- «Consultar elevación aquí» pasa a «Elevación», because bajo «Consultas» sobraban «Consultar» y «aquí».

## Tried and ruled out
- Una entrada combinada «Elevación y parcela catastral»: ruled out, because el usuario pidió dos entradas distintas que se activan por separado, como en «Medir».

## Watch out
- Se quitó el soporte de `checked()` (interruptores) de `renderCtxItems`, because ninguna entrada lo usaba; otherwise sería código muerto. Si hace falta otra vez, reañadirlo con su prueba.
- Las suites que eligen «Elevación» o «Parcela catastral» fail with «sin entrada» si no abren antes «Consultas ▸» y buscan la hoja en `.ctx-menu:not(#map-ctxmenu)`; `tools/capturas.mjs` igual.
- `tests/docs.js` fails with «no la cita» si una etiqueta del menú no está entre « » en el apartado 5 del manual.
