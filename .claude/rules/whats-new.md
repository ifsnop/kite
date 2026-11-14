---
description: The «Novedades» window at startup — what each release brought, the WHATS_NEW texts (one line per user-visible change, in «next» until the release), when it shows and how the «don't show again» choice is kept.
paths:
  - "src/js/68-whats-new.js"
  - "tests/whatsnew.js"
  - "tests/browser/whats-new.mjs"
  - "package.json"
---

## «Novedades» window (`68-whats-new.js`)

Requested by the user: at startup, a window with the changes since the previous
version (the first time, everything since 2.0), closed with a button or the ×,
with a box to stop showing it until there is a new version. The text is a short,
NON-technical summary of what each PR brought: what the user can now do, or what
works better.

### The texts: `WHATS_NEW`, filled PR by PR

- **Every PR that changes something a user sees adds its line to the entry
  `"next"`** (top of `WHATS_NEW`; right after a release there is none, and the
  first such PR creates it), in the same PR. One sentence each, for the
  user and not for a developer: no function names, no `TREE_SCHEMA`, no «refactor»;
  what they can now do or what works better. Spanish inside `N_()` (the item is
  translated when shown, `tr(item)`), its English in the dictionary
  (`node i18n-tool.js sync en`, and use the English names of the interface labels
  it quotes: «Places», not «Lugares»). Ending in a full stop, at most 220
  characters (`tests/whatsnew.js`). Internal work (tests, docs, CI, tools) adds
  nothing.
- **`"next"` is never shown.** Preparing a release (`build-and-release.md`):
  rename `"next"` to the new version, the same as `package.json`. `tests/whatsnew.js`
  fails if `package.json`'s version has no entry, if an entry is above it, if
  versions repeat or are out of order, or if `"next"` is not at the top.
- The first entries (2.0.1 to 2.5.0) and the first `"next"` were written from
  the bodies of PRs #60–#86.

### When it shows (`whatsNewPlan`, `whatsNewEntries`)

- Stored: `whatsNew` key of the `tree` store (`WHATS_NEW_SCHEMA` 1,
  `{ v, shownFor, since, dismissed }`, read through `validWhatsNewRecord`: foreign
  input). No `DB_VERSION`/`TREE_SCHEMA` bump.
- Nothing saved (or a downgrade): lists everything after `WHATS_NEW_FIRST` (2.0.0).
  A version newer than `shownFor`: lists from `shownFor` (the one the user last
  ran), so skipping a release does not lose its notes, and shows it again even if
  the box had been ticked. The same version: the same list, unless `dismissed`.
  A fresh record is saved as soon as the window is decided, so later starts of
  the same version keep the same `since`.
- Released entries only (`x.y.z`), `since < version ≤ VERSION`, newest first. With
  nothing to list, no window.
- **Closing**: «Cerrar», the × (its `data-cancel` is «Cerrar») and Escape (chain
  of `52-measure.js`) all go through `closeWhatsNew`; only a ticked box saves
  `dismissed: true`. Unticked, it shows again at every start.
- Shown at the end of the boot (`showWhatsNewAtBoot`, `99-boot.js`), after the tree
  is resolved. **On a phone** the «Mejor desde un ordenador» notice may be on
  screen: the window waits for it (`mobileNoticeThen`, `50-splitter.js`) instead
  of stacking.

### The footer has ONE button, on purpose

The rule of `dialog-close-button.md` removes a footer whose only button would be
«Cerrar». Here the user asked for the button explicitly and the footer also holds
the «No volver a mostrar…» box, which belongs next to it; `tests/statics.js` allows
a single-button footer only when it contains a checkbox.

### Tests and tools stay out of its way

The window is modal and would cover what every suite clicks first, so
`stubTiles` (`tests/browser/_browser.mjs`, which every context goes through) sets
`window.__kiteSkipWhatsNew`; `browser/whats-new.mjs` passes `{ whatsNew: true }`.
`tools/capturas.mjs` (except its `novedades.png` scenario) and `tools/_demo.mjs`
(GIF and social image) set the same flag.

### Tests

`tests/whatsnew.js` (texts and pure logic) and `tests/browser/whats-new.mjs` (first
time, close three ways, comes back unticked, ticked stays closed, a newer version
lists only what came after, tampered record, phone). Manual: section 1, figure
`novedades.png`.
