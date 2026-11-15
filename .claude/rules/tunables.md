---
description: Tunable settings of Propiedades (TUNABLES/CFG in 04-tunables.js) — what may become a setting, how to add one, bounds, saving only what differs, the advanced tabs (red, behind «Preferencias avanzadas»), and what «Restaurar» does with them.
paths:
  - "src/js/04-tunables.js"
  - "src/js/43-points-editor.js"
  - "src/js/32-geojson.js"
  - "src/js/99-boot.js"
  - "tests/tunables.js"
  - "tests/browser/tunables.mjs"
---

## Tunable settings (`04-tunables.js`)

Requested by the user (2026-11-15): the fixed constants a user could want to
change become settings of Propiedades, grouped in tabs, saved in IndexedDB,
with «Restaurar» bringing them back to the values they had as constants.
Decided with the user: **a useful selection** (about 60), not every number
with a name; **no reset button of its own** (the existing «Restaurar» wipes the
database, and with it the settings).

### How it works

- **`TUNABLES`**: one entry per setting, `{ id, tab, label: N_("…"), unit, def, min, max, int?, scale?, step? }`.
  - `id` is the name the constant had (`INFO_STACK_MAX`), so a grep for it
    still finds the table and every use.
  - `def`, `min` and `max` are in the unit the CODE uses (ms, bytes, a
    fraction). The dialog shows `value / scale` in `unit` (seconds for a
    timeout, MB for a size, % for a fraction) and stores `shown * scale`,
    rounded when `int` (the default).
  - Spanish words in `unit` go through `N_()` (`niveles/s`); symbols (`ms`,
    `px`, `MB`, `%`, `×`) are written as they are and `tr()` leaves them alone.
- **`CFG`**: the live values. **Every use reads `CFG.<id>` when it runs**;
  the old `const` is gone from its file (`tests/tunables.js` fails if one is
  left, or if the delivered script never reads `CFG.<id>`).
- **Only what is read at use time can be a setting.** Anything copied at load
  time stays a constant: `MAX_ZOOM` (map options and every base layer),
  `ELEV_WINDOW` (it fixes the elevation cache lattice), the refresh intervals
  started once, catalogues. A default parameter (`ttl = CFG.INFO_STACK_TTL_MS`)
  is fine: JavaScript evaluates it at each call.
- **Linked values are clamped where they are used**, not refused in the
  dialog: the expiry warning never exceeds the lifetime
  (`infoStackExpiring`/`infoStackNextEvent`), the top arrow-key speed never
  slows the pan (`keyPanSpeed`), a retry count longer than its
  `*_RETRY_DELAYS` table reuses the last delay (`withElevRetries`).
- **Bounds are protections, not decoration**: the import limits stop hostile
  files (a shapefile never above 4096 MB, a KMZ ratio never above 10,000) and
  the network ones keep `external-network.md` (timeouts of a few minutes at
  most, at most 5 retries, at most 10 elevation requests per second). The
  security study (5.5) says so; a new setting that weakens a protection needs
  a bound that keeps it.
- **Left out on purpose**: physical constants; `PF_K_FACTOR` (its value is
  written in the profile's labels, «k = 4/3»); the Nominatim `limit=5`
  (principle 2); ArcGIS, Cadastre and Wikipedia response caps; batches,
  overscan, chart margins and other algorithm details (see
  `docs/pendientes…`, 1.8).

### Saving and restoring

- One key `tunables` of the `tree` store with ONLY what differs from the
  default (`tunableOverrides`), so a future default reaches whoever never
  touched it; read through `validTunables` (foreign input: each value passes
  or not on its own). See `persistence-indexeddb.md`.
- Applied to `CFG` early in `99-boot.js`, right after the theme.
- **«Restaurar» needs no code**: it deletes the database and reloads, and
  `CFG` starts from the defaults. `tests/browser/tunables.mjs` checks it.

### The dialog (`43-points-editor.js`)

- Tabs: `ui` «Interfaz», `cards` «Fichas», `map` «Mapa y teclado», `files`
  «Archivos», `net` «Red», and the rows of `elev` under the «Avanzadas»
  heading of «Elevación y perfil» (the old «Frecuencias» tab, id
  `props-tab-freq`, which keeps the Fresnel frequency, its own key). Each has
  an empty `.tunables-list[data-tunables="<tab>"]` in `index.html` (the five
  tabs, also an intro paragraph). The KMZ-size preference stays in
  «Preferencias» (its own key): it was always visible.
- **They are ADVANCED preferences** (requested: told apart from the usual
  ones). The five tabs carry `.advanced` (name in red, `--danger`), and so
  does the «Avanzadas» heading. The «Preferencias avanzadas» box (last row of
  «Preferencias», `props-advanced`, unticked by default) shows them:
  `applyAdvancedPrefs` puts `show-advanced` on the dialog and CSS hides the
  rest; unticking it with an advanced tab shown goes back to «Preferencias».
  **Hidden is not reset**: the values still apply. The box is part of the
  deferred editing (Cancel puts it back, Accept saves it in the key
  `advancedPrefs`, `{ v, on }`, loaded in `99-boot.js`), and «Restaurar» hides
  them again. A new tab of tunable settings is advanced too unless it holds
  an older, always-visible option.
- `buildTunableRows` builds one row per entry at load (label `<label for>`,
  `<input type=number id="tunable-<id>">` with `min`/`max`/`step` in the shown
  unit, the unit after it). The row's `title` gives the default; a value that
  differs puts its label in bold (`.changed`).
- Deferred like the rest of Propiedades: `change` → `readClampedNumber`
  (adjusts to the nearest bound with a notice; empty or unreadable keeps the
  current value) → `setTunable`, which runs `TUNABLE_EFFECTS[id]` when
  something on screen shows the value (the card stack, the profile chart, the
  elevation cells). Cancel puts `propsOriginal.tunables` back through
  `setTunable`; Accept calls `dbSaveTunables(tunableOverrides())`.

### Adding a setting

1. An entry in `TUNABLES` with the constant's current value as `def`, and its
   bounds (think of what the bound protects).
2. Remove the `const` and read `CFG.<id>` at every use (inside functions).
3. If something visible shows it, an entry in `TUNABLE_EFFECTS`.
4. Its default in the `DEFAULTS` table of `tests/tunables.js`; update the
   suites that extracted the old constant (`constDecl("X")` no longer finds it:
   the extracted code reads the global `CFG` that `tests/_extract.js`
   installs, and a suite that needs another value sets `CFG.X` and puts it
   back, or passes its own `CFG` as a parameter, like `tests/toolstest.js`).
5. `node i18n-tool.js sync en` and translate the label; the manual (2.1) lists
   each tab's settings with their defaults.
