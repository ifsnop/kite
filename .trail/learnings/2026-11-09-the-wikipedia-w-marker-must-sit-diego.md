---
title: "The Wikipedia W marker must sit on a badge, never be the bare letter"
author: Diego
date: 2026-11-09
branch: feat/wikipedia-nearby
cost: { minutes: 106, tokens: 2950334 }
id: l-9ffc90b9
scope: repo
status: active
src: agent
touches:
  - docs/pendientes-y-propuestas-kite-local.md
  - docs/estudio-seguridad-kite-local.md
  - docs/manual-usuario-kite-local.md
  - README.md
  - docs/img/anadir-url.png
  - docs/img/anillos-dialogo.png
  - docs/img/anillos-resultado.png
  - docs/img/aviso-movil.png
  - docs/img/barra-herramientas.png
  - docs/img/borrar-capas.png
---

## Decided
The «W» icon for Wikipedia articles is drawn on a round badge (light, or dark when the glyph colour is light), not as the bare dark letter. A bare dark glyph is invisible on a dark base map, an orthophoto or shaded terrain, so it only looks fine on the OpenStreetMap base. The user asked for this explicitly, and it resolves the "contrast on dark backgrounds" item that had been about to be deferred. The badge is keyed by the icon NAME, so it also holds for markers restored from storage.
Marker icons also get an `aria-label` with the node name (Leaflet gives every marker a role=button and no name).

## Tried and ruled out
- A white halo through a drop-shadow on the bare glyph: still thin and unreadable on dark imagery.
- A flag on the marker style for the badge: it would not survive a restyle or a restore; keyed by icon name it does.
- `title` for the accessible name: adds a native tooltip over the hover card; `aria-label` does not.

## Watch out
- A collapsed folder comes back after undo or reload with its rows unbuilt (lazy): count markers over `serializeTree()`, not over `#tree li`.
- Restored raw layers have no row, so the name is applied in `styleMarkerIcon(layer, s, name)` too, not only in `applyMarkerText`.

In the code: `BADGED_ICONS` and `markerBadgeBackground` in `src/js/42-hittest.js`, `.icon-badge` in `src/styles.css`, `nameMarkerIcon` in `42-hittest.js`.
