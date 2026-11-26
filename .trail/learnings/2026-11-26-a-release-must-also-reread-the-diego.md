---
title: "A release must also reread the README's feature claims, not only the study: three had gone stale"
author: Diego
date: 2026-11-26
branch: release/v2.8.2
cost: { minutes: 19, tokens: 41770 }
id: l-67212e93
scope: repo
status: active
src: agent
touches:
  - docs/pendientes-y-propuestas-kite-local.md
  - kitelocal.html
  - kitelocal.min.html
  - src/js/10-map.js
  - src/js/32-geojson.js
  - tests/README.md
  - tests/lazytree.js
  - tests/toolstest.js
  - tests/docs.js
  - DEVELOPMENT.md
---

## Decided
Preparing 2.8.2, the README's «Supported KML subset» still said that only line and polygon styles are read, that Google Earth icon styles are not supported, and that imported marker icons are replaced by the default marker. All three had stopped being true in 2.8.1 (a point keeps the colour, size and shape of its IconStyle) and nobody noticed, because `tests/docs.js` compares numbers, versions and servers, never prose about behaviour. They were rewritten in the release commit, and DEVELOPMENT.md «Done» got the two items of the cycle (the KML marker styles, and how timing is handled in tests).

## Tried and ruled out
Relying on the 2.8.1 change to have updated the README: that change touched the manual, the study and the rules, and the README row for KML import did not look like part of it. The check that found the stale lines was a plain grep of the README for the words of the feature («icon», «style», «Google Earth»).

## Watch out
- Release step to add to the usual list: grep the README (not only the manual and the study) for the vocabulary of each user-visible change since the last version, and read the claim around every hit.
- The «Novedades» lines are read as a user would and ordered by importance: the one that says a feature works again goes first.
- The captures are regenerated for the version of `capturas.json`, not because they changed: only the Novedades window (it lists the new version) differs in content; the rest change a few hundred bytes of tile noise. The README clips, the cover GIF and the social image were left alone on purpose (nothing they show changed; the clips use live services that need a human look).
- In the code: `README.md` («Supported KML subset»), `DEVELOPMENT.md` («Done»), `src/js/68-whats-new.js`, `docs/img/capturas.json`.
