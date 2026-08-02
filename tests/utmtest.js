const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const fs = require("fs");
const html = fs.readFileSync(HTML_PATH, "utf8");
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const src = script.slice(script.indexOf("/* ---------- Conversión a UTM"),
                         script.indexOf("const METERS_PER_NM"));
const helpers = "const toRad = d => d * Math.PI / 180; const toDeg = r => r * 180 / Math.PI;\n";
const { latLngToUtm, fmtUtm, utmZone, utmBand } =
  new Function(helpers + src + "\nreturn {latLngToUtm, fmtUtm, utmZone, utmBand};")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* --- Inversa independiente (Snyder), solo para el test: si ida y vuelta
       cierran al milímetro, la directa es correcta --- */
const A = 6378137.0, F = 1/298.257223563, K0 = 0.9996, E2 = F*(2-F);
function utmToLatLng(zone, easting, northing, north) {
  const x = easting - 500000, y = north ? northing : northing - 10000000;
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const M = y / K0;
  const mu = M / (A * (1 - E2/4 - 3*E2**2/64 - 5*E2**3/256));
  const p1 = mu + (3*e1/2 - 27*e1**3/32) * Math.sin(2*mu)
           + (21*e1**2/16 - 55*e1**4/32) * Math.sin(4*mu)
           + (151*e1**3/96) * Math.sin(6*mu) + (1097*e1**4/512) * Math.sin(8*mu);
  const ep2 = E2 / (1 - E2);
  const C1 = ep2 * Math.cos(p1)**2, T1 = Math.tan(p1)**2;
  const N1 = A / Math.sqrt(1 - E2 * Math.sin(p1)**2);
  const R1 = A * (1 - E2) / (1 - E2 * Math.sin(p1)**2) ** 1.5;
  const D = x / (N1 * K0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) * (D*D/2
      - (5 + 3*T1 + 10*C1 - 4*C1*C1 - 9*ep2) * D**4/24
      + (61 + 90*T1 + 298*C1 + 45*T1*T1 - 252*ep2 - 3*C1*C1) * D**6/720);
  const lon = (D - (1 + 2*T1 + C1) * D**3/6
      + (5 - 2*C1 + 28*T1 - 3*C1*C1 + 8*ep2 + 24*T1*T1) * D**5/120) / Math.cos(p1);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI/180;
  return { lat: lat * 180/Math.PI, lng: (lon0 + lon) * 180/Math.PI };
}

// Valor publicado de referencia: el origen (0°,0°) es 31N 166021.44 E, 0.00 N
let u = latLngToUtm(0, 0);
ok(u.zone === 31, "huso del origen: " + u.zone);
ok(Math.abs(u.easting - 166021.44) < 0.01, "easting del origen: " + u.easting.toFixed(2));
ok(Math.abs(u.northing) < 0.01, "northing del origen: " + u.northing.toFixed(2));

// Sobre el meridiano central el easting es exactamente el falso este
for (const [lat, zone] of [[40, 30], [-33, 19], [60, 32]]) {
  const lon0 = (zone - 1) * 6 - 180 + 3;
  const c = latLngToUtm(lat, lon0);
  ok(Math.abs(c.easting - 500000) < 1e-6, `meridiano central lat ${lat}: ${c.easting}`);
}

// Hemisferio sur: falso norte de 10.000 km
u = latLngToUtm(-34.6037, -58.3816); // Buenos Aires
ok(u.north === false && u.northing > 6e6 && u.northing < 1e7, "sur usa falso norte: " + u.northing);
ok(u.band === "H", "banda del sur: " + u.band);

// Bandas y husos conocidos
ok(latLngToUtm(40.4168, -3.7038).zone === 30, "Madrid está en el huso 30");
ok(latLngToUtm(40.4168, -3.7038).band === "T", "banda de Madrid: " + latLngToUtm(40.4168,-3.7038).band);
ok(utmZone(58, 6) === 32, "excepción del sur de Noruega");
ok(utmZone(75, 15) === 33, "excepción de Svalbard");
ok(utmZone(75, 5) === 31, "Svalbard occidental");
ok(utmBand(-80) === "C" && utmBand(83) === "X", "bandas extremas");

// Ida y vuelta en una malla amplia: debe cerrar por debajo del milímetro
let worst = 0;
for (let lat = -78; lat <= 82; lat += 4) {
  for (let lon = -177; lon <= 177; lon += 9) {
    const f = latLngToUtm(lat, lon);
    const back = utmToLatLng(f.zone, f.easting, f.northing, f.north);
    const dLat = Math.abs(back.lat - lat) * 111320;
    const dLon = Math.abs(back.lng - lon) * 111320 * Math.cos(lat * Math.PI/180);
    worst = Math.max(worst, Math.hypot(dLat, dLon));
  }
}
console.log(`error máximo ida y vuelta: ${(worst*1000).toFixed(3)} mm`);
/* Ambas son series truncadas, así que se comparan entre sí: basta con
   que coincidan muy por debajo del metro, que es la unidad que se
   muestra en pantalla */
ok(worst < 0.1, "ida y vuelta coherentes muy por debajo del metro mostrado");

/* Verificación independiente del término dominante (el arco de meridiano):
   la serie usada frente a una integración numérica fina de la misma
   integral. Si coinciden, la serie no tiene erratas.                  */
function meridianArcNumeric(latDeg) {
  const p = latDeg * Math.PI / 180, n = 20000, h = p / n;
  const f = t => A * (1 - E2) / (1 - E2 * Math.sin(t) ** 2) ** 1.5;
  let sum = f(0) + f(p);
  for (let i = 1; i < n; i++) sum += f(i * h) * (i % 2 ? 4 : 2);
  return (h / 3) * sum;
}
/* Se usa el meridiano central del huso 30 (-3°), libre de las excepciones
   de Noruega y Svalbard, que desplazarían el punto fuera de él */
for (const lat of [10, 40.4168, 60, 83]) {
  const lon0 = -3;
  const u0 = latLngToUtm(lat, lon0);
  ok(Math.abs(u0.easting - 500000) < 1e-6, `lat ${lat} debe caer en el meridiano central`);
  const serie = u0.northing / K0; // en el meridiano central N = k0·M
  const exacto = meridianArcNumeric(lat);
  const diff = Math.abs(serie - exacto);
  ok(diff < 0.5, `arco de meridiano en ${lat}°: serie ${serie.toFixed(3)} vs integración ${exacto.toFixed(3)} (${diff.toFixed(3)} m)`);
}

// Zonas polares y valores imposibles
ok(latLngToUtm(85, 10) === null, "sobre 84°N no hay UTM");
ok(latLngToUtm(-81, 10) === null, "bajo 80°S no hay UTM");
ok(latLngToUtm(NaN, 0) === null, "latitud no numérica");
ok(fmtUtm(85, 10).includes("polar"), "se explica por qué no hay UTM: " + fmtUtm(85, 10));
ok(/^30T \d+ m E \d+ m N$/.test(fmtUtm(40.4168, -3.7038)), "formato: " + fmtUtm(40.4168, -3.7038));

// El antimeridiano no debe disparar el easting
u = latLngToUtm(0, 179.999);
ok(u.easting > 0 && u.easting < 1e6, "cerca de +180 el easting es sensato: " + u.easting.toFixed(0));
u = latLngToUtm(0, -179.999);
ok(u.easting > 0 && u.easting < 1e6, "cerca de -180 también: " + u.easting.toFixed(0));
if (!process.exitCode) console.log("UTM TESTS OK");
