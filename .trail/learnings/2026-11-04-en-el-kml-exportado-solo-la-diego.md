---
title: En el KML exportado solo la ficha va en CDATA; nombres y ExtendedData siguen escapados
author: Diego
date: 2026-11-04
branch: feat/kml-ficha-cdata
cost: { minutes: 26, tokens: 253645 }
id: l-eec3b393
scope: repo
status: active
src: agent
touches:
  - docs/estudio-seguridad-kite-local.md
  - kitelocal.html
  - kitelocal.min.html
  - src/js/10-map.js
  - src/js/35-export-formats.js
  - tests/README.md
  - tests/exportformats.js
  - docs/pendientes-y-propuestas-kite-local.md
---

## Decided
`xmlCdata` (`src/js/35-export-formats.js`) se usa solo para `<description>`. Medido con un KML real (15 154 fichas HTML): escapada la ficha, 248 MB; en CDATA, 157 MB, byte a byte lo que escribe Google Earth. `name`, `Folder/name` y los valores de `ExtendedData` siguen con `xmlEsc`: son textos cortos casi sin `<`, `>` ni `"`, y CDATA no ganaría nada. Un `]]>` en el texto se parte en dos secciones (`]]]]><![CDATA[>`); el importador no cambia porque lee con `textContent`.

## Tried and ruled out
Comprimir con KMZ como alternativa: no sustituye a esto (el KML sigue pesando lo mismo); queda como mejora aparte en `docs/pendientes-y-propuestas-kite-local.md` (KMZ pendiente).

## Watch out
`tests/exportformats.js` extrae las funciones de `kitelocal.html` (generado): tras tocar `src/` hay que `npm run build` antes de ejecutarlo, o falla con «xmlCdata is not defined». `trail check` da falsos positivos en las líneas largas de `docs/estudio-seguridad-kite-local.md` (compara frases sueltas como «sin para una»); se justifica en el PR.
