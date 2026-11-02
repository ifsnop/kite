---
title: Propiedades › Restaurar borra la base y recarga; dbWiped impide que un guardado tardío la recree
author: Diego
date: 2026-11-02
branch: feat/propiedades-restaurar-y-ajustes
cost: { minutes: 1, tokens: 1710 }
id: l-cac93ee3
scope: repo
status: active
src: agent
touches:
  - src/js/32-geojson.js
---

## Decided
«Restaurar» (pestaña de Propiedades) borra TODA la base IndexedDB `visor-kml` y recarga la página, porque el estado en memoria no puede reescribir lo borrado. `wipeAllData` (`src/js/32-geojson.js`): `dbWiped = true`, cancela `saveTimer`, espera `saveChain`, cierra NUESTRA conexión (`dbPromise`) y entonces `deleteDatabase`. La guardia `dbWiped` hace que `openDb()` rechace (`restoring`) y que `scheduleSave`/`saveTree` no hagan nada. El botón de la pestaña solo abre `#restore-confirm` (segunda confirmación). El idioma vive en `localStorage` y se conserva.

## Tried and ruled out
Recrear la base en memoria sin recargar: un guardado en vuelo podría reescribir datos borrados. Los pendientes no están en ningún `TODO`: viven en `.claude/rules/00-principles.md` y en el README («Still open»). La «tabla de verdad» que citó Diego no aparece en ningún archivo ni en el historial; se tomó por la tabla de atributos (commit 520a15e).

## Watch out
En `tests/browser/restore-db.mjs`, `handleDroppedFiles` de un GeoJSON con `properties` abre el selector «Elegir nombre» y deja el `page.evaluate` colgado: usar `properties: null`. Si `deleteDatabase` se queda en `onblocked`, queda una conexión abierta (otra pestaña o una sin cerrar).
