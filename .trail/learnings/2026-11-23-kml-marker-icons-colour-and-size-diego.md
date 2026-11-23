---
title: "KML marker icons: colour and size are kept, images are never loaded, and an icon with no equivalent becomes a coloured circle plus a log notice"
author: Diego
date: 2026-11-23
branch: feature/kml-marker-style
cost: { minutes: 22, tokens: 463731 }
id: l-d4eb9971
scope: repo
status: active
src: agent
---

## Decided
- An imported KML point keeps the colour, scale and shape of its IconStyle. The shape comes from the icon's file name (dot or circle, square, star, triangle); the image itself is never downloaded.
- An href with no equivalent (a pushpin, a Google paddle, anything else), when the style has a colour, is drawn as a coloured circle and its URL goes into the import notice and the log, so the team can see which icons people actually use and map them later. Without a colour it stays the Leaflet pin.
- LabelStyle scale 0 means the name is not shown permanently; with IconStyle scale 0 the marker is the no-icon kind, and the explicit label scale wins over the rule that normally turns the text on.
- The KML style utilities lived in the Copernicus file only because the single-file app was split by line ranges in September 2026. They move to the KML geometry file in their own commit, with no behaviour change, before the feature.

## Tried and ruled out
- Keeping the Leaflet drop pin when the href is unknown: it is a PNG and cannot take the KML colour, so the user's colour would be lost, which is what made the style look ignored.
- Loading the href image: needs `http:` (blocked by the `img-src` rule, https only) and a new server per file; not worth it.

## Watch out
- Export writes a marker colour for every style, including the default blue of the Leaflet pin. Once import honours colours, that round trip would turn every pin into a blue circle, so export must skip the colour when the icon is the Leaflet pin.
- In the code: `parseStyleElement` and `buildStyleIndex` (now in `20-kml-geom.js`), `buildKmlRecords` (`31-tree-node.js`), `kmlStyleXml` (`35-export-formats.js`), `DEFAULT_MARKER_STYLE`/`NO_ICON` (`41-selection.js`).
