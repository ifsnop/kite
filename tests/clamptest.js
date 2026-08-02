const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const fs = require("fs");
const script = fs.readFileSync(HTML_PATH,"utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];
const src = script.slice(script.indexOf("/* ---------- Coordenadas: rango con tolerancia"),
                         script.indexOf('/* "lon,lat[,alt] lon,lat…"'))
  + script.slice(script.indexOf("function parseCoords(str)"), script.indexOf("/* Un <Polygon> KML"))
  + script.slice(script.indexOf("const GEOJSON_TYPES"), script.indexOf("async function buildGeoJsonTree"));
const api = new Function(src + "\nreturn {clampDeg, clampLatLng, validLatLng, parseCoords, validGeometry, counter: () => coordClamped, reset: () => { coordClamped = 0; }};")();
const ok=(c,m)=>{ if(!c){ console.error("FAIL: "+m); process.exitCode=1; } };

/* --- el caso exacto que reportaste --- */
api.reset();
let p = api.clampLatLng(40.4, 180.00000044181039);
ok(p !== null, "180.00000044181039 ya no se descarta");
ok(p[1] === 180, "se ajusta exactamente al límite: " + p[1]);
ok(api.counter() === 1, "y se contabiliza el ajuste");

/* --- simetría y latitudes --- */
ok(api.clampLatLng(40, -180.0000004)[1] === -180, "también por el lado negativo");
ok(api.clampLatLng(90.0000003, 0)[0] === 90, "el polo norte por redondeo");
ok(api.clampLatLng(-90.0000003, 0)[0] === -90, "y el sur");

/* --- lo que NO debe colarse --- */
ok(api.clampLatLng(32400, -2) === null, "la latitud 32400 (coma decimal) se sigue rechazando");
ok(api.clampLatLng(40, 180.5) === null, "medio grado de exceso es un error real, no un redondeo");
ok(api.clampLatLng(90.5, 0) === null, "latitud 90,5 rechazada");
ok(api.clampLatLng(NaN, 0) === null && api.clampLatLng(0, Infinity) === null, "no finitos fuera");
ok(api.clampLatLng(0, 0)[0] === 0, "el origen sigue siendo válido");
ok(api.clampLatLng(-89.999, 179.999)[1] === 179.999, "lo que ya está dentro no se toca");

/* --- la frontera de la tolerancia ---
   No se prueba el valor exacto: 180+1e-5 no es representable y cae un
   ulp por encima o por debajo según el redondeo. Se comprueba a ambos
   lados, que es lo que importa.                                      */
ok(api.clampLatLng(0, 180 + 9e-6) !== null, "dentro de la tolerancia, se ajusta");
ok(api.clampLatLng(0, 180 + 2e-5) === null, "al doble de la tolerancia, se rechaza");
ok(api.clampLatLng(0, 180 + 9e-6)[1] === 180, "y el ajuste deja el límite exacto");

/* --- KML: la geometría entera se salvaba o se perdía por un vértice --- */
api.reset();
const pts = api.parseCoords("180.00000044181039,40.4,0 179.9,40.5 -180.0000002,40.6");
ok(pts.length === 3, "los tres vértices entran: " + pts.length);
ok(pts[0][1] === 180 && pts[2][1] === -180, "ajustados a los límites");
ok(pts.skipped === 0, "ninguno descartado");
ok(api.counter() === 2, "dos ajustes contabilizados: " + api.counter());

/* --- GeoJSON: además de validar, deja la posición dentro de rango --- */
api.reset();
const geom = { type: "LineString", coordinates: [[180.00000044181039, 40.4], [179.5, 40.5]] };
ok(api.validGeometry(geom), "la línea deja de considerarse inválida");
ok(geom.coordinates[0][0] === 180, "y su coordenada queda saneada: " + geom.coordinates[0][0]);
const bad = { type: "Point", coordinates: [-2, 32400] };
ok(!api.validGeometry(bad), "un valor imposible sigue invalidando la geometría");
if (!process.exitCode) console.log("CLAMP TESTS OK");
