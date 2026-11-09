---
description: Nearby Wikipedia articles from the context menu — geosearch + extracts (MediaWiki API), errors inside HTTP 200, hostile text, «W» markers in a numbered folder, CC BY-SA credit
paths:
  - "src/js/67-wikipedia.js"
  - "tests/wikipediatest.js"
  - "tests/browser/wikipedia.mjs"
  - "tests/fixtures/wikipedia-*.json"
---

## Nearby Wikipedia articles (`67-wikipedia.js`)

«Consultas › Artículos de Wikipedia en la vista» (`CTX_MENU_ITEMS` in `70-view-controls.js`, next to «Elevación» and «Parcela catastral»; no `disabled()`, it does not depend on the map rotation) adds the geotagged articles around the clicked point as «W» markers. Entry point: `queryWikipediaAt(latlng)`.

### The service

- **MediaWiki Action API**, `es.wikipedia.org` or `en.wikipedia.org` (`WIKIPEDIA_APIS`, chosen from the interface language by `wikipediaLang`; anything that is not Spanish uses English). Adding a language = one entry there **and** one row in Annex A of the security study (`tests/docs.js` fails otherwise).
- **CORS comes from `origin=*`**, a query parameter, not a header: the request stays a "simple" one (`credentials: "omit"`, no headers of our own, so no preflight).
- **Two phases**: `list=geosearch` (`gscoord=lat|lon`, `gsradius` = the reach of the view, `gslimit=100`, nearest first) and then `prop=extracts` (`exintro`, `explaintext`, `exsentences=3`, `exlimit=max`, `pageids`) **in chunks of 20**, which is the most the API serves per request (it silently drops the rest). A chunk that fails does not lose the markers: they go in without a summary and a notice says how many.
- **The radius is the REACH OF THE CURRENT VIEW** (decided with the user, replacing a fixed 5 km): `wikipediaViewReach(point)` = the distance from the clicked point to the farthest corner of the viewer (the corners go through `containerPointToLatLng`, so a rotated map is covered), and `wikipediaRadius` turns it into whole metres inside the service's range. **`gsradius` only accepts 10 m to 10 km** (`outofrange` otherwise, checked 2026-11-09; `gsbbox` fails with `toobig` at a similar size), so a wider view is searched up to 10 km (`capped`, with its own notice) and the 100 nearest are the limit that applies. `wikipediaGeoUrl` refuses a radius outside the range or not a whole number, so nothing out of range reaches the service. The notices write the reach with `wikipediaDistance` in the unit the user chose.
- **Limit and language are fixed on purpose** (one click, no settings; see `docs/pendientes…` 3.11). Dense city centres hit the 100 limit within ~300 m, hence the notice «Se muestran los 100 artículos más cercanos».

### Errors arrive inside HTTP 200

The API answers `200` with `{ "error": { "code", "info" } }`. Two consequences, both measured:

- **`cirrussearch-too-busy-error` is transient** and showed up in roughly one request out of two or three while the fixtures were captured. It is retried (`WIKIPEDIA_RETRIES`, `WIKIPEDIA_RETRY_DELAYS`) through `withElevRetries`; `isRetryableElevError` decides, and an error carrying an `owsCode` is never retried (the same convention as the Cadastre's OGC exceptions). The other API errors are final and shown with the service's own text.
- **A `200` is not a success**: `parseWikipediaGeosearch` and `parseWikipediaExtracts` look for `error` first.

### The data is hostile

Titles and summaries come from a wiki anybody can edit. They go through `cleanWikipediaText` (zero-width and control characters out, CR/LF normalised, length capped by `WIKIPEDIA_MAX_TITLE`/`WIKIPEDIA_MAX_EXTRACT`), a page without a title or with coordinates that are not finite and in range is dropped, and the card is built by `wikipediaCardHtml` with `escapeHtml` (the sanitiser of the card is a second defence, not the first). **The article link is built from the encoded title on the service's own address, never from a received URL.** The page ids that go back into the second request are checked as positive safe integers.

### What ends up in the tree

A section «Wikipedia» (`ensureNamedSection`) with one folder per query (`nextNumberedName("Wikipedia")`: repeating the query adds a folder, nothing is merged or checked for duplicates). The folder is added **collapsed** (100 rows would push the user's other layers out of the panel) and `highlightNode(folder)` reveals and selects its row without opening it; the view is never moved (checklist rule 6), so the notice says how to see the result («pulse 🔍 en la carpeta»: the folder's lupa frames all the articles). Each article is a normal marker layer (`makeNode` with `desc` = the card), size 30, dark colour, with the embedded MDI icon `wikipedia` (`WIKIPEDIA_ICON`; `MDI_ICONS` in `41-selection.js` → `npm run icons`).

**The «W» is never the bare letter**: it sits on a round badge (`BADGED_ICONS`, see `marker-icons.md`), because a dark glyph with no background is invisible on a dark base map, an orthophoto or shaded terrain. Every icon also has an accessible name (`aria-label` = the title, see `accessibility.md`). They are ordinary layers: style, hide, delete, undo, export and copy all work, and `TREE_SCHEMA` does not change. **A collapsed folder comes back after undo or reload with its rows unbuilt (lazy)**: count markers over `serializeTree()`, not over `#tree li` (the browser suite does).

The card shows the distance with `wikipediaDistance` (3 decimals in km/mi/NM, 0 in m/ft; `fmtUnitDist` always prints 2, which turned 17 m into "0.01 NM"). It is static text: changing the unit later does not update it.

**Attribution**: `ensureWikipediaAttribution()` adds `WIKIPEDIA_ATTRIB` («© Wikipedia (CC BY-SA 4.0)») once per session, on the first query **and at boot** when the saved tree already holds Wikipedia markers (`wikipediaInRecords(nodes)` in `99-boot.js`); each card repeats the licence next to the distance. A `.kite.json` import or a paste from another tab that brings Wikipedia markers does not add it until the next reload (see `docs/pendientes…` 3.11). The cursor is `progress` while it waits (`.wikipedia-busy` in `styles.css`), a second request for the same point while one is running gets a notice instead of being ignored, and `pushUndo` is called once, just before the folder is added.

**Failures say why** (`wikipediaWhy`: time-out, network via `netFailText`, or the service's own text), also for the chunks of summaries that fail. A response whose rows were all rejected is an error («el servicio ha devuelto artículos que no se pueden usar»), not «no articles». The transient codes are matched exactly (`WIKIPEDIA_TRANSIENT`): a code that merely contains «lag» is not retried.

### Tests

- `tests/wikipediatest.js` (Node): the pure part, with the REAL responses captured on 2026-11-09 (`tests/fixtures/wikipedia-*.json`, including the busy error) and synthetic hostile data.
- `tests/browser/wikipedia.mjs`: end to end with a fake Wikipedia (`page.route`); it must **fail** if the radius stops following the view (the test works out the reach of the view on its own, at zoom 15, 18, 9 and 25), if the busy error stops being retried, if a hostile title stops being escaped, if the badge disappears or if the credit is missing after a reload (all checked by breaking the code on purpose). It also covers the network-down path (`route.abort`), unusable rows, the repeated click and the collapsed, revealed folder. The 503 the browser logs on its own is filtered, as in `cadastre.mjs`.
- The manual's figures come from the `wikipedia.png` scenario of `tools/capturas.mjs` (the first 20 summaries are the real ones; the rest are placeholders so the capture does not depend on the network).
