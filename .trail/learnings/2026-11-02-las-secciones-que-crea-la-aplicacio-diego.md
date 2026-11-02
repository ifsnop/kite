---
title: "Las secciones que crea la aplicación se marcan con sec: true porque su nombre queda en el idioma del momento"
author: Diego
date: 2026-11-02
branch: feat/propiedades-restaurar-y-ajustes
cost: { minutes: 14, tokens: 126876 }
id: l-79b0071b
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - README.md
  - tests/README.md
  - tests/docs.js
  - docs/estudio-seguridad-kite-local.md
  - docs/img/anadir-url.png
  - docs/img/anillos-resultado.png
  - docs/img/aviso-movil.png
  - docs/img/barra-herramientas.png
  - docs/img/calculos-geodesicos.png
---

## Decided
Las secciones de primer nivel que crea la aplicación (`ensureNamedSection`, `ensureMeasureSection`) se pintan en azul pastel (`--section-bg`, clase `app-section`) porque el gris de un archivo (`li.file > .node-row`) es el mismo que toma una fila con el ratón encima. La marca se guarda como `sec: true` en el registro del archivo (`serializeNode`, `serializePendingRecords`, `buildRecordsFromStorage`, `materializeRecords`), no se deduce del nombre. Es un campo opcional añadido, así que NO sube `TREE_SCHEMA`; como entrada ajena solo se acepta `=== true` y solo en un `file`. Un árbol anterior, sin la marca, la recibe la próxima vez que `ensureNamedSection` encuentra la sección por nombre.

## Tried and ruled out
Reconocerlas por nombre al restaurar: los nombres («Marcadores», «Elevaciones») se guardan en el idioma del momento (`i18n.md`, regla 8) y un árbol creado en inglés o en español no casaría con el otro. Migrar los árboles guardados: el principio 4 lo desaconseja y la marca se pone sola al usar la sección.

## Watch out
`README.md` ahora lleva dos cifras que vigila `tests/docs.js` («N suites», «N JavaScript files»): al añadir una suite o un archivo de `src/js` hay que subirlas a mano, igual que los recuentos del estudio de seguridad (`114 de 114` se convierte fácilmente en `114 de 115` si se sustituye con `sed` sin cuidado).
