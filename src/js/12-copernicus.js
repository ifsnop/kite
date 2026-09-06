/* ---------- Copernicus DEM (Sentinel Hub del Copernicus Data Space) ----------
   Comprobado contra los servicios reales antes de elegir esta vía:
   Copernicus NO publica ningún WMS anónimo. El de la EEA (EU-DEM v1.1)
   se retiró —su MapServer responde "not started" y su WMSServer da
   404— y el mirror de AWS sirve COG sin cabeceras CORS (y rechaza el
   preflight con 403), así que es ilegible desde el navegador. La única
   vía viva es Sentinel Hub, que autentica sus servicios OGC con un
   "instance ID" de la cuenta de cada usuario: es SU credencial, no una
   nuestra, así que se pide y se guarda en este navegador en lugar de
   incrustarse en el archivo, que se distribuye.
   Verificado también contra el servicio real: manda CORS correctos
   (refleja el Origin), y con un instance ID inválido responde HTTP 400
   con <ServiceException>Invalid instance id</ServiceException>, de modo
   que el error que ve el usuario es el del propio servicio.
   Las capas no se pueden fijar de antemano: cada usuario decide cuáles
   publica su configuración, así que salen de su GetCapabilities igual
   que las del PNOA histórico.                                         */
const COP_WMS_BASE = "https://sh.dataspace.copernicus.eu/ogc/wms/";
const COP_TIMEOUT = 15000;
/* La configuración del usuario puede publicar cualquier cosa, no solo
   elevación, y no hay grupos anidados que agrupar: una sola caja.    */
const COP_WMS_OPTS = { exclude: new Set(), rootGroup: "Capas de tu configuración" };

let shInstanceId = null;       /* credencial del usuario, si la ha dado */
let copCatalog = null;
let copError = null;
let copDiscovering = null;

function shWmsUrl() { return COP_WMS_BASE + encodeURIComponent(shInstanceId || ""); }

/* Se acepta el UUID que da el panel de Sentinel Hub. Validar la forma
   aquí evita una petición condenada y un error críptico del servicio. */
function validInstanceId(txt) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(txt.trim());
}

async function fetchCopernicusCatalog() {
  if (copCatalog) return copCatalog;
  if (copDiscovering) return copDiscovering;
  copError = null;
  copDiscovering = (async () => {
    const r = await fetch(`${shWmsUrl()}?service=WMS&request=GetCapabilities&version=1.3.0`,
      { signal: AbortSignal.timeout(COP_TIMEOUT) });
    const txt = await r.text();
    /* El error OGC viaja en el cuerpo aunque el HTTP sea 400 */
    const ex = parseWmsServiceException(txt);
    if (ex) throw new Error(ex.msg);
    if (!r.ok) throw new Error(describeHttp(r.status));
    const entries = parseWmsCapabilities(txt, COP_WMS_OPTS);
    if (!entries) throw new Error("tu configuración de Sentinel Hub no publica ninguna capa");
    copCatalog = entries;
    return entries;
  })().catch(err => {
    copDiscovering = null; /* permite reintentar en la próxima llamada */
    copError = err.name === "TimeoutError" ? "el servicio no responde"
      : err.message === "Failed to fetch" ? "no se pudo conectar con Sentinel Hub"
      : err.message;
    throw err;
  });
  return copDiscovering;
}

function ensureCopernicusCatalog() {
  if (copCatalog || !shInstanceId) return;
  fetchCopernicusCatalog().then(onDynamicCatalogReady).catch(() => renderBasePanel());
}

/* Cambiar (o borrar) la credencial invalida el catálogo y la capa ya
   creada, cuya URL lleva dentro el instance ID anterior.              */
function setInstanceId(id) {
  shInstanceId = id || null;
  copCatalog = null; copError = null; copDiscovering = null;
  const st = baseState.get("copernicus-dem");
  if (st) {
    if (st.layer && map.hasLayer(st.layer)) map.removeLayer(st.layer);
    st.layer = null;
    st.wmsLayer = null;
    st.failed = false;
    if (!shInstanceId) st.on = false;
  }
  (shInstanceId ? dbSaveSh({ instanceId: shInstanceId }) : dbDeleteSh()).catch(() => {});
  scheduleBaseSave();
  if (shInstanceId) ensureCopernicusCatalog();
  renderBasePanel();
  if (st && st.on) applyBaseLayer("copernicus-dem");
}

/* Registro de fuentes de capa dinámica. Se declara DESPUÉS de las
   funciones que referencia y solo se consulta desde manejadores que
   corren con el script ya evaluado, así que no hay zona muerta.      */
const DYNAMIC_SOURCES = {
  "pnoa-hist": {
    selectTitle: "Año / vuelo",
    get: () => pnoaHistCatalog,
    error: () => pnoaHistError,
    ensure: ensurePnoaHistCatalog,
    pickDefault: pnoaHistDefault,
    groups: groupPnoaHistEntries
  },
  "copernicus": {
    selectTitle: "Capa de Copernicus",
    get: () => copCatalog,
    error: () => copError,
    ensure: ensureCopernicusCatalog,
    pickDefault: entries => entries[0] && entries[0].name,
    groups: entries => [{ group: COP_WMS_OPTS.rootGroup, items: entries }],
    blocked: () => shInstanceId ? null : {
      label: "Requiere credencial",
      hint: "Configurar la credencial de Sentinel Hub que exige Copernicus"
    },
    configure: () => openShCredsDialog()
  }
};
function dynSource(def) { return (def && def.source && DYNAMIC_SOURCES[def.source]) || null; }

function ensureDynamicCatalogs() {
  for (const st of baseState.values()) {
    const src = dynSource(st.def);
    if (src) src.ensure();
  }
}

/* Grupo raíz del visor: cuelgan todas las capas de todos los archivos */
const rootGroup = L.featureGroup().addTo(map);

/* ================= Utilidades de estilo KML =================
   Every lookup here is namespace-agnostic. Real-world KML often carries
   prefixes (<kml:Placemark>, <gx:Track>…) or declares no namespace at
   all, so nothing may depend on the literal tagName: `localName` and
   `getElementsByTagNameNS("*", …)` match the element regardless of the
   prefix or namespace it was written with.                            */

/* Nombre sin prefijo. En un DOM con namespaces `localName` ya lo da; si
   el documento se analizó sin ellos, se recorta a mano el "kml:".     */
function bareName(el) {
  const n = el.localName || el.nodeName || "";
  const i = n.indexOf(":");
  return i < 0 ? n : n.slice(i + 1);
}

/* Búsqueda por nombre local. La vía rápida es la consulta con comodín de
   namespace; si no devuelve nada (documento sin namespaces), se filtra a
   mano. Con las dos, el parser funciona con KML con prefijo, sin él o
   con namespaces por defecto.                                        */
function elsByTag(root, name) {
  if (!root || !root.getElementsByTagName) return [];
  if (root.getElementsByTagNameNS) {
    const found = [...root.getElementsByTagNameNS("*", name)];
    if (found.length) return found;
  }
  return [...root.getElementsByTagName("*")].filter(el => bareName(el) === name);
}
const firstByTag = (root, name) => elsByTag(root, name)[0] || null;
const childrenByTag = (parent, name) =>
  parent ? [...parent.children].filter(c => bareName(c) === name) : [];

/* KML usa color en formato aabbggrr; lo pasamos a {color:#rrggbb, opacity} */
function kmlColor(hex) {
  if (!hex) return null;
  hex = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6,8}$/i.test(hex)) return null;
  hex = hex.padStart(8, "0");
  const a = parseInt(hex.slice(0, 2), 16) / 255;
  const b = hex.slice(2, 4), g = hex.slice(4, 6), r = hex.slice(6, 8);
  return { color: `#${r}${g}${b}`, opacity: a };
}

/* Texto del primer descendiente con ese nombre de etiqueta */
function text(parent, tag) {
  const el = firstByTag(parent, tag);
  return el ? el.textContent.trim() : null;
}

/* Texto de un HIJO DIRECTO (importante para <visibility> y <open>) */
function directChildText(parent, tag) {
  const el = childrenByTag(parent, tag)[0];
  return el ? el.textContent.trim() : null;
}

/* <visibility> del propio nodo: por defecto 1 según la especificación KML */
function ownVisibility(el) {
  return directChildText(el, "visibility") !== "0";
}

/* Lee <Style> y devuelve opciones de estilo para L.Polygon / L.Polyline */
function parseStyleElement(styleEl) {
  const style = {};
  const line = firstByTag(styleEl, "LineStyle");
  if (line) {
    /* Solo el color: el contorno es siempre 100% opaco (se ignora el alfa) */
    const c = kmlColor(text(line, "color"));
    if (c) style.color = c.color;
    const w = parseFloat(text(line, "width"));
    if (isFinite(w)) {
      if (w > 0) style.weight = w;
      else style.stroke = false; /* width 0: a canvas lineWidth of 0 still
        draws (the spec falls back to the previous width), so a real
        outline needs stroke:false, not just weight left at 0 */
    }
  }
  const poly = firstByTag(styleEl, "PolyStyle");
  if (poly) {
    const c = kmlColor(text(poly, "color"));
    if (c) { style.fillColor = c.color; style.fillOpacity = c.opacity; }
    if (text(poly, "fill") === "0") { style.fillOpacity = 0; style.fill = false; }
    /* Only meaningful for an actual polygon: per the KML spec, PolyStyle
       has no defined effect on a LineString. Kept apart from `stroke`
       (which LineStyle's own width<=0 also sets) until
       buildPlacemarkLayer knows whether this placemark has a Polygon at
       all — folding it into `stroke` unconditionally used to also hide
       a plain line whose shared <Style>/<StyleMap> happened to carry a
       PolyStyle meant for an unrelated polygon (real KML observed: a
       route line rendered invisible this way).                        */
    if (text(poly, "outline") === "0") style.polyOutline = false;
  }
  return style;
}

/* Indexa <Style> y <StyleMap> por id y resuelve las referencias.
   Un StyleMap puede apuntar a otro StyleMap y una cadena puede tener
   ciclos, así que la resolución es perezosa, con memoria y con tope de
   saltos. Los estilos externos ("archivo.kml#id") no se pueden resolver
   sin descargar ese archivo: se ignoran y se cuentan como aviso.      */
const STYLE_HOPS = 8;

function buildStyleIndex(doc) {
  const own = {};      /* id -> opciones propias del <Style> */
  const links = {};    /* id -> id al que apunta el <StyleMap> "normal" */
  let external = 0;    /* referencias a otros archivos, no resolubles */

  for (const el of elsByTag(doc, "Style")) {
    const id = el.getAttribute("id");
    if (id) own["#" + id] = parseStyleElement(el);
  }
  for (const el of elsByTag(doc, "StyleMap")) {
    const id = el.getAttribute("id");
    if (!id) continue;
    for (const pair of elsByTag(el, "Pair")) {
      if (text(pair, "key") !== "normal") continue;
      const url = text(pair, "styleUrl");
      if (url) links["#" + id] = url.trim();
      /* <Pair> con <Style> incrustado en vez de <styleUrl> */
      const inline = childrenByTag(pair, "Style")[0];
      if (inline) own["#" + id] = parseStyleElement(inline);
    }
  }

  const cache = {};
  const resolve = url => {
    if (!url) return null;
    url = url.trim();
    if (url in cache) return cache[url];
    cache[url] = null; /* corta los ciclos: una referencia en curso no resuelve */
    if (!url.startsWith("#")) { external++; return (cache[url] = null); }
    let cur = url, out = null;
    for (let hop = 0; hop < STYLE_HOPS; hop++) {
      if (own[cur]) { out = own[cur]; break; }
      if (!links[cur]) break;
      const next = links[cur].startsWith("#") ? links[cur] : null;
      if (!next) { external++; break; }
      if (next === cur) break;
      cur = next;
    }
    return (cache[url] = out);
  };
  return { resolve, get externalRefs() { return external; } };
}

/* Estilo efectivo de un placemark: styleUrl referenciado o <Style> inline */
function placemarkStyle(pm, styleIndex) {
  const defaults = { color: "#3388ff", weight: 2, fillOpacity: 0.35 };
  let style = styleIndex.resolve(text(pm, "styleUrl")) || {};
  for (const child of childrenByTag(pm, "Style")) {
    style = { ...style, ...parseStyleElement(child) };
  }
  return { ...defaults, ...style };
}

