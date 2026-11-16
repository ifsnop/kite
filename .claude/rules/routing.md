---
description: Itineraries between two points with openrouteservice (HeiGIT) — the user's key in Propiedades, context-menu entries, the «Calcular itinerario» dialog, the request and its validation, errors and retries, the «Itinerarios» layer and its attribution.
paths:
  - "src/js/69-routing.js"
  - "src/js/70-view-controls.js"
  - "src/js/52-measure.js"
  - "tests/routing.js"
  - "tests/browser/routing.mjs"
---

## Itineraries with openrouteservice (`69-routing.js`)

Requested by the user (2026-11-16): a route between two markers or map points
from the HeiGIT API (openrouteservice, the API behind playground.heigit.org),
with the user's own key, shown on the map and in the tree. Decided with the
user: **context menu + dialog** to choose the ends; **summary only** (distance,
time, mode, origin, destination; no turn-by-turn instructions); **three modes**
(`driving-car`, `cycling-regular`, `foot-walking`).

### The key
- Propiedades › Preferencias, «Clave de openrouteservice (HeiGIT)»
  (`props-ors-key`, `type="password"`), deferred like the rest of the dialog:
  `propsOriginal.orsKey`, Cancel puts it back, Accept saves it or, with the
  field empty, REMOVES the key. `validOrsKey` (20–512 characters of
  `[A-Za-z0-9_=.\-]`) is loose on purpose: the service decides.
- Own key `orsKey` of the `tree` store (`ORS_KEY_SCHEMA` 1), like the Sentinel
  Hub credential: never in the tree, a `.kite.json` or the clipboard; loaded in
  `99-boot.js`; «Restaurar» deletes it. See `persistence-indexeddb.md`.
- Without a key every itinerary entry is disabled with the reason
  (`routeDisabled`), and so is «Calcular».

### Choosing the ends
- `CTX_MENU_ITEMS` › «Consultas»: «Ruta desde aquí», «Ruta hasta aquí»
  (`setRouteEnd(end, latlng)`).
- Over a marker (`soleMarker(li)`): «Itinerario ›» with «Desde este marcador» /
  «Hasta este marcador» (`markerRouteCtxItem`), carrying the marker's name.
  With several markers under the cursor (`ctxItemsFor`): two submenus,
  «Itinerario desde» and «Itinerario hasta», one entry per marker. The manual
  quotes every label in section 5 (`tests/docs.js`).
- `#route-dialog` is a NON-modal `.dlg-float`, so a second menu entry fills the
  other end while it is open. «Elegir en el mapa» arms `route-from`/`route-to`,
  two more `PLACE_TOOLS` (`52-measure.js`): the click goes to `pickRouteEndAt`,
  which takes a marker under the click (`layersAtPoint` + `soleMarker`) or the
  point. Escape gives up a pick before closing the dialog. A typed end goes
  through `parsePlaceCoordinates` (the place search's reader); unreadable, the
  field is `.bad` and the end empty. ⇅ swaps. The mode is remembered for the
  session only.

### The request
- ONE `GET https://api.openrouteservice.org/v2/directions/{profile}?api_key=…&start=lon,lat&end=lon,lat`
  per «Calcular». A SIMPLE request (`credentials: "omit"`, no headers of our
  own: no preflight, see `url-import.md`); the key goes in the query to the
  only server that receives it. **Not yet checked against the real service**
  (no key at hand when it was written): `tests/fixtures/ors-route.json`
  follows the documented format; replace it with a captured response and
  confirm the GET (else `POST …/geojson` with `Authorization`) when a key is
  available.
- `withElevRetries` with `AbortSignal.timeout(CFG.ORS_TIMEOUT)` per attempt,
  combined with the user's cancel (`AbortSignal.any`), `CFG.ORS_RETRIES`
  (tunable settings, advanced «Red» tab), `readCapped` (10 MB). **Only a 5xx,
  a time-out or the network is retried**: every answer below 500 carries
  `owsCode`, **429 included** (the key's quota is per minute or per day;
  retrying a second later only spends more of it).
- Errors are read from the BODY first (`orsErrorText`): `{ error: { code,
  message } }` or `{ error: "text" }`. 401/403 → the key; 429 → the quota;
  codes 2009 (no route), 2010 (point too far from a road) and 2004 (too long)
  get our own sentence; any other message is shown cleaned (control and
  format characters out, `\p{Cc}\p{Cf}\p{Zl}\p{Zp}`) and capped.
- **Trap met while writing it**: typing a regex with backslash-u escapes for the line separator (code point 2028)
  through the editor turned them into the literal characters, and a literal
  U+2028 ends a JavaScript regex literal. The build did not fail: the readable
  file broke at parse time and the minifier silently left the JavaScript
  unminified (4 % smaller instead of 52 %). Use Unicode property classes, or
  check `npm run build`'s percentage.

### The result
- `parseOrsRoute` (foreign input): one LineString Feature, finite coordinates
  in range, at most `ORS_MAX_VERTICES` (100 000), a finite summary ≥ 0 (a
  missing zero reads as 0).
- A NORMAL line layer (cadastre recipe): `pushUndo("calcular itinerario")`,
  `L.geoJSON`, `clearFillOnOpenPaths`, `makeNode` in the «Itinerarios»
  section (`ensureNamedSection`), `refreshAncestorChecks`, `scheduleSave`,
  `highlightNode` and an info notice; **the view never moves**. Called
  «Itinerario N — Modo · distance · time» (not «Ruta», taken by route
  measurements); colour by mode (map content, not themed), weight 4.
- The card is the Feature's `properties` (`routeProps`, keys in the language
  of the moment, static text). The Feature carries `kiteSrc: "ors"` (an own
  member, like `kiteAlt`, kept by `toGeoJSON()`), so `routesInRecords` lets
  the boot add the attribution. No `TREE_SCHEMA` change.
- Attribution once per session (`ensureRouteAttribution`): «© openrouteservice.org
  by HeiGIT · © OpenStreetMap contributors», with a link to `openrouteservice.org`
  (Annex A.3 of the security study; `api.openrouteservice.org` is in A.1).

### Tests
`tests/routing.js` (the pure part, hostile responses, error texts) and
`tests/browser/routing.mjs` (the whole flow with a fake service). The manual's
figure comes from the `itinerario.png` scenario of `tools/capturas.mjs`, with a
fake route from the Puerta del Sol to Cibeles.
