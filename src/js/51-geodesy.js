/* ================= Geodesia (sobre la esfera terrestre) ================= */
const EARTH_R = 6371000; /* mismo radio que usa L.CRS.Earth.distance */
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

/* Rumbo inicial de a → b: 0° = norte, en sentido horario */
function bearingDeg(a, b) {
  const p1 = toRad(a.lat), p2 = toRad(b.lat), dl = toRad(b.lng - a.lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/* Punto a `dist` metros de `origin` siguiendo el rumbo `brg` */
function destPoint(origin, brg, dist) {
  const d = dist / EARTH_R, t = toRad(brg);
  const p1 = toRad(origin.lat), l1 = toRad(origin.lng);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1),
                             Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return L.latLng(toDeg(p2), toDeg(l2));
}

/* ---------- Conversión a UTM ----------
   Aquí SÍ hace falta el elipsoide WGS84, no la esfera que usan las
   mediciones: UTM se define sobre el elipsoide y con la esfera el error
   llegaría a cientos de metros. Serie de Snyder, exacta al milímetro
   dentro del huso.                                                     */
const UTM_A = 6378137.0;              /* semieje mayor WGS84            */
const UTM_F = 1 / 298.257223563;      /* achatamiento                   */
const UTM_K0 = 0.9996;                /* factor de escala del meridiano */
const UTM_E2 = UTM_F * (2 - UTM_F);   /* primera excentricidad al cuadrado */
const UTM_BANDS = "CDEFGHJKLMNPQRSTUVWX";

/* Huso, con las excepciones reales de Noruega y Svalbard */
function utmZone(lat, lon) {
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32; /* sur de Noruega */
  if (lat >= 72 && lat < 84) {                                  /* Svalbard      */
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  return zone;
}

/* Banda de latitud (la letra que acompaña al huso). Todas miden 8°
   menos la última, X, que llega hasta los 84° y por eso se acota.     */
const utmBand = lat =>
  UTM_BANDS[Math.min(Math.floor((lat + 80) / 8), UTM_BANDS.length - 1)] || "";

/* {zone, band, easting, northing, north} o null fuera del ámbito de UTM */
/* `forceZone` sirve para coberturas publicadas en un solo huso, como el
   MDS del IGN: fuera de él las coordenadas siguen siendo válidas, solo
   que referidas a ese meridiano central.                             */
function latLngToUtm(lat, lon, forceZone = null) {
  if (!isFinite(lat) || !isFinite(lon) || lat < -80 || lat > 84) return null;
  const zone = forceZone || utmZone(lat, lon);
  const lon0 = toRad((zone - 1) * 6 - 180 + 3); /* meridiano central del huso */
  const p = toRad(lat), l = toRad(lon);
  const ep2 = UTM_E2 / (1 - UTM_E2);            /* segunda excentricidad     */
  const sinP = Math.sin(p), cosP = Math.cos(p), tanP = Math.tan(p);

  const N = UTM_A / Math.sqrt(1 - UTM_E2 * sinP * sinP);
  const T = tanP * tanP;
  const C = ep2 * cosP * cosP;
  /* Diferencia de longitud normalizada: evita el salto en el antimeridiano */
  const A = (((l - lon0) + Math.PI * 3) % (Math.PI * 2) - Math.PI) * cosP;

  const e2 = UTM_E2, e4 = e2 * e2, e6 = e4 * e2;
  const M = UTM_A * (
    (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * p
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * p)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * p)
    - (35 * e6 / 3072) * Math.sin(6 * p));

  const easting = UTM_K0 * N * (A + (1 - T + C) * A ** 3 / 6
      + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let northing = UTM_K0 * (M + N * tanP * (A * A / 2
      + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) northing += 10000000; /* falso norte en el hemisferio sur */

  return { zone, band: utmBand(lat), easting, northing, north: lat >= 0 };
}

function fmtUtm(lat, lon) {
  const u = latLngToUtm(lat, lon);
  /* Sobre 84°N y bajo 80°S UTM no está definido: allí se usa UPS */
  if (!u) return "UTM no definido en esta latitud (zona polar)";
  return `${u.zone}${u.band} ${Math.round(u.easting)} m E ${Math.round(u.northing)} m N`;
}

const METERS_PER_NM = 1852;   /* milla náutica internacional        */
const METERS_PER_FOOT = 0.3048; /* pie internacional, valor exacto    */

/* Altitud en metros y en pies: en aeronáutica la altitud se maneja en
   pies, igual que las distancias en millas náuticas.                  */
const fmtAltitude = m =>
  `${m.toFixed(1)} m / ${Math.round(m / METERS_PER_FOOT)} ft`;


/* Unidades de las distancias y las áreas medidas (metros por unidad).
   Las elige el usuario en el diálogo de propiedades (`measureUnit`) y
   mandan también sobre las etiquetas del visor.                      */
const POLY_UNIT_FACTOR = { m: 1, km: 1000, ft: METERS_PER_FOOT, nm: METERS_PER_NM };
const POLY_UNIT_LABEL = { m: "m", km: "km", ft: "ft", nm: "NM" };

/* Una medida en la unidad elegida. La MISMA función para el diálogo de
   propiedades y para las etiquetas del visor y del árbol: son la misma
   medida, y verla escrita de dos formas distintas solo hace dudar de si
   de verdad lo es. Sustituye a `fmtDist`, que daba siempre métrico Y
   náutico a la vez sin dejar elegir.                                  */
const fmtUnitDist = (m, unit) =>
  `${(m / POLY_UNIT_FACTOR[unit]).toFixed(2)} ${POLY_UNIT_LABEL[unit]}`;
/* El factor va AL CUADRADO: un área no se convierte con el mismo número
   que una distancia.                                                  */
const fmtUnitArea = (m2, unit) =>
  `${(m2 / POLY_UNIT_FACTOR[unit] ** 2).toFixed(2)} ${POLY_UNIT_LABEL[unit]}²`;

/* Punto medio GEODÉSICO del arco a→b. Promediar latitudes y longitudes
   coloca mal la etiqueta en líneas largas y directamente en el otro lado
   del mundo cuando el arco cruza ±180°: aquí se promedia en coordenadas
   cartesianas 3D, que no tiene ni costuras ni polos especiales.      */
function midPoint(a, b) {
  const p1 = toRad(a.lat), l1 = toRad(a.lng);
  const p2 = toRad(b.lat), dl = toRad(b.lng - a.lng);
  const bx = Math.cos(p2) * Math.cos(dl);
  const by = Math.cos(p2) * Math.sin(dl);
  const p3 = Math.atan2(Math.sin(p1) + Math.sin(p2),
                        Math.sqrt((Math.cos(p1) + bx) ** 2 + by ** 2));
  const l3 = l1 + Math.atan2(by, Math.cos(p1) + bx);
  /* Longitud normalizada a (−180, 180]: el arco puede cruzar ±180° */
  return L.latLng(toDeg(p3), ((toDeg(l3) + 540) % 360) - 180);
}

/* Un anillo se considera cerrado cuando su primer y último punto
   coinciden, con la misma tolerancia de redondeo que ya usa clampDeg
   (COORD_EPS, ~1,1 m): así se detectan los polígonos de algunos JSON
   que no repiten el punto de cierre, sin depender del tamaño del
   polígono.                                                            */
function ringClosed(ring) {
  if (ring.length < 3) return false;
  const a = ring[0], b = ring[ring.length - 1];
  return Math.abs(a.lat - b.lat) < COORD_EPS && Math.abs(a.lng - b.lng) < COORD_EPS;
}

/* Área geodésica de un anillo por la fórmula del exceso esférico (la
   misma que usan Leaflet.GeometryUtil y herramientas equivalentes), con
   el EARTH_R de este archivo para no introducir un segundo radio
   terrestre distinto del que ya usa map.distance. El signo depende del
   sentido de recorrido: aquí no importa, se toma en valor absoluto. Solo
   tiene sentido si el anillo está cerrado; esa decisión la toma quien
   llama (polygonMeasures), no esta función.                            */
function ringArea(ring) {
  if (ring.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i], p2 = ring[(i + 1) % ring.length];
    area += toRad(p2.lng - p1.lng) * (2 + Math.sin(toRad(p1.lat)) + Math.sin(toRad(p2.lat)));
  }
  return Math.abs(area * EARTH_R * EARTH_R / 2);
}

/* Área encerrada por un círculo de radio geodésico `r` (metros medidos
   SOBRE la superficie, que es lo que da map.distance): el casquete
   esférico 2πR²(1−cos(r/R)), no πr². Para un círculo de metros las dos
   coinciden, pero una medición de decenas de kilómetros ya se separa, y
   el resto del proyecto mide sobre la misma esfera (EARTH_R).         */
const capArea = r => 2 * Math.PI * EARTH_R * EARTH_R * (1 - Math.cos(r / EARTH_R));

/* getLatLngs() de un L.Polygon viene en dos profundidades posibles: los
   anillos de UN polígono ([exterior, agujero1, …], el caso normal de KML
   y de un GeoJSON Polygon) o una lista de polígonos cada uno con sus
   propios anillos (GeoJSON MultiPolygon, que Leaflet representa como
   L.Polygon con un nivel más de anidamiento). Se distingue mirando si el
   primer elemento es ya un anillo (sus puntos tienen .lat) o una lista
   de anillos.                                                          */
function polygonParts(latlngs) {
  if (!latlngs.length) return [];
  const first = latlngs[0];
  const isRing = Array.isArray(first) && first.length && typeof first[0].lat === "number";
  if (isRing) return [{ outer: latlngs[0], holes: latlngs.slice(1) }];
  return latlngs.flatMap(polygonParts);
}

