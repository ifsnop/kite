---
title: "A release must also check that the security study still describes what the tests prove, not only its counts"
author: Diego
date: 2026-11-21
branch: release/v2.8.0
cost: { minutes: 16, tokens: 722836 }
id: l-6030f9c6
scope: repo
status: active
src: agent
touches:
  - README.md
  - kitelocal.html
  - kitelocal.min.html
  - media/README.md
  - media/kite-fresnel.gif
  - media/kite-geotiff.gif
  - media/kite-wikipedia.gif
  - package.json
  - src/js/10-map.js
  - tests/browser/_tiff.mjs
---

## Decided
While preparing 2.8.0 the docs test passed on counts and versions, yet two paragraphs of the security study still described the tree filter as it behaved before the search work («shows only what matches»). They were rewritten as part of the release commit, because the study is evidence for an audit and a sentence that no longer matches what the suites prove is worse than a missing one. The release steps now have this to check beside the counts: for each user-visible change since the last version, find the study paragraph that names its tests and read it against the new behaviour.

## Tried and ruled out
Trusting `tests/docs.js` to catch it: it only compares numbers, versions, figures, servers, shortcuts and windows, never prose about behaviour. A grep for the feature's name found the two paragraphs in seconds, so the check is cheap but has to be done by a person.

## Watch out
The build number written in the manual and study headers is informational and is the one the pre-commit hook leaves in `src/js/10-map.js`, which is only known AFTER the commit: set the headers to it and amend (the hook only bumps `BUILD` when `src/` or `package.json` is staged, so a documents-only amend does not move it). The live clips and the captures carry the attribution line, so they show the build of when they were made, which is fine. Tagging is a separate, outward-facing step (it publishes the GitHub Release) and was not part of this commit.

In the code: `docs/estudio-seguridad-kite-local.md` (the areas of 7.2 and the browser-suite list), `docs/manual-usuario-kite-local.md` and the study header, `.claude/rules/docs-maintenance.md` (release procedure B).
