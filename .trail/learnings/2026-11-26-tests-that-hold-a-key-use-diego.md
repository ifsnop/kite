---
title: "Tests that hold a key use Playwright's page clock, and install() alone is not virtual time: pauseAt must freeze it"
author: Diego
date: 2026-11-26
branch: fix/keyboard-nav-virtual-time
cost: { minutes: 36, tokens: 1596227 }
id: l-6e8a300a
scope: repo
status: active
src: agent
touches:
  - DEVELOPMENT.md
  - README.md
  - docs/estudio-seguridad-kite-local.md
  - docs/img/anadir-url.png
  - docs/img/anillos-dialogo.png
  - docs/img/anillos-resultado.png
  - docs/img/arbol-estructura.png
  - docs/img/aviso-movil.png
  - docs/img/barra-herramientas.png
  - docs/img/borrar-capas.png
---

## Decided
`tests/browser/keyboard-nav.mjs` now runs on the page's virtual clock (`page.clock`): `install({ time })` fakes `Date`, timers, `requestAnimationFrame` and `performance.now`; `pauseAt` freezes them; `runFor(ms)` makes time pass a frame of 16.7 ms at a time. Holding a key is `down`, `runFor`, `up`; the keyboard and mouse stay real. Every assertion's bounds come from the model, not from a number picked by eye: a held arrow covers the integral of the speed profile (200 px at 0.5 s, 550 px at 1 s, 1200 px at 1.5 s), now pinned by a pure test in `tests/view-keys.js`. Before, six different checks failed with the machine busy and holding an arrow for a second gave 472 px against 550 nominal, because frames arrive late and the key loop caps `dt` at 0.1 s on purpose. No product change: the cap stays. Result with six CPU processes on four cores: 0 failures in 12 runs of the suite and in 40 wheel trials (before: at least six failing checks across 10 runs).

## Tried and ruled out
Lowering the 500 px threshold: it would have fixed one check and left the other five (Shift, 90°, diagonal, wheel) assuming a frame rate. Real-time waits with wider margins: the failure depends on the machine's frame pace, not on how long the test waits.

## Watch out
- `install()` alone leaves the fake clock RUNNING at real speed, so under load tens of real milliseconds crept into the "virtual" time (42 to 132 ms measured while a wheel call returned) and two wheel checks failed in 12 runs. `pauseAt` freezes it. Check with a run under load, not an idle one: idle looked deterministic with the clock running.
- `page.waitForTimeout` is REAL time and does not advance the page's clock; a timer created before `install` stays real.
- Measure first: an instrumented run (the virtual time elapsed during one call) found the cause in one try, after two wrong guesses.
- Other browser suites keep fixed waits (167 in 33 suites, `browser-tests.md` says never): by the user's decision they are fixed only when they fail, not audited ahead.
- In the code: `tests/browser/keyboard-nav.mjs` (`tick`, `hold`, the `T0`/`pauseAt` setup), `tests/view-keys.js` (`dist`), `.claude/rules/browser-tests.md`, `.claude/rules/view-controls-map.md`.
