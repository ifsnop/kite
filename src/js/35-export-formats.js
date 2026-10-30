/* ================= Exportar a KML y GeoJSON =================
   Trabaja sobre los REGISTROS serializados (serializeNode), no sobre las
   filas: una carpeta nunca desplegada se exporta sin construir ni una
   fila, igual que se guarda. Todo lo de abajo hasta exportNodeAs es PURO
   (se prueba en Node, tests/exportformats.js); el minimenú de 💾 y la
   descarga van al final.

   Lo que no se puede representar en estos formatos (cuadrículas de
   elevación, ortofotos de GroundOverlay y COG) se deja fuera y se
   NOMBRA en `skipped`: nunca se pierde en silencio.                    */

const EXPORT_CIRCLE_SEGMENTS = 120; /* un vértice cada 3°: a escala de mapa es un círculo */
const EXPORT_PATH_SEP = " / ";

/* ---------- Registros → entidades GeoJSON ---------- */

/* Distancia sobre la misma esfera que el resto de la geodesia (EARTH_R) */
function haversineM(a, b) {
  const dp = toRad(b.lat - a.lat), dl = toRad(b.lng - a.lng);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* Una posición con NaN saldría como `null` en JSON y sería ilegible en
   KML: la entidad entera se deja fuera en vez de exportar una rota.    */
const finiteCoords = c => Array.isArray(c) ? c.length > 0 && c.every(finiteCoords) : Number.isFinite(c);
const finiteGeometry = g => g.type === "GeometryCollection"
  ? Array.isArray(g.geometries) && g.geometries.length > 0 && g.geometries.every(finiteGeometry)
  : finiteCoords(g.coordinates);

/* `geo` de una capa guardada (toGeoJSON de Leaflet: FeatureCollection, y
   Feature o geometría sueltas por si alguien lo trae de fuera) → lista de
   Feature con geometría.                                               */
function geoToFeatures(geo) {
  if (!geo || typeof geo !== "object") return [];
  const list = geo.type === "FeatureCollection" ? geo.features
    : geo.type === "Feature" ? [geo] : [{ type: "Feature", properties: {}, geometry: geo }];
  return (Array.isArray(list) ? list : [])
    .filter(f => f && f.geometry && typeof f.geometry === "object" && finiteGeometry(f.geometry))
    .map(f => ({ type: "Feature", properties: f.properties || {}, geometry: f.geometry }));
}

/* Una medición como geometría. La ruta es una LineString; el círculo, un
   polígono geodésico (cada vértice a `r` metros del centro: arcPoints) y
   no el L.circle de Leaflet, que es una aproximación de pantalla. Cruzar
   ±180° deja longitudes continuas (>180) en vez de partir el anillo.    */
function measureFeatures(rec) {
  const w = Array.isArray(rec.waypoints) ? rec.waypoints : [];
  if (w.length < 2 || !w.every(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))) return [];
  if (rec.mtype === "circle") {
    const r = haversineM(w[0], w[1]);
    const ring = arcPoints(w[0], r, 0, 360, EXPORT_CIRCLE_SEGMENTS).map(p => [p.lng, p.lat]);
    ring[ring.length - 1] = ring[0].slice(); /* cierre exacto, sin ruido de coma flotante */
    return [{ type: "Feature", properties: { measure: "circle", radius_m: Math.round(r * 100) / 100 },
              geometry: { type: "Polygon", coordinates: [ring] } }];
  }
  let len = 0;
  for (let i = 1; i < w.length; i++) len += haversineM(w[i - 1], w[i]);
  return [{ type: "Feature", properties: { measure: "route", length_m: Math.round(len * 100) / 100 },
            geometry: { type: "LineString", coordinates: w.map(p => [p.lng, p.lat]) } }];
}

/* Las geometrías de un registro hoja, o null si este tipo de nodo no cabe
   en KML/GeoJSON.                                                      */
function recordFeatures(rec) {
  if (rec.t === "layer") return geoToFeatures(rec.geo);
  if (rec.t === "measure") return measureFeatures(rec);
  return null;
}

/* Lo que se exporta es el subárbol del nodo: si es un contenedor, sus
   hijos (el nodo mismo da el nombre del documento); si es una hoja, ella. */
function exportRoot(records) {
  if (records.length === 1 && Array.isArray(records[0].children)) {
    return { name: records[0].name, list: records[0].children };
  }
  return { name: records.length === 1 ? records[0].name : null, list: records };
}

/* Un nodo con su estilo → claves simplestyle (las mismas que lee
   geojsonStyle al importar, así que la ida y vuelta conserva el aspecto). */
const isPointGeometry = type => type === "Point" || type === "MultiPoint";
function simpleStyle(geomType, style, mstyle) {
  if (isPointGeometry(geomType)) return mstyle && mstyle.color ? { "marker-color": mstyle.color } : {};
  const s = normalizePathStyle(style);
  const out = { stroke: s.color, "stroke-width": s.stroke ? s.weight : 0, "stroke-opacity": s.stroke ? s.opacity : 0 };
  if (geomType !== "LineString" && geomType !== "MultiLineString") {
    out.fill = s.fillColor;
    out["fill-opacity"] = s.fill ? s.fillOpacity : 0;
  }
  return out;
}

/* Asigna una propiedad del nodo sin pisar un dato distinto que ya traía
   el archivo original: el desplazado pasa a `<clave>_orig`.            */
function putProp(props, key, value) {
  const old = props[key];
  if (old != null && old !== "" && old !== value) props[`${key}_orig`] = old;
  props[key] = value;
}

function featureProps(feat, rec, path) {
  const p = { ...feat.properties };
  putProp(p, "name", rec.name);
  if (rec.desc) putProp(p, "description", rec.desc);
  if (path.length) putProp(p, "folder", path.join(EXPORT_PATH_SEP));
  return Object.assign(p, simpleStyle(feat.geometry.type, rec.style, rec.mstyle));
}

/* Árbol de registros → FeatureCollection PLANA. La carpeta de cada
   entidad (relativa al nodo exportado) va en `properties.folder`.       */
function recordsToGeoJson(records) {
  const { name, list } = exportRoot(records);
  const features = [], skipped = [];
  const walk = (recs, path) => {
    for (const rec of recs) {
      if (Array.isArray(rec.children)) { walk(rec.children, [...path, rec.name]); continue; }
      const feats = recordFeatures(rec);
      if (!feats) { skipped.push({ name: rec.name, t: rec.t }); continue; }
      for (const f of feats) {
        features.push({ type: "Feature", properties: featureProps(f, rec, path), geometry: f.geometry });
      }
    }
  };
  walk(list, []);
  const fc = { type: "FeatureCollection", features };
  if (name != null) fc.name = name;
  return { text: JSON.stringify(fc), count: features.length, skipped };
}

/* ---------- KML ---------- */

/* Texto XML 1.0: escapa y quita los caracteres de control que el formato
   NO admite ni escapados (un solo \u0001 hace ilegible el documento).  */
const xmlEsc = s => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
  .replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);

/* "#rrggbb" (o "#rgb") + opacidad → aabbggrr, el orden de KML. Un color
   que no sea hexadecimal (un nombre CSS de un simplestyle ajeno) cae al
   azul por defecto: aquí no hay lienzo con el que resolverlo.          */
function cssToKmlColor(css, alpha = 1) {
  let h = String(css || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, c => c + c);
  if (!/^[0-9a-f]{6}$/i.test(h)) h = "3388ff";
  const a = Math.round(Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 1)) * 255);
  return (a.toString(16).padStart(2, "0") + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2)).toLowerCase();
}

/* lng,lat[,alt]; la altitud solo si es finita (no se inventa un 0) */
function kmlPos(pos) {
  if (!Array.isArray(pos) || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return null;
  return Number.isFinite(pos[2]) ? `${pos[0]},${pos[1]},${pos[2]}` : `${pos[0]},${pos[1]}`;
}
const kmlCoords = line => (Array.isArray(line) ? line : []).map(kmlPos).filter(Boolean).join(" ");

function kmlRing(ring, tag) {
  const c = kmlCoords(ring);
  return c ? `<${tag}><LinearRing><coordinates>${c}</coordinates></LinearRing></${tag}>` : "";
}
function kmlPolygon(rings) {
  if (!Array.isArray(rings) || !rings.length) return "";
  const outer = kmlRing(rings[0], "outerBoundaryIs");
  if (!outer) return "";
  return `<Polygon>${outer}${rings.slice(1).map(r => kmlRing(r, "innerBoundaryIs")).join("")}</Polygon>`;
}

function kmlGeometry(g) {
  if (!g || typeof g !== "object") return "";
  const many = parts => {
    const xs = parts.filter(Boolean);
    return xs.length ? `<MultiGeometry>${xs.join("")}</MultiGeometry>` : "";
  };
  const point = pos => { const c = kmlPos(pos); return c ? `<Point><coordinates>${c}</coordinates></Point>` : ""; };
  const line = pts => { const c = kmlCoords(pts); return c ? `<LineString><coordinates>${c}</coordinates></LineString>` : ""; };
  const list = x => (Array.isArray(x) ? x : []);
  switch (g.type) {
    case "Point": return point(g.coordinates);
    case "LineString": return line(g.coordinates);
    case "Polygon": return kmlPolygon(g.coordinates);
    case "MultiPoint": return many(list(g.coordinates).map(point));
    case "MultiLineString": return many(list(g.coordinates).map(line));
    case "MultiPolygon": return many(list(g.coordinates).map(kmlPolygon));
    case "GeometryCollection": return many(list(g.geometries).map(kmlGeometry));
  }
  return "";
}

/* Los tipos de geometría de un nodo deciden qué sub-estilos lleva */
function geometryKinds(geoms) {
  const kinds = { point: false, line: false, poly: false };
  const visit = g => {
    if (!g) return;
    if (g.type === "GeometryCollection") { (g.geometries || []).forEach(visit); return; }
    if (isPointGeometry(g.type)) kinds.point = true;
    else if (g.type === "LineString" || g.type === "MultiLineString") kinds.line = true;
    else kinds.poly = true;
  };
  geoms.forEach(visit);
  return kinds;
}

function kmlStyleXml(kinds, style, mstyle) {
  let x = "";
  if (kinds.point && mstyle && mstyle.color) {
    const scale = Number.isFinite(mstyle.size) ? `<scale>${+(mstyle.size / 41).toFixed(2)}</scale>` : "";
    x += `<IconStyle><color>${cssToKmlColor(mstyle.color)}</color>${scale}</IconStyle>`;
  }
  if (kinds.line || kinds.poly) {
    const s = normalizePathStyle(style);
    x += `<LineStyle><color>${cssToKmlColor(s.color, s.opacity)}</color><width>${s.stroke ? s.weight : 0}</width></LineStyle>`;
    if (kinds.poly) {
      x += `<PolyStyle><color>${cssToKmlColor(s.fillColor, s.fillOpacity)}</color>`
        + `<fill>${s.fill ? 1 : 0}</fill><outline>${s.stroke ? 1 : 0}</outline></PolyStyle>`;
    }
  }
  return x;
}

function kmlExtendedData(props) {
  const keys = Object.keys(props || {});
  if (!keys.length) return "";
  return "<ExtendedData>" + keys.map(k =>
    `<Data name="${xmlEsc(k)}"><value>${xmlEsc(stringifyPropValue(props[k]))}</value></Data>`).join("") + "</ExtendedData>";
}

/* El nodo exportado es UN Placemark aunque tenga varias geometrías
   (MultiGeometry), como llegó de un KML; las properties son las de la
   primera entidad (un nodo de GeoJSON es siempre una).                  */
function kmlPlacemark(rec, feats, ctx) {
  const geoms = feats.map(f => f.geometry);
  const parts = geoms.map(kmlGeometry).filter(Boolean);
  if (!parts.length) return "";
  const styleXml = kmlStyleXml(geometryKinds(geoms), rec.style, rec.mstyle);
  let styleRef = "";
  if (styleXml) {
    if (!ctx.styles.has(styleXml)) ctx.styles.set(styleXml, `s${ctx.styles.size + 1}`);
    styleRef = `<styleUrl>#${ctx.styles.get(styleXml)}</styleUrl>`;
  }
  ctx.count++;
  return `<Placemark><name>${xmlEsc(rec.name)}</name>${rec.checked ? "" : "<visibility>0</visibility>"}`
    + (rec.desc ? `<description>${xmlEsc(rec.desc)}</description>` : "")
    + styleRef + kmlExtendedData(feats[0].properties)
    + (parts.length === 1 ? parts[0] : `<MultiGeometry>${parts.join("")}</MultiGeometry>`)
    + "</Placemark>";
}

function kmlNodes(recs, ctx) {
  const out = [];
  for (const rec of recs) {
    if (Array.isArray(rec.children)) {
      out.push(`<Folder><name>${xmlEsc(rec.name)}</name>${rec.checked ? "" : "<visibility>0</visibility>"}`
        + `${rec.collapsed ? "" : "<open>1</open>"}\n${kmlNodes(rec.children, ctx)}\n</Folder>`);
      continue;
    }
    const feats = recordFeatures(rec);
    if (!feats) { ctx.skipped.push({ name: rec.name, t: rec.t }); continue; }
    const pm = kmlPlacemark(rec, feats, ctx);
    if (pm) out.push(pm);
  }
  return out.join("\n");
}

function recordsToKml(records) {
  const { name, list } = exportRoot(records);
  const ctx = { styles: new Map(), skipped: [], count: 0 };
  const body = kmlNodes(list, ctx);
  const defs = [...ctx.styles].map(([xml, id]) => `<Style id="${id}">${xml}</Style>`).join("\n");
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n`
    + `<name>${xmlEsc(name == null ? "KITE Local" : name)}</name>\n${defs}${defs ? "\n" : ""}${body}\n</Document>\n</kml>\n`;
  return { text, count: ctx.count, skipped: ctx.skipped };
}

/* ---------- Descarga ---------- */

const EXPORT_FORMATS = {
  kml: { ext: ".kml", mime: "application/vnd.google-earth.kml+xml", label: "KML", build: recordsToKml },
  geojson: { ext: ".geojson", mime: "application/geo+json", label: "GeoJSON", build: recordsToGeoJson }
};

/* Lo dejado fuera, dicho una vez y con nombres (hasta cinco) */
function skippedMessage(skipped, label) {
  const names = skipped.slice(0, 5).map(s => `«${s.name}»`).join(", ")
    + (skipped.length > 5 ? ` +${skipped.length - 5}` : "");
  return trn(skipped.length,
    "{names} se queda fuera de {format}: solo se exportan capas y mediciones.",
    "{names} se quedan fuera de {format}: solo se exportan capas y mediciones.",
    { names, format: label });
}

function exportNodeAs(li, format) {
  if (format === "kite") { exportNode(li); return; }
  const f = EXPORT_FORMATS[format];
  const out = f.build(serializeNode(li));
  if (out.skipped.length) navMessage(skippedMessage(out.skipped, f.label), { sticky: true, tone: "info" });
  if (!out.count) { navMessage(tr("No hay nada que exportar a {format} en este nodo.", { format: f.label })); return; }
  downloadBlob(new Blob([out.text], { type: `${f.mime};charset=utf-8` }), safeFileName(li._name) + f.ext);
}

/* ---------- Minimenú de 💾 ----------
   Con el aspecto del menú contextual del visor (.ctx-menu), pero
   independiente de él: aquel devuelve el foco al mapa y este se abre
   desde el panel. Se cierra con un clic fuera, Escape, el desplazamiento
   o al volver a pulsar 💾.                                              */
let exportMenuEl = null, exportMenuOwner = null, exportMenuOff = [];

function closeExportMenu() {
  exportMenuOff.forEach(off => off());
  exportMenuOff = [];
  if (exportMenuEl) exportMenuEl.remove();
  exportMenuEl = exportMenuOwner = null;
}

function openExportMenu(btn, li) {
  const toggleOff = exportMenuOwner === btn;
  closeExportMenu();
  if (toggleOff) return;
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", tr("Guardar o exportar"));
  const entries = [
    ["kite", tr("Archivo de KITE (.kite.json)")],
    ["kml", tr("KML (.kml)")],
    ["geojson", tr("GeoJSON (.geojson)")]
  ];
  for (const [format, label] of entries) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ctx-menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = label;
    item.addEventListener("click", () => { closeExportMenu(); exportNodeAs(li, format); });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect(), mr = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(r.left, window.innerWidth - mr.width - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(r.bottom + 2, window.innerHeight - mr.height - 4))}px`;
  exportMenuEl = menu;
  exportMenuOwner = btn;
  const listen = (target, type, fn, capture = true) => {
    target.addEventListener(type, fn, capture);
    exportMenuOff.push(() => target.removeEventListener(type, fn, capture));
  };
  /* El propio 💾 se queda fuera: su clic ya alterna (toggleOff) */
  listen(document, "mousedown", e => { if (!menu.contains(e.target) && !btn.contains(e.target)) closeExportMenu(); });
  listen(document, "keydown", e => {
    if (e.key !== "Escape") return;
    e.stopPropagation(); /* que el Escape del árbol no limpie además la selección */
    closeExportMenu();
  });
  listen(window, "scroll", closeExportMenu);
  listen(window, "blur", closeExportMenu);
}
