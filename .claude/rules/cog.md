---
description: Ortofotos COG (Cloud Optimized GeoTIFF) — almacén "rasters", validación, GridLayer reproyectada por malla, niveles, persistencia y limpieza.
paths:
  - "src/js/64-cog.js"
  - "src/js/32-geojson.js"
  - "src/js/99-boot.js"
---

## Ortofotos COG (`64-cog.js`)

Pedido del usuario: ver ortofotos del PNOA (cientos de MB) arrastrando el `.tif`, y que sigan ahí al recargar. Decidido con él: **archivo local copiado a IndexedDB** (no URL, no solo de sesión), proj4 para reproyectar, y que el `.kite.json` y el portapapeles del sistema las omitan con aviso.

- **No es un `imageOverlay`**: el GroundOverlay de un KMZ guarda la imagen como `data:` base64 DENTRO del árbol, que se reescribe entero en cada guardado. Con cientos de MB eso es imposible. Aquí el árbol guarda solo `{ rasterId, box, opacity }` y los bytes van como `Blob` NATIVO al almacén `rasters` (ver `persistence-indexeddb.md`: `DB_VERSION` 4 sin vaciar, `TREE_SCHEMA` 8 que acepta v7, limpieza al arrancar).
- **Validar ANTES de copiar** (`openCog` sobre el `File` soltado): GeoTIFF legible, 8 bits por canal (`BitsPerSample`/`SampleFormat` llegan como array TIPADO: `Array.from`, no `[].concat`, que lo deja anidado y rechazaba todo), EPSG de las GeoKeys en la tabla `cogCrsDef`, extensión válida. Luego la cuota (`navigator.storage.estimate`, margen `COG_QUOTA_MARGIN`) y `QuotaExceededError`. Un archivo que no se puede dibujar no gasta cuota ni deja nodo.
- **CRS**: tabla cerrada (`cogCrsDef`): 4326, 4258, 3857, ETRS89/WGS84/ED50 UTM 28–31, REGCAN95 UTM 27–28. ED50 con los mismos parámetros peninsulares que el shapefile (`ED50_TOWGS84`). Lo que no esté se rechaza NOMBRANDO el EPSG (`COG_CRS_LIST`); 32767 (definido por el usuario) cuenta como sin código. Nunca se supone.
- **Pintado**: `CogLayer` (`L.GridLayer`) en el pane `kiteCogPane` (z 300, hijo de `rotatePane`: entre mapas base y vectores; gira solo, ver `map-rotation.md`). `getBounds()` propio (lo piden 🔍 y `subtreeBounds`). Cada tesela: malla de `COG_GRID`² (16) puntos proyectados con proj4 (`tileSourceGrid`), nivel con `pickOverview` (el más basto que siga siendo tan fino como la tesela), ventana con `tileWindow`, `readRGB({ window, interleave, enableAlpha })`, máscara del nivel si la hay (`NewSubfileType` bit 2, emparejada por tamaño) y `warpTile` (bilineal sobre la malla, VECINO MÁS PRÓXIMO en la imagen: una ortofoto es dato, promediar inventaría colores). Medido contra proj4 punto a punto en z17: < 0,05 px.
- **Sin workers**: la CSP no deja crear los de `Pool` (blob:); geotiff decodifica en el hilo principal. Por eso `COG_CONCURRENCY` (4) lecturas a la vez y `COG_MAX_WINDOW` (2048²): sin vista general, alejarse pediría la imagen entera por tesela — se deja vacía y el aviso de la carga ya lo dijo («no trae vistas generales»). Una tesela retirada antes de su turno no se lee (`tile.isConnected`).
- **geotiff.js 2.1.3 `dist-browser` trae TODOS los decodificadores dentro** (JPEG —el del PNOA—, LZW, Deflate, PackBits, LERC, WebP), sin `import()` de red: el SRI lo cubre todo.
- **Un COG abierto por id y sesión** (`cogOpened`/`cogById`): lo comparten sus teselas, una copia pegada y deshacer.
- **Entrada**: solo arrastrando un `.tif`/`.tiff` (`handleDroppedFiles` → `addCogNode`, con `pushUndo`). Por 🔗 no: su tope es 100 MB. La barra de progreso se enseña SIEMPRE (no solo con archivos grandes), así que `addCogNode` la oculta él mismo.
- **ECW: reconocido y rechazado con receta** (`ecwHint`, `33-kml-import.js`). Es el formato del Centro de Descargas del CNIG (PNOA, `x-ecw 3.0`, hojas MTN50). No se lee porque no hay decodificador en JS, gdal3.js no trae el driver ECW, el SDK de Hexagon es propietario (gratis solo para decodificar en escritorio) y el libecwj2 abierto solo entiende ECW v2. El aviso (sticky) da `gdal_translate -of COG -co COMPRESS=JPEG` y la ruta de QGIS; `IMPORT_FORMATS` no lo lista. No volver a investigarlo sin un decodificador nuevo.
- **Tipo de nodo `cog`** (`li._cog`): kind propio en `styleKind`, `KIND_LABEL`, `STYLE_EDITABLE_KINDS`; el diálogo de estilos lo trata como un `imageOverlay` (misma sección de opacidad, vía `rasterState(t)`); 🔍 encuadra con margen (`fitBoundsFramed`). No se acierta con el clic derecho (`subHitTest` no sabe de `GridLayer`, igual que con `imageOverlay`).
- **Lo que no viaja**: `withoutCogNodes` (puro) quita los nodos `cog` a cualquier profundidad en `exportNode` y `copyToSystemClipboard`, y el aviso los nombra. El portapapeles interno sí los lleva (mismo blob).
- **Prueba con una imagen real** (2026-10-12): TCI de Sentinel-2 sobre Madrid, 362 MB, 10 980² px, EPSG:32630, 4 vistas generales, Deflate. Guardado en 31 ms (Chromium referencia el blob ya descargado), 25 teselas en 1,5–1,8 s, recargar y pintar desde IndexedDB, girado, y alineada con OSM a la precisión de Sentinel (~10 m).

## Pruebas

`tests/cogtest.js` (lo puro: tabla de CRS, GeoKeys, nivel, ventana, `warpTile` con máscara/nodata/alfa, huérfanos, `validCogRecord`, `withoutCogNodes`, serialización pendiente) y `tests/browser/cog.mjs`, que FABRICA sus GeoTIFF en mosaico byte a byte (un color por cuadrante; la vista general, a media intensidad) y lee el lienzo de la tesela: cada cuadrante en su sitio en UTM 30N y en Web Mercator, el nivel reducido a zoom 14, la malla frente a proj4, girado 30°, opacidad con el diálogo, recargar, borrar/deshacer, limpieza de huérfanos al arrancar, rechazo sin restos (EPSG:2062, 16 bits) y una base v3 con árbol v7 que sobrevive a la subida.
