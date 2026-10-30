---
title: "Servicios ArcGIS: contenedor con capa propia, filas hijas fijas y lo ajeno llega apagado"
author: Diego
date: 2026-10-30
branch: feat/servicios-arcgis-mapserver
cost: { minutes: 40, tokens: 887757 }
id: l-15898185
scope: repo
status: active
src: agent
touches:
  - src/js/66-arcgis.js
  - tests/arcgistest.js
  - tests/browser/arcgis.mjs
  - tests/navtest.js
  - index.html
  - tests/docs.js
  - src/js/31-tree-node.js
---

## Decided
- Un servicio MapServer es UN nodo del árbol (`arcgis`) con una `L.TileLayer` propia colgada de SU casilla (`chk._layer`) y una fila fija (`arcgisLayer`) por capa; las casillas hijas solo deciden el `layers=show:` (solo hojas marcadas, nunca el id de un grupo). Código propio, sin esri-leaflet: su `dynamicMapLayer` pide una imagen de la vista entera y choca con el mapa girado.
- Se añade desde el diálogo 🔗 (una dirección `…/MapServer` en vez de un archivo), no con un botón nuevo; de la dirección se descarta TODO lo que sigue a `MapServer` (un `token` no se guarda ni se exporta).
- Un servicio que llega de un `.kite.json` ajeno o de otra pestaña entra APAGADO con todas sus capas y se avisa del servidor: cada tesela lleva la IP del usuario. Lo restaurado, deshacer y el portapapeles interno conservan el estado.
- `TREE_SCHEMA` 9 lee v8 y v7 tal cual (cuarta excepción a «sin compatibilidad hacia atrás», aceptada con el usuario).

## Tried and ruled out
- Servicios dentro del panel de Mapas base: es una lista fija (una fila por capa, un desplegable) y habría que hacerla dinámica; el árbol ya tiene casillas de tres estados, deshacer y guardado.
- Un solo `show:` con el id del grupo: cómo lo trata ArcGIS varía entre versiones.

## Watch out
`serializePendingRecords` manda a `imageOverlay` cualquier `t` que no reconoce: los dos tipos tienen su rama explícita (lo vigila `tests/browser/arcgis.mjs`, servicio en una carpeta nunca desplegada). Los tests que extraen funciones aislado (`tests/navtest.js`) necesitan `arcgisServiceOf` en su lista. Marcar el servicio marca todas sus capas (como una carpeta). No poner la dirección de ENAIRE en `src/` ni en `index.html`: `tests/docs.js` pediría su fila del Anexo A.
