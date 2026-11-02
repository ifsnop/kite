/* ===== Parcela catastral (Dirección General del Catastro) =====
   «Parcela catastral» del menú contextual del visor: dos consultas al
   Catastro, ambas con CORS abierto (comprobado con curl, octubre de 2026):
     1. Consulta_RCCOOR: de unas coordenadas a la referencia catastral
        (y la dirección de la finca).
     2. WFS INSPIRE GetParcel: de la referencia al polígono, en GML 3.2.
   El resultado es una capa normal del árbol ("layer") con las
   propiedades en la ficha, así que guardado, deshacer, exportar y copiar
   la tratan como a cualquier GeoJSON importado. Ver cadastre.md.        */

const CADASTRE_RCCOOR = "https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR";
const CADASTRE_WFS = "https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx";
const CADASTRE_TIMEOUT = 15000;
const CADASTRE_RETRIES = 2;
const CADASTRE_RETRY_DELAYS = [1000, 2000];
/* Una parcela real pesa unos pocos KB; las rústicas enormes, decenas */
const CADASTRE_MAX_BYTES = 5 * 1024 * 1024;
const CADASTRE_MAX_VERTICES = 20000;
const CADASTRE_ATTRIB = "© Dirección General del Catastro";
const CADASTRE_SECTION = tr("Catastro");

/* ---------- Lo puro (se prueba en Node) ---------- */

/* La referencia catastral de una parcela son 14 caracteres. Es una
   entrada AJENA que acaba dentro de una dirección: se valida antes de
   usarla. Devuelve la referencia en mayúsculas, o null.               */
function validRefcat(rc) {
  if (typeof rc !== "string") return null;
  const up = rc.trim().toUpperCase();
  return /^[0-9A-Z]{14}$/.test(up) ? up : null;
}

/* X es la LONGITUD e Y la LATITUD (al revés de como se suele decir) */
function cadastreCoordUrl(latlng) {
  if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) {
    throw new Error(tr("coordenadas no válidas"));
  }
  return `${CADASTRE_RCCOOR}?SRS=EPSG:4326&Coordenada_X=${latlng.lng.toFixed(7)}&Coordenada_Y=${latlng.lat.toFixed(7)}`;
}

function cadastreParcelUrl(rc) {
  const ref = validRefcat(rc);
  if (!ref) throw new Error(tr("referencia catastral no válida"));
  return `${CADASTRE_WFS}?service=wfs&version=2.0.0&request=GetFeature&STOREDQUERIE_ID=GetParcel`
    + `&refcat=${ref}&srsname=EPSG::4326`;
}

/* El WFS contesta en ISO-8859-1 (lo declara en la cabecera XML), y
   `Response.text()` lo leería siempre como UTF-8 y rompería las tildes
   de la dirección. Se mira la declaración y se decodifica con ella.   */
function decodeXmlBytes(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const m = /<\?xml[^>]*encoding=["']([A-Za-z0-9._-]+)["']/.exec(head);
  let dec;
  try { dec = new TextDecoder(m ? m[1] : "utf-8"); } catch { dec = new TextDecoder("utf-8"); }
  return dec.decode(bytes);
}

function parseCadastreXml(text) {
  let doc = null;
  /* Algunos analizadores lanzan en vez de devolver un <parsererror> */
  try { doc = new DOMParser().parseFromString(text, "text/xml"); } catch { doc = null; }
  if (!doc || !doc.documentElement || doc.getElementsByTagName("parsererror")[0]) {
    throw new Error(tr("respuesta con un formato inesperado"));
  }
  return doc;
}

/* De la respuesta de Consulta_RCCOOR: `{ rc, address }`, o `{ none: true }`
   si el Catastro dice que ahí no hay parcela (vía pública, fuera de
   España, País Vasco y Navarra…). Cualquier otra forma es un error.     */
function parseRccoor(doc) {
  if (firstByTag(doc, "lerr")) return { none: true };
  const coord = firstByTag(doc, "coord");
  const rc = coord && validRefcat((text(coord, "pc1") || "") + (text(coord, "pc2") || ""));
  if (!rc) throw new Error(tr("respuesta con un formato inesperado"));
  return { rc, address: text(coord, "ldt") || null };
}

/* Los números de un `gml:posList` ya como [lon, lat]. El servicio da
   «lat lon» porque EPSG:4326 así lo ordena; el srsName se comprueba
   fuera, antes de llamar aquí. Nada de lo que no cuadre se dibuja.     */
function parsePosList(el, budget) {
  const dim = Number(el.getAttribute("srsDimension") || 2);
  if (dim !== 2 && dim !== 3) throw new Error(tr("geometría no válida"));
  const tokens = (el.textContent || "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length % dim !== 0) throw new Error(tr("geometría no válida"));
  const n = tokens.length / dim;
  const count = el.getAttribute("count");
  if (count != null && Number(count) !== n) throw new Error(tr("geometría no válida"));
  if (budget.left < n) throw new Error(tr("la parcela tiene demasiados vértices"));
  budget.left -= n;
  const ring = [];
  for (let i = 0; i < n; i++) {
    const lat = Number(tokens[i * dim]), lon = Number(tokens[i * dim + 1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new Error(tr("geometría no válida"));
    }
    ring.push([lon, lat]);
  }
  const a = ring[0], z = ring[ring.length - 1];
  if (a[0] !== z[0] || a[1] !== z[1]) ring.push([a[0], a[1]]);
  if (ring.length < 4) throw new Error(tr("geometría no válida"));
  return ring;
}

/* Del GML de GetParcel: `{ rc, area, label, since, geometry }` con
   `geometry` un Polygon o MultiPolygon de GeoJSON. Una excepción OGC
   (también llega con HTTP 200) se lanza con su texto y `owsCode`, para
   que no se reintente.                                               */
function parseCadastralParcel(doc) {
  const report = firstByTag(doc, "ExceptionReport");
  if (report) {
    const ex = firstByTag(report, "Exception");
    const err = new Error((text(report, "ExceptionText") || tr("el servicio ha rechazado la consulta")).trim());
    err.owsCode = (ex && ex.getAttribute("exceptionCode")) || "ows";
    throw err;
  }
  const parcel = firstByTag(doc, "CadastralParcel");
  const rc = parcel && validRefcat(text(parcel, "nationalCadastralReference") || "");
  if (!rc) throw new Error(tr("respuesta con un formato inesperado"));

  const surface = firstByTag(parcel, "MultiSurface");
  /* Sin saber el orden de los ejes no se coloca nada: mejor un error
     que una parcela en el mar frente a Somalia.                       */
  if (!surface || !/4326$/.test(surface.getAttribute("srsName") || "")) {
    throw new Error(tr("geometría no válida"));
  }
  const budget = { left: CADASTRE_MAX_VERTICES };
  const polygons = [];
  for (const patch of elsByTag(surface, "PolygonPatch")) {
    const outer = firstByTag(firstByTag(patch, "exterior"), "posList");
    if (!outer) throw new Error(tr("geometría no válida"));
    const rings = [parsePosList(outer, budget)];
    for (const hole of elsByTag(patch, "interior")) {
      const pl = firstByTag(hole, "posList");
      if (!pl) throw new Error(tr("geometría no válida"));
      rings.push(parsePosList(pl, budget));
    }
    polygons.push(rings);
  }
  if (!polygons.length) throw new Error(tr("geometría no válida"));
  const geometry = polygons.length === 1
    ? { type: "Polygon", coordinates: polygons[0] }
    : { type: "MultiPolygon", coordinates: polygons };

  const area = Number(text(parcel, "areaValue"));
  const since = (text(parcel, "beginLifespanVersion") || "").slice(0, 10);
  return {
    rc, geometry,
    area: Number.isFinite(area) && area >= 0 ? area : null,
    label: text(parcel, "label") || null,
    since: /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : null
  };
}

/* La ficha de la capa. Las claves salen en el idioma del momento y se
   guardan tal cual, como el nombre de cualquier capa creada (i18n.md).
   Lo que no hay no se escribe.                                        */
function cadastreProps(parcel, address) {
  const props = { [tr("Referencia catastral")]: parcel.rc };
  if (address) props[tr("Dirección")] = address;
  if (parcel.area != null) props[tr("Superficie catastral (m²)")] = parcel.area;
  if (parcel.label) props[tr("Etiqueta")] = parcel.label;
  if (parcel.since) props[tr("Fecha de alta")] = parcel.since;
  return props;
}

const cadastreFeature = (parcel, address) => ({
  type: "Feature", properties: cadastreProps(parcel, address), geometry: parcel.geometry
});

/* ---------- Red y árbol ---------- */

/* Los bytes de la respuesta, con tope: mirando el tamaño declarado y
   contando lo que llega (puede faltar o mentir).                      */
async function readCapped(resp, max) {
  const declared = Number(resp.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new Error(tr("respuesta demasiado grande"));
  if (!resp.body || !resp.body.getReader) {
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > max) throw new Error(tr("respuesta demasiado grande"));
    return new Uint8Array(buf);
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { reader.cancel(); throw new Error(tr("respuesta demasiado grande")); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

/* Una petición SIMPLE (sin cabeceras propias ni credenciales: sin
   preflight, ver url-import.md), con tiempo máximo POR INTENTO y
   reintentos solo de lo pasajero (`withElevRetries`).                 */
function cadastreGet(url) {
  return withElevRetries(async () => {
    const resp = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(CADASTRE_TIMEOUT) });
    if (!resp.ok) {
      const err = new Error(describeHttp(resp.status));
      err.status = resp.status;
      throw err;
    }
    return parseCadastreXml(decodeXmlBytes(await readCapped(resp, CADASTRE_MAX_BYTES)));
  }, { retries: CADASTRE_RETRIES, delays: CADASTRE_RETRY_DELAYS });
}

const cadastreInFlight = new Set();
/* Referencia → fila de ESTA sesión: repetir una parcela no la pide otra vez */
const cadastreKeys = new Map();
let cadastreAttribDone = false;

/* Como en elevación, sin aviso de «consultando»: la señal es el cursor
   de espera sobre el mapa, y el resultado es la capa nueva.            */
const syncCadastreBusy = () => map.getContainer().classList.toggle("cadastre-busy", cadastreInFlight.size > 0);

async function queryCadastralParcelAt(latlng) {
  const key = `${latlng.lat.toFixed(5)},${latlng.lng.toFixed(5)}`;
  if (cadastreInFlight.has(key)) return;
  cadastreInFlight.add(key);
  syncCadastreBusy();
  try {
    const found = parseRccoor(await cadastreGet(cadastreCoordUrl(latlng)));
    if (found.none) {
      navMessage(tr("El Catastro no tiene ninguna parcela en ese punto (vía pública, fuera de España, o País Vasco y Navarra, que tienen catastro propio)."),
        { tone: "info" });
      return;
    }
    const prev = cadastreKeys.get(found.rc);
    if (prev && prev.isConnected) {
      highlightNode(prev);
      blinkLayer(prev);
      navMessage(tr("Esa parcela ya está en el árbol: «{name}».", { name: prev._name }), { tone: "info" });
      return;
    }

    const parcel = parseCadastralParcel(await cadastreGet(cadastreParcelUrl(found.rc)));
    if (!cadastreAttribDone) {
      cadastreAttribDone = true;
      map.attributionControl.addAttribution(CADASTRE_ATTRIB);
    }

    pushUndo(tr("consultar parcela catastral"));
    const name = tr("Parcela {rc}", { rc: parcel.rc });
    const style = normalizePathStyle({ color: "#e65100", weight: 2, fillOpacity: 0.15 });
    const layer = L.geoJSON(cadastreFeature(parcel, found.address), { style });
    clearFillOnOpenPaths(layer);
    layer.bindPopup(escapeHtml(name), COMPACT_POPUP);
    layer.addTo(rootGroup);
    const li = makeNode({ name, layer, style });
    ensureNamedSection(CADASTRE_SECTION).appendChild(li);
    refreshAncestorChecks(li);
    scheduleSave();
    cadastreKeys.set(parcel.rc, li);
  } catch (err) {
    if (err.name === "AbortError") return;
    const why = err.name === "TimeoutError"
      ? tr("el servicio ha tardado m\u00E1s de {seconds} s en responder", { seconds: CADASTRE_TIMEOUT / 1000 })
      : err instanceof TypeError
        ? netFailText(tr("error de red, o el servicio no admite consultas desde el navegador (CORS)"))
        : err.message;
    navMessage(tr("Error al consultar el Catastro: {reason}.", { reason: why }));
  } finally {
    cadastreInFlight.delete(key);
    syncCadastreBusy();
  }
}
