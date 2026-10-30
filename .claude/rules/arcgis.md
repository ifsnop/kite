---
description: Servicios ArcGIS (MapServer) como nodo del árbol: dirección pegada en 🔗, teselas sobre /export, casillas = layers=show:, contenedor con capa propia, filas fijas, lo ajeno llega apagado, TREE_SCHEMA 9.
paths:
  - "src/js/66-arcgis.js"
  - "src/js/44-dialogs.js"
  - "src/js/31-tree-node.js"
  - "src/js/30-tree-walk.js"
  - "src/js/32-geojson.js"
---

## Servicios ArcGIS (`66-arcgis.js`)

Pedido del usuario: ver las capas de un servicio ArcGIS REST (el primero, un MapServer de ENAIRE con 28 capas de espacio aéreo; tiene más para después). Decidido con él: **código propio, sin esri-leaflet; varios servicios, cada uno con la dirección que pega; varias capas a la vez; un nodo en el árbol por servicio con una fila por capa; imagen del servidor Y traer los datos de una capa (botón ⤓)**.

### Por qué no el plugin esri-leaflet 3.0.19

Su `dynamicMapLayer` pide UNA imagen de la vista entera (`map.getBounds()`/`getSize()`): choca con el mapa girado (`08-map-rotation.js`), con la «una sola Tierra» y con el control de teselas fallidas. Su `featureLayer` pinta vectores fuera del árbol y necesita otro plugin (`esri-leaflet-renderers`) para la simbología. Lo propio es una `L.TileLayer` cuya URL es una caja en EPSG:3857 (como hace `L.tileLayer.wms`) y, para los datos, un `fetch` de `/query`. **No volver a proponerlo sin un caso nuevo.**

### Qué se verificó contra el servicio real (2026-10-30)

ArcGIS 11.3, 3857, `capabilities: "Map,Query,Data"`, `singleFusedMapCache: false` (no hay teselas cacheadas: se pide `/export`), `maxRecordCount` 2000, consulta en `geoJSON`; 28 capas con **id NO contiguos**, el array en el orden de la tabla de contenidos, `tables` (19, 20) que no son capas y capas `*_texto` que solo existen para rotular. **CORS refleja el `Origin`, también `null`** (`file://`). Un `/export` de 512 px tarda ~0,5 s. Los errores viajan como `{ error: { code, message, details } }` con HTTP 200 (la misma trampa que una excepción OGC). `tests/fixtures/arcgis-mapserver.json` es ese catálogo real.

### Entrada: el diálogo 🔗, no un botón nuevo

`runUrlFetch` llama a `arcgisServiceBase(url)`: si la dirección es un MapServer (la página, `?f=json`, una capa, una petición `/export`, `/identify`… pegada entera) lee **solo** `base + "?f=json"` y deja `urlReady = { arcgis: { cat, base } }`; «Añadir al árbol» llama a `addArcgisServiceNode`. `/query`, FeatureServer, ImageServer y WMSServer NO son un servicio (siguen el camino de descarga). **La consulta y el ancla se descartan SIEMPRE**: un `?token=` no se guarda ni se exporta nunca (un servicio que lo exija falla con 498/499 y se dice). Solo https y sin credenciales (`{ error: "https" | "credentials" }`).

### Modelo (`TREE_SCHEMA` 9)

```
{ t:"arcgis", name, checked, collapsed, url /* base, sin consulta */, opacity, tile: 256|512,
  extent: [s,w,n,e]|null, attribution,
  children: [{ t:"arcgisLayer", name, checked, id, data?:true, collapsed?, children? }] }
```

- `data: true` solo si el servicio tiene `Query` y la capa es `Feature Layer` (un grupo no).
- **Una capa empieza marcada si ella y todos sus ancestros son `defaultVisibility`.** `minScale`/`maxScale` no se guardan: el servidor ya deja fuera lo que no toca a esa escala.
- `sanitizeArcgisRecord` (PURA) es la validación de lo ajeno: la dirección debe ser EXACTAMENTE lo que `arcgisServiceBase` daría (https, sin consulta, sin barra final), id enteros en [0, 2³¹) y sin repetir, tope de 2 000 capas y profundidad 10, opacidad/extent/tile/atribución acotados. Una capa mala se descarta; un servicio malo, entero (como `buildCogRecord`).
- **`TREE_SCHEMA` 8→9 lee un árbol v8 (y v7) TAL CUAL**: cuarta excepción a «sin compatibilidad hacia atrás», misma forma que la v8 de `cog`, aceptada con el usuario. Se subió para que una instancia anterior rechace un árbol con servicios en vez de leer un `arcgis` con hijos como una carpeta.
- **Trampa**: en `serializePendingRecords`, un `t` desconocido cae al último caso (`imageOverlay`). Los dos tipos tienen su rama explícita; el test de navegador (servicio dentro de una carpeta nunca desplegada) lo vigila.

### Una capa de pintado por servicio; las casillas hijas solo deciden el `show:`

`ArcgisLayer` (`L.TileLayer` en el pane `kiteCogPane`, hijo de `rotatePane`, como `CogLayer`) cuelga de la casilla del NODO SERVICIO (`chk._layer`); las filas de las capas no tienen capa. Teselas de 512 px (256 si el servidor admite imágenes pequeñas), `getTileUrl` → `arcgisExportUrl(base, tileBbox3857(x,y,z,T), T·k, 96·k, ids)`; **sin `zoomOffset`**: el mundo de Leaflet mide 256·2^z px sea cual sea el tamaño de tesela. HiDPI: k = 1 o 2, sin pasar de 4096 px. `bounds` = extent +10 % recortado a `WORLD_BOUNDS` (ahorra peticiones y es lo que impide las teselas fuera del mundo con el mapa girado). `updateWhenZooming: false`: cada tesela cuesta ~0,5 s al servidor. Sin ningún id, la tesela es un GIF vacío (`ARCGIS_BLANK`), no una petición. Sin `crossOrigin`. La atribución del servidor pasa por `escapeHtml`.

- **`layers=show:` lleva SOLO las hojas marcadas** (`arcgisShowIds`), en el orden del catálogo, nunca el id de un grupo: cómo trata `show:` los grupos varía entre versiones; las hojas son exactas.
- **Sincronización**: `scheduleSave()` llama a `scheduleArcgisSync()` (como `scheduleReorder`); un fotograma después cada capa en el mapa recalcula sus ids (`arcgisLayerIds`: de la fila si existe, de los registros si el servicio está en una carpeta nunca desplegada) y, **solo si cambiaron**, redibuja a los `ARCGIS_REDRAW_MS` (300): varias casillas seguidas = UN redibujado. Con ningún servicio en el mapa no cuesta nada.
- **Contenedor con capa propia** (nuevo en el código genérico del árbol; cada parche es un no-op para una carpeta): `applyContainerState` llama a `applyVisibility` si `chk._layer` (apagar la última hija quita la imagen); `cascadeVisibility`/`removeRecordsFromMap`/`extendBoundsFromRecords` tratan la `_layer` de un registro CON hijos; `makeNode` acepta `sortable` (sin los botones de carpeta ☑ ☐ AZ ⊟ ▦), `fixed` y `extra`.
- **Marcar el servicio marca TODAS sus capas** (como cualquier carpeta): no recuerda cuáles estaban marcadas antes de apagarlo.

### Las filas de las capas son fijas (`li._fixed`)

Reflejan el catálogo del servidor: sin ↑ ↓ × ni 💾, sin `wireDrag`, sin renombrar (`startRename` y F2), y `movableSelection()` (Supr, ×, copiar, cortar y arrastrar) las deja fuera **avisando**. Nada se suelta ni se pega DENTRO de un servicio ni entre sus capas: `validDrop`, `dropZone`, `folderDropTarget`, `createFolderNode` y `pasteClipboard` (`arcgisServiceOf`) lo colocan DESPUÉS del servicio. El servicio, en cambio, se mueve, renombra, copia y borra como cualquier nodo; sus Propiedades solo tienen opacidad (`rasterState`, kind `arcgis`).

### Lo ajeno llega APAGADO

`buildRecordsFromStorage(nodes, prog, { foreign })` (desde `importTreeExport` y del pegado de otra pestaña) pone `checked = false` al servicio y a TODAS sus capas y avisa nombrando el servidor (`arcgisForeignNotice`). Abrir el `.kite.json` de otro no debe contactar un servidor que eligió él (cada tesela lleva la IP del usuario). Lo restaurado de este navegador, deshacer y el portapapeles INTERNO conservan su estado.

### Exportar

El servicio viaja en `.kite.json` (es una dirección y una lista) y **no** en KML/GeoJSON: se nombra UNA vez en el aviso (`exportRoot` no lo abre como carpeta; `recordsToKml`/`recordsToGeoJson` lo saltan antes de mirar los hijos).

### «Traer como datos» (botón ⤓ de una capa con `data`)

`arcgisFetchLayerData(li, button)` → `arcgisDownloadLayer` → `importIntoNewDownload` (44; la extracción de lo que hacía «Añadir al árbol» del 🔗: «Descargas › Descarga N», `pushUndo`, `handleDroppedFiles`). **Entra por el camino NORMAL de importación como un `.geojson`**: hereda la pregunta de etiquetas HTML (los atributos de ENAIRE traen `<FNT …>`), el selector del nombre (no vuelve a preguntar para una forma de atributos ya elegida), duplicados, resumen y deshacer. Tres peticiones, todas GET simples (`credentials: "omit"`, sin cabeceras propias):

1. `/{id}?f=json` → `parseArcgisLayerInfo`: ¿sabe GeoJSON?, ¿pagina (`advancedQueryCapabilities.supportsPagination`)?, `maxRecordCount` (tope 2 000 por página) y el campo OID (`objectIdField`, o el de `fields` de tipo `esriFieldTypeOID`: el servicio real de ENAIRE NO trae `objectIdField`).
2. `/{id}/query?where=1=1&returnCountOnly=true&f=json` → por encima de `ARCGIS_MAX_FEATURES` (100 000, el de un shapefile) se rechaza sin pedir ninguna página.
3. `/{id}/query?where=1=1&outFields=*&returnGeometry=true&outSR=4326[&orderByFields=<OID>&resultOffset=…&resultRecordCount=…]&f=geojson`, página a página mientras haya `exceededTransferLimit` (en lo alto de la respuesta o dentro de `properties`: según la versión) y no se haya llegado al recuento; `ARCGIS_MAX_PAGES` de cinturón. **Sin filtro espacial ni simplificación: la capa entera a resolución completa.** `outSR=4326` hace que la REPROYECCIÓN la haga el servidor (lo dice el estudio, 5.2).

Disciplina de red: `arcgisGetJson` = `withElevRetries` (2 reintentos de lo pasajero: tiempo agotado, red, 429, 5xx) con `AbortSignal.timeout` de 30 s POR INTENTO combinado con la cancelación (`AbortSignal.any`) y lectura con tope (`readCapped`); un `{error}` del cuerpo lleva `owsCode` y **no se reintenta**. Sin paginación el servidor corta en su límite: se importa lo recibido y un aviso sticky dice «n de total». **Cancelar**: pulsar otra vez el botón (pasa a ✕, estado en `dataset.mode`, nunca por el texto); la cancelación se apunta en `run.cancelled` y NO se deduce del motivo del aborto (el navegador rechaza con un `AbortError` o con el propio motivo según el sitio por el que se corte, y un `err.attempts = …` sobre una cadena lanza). Una descarga en vuelo por fila (`arcgisDataRuns`).

### Fallos

Tesela fallida: contorno rojo (`.tile-error`), la PRIMERA de cada capa se vuelve a pedir con `diagnoseTile(name, url, arcgisTileReason)` (lee el `{error}` del cuerpo) y avisa con el motivo del servidor; tras `BASE_FAIL_TILES` seguidas la fila pasa a `.service-failed` (rojo) y se avisa; un `tileload` lo rearma; `online` redibuja. Las etiquetas pueden salir cortadas en el borde de una tesela (512 px lo mitiga, no lo elimina).

### Red

Una consulta de catálogo por alta (en el diálogo: `URL_TIMEOUT`, cancelable, `ARCGIS_JSON_MAX` 5 MB, `netFailText` en el texto de CORS/sin red). Las teselas son `<img>` y no pasan por la disciplina de `fetch` (ver `external-network.md`). **No hay fila en el Anexo A del estudio**: no hay ningún servidor real en `src/` (la dirección la pone el usuario); va en A.5. **No poner la dirección de ENAIRE en el código ni en `index.html`** (`tests/docs.js` pediría su fila); tests y fixtures no se escanean.

### Pruebas

`tests/arcgistest.js` (lo puro, con el catálogo y la ficha de capa REALES de ENAIRE: `tests/fixtures/arcgis-mapserver.json`, `arcgis-layer10.json`) y `tests/browser/arcgis.mjs` (de punta a punta contra un servidor simulado con `ctx.route`: alta, `show:` con un solo redibujado, caja de cada tesela frente a Leaflet también girado, opacidad, filas fijas, recarga sin catálogo, borrar/deshacer, «Traer como datos» (páginas, etiquetas HTML, `{error}`, 503, tope, cancelación y servidor sin paginación), lo ajeno apagado, un servicio en una carpeta nunca desplegada, un árbol v8 y un servicio que falla). Capturas: `servicio-arcgis.png`, `url-arcgis.png` y `servicio-arcgis-datos.png` (`tools/capturas.mjs`, apartado 7.16 del manual).
