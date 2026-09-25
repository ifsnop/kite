---
description: Orden y dependencias del manifiesto de módulos en src/js.
paths:
  - "src/js/**"
  - "build.js"
---

## Arquitectura (orden de secciones dentro del script)

1. **Mapa base**: capas de teselas (OSM, Esri Terrain, PNOA, sin fondo)
   y `rootGroup` (`featureGroup` del que cuelga TODO). Prefijo de
   atribución (versión+repo) y escala aquí: su posición depende del
   orden entre ambas (ver `view-controls-map.md`).
2. **Parseo KML**: estilos (`aabbggrr`→color+opacidad, `StyleMap` par
   *normal*), `<visibility>`, `<open>`, geometrías (MultiGeometry,
   polígonos con agujeros). GeoJSON con estilos simplestyle.
3. **Árbol de navegación**: `makeNode(...)` es la fábrica ÚNICA de
   filas (caret, checkbox, color, etiqueta, acciones). Toda fila nueva
   se crea con ella. Utilidades: `nodeUl`, `deleteNode`,
   `startRename`, `sortChildren`, `highlightNode`, `wireDrag`.
4. **Persistencia**: serialización del árbol completo a IndexedDB.
5. **Acciones del panel**: búsqueda, buscador de lugares (Nominatim),
   crear carpeta, seleccionar todo, selección masiva con teclado.
6. **Estilos de capa**: `makeDialogMovable`, selector de color,
   coordenadas (`formatCoord`/`parseCoord`), diálogo de estilos con
   borrador y Cancelar/Aceptar (botón 🎨), catálogo `MDI_ICONS`,
   `buildMarkerIcon`, `applyMarkerStyle`/`applyMarkerText`/
   `ensureMarkerDefaults`, `applyPolygonStyle`, selector de iconos.
7. **Separador redimensionable y toggle** del panel.
8. **Geodesia**: `bearingDeg`, `destPoint`, `fmtDist` — esfera
   (R = 6371 km, igual que Leaflet).
9. **Mediciones**: rutas y círculos, con el diálogo de propiedades
   abierto. Waypoint de ruta se arrastra sin más; centro/borde de
   círculo exige Ctrl+arrastre (mecanismo distinto, sin concepto de
   "vértice"). Botón de crear pin en la misma barra.
10. **Iluminación día/noche**: `subsolarPoint`/`sublunarPoint`/
    `solarElevationDeg` (única parte pura y testeada), un overlay WebGL
    sobre un `<canvas>` superpuesto al mapa que sombrea la parte visible
    según la posición real del sol, y un `<div>` propio (trayectoria
    discontinua + icono de sol y luna) recolocado en cada redibujado con
    `map.latLngToContainerPoint` — NINGUNO de los dos vive dentro de un
    pane de Leaflet (`.leaflet-map-pane` no deshace su transformación de
    arrastre al soltar, ver el comentario de `dnOverlay`). Efecto
    decorativo, sin persistencia.
11. **Controles de vista**: autoescala, ES/IC, retícula, coordenadas.
12. **Arranque**: restauración del árbol guardado. Al final, para que
    todo esté definido.

- **«No hay capas cargadas» es una CONCLUSIÓN tras leer IndexedDB, no
  el estado inicial.** El panel arranca en «Inicializando…»
  (`showLoadingMessage`, `30-tree-walk.js`); `99-boot.js`, ya con
  `dbLoadTree()` resuelto, decide si de verdad no hay nada
  (`showTreePlaceholder`, escribe por `textContent`, deja `rootUl` a
  null).
- **El arranque concluye mirando `rootUl`, no `nodes`**
  (`if (!rootUl) showEmptyMessage();`): leer IndexedDB es asíncrono y
  el usuario puede soltar un archivo mientras tanto — para entonces
  `ensureRootUl` ya sustituyó el aviso, y repintarlo dejaría esa
  importación colgando de un `<ul>` desconectado.
