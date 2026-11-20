---
title: "Development, releasing and debug notes live in their own file, and the docs test reads it together with the README"
author: Diego
date: 2026-11-20
branch: docs/readme-pitch
cost: { minutes: 9, tokens: 59843 }
id: l-21a0e53b
scope: repo
status: active
src: agent
touches:
  - README.md
  - CONTRIBUTING.md
  - tests/docs.js
---

## Decided
The roadmap, the release steps and the `debug` branch notes moved out of the README into one developer page, because the README is the first thing a new user reads and those sections are for people who work on the code. One file with three sections, not three files, because they share one audience and one set of links.

## Tried and ruled out
Leaving the roadmap in the README and moving only the release and debug sections: ruled out because the roadmap is the longest developer-only block and would keep the front page long. Moving the two counts out of the way, or dropping them: ruled out because the docs test exists precisely so that those counts cannot go stale unnoticed.

## Watch out
The docs test requires the phrases «N suites» and «N JavaScript files», which sit in the roadmap's «Done» list, so after the move the README alone fails with «el README ya no dice…». The test now reads the README and the developer page as one text; if the roadmap is ever moved again, the test must follow it. Other files link the headings by anchor (`#releasing`, `#diagnosing-a-freeze-or-a-slowdown-debug-branch`, `#development-roadmap`), otherwise the links break silently: sections can move, those headings cannot be renamed. The page is kept identical on the `debug` branch like the README, so after merging it needs `git merge main` there.

In the code: `DEVELOPMENT.md`, `README.md` (Contributing), `CONTRIBUTING.md` (two links), `tests/docs.js` (`checkReadmeNumbers` call), `.claude/rules/docs-maintenance.md`.
