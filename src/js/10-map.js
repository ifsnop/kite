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
const BUILD = "202609071050";
map.attributionControl.setPrefix(
  `v${BUILD} | <a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>`);

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
  { id: "copernicus-dem", name: "Copernicus DEM (Sentinel Hub)", on: false, opacity: 1,
    dynamic: true, source: "copernicus",
    layer: (wmsLayer) => L.tileLayer.wms(shWmsUrl(), {
      layers: wmsLayer, format: "image/png", version: "1.3.0", transparent: true,
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

/* Estado en vivo de cada capa base */
const baseState = new Map(BASE_LAYERS.map((d, i) => [d.id, {
  def: d, layer: null, on: d.on, opacity: d.opacity, zIndex: i + 1, failed: false, wmsLayer: null
}]));

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
        if (++errors !== 8 || st.failed) return;
        st.failed = true;
        navMessage(`El mapa base \u00AB${st.def.name}\u00BB no responde; puede que el servicio haya cambiado.`);
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

