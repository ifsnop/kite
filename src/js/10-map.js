/* Leaflet es imprescindible: si el CDN falla o su hash de integridad no
   cuadra, el navegador lo bloquea, y sin este aviso quedaría una página
   en blanco sin explicación. Se corta aquí, diciendo qué mirar.      */
if (typeof L === "undefined") {
  document.body.innerHTML =
    '<div style="font:15px/1.5 system-ui,sans-serif;padding:2rem;max-width:46rem">'
    + '<h1 style="font-size:18px">No se pudo cargar Leaflet</h1>'
    + '<p>KITE Local necesita la librer\u00EDa de mapas Leaflet, servida desde unpkg.com. '
    + 'Compruebe la conexi\u00F3n; si la hay, puede que el archivo servido no coincida con el '
    + 'hash de integridad declarado en esta p\u00E1gina, en cuyo caso el navegador lo bloquea '
    + 'a prop\u00F3sito. La consola del navegador lo indica.</p></div>';
  throw new Error("Leaflet no disponible: se detiene el arranque");
}

"use strict";

/* ================= Visor: mapa base y capas de teselas ================= */
/* `preferCanvas`: con miles de geometrías, dibujarlas como elementos SVG
   crea decenas de miles de nodos en el DOM y el mapa se arrastra al hacer
   zoom o pan. En lienzo se pinta todo de una vez.                      */
/* `maxZoom` va en el MAPA, no solo en cada capa: sin él `getMaxZoom()`
   devuelve Infinity cuando no hay ninguna capa base activa, y eso salía
   escrito en el cuadro de coordenadas y rompía la escalera de zoom.
   Se fija en 25, por encima de los 19 que publican los servidores: con
   `maxNativeZoom` en cada capa, Leaflet ESCALA la última tesela recibida
   en vez de pedir niveles que no existen. Hace falta para poder leer la
   cuadrícula de elevaciones, cuyas celdas de 5 m son diminutas al 19. */
const MAX_ZOOM = 25;

/* Sondeo de aceleración por hardware: no hay API de JS para el estado de
   Compositing/Rasterization de chrome://gpu, así que el renderer que
   expone WebGL (WEBGL_debug_renderer_info) es el proxy más cercano
   disponible desde la página. Verificado contra una sesión real con
   chrome://gpu mostrando "Compositing: Software only": ahí el zoom de
   Leaflet perdía fotogramas (190 en una traza de 12 s) porque cada paso
   de zoom obligaba a rasterizar por CPU en vez de componer por GPU, con
   el hilo de script de la página inactivo — el coste no dependía en
   absoluto de cuántas capas hubiera cargadas ni activas. Si el sondeo
   falla (sin WebGL, excepción...) se asume que SÍ hay aceleración: un
   aviso de alarma falso es peor que no avisar.                        */
const SOFTWARE_RENDERER_RE = /swiftshader|llvmpipe|software|basic render|mesa/i;
function hasHardwareAcceleration() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return false;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info
      ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return !SOFTWARE_RENDERER_RE.test(renderer || "");
  } catch {
    return true;
  }
}
const hwAccelerated = hasHardwareAcceleration();

const map = L.map("map", {
  preferCanvas: true,
  maxZoom: MAX_ZOOM,
  zoomAnimation: hwAccelerated,
}).setView([40.4, -3.7], 6);

/* Fecha de generación del código (versión): AÑOMESDIAHORAMINUTO.
   Actualizar en cada generación; se muestra junto al crédito de Leaflet. */
const BUILD = "202609112340";
/* El enlace al repositorio va junto a la versión, que es lo que hace
   accionable saber qué build se está ejecutando: desde ahí se llega al
   código de esa versión. `target="_blank"` a propósito —salir de la
   página en la misma pestaña abandonaría la sesión de trabajo— y con
   `rel="noopener"`, que es lo que impide que la página destino toque
   `window.opener`.                                                    */
const REPO_URL = "https://github.com/ifsnop/kite";
map.attributionControl.setPrefix(
  `v${BUILD} | <a href="${REPO_URL}" target="_blank" rel="noopener"`
  + ' title="Código fuente del proyecto en GitHub">GitHub</a>'
  + ' | <a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>');

/* Escala del mapa: la de Leaflet (L.control.scale), no una propia —
   antes de escribir código hay que mirar si la librería ya lo resuelve,
   y esto lo resuelve entero: barra que se reescala en cada zoom y
   redondeo a cifras legibles. Se dejan sus valores por defecto
   (métrico e imperial, 100 px de ancho máximo), que además encajan con
   la costumbre del visor de dar siempre dos unidades.
   Va en la MISMA esquina que la atribución, y queda encima de ella sin
   colocarla a mano: Leaflet inserta cada control nuevo de una esquina
   INFERIOR delante de los que ya hubiera (insertBefore, no
   appendChild), y la atribución se creó con el mapa.                 */
L.control.scale({ position: "bottomright" }).addTo(map);

/* ================= Mapas base =================
   Se pueden encender a la vez y con la opacidad que se quiera, en vez de
   elegir uno solo: superponer, por ejemplo, el relieve bajo la ortofoto,
   o el MTN translúcido sobre la base. El orden de la lista es el orden
   de apilado (el primero, al fondo).                                  */
const IGN_WMTS = (service, layer, format = "image/jpeg") =>
  `https://www.ign.es/wmts/${service}?service=WMTS&request=GetTile&version=1.0.0`
  + `&Layer=${layer}&Style=default&Format=${format}`
  + "&TileMatrixSet=GoogleMapsCompatible&TileMatrix={z}&TileCol={x}&TileRow={y}";

const IGN_CREDIT = "Cedido por &copy; Instituto Geogr\u00E1fico Nacional de Espa\u00F1a";
/* terrestris exige atribuci\u00F3n en sus AccessConstraints; el dato de
   elevaci\u00F3n bajo esas teselas es el SRTM de la NASA.                 */
const SRTM_CREDIT = "SRTM 30m &copy; NASA LP DAAC \u2014 teselas de terrestris";
const COP_CREDIT = "Copernicus DEM \u2014 Copernicus Data Space / Sentinel Hub";
/* Primer nivel con imagen real en Copernicus, y primer nivel en el que
   se dibuja la capa (por debajo se reescalar\u00eda a un coste desmedido).
   Ver la definici\u00f3n de la capa.                                       */
const COP_MIN_NATIVE_ZOOM = 7;
const COP_MIN_ZOOM = 6;

const BASE_LAYERS = [
  { id: "osm", name: "OpenStreetMap", on: true, opacity: 1,
    layer: () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxNativeZoom: 19, maxZoom: MAX_ZOOM,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }) },

  /* Esri World Terrain: cobertura global solo hasta z9; más allá el
     servidor devuelve teselas de "Map data not yet available", así que
     con maxNativeZoom Leaflet reescala el último nivel recibido.     */
  { id: "terrain", name: "F\u00EDsico (Esri World Terrain)", on: false, opacity: 1,
    layer: () => L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}",
      { maxNativeZoom: 9, maxZoom: MAX_ZOOM,
        attribution: "Tiles &copy; Esri &mdash; Source: USGS, Esri, TANA, DeLorme, NPS" }) },

  { id: "ignbase", name: "IGN Base (IGN)", on: false, opacity: 1,
    layer: () => L.tileLayer(IGN_WMTS("ign-base", "IGNBaseTodo"),
      { maxNativeZoom: 19, maxZoom: MAX_ZOOM, attribution: `IGN Base. ${IGN_CREDIT}` }) },

  { id: "mtn", name: "Mapa topogr\u00E1fico MTN (IGN)", on: false, opacity: 1,
    layer: () => L.tileLayer(IGN_WMTS("mapa-raster", "MTN"),
      { maxNativeZoom: 19, maxZoom: MAX_ZOOM, attribution: `MTN r\u00E1ster. ${IGN_CREDIT}` }) },

  /* El WMTS del IGN no sirve ninguna capa llamada "Relieve" (devolvía
     404 en todas las teselas). Se usa el sombreado mundial de Esri, del
     mismo servidor que la capa física, que sí está publicado.       */
  { id: "relieve", name: "Relieve sombreado (Esri)", on: false, opacity: 1,
    layer: () => L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
      { maxNativeZoom: 19, maxZoom: MAX_ZOOM, attribution: "Hillshade &copy; Esri" }) },

  { id: "pnoa", name: "Ortofoto PNOA (IGN)", on: false, opacity: 1,
    layer: () => L.tileLayer("https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{y}.jpeg",
      { tms: true, maxNativeZoom: 19, maxZoom: MAX_ZOOM,
        attribution: `PNOA M\u00E1xima Actualidad. ${IGN_CREDIT}` }) },

  { id: "mdt", name: "MDT de Espa\u00F1a (IGN, WMS)", on: false, opacity: 1,
    layer: () => L.tileLayer.wms("https://servicios.idee.es/wms-inspire/mdt", {
      layers: "EL.ElevationGridCoverage", format: "image/png", version: "1.3.0",
      transparent: true, maxZoom: MAX_ZOOM, attribution: `MDT WMS. ${IGN_CREDIT}` }) },

  /* SRTM30 de terrestris: relieve global sin credencial (su
     GetCapabilities declara <Fees>None</Fees>), verificado contra el
     servicio real devolviendo teselas EPSG:3857 en WMS 1.1.1 \u2014 que es
     justo la versi\u00F3n que Leaflet manda por defecto. Su cobertura es la
     del SRTM, 56\u00B0S\u201360\u00B0N: por encima del paralelo 60 (Escandinavia,
     Islandia, Groenlandia) no hay dato, as\u00ED que no es un relieve
     verdaderamente global y no sustituye al sombreado de Esri.        */
  /* maxNativeZoom 9: por encima no se le pide NADA al servidor y Leaflet
     reescala la última tesela recibida. El servicio sí responde 200 por
     encima de ese nivel (comprobado hasta z16), pero la malla es de 30 m
     y esos niveles ya son interpolación: serían peticiones que no
     añaden detalle. Mismo trato que la capa física de Esri.           */
  { id: "srtm", name: "Relieve SRTM30 (terrestris)", on: false, opacity: 1,
    layer: () => L.tileLayer.wms("https://ows.terrestris.de/osm/service", {
      layers: "SRTM30-Colored-Hillshade", format: "image/png", version: "1.1.1",
      transparent: false, maxNativeZoom: 9, maxZoom: MAX_ZOOM,
      attribution: SRTM_CREDIT }) },

  /* Copernicus DEM. Las capas dependen de la configuraci\u00F3n del usuario
     en Sentinel Hub, as\u00ED que se descubren igual que las del PNOA
     hist\u00F3rico; la URL lleva su instance ID y por eso se arma en
     `shWmsUrl()` en vez de ser una constante. Ver la secci\u00F3n
     "Copernicus DEM" m\u00E1s abajo.                                       */
  /* Copernicus no sirve imagen por debajo del zoom 7: el servicio
     responde 200 con una imagen fija de "no disponible", que es peor que
     un error porque se dibuja como si fuera dato. `minNativeZoom` hace
     que en el zoom 6 se pida el 7 y Leaflet lo reescale, y `minZoom`
     corta por debajo, donde el reescalado deja de compensar: medido con
     el visor a 1075x900, pedir el 7 cuesta 80 teselas en el zoom 6, pero
     270 en el 5, 986 en el 4 y 1659 en el 3 — y Sentinel Hub factura por
     uso, así que serían miles de peticiones de la cuota del usuario para
     rellenar un mapamundi. Ojo al orden de los dos: Leaflet compara
     `minZoom` contra el zoom REAL y solo después aplica `minNativeZoom`
     (ver GridLayer._setView), que es lo que permite combinarlos.     */
  { id: "copernicus-dem", name: "Copernicus DEM (Sentinel Hub)", on: false, opacity: 1,
    dynamic: true, source: "copernicus",
    layer: (wmsLayer) => L.tileLayer.wms(shWmsUrl(), {
      layers: wmsLayer, format: "image/png", version: "1.3.0", transparent: true,
      minZoom: COP_MIN_ZOOM, minNativeZoom: COP_MIN_NATIVE_ZOOM,
      maxZoom: MAX_ZOOM, attribution: COP_CREDIT }) },

  /* No es una sola capa fija: `layer()` recibe el nombre de capa WMS
     elegido en el selector (ver "PNOA hist\u00F3rico" m\u00E1s abajo), descubierto
     contra el GetCapabilities real del servicio en vez de hardcodearlo. */
  { id: "pnoa-hist", name: "PNOA hist\u00F3rico (IGN)", on: false, opacity: 1,
    dynamic: true, source: "pnoa-hist",
    layer: (wmsLayer) => L.tileLayer.wms(PNOA_HIST_URL, {
      layers: wmsLayer, format: "image/jpeg", version: "1.3.0", transparent: false,
      maxZoom: MAX_ZOOM, attribution: `PNOA hist\u00F3rico. ${IGN_CREDIT}` }) }
];

/* Teselas fallidas seguidas (sin ninguna buena de por medio) antes de
   marcar la capa como caída en el panel.                              */
const BASE_FAIL_TILES = 8;

/* Estado en vivo de cada capa base */
const baseState = new Map(BASE_LAYERS.map((d, i) => [d.id, {
  def: d, layer: null, on: d.on, opacity: d.opacity, zIndex: i + 1, failed: false, wmsLayer: null
}]));

/* Al recuperar la red, Leaflet no reintenta por su cuenta las teselas
   que fallaron: se quedan en blanco hasta que el usuario mueve el mapa,
   y con ellas el aviso de "sin respuesta". Aquí se fuerza el redibujado
   de las capas marcadas como caídas, que es lo que hace que el aviso se
   retire solo. `online` no prueba que haya conectividad real —solo dice
   que hay interfaz—, pero como aquí se usa únicamente para REINTENTAR,
   equivocarse no cuesta nada: si sigue sin haber servicio, las teselas
   vuelven a fallar y la capa sigue marcada.                           */
window.addEventListener("online", () => {
  for (const st of baseState.values()) {
    if (st.failed && st.layer) st.layer.redraw();
  }
});

function applyBaseLayer(id) {
  const st = baseState.get(id);
  if (!st) return;
  if (st.on) {
    if (st.def.dynamic && !st.wmsLayer) {
      /* Sin cat\u00E1logo todav\u00EDa no hay qu\u00E9 nombre de capa pedir: se
         difiere y el ensure() de la fuente vuelve a llamar aqu\u00ED al
         resolver (o al fallar, en cuyo caso se queda apagada).       */
      const src = dynSource(st.def);
      const cat = src && src.get();
      if (cat) st.wmsLayer = src.pickDefault(cat);
      else { if (src) src.ensure(); return; }
    }
    if (!st.layer) {
      st.layer = st.def.dynamic ? st.def.layer(st.wmsLayer) : st.def.layer();
      st.layer.setZIndex(st.zIndex);
      /* Una URL que no responda debe verse, no fallar en silencio */
      let errors = 0;
      st.layer.on("tileerror", () => {
        if (++errors < BASE_FAIL_TILES || st.failed) return;
        st.failed = true;
        navMessage(`El mapa base \u00AB${st.def.name}\u00BB no responde; puede que el servicio haya cambiado.`);
        renderBasePanel();
      });
      /* Y dejar de responder no es para siempre: una tesela que S\u00CD llega
         significa que el servicio ha vuelto, as\u00ED que se retira el aviso
         y se rearma el contador. Antes `failed` se pon\u00EDa a true y no lo
         quitaba nadie, de modo que un corte de red dejaba la capa en
         rojo el resto de la sesi\u00F3n aunque volviera a funcionar.
         Contar solo los fallos SIN acierto de por medio es adem\u00E1s m\u00E1s
         fiel: unas cuantas teselas fuera de cobertura repartidas por la
         sesi\u00F3n no significan que el servicio est\u00E9 ca\u00EDdo.
         El panel se repinta solo en la transici\u00F3n, no en cada tesela. */
      st.layer.on("tileload", () => {
        errors = 0;
        if (!st.failed) return;
        st.failed = false;
        renderBasePanel();
      });
    } else if (st.def.dynamic) {
      st.layer.setParams({ layers: st.wmsLayer });
    }
    st.layer.setOpacity(st.opacity);
    if (!map.hasLayer(st.layer)) st.layer.addTo(map);
  } else if (st.layer && map.hasLayer(st.layer)) {
    map.removeLayer(st.layer);
  }
}

