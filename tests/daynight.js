const { fn } = require("./_extract");
const { subsolarPoint, solarElevationDeg, sublunarPoint } = new Function(
  fn("subsolarPoint") + "\n" + fn("solarElevationDeg") + "\n" + fn("sublunarPoint")
  + "\nreturn {subsolarPoint, solarElevationDeg, sublunarPoint};")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const DEG2RAD = Math.PI / 180;

/* Solsticios y equinoccios: la latitud subsolar (declinación) tiene
   valores de referencia bien conocidos, con tolerancia de ~0,3° para
   un algoritmo de baja precisión.                                    */
let s = subsolarPoint(new Date("2026-06-21T12:00:00Z"));
ok(Math.abs(s.lat - 23.44) < 0.3, "solsticio de junio: latitud subsolar " + s.lat.toFixed(2));

s = subsolarPoint(new Date("2026-12-21T12:00:00Z"));
ok(Math.abs(s.lat + 23.44) < 0.3, "solsticio de diciembre: latitud subsolar " + s.lat.toFixed(2));

s = subsolarPoint(new Date("2026-03-20T12:00:00Z"));
ok(Math.abs(s.lat) < 0.6, "equinoccio de marzo: latitud subsolar cerca de 0°, " + s.lat.toFixed(2));

s = subsolarPoint(new Date("2026-09-23T12:00:00Z"));
ok(Math.abs(s.lat) < 0.6, "equinoccio de septiembre: latitud subsolar cerca de 0°, " + s.lat.toFixed(2));

/* A las 12:00 UTC del propio instante, el sol debe estar cerca del
   meridiano de Greenwich (la ecuación del tiempo la aparta unos
   minutos, nunca más de ~4°).                                        */
ok(Math.abs(s.lng) < 4, "mediodía UTC: longitud subsolar cerca de 0°, " + s.lng.toFixed(2));

/* Elevación: máxima (90°) en el propio punto subsolar, mínima (-90°)
   en su antípoda, y nula en el "ecuador" a 90° de distancia angular. */
const sub = { lat: 10, lng: 20 };
ok(Math.abs(solarElevationDeg(sub.lat, sub.lng, sub.lat, sub.lng) - 90) < 1e-6,
  "elevación en el punto subsolar: 90°");
ok(Math.abs(solarElevationDeg(-sub.lat, sub.lng + 180, sub.lat, sub.lng) + 90) < 1e-6,
  "elevación en la antípoda: -90°");
/* Con el sol sobre el ecuador, un punto a 90° de longitud está también
   a 90° de distancia angular (con declinación distinta de 0 esa
   equivalencia ya no vale, por eso se prueba aparte con lat=0).       */
ok(Math.abs(solarElevationDeg(0, 110, 0, 20)) < 1e-6,
  "elevación a 90° de distancia angular sobre el ecuador: 0°");

/* Con el sol en el ecuador (declinación 0), el terminador cae justo
   sobre los polos geográficos: elevación 0° en ambos.                */
ok(Math.abs(solarElevationDeg(90, 0, 0, 0)) < 1e-6, "polo norte con declinación 0: 0°");
ok(Math.abs(solarElevationDeg(-90, 0, 0, 0)) < 1e-6, "polo sur con declinación 0: 0°");

/* sublunarPoint, contrastado contra un servicio externo (wttr.in) para
   Madrid el 2026-09-25: luna gibosa creciente al 97% de iluminación. La
   fracción iluminada se deriva de la separación angular entre el punto
   subsolar y el sublunar (fase lunar clásica: (1+cos(180°-separación))/2)
   — un error grave de posición (medio día de más, huso al revés…) se
   notaría aquí aunque la declinación por sí sola pareciera razonable.  */
const now = new Date("2026-09-25T20:00:00Z");
const sunNow = subsolarPoint(now);
const moonNow = sublunarPoint(now);
const cosSep = Math.sin(sunNow.lat * DEG2RAD) * Math.sin(moonNow.lat * DEG2RAD)
  + Math.cos(sunNow.lat * DEG2RAD) * Math.cos(moonNow.lat * DEG2RAD) * Math.cos((sunNow.lng - moonNow.lng) * DEG2RAD);
const sep = Math.acos(Math.max(-1, Math.min(1, cosSep))) * (180 / Math.PI);
const illum = (1 + Math.cos((180 - sep) * DEG2RAD)) / 2;
ok(Math.abs(illum - 0.97) < 0.05, `luna gibosa creciente ~97% el 2026-09-25: ${(illum * 100).toFixed(0)}%`);

/* La declinación lunar nunca supera la suma de la oblicuidad terrestre
   y la inclinación orbital de la luna (~23,44°+5,14°≈28,6°): cualquier
   fecha del año debe caer dentro de ese margen, un error de signo o de
   escala se saldría por mucho.                                        */
for (let m = 0; m < 12; m++) {
  const d = sublunarPoint(new Date(Date.UTC(2026, m, 15, 12, 0, 0)));
  ok(Math.abs(d.lat) < 29, `declinación lunar dentro de rango en el mes ${m + 1}: ${d.lat.toFixed(2)}°`);
}

if (!process.exitCode) console.log("DAYNIGHT TESTS OK");
