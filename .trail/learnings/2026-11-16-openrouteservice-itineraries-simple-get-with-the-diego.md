---
title: "openrouteservice itineraries: simple GET with the user's key (verified), key and address in Data sources, no retry on 429; editor-typed unicode escapes can sil…"
author: Diego
date: 2026-11-16
branch: feat/attribution-right-ors-sources
cost: { minutes: 29, tokens: 898086 }
id: l-8eeed7c3
scope: repo
status: active
replaces: l-a8937a41
src: agent
touches:
  - CLAUDE.md
  - README.md
  - build.js
  - docs/estudio-seguridad-kite-local.md
  - docs/img/capturas.json
  - docs/img/itinerario.png
  - docs/img/menu-consultas.png
  - docs/img/propiedades-preferencias.png
  - docs/manual-usuario-kite-local.md
  - docs/pendientes-y-propuestas-kite-local.md
---

## Decided
- Itineraries use openrouteservice (HeiGIT) with the user's own key, through a simple `GET /v2/directions/{profile}` with `api_key`, `start` and `end` in the query (no preflight). The user checked it against the real service with their key on 2026-11-17: it works. The test fixture is still synthetic.
- The key and the address it is sent to live in Propiedades › Fuentes de datos (block «Itinerarios (openrouteservice, HeiGIT)»), not in Preferencias: the user wanted data services and their addresses in that tab.
- Only a 5xx, a time-out or the network is retried; a 429 is not (the quota is per minute or per day).
- Results are «Itinerario N» in «Itinerarios», because «Ruta N» names route measurements.

## Tried and ruled out
- Turn-by-turn steps, and all nine profiles: the user wanted the summary and three modes.

## Watch out
- Typing a regex with backslash-u escapes for invisible characters through the editor turned them into the literal characters; a literal line separator ends a JavaScript regex literal and the build did NOT fail (the minified file came out unminified). Use `\p{Cc}\p{Cf}\p{Zl}\p{Zp}` with the `u` flag and check the percentage `npm run build` prints (pending 1.8b).

In the code: src/js/69-routing.js; key "orsKey" in 32-geojson.js; renderPropsOrsUrl in 43-points-editor.js; tests/routing.js, tests/browser/routing.mjs; rule .claude/rules/routing.md.
