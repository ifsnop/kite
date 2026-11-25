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
- Propiedades › **Fuentes de datos**, block «Itinerarios (openrouteservice,
  HeiGIT)» (moved there from Preferencias at the user's request, with the
  address it is sent to under it, `props-ors-url`, filled from `ORS_HOST` by
  `renderPropsOrsUrl` when the dialog opens): «Clave de openrouteservice»
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

### The key field: hidden, an eye, and its last characters always told
(`props-ors-key`, the only `type="password"` input of the application.) Requested: be able to check the key is the right one. Decided with the user: the field stays hidden; an **eye** button (`props-ors-key-eye`, `aria-pressed`, label «Mostrar la clave»/«Ocultar la clave») shows it whole; and a line under it (`props-ors-key-tail`, `aria-live="polite"`) ALWAYS says how it ends and how long it is, from the pure `orsKeyHint`: «Termina en …5678 · 56 caracteres» (the last `ORS_KEY_TAIL` = 4 characters; a value under `ORS_KEY_TAIL_MIN` = 12 says only its length, since its end would be a large part of it; a character that cannot be in a key shows as «?», which also keeps a direction-changing one from reaching the line). Ruled out: painting the dots and the last characters INSIDE the field (a custom overlay: caret, selection and password managers get fragile). Things that are not obvious: **the focus never moves**: `mousedown` on the eye is `preventDefault`ed and the click handler does not call `focus()`, so Space twice shows and hides instead of typing a space into the key (a first version focused the field and did exactly that); the field goes back to hidden every time the dialog opens (`showOrsKey(false)` in the opening code) so a revealed key does not outlive the check; the line is written with `textContent`. The tail is only ever on screen: never saved, logged or exported. `keepFocusOnClick` (`44-dialogs.js`) is NOT used because that file loads after `43-points-editor.js`. Tested in `tests/routing.js` (the hint) and `tests/browser/routing.mjs` (section 2: real mouse, keyboard, reopening).

### The request
- ONE `GET https://api.heigit.org/openrouteservice/v2/directions/{profile}?api_key=…&start=lon,lat&end=lon,lat`
  per «Calcular». A SIMPLE request (`credentials: "omit"`, no headers of our
  own: no preflight, see `url-import.md`); the key goes in the query to the
  only server that receives it. **The host moved** (2026-11-25): HeiGIT
  deprecated `api.openrouteservice.org`, which now answers 410 «Deprecated
  HeiGIT API URL» with no CORS header (a browser sees only a network failure),
  in favour of `api.heigit.org/openrouteservice/…` (the path under it is the
  service's own). **Checked by the user against the OLD host with their key
  (2026-11-17): it worked.** Against the new one it has been checked from the
  browser WITHOUT a valid key: a real request reaches it with
  `access-control-allow-origin: *`, and a bad key comes back as 403 with
  `{"error":"Access to this API has been disallowed"}`, which `orsErrorText`
  turns into the usual «la clave … no es válida». A route with a valid key on
  the new host has not been confirmed by us. `tests/fixtures/ors-route.json`
  is still synthetic (shaped like the documented format): replace it with a
  captured response when a key is at hand in a session.
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
  (Annex A.3 of the security study; `api.heigit.org` is in A.1).

### Tests
`tests/routing.js` (the pure part, hostile responses, error texts) and
`tests/browser/routing.mjs` (the whole flow with a fake service). The manual's
figure comes from the `itinerario.png` scenario of `tools/capturas.mjs`, with a
fake route from the Puerta del Sol to Cibeles.
