---
description: Orden y dependencias del manifiesto de módulos en src/js.
paths:
  - "src/js/**"
  - "build.js"
---

## Arquitectura (orden de secciones dentro del script)

0. **Idiomas de la interfaz** (`03-i18n.js`, `04-i18n-en.js`,
   `04-i18n-init.js`), lo PRIMERO del manifiesto: `tr()`/`trn()`/
   `trc()`/`N_()`, el registro de idiomas y el traductor del HTML
   estático. Los diccionarios (`04-i18n-xx.js`) van antes de
   `04-i18n-init.js`, que fija el idioma; desde ahí `tr()` vale en el
   nivel superior de cualquier módulo. Sin dependencias. Ver `i18n.md`.
0b. **Parches de Leaflet y cargador**, todos ANTES de crear el mapa:
   - `06-offline.js`: uso sin conexión (lista de lo que guarda el
     service worker, indicador «Sin conexión», `netFailText`); solo
     DECLARA funciones, `99-boot.js` las llama al final. Va antes que
     `07` pero lee `LAZY_LIBS` y `LEAFLET_PIN_URL` al llamarse. El
     worker en sí es `src/sw.js`, fuera del manifiesto. Ver `offline.md`.
   - `07-lazy-libs.js`: html2canvas, geotiff.js y proj4js bajo demanda
     (`LAZY_LIBS`, `ensureLib`); datos y una función, sin dependencias.
     Quien use una de ellas va por `ensureLib`, no por el global.
   - **Rotación del mapa** (`08-map-rotation.js`, derivado de
     leaflet-rotate): parches de prototipo. Ver `map-rotation.md`.
   - `09-leaflet-events.js`: índice de oyentes de `L.Evented` (añadir N
     capas al mapa era O(N²)). Ver `performance.md`.
   - `09-canvas-seamless.js`: `L.Canvas._draw` con «tandas» de polígonos
     de solo relleno compuestas con la opacidad una sola vez (sin
     costuras ni contornos entre vecinos). Ver `style-dialogs-ui.md`.
1. **Mapa base**: capas de teselas (OSM, Esri Terrain, PNOA, sin fondo)
   y `rootGroup` (`featureGroup` del que cuelga TODO). Prefijo de
   atribución (versión+repo) y escala aquí: su posición depende del
   orden entre ambas (ver `view-controls-map.md`).
2. **Parseo KML**: estilos (`aabbggrr`→color+opacidad, `StyleMap` par
   *normal*), `<visibility>`, `<open>`, geometrías (MultiGeometry,
   polígonos con agujeros). GeoJSON con estilos simplestyle.
2b. **Shapefile** (`34-shp-import.js`, detrás de la importación KML):
    agrupa las piezas soltadas (`groupShapefileParts`), lee con la
    librería `shapefile`, reproyecta con proj4 desde el `.prj` y entrega
    un FeatureCollection a `addFileNode` (que acepta el objeto, no solo
    texto). Ver `import-parsing.md`.
2c. **Exportar a KML y GeoJSON** (`35-export-formats.js`, tras la
    importación): registros serializados → texto, PURO y probado en Node
    (`tests/exportformats.js`), más el minimenú de 💾. Usa `arcPoints` y
    `normalizePathStyle`, de archivos posteriores, solo en tiempo de
    ejecución. Ver `tree-navigation-selection.md`, «Exportar e importar
    carpetas».
3. **Árbol de navegación**: `makeNode(...)` es la fábrica ÚNICA de
   filas (caret, checkbox, color, etiqueta, acciones). Toda fila nueva
   se crea con ella. Utilidades: `nodeUl`, `deleteNode`,
   `startRename`, `sortChildren`, `highlightNode`, `wireDrag`.
4. **Persistencia**: serialización del árbol completo a IndexedDB, guardado
   en dos niveles (esqueleto en `root` + segmentos con lo pesado; ver
   `persistence-indexeddb.md`).
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
   abierto. Waypoint de ruta y centro/borde de círculo se arrastran sin
   más con su diálogo abierto (el círculo por un mecanismo distinto, sin
   concepto de "vértice"). Botón de crear pin en la misma barra.
10. **Iluminación día/noche**: `subsolarPoint`/`sublunarPoint`/
    `solarElevationDeg` (única parte pura y testeada), un overlay WebGL
    sobre un `<canvas>` superpuesto al mapa que sombrea la parte visible
    según la posición real del sol, y un `<div>` propio (trayectoria
    discontinua + icono de sol y luna) recolocado en cada redibujado con
    `map.latLngToContainerPoint` — NINGUNO de los dos vive dentro de un
    pane de Leaflet (`.leaflet-map-pane` no deshace su transformación de
    arrastre al soltar, ver el comentario de `dnOverlay`). Efecto
    decorativo, sin persistencia. Además aporta a la ficha de un marcador
    las horas del sol y crepúsculos (`sunTimes`/`sunTimesHtml`, puras y
    testeadas; ver `style-dialogs-ui.md`, «Ficha del elemento»).
11. **Calculadora geodésica** (`62-geocalc.js`): ventana flotante con
    una pestaña por cálculo (ángulo de elevación con cono y corrección
    por presión, vector GPS), recalculadas solas, sin botón; la lógica
    pura vive en `51-geodesy.js`.
    Ver `geocalc.md`.
11b. **Perfil de una ruta** (`63-route-profile.js`): descarga por trozos
    del MDT y el MDS a lo largo de una ruta, gráfica SVG, flecha en el
    mapa y capa de las celdas recorridas (con las curvas, para
    «Mostrar perfil»); lo puro (trozos, muestras, un punto por celda,
    posición en la ruta, clave de la geometría, validación, celdas del
    árbol, marcas de eje) se prueba en Node. Va detrás de la
    calculadora: usa el cliente WCS de `60-elevation.js`; su
    `refreshProfileChart` (desde `setMeasureUnit`/`setAltitudeUnit`),
    `routeProfileCtxItem` (menú contextual, diálogo de la ruta) y
    `validRouteProfile` (`buildElevGridRecord`) se llaman desde archivos
    anteriores solo en tiempo de ejecución. Ver `elevation-dem.md`.
11c. **Ortofotos COG** (`64-cog.js`): almacén `rasters` (bytes como
    `Blob`), `openCog` (validación, niveles y máscaras, CRS de las
    GeoKeys), `CogLayer` (`L.GridLayer` en su pane `kiteCogPane`, dentro
    de `rotatePane`) y `addCogNode`. Al CARGAR crea el pane
    (`map.createPane`), así que va detrás de `10-map.js`; lo puro
    (`cogCrsDef`, `pickOverview`, `tileWindow`, `warpTile`,
    `cogGridPoint`, `orphanRasterIds`, `validCogRecord`) se prueba en
    Node. `buildCogRecord`/`cleanOrphanRasters`/`addCogNode` se llaman
    desde archivos anteriores (32, 33, 99) solo en tiempo de ejecución.
    Ver `cog.md`.
11d. **Parcela catastral** (`65-cadastre.js`): dos consultas al Catastro
    (referencia por coordenadas y polígono por WFS INSPIRE), validación
    de lo recibido y capa normal del árbol; lo puro (URLs, referencia,
    GML → GeoJSON, bytes con su codificación) se prueba en Node. Va tras
    `64-cog.js` y usa `withElevRetries` (`52`), `describeHttp` (`40`) y
    `makeNode`; el menú contextual (`70`) la llama solo en tiempo de
    ejecución. Ver `cadastre.md`.
12. **Controles de vista**: autoescala, ES/IC, retícula, coordenadas.
13. **Arranque**: restauración del árbol guardado. Al final, para que
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
