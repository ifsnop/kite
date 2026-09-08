const { between } = require("./_extract");
const src = between("/* ---------- Coordenadas: rango con tolerancia", '/* "lon,lat[,alt] lon,lat…"')
  + between("function parseCoords(str)", "/* Un <Polygon> KML")
  + between("const GEOJSON_TYPES", "async function buildGeoJsonRecords");
const api = new Function(src + "\nreturn {clampDeg, clampLatLng, parseCoords, validGeometry, counter: () => coordClamped, reset: () => { coordClamped = 0; }};")();
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

/* --- La altitud del KML se conserva; sin ella la posición sigue siendo un par ---
   Antes se partía del texto y no se leía nunca, así que la altitud se
   perdía al importar KML mientras que la del GeoJSON sí sobrevivía. */
ok(pts[0].length === 3 && pts[0][2] === 0, "la altitud 0 explícita se conserva: " + JSON.stringify(pts[0]));
ok(pts[1].length === 2, "sin altitud, la posición sigue teniendo dos elementos: " + JSON.stringify(pts[1]));
const alt = api.parseCoords("-3.7,40.4,650.5");
ok(alt[0][2] === 650.5, "una altitud real llega intacta: " + alt[0][2]);
ok(api.clampLatLng(40, -3, 100)[2] === 100, "clampLatLng transporta la altitud");
ok(api.clampLatLng(40, -3).length === 2, "sin altitud no se inventa una");
ok(api.clampLatLng(40, -3, NaN).length === 2, "una altitud no finita se ignora, no rompe el punto");
/* La altitud no tiene rango que ajustar: no debe contar como ajuste */
api.reset();
api.clampLatLng(40, -3, 99999);
ok(api.counter() === 0, "una altitud grande no cuenta como ajuste de coordenada");

/* --- GeoJSON: además de validar, deja la posición dentro de rango --- */
api.reset();
const geom = { type: "LineString", coordinates: [[180.00000044181039, 40.4], [179.5, 40.5]] };
ok(api.validGeometry(geom), "la línea deja de considerarse inválida");
ok(geom.coordinates[0][0] === 180, "y su coordenada queda saneada: " + geom.coordinates[0][0]);
const bad = { type: "Point", coordinates: [-2, 32400] };
ok(!api.validGeometry(bad), "un valor imposible sigue invalidando la geometría");
if (!process.exitCode) console.log("CLAMP TESTS OK");
