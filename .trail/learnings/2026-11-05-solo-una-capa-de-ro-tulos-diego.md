---
title: Solo una capa de rótulos se nombra sola; el reparto de columnas de atributos es automático y no se guarda
author: Diego
date: 2026-11-05
branch: fix/atributos-valores-y-nombres-arcgis
cost: { minutes: 36, tokens: 626321 }
id: l-077719b7
scope: repo
status: active
src: agent
touches:
  - README.md
  - docs/estudio-seguridad-kite-local.md
  - docs/manual-usuario-kite-local.md
  - docs/pendientes-y-propuestas-kite-local.md
  - kitelocal.html
  - kitelocal.min.html
  - src/js/04-i18n-en.js
  - src/js/10-map.js
  - src/js/20-kml-geom.js
  - src/js/30-tree-walk.js
---

## Decided
En «Traer como datos» de ArcGIS, la regla de rotulado del servidor fija el nombre sin preguntar solo si la capa existe para rotular (`arcgisIsLabelLayer`: nombre con `texto` como palabra, o símbolos que no dejan ningún píxel). En una capa de datos con regla (la «Elementos» de ENAIRE) se pregunta, con ese campo ya marcado (`kiteNameHint` → `nameHint` → `pickNameProperty({selected})`). El reparto clave/valor de la tabla de atributos es automático (la clave mide su texto, `--props-key-auto`) y el usuario lo cambia arrastrando el separador solo durante la sesión: se retiró la clave `propsSplit` de IndexedDB.

## Tried and ruled out
Decidir «capa de rótulos» solo por el símbolo: la `CTR_texto` real tiene el relleno opaco y el servidor lo oculta con una variable visual por campo; hace falta el nombre. Un porcentaje fijo menor para las claves: el problema era que crecía con la ventana, no su tamaño.

## Watch out
`servais-pre` no es accesible desde fuera: la capa «Elementos» no se pudo ver, la prueba usa una capa simulada con puntos rojos y regla de rotulado. Una asociación de nombres ya guardada para una capa se aplica sin preguntar (se cambia en Propiedades › Índices de GeoJSON).
