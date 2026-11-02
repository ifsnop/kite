/* ================= Importar GPX =================
   GPX 1.0 y 1.1 (waypoints, rutas y tracks). Se convierte a un
   FeatureCollection y entra por addFileNode como un shapefile (ver
   34-shp-import.js): hereda la pregunta de etiquetas HTML, los
   duplicados, el envoltorio, el resumen, deshacer y la retirada a medias.
   La conversión es PURA (se prueba en Node, tests/gpxtest.js) y
   namespace-agnóstica como el resto del XML de la aplicación.

   El nombre de cada elemento sale de su <name> (`GPX_NAME_KEYS`): en un
   GeoJSON cualquiera nunca se asume qué propiedad es el nombre, pero un
   GPX lo define el propio formato y preguntarlo en cada archivo no
   aportaría nada.                                                      */

const GPX_NAME_KEYS = ["name"];
/* Cota de una entrada hostil: un track real de varios días ronda los 10⁵
   puntos; con diez veces más se avisa y se corta, en vez de colgar el
   navegador construyendo arrays.                                       */
const GPX_MAX_POINTS = 2000000;
const GPX_TEXT_FIELDS = ["name", "desc", "cmt", "src", "sym", "type"];

/* Una posición <wpt>/<rtept>/<trkpt> → [lng, lat(, alt)], o null si le
   falta o se sale de rango algo que no es redondeo. La altitud (<ele>) va
   como tercer elemento solo si es un número finito; nunca se inventa 0. */
function gpxPosition(el) {
  const lat = el.getAttribute("lat"), lon = el.getAttribute("lon");
  if (lat == null || lon == null || String(lat).trim() === "" || String(lon).trim() === "") return null;
  const eleText = directChildText(el, "ele");
  const ele = eleText == null || eleText === "" ? undefined : Number(eleText);
  const pair = clampLatLng(Number(lat), Number(lon), ele);
  if (!pair) return null;
  return pair.length > 2 ? [pair[1], pair[0], pair[2]] : [pair[1], pair[0]];
}

/* <time> de un punto: ISO 8601 tal cual lo escribió el archivo, siempre
   que sea una fecha que el navegador entienda; si no, null.            */
function gpxTime(el) {
  const t = directChildText(el, "time");
  return t && Number.isFinite(Date.parse(t)) ? t : null;
}

/* Propiedades de un elemento: solo lo que el archivo trae, con `gpx`
   diciendo qué era (waypoint, route o track).                          */
function gpxProps(el, kind) {
  const p = {};
  for (const f of GPX_TEXT_FIELDS) {
    const v = directChildText(el, f);
    if (v) p[f] = v;
  }
  const link = childrenByTag(el, "link")[0];
  const href = link && link.getAttribute("href");
  if (href) p.link = href; /* texto, nunca un enlace vivo: se muestra escapado */
  if (kind === "waypoint") {
    const time = gpxTime(el);
    if (time) p.time = time;
  }
  p.gpx = kind;
  return p;
}

/* Los puntos válidos de una lista de <rtept>/<trkpt>, con sus tiempos
   alineados. Lleva la cuenta global para la cota y devuelve cuántos
   puntos se descartaron por inválidos.                                 */
function gpxLine(pointEls, ctx) {
  const coords = [], times = [];
  for (const el of pointEls) {
    if (ctx.points >= GPX_MAX_POINTS) { ctx.capped = true; break; }
    ctx.points++;
    const pos = gpxPosition(el);
    if (!pos) { ctx.badPoints++; continue; }
    coords.push(pos);
    times.push(gpxTime(el));
  }
  return { coords, times };
}

/* GPX → FeatureCollection. `report` es el de la importación: un elemento
   perdido es un `warn`, y lo que solo se ajusta o se descarta de dentro
   de un elemento, una `note`.                                          */
function gpxToGeoJson(text, report) {
  const { xml, repaired } = parseKmlDocument(text); /* mismo XML tolerante que el KML */
  if (repaired.length) {
    report.note(tr("prefijos XML sin declarar, corregidos al vuelo: {prefixes}", { prefixes: repaired.join(", ") }));
  }
  const root = xml.documentElement;
  if (!root || bareName(root) !== "gpx") throw new Error(tr("no es un archivo GPX (falta el elemento <gpx>)"));

  const clamped0 = coordClamped;
  const ctx = { points: 0, badPoints: 0, capped: false, shortSegments: 0 };
  const features = [];
  const add = (properties, geometry) => features.push({ type: "Feature", properties, geometry });

  for (const el of childrenByTag(root, "wpt")) {
    if (ctx.points >= GPX_MAX_POINTS) { ctx.capped = true; break; }
    ctx.points++;
    const pos = gpxPosition(el);
    if (!pos) { report.warn(tr("waypoint sin coordenadas válidas")); continue; }
    add(gpxProps(el, "waypoint"), { type: "Point", coordinates: pos });
  }

  for (const rte of childrenByTag(root, "rte")) {
    const { coords } = gpxLine(childrenByTag(rte, "rtept"), ctx);
    if (coords.length < 2) { report.warn(tr("ruta con menos de dos puntos válidos")); continue; }
    add(gpxProps(rte, "route"), { type: "LineString", coordinates: coords });
  }

  for (const trk of childrenByTag(root, "trk")) {
    const segs = childrenByTag(trk, "trkseg").map(s => gpxLine(childrenByTag(s, "trkpt"), ctx));
    const good = segs.filter(s => s.coords.length >= 2);
    ctx.shortSegments += segs.length - good.length;
    if (!good.length) { report.warn(tr("track sin ningún segmento con dos puntos válidos")); continue; }
    const props = gpxProps(trk, "track");
    /* Los tiempos de los puntos, alineados con las coordenadas (la misma
       convención que usan las herramientas de GPX → GeoJSON): una lista
       por segmento, o una sola si el track tiene un segmento.           */
    if (good.some(s => s.times.some(Boolean))) props.coordTimes = good.length === 1 ? good[0].times : good.map(s => s.times);
    add(props, good.length === 1
      ? { type: "LineString", coordinates: good[0].coords }
      : { type: "MultiLineString", coordinates: good.map(s => s.coords) });
  }

  if (ctx.badPoints) report.note(tr("{n} punto(s) sin coordenadas válidas omitidos", { n: ctx.badPoints }));
  if (ctx.shortSegments) report.note(tr("{n} segmento(s) de menos de dos puntos omitidos", { n: ctx.shortSegments }));
  if (coordClamped > clamped0) {
    report.note(tr("{n} coordenada(s) fuera de rango por redondeo, ajustadas al límite (menos de {eps}°)",
      { n: coordClamped - clamped0, eps: COORD_EPS }));
  }
  if (ctx.capped) report.warn(tr("se corta en {max} puntos: es el tope por archivo GPX", { max: GPX_MAX_POINTS }));
  if (!features.length) throw new Error(tr("el archivo GPX no contiene ningún waypoint, ruta ni track"));
  return { type: "FeatureCollection", features };
}

/* Un .gpx al árbol, con el contrato de cualquier archivo soltado: lo que
   falle lo avisa quien llama (handleDroppedFiles).                     */
async function importGpxFile(file, big, insertBefore, dropTargetUl) {
  const report = makeImportReport(file.name);
  const text = await file.text();
  if (big) {
    /* DOMParser es síncrono y monolítico: solo cabe decir la fase y ceder un frame */
    progress.indet(tr("Procesando XML de {name}…", { name: file.name }));
    await yieldFrame();
  }
  const gj = gpxToGeoJson(text, report);
  await addFileNode(file.name, "geojson", gj, insertBefore, dropTargetUl, null, report, GPX_NAME_KEYS);
}
