---
title: "A mouse click on a button inside the info card must not move the focus there, or the card stops shrinking when the pointer leaves"
author: Diego
date: 2026-11-12
branch: feat/info-card-stack
cost: { minutes: 28, tokens: 109552 }
id: l-0b1d6467
scope: repo
status: active
src: agent
touches:
  - src/js/44-dialogs.js
  - src/js/32-geojson.js
  - tests/browser/info-stack.mjs
  - docs/img/ficha-pila.png
---

## Decided
The tabs of the info card's stack and its header pin call `preventDefault` on `mousedown`, so a mouse click acts without moving the focus into the card. The keyboard still reaches them with Tab, and Enter or Space works as a click. Tabs switch the card only on click (decided with the user: switching on hover, even after a rest, changed the card while the pointer travelled to the text or to another tab).

## Tried and ruled out
Letting the click focus the tab button (the browser default). It fails because the deferred close skips any card that holds the focus, a rule meant for cards opened on purpose with ℹ or the context menu. After one click on a tab the card never shrank again when the pointer left every layer, and it stayed showing the last hovered layer.

## Watch out
Any new button inside the info card that the mouse uses while the card is hover-opened needs the same treatment, or it silently turns the card into an explicitly opened one.

In the code: src/js/44-dialogs.js `keepFocusOnClick` (tabs in `makeInfoTab`, `#desc-pin`); src/js/32-geojson.js `scheduleLayerInfoHide` (the `descBox.contains(document.activeElement)` guard); tests/browser/info-stack.mjs asserts the focus stays out after a click and fails without it.
