---
title: "El minificado cambiaba entre ejecuciones por el marcador aleatorio de <?xml: ignoreCustomFragments: []"
author: Diego
date: 2026-10-30
branch: feat/servicios-arcgis-mapserver
cost: { minutes: 40, tokens: 887757 }
id: l-6db6a409
scope: repo
status: active
src: agent
touches:
  - src/js/66-arcgis.js
  - tests/arcgistest.js
  - tests/browser/arcgis.mjs
  - build.js
  - tests/run-all.js
  - src/js/35-export-formats.js
  - src/js/31-tree-node.js
---

## Decided
`build.js` pasa `ignoreCustomFragments: []` a html-minifier-terser (`MINIFY_OPTS`). Sin eso, `node build.js --check` fallaba una de cada seis veces y `node tests/run-all.js` abortaba en su primera comprobación («kitelocal.min.html NO coincide con src/») sin que nadie hubiera tocado nada.

## Tried and ruled out
- Pensar que terser era no determinista: sobre el MISMO texto da el mismo resultado (16/16 en un proceso, 10/10 en procesos nuevos).
- Serializar las llamadas a terser (el minificador lanza una por cada `<script>`, también los de `src=` vacíos): no cambió nada, siguió habiendo cuatro variantes en 24 ejecuciones.

## Watch out
La causa: el minificador trata `<?…?>` como plantilla PHP y sustituye el literal `<?xml …?>` de `src/js/35-export-formats.js` por un marcador con letras ALEATORIAS antes de pasárselo a terser; esas letras entran en su tabla de frecuencias de caracteres y desempatan los nombres cortos (`f`/`h` de una función de importación de KMZ). Ya existía antes: quedó a la vista al crecer el script con 66-arcgis.js (en HEAD 14/14 iguales, con el cambio 1 de cada 6 distinta). Cualquier literal nuevo con `<?` o `<%` en `src/js` reabriría el hueco solo si se quita esa opción. Para diagnosticarlo: capturar el texto que recibe `minifyJS` dos veces y compararlo.
