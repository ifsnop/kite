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

/* ¿Puede existir un elemento que la consulta con comodín de namespace
   NO encuentre y el filtrado a mano sí? Solo si alguno no tiene un
   `localName` limpio (sin él, o con el prefijo dentro: un documento
   analizado sin namespaces). Si TODOS lo tienen, `bareName` es su
   `localName` y el filtrado a mano devuelve exactamente lo que la
   consulta ya dio: repetirlo es trabajo perdido. Se averigua de una vez
   por documento (un recorrido) y se recuerda; el documento no gana
   elementos después de analizarse.

   Medido (importar 10 000 marcadores): cada Placemark buscaba además
   `Polygon` y `LineString`, que no tiene, y cada búsqueda vacía caía al
   filtrado de TODOS sus descendientes con una llamada por elemento.   */
const prefixFallbackByDoc = new WeakMap();
function mayNeedPrefixFallback(root) {
  const doc = root.ownerDocument || root;
  let need = prefixFallbackByDoc.get(doc);
  if (need === undefined) {
    need = false;
    for (const el of doc.getElementsByTagName("*")) {
      const n = el.localName;
      if (typeof n !== "string" || !n || n.includes(":")) { need = true; break; }
    }
    prefixFallbackByDoc.set(doc, need);
  }
  return need;
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
    if (!mayNeedPrefixFallback(root)) return [];
  }
  return [...root.getElementsByTagName("*")].filter(el => bareName(el) === name);
}
/* El primero, sin copiar la colección entera a un array para quedarse
   con uno (la colección es «viva» y se detiene en el primer acierto).
   Mismo resultado que `elsByTag(root, name)[0] || null`.             */
function firstByTag(root, name) {
  if (!root || !root.getElementsByTagName) return null;
  if (root.getElementsByTagNameNS) {
    const first = root.getElementsByTagNameNS("*", name)[0];
    if (first) return first;
    if (!mayNeedPrefixFallback(root)) return null;
  }
  for (const el of root.getElementsByTagName("*")) {
    if (bareName(el) === name) return el;
  }
  return null;
}
function childrenByTag(parent, name) {
  const out = [];
  if (parent) for (const c of parent.children) if (bareName(c) === name) out.push(c);
  return out;
}

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


/* ================= Geometrías KML ================= */

/* ---------- Coordenadas: rango con tolerancia ----------
   Reproyectar acumula error de coma flotante, y es corriente encontrar
   longitudes como 180.00000044181039: se salen del rango por 4×10⁻⁷
   grados, unos 5 cm. Descartarlas por eso hacía perder la geometría
   entera por un redondeo. Se ajustan al límite las que se pasan por
   menos de `COORD_EPS`, y se siguen rechazando las que se salen de
   verdad —como las latitudes de 32400 que produce escribir las
   coordenadas con coma decimal—.                                     */
const COORD_EPS = 1e-5; /* grados: ~1,1 m, muy por encima del redondeo */
let coordClamped = 0;   /* cuántas se han ajustado en la importación   */

function clampDeg(v, limit) {
  if (!isFinite(v)) return NaN;
  if (v > limit) { if (v - limit > COORD_EPS) return NaN; coordClamped++; return limit; }
  if (v < -limit) { if (-limit - v > COORD_EPS) return NaN; coordClamped++; return -limit; }
  return v;
}

/* Devuelve el par ajustado, o null si alguna se sale de verdad. La
   altitud es opcional y viaja tal cual (no tiene rango que ajustar): se
   añade SOLO si es un número finito, para que una geometría sin altitud
   siga produciendo posiciones de dos elementos exactamente como antes,
   en vez de inventarse un 0 que nadie escribió. Leaflet se encarga del
   resto: `toLatLng` lee el tercer elemento y `latLngToCoords` lo vuelve
   a emitir en `toGeoJSON`.                                             */
function clampLatLng(lat, lon, alt) {
  const la = clampDeg(lat, 90), lo = clampDeg(lon, 180);
  if (!isFinite(la) || !isFinite(lo)) return null;
  return isFinite(alt) ? [la, lo, alt] : [la, lo];
}

/* Opciones del globo compacto, compartidas por marcadores y polígonos */
const COMPACT_POPUP = { className: "compacto", autoClose: false, closeOnClick: false };

/* "lon,lat[,alt] lon,lat…" → [[lat,lon(,alt)], …], descartando lo
   inválido. La altitud del KML se conserva cuando viene: antes se
   partía del texto y no se leía nunca, así que se perdía en la
   importación mientras que la del GeoJSON sí sobrevivía.              */
/* `\s` de JavaScript, a mano: aquí se llama por cada carácter de hasta
   300 MB de coordenadas y la expresión regular + `split` por tupla
   eran 2,9 s de un solo archivo (medido). Debe ser EXACTAMENTE `\s`.   */
function isSpaceCode(c) {
  if (c <= 32) return c === 32 || (c >= 9 && c <= 13);
  if (c < 160) return false;
  return c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8232 || c === 8233
    || c === 8239 || c === 8287 || c === 12288 || c === 65279;
}

/* Una sola pasada, sin `split`: cada tupla se corta por sus comas sin
   mirar más allá de su propio final (buscar la coma con `indexOf` sobre
   todo el texto sería cuadrático con una tupla sin comas en un texto
   hostil de cientos de MB).                                            */
function parseCoords(str) {
  const s = String(str), n = s.length, out = [];
  let skipped = 0, i = 0;
  while (i < n) {
    while (i < n && isSpaceCode(s.charCodeAt(i))) i++;
    if (i >= n) break;
    let end = i, c1 = -1, c2 = -1, c3 = -1;
    while (end < n) {
      const c = s.charCodeAt(end);
      if (isSpaceCode(c)) break;
      if (c === 44) { if (c1 < 0) c1 = end; else if (c2 < 0) c2 = end; else if (c3 < 0) c3 = end; }
      end++;
    }
    if (c1 < 0) { skipped++; i = end; continue; } /* sin coma: menos de dos campos */
    const lon = Number(s.slice(i, c1));
    const lat = Number(s.slice(c1 + 1, c2 < 0 ? end : c2));
    const alt = c2 < 0 ? undefined : Number(s.slice(c2 + 1, c3 < 0 ? end : c3));
    const pair = clampLatLng(lat, lon, alt);
    if (!pair) skipped++; else out.push(pair);
    i = end;
  }
  out.skipped = skipped;
  return out;
}

/* ---------- Modo de altitud de un polígono ----------
   La Z de un vértice KML no significa nada sin su <altitudeMode>:
   `absolute` es altitud sobre el nivel del mar (AMSL), `relativeToGround`
   altura sobre el terreno (AGL), `clampToGround` lo pega al suelo (la Z
   no cuenta) y los dos del fondo marino no sirven para un perfil de
   terreno. Se guarda en el Feature de cada polígono como miembro propio
   `kiteAlt` (no en `properties`: no es un atributo del usuario), con
   estos valores internos. Un polígono SIN modo (un GeoJSON, o un KML sin
   la etiqueta) tiene la Z como AMSL, decisión del usuario: `altMode()` es
   el único sitio que lo traduce.                                         */
const ALT_MODES = ["abs", "agl", "ground", "sea"];
const KML_ALT_MODE = new Map([
  ["absolute", "abs"], ["relativeToGround", "agl"], ["clampToGround", "ground"],
  ["relativeToSeaFloor", "sea"], ["clampToSeaFloor", "sea"]
]);

/* Solo los hijos DIRECTOS del <Polygon> (con o sin prefijo gx:, que manda
   si están los dos): un <LookAt> del mismo placemark trae su propio
   altitudeMode y no es de la geometría. null = sin modo.               */
function kmlAltitudeMode(geomEl) {
  const els = childrenByTag(geomEl, "altitudeMode");
  const last = els[els.length - 1];
  return last ? KML_ALT_MODE.get(last.textContent.trim()) || null : null;
}

/* El modo efectivo de un Feature (o de lo que cuelgue de él): uno de
   ALT_MODES, o null si no trae ninguno válido. Lo guardado y lo importado
   son entrada ajena, así que lo que no sea uno de los cuatro es «sin
   modo» y no se propaga.                                                */
const featureAltMode = f => (f && ALT_MODES.includes(f.kiteAlt) ? f.kiteAlt : null);

/* Un <Polygon> KML → anillos Leaflet [exterior, agujero1, …] */
function parsePolygon(polyEl) {
  const outerEl = firstByTag(childrenByTag(polyEl, "outerBoundaryIs")[0], "coordinates");
  if (!outerEl) return null;
  const outer = parseCoords(outerEl.textContent);
  if (outer.length < 3) return null; /* un anillo necesita tres vértices */
  const rings = [outer];
  for (const holeEl of childrenByTag(polyEl, "innerBoundaryIs")) {
    const coordsEl = firstByTag(holeEl, "coordinates");
    if (!coordsEl) continue;
    const ring = parseCoords(coordsEl.textContent);
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/* Los datos propios de un Placemark: <ExtendedData> con <Data name><value>
   y <SchemaData><SimpleData name>. Salen como `properties` (siempre
   texto: KML no tiene tipos aquí), y así una capa de KML tiene la misma
   tabla de atributos que una de GeoJSON. Entrada AJENA: tope de campos,
   primer valor de un nombre repetido y nombres que no pueden ser
   propiedades (`__proto__`) fuera. null si no hay ninguno.            */
function parseExtendedData(pm) {
  const ext = childrenByTag(pm, "ExtendedData")[0];
  if (!ext) return null;
  const props = {};
  let n = 0;
  const put = (key, value) => {
    if (!key || key === "__proto__" || n >= CFG.EXT_MAX_FIELDS) return;
    if (Object.prototype.hasOwnProperty.call(props, key)) return;
    props[key] = value;
    n++;
  };
  for (const d of childrenByTag(ext, "Data")) put(d.getAttribute("name"), directChildText(d, "value") || "");
  for (const sd of childrenByTag(ext, "SchemaData")) {
    for (const s of childrenByTag(sd, "SimpleData")) put(s.getAttribute("name"), s.textContent.trim());
  }
  return n ? props : null;
}

/* Las geometrías de un Placemark, buscadas UNA vez: quien decide si
   construye la capa Leaflet o solo su GeoJSON (ver abajo) mira antes si
   hay algún <Point>, y la lectura no debe repetir la búsqueda (era de lo
   más caliente de la importación de un KML grande).                    */
function placemarkGeomEls(pm) {
  const geomRoot = childrenByTag(pm, "MultiGeometry")[0] || pm;
  return {
    polygonEls: elsByTag(geomRoot, "Polygon"),
    lineEls: elsByTag(geomRoot, "LineString"),
    pointEls: elsByTag(geomRoot, "Point")
  };
}

/* Lee las geometrías de un placemark y las convierte con `mk`
   ({ poly(rings), line(pts), point(pt) }): la capa Leaflet de cada una
   (buildPlacemarkLayer) o su Feature GeoJSON (buildPlacemarkGeo). Cada
   geometría se lee por separado: una mala no tumba al resto del
   placemark ni, por tanto, a la importación entera. Devuelve
   { parts, reported }: `reported` distingue, para el llamador, un
   placemark SIN geometría alguna (nunca se llamó a fail, el llamador
   debe avisar con su mensaje genérico) de uno cuya única geometría
   falló Y YA quedó contada aquí con una causa específica (avisar otra
   vez arriba duplicaba el elemento perdido en el resumen: un placemark
   con un único <Point> roto contaba como 2 omitidos, no 1).           */
function collectPlacemarkParts(els, style, report, mk) {
  const parts = [];
  /* `modes[i]` es el modo de altitud de `parts[i]` (null: línea, punto, o
     polígono sin modo); va aparte porque cada constructor (capa Leaflet,
     GeoJSON) guarda `kiteAlt` en su propio sitio.                      */
  const modes = [];
  /* Fold the polygon-only outline flag into the real `stroke` used to
     render, but only when this placemark actually has a Polygon —
     otherwise it's dropped instead of silently hiding a LineString.   */
  if (style.polyOutline === false) {
    if (els.polygonEls.length) style.stroke = false;
    delete style.polyOutline;
  }
  let reported = false;
  const fail = why => { reported = true; if (report) report.warn(why); };

  for (const polyEl of els.polygonEls) {
    try {
      const rings = parsePolygon(polyEl);
      if (rings) {
        parts.push(mk.poly(rings));
        const mode = kmlAltitudeMode(polyEl);
        modes.push(mode);
        /* Para el aviso único por archivo (ver addFileNode) */
        if (mode === "sea" && report) report.seaFloor = (report.seaFloor || 0) + 1;
      } else fail(tr("polígono sin anillo exterior válido"));
    } catch (err) { fail(tr("polígono ilegible ({message})", { message: err.message })); }
  }
  for (const lineEl of els.lineEls) {
    try {
      const el = firstByTag(lineEl, "coordinates");
      const pts = el ? parseCoords(el.textContent) : [];
      if (pts.length >= 2) { parts.push(mk.line(pts)); modes.push(null); }
      else fail(tr("línea con menos de dos puntos válidos"));
    } catch (err) { fail(tr("línea ilegible ({message})", { message: err.message })); }
  }
  for (const ptEl of els.pointEls) {
    try {
      const el = firstByTag(ptEl, "coordinates");
      const pts = el ? parseCoords(el.textContent) : [];
      if (pts.length) { parts.push(mk.point(pts[0])); modes.push(null); }
      else fail(tr("punto sin coordenadas válidas"));
    } catch (err) { fail(tr("punto ilegible ({message})", { message: err.message })); }
  }
  return { parts, modes, reported };
}

/* Crea las capas Leaflet de un placemark (polígonos, líneas y puntos).
   Devuelve { group, reported } (ver collectPlacemarkParts).           */
function buildPlacemarkLayer(pm, style, report, els = placemarkGeomEls(pm)) {
  const { parts: layers, modes, reported } = collectPlacemarkParts(els, style, report, {
    poly: rings => L.polygon(rings, style),
    line: pts => L.polyline(pts, style),
    point: pt => L.marker(pt)
  });
  if (!layers.length) return { group: null, reported };

  /* `feature.properties` en cada subcapa es lo que lee layerProperties y lo
     que `toGeoJSON` vuelca al guardar, así que sobrevive a recargar. Sin
     `geometry` a propósito: 43-points-editor.js la lee de `poly.feature`
     para los polígonos de GeoJSON, y un KML no tiene geometría en crudo. */
  const data = parseExtendedData(pm);
  layers.forEach((l, i) => {
    if (!data && !modes[i]) return;
    l.feature = { type: "Feature", properties: data || {} };
    if (modes[i]) l.feature.kiteAlt = modes[i];
  });

  const group = L.featureGroup(layers);
  const name = text(pm, "name");
  /* Mismo globo ajustado al texto que en los marcadores: el de Leaflet
     por defecto tapa media pantalla para escribir un nombre         */
  if (name) group.bindPopup(escapeHtml(name), COMPACT_POPUP);
  return { group, reported };
}

/* ---------- El GeoJSON de un placemark, sin pasar por Leaflet ----------
   Un placemark APAGADO de solo polígonos y líneas no necesita su capa
   Leaflet hasta que alguien la enciende, pero sí su GeoJSON, que es lo
   que se guarda. Construir la capa para sacar de ella `toGeoJSON()` eran
   9,66 M de LatLng (+1,1 GB) y 9,4 s en un KML real de 309 MB, y volver
   a leerlos otros 1,3 s al guardar. Esto da el MISMO resultado que
   `L.featureGroup(capas).toGeoJSON()` — probado contra Leaflet real en
   tests/browser/lazy-layers.mjs — copiando sus tres reglas:
   · redondeo a 6 decimales (`L.Util.formatNum`; 1e6 es `Math.pow(10, 6)`);
   · un polígono no repite su vértice de cierre al construirse (si el
     último coincide con el primero a 1e-9 se descarta) y `toGeoJSON` lo
     vuelve a añadir copiando el primero, así que sale cerrado siempre;
   · la altitud solo si el vértice la traía.                            */
const GEO_ROUND = 1e6;
const geoNum = n => Math.round(n * GEO_ROUND) / GEO_ROUND;
/* [lat, lon(, alt)] → posición GeoJSON [lon, lat(, alt)] */
const geoPos = p => p.length > 2 ? [geoNum(p[1]), geoNum(p[0]), geoNum(p[2])] : [geoNum(p[1]), geoNum(p[0])];
function geoRing(ring) {
  let n = ring.length;
  if (n >= 2 && Math.max(Math.abs(ring[0][0] - ring[n - 1][0]), Math.abs(ring[0][1] - ring[n - 1][1])) <= 1e-9) n--;
  const out = [];
  for (let i = 0; i < n; i++) out.push(geoPos(ring[i]));
  out.push(out[0].slice());
  return out;
}

/* Como buildPlacemarkLayer, pero devuelve { geo, reported }: `geo` es la
   FeatureCollection que daría `toGeoJSON()` de la capa, o null si no hay
   ninguna geometría utilizable. SOLO para placemarks sin <Point>
   (quien llama lo comprueba con `els.pointEls`): un marcador necesita
   su icono, que es de Leaflet.                                         */
function buildPlacemarkGeo(pm, style, report, els) {
  const { parts, modes, reported } = collectPlacemarkParts(els, style, report, {
    poly: rings => ({ type: "Polygon", coordinates: rings.map(geoRing) }),
    line: pts => ({ type: "LineString", coordinates: pts.map(geoPos) }),
    point: () => null
  });
  if (!parts.length) return { geo: null, reported };
  /* Las mismas properties (ExtendedData) en cada subcapa, y {} propio
     si no hay: es lo que deja `getFeature` de Leaflet.               */
  const data = parseExtendedData(pm);
  return {
    geo: { type: "FeatureCollection",
           /* Mismo orden de claves que `toGeoJSON()` de Leaflet con un `feature`
              propio: type, properties, kiteAlt, geometry */
           features: parts.map((geometry, i) => modes[i]
             ? { type: "Feature", properties: data || {}, kiteAlt: modes[i], geometry }
             : { type: "Feature", properties: data || {}, geometry }) },
    reported
  };
}

/* Maps a file extension to the MIME type L.imageOverlay needs for a data:
   URL. Anything not in this list is treated as unresolvable, same as a
   missing zip entry — an orthophoto in an unrecognised format is not
   worth guessing at.                                                   */
const KMZ_IMAGE_MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", bmp: "image/bmp", webp: "image/webp"
};

/* Reads a <LatLonBox> into plain bounds + rotation, with the same
   rounding tolerance as everything else that reads coordinates. Returns
   null when the box is missing or its limits are not usable — pure and
   DOM-only, no Leaflet involved, so it is testable on its own.        */
function parseLatLonBox(el) {
  const boxEl = firstByTag(el, "LatLonBox");
  if (!boxEl) return null;
  const north = clampDeg(Number(text(boxEl, "north")), 90);
  const south = clampDeg(Number(text(boxEl, "south")), 90);
  const east = clampDeg(Number(text(boxEl, "east")), 180);
  const west = clampDeg(Number(text(boxEl, "west")), 180);
  if (![north, south, east, west].every(isFinite)) return null;
  const rotationRaw = Number(text(boxEl, "rotation"));
  const rotation = isFinite(rotationRaw) ? rotationRaw : 0;
  return { north, south, east, west, rotation };
}

/* A GroundOverlay is a single georeferenced image: LatLonBox bounds plus
   an Icon/href pointing at an image inside the same KMZ. Only
   axis-aligned boxes are supported — `rotation` is reported but not
   applied, since Leaflet's imageOverlay does not rotate without an extra
   plugin. Returns null (after warning) for anything unusable, so one bad
   overlay never aborts the rest of the KML — same isolation as
   buildPlacemarkLayer.                                                 */
async function buildGroundOverlay(el, zip, report, name) {
  const fail = why => { if (report) report.warn(`«${name}»: ${why}`); return null; };

  const parsedBox = parseLatLonBox(el);
  if (!parsedBox) return fail(tr("sin <LatLonBox> o con límites no válidos"));
  const { north, south, east, west, rotation } = parsedBox;
  if (rotation !== 0 && report) {
    report.note(tr("«{name}» tiene rotación de {rotation}° en el KML; se muestra sin rotar", { name, rotation }));
  }

  const iconEl = firstByTag(el, "Icon");
  const href = iconEl && text(iconEl, "href");
  if (!href) return fail(tr("sin <Icon><href>"));
  const entry = resolveKmzEntry(zip, href);
  if (!entry) return fail(tr("la imagen «{href}» no está disponible", { href }));
  const ext = (href.split(/[?#]/)[0].split(".").pop() || "").toLowerCase();
  const mime = KMZ_IMAGE_MIME[ext];
  if (!mime) return fail(tr("formato de imagen no reconocido ({ext})", { ext: ext || tr("sin extensión") }));

  let dataUrl;
  try {
    dataUrl = `data:${mime};base64,${await entry.async("base64")}`;
  } catch (err) {
    return fail(tr("no se pudo leer la imagen del KMZ ({message})", { message: err.message }));
  }

  const box = { north, south, east, west };
  const layer = L.imageOverlay(dataUrl, L.latLngBounds([south, west], [north, east]), { opacity: 1 });
  return { layer, box, dataUrl };
}

