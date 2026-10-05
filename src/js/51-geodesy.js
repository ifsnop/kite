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
const METERS_PER_MILE = 1609.344; /* milla terrestre (statute mile), valor exacto */

/* Altitud en metros y en pies: en aeronáutica la altitud se maneja en
   pies, igual que las distancias en millas náuticas.                  */
const fmtAltitude = m =>
  `${m.toFixed(1)} m / ${Math.round(m / METERS_PER_FOOT)} ft`;


/* Unidades de las distancias y las áreas medidas (metros por unidad).
   Ya NO se eligen por elemento: es un ajuste global (`measureUnit`,
   panel de Propiedades, ver 43-points-editor.js) que manda a la vez
   sobre el perímetro/área de un polígono, las medidas de una medición
   y las etiquetas del visor y del árbol.                              */
const POLY_UNIT_FACTOR = { m: 1, km: 1000, ft: METERS_PER_FOOT, mi: METERS_PER_MILE, nm: METERS_PER_NM };
const POLY_UNIT_LABEL = { m: "m", km: "km", ft: "ft", mi: "mi", nm: "NM" };

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

/* ---------- Ángulo de elevación entre dos alturas ----------
   Refracción atmosférica estándar: la luz y las ondas de radio se curvan
   hacia abajo, lo que equivale a una Tierra de radio 4/3 el real. Es la
   convención de radar y radioenlaces, así que es el modelo por defecto
   de la calculadora geodésica.                                         */
const REFRACTION_K = 4 / 3;

/* Radio efectivo según el modelo; null para "flat" (sin curvatura). */
const elevationRadius = model =>
  model === "flat" ? null : model === "refr" ? EARTH_R * REFRACTION_K : EARTH_R;

/* Distancia sobre la superficie (arco a nivel del mar) equivalente a una
   distancia OBLICUA s: la recta entre el punto inicial a su altura h1 y
   el final a su altura h2. Devuelve { d } en metros o { error } si no
   existe esa geometría. En una esfera de radio R, con r1 = R + h1 y
   r2 = R + h2, la cuerda cumple s² = (r1−r2)² + 4·r1·r2·sin²(θ/2); de
   ahí θ = 2·asin(√q) con q = (s² − Δh²)/(4·r1·r2). Se escribe
   s² − Δh² como (s−Δh)(s+Δh) y se usa asin, no acos de la ley de los
   cosenos: con puntos cercanos esa resta pierde todas las cifras.
   En el modelo plano no hay curvatura: d = √(s² − Δh²).
   Una oblicua apenas menor que Δh (el redondeo de pasar de una unidad a
   otra) se toma como Δh, es decir, como los dos puntos en la misma
   vertical; más que eso es imposible: la recta no puede ser más corta
   que la diferencia de alturas.                                        */
function surfaceFromSlant(h1, h2, s, model) {
  const R = elevationRadius(model), dh = Math.abs(h2 - h1);
  let x = s - dh;
  if (x < 0) {
    if (-x > 1e-9 * Math.max(dh, 1)) return { error: "La distancia oblicua no puede ser menor que la diferencia de alturas." };
    x = 0;
  }
  if (R === null) return { d: Math.sqrt(x * (s + dh)) };
  const q = x * (s + dh) / (4 * (R + h1) * (R + h2));
  if (q > 1) return { error: "La distancia oblicua supera la máxima posible entre los dos puntos." };
  return { d: 2 * R * Math.asin(Math.sqrt(q)) };
}

/* Ángulo (grados, 0 = horizontal, positivo hacia arriba) con que, desde
   una altura h1, se ve un punto a altura h2 situado a una distancia d.
   `kind` dice qué es d: "surface" (por defecto), el arco a nivel del mar
   como el resto de mediciones de la app, o "slant", la distancia oblicua
   entre los dos puntos a sus alturas (se convierte primero con
   `surfaceFromSlant`; NaN si no existe). Todo en metros. En una esfera, el observador
   está en r1 = R + h1 y el objetivo en r2 = R + h2 separados un ángulo
   central θ = d/R; la horizontal local del observador es perpendicular
   a su radio, de ahí el atan2 de las componentes.                      */
function elevationAngleDeg(h1, h2, d, model, kind) {
  if (kind === "slant") {
    const r = surfaceFromSlant(h1, h2, d, model);
    if (r.error) return NaN;
    d = r.d;
  }
  const R = elevationRadius(model);
  if (R === null) return toDeg(Math.atan2(h2 - h1, d));
  const th = d / R, r1 = R + h1, r2 = R + h2;
  return toDeg(Math.atan2(r2 * Math.cos(th) - r1, r2 * Math.sin(th)));
}

/* Cono de silencio de una antena: el semiángulo, medido desde la
   vertical, de la zona sobre ella donde no ve un blanco. Es el
   complementario de la elevación a la que se ve ese blanco: a 90° de
   elevación (sobre la antena) el cono es 0°; cuanto más bajo se ve el
   blanco, más ancho es. Sin recortar: con elevación negativa (blanco por
   debajo del centro de fases) sale mayor de 90°, que es lo que dice la
   geometría.                                                          */
const silenceConeDeg = elevDeg => 90 - elevDeg;

/* ---------- Altitud de altímetro → altitud verdadera (presión) ----------
   Un altímetro con el reglaje estándar (1013,25 hPa) marca la ALTITUD
   DE PRESIÓN, no la altura real: si la presión al nivel del mar (QNH)
   no es la estándar, la aeronave está más alta (QNH mayor) o más baja
   (menor) de lo que marca. Se corrige con la atmósfera estándar
   internacional (ISA, ICAO Doc 7488 / US Standard Atmosphere 1976), con
   sus constantes definitorias:
   - p0 = 101325 Pa = 1013,25 hPa (EXACTO; no 1013,1), T0 = 288,15 K,
     gradiente 6,5 K/km hasta los 11 km, g = 9,80665 m/s², M = 28,9644
     g/mol, R* = 8,31432 J/(mol·K) (la de ICAO, no la de CODATA);
   - troposfera: p/p0 = (1 − L·h/T0)^N con N = g·M/(R*·L) = 5,25588;
   - de 11 a 20 km, isoterma a 216,65 K: p/p0 = F11·exp(−(h − 11000)/Hs),
     con Hs = R*·T/(g·M) = 6341,6 m. Necesaria: 45000 ft (13716 m) ya
     está en la estratosfera, y la fórmula de la troposfera extrapolada
     daría un resultado falso allí.
   NO se usa una constante de «30 ft por hPa»: es una regla del pulgar.
   Lo exacto son 27,31 ft/hPa a nivel del mar (8,324 m/hPa) y baja con la
   altitud (26,4 a 5000 ft, 20,5 a 45000 ft: la columna de aire de debajo
   es más fría y se «estira» menos con la presión), y el modelo ya lo
   da todo.
   Método: la presión en el avión es la misma en las dos atmósferas
   (p = p0·f(altitud de presión)); en una atmósfera con el mismo perfil de
   temperatura pero presión QNH al nivel del mar, esa presión se da a la
   altura h que cumple QNH·f(h) = p0·f(alt), es decir h = f⁻¹(p0/QNH ·
   f(alt)). Supone temperatura ISA: la desviación de temperatura real
   (que también mueve la altitud verdadera) no se modela.              */
const ISA_P0_HPA = 1013.25;
const ISA_SEA_T = 288.15;
const ISA_LAPSE = 0.0065;
const ISA_G = 9.80665;
const ISA_MOLAR = 0.0289644;
const ISA_RGAS = 8.31432;
const ISA_BARO_N = ISA_G * ISA_MOLAR / (ISA_RGAS * ISA_LAPSE);
const ISA_TROPO_H = 11000;
const ISA_TROPO_T = ISA_SEA_T - ISA_LAPSE * ISA_TROPO_H;
const ISA_TROPO_F = (ISA_TROPO_T / ISA_SEA_T) ** ISA_BARO_N;
const ISA_STRATO_H = ISA_RGAS * ISA_TROPO_T / (ISA_G * ISA_MOLAR);
/* Rango en que el modelo es ISA de verdad (troposfera + estratosfera baja) */
const ISA_ALT_MIN = -5000;
const ISA_ALT_MAX = 20000;
/* Récords de presión al nivel del mar: ~870 a ~1085 hPa. Un valor fuera de
   este margen es casi seguro un error de tecleo.                         */
const QNH_MIN_HPA = 800;
const QNH_MAX_HPA = 1100;

/* p/p0 a la altitud h (m) en la atmósfera estándar */
function isaPressureRatio(h) {
  return h <= ISA_TROPO_H
    ? (1 - ISA_LAPSE * h / ISA_SEA_T) ** ISA_BARO_N
    : ISA_TROPO_F * Math.exp(-(h - ISA_TROPO_H) / ISA_STRATO_H);
}

/* Inversa de isaPressureRatio: la altitud (m) a la que p/p0 = r */
function isaAltitudeFromRatio(r) {
  return r >= ISA_TROPO_F
    ? ISA_SEA_T / ISA_LAPSE * (1 - r ** (1 / ISA_BARO_N))
    : ISA_TROPO_H - ISA_STRATO_H * Math.log(r / ISA_TROPO_F);
}

/* Altitud verdadera (m) de una aeronave que marca `altM` (m, reglaje
   estándar) con presión `qnhHpa` al nivel del mar. Con la presión
   estándar devuelve la altitud tal cual, sin pasar por la cuenta: así no
   hay ruido de coma flotante en el caso por defecto.                  */
function trueAltitudeM(altM, qnhHpa) {
  if (qnhHpa === ISA_P0_HPA) return altM;
  return isaAltitudeFromRatio(ISA_P0_HPA / qnhHpa * isaPressureRatio(altM));
}

/* Texto de error en español, o null si la corrección es aplicable. Con la
   presión estándar no hay corrección y no se exige nada a la altitud
   (el cálculo no cambia respecto de no tener presión).                */
function pressureInputError(altM, qnhHpa) {
  if (!Number.isFinite(qnhHpa)) return "Introduce la presión atmosférica.";
  if (qnhHpa < QNH_MIN_HPA || qnhHpa > QNH_MAX_HPA) {
    return `La presión al nivel del mar debe estar entre ${QNH_MIN_HPA} y ${QNH_MAX_HPA} hPa.`;
  }
  if (qnhHpa === ISA_P0_HPA) return null;
  const msg = `La corrección por presión solo es válida con la altura de destino entre ${ISA_ALT_MIN / 1000} y ${ISA_ALT_MAX / 1000} km (atmósfera estándar).`;
  if (!Number.isFinite(altM) || altM < ISA_ALT_MIN || altM > ISA_ALT_MAX) return msg;
  const h = trueAltitudeM(altM, qnhHpa);
  return h < ISA_ALT_MIN || h > ISA_ALT_MAX ? msg : null;
}

/* ---------- Vector entre dos puntos con altitud (vector GPS) ----------
   a, b = { lat, lng, alt }, grados y metros. Sobre la esfera de la app
   (EARTH_R), como el resto de la geodesia:
   - horizontal: arco entre las dos verticales a nivel del mar (la misma
     distancia que dan las mediciones del mapa);
   - slant: distancia en LÍNEA RECTA entre los dos puntos en 3D (la
     cuerda, atravesando la Tierra si hace falta), con las altitudes;
   - bearing: rumbo inicial de a → b, 0° = norte horario; null si los
     puntos coinciden en horizontal, donde no hay dirección que dar (y
     atan2(0, 0) devolvería un 0° falso).
   `slant² = (r1−r2)² + 4·r1·r2·sin²(θ/2)` y no la ley de los cosenos
   directa: con puntos cercanos esta forma no pierde cifras por restar
   dos números casi iguales.                                           */
function gpsVector(a, b) {
  const p1 = toRad(a.lat), p2 = toRad(b.lat), dl = toRad(b.lng - a.lng);
  const s = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const theta = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  const r1 = EARTH_R + a.alt, r2 = EARTH_R + b.alt;
  const sinHalf = Math.sin(theta / 2);
  const slant = Math.sqrt((r1 - r2) ** 2 + 4 * r1 * r2 * sinHalf * sinHalf);
  const horizontal = theta * EARTH_R;
  return { horizontal, slant, bearing: horizontal < 0.01 ? null : bearingDeg(a, b) };
}

/* Texto de error en español, o null si los datos sirven. */
function gpsVectorError(a, b) {
  const nums = [a.lat, a.lng, a.alt, b.lat, b.lng, b.alt];
  if (!nums.every(Number.isFinite)) return "Introduce latitud, longitud y altitud de los dos puntos.";
  if (Math.abs(a.lat) > 90 || Math.abs(b.lat) > 90) return "La latitud debe estar entre −90° y 90°.";
  if (Math.abs(a.lng) > 180 || Math.abs(b.lng) > 180) return "La longitud debe estar entre −180° y 180°.";
  if (Math.min(a.alt, b.alt) <= -EARTH_R) return "Una altitud está por debajo del centro de la Tierra.";
  return null;
}

/* Texto de error en español, o null si los datos sirven. */
function elevationInputError(h1, h2, d, model, kind) {
  if (![h1, h2, d].every(Number.isFinite)) return "Introduce las dos alturas y la distancia.";
  if (d < 0) return "La distancia no puede ser negativa.";
  if (d === 0 && h1 === h2) return "Con distancia cero y alturas iguales no hay dirección.";
  const R = elevationRadius(model) || EARTH_R;
  if (Math.min(h1, h2) <= -R) return "Una altura está por debajo del centro de la Tierra.";
  /* La oblicua se valida al convertirla; la de superficie, contra media vuelta. */
  if (kind === "slant") return surfaceFromSlant(h1, h2, d, model).error || null;
  if (model !== "flat" && d > Math.PI * R) return "La distancia supera media vuelta a la Tierra.";
  return null;
}

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

