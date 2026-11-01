---
title: "Cancelar un fetch: apuntar la cancelación aparte, no deducirla del motivo del aborto"
author: Diego
date: 2026-10-30
branch: feat/servicios-arcgis-mapserver
cost: { minutes: 16, tokens: 125137 }
id: l-6bcb4740
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - build.js
  - docs/estudio-seguridad-kite-local.md
  - docs/img/capturas.json
  - docs/img/servicio-arcgis.png
  - docs/img/url-arcgis.png
  - docs/manual-usuario-kite-local.md
  - kitelocal.html
  - kitelocal.min.html
  - src/index.html
---

## Decided
En `arcgisFetchLayerData` (`src/js/66-arcgis.js`) la cancelación se apunta en `run.cancelled` antes de llamar a `ctrl.abort()`; el `catch` mira esa bandera.

## Tried and ruled out
`ctrl.abort("cancelled")` y comprobar `err.name === "AbortError"` y `signal.reason === "cancelled"`: con un motivo de cadena el `fetch` rechaza con la propia cadena (no con un `AbortError`), así que el aviso de cancelación nunca salía y caía al de error; además `withElevRetries` hace `err.attempts = …`, que sobre una cadena lanza un `TypeError`.

## Watch out
`tests/browser/arcgis.mjs` lo cubre con un servidor que deja la consulta colgada. En esa suite el selector del nombre solo aparece la primera vez que se trae una forma de atributos: las siguientes usan el nombre ya elegido sin preguntar (no esperar el diálogo).
