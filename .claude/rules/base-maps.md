---
description: Capas base independientes, fuentes dinámicas (PNOA histórico, Copernicus), color de fondo del mapa, apilado y fallos de tesela.
paths:
  - "src/js/10-map.js"
  - "src/js/11-base-panel.js"
  - "src/js/12-copernicus.js"
---

## Mapas base

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
- **Capas dinámicas: una maquinaria, varias fuentes** (`DYNAMIC_SOURCES`,
  `dynSource`). Una capa `dynamic: true` declara un `source` que aporta
  `get`/`error`/`ensure`, `pickDefault` y `groups`. Hoy: `pnoa-hist`,
  `copernicus`, `custom-wms`. Ni `applyBaseLayer` ni `buildDynamicLayerSelect` deben
  nombrar una fuente concreta.
- **Una fuente puede ser CONFIGURABLE sin ser `dynamic`** (`custom-tiles`,
  Custom Tile Map Service): aporta `blocked`/`configure` pero no `get`/`groups`/
  `pickDefault`/`ensure`, porque no hay catálogo que descubrir ni nombre
  de capa que elegir — solo una URL. La tuerca (`buildDynamicConfigButton`)
  y el estado bloqueado se leen de `dynSource(def)` sin mirar `dynamic`;
  el `<select>` (`buildDynamicLayerSelect`) sigue exigiendo `dynamic:
  true` explícitamente, así que una fuente sin catálogo no lo recibe.
  `ensureDynamicCatalogs`/el bucle de arranque que llama `src.ensure()`
  comprueban que exista antes de invocarlo (una fuente sin catálogo no
  lo tiene) — un cambio nuevo en `DYNAMIC_SOURCES` con un método a veces
  ausente debe seguir ese mismo guardia, no asumir la forma completa.
- **Fuente bloqueada** (`blocked()`): da `label`/`hint` cuando no se
  puede listar nada (Copernicus sin credencial → selector deshabilitado;
  Custom Tile Map Service sin URL → tuerca sin capa que construir; Custom Web Map Service sin URL → selector «Requiere URL»), no se
  rehabilita solo con encender la capa. Al arrancar, una capa bloqueada
  guardada como encendida se APAGA en vez de fallar tesela a tesela —
  ese chequeo (`99-boot.js`) ya es genérico por `dynSource`, cubre
  cualquier fuente con `blocked()` sea o no `dynamic`.
- **Configurar una fuente: tuerca ⚙** (`buildDynamicConfigButton`, en
  `.base-tools` a la izquierda de las flechas de apilado). Visible
  siempre que haya `configure`, con o sin credencial/URL ya puesta, y
  con la capa apagada (si no, no se podría configurar una fuente aún no
  funcional ni retirar lo ya guardado).
- **Custom Tile Map Service: URL del propio usuario, sin catálogo** (id `custom`, antes «Custom Maps»: solo cambió el título, lo guardado lo nombra por id; `customTilesUrl`,
  `setCustomTilesUrl`, `buildCustomTilesUrl`, diálogo
  `#custom-tiles-creds`, `11-base-panel.js`). El usuario pega solo la
  dirección BASE de su servidor (típicamente una caché/proxy delante de
  OpenStreetMap u otro servicio, para no cargar el servicio público
  ajeno); el código añade siempre `{z}/{x}/{y}.png` al construir la capa
  (`buildCustomTilesUrl`, llamada solo dentro de `layer()`, nunca antes:
  la URL puede no estar configurada todavía). Solo `https:` (mismo
  criterio que `connect-src`, nunca `http:`); se guarda en el navegador
  (`customTilesUrl`/`CUSTOM_TILES_SCHEMA`), nunca en el archivo
  distribuido ni en un `.kite.json` exportado. **CSP**: `img-src` se
  abrió a cualquier `https:` para esto — mismo motivo y misma forma que
  `connect-src` (el origen lo elige el usuario, enumerar es imposible
  por definición), ver `import-parsing.md`. Cambiar o borrar la URL
  invalida la capa ya creada (su plantilla lleva la URL anterior
  incrustada), igual que `setInstanceId` con la credencial de
  Copernicus. Solo admite servidores de teselas (XYZ, el esquema de
  OpenStreetMap, que el título y el diálogo llaman TMS); un servidor WMS
  es la capa siguiente.
- **Custom Web Map Service: WMS del propio usuario, CON catálogo**
  (id `custom-wms`, `customWmsUrl`, `setCustomWmsUrl`, `normalizeCustomWmsBase`,
  `fetchCustomWmsCatalog`, diálogo `#custom-wms-creds`, `11-base-panel.js`).
  Es la fuente `dynamic` configurable: la dirección sale del diálogo de la
  tuerca y las capas del GetCapabilities de ese servidor (mismo
  `parseWmsCapabilities` que PNOA histórico y Copernicus; agrupadas por
  `groupWmsEntries` en el orden que publica el servidor). Cosas que no son
  obvias:
  - **`normalizeCustomWmsBase` quita los parámetros de OGC**
    (`CUSTOM_WMS_RESERVED`: service, request, version, layers, crs, bbox…)
    y el ancla, porque a menudo se pega una petición GetCapabilities o
    GetMap entera; conserva los propios del servidor (`map=` de MapServer)
    y `customWmsCapabilitiesUrl` los respeta con `searchParams.set` (un
    segundo `?` rompería la petición). `URLSearchParams` recodifica la
    consulta (`/` → `%2F`): un servidor la decodifica igual.
  - **Solo `https:` y sin usuario/contraseña** (`validCustomWmsUrl`):
    `fetch` rechaza una URL con credenciales con un error críptico.
  - **La versión de WMS la dicta el servidor** (`wmsCapabilitiesVersion`,
    1.1.0/1.1.1/1.3.0; otra cosa → 1.3.0): se pide 1.3.0 y un servidor que
    solo habla 1.1.1 contesta con la suya; Leaflet manda `crs` o `srs`
    según la versión. Una capa guardada como encendida se levanta SIN
    esperar al catálogo (con 1.3.0 supuesto), así que al llegar con otra
    versión se rehace (`dropCustomWmsLayer`).
  - **Consulta en vuelo + dirección cambiada**: `fetchCustomWmsCatalog`
    captura la dirección al empezar y descarta lo que contesta una vieja
    (`stale`), o pisaría catálogo y error de la nueva. (`setInstanceId`, de
    Copernicus, no lo hace: el mismo riesgo, sin medir si importa.)
  - **Formato de imagen del `<GetMap>`** (`wmsGetMapFormat`): el primero de
    `CUSTOM_WMS_FORMATS` (PNG, JPEG, `image/jpg`) que el servidor declare en
    `Capability/Request/GetMap` (parámetros y mayúsculas ignorados; los
    formatos de otra operación no cuentan). Sin ninguno que sepamos
    pedir, o sin `<GetMap>` legible, PNG como antes. **`transparent` solo
    con PNG**: JPEG no tiene alfa, y algunos servidores rechazan
    `transparent=true` con él. Como la versión, una capa ya creada se
    rehace al llegar un formato distinto (`dropCustomWmsLayer`). El
    CRS sigue fijo en EPSG:3857 (no se lee el de cada capa, heredado de
    los padres); un servidor que no dibuje así falla tesela a tesela y
    sale en rojo (`BASE_FAIL_TILES`).
  - **`collectWmsLayers` acepta una raíz con `<Name>` y sin hijos** (un
    servidor de una sola capa suele publicarla así); con hijos, la raíz
    solo los agrupa. Cambio compartido con PNOA/Copernicus, cuyas raíces
    siempre tienen hijos.
  - Probado en `tests/customwms.js` (puro) y `tests/browser/custom-wms.mjs`
    (de punta a punta contra un servidor simulado con `ctx.route`).
- **Teselas que un servidor propio no entrega** (`diagnoseTiles: true` en las
  dos `custom*` de BASE_LAYERS; `flagTileError`, `diagnoseTile`,
  `tileFailureReason`, `11-base-panel.js`). Un WMS que falla contesta HTTP
  200 con un `<ServiceException>` en XML; un `<img>` no lo descifra y
  Leaflet deja la tesela con `visibility: hidden`, así que se ve la capa de
  debajo sin ninguna pista. Dos cosas, SOLO para servidores del usuario (en
  los conocidos las teselas fuera de cobertura son normales y rojo sería
  ruido): (1) la tesela del `tileerror` lleva `.tile-error` (contorno rojo
  de 2 px por dentro, `visibility: visible`, rojo fijo: es contenido del
  mapa, no cromo); (2) la PRIMERA de cada capa WMS (`st.tileNoticed`, por
  nombre de capa; se vacía al rehacer la capa) se vuelve a pedir con
  `fetch` (`TILE_DIAG_TIMEOUT`) para leer el motivo y avisar con
  `navMessage`: el texto de la excepción, el HTTP (`describeHttp`), «respuesta X
  en vez de una imagen», o —si el `fetch` falla, típicamente por CORS— un
  aviso sin motivo. Solo una vez por capa: un servidor que falla en medio
  mapa daría decenas de peticiones repetidas a quien ya está fallando.
  Independiente de `BASE_FAIL_TILES`/`failed` (que sigue contando 8 fallos
  seguidos para poner la capa en rojo en el panel). El aviso es un
  `navMessage` normal: caduca en pantalla, queda en el registro.
  Probado en `tests/tilediag.js` y `tests/browser/custom-wms.mjs`.
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
  (`max-width: 42ch`) — `#custom-tiles-creds` y `#custom-wms-creds` son la excepción: contenido
  igual de fijo (no redimensionable) pero con más texto explicando el
  formato de servidor exigido, así que lleva su propio
  `width: min(92vw, 30rem)` en vez de entrar en esa lista de 42ch.
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
