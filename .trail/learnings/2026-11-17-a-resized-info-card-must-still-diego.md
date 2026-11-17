---
title: "A resized info card must still fold to its tabs: only !important beats the inline size the resize handle writes"
author: Diego
date: 2026-11-17
branch: feat/base-layers-export
cost: { minutes: 10, tokens: 963070 }
id: l-91c58a48
scope: repo
status: active
src: agent
touches:
  - src/styles.css
  - src/js/44-dialogs.js
  - tests/browser/info-stack.mjs
---

## Decided
- Folded (no layer under the pointer, no tab chosen), the info card shows only its title and tabs, also after the user resized it; showing a card again (hover on a layer, a click on a tab) brings back the user's size. Requested by the user after a resized card stopped folding.
- The rule `.info-compact` uses `height: auto !important; min-height: 0 !important`, because the resize handle writes the size as inline styles and only `!important` beats them. The inline height is left alone, so it is the user's size when the card unfolds.
- `resize: none` while folded.

## Tried and ruled out
- Letting the folded card be resized: Chromium's handle writes BOTH width and height, so a sideways tug while folded would save the folded height as the user's size.

## Watch out
- Section 12 of the browser suite of the stack of recent cards fails without the rule (checked by removing it).

In the code: src/styles.css (#desc-dialog .dlg-box.info-compact), src/js/44-dialogs.js (renderInfoStack toggles .info-compact), tests/browser/info-stack.mjs section 12.
