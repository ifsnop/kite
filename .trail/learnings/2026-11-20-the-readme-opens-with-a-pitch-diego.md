---
title: The README opens with a pitch and keeps the technical sections verbatim; only the Google download cutoff is stated as fact
author: Diego
date: 2026-11-20
branch: docs/readme-pitch
cost: { minutes: 22, tokens: 478315 }
id: l-8b28d6d3
scope: repo
status: active
src: agent
touches:
  - docs/manual-usuario-kite-local.md
  - kitelocal.html
  - kitelocal.min.html
  - src/js/04-i18n-en.js
  - src/js/10-map.js
  - src/js/45-tree-filter.js
  - src/js/68-whats-new.js
  - tests/README.md
  - tests/browser/tree-filter.mjs
  - tests/run-all.js
---

## Decided
The front half of the README is written to be read in thirty seconds (headline, demo link, six benefits, a table of what it does, quick start, where it fits against QGIS and Google Earth) and everything technical stays below it unchanged, under «Full feature list» and the other reference sections. The only claim about Google that is stated as fact is the one its own help page makes: as of 25 June 2027 Google Earth Pro for desktop will no longer be available for download, because that page says nothing about existing installations or about what to use instead.

## Tried and ruled out
Keeping «existing installations are expected to continue working» and «Google is directing users towards its web and mobile products»: ruled out because neither is on the official page and a promotional README must not state what its source does not, otherwise the project's credibility goes with the first reader who checks. Shortening or rewriting the technical sections: the manual, the rules and tests/docs.js rely on them, and they are the reference a contributor needs.

## Watch out
tests/docs.js still wants the phrases «N suites» and «N JavaScript files» (a marketing sentence like «142 automated test suites» does NOT match the regex and would silently go stale, so no counts in the pitch), the link to the pending-work document, and CONTRIBUTING.md links to `#releasing` and `#diagnosing-a-freeze-or-a-slowdown-debug-branch`: moving sections is safe, renaming those headings is not. The README is kept identical on the `debug` branch, so after merging it needs `git merge main` there. The placeholder `<repository-url>` in the clone block was a second one besides the Google reference.

In the code: `README.md` (front half and the last section), `tests/docs.js` (`checkReadmeNumbers`, `checkPendingLinks`).
