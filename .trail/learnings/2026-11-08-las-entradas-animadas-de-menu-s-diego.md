---
title: "Las entradas animadas de menús y ventanas son @keyframes, no @starting-style, y se colocan con offsetWidth"
author: Diego
date: 2026-11-08
branch: feat/apple-design-motion
cost: { minutes: 19, tokens: 506580 }
id: l-378294e7
scope: repo
status: active
src: agent
touches:
  - tests/browser/motion.mjs
  - tests/statics.js
  - kitelocal.min.html
  - src/styles.css
  - src/js/70-view-controls.js
---

## Decided
Menú contextual, popover de color y ventanas entran con `@keyframes` solo con `from` (120/160 ms, sin rebote); cerrar es inmediato. Toda `animation:` tiene su `animation: none` en `prefers-reduced-motion` y `tests/statics.js` lo exige. Las suites de navegador piden `reducedMotion: "reduce"` por defecto; solo `motion.mjs` pide `no-preference`.

## Tried and ruled out
`@starting-style` (la opción natural para pasar de `hidden` a visible): el minificador del build (clean-css) no la conoce y la destroza en `kitelocal.min.html` — perdió la regla de `.dlg-box` y dejó un `@starting-style{transform:scale(.98)}` suelto. El legible funcionaba y el minificado no, así que solo lo habría cazado `app.mjs` (legible frente a minificado).

## Watch out
Mientras una caja se anima, `getBoundingClientRect()` lleva la escala de la entrada: `openCtxMenu` calculaba el tope contra el borde con un ancho hasta un 4 % menor y el menú se salía 4,8 px. Para colocar una caja que se anima, `offsetWidth`/`offsetHeight`.
En las pruebas: `getComputedStyle().transitionDuration` es una lista (una por propiedad), y tras Cancelar en Propiedades el tema se reaplica con transición de 250 ms: medir colores solo cuando `theme-switching` ya no está.

In the code: `src/styles.css` («Entradas ancladas»), `src/js/70-view-controls.js` (`openCtxMenu`), `tests/browser/motion.mjs`, `.claude/rules/motion.md`.
