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
  `copernicus`. Ni `applyBaseLayer` ni `buildDynamicLayerSelect` deben
  nombrar una fuente concreta.
- **Fuente bloqueada** (`blocked()`): da `label`/`hint` cuando no se
  puede listar nada (Copernicus sin credencial → selector deshabilitado,
  no se rehabilita solo con encender la capa). Al arrancar, una capa
  bloqueada guardada como encendida se APAGA en vez de fallar tesela a
  tesela.
- **Configurar una fuente: tuerca ⚙** (`buildDynamicConfigButton`, en
  `.base-tools` a la izquierda de las flechas de apilado). Visible
  siempre que haya `configure`, con o sin credencial, y con la capa
  apagada (si no, no se podría configurar una fuente aún no funcional ni
  retirar una credencial ya guardada).
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
  (`max-width: 42ch`).
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
