---
title: "A secret field gets an eye and an always-visible tail line, and the eye must never move the focus"
author: Diego
date: 2026-11-25
branch: fix/ors-heigit-url
cost: { minutes: 23, tokens: 78332 }
id: l-119a21de
scope: repo
status: active
src: agent
touches:
  - README.md
  - docs/estudio-seguridad-kite-local.md
  - docs/img/capturas.json
  - docs/img/itinerario.png
  - docs/img/propiedades-fuentes.png
  - docs/manual-usuario-kite-local.md
  - kitelocal.html
  - kitelocal.min.html
  - src/js/04-i18n-en.js
  - src/js/10-map.js
---

## Decided
The openrouteservice key field (the only `type="password"` input) keeps the key hidden, gets an eye button that shows it whole, and a line under it that always says how it ends and how long it is («Termina en …5678 · 56 caracteres»). The user liked how a console shows the end of a key; we did it as a separate line under the field, not as dots plus real characters inside the field. A value under 12 characters says only its length, so the "end" is never half the key, and a character that cannot be in a key shows as «?» (which also stops a direction-changing character reaching the line). The field goes back to hidden whenever the dialog opens.

## Tried and ruled out
Painting the dots and the last characters inside the field with a custom overlay: it was offered to the user and not chosen; caret, selection and password managers get fragile.

## Watch out
- The first version focused the field after the eye was pressed. With the keyboard that moved the focus off the button, so a second Space TYPED a space into the key. The fix is `mousedown` preventDefault (a mouse press does not take the focus from the field) and no `focus()` call at all; the browser test presses Space twice and checks the value did not change.
- `keepFocusOnClick` exists but lives in `44-dialogs.js`, which loads after `43-points-editor.js`: using it at the top level would hit a temporal dead zone, so the one-line handler is inline.
- A weak assertion (`a || b` that cannot fail) passed on the first run; checks on exact text catch more.
- In the code: `orsKeyHint` (`69-routing.js`, pure), `showOrsKey`/`refreshOrsKeyHint` (`43-points-editor.js`), `.secret-field`/`.secret-toggle` (`styles.css`), the capture `propiedades-fuentes.png` shows it.
