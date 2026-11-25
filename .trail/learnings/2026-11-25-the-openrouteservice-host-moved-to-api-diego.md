---
title: The openrouteservice host moved to api.heigit.org and the old one answers 410 without CORS
author: Diego
date: 2026-11-25
branch: fix/ors-heigit-url
cost: { minutes: 24, tokens: 544291 }
id: l-213c86e0
scope: repo
status: active
src: agent
touches:
  - docs/pendientes-y-propuestas-kite-local.md
  - docs/estudio-seguridad-kite-local.md
  - kitelocal.html
  - kitelocal.min.html
  - src/js/04-i18n-en.js
  - src/js/10-map.js
  - src/js/31-tree-node.js
  - src/js/32-geojson.js
  - src/js/42-hittest.js
  - src/js/68-whats-new.js
---

## Decided
Itineraries now call `https://api.heigit.org/openrouteservice/v2/directions/{profile}`. HeiGIT deprecated `api.openrouteservice.org`: on 25 November 2026 it answers HTTP 410 «Deprecated HeiGIT API URL» (an HTML page, no CORS header), which a browser reports only as `TypeError: Failed to fetch`, so the feature was broken for every user until this change. The new host sends `access-control-allow-origin: *` and answers a bad key with 403 and `{"error":"Access to this API has been disallowed"}`, which `orsErrorText` already turns into the usual «key not valid» text. The path under the new host (`/openrouteservice/v2/...`) is the service's own; only the constant `ORS_HOST` changed.

## Tried and ruled out
Confirming a route with a valid key on the new host: nobody on the team had a key at hand in the session, so only the keyless behaviour is verified (a real request from the page reaches the new host, passes CORS, and comes back as the 403 text). The route rule says so, and the 2026-11-17 check with the user's key applied to the OLD host.

## Watch out
- The host appears in places a plain grep for the dotted name misses: three Playwright route regexes written as `api\.openrouteservice\.org` (`tests/browser/routing.mjs`, `tools/capturas.mjs`, `tools/demo-scenes.mjs`). Left behind, the capture scripts would hit the real service. Search for the escaped form too.
- `tests/docs.js` matches the hosts in the code against Annex A of the security study, so the annex row had to change with the constant; the attribution link `openrouteservice.org` stays (it is the project's site, not the API).
- The browser test now records every request and fails if any goes to the old host, which would otherwise reach the real network unnoticed.
- In the code: `ORS_HOST` (`src/js/69-routing.js`), Annex A row of `docs/estudio-seguridad-kite-local.md`, «Fuentes de datos» capture `propiedades-fuentes.png` (it shows the address).
