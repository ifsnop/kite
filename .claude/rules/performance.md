---
description: Reglas de rendimiento nacidas de medir (caché de geometría, guardado por lotes, progreso).
paths:
  - "src/js/**"
---

## Rendimiento (reglas nacidas de medir)

- **Mapa en lienzo** (`preferCanvas: true`): con miles de geometrías, SVG
  crea decenas de miles de nodos DOM y el zoom/pan se arrastra.
- **Caché de geometría por nodo, mecanismo CENTRAL** (`li._geo`):
  `toGeoJSON()` clona todas las coordenadas de la capa y se guarda tras
  CUALQUIER cambio del panel, así que sin caché renombrar reconstruía el
  archivo entero (medido: 349 ms → 5 ms con 8.000 capas). Se invalida
  SOLO donde cambia la geometría de verdad (mover un marcador), vía
  `invalidateGeo` — cualquier código nuevo que altere geometría debe
  invalidar ahí también. **`buildFromNodes` rellena `li._geo` con el
  `n.geo` ya guardado** (no lo deja en blanco): sin esto, deshacer,
  rehacer, pegar, importar `.kite.json` o el arranque volvían a pagar el
  coste completo. Cualquier código que reconstruya nodos «layer» desde un
  registro serializado debe seguir haciendo lo mismo (benchmark: 3-4× más
  rápido con caché tibia, 8.000 nodos).
- **`serializeNode` solo consulta `<ul class="node-list">` si
  `li._isContainer`** (asignado una vez en `makeNode`), evitando un
  `querySelector` de más en la inmensa mayoría de nodos (capas hoja) —
  pesaba tanto o más que el propio `toGeoJSON()` en geometrías pequeñas.
- **Retardo de guardado autoajustado** al coste medido del último
  (`saveCost`, entre `SAVE_MIN_MS` y `SAVE_MAX_MS`).
- **Lectura de coordenadas: un pintado por fotograma**
  (`requestAnimationFrame`, no por evento de ratón — llegan >100/s).
  Mismo patrón en el arrastre de marcador del diálogo de estilos
  (`onMarkerDragged`): solo `invalidateGeo` corre en cada evento `drag`;
  `renderCoords` se difiere a un único rAF, cancelado si el diálogo se
  cierra antes.
- **Moverse por el árbol cuesta O(profundidad)**, no O(nodos) — ver
  `tree-navigation-selection.md`. Ninguna operación de selección recorre
  la selección entera ni consulta el árbol por nodo. El buscador
  (`search-box`) sigue la disciplina: `SEARCH_DEBOUNCE_MS` (150 ms),
  mínimo `SEARCH_MIN_CHARS` (3) para no barrer ~8-10k nodos en cada
  tecla; Enter/Shift+Enter y ◀▶ no llevan ese mínimo (acción explícita).
- **Borrado de selección completa purga el `Set` UNA VEZ**
  (`clearSelection()` tras el bucle, no dentro de `deleteNode` por cada
  nodo — evita O(k²) al borrar k nodos de golpe). El resto de llamadas a
  `deleteNode(li, {pruneSelection})` sigue purgando por defecto.
- **Reconstruir una carpeta desde snapshot previo usa `Set`, nunca
  `Array.includes`** (`before.has(...)`): con array sería O(m²) sobre el
  tamaño de la carpeta destino. Aplica en `importTreeExport`,
  `addFileNode`, `pasteClipboard`.
- **`reorderPaintOrder` — pendiente de MEDIR, no de arreglar**: se
  dispara desde `scheduleSave()` en cualquier mutación (también las que
  no afectan orden de pintado), recorriendo todos los checkboxes del
  árbol. No es O(n²), pero nadie ha medido el coste con miles de capas.
  **No tocar sin medir antes** con `performance.now()` alrededor de
  `reorderPaintOrder()`.
- **Añadir N capas al mapa era O(N²) por dentro de Leaflet** (`09-leaflet-events.js`).
  Cada capa que se añade registra sus oyentes en el MAPA (un marcador,
  `zoom` y `viewreset`; con animación de zoom, también `zoomanim`; un
  tooltip permanente, lo mismo) y `Evented._on` comprueba que no estén
  ya registrados recorriendo la lista entera. Medido (Chromium sin GPU):
  importar 10 000 marcadores 1,8 s, 579 ms de ellos en esa comprobación;
  añadir un grupo al mapa, 1 032 ms con 10 000 y 4 252 con 20 000. El
  parche lleva un índice `Map(función → Set(contexto))` junto a las
  listas largas (≥ 32) y solo acelera el «no está», que es lo que ocurre
  al añadir; ver el comentario del archivo, que explica por qué un índice
  que se equivocara en ese sentido sería peor que no tenerlo (oyentes
  duplicados). Después: 495 ms con 10 000 (−52 %) y 964 con 20 000
  (−77 %); importar 10 000 marcadores, de 1 773 a 1 022 ms (−42 %).
  `tests/browser/perf-markers.mjs` lo fija con el parche apagado y
  encendido en la MISMA página (`setListenerIndex(false)`): mismo
  comportamiento en los escenarios que lo romperían, trabajo
  determinista (oyentes recorridos por la búsqueda lineal: N²/2 frente a
  casi nada) y tiempo con holgura. **Quitar sigue siendo O(N²)**
  (`splice` sobre la lista de oyentes, que no se toca): ≈ 280 ms con
  10 000 marcadores, pendiente de MEDIR en un caso real antes de tocarlo.
- **TRAMPA al medir tiempos de borrado en lotes grandes: el estado del
  GC manda.** `splice(0, 1)` sobre una lista grande es O(1) si V8 puede
  recortarla por la izquierda y un `memmove` si no (mientras hay marcado
  incremental en marcha, por ejemplo). Quitar 10 000 marcadores medía 96 ms
  en un build y 306 en otro «sin ningún cambio relevante»; forzando un GC
  justo antes (`--js-flags=--expose-gc`) los dos daban ~260-300. Antes de
  dar una regresión por real, comparar en la MISMA página activando y
  desactivando el cambio, o forzando el GC en ambas.
- **El guardado no reescribe lo inmutable** (`DB_VERSION` 5, ver
  `persistence-indexeddb.md`). IndexedDB no modifica un valor en parte y el
  structured clone del `put` es SÍNCRONO en el hilo principal: con el árbol
  como un único valor, CADA acción (plegar, marcar, borrar) iba seguida, a
  los 400 ms, de un bloqueo proporcional a TODO lo guardado. Medido
  (Chromium sin GPU, 7 copias de un `.kite.json` real, 114 MB, 22.078
  capas): 330 ms tras cada acción, con la acción en sí por debajo de 40 ms
  — el árbol nunca fue el problema. Con la composición de un árbol real
  (fichas 39 MB, polígonos 34 MB): 460 ms, 370 de ellos por la geometría.
  Ahora solo se reescribe el esqueleto: 32-46 ms por guardado en total, sin
  ninguna tarea larga; arranque 253 → 304 ms. `saveCost` mide además el
  clon síncrono del `put` (antes solo `serializeTree`, 3-10 ms, y el
  retardo nunca pasaba de 400 ms aunque el `put` tardara 330). Descartado
  tras medir: guardar la ficha ya saneada como arreglo de la pausa (−12 %
  con la composición real; sí recorta el arranque un 44 %, pendiente como
  mejora aparte), una clave por capa (ver arriba) y guardar en inactividad
  (mueve la pausa, no la quita).
- **Activar una carpeta con ~1.000 marcadores: se deja como está, decidido
  con el usuario** (2026-10-24). Medido SIN perfilador (el de CDP la
  inflaba a 89 ms): la cascada tarda ~185 ms la primera vez, con una tarea
  larga de 55-84 ms en 5 de cada 6 ejecuciones, y 130-190 ms después, casi
  siempre sin ella. Es Leaflet: cada marcador con el pin crea DOS `<img>`
  (pin y sombra) más su pintado, por software en la VM. Probado y
  descartado: ceder el hilo por tiempo (cada 8 ms) en vez de cada
  `CASCADE_BATCH` — la cascada sube a 281-497 ms, porque cada fotograma
  extra repinta todos los marcadores. Lo que sí funcionaba era quitar la
  sombra del pin (~100 ms, −45 %, tarea larga en 1 de 6), pero cambia el
  aspecto y el usuario prefirió conservarla; una imagen única pin+sombra
  quedó sin hacer. No reabrir sin un caso nuevo o una traza de un equipo
  con GPU.
- **Las librerías que solo usa una función no bloquean el arranque**
  (`07-lazy-libs.js`): html2canvas, geotiff.js y proj4js eran 646 KB sin
  comprimir (≈ 194 KB por la red) ejecutados antes de poder arrancar.
  Medido en frío, mediana de 7: `DOMContentLoaded` de 314 a 196 ms
  (−38 %; −40 % en el minificado); los scripts de CDN del arranque, de
  885 a 254 KB. El coste pasa al PRIMER uso: 40 ms (proj4), 74 ms
  (geotiff.js), 60 ms (html2canvas). JSZip (KMZ), topojson-client y
  shapefile siguen en el HTML: son el uso corriente o pesan 7 KB. Una
  librería nueva que solo use una función entra en `LAZY_LIBS`, no en
  `src/index.html`; `tests/lazylibs.js` exige que nadie use su global
  sin `ensureLib`.
- **Polígonos de solo relleno sin costuras** (`09-canvas-seamless.js`): una tanda se dibuja en un lienzo auxiliar y se compone una vez. Cada tanda cuesta ~1,7 ms (componer desde otro lienzo vacía el auxiliar; medido sin GPU) y 3 000 tandas de dos polígonos tardaban 5 s por redibujado, así que hay tope (`SEAMLESS_MAX_RUNS` = 24) y una tanda de un solo polígono no se abre. Medido con el tope: 3 000 polígonos de un color, 14,7 ms frente a 5,8 sin el parche; 3 000 en parejas de colores distintos (el peor caso), 50 ms frente a 5. Ver `style-dialogs-ui.md`.
- **Capas Leaflet PEREZOSAS: un registro `layer` apagado y sin marcadores no
  construye su capa hasta que alguien la lee** (`defineLazyLayer`,
  `buildRecordLayer`, `recLayerPending`, `32-geojson.js`). Causa, medida con
  un KML real de 309 MB (`20261103_P2.kmz`: 62 673 placemarks, 389 597
  polígonos, **9,66 M de vértices, todos `<visibility>0`**): construir las
  capas eran 9,4 s y +1,1 GB de heap al importar, copiarlas de vuelta a
  GeoJSON para guardar otros 1,3 s y +0,6 GB, y **volver a construirlas en
  cada arranque** 7,6 s y 3,1 GB de heap. Con un límite de heap de 3 GB el
  guardado pasó de 1,3 s a **66,8 s** (el recolector contra el techo; con 4 GB
  de memoria la pestaña murió) y, como el árbol ya estaba guardado, la
  aplicación no volvía a arrancar. Ahora: importar 4,7 s de construcción
  (heap 1,08 GB), `serializeTree` 14 ms, recargar 5,3 s y 1,46 GB, y con
  3 GB de límite todo igual (`serializeTree` 16 ms).
  - `rec._layer` pasa a ser un getter que construye y se sustituye por el
    valor; **todo código nuevo que recorra registros pendientes y NO necesite
    la capa** (apagar, quitar, medir, listar atributos) tiene que preguntar
    antes `recLayerPending(rec)` en vez de leer `_layer`, o la construirá. Hoy
    lo hacen `cascadeVisibility`, `setPendingChecked`, `removeRecordsFromMap`,
    `extendBoundsFromRecords` (encuadre desde `recGeoBounds`, la caja del
    GeoJSON), `recMapLayer` y la tabla de atributos (`recProperties`).
    Encender, desplegar la carpeta (`materializeRecords` crea su fila) o editar
    SÍ la construyen, que es lo correcto.
  - Solo es perezoso lo que no necesita Leaflet para existir: sin marcadores
    (necesitan su icono) y apagado. Al importar un KML, `buildKmlRecords` lee
    la geometría con `buildPlacemarkGeo` (sin pasar por Leaflet); al restaurar,
    `buildRecordsFromStorage` lo decide con `geoIsLazyable(geo)` y no si el
    árbol es AJENO (`opts.foreign`: Leaflet es quien rechaza una geometría
    rota y es mejor que falle al cargar que al encender).
  - **`buildPlacemarkGeo` tiene que dar EXACTAMENTE el `toGeoJSON()` de la capa
    de siempre**: redondeo a 6 decimales, un polígono descarta su vértice de
    cierre si coincide con el primero a 1e-9 y `toGeoJSON` lo vuelve a añadir,
    altitud solo si el vértice la traía, `properties` del `ExtendedData`.
    `tests/browser/lazy-layers.mjs` lo compara con Leaflet real sobre un corpus;
    al subir Leaflet, volver a pasarlo.
  - **El límite de heap es el problema real, no la CPU**: con 12 GB el mismo
    `serializeTree` tardó 1,3 s. Un equipo de 8 GB tiene ~2 GB de heap y uno de
    4 GB, ~1 GB. Cualquier camino que duplique la geometría (capa Leaflet +
    GeoJSON, DOM + registros) hay que medirlo con `--js-flags=--max-old-space-size=3000`.
  - **Se cede el hilo por TIEMPO** (`yieldIfDue`, `YIELD_BUDGET_MS` = 50) en
    `buildKmlRecords` y `buildRecordsFromStorage`, no cada `PROGRESS_BATCH`
    capas: 150 placemarks van de 10 ms a 1,5 s, y cada cesión cuesta un
    fotograma entero (418 cesiones fijas eran 6,5 s de espera). Los demás
    bucles (`materializeRecords`, cascadas) siguen por recuento.
  - `parseCoords` va en una sola pasada (`isSpaceCode` es `\s` a mano):
    2,9 s de un KML de 309 MB. `tests/parsecoords.js` lleva el de antes copiado.
  - Lo que NO se arregló, con su medida, está en
    `docs/pendientes-y-propuestas-kite-local.md`: el `DOMParser` (3,3 s, una
    sola tarea), el primer guardado (3,3 s de clon síncrono de un segmento de
    0,6 GB), la lectura al arrancar (2,5 s) y encender de golpe las 62 673
    capas (las construye todas).
- **Búsquedas por nombre local en el XML** (`elsByTag`, `firstByTag`,
  `childrenByTag`, `12-copernicus.js`): `firstByTag` copiaba la colección
  entera a un array para quedarse con el primero, y cada búsqueda VACÍA
  (un Placemark de punto busca `Polygon` y `LineString`) caía al filtrado
  a mano de todos sus descendientes. `mayNeedPrefixFallback` averigua una
  vez por documento si ese respaldo puede aportar algo (solo si algún
  elemento no tiene un `localName` limpio). 3 000 puntos: 6 000
  recorridos de todos los descendientes antes, 1 ahora (70 → 30 ms en
  Node). `tests/xmllookup.js` lleva la implementación anterior copiada y
  comprueba mismos resultados sobre cuatro tipos de documento, incluido
  un DOM sin soporte de namespaces donde el respaldo SIGUE haciendo falta.
- **Descartado tras medir** (no volver a proponerlo sin un caso nuevo):
  las 15 lecturas de IndexedDB del arranque en serie (2,8 ms; en paralelo
  0,8 ms); el pintado de miles de marcadores (236 ms por fotograma con
  10 000 a la vista, pero solo 0,3 ms son JavaScript: es rasterizado por
  software de 20 000 nodos DOM en una VM sin GPU, sin medida en un equipo
  con aceleración).
- Regla general: medir antes de optimizar, y dejar la medida en el
  comentario — es lo que impide "simplificar" sin saber qué costaba.

## Rendimiento y progreso

- Umbral `SIZE_THRESHOLD` (~2.5 MB): por debajo, carga silenciosa; por
  encima, tres fases: descompresión KMZ (determinada), "Procesando
  XML…" (indeterminada, `DOMParser` es síncrono/monolítico), construcción
  por lotes (determinada).
- Constructores del árbol `async`, ceden el hilo cada `PROGRESS_BATCH`
  capas con `yieldFrame()`. Cualquier bucle nuevo que cree muchas capas
  debe seguir el mismo patrón.
- Sin Web Workers: el tamaño objetivo (6–20 MB) no los justifica (sin
  `DOMParser` ni Leaflet en worker).
- Iconos de marcador sin coste de red: empotrados, `applyMarkerStyle`
  síncrona (ver `marker-icons.md`).
