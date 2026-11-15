---
title: "What's new lists every version since the one last used, and with nothing saved it lists everything since 2.0"
author: Diego
date: 2026-11-15
branch: test/whats-new-skipped-versions
cost: { minutes: 15, tokens: 709276 }
id: l-b413523e
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - README.md
  - build.js
  - docs/estudio-seguridad-kite-local.md
  - docs/img/capturas.json
  - docs/img/propiedades-ajustes.png
  - docs/img/propiedades-fuentes.png
  - docs/img/propiedades-preferencias.png
  - docs/img/propiedades-restaurar.png
  - docs/manual-usuario-kite-local.md
---

## Decided
- The «Novedades» window lists every released version after the one last opened in that browser (last used 2.4.0, opening 2.7.0 → 2.7.0, 2.6.0, 2.5.0). A user reported «only the latest» as a bug; it was not one, so only tests were added to fix the behaviour.
- With no saved record (users of versions before 2.6.0, when the window was born, and first-time users) it keeps listing everything since 2.0.0: chosen by the user.

## Tried and ruled out
- Telling old users from new ones by whether the browser already has saved data (new ones would see nothing): not wanted by the user.
- Showing only the current version when nothing is saved: not wanted either.

## Watch out
- The browser test simulates a jump of three releases; a change that lists only the latest version fails both suites (checked by mutating the decision).

In the code: src/js/68-whats-new.js (whatsNewPlan, whatsNewEntries, key "whatsNew" with shownFor/since/dismissed); tests/whatsnew.js «Several versions skipped»; tests/browser/whats-new.mjs section 4.
