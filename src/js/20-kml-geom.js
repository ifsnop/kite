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
const EXT_MAX_FIELDS = 200;
function parseExtendedData(pm) {
  const ext = childrenByTag(pm, "ExtendedData")[0];
  if (!ext) return null;
  const props = {};
  let n = 0;
  const put = (key, value) => {
    if (!key || key === "__proto__" || n >= EXT_MAX_FIELDS) return;
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
      if (rings) parts.push(mk.poly(rings));
      else fail(tr("polígono sin anillo exterior válido"));
    } catch (err) { fail(tr("polígono ilegible ({message})", { message: err.message })); }
  }
  for (const lineEl of els.lineEls) {
    try {
      const el = firstByTag(lineEl, "coordinates");
      const pts = el ? parseCoords(el.textContent) : [];
      if (pts.length >= 2) parts.push(mk.line(pts));
      else fail(tr("línea con menos de dos puntos válidos"));
    } catch (err) { fail(tr("línea ilegible ({message})", { message: err.message })); }
  }
  for (const ptEl of els.pointEls) {
    try {
      const el = firstByTag(ptEl, "coordinates");
      const pts = el ? parseCoords(el.textContent) : [];
      if (pts.length) parts.push(mk.point(pts[0]));
      else fail(tr("punto sin coordenadas válidas"));
    } catch (err) { fail(tr("punto ilegible ({message})", { message: err.message })); }
  }
  return { parts, reported };
}

/* Crea las capas Leaflet de un placemark (polígonos, líneas y puntos).
   Devuelve { group, reported } (ver collectPlacemarkParts).           */
function buildPlacemarkLayer(pm, style, report, els = placemarkGeomEls(pm)) {
  const { parts: layers, reported } = collectPlacemarkParts(els, style, report, {
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
  if (data) for (const l of layers) l.feature = { type: "Feature", properties: data };

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
  const { parts, reported } = collectPlacemarkParts(els, style, report, {
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
           features: parts.map(geometry => ({ type: "Feature", properties: data || {}, geometry })) },
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

