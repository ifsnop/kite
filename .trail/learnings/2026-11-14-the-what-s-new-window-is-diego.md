---
title: "The what's new window is filled line by line in the 'next' entry and renamed at release; its footer keeps one button because the user asked for it"
author: Diego
date: 2026-11-14
branch: feat/whats-new
cost: { minutes: 33, tokens: 1030890 }
id: l-de3acfb4
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - README.md
  - docs/estudio-seguridad-kite-local.md
  - docs/img/capa-base-propia.png
  - docs/img/capturas.json
  - docs/manual-usuario-kite-local.md
  - docs/pendientes-y-propuestas-kite-local.md
  - kitelocal.html
  - kitelocal.min.html
---

## Decided
- A «Novedades» window at startup sums up, in plain non-technical sentences, what each release brought. First time: everything since 2.0. «Don't show again» holds until a newer version, which lists from the version last run.
- Every PR a user can see adds one sentence to the "next" entry; "next" is never shown, and preparing a release renames it to the new version (a test fails if package.json's version has no entry).
- The user asked for a «Cerrar» button besides the ×, so this window keeps a one-button footer (it also holds the checkbox), as an exception to the rule that removes such footers.

## Watch out
- The window is modal and opens at every start: every browser-test context must go through stubTiles (which sets the skip flag), and the capture/GIF tools set it too. A suite with its own newContext that skips stubTiles will have its first click swallowed.
- On a phone it waits for the «better from a computer» notice instead of stacking on it.

In the code: src/js/68-whats-new.js (WHATS_NEW, whatsNewPlan, whatsNewEntries), key "whatsNew" in src/js/32-geojson.js, mobileNoticeThen in src/js/50-splitter.js, window.__kiteSkipWhatsNew set in tests/browser/_browser.mjs stubTiles, tools/capturas.mjs and tools/_demo.mjs; footer exception in tests/statics.js; rule .claude/rules/whats-new.md (new file: needs git add -f).
