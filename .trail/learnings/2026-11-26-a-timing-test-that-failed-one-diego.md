---
title: "A timing test that failed one run in eight was a real clock-read race, and the cure is a manual clock plus polling, not wider waits"
author: Diego
date: 2026-11-26
branch: fix/info-stack-timer-race
cost: { minutes: 33, tokens: 134519 }
id: l-cec8700e
scope: repo
status: active
src: agent
touches:
  - kitelocal.html
  - kitelocal.min.html
  - src/js/10-map.js
  - src/styles.css
  - tests/browser/routing.mjs
  - src/js/32-geojson.js
  - tests/toolstest.js
  - tests/lazytree.js
  - tests/README.md
---

## Decided
The failures of the info card's expiry test were not slowness. The test sat on a knife edge (a 20 ms warning equals the timer's own 20 ms of slack, so the first re-check lands on the very instant a row expires), and the code had a real gap there: `refreshInfoStack` read the clock to decide whether a row was alive and `scheduleInfoStackTick` read it AGAIN to plan the next check; if the millisecond turned between the two reads, the row was alive for the first and past its end for the second, so no timer was armed and the row stayed listed until something else refreshed the card. Node and the browsers can also fire a timer a little EARLY against `Date.now()`, which makes the edge easy to hit. The fix reads the clock once per cycle and treats an expired-but-listed row as an event that is due. Production exposure was small (the default warning is 5 s), but it was real.
Tests: the suite gets a manual clock (`Date.now`, `setTimeout`, `clearTimeout` injected into the extracted code, `advance(ms)` runs due timers in order, with `early` and `step` options to model early timers and a clock that ticks between reads), one smoke case keeps the real `setTimeout`, and the blink test in `lazytree.js` polls a condition instead of sleeping 38 ms. 150 runs of the first suite and 50 of the second with six CPU processes on four cores: no failure (before: about 1 in 8 and 4 in 12).

## Tried and ruled out
Widening the waits (an earlier idea): the failure does not depend on how long the test waits, only on the edge, so more time cannot fix it. Retrying the CI: hides it. Node's built-in `mock.timers`: exists on Node 18.19 but experimental and without Date, and the project supports Node 18.

## Watch out
- Measure before explaining: the first guess («loaded runner») was incomplete; instrumenting the timers of one failing run (requested 104 ms, fired at 103.5, no third timer armed) showed the real cause in minutes.
- Never kill load generators with `pkill -f` on a string that also appears in your own command line: it kills your shell.
- A fixed sleep before a NEGATIVE assertion is harmless (waiting longer can only reveal more); before a POSITIVE one it is a flake. Poll the condition.
- Other suites with real waits (`msglog`, `clipboard`, `offline`, `statics`) gave no failures in 12 runs under load; recheck if one ever flakes.
- In the code: `scheduleInfoStackTick(now)` and `refreshInfoStack` (`src/js/32-geojson.js`), `makeClock`/`waitUntil` (`tests/toolstest.js`), `waitFor` (`tests/lazytree.js`), «El tiempo en las pruebas» in `tests/README.md`.
