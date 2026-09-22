---
description: Modo altura (MDT del IGN) y MDS (Copernicus/WCS): caché de rejillas, cobertura, cuadrícula acumulada, disciplina de peticiones.
paths:
  - "src/js/60-elevation.js"
---

- **Modo altura (⛰, MDT del IGN)**: altitud bajo el cursor vía XYZ del IGN
  (`raster-dem`, MDT05 PNOA, Terrain-RGB, zooms 5–15, solo España).
  Altitud **ortométrica** (no elipsoidal GNSS), en metros y pies
  (`fmtAltitude`, pie = 0,3048 m). Apagado por defecto (cada lectura es
  una petición externa); al activarlo se añade la atribución CC BY 4.0.
- **MDT y MDS por el MISMO camino** (`makeElevationSource`): ambos WCS
  2.0, rejilla ASCII, misma ventana/recorte — necesario para que restar
  MDT−MDS sea fiable (muestreo/interpolación/redondeo distintos rompían
  la resta). MDT: `servicios.idee.es/wcs-inspire/mdt`; `pickMdtCoverage`
  elige la malla más fina (5 m) y, a igualdad, un CRS geográfico.
- **Caché por REJILLA/COBERTURA, no por celda**: una rejilla sirve si
  contiene el punto pedido; indexar por celdas de 25 m dejaba huecos
  (~22 m) sin cobertura. Zonas sin dato sí se indexan por celda (no hay
  rejilla que las delimite).
- **Ventana de petición ±20 m** (no ±10): con celdas de 5 m cubre más
  puntos por petición.
- **Mientras el cursor esté dentro de la última rejilla se lee directo**
  (`gridSample`), sin pedir; se pide solo al salir de SU cobertura (no
  de la celda de caché).
- **Lectura bajo el CURSOR**, no la celda central de la rejilla.
- **Tres estados en `gridSample`**: `undefined` = fuera (pedir), `null`
  = dentro sin dato (no repetir), número = dato válido. No confundir los
  dos primeros.
- **Cuadrícula de elevaciones**: se dispara con la RESPUESTA del WCS, no
  con el movimiento del ratón. `parseAsciiGrid` devuelve la matriz
  completa + cabecera (`xllcorner`, `yllcorner`, `cellsize`); `gridValue`
  extrae la celda central.
- **Se ACUMULA mientras el modo altura está activo** (`drawElevGrid` no
  borra). Cada petición se ajusta (`snapTile`) a una retícula fija de
  teselas de 2×`ELEV_WINDOW` (origen/tamaño fijos de por vida) para que
  la misma zona caiga siempre en la misma tesela y el deduplicado
  (`elevTileKey`) compare esquinas exactas, no proximidad. Al
  desactivar, la sesión (`elevAccum`) se convierte en capa normal
  («Elevación N», sección «Elevaciones»); sesión vacía no crea capa.
  Tope `ELEV_ACCUM_MAX_CELLS` (cada celda es un `L.rectangle` + un
  `L.marker` DOM, no canvas).
- **Dibujo según zoom** (`elevZoomBand`): bajo zoom 19 (`ELEV_ZOOM_MINI`)
  solo relleno (rojo pastel si MDS−MDT > `ELEV_ALERT_DIFF` = 1 m, blanco
  si no); zoom 19 solo la diferencia; desde 20, las tres líneas
  (terreno/superficie/diferencia). Umbral siempre en METROS.
  `refreshElevCells` recalcula desde `_cell` (registro crudo por capa)
  sin red al cambiar zoom o unidad.
- **Unidad m/ft** (`elevUnit`, botón junto al de modo altura,
  `toElevUnit`/`METERS_PER_FOOT`): solo afecta a la capa de elevaciones,
  no al cuadro de coordenadas; no persiste, arranca en metros.
- **Repetir medición con una capa de elevaciones visible la AMPLÍA**:
  `pickClosestElevLi` fusiona en la única marcada, o en la más cercana
  al centro si hay varias (`mergeElevSession`); sin ninguna, crea
  «Elevación N+1». Durante la fusión, `elevRequest` evita puntos ya
  cubiertos (`coveredByPriorCells`, punto-en-rectángulo). Si la capa
  destino se borra a mitad, cae a crear una nueva.
- **La rejilla viaja etiquetada con su CRS** (`web`/`geo`/`native`): Web
  Mercator se deshace con la proyección de Leaflet; el nativo (UTM) no
  se dibuja (sin conversión inversa).
- **Texto de celda escala con zoom** (`gridFontSize`, crece desde el 21)
  — tamaño relativo a la celda, recalculado en `zoomend` sin red.
- **Celdas RECTANGULARES**: la ASCII grid da `cellsize` solo si son
  cuadradas, si no `dx`/`dy` (MDT y MDS devuelven mallas de tamaño
  distinto). Usar siempre `cellX`/`cellY`.
- **MDT y MDS se emparejan por POSICIÓN, no por índice** (pueden no
  empezar en el mismo punto).
- **Sin esquina, la rejilla no se dibuja pero sí se lee** (`located:
  false`): sigue siendo válida para el cuadro de coordenadas.
- **Mientras se consulta: «Consultando…»**, nunca el valor anterior
  (evita leer un número viejo como si fuera del punto nuevo). Cada fila
  lleva el prefijo del modelo (MDT/MDS).
- **MDS (altura de superficie)**: solo WCS 2.0 (`wcs-mds.idee.es/mds`,
  sin teselas XYZ) → una petición por punto, disparada al parar el
  cursor (`MDS_SETTLE_MS`), cacheada por celdas de `MDS_CELL` m.
- **Regla general de esta integración: de un servicio ajeno no se supone
  nada, se lee de sus capacidades** (`mdsDiscover`+`parseMdsCoverage`:
  cobertura del GetCapabilities, CRS/ejes/extensión del
  DescribeCoverage). Trampas reales ya comprobadas contra este servicio:
  `axisLabels` es ATRIBUTO del `<Envelope>`, no elemento; el eje se
  identifica por NOMBRE nunca por orden (aquí declara `x y`, al revés de
  la convención GML `N E`: asumir orden produce `ExtentError`); WCS
  exige repetir la clave `subset` una vez por eje (un objeto plano no
  vale).
- **El formato de salida también se descubre** (`formatSupported`+
  `pickMdsFormat`): este servicio publica ASCII como `ArcGrid`/
  `application/asc` (nombres no estándar) — buscar por patrón contra
  variantes, no por igualdad; suponer `text/plain` da
  `InvalidParameterValue`.
- **Errores OGC viajan en el CUERPO aunque el HTTP sea 400**: `mdsFetch`
  siempre lee el cuerpo y lanza ese texto + `exceptionCode`.
- **Cobertura ABSOLUTA, no la primera de la lista** (`pickMdsCoverage`):
  el servicio también publica `mdsn_e025`/`mdsn_v025` (normalizadas,
  altura sobre el suelo, no altitud) junto a `mds05` (absoluta).
- **Se pide en EPSG:3857 siempre que se pueda** (mismo sistema que
  dibuja el visor; conversión vía `map.options.crs.project`). Ventana
  corregida por latitud (`webMercatorHalf`, Web Mercator estira con el
  coseno de la latitud). Si el servicio no ofrece 3857 o rechaza, cae a
  geográficas y luego a nativas, recordando el descarte (salir de
  cobertura NO cuenta como rechazo).
- **Latitud/longitud como respaldo** (`crsSupported`→`pickGeoCrs`, ejes
  `Lat`/`Long` vía `subsettingCrs`, sin transformar nada a mano). Si el
  servidor la rechaza, pasa a nativas UNA sola vez (`cfg.useGeo =
  false`) y avisa.
- **MDS en un solo huso** (30 extendido para toda España, no el local de
  cada punto): `latLngToUtm(forceZone)` usa el que declare el EPSG de la
  cobertura (el huso local desplazaría el punto medio millón de metros
  en zonas límite como Barcelona).
- **Errores OGC llegan como XML con HTTP 200**: `parseOwsException` los
  reconoce (si no, un `ExtentError` se lee como «sin datos»). Salir del
  área cubierta no es error, solo «sin dato».
- **Se comprueba la extensión antes de pedir**: evita una petición
  condenada a fallar.
- **CSP**: los *sourcemaps* de librerías van por `connect-src` (unpkg/
  cdnjs deben estar ahí también); `frame-ancestors` no va en el `<meta>`
  (solo vale como cabecera HTTP).
- **Disciplina de peticiones al MDT**: caché de teselas con tope
  (`DEM_CACHE_MAX`, LRU), muestreo con retardo (`DEM_SAMPLE_MS`), tope
  de peticiones/s (`DEM_MAX_RPS`, ventana deslizante), peticiones en
  vuelo compartidas (`demPending`), teselas fallidas recordadas. Avisos
  agrupados por rachas (`DEM_STATUS_QUIET`). Cualquier consulta externa
  nueva debe seguir este patrón.
- **Tres estados**: `undefined` = aplazada por el tope, `null` = sin
  cobertura, valor = dato bueno. Nunca inventar un número.
- **Retícula**: recortada a la franja Mercator (±85°), paso creciente
  para que el nº de líneas quepa en `GRAT_MAX_LINES` cerca de los polos.
