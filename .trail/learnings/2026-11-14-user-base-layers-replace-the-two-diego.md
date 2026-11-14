---
title: "User base layers replace the two fixed Custom layers: no migration of old addresses, delete asks first, tile templates accepted, title editable"
author: Diego
date: 2026-11-14
branch: feat/user-base-layers
cost: { minutes: 37, tokens: 530961 }
id: l-68f0dc12
scope: repo
status: active
src: agent
touches:
  - src/js/11-base-panel.js
  - tests/userbases.js
  - src/js/44-dialogs.js
  - src/js/32-geojson.js
  - tests/browser/user-bases.mjs
  - src/js/10-map.js
  - src/index.html
  - src/js/70-view-controls.js
  - docs/img/capa-base-propia.png
  - docs/img/mapas-base.png
---

## Decided
- The base map panel lets the user add, edit and delete their own base layers (tile server or WMS), instead of the two fixed «Custom Tile Map Service» / «Custom Web Map Service» rows. Plan agreed with the user, who then decided the open points:
  - The addresses saved for the two old fixed layers are NOT migrated: their keys are deleted at boot and the user adds them again.
  - Deleting a user layer asks for confirmation: base maps are not in undo (pushUndo is tree-only), so a slip would lose the address for good.
  - The tile type is extended: a base address still gets {z}/{x}/{y}.png appended, but a full template with {z} {x} {y} in any order/format is accepted (Esri {z}/{y}/{x}, .jpg, WMTS in KVP form), plus {-y}, {s} and a TMS checkbox.
  - The layer's title is editable (from the gear dialog), only for user layers.
- Choices made without asking (flagged to the user): a new layer is added ON and on top of the stack; cap of 20 user layers.

## Tried and ruled out
- Migrating customTilesUrl / customWmsUrl into the new list: the user said it is not needed.

## Watch out
- Each user WMS keeps its catalog/version/format/query in flight inside its own source object, not in module globals; anything new per-layer must follow that or two WMS layers will overwrite each other.
- User layers must be added to baseState BEFORE applySavedBases at boot, or their saved order/opacity/chosen WMS layer is dropped as an unknown id.
- A tile template may only carry placeholders Leaflet fills in by itself; any other makes L.tileLayer throw on every tile, hence the validation.

In the code: src/js/11-base-panel.js («User base layers»: userBaseRecord, validUserBases, userTilesTemplate, userBaseUrlProblem, makeUserBaseDef, makeUserWmsSource, createUserBase/updateUserBase/removeUserBase), src/js/44-dialogs.js (#user-base, #user-base-delete), src/js/32-geojson.js (key "userBases", USER_BASES_SCHEMA 1, RETIRED_CUSTOM_KEYS deleted in dbLoadUserBases), USER_BASES_MAX = 20, tests/userbases.js, tests/browser/user-bases.mjs, rule .claude/rules/base-maps.md.
