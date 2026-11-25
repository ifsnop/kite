---
title: "A secret field gets an eye and an always-visible tail line; the eye must not move the focus or change the field's size"
author: Diego
date: 2026-11-25
branch: fix/ors-heigit-url
cost: { minutes: 9, tokens: 610075 }
id: l-4dd7b33e
scope: repo
status: active
replaces: l-119a21de
src: agent
touches:
  - docs/estudio-seguridad-kite-local.md
  - docs/img/capturas.json
  - docs/img/propiedades-fuentes.png
  - docs/manual-usuario-kite-local.md
  - docs/pendientes-y-propuestas-kite-local.md
  - kitelocal.html
  - kitelocal.min.html
  - src/index.html
  - src/js/04-i18n-en.js
  - src/js/10-map.js
---

## Decided
The openrouteservice key field (the only `type="password"` input) keeps the key hidden, gets an eye button that shows it whole, and a line under it that always says how it ends and how long it is («Termina en …5678 · 56 caracteres»). The user liked how a console shows the end of a key; we did it as a separate line, not as dots plus real characters inside the field. A value under 12 characters says only its length, and a character that cannot be in a key shows as «?». The field goes back to hidden whenever the dialog opens. The field must keep the SAME size hidden and shown (the user asked for it).

## Tried and ruled out
Painting the dots and the last characters inside the field with an overlay: offered to the user and not chosen; caret, selection and password managers get fragile.

## Watch out
- Changing `input.type` from password to text switches which CSS rules match: the generic `.dlg-row input[type="text"]` caps a text field at 190px, so the field shrank from 530px to 190px every time the eye was pressed (it lost the cap's `max-width: none` when its own rule was rewritten). The browser test now compares the field's box in both states.
- The first version focused the field after the eye was pressed; with the keyboard the second Space then TYPED a space into the key. The fix is `mousedown` preventDefault and no `focus()` call; the test presses Space twice and checks the value.
- `keepFocusOnClick` lives in `44-dialogs.js`, which loads after `43-points-editor.js`: used at the top level it would hit a temporal dead zone, so the one-line handler is inline.
- A weak assertion (`a || b`) passed on the first run; checks on exact text catch more.
- In the code: `orsKeyHint` (`69-routing.js`, pure), `showOrsKey`/`refreshOrsKeyHint` (`43-points-editor.js`), `.secret-field`/`.secret-toggle` (`styles.css`).
