---
title: "Fixed constants a user may tune live in one table read as CFG, and a window is fitted inside the browser without saving the forced place"
author: Diego
date: 2026-11-15
branch: feat/settings-tabs-and-window-fit
cost: { minutes: 69, tokens: 706407 }
id: l-8cbcf5c8
scope: repo
status: active
src: agent
touches:
  - src/js/04-tunables.js
  - build.js
  - src/js/32-geojson.js
  - src/js/99-boot.js
  - src/styles.css
  - tests/tunables.js
  - tests/browser/tunables.mjs
  - CLAUDE.md
  - tests/_extract.js
  - tests/toolstest.js
---

## Decided
- The constants a user may want to change became settings of Propiedades (six tabs: Interfaz, Fichas, Mapa y teclado, Archivos, Red, Elevación y perfil) through ONE table, `TUNABLES` in `src/js/04-tunables.js`, and a live object `CFG`. Each entry keeps the constant's old name as its id (`CFG.INFO_STACK_MAX`) so greps still land; the old `const` is removed from its file. The user chose a useful selection (~60), not every number, and no reset button of its own: «Restaurar» wipes the database and that already brings the defaults back.
- Only what is read when used can be a setting. Anything copied at load time stays a constant (`MAX_ZOOM` into the map and base layers, `ELEV_WINDOW` into the elevation lattice, intervals started once).
- Saved as one key `tunables` with only the values that differ from the default, so a later change to a default reaches users who never touched it.
- Bounds are protections: import limits and network timeouts/retries have hard maxima so the anti-hostile-file limits and the request discipline hold whatever the user sets.
- Windows: `fitInViewport` puts the WHOLE moved window inside the browser window on open, on browser resize (every box given to `makeDialogMovable` is registered) and when the info card's content changes size. Dragging stays free (the user chose it): `clampToViewport` still only keeps the title reachable.

## Tried and ruled out
- Saving the fitted position of the info card: a smaller window would overwrite the place the user chose, and a bigger window later could not give it back. The chosen place lives apart (`infoBoxPlace`) and only a drag of the title changes it.
- Resizing a window to fit: `.dlg-box` already caps the rendered size with max-width/max-height, so only the position moves and a saved size survives.
- Making `PF_K_FACTOR` tunable: its value is written into the profile's labels («k = 4/3»).

## Watch out
- Test suites that extracted a moved constant with `constDecl("X")` or `between("const X", …)` break: `tests/_extract.js` now installs the delivered `CFG` as a global; a suite needing another value sets `CFG.X` and restores it, or passes its own `CFG` as a `new Function` parameter (as `tests/toolstest.js` does).
- `trail check` flags Spanish word overlaps («por restaurar», «solo con las») as conflicts on this change; they are false positives.

In the code: src/js/04-tunables.js (TUNABLES, CFG, validTunables, tunableOverrides); src/js/43-points-editor.js (buildTunableRows, setTunable, TUNABLE_EFFECTS, fitInViewport, floatingBoxes); src/js/44-dialogs.js (infoBoxPlace, placeInfoBox, resize listener); src/js/32-geojson.js (dbSaveTunables/dbLoadTunables, key "tunables"); tests/tunables.js, tests/browser/tunables.mjs; rule .claude/rules/tunables.md.
