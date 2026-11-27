---
title: "The base-map export test's reload check failed once on CI; it now waits for IndexedDB to match instead of sleeping, and the cause was not reproduced"
author: Diego
date: 2026-11-27
branch: main
cost: { minutes: 11, tokens: 147110 }
id: l-163fe03e
scope: repo
status: active
src: agent
touches:
  - tests/browser/bases-export.mjs
  - src/js/70-view-controls.js
  - src/js/11-base-panel.js
---

## Decided
The check «tras recargar todo sigue igual» failed once on CI (run 45915018772, merge of PR #108), the first failure ever of that suite. The test slept 700 ms before reloading while the base maps are saved 500 ms after the last change and then written to IndexedDB asynchronously: a positive assertion behind a fixed sleep. It now polls the saved records (order, on/off and opacity per layer, user layers, background) until they equal the state in memory, with its own check, and the reload check prints which value differed.

## Tried and ruled out
Reproducing it locally: 8 runs of the old test with six busy loops on four cores, and 4 more with the page CPU throttled 8x through CDP before the reload, all passed. So the 200 ms margin is not proven to be the cause; it is the only timing dependency in that step.

## Watch out
If it fails again, the new messages tell the two cases apart: «lo guardado en IndexedDB llega a ser lo que hay en memoria» failing means the save never happened (a code bug in scheduleBaseSave / applyBasesImport), the reload check failing with persisted state means the restore in 99-boot.js is wrong.

In the code: tests/browser/bases-export.mjs section 4; scheduleBaseSave in src/js/70-view-controls.js; applyBasesImport in src/js/11-base-panel.js.
