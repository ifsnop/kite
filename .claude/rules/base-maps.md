---
description: Capas base independientes, fuentes dinámicas (PNOA histórico, Copernicus), color de fondo del mapa, apilado y fallos de tesela.
paths:
  - "src/js/10-map.js"
  - "src/js/11-base-panel.js"
  - "src/js/12-copernicus.js"
---

## Mapas base

- **La lista se cierra al actuar fuera** (`closeBasePanelOutside`, `11-base-panel.js`; pedido del usuario: ocupa mucho del visor y tapaba otros diálogos): un `pointerdown` y un `keydown` en `document`, en CAPTURA (los controles de Leaflet detienen `mousedown`/`click`, así que el mapa nunca los vería), la ocultan si el objetivo no está en `.base-box` NI en `#color-picker` (el selector de color cuelga del `<body>` pero nace del botón de color de la primera fila). Escape y Tab/modificadores no pasan por aquí: Escape lo atiende la cadena de `52-measure.js`, que cierra antes lo que tenga encima (el selector de color, los diálogos) y la lista justo antes de herramienta y selección. Probado en `tests/browser/base-panel-close.mjs` (falla sin los dos oyentes).
- **Primera fila: color de fondo del mapa, no una capa**
  (`buildMapBackgroundRow`, `11-base-panel.js`). Es el color DETRÁS de
  las teselas (huecos, borde del mundo — no hay desplazamiento infinito,
  ver «Una sola Tierra»). Sin casilla propia (siempre puesto), separado
  con `.base-row-bg`. Usa el MISMO popover de color que el diálogo de
  estilos, con `onPreview` (aplica EN VIVO fijando `--map-bg` vía
  `setMapBackground`, `10-map.js`) y `onCommit` (persiste en IndexedDB,
  clave `mapBackground`) — no hay diálogo exterior que lo difiera, así
  que el propio popover hace de Cancelar/Aceptar. Sin valor guardado cae
  en `MAP_BG_DEFAULT`, que debe coincidir con el `#dfe8ef` del CSS
  (`#map { background: var(--map-bg, #dfe8ef) }`).
- **Dynamic layers: one machinery, several sources** (`DYNAMIC_SOURCES`,
  `dynSource`). A `dynamic: true` layer has a source that brings
  `get`/`error`/`ensure`, `pickDefault` and `groups`. Fixed ones today:
  `pnoa-hist` and `copernicus`, named by `def.source`; a user WMS layer brings
  its own object in `def.src` (`dynSource` reads `def.src` first). Neither
  `applyBaseLayer` nor `buildDynamicLayerSelect` may name a concrete source.
- **A source can be CONFIGURABLE without being `dynamic`** (a user tile layer):
  it brings `configure` (and `configureLabel`, the gear's title) but no
  `get`/`groups`/`pickDefault`/`ensure`, because there is no catalog to
  discover nor layer name to choose. The gear (`buildDynamicConfigButton`)
  and the blocked state are read from `dynSource(def)` without looking at
  `dynamic`; the `<select>` (`buildDynamicLayerSelect`) still requires
  `dynamic: true` explicitly. `ensureDynamicCatalogs` and the boot loop that
  calls `src.ensure()` check that it exists before calling it — a new source
  with a method sometimes missing must keep that same guard.
- **Blocked source** (`blocked()`): gives `label`/`hint` when nothing can be
  listed (today only Copernicus without a credential → disabled selector); it
  is not re-enabled just by turning the layer on. At boot a blocked layer saved
  as on is turned OFF instead of failing tile by tile — that check
  (`99-boot.js`) is generic through `dynSource`. A user layer is never blocked:
  it only exists with a valid address.
- **Configuring a source: gear ⚙** (`buildDynamicConfigButton`, in
  `.base-tools` left of the stacking arrows). Shown whenever there is
  `configure`, with or without credential, and with the layer off (otherwise a
  source not yet working could not be configured).
- **User base layers: add, edit, delete** (requested: the panel had two fixed
  configurable rows, «Custom Tile Map Service» and «Custom Web Map Service»;
  `11-base-panel.js`, «User base layers», and the dialog in `44-dialogs.js`).
  The «+ Añadir capa…» button at the bottom of the list (`buildAddUserBaseButton`)
  opens `#user-base`, where the user picks the TYPE (`tiles` or `wms`), an
  optional name (empty → the server's host, `userBaseDefaultName`) and the
  address; the help paragraphs with `data-ub-type` follow the chosen type.
  Each user row gets the gear (the same dialog as «Modificar capa base»: name,
  address and TMS; the type is fixed, another type is another layer) and a ×
  that opens `#user-base-delete` (confirmation: base maps are not in
  `pushUndo`, so a slip would lose the address for good). Things that are not
  obvious:
  - **Same shape as a fixed layer**: `makeUserBaseDef` builds a definition with
    the fields of a `BASE_LAYERS` entry plus `user` (the stored record) and
    `diagnoseTiles`; `addUserBaseLayer` puts it in `baseState` with
    `baseStateFor` (`10-map.js`, shared with the fixed ones). The panel,
    `applyBaseLayer`, stacking, opacity and `scheduleBaseSave` do not tell them
    apart. Ids are `u` + 12 hex (`newStoreId`), so the saved `bases`
    (on/opacity/order/`wmsLayer`) keys them like any other.
  - **Per-layer state**: a user WMS keeps its catalog, error, query in flight,
    version and format inside its source (`makeUserWmsSource`,
    `resetUserWmsSource`), not in module globals, so there can be several of
    each type. The source's error state is `src.err` (the `error()` method is
    what the panel calls).
  - **New layer = on top and ON** (`createUserBase`): the user asked to see it.
    Renaming (`updateUserBase`) touches nothing else; a new address or TMS drops
    the built layer (`dropBaseLayer`), and for a WMS also the catalog and the
    chosen layer. Deleting (`removeUserBase`) renumbers `zIndex` contiguously.
  - **Cap**: `USER_BASES_MAX` (20); at the cap the «+» is disabled with the
    reason in its title. Names capped at `USER_BASE_NAME_MAX` (80), shown
    through `textContent`, cut with an ellipsis in the row and whole in its
    `title`.
  - **Persistence**: one record, `userBases` (`USER_BASES_SCHEMA` 1), read
    through `validUserBases`/`userBaseRecord` (foreign input: bad entries,
    repeated ids and anything past the cap are dropped). Loaded at boot BEFORE
    `applySavedBases`, so the saved order and state find the ids. Never in the
    distributed file, a `.kite.json` or a view link (`LINK_BASE_IDS` only lists
    `BASE_LAYERS`). **The two old keys (`customTilesUrl`, `customWmsUrl`) are
    not migrated** (decided with the user): `dbLoadUserBases` deletes them.
  - **CSP**: `img-src` (and `connect-src`, for the GetCapabilities) is open to
    any `https:` for this — the user picks the origin, enumerating is
    impossible by definition; see `import-parsing.md`.
- **Tile type** (`userTilesTemplate`, `userBaseUrlProblem`): either a base
  address, to which `{z}/{x}/{y}.png` is appended (`normalizeCustomTilesBase`
  drops trailing slashes: two in a row are another path on many servers), or a
  full TEMPLATE with its own placeholders, kept as written. That covers the
  orders and formats of the fixed layers: Esri's `{z}/{y}/{x}`, `.jpg`, a WMTS
  in KVP form like the IGN's (`…&TileMatrix={z}&TileCol={x}&TileRow={y}`).
  Only the placeholders `L.tileLayer` fills in by itself (`USER_TILE_VARS`:
  `z`, `x`, `y`, `-y`, `s`): any other would make Leaflet throw on every tile,
  so it is rejected NAMING it; a template needs `{z}`, `{x}` and `{y}` (or
  `{-y}`). The «TMS» box sets Leaflet's `tms` (rows counted from the bottom,
  like the PNOA); `{-y}` is always inverted regardless. Only `https:`, without
  user or password (validated with the placeholders replaced by digits).
- **WMS type: the user's WMS, WITH a catalog** (`normalizeCustomWmsBase`,
  `fetchUserWmsCatalog`, `ensureUserWmsCatalog`). It is the configurable
  `dynamic` source: the layers come from that server's GetCapabilities (the
  same `parseWmsCapabilities` as PNOA histórico and Copernicus; grouped by
  `groupWmsEntries` in the order the server publishes). Things that are not
  obvious:
  - **`normalizeCustomWmsBase` removes the OGC parameters**
    (`CUSTOM_WMS_RESERVED`: service, request, version, layers, crs, bbox…)
    and the anchor, because a whole GetCapabilities or GetMap request is often
    pasted; it keeps the server's own (MapServer's `map=`) and
    `customWmsCapabilitiesUrl` respects them with `searchParams.set` (a second
    `?` would break the request). `URLSearchParams` re-encodes the query (`/` →
    `%2F`): a server decodes it the same.
  - **Only `https:` and without user/password** (`userBaseUrlProblem`):
    `fetch` rejects a URL with credentials with a cryptic error.
  - **The server dictates the WMS version** (`wmsCapabilitiesVersion`,
    1.1.0/1.1.1/1.3.0; anything else → 1.3.0): 1.3.0 is requested and a server
    that only speaks 1.1.1 answers with its own; Leaflet sends `crs` or `srs`
    by version. A layer saved as on is raised WITHOUT waiting for the catalog
    (with 1.3.0 assumed), so when it arrives with another version it is rebuilt
    (`dropBaseLayer`).
  - **Query in flight + address changed or layer deleted**:
    `fetchUserWmsCatalog` captures the address when it starts and discards what
    an old one answers (`stale`: other address, or the id no longer in
    `baseState`), or it would overwrite the new one's catalog and error. Same
    pattern in `fetchCopernicusCatalog` (with the instance ID): there, also, the
    `catch` of an old query released `copDiscovering`, which already belonged to
    the new credential, and the next call launched a duplicate; now only the
    one that set it releases it (`copDiscovering === discovering`). A
    credential that goes back to the same value (A→B→A) DOES validate A's answer.
  - **Image format of `<GetMap>`** (`wmsGetMapFormat`): the first of
    `CUSTOM_WMS_FORMATS` (PNG, JPEG, `image/jpg`) the server declares in
    `Capability/Request/GetMap` (parameters and capitals ignored; another
    operation's formats do not count). With none we can request, or no
    readable `<GetMap>`, PNG as before. **`transparent` only with PNG**: JPEG
    has no alpha, and some servers reject `transparent=true` with it. Like the
    version, a layer already built is rebuilt when a different format arrives.
    The CRS stays fixed at EPSG:3857 (each layer's, inherited from its parents,
    is not read); a server that does not draw that way fails tile by tile and
    shows red (`BASE_FAIL_TILES`).
  - **`collectWmsLayers` accepts a root with `<Name>` and no children** (a
    one-layer server often publishes it that way); with children, the root only
    groups them. Change shared with PNOA/Copernicus, whose roots always have
    children.
  - Tested in `tests/userbases.js` and `tests/customwms.js` (pure) and
    `tests/browser/user-bases.mjs` (end to end against simulated servers with
    `ctx.route`: both types, edit, delete, two WMS with their own catalogs,
    reload, errors, cap).
- **Tiles a user's server does not deliver** (`diagnoseTiles: true`, set by
  `makeUserBaseDef` on every user layer; `flagTileError`, `diagnoseTile`,
  `tileFailureReason`, `11-base-panel.js`). A failing WMS answers HTTP 200 with
  an XML `<ServiceException>`; an `<img>` cannot decode it and Leaflet leaves
  the tile with `visibility: hidden`, so the layer below shows through with no
  hint. Two things, ONLY for the user's servers (with the known ones tiles
  outside their coverage are normal and red would be noise): (1) the tile of
  the `tileerror` gets `.tile-error` (2 px red outline inside, `visibility:
  visible`, fixed red: it is map content, not chrome); (2) the FIRST one of
  each layer (`st.tileNoticed`, by WMS layer name; emptied when the layer is
  rebuilt) is requested again with `fetch` (`TILE_DIAG_TIMEOUT`) to read the
  reason and tell it with `navMessage`: the exception's text, the HTTP status
  (`describeHttp`), «respuesta X en vez de una imagen», or —if the `fetch`
  fails, typically CORS— a notice without a reason. Once per layer: a server
  failing across the map would get dozens of repeated requests while already
  failing. Independent of `BASE_FAIL_TILES`/`failed` (which still counts 8
  failures in a row to turn the layer red in the panel). The notice is a normal
  `navMessage`: it expires on screen and stays in the log. Tested in
  `tests/tilediag.js` and `tests/browser/user-bases.mjs`.
- **Copernicus DEM: Sentinel Hub, credencial DEL USUARIO** (`COP_WMS_BASE`,
  `shWmsUrl`, `setInstanceId`, diálogo `#sh-creds`). No existe WMS
  anónimo de Copernicus (EEA EU-DEM retirado; mirror AWS sin CORS). El
  *instance ID* se guarda en el navegador (`shCreds`/`SH_SCHEMA`), nunca
  en el archivo distribuido ni en un `.kite.json` exportado; sus capas
  salen de su propio GetCapabilities. Instance ID inválido → HTTP 400
  con `<ServiceException>` en el cuerpo, que es lo que se muestra (no el
  código HTTP).
- **Copernicus DEM es un DSM, no un MDT**: incluye edificios/vegetación;
  no sustituye al MDT del IGN ni sirve para la resta MDT−MDS del modo
  altura.
- **Copernicus no tiene imagen bajo zoom 7**, y responde 200 con una
  imagen fija de «no disponible» (se dibujaría como dato real).
  `minNativeZoom: COP_MIN_NATIVE_ZOOM` (7) + `minZoom: COP_MIN_ZOOM`
  (6). El corte en 6 es por coste: pedir el z7 cuesta 80 teselas en el
  z6 pero 270/986/1659 en z5/4/3, y Sentinel Hub factura por uso.
- **`minZoom` y `minNativeZoom` se combinan en este orden**:
  `GridLayer._setView` compara `minZoom` contra el zoom REAL antes de
  aplicar `minNativeZoom` — invertirlo dejaría `minZoom` sin efecto.
- **SRTM30 de terrestris** (`srtm`): relieve global sin credencial,
  `<Fees>None</Fees>`, WMS 1.1.1. Atribución `SRTM_CREDIT`. Cobertura
  56°S–60°N (no sustituye al sombreado de Esri por encima).
  `maxNativeZoom: 9` (más allá, Leaflet reescala; la malla real es de
  30 m).
- **Diálogo nuevo → definir su `max-width`**: `.dlg-box` trae
  `max-width: 90vw` (pensado para diálogos anchos). Cajas de texto corto
  van en la regla de `#kml-tags-picker, #kml-dup-picker, #sh-creds`
  (`max-width: 42ch`) — `#user-base` is the exception: content just as fixed
  (not resizable) but with more text explaining the server format it needs,
  so it has its own `width: min(92vw, 30rem)` instead of joining that 42ch
  list (`#user-base-delete`, a short confirmation, is in it).
- **Ventana de propiedades con ancho PROPIO, no de ajuste al
  contenido**: `#style-dialog .dlg-box { width: min(92vw, 24rem) }` —
  un nombre de KML largo no puede decidir el tamaño de la ventana.
  Nombre con `overflow-wrap: anywhere`; `#name-row input` sin el
  `max-width` de 190px de un campo corto (es el más largo del diálogo).
- **`collectWmsLayers`/`parseWmsCapabilities` reciben `exclude`/
  `rootGroup` como opciones**, compartidas por PNOA histórico y
  Copernicus. No hace falta evitar desestructurar en la firma (el
  extractor de tests, `tests/_extract.js`, ya salta la lista de
  parámetros).
- **Reordenables** con flechas por fila: el orden del Map `baseState` ES
  el de apilado, `zIndex` se recalcula al mover. Se guarda junto a
  opacidades; ids inexistentes se ignoran al leer, los nuevos se añaden
  al final.
- **No inventar capas**: verificar cada capa nueva contra el servicio
  real antes de darla por buena (la «Relieve» del WMTS del IGN daba
  404 — se sustituyó por el sombreado mundial de Esri).
- **`maxZoom` también en el mapa**, no solo por capa: sin él,
  `getMaxZoom()` da `Infinity` sin ninguna base activa, lo que rompía el
  cuadro de coordenadas y la escalera de zoom del doble clic.
- **Independientes**: se encienden en cualquier combinación, cada una
  con su opacidad. `BASE_LAYERS` es la lista/orden de apilado (primero =
  fondo); las capas se crean perezosamente al encenderlas.
- Configuración (encendidas + opacidades) en la clave `bases`
  (`BASE_SCHEMA`); al leer se descartan capas inexistentes y valores
  fuera de rango.
- **Fallo de tesela**: capa en rojo tras `BASE_FAIL_TILES` errores. Una
  tesela que SÍ llega (`tileload`) limpia `failed` y rearma el contador
  — sin esto, un corte de red dejaba la capa en rojo para siempre. Se
  cuentan solo fallos SIN acierto de por medio (teselas fuera de
  cobertura no implican servicio caído). Repintado solo en la
  transición.
- **Al recuperar la red, forzar redibujado**: Leaflet no reintenta solo.
  `window.addEventListener("online")` redibuja capas caídas; también se
  recupera solo moviendo el mapa (caso caída del servidor, donde
  `online` nunca llega).
- **`.base-toggle` con `position: absolute; right: 0`**, no en flujo:
  `.base-box` es `float: right` de ancho automático, su borde izquierdo
  se desplaza al desplegar `.base-list`. Mismo patrón que `.actions` de
  una fila.
