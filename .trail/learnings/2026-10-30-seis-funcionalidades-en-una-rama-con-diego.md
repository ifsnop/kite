---
title: "Seis funcionalidades en UNA rama con un commit por funcionalidad, no una rama/PR por cada una"
author: Diego
date: 2026-10-30
branch: feat/exportar-gpx-anillos-enlace-atributos-perfil
cost: { minutes: 39, tokens: 471764 }
id: l-fa61da54
scope: repo
status: active
src: agent
touches:
  - src/js/32-geojson.js
  - src/js/52-measure.js
  - src/js/35-export-formats.js
  - tests/exportformats.js
  - tests/run-all.js
  - src/js/10-map.js
  - kitelocal.html
  - kitelocal.min.html
  - sw.js
  - src/js/04-i18n-en.js
---

## Decided
Las seis funcionalidades (exportar KML/GeoJSON, importar GPX, anillos y sectores, enlace de la vista, tabla de atributos y estilo por atributo, exportar el perfil) van en la rama `feat/exportar-gpx-anillos-enlace-atributos-perfil`, con un commit por funcionalidad y un solo PR. Pedido por Diego: si juntar ramas paralelas cuesta tiempo por tocar los mismos ficheros, no merece la pena.
Cada commit deja `node tests/run-all.js` en verde, `docs/` al día y los recuentos de suites del estudio corregidos.

## Tried and ruled out
Una rama por funcionalidad: chocarían siempre en `BUILD` (`src/js/10-map.js`) y en los tres generados (`kitelocal.html`, `kitelocal.min.html`, `sw.js`), que el hook pre-commit regenera en cada commit, y además en `src/js/04-i18n-en.js`, `tests/run-all.js`, `tests/README.md`, `docs/`, `tools/capturas.mjs` y `docs/img/capturas.json`.

## Watch out
- Cada suite nueva sube el recuento de `docs/estudio-seguridad-kite-local.md` (cinco frases): `node tests/docs.js` dice cuáles; la cifra se corrige tras ejecutar la batería completa, no antes.
- `npm run capturas <nombre> -- --sin-fondo` reescribe `"fondo"` en `docs/img/capturas.json` a «liso»: devolverlo a «OpenStreetMap» si las demás imágenes se hicieron con mapa.
- Un `trail check` de este tipo de cambio marca como «conflicto» el párrafo del estudio que contiene «con una … los» (falso positivo con la lección de los servidores por regex): no es el caso, el Anexo A lo vigila `acorn`.
- La URL del espacio de nombres KML (`www.opengis.net`) cuenta como servidor para `tests/docs.js`: tiene su fila en el Anexo A.
