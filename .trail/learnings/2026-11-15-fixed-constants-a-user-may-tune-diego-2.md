---
title: "Fixed constants a user may tune are advanced preferences read as CFG, and a window is fitted inside the browser without saving the forced place"
author: Diego
date: 2026-11-15
branch: feat/settings-tabs-and-window-fit
cost: { minutes: 11, tokens: 50305 }
id: l-6bb5b166
scope: repo
status: active
replaces: l-8cbcf5c8
src: agent
touches:
  - src/styles.css
  - tests/_extract.js
  - src/js/43-points-editor.js
  - src/js/44-dialogs.js
  - docs/img/propiedades-preferencias.png
---

## Decided
- The constants a user may want to change became settings of Propiedades through ONE table, `TUNABLES` (`04-tunables.js`), read as `CFG.<old constant name>`. A useful selection (~60), and no reset button: «Restaurar» wipes the database, which brings the defaults back.
- They are ADVANCED preferences (the user asked to tell them apart): tabs Interfaz, Fichas, Mapa y teclado, Archivos, Red with their names in red, plus rows under a red «Avanzadas» heading in «Elevación y perfil». A «Preferencias avanzadas» box (last row of Preferencias, off by default, saved on Accept) shows them. Hidden does not reset: the values still apply. Options that were always visible stay visible (the KMZ size stays in Preferencias, the Fresnel frequency keeps its tab).
- Only values read at use time can be settings; load-time copies (`MAX_ZOOM`, `ELEV_WINDOW`, intervals) stay constants. Only what differs from a default is saved. The bounds keep the anti-hostile-file limits and the network discipline.
- `fitInViewport` keeps a moved window WHOLE inside the browser (on open, on resize, when the card's content grows). Dragging stays free.

## Tried and ruled out
- Saving the fitted card position: a smaller window would overwrite the user's place. It is kept apart (`infoBoxPlace`); only a drag changes it.
- Resizing to fit: `.dlg-box` max-width/height already cap the size.

## Watch out
- Suites that extracted a moved constant with `constDecl`/`between` break: `tests/_extract.js` installs the delivered `CFG` as a global.
- `trail check` flags Spanish word overlaps as conflicts here; false positives.

In the code: src/js/04-tunables.js; src/js/43-points-editor.js (buildTunableRows, setTunable, applyAdvancedPrefs, fitInViewport); src/js/44-dialogs.js (infoBoxPlace, placeInfoBox); keys "tunables" and "advancedPrefs" in 32-geojson.js; rule .claude/rules/tunables.md.
