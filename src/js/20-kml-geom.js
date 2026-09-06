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
function parseCoords(str) {
  const out = [];
  let skipped = 0;
  for (const tuple of String(str).trim().split(/\s+/)) {
    if (!tuple) continue;
    const parts = tuple.split(",");
    if (parts.length < 2) { skipped++; continue; }
    const pair = clampLatLng(Number(parts[1]), Number(parts[0]),
      parts.length > 2 ? Number(parts[2]) : undefined);
    if (!pair) { skipped++; continue; }
    out.push(pair);
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

/* Crea las capas Leaflet de un placemark (polígonos, líneas y puntos).
   Cada geometría se construye por separado: una mala no tumba al resto
   del placemark ni, por tanto, a la importación entera.              */
/* Devuelve { group, reported }: `reported` distingue, para el llamador,
   un placemark SIN geometría alguna (nunca se llamó a fail, el llamador
   debe avisar con su mensaje genérico) de uno cuya única geometría
   falló Y YA quedó contada aquí con una causa específica (avisar otra
   vez arriba duplicaba el elemento perdido en el resumen: un placemark
   con un único <Point> roto contaba como 2 omitidos, no 1).           */
function buildPlacemarkLayer(pm, style, report) {
  const layers = [];
  const geomRoot = childrenByTag(pm, "MultiGeometry")[0] || pm;
  const polygonEls = elsByTag(geomRoot, "Polygon");
  /* Fold the polygon-only outline flag into the real `stroke` used to
     render, but only when this placemark actually has a Polygon —
     otherwise it's dropped instead of silently hiding a LineString.   */
  if (style.polyOutline === false) {
    if (polygonEls.length) style.stroke = false;
    delete style.polyOutline;
  }
  let reported = false;
  const fail = why => { reported = true; if (report) report.warn(why); };

  for (const polyEl of polygonEls) {
    try {
      const rings = parsePolygon(polyEl);
      if (rings) layers.push(L.polygon(rings, style));
      else fail("polígono sin anillo exterior válido");
    } catch (err) { fail(`polígono ilegible (${err.message})`); }
  }
  for (const lineEl of elsByTag(geomRoot, "LineString")) {
    try {
      const el = firstByTag(lineEl, "coordinates");
      const pts = el ? parseCoords(el.textContent) : [];
      if (pts.length >= 2) layers.push(L.polyline(pts, style));
      else fail("línea con menos de dos puntos válidos");
    } catch (err) { fail(`línea ilegible (${err.message})`); }
  }
  for (const ptEl of elsByTag(geomRoot, "Point")) {
    try {
      const el = firstByTag(ptEl, "coordinates");
      const pts = el ? parseCoords(el.textContent) : [];
      if (pts.length) layers.push(L.marker(pts[0]));
      else fail("punto sin coordenadas válidas");
    } catch (err) { fail(`punto ilegible (${err.message})`); }
  }
  if (!layers.length) return { group: null, reported };

  const group = L.featureGroup(layers);
  const name = text(pm, "name");
  /* Mismo globo ajustado al texto que en los marcadores: el de Leaflet
     por defecto tapa media pantalla para escribir un nombre         */
  if (name) group.bindPopup(escapeHtml(name), COMPACT_POPUP);
  return { group, reported };
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
  if (!parsedBox) return fail("sin <LatLonBox> o con límites no válidos");
  const { north, south, east, west, rotation } = parsedBox;
  if (rotation !== 0 && report) {
    report.note(`«${name}» tiene rotación de ${rotation}° en el KML; se muestra sin rotar`);
  }

  const iconEl = firstByTag(el, "Icon");
  const href = iconEl && text(iconEl, "href");
  if (!href) return fail("sin <Icon><href>");
  const entry = resolveKmzEntry(zip, href);
  if (!entry) return fail(`la imagen «${href}» no está disponible`);
  const ext = (href.split(/[?#]/)[0].split(".").pop() || "").toLowerCase();
  const mime = KMZ_IMAGE_MIME[ext];
  if (!mime) return fail(`formato de imagen no reconocido (${ext || "sin extensión"})`);

  let dataUrl;
  try {
    dataUrl = `data:${mime};base64,${await entry.async("base64")}`;
  } catch (err) {
    return fail(`no se pudo leer la imagen del KMZ (${err.message})`);
  }

  const box = { north, south, east, west };
  const layer = L.imageOverlay(dataUrl, L.latLngBounds([south, west], [north, east]), { opacity: 1 });
  return { layer, box, dataUrl };
}

