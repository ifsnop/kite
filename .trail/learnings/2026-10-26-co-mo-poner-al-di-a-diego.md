---
title: "Cómo poner al día la rama `debug` (vigilante del hilo principal) con main"
author: Diego
date: 2026-10-26
id: l-22026b44
scope: repo
status: active
touches:
  - build.js
  - tests/statics.js
  - src/js/99-boot.js
  - src/js/10-map.js
  - kitelocal.html
  - kitelocal.min.html
  - tests/run-all.js
  - "src/js/31-tree-node.js#invalidateGeo"
  - "tests/browser/elev-sources.mjs#html"
---

## Decided
La rama `debug` es `main` + un vigilante del hilo principal (`src/js/98-watchdog.js`, `__kiteDiag()`), para depurar cuelgues o lentitud que surgen en main. Nunca se fusiona en main. Se puso al día el 2026-10-12 (merge `31c45f7`, sobre v1.7.0) a petición del usuario.

**Procedimiento:**
1. `git checkout debug && git merge --no-commit main` — **merge, NUNCA rebase**: la rama está publicada y un rebase obligaría a `push --force`. Es lo que dice el propio README de la rama.
2. Conflictos: tomar la versión de main (`git checkout --theirs …`) salvo lo propio de debug:
   - `build.js`: `"98-watchdog.js"` sigue en el manifiesto `JS`, justo antes de `99-boot.js`.
   - `tests/statics.js`: `"getComputedStyle"` en `GLOBALS` (lo usa el vigilante).
   - `src/js/99-boot.js`: `startWatchdog(); startUiWatchdog();` al final del arranque (suele fusionarse solo).
   - `src/js/10-map.js` (`BUILD`), `kitelocal.html`, `kitelocal.min.html`: lado de main; se regeneran con `npm run build` y el hook sube `BUILD` al commitear.
   - README: igual en las dos ramas (main ya trae la sección del `debug`).
3. Comprobar que los nombres de `WD_WATCHED` siguen existiendo en `src/js` como `function` (el vigilante envuelve `window[name]`; una `const` no se puede envolver — `invalidateGeo` ya lo es y nunca se envolvió).
…

## Watch out
cuando pida «actualiza debug» o similar, seguir estos pasos sin volver a investigar la estructura de la rama.

_From Claude Code's memory of this repo, last updated Oct 12._
