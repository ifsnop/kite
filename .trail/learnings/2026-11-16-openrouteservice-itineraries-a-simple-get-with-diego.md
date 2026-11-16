---
title: "openrouteservice itineraries: a simple GET with the user's key, no retry on 429, and editor-typed unicode escapes can silently break the build"
author: Diego
date: 2026-11-16
branch: feat/ors-routing
cost: { minutes: 34, tokens: 1568738 }
id: l-a8937a41
scope: repo
status: active
src: agent
touches:
  - docs/manual-usuario-kite-local.md
  - tests/README.md
  - tests/browser/whats-new.mjs
  - tests/whatsnew.js
  - src/js/69-routing.js
  - tests/routing.js
  - tests/browser/routing.mjs
  - docs/img/propiedades-preferencias.png
---

## Decided
- Itineraries between two points use openrouteservice (HeiGIT) with the user's OWN key, entered in Propiedades › Preferencias and stored like the Sentinel Hub credential (own key, never exported, removed when emptied). Chosen with the user: context menu + a non-modal dialog, summary only (no turn-by-turn instructions), three modes (car, bicycle, on foot).
- The request is a SIMPLE `GET /v2/directions/{profile}` with `api_key`, `start` and `end` in the query, so no preflight, like Catastro and Wikipedia. It was written without a real key: the fixture follows the documented format, and the host, the GET and the response must be checked with a real key.
- Only a 5xx, a time-out or the network is retried. A 429 is NOT retried, unlike other services: the key's quota is per minute or per day, and retrying a second later only spends more of it.
- The result is called «Itinerario N» in an «Itinerarios» section, because «Ruta N» already names route measurements.

## Tried and ruled out
- Turn-by-turn steps in the card or as tree rows: the user wanted the summary only.
- All nine openrouteservice profiles: the user wanted the three basic ones.

## Watch out
- Typing a regex with backslash-u escapes for invisible characters through the editor turned them into the literal characters, and a literal line separator (code point 2028) ends a JavaScript regex literal. The build did NOT fail: the minifier silently left the JavaScript unminified (4 % smaller instead of 52 %). Use `\p{Cc}\p{Cf}\p{Zl}\p{Zp}` with the `u` flag, or `String.fromCharCode` in tests, and check the percentage `npm run build` prints. Logged as pending item 1.8b.

In the code: src/js/69-routing.js (orsDirectionsUrl, parseOrsRoute, orsErrorText, orsGet, setRouteEnd, pickRouteEndAt); key "orsKey" in 32-geojson.js; PLACE_TOOLS route-from/route-to in 52-measure.js; tests/routing.js, tests/browser/routing.mjs, tests/fixtures/ors-route.json; rule .claude/rules/routing.md.
