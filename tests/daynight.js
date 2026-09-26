const { fn, constDecl } = require("./_extract");
const { subsolarPoint, solarElevationDeg, sublunarPoint, sunTimes, sunTimesHtml, fmtSunClock, utcOffsetLabel } = new Function(
  fn("subsolarPoint") + "\n" + fn("solarElevationDeg") + "\n" + fn("sublunarPoint") + "\n"
  + constDecl("SUN_HORIZON_DEG") + "\n" + constDecl("SUN_EVENT_LEVELS") + "\n"
  + fn("solarNoonMs") + "\n" + fn("sunTimes") + "\n" + fn("fmtSunClock") + "\n"
  + fn("utcOffsetLabel") + "\n" + fn("sunTimesHtml")
  + "\nreturn {subsolarPoint, solarElevationDeg, sublunarPoint, sunTimes, sunTimesHtml, fmtSunClock, utcOffsetLabel};")();
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

/* ---------- Horas del sol y crepúsculos ----------
   Madrid en el solsticio de junio: salida ~06:44 y puesta ~21:48 CEST
   (día de 15 h 04 min), o sea ~04:45 y ~19:48 UTC — comprobado además
   con el ángulo horario analítico (cos H = (sen(−0,833°) − sen φ sen δ)
   / (cos φ cos δ) → H = 113,0° → ±7 h 32 min alrededor del mediodía).
   Tolerancia de 6 minutos.                                            */
const min = 60000;
const utcMin = ms => { const d = new Date(ms); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const mad = sunTimes(40.4168, -3.7038, new Date("2026-06-21T10:00:00Z"));
const [astro, naut, civil, horizon] = mad.levels;
ok(Math.abs(utcMin(horizon.rise) - (4 * 60 + 45)) < 6, "Madrid, salida del sol ~04:45 UTC: " + new Date(horizon.rise).toISOString());
ok(Math.abs(utcMin(horizon.set) - (19 * 60 + 48)) < 6, "Madrid, puesta ~19:48 UTC: " + new Date(horizon.set).toISOString());
ok(Math.abs(utcMin(mad.noon) - (12 * 60 + 16)) < 6, "Madrid, mediodía solar ~12:16 UTC: " + new Date(mad.noon).toISOString());
ok(Math.abs(mad.maxElevation - 73) < 1, "Madrid, elevación máxima ~73° en junio: " + mad.maxElevation.toFixed(1));
/* Orden del día: astronómico < náutico < civil < salida < mediodía < puesta < civil < náutico < astronómico */
ok(astro.rise < naut.rise && naut.rise < civil.rise && civil.rise < horizon.rise && horizon.rise < mad.noon,
  "el amanecer se ordena de más oscuro a más claro");
ok(mad.noon < horizon.set && horizon.set < civil.set && civil.set < naut.set,
  "y el anochecer al revés");
/* Cada instante devuelto está de verdad a la elevación que dice */
for (const lv of mad.levels) for (const t of [lv.rise, lv.set]) {
  const s = subsolarPoint(new Date(t));
  ok(Math.abs(solarElevationDeg(40.4168, -3.7038, s.lat, s.lng) - lv.h) < 0.05,
    `elevación en el cruce de ${lv.h}°: ${solarElevationDeg(40.4168, -3.7038, s.lat, s.lng).toFixed(3)}`);
}
/* Un punto en el otro hemisferio y al otro lado del mundo: el día solar
   es el más cercano a `now`, no el de calendario local del navegador. */
const wel = sunTimes(-41.29, 174.78, new Date("2026-06-21T10:00:00Z")); /* Wellington */
ok(Math.abs(wel.noon - Date.UTC(2026, 5, 21, 0, 22)) < 6 * min,
  "Wellington: mediodía solar ~00:22 UTC del 21 (el más cercano a `now`): " + new Date(wel.noon).toISOString());
ok(Math.abs(wel.noon - Date.UTC(2026, 5, 21, 10)) <= 12 * 60 * min, "y dentro de ±12 h de `now`");
ok(wel.levels[3].rise < wel.noon && wel.noon < wel.levels[3].set, "salida < mediodía < puesta también allí");
/* Extremos polares */
const tro = sunTimes(69.65, 18.96, new Date("2026-06-21T12:00:00Z")); /* Tromsø, sol de medianoche */
ok(tro.levels[3].state === "always" && tro.levels[3].rise === null && tro.levels[3].set === null,
  "Tromsø en junio: el sol no se pone (state always, sin horas)");
/* Elevación máxima = 90 − |lat| − 23,44°: a −78° son −11,4° (sin sol ni
   crepúsculo civil, pero sí náutico); a −85° son −18,4° (ni astronómico). */
const ant78 = sunTimes(-78, 0, new Date("2026-06-21T12:00:00Z"));
ok(ant78.levels[3].state === "never" && ant78.levels[2].state === "never" && ant78.levels[1].state === "ok",
  "−78° en junio: ni sol ni crepúsculo civil, pero sí náutico");
const ant85 = sunTimes(-85, 0, new Date("2026-06-21T12:00:00Z"));
ok(ant85.levels.every(l => l.state === "never" && l.rise === null && l.set === null), "−85° en junio: noche polar total");
const osl = sunTimes(69.65, 18.96, new Date("2026-05-10T12:00:00Z"));
ok(osl.levels.some(l => l.state === "ok") , "en transición hay niveles con hora y otros sin ella");
const eq = sunTimes(0, 0, new Date("2026-03-20T12:00:00Z"));
ok(eq.levels.every(l => l.state === "ok" && l.rise < l.set), "en el ecuador todo ocurre todos los días");

/* Formato: hora local del navegador, sufijo de día, desfase */
const ref = new Date(2026, 5, 21, 12, 0, 0).getTime();
ok(fmtSunClock(new Date(2026, 5, 21, 5, 1, 20).getTime(), ref) === "05:01", "HH:MM con cero a la izquierda");
ok(fmtSunClock(new Date(2026, 5, 21, 5, 1, 40).getTime(), ref) === "05:02", "redondeado al minuto más cercano");
ok(fmtSunClock(new Date(2026, 5, 22, 0, 30, 0).getTime(), ref) === "00:30 (+1 d)", "al día siguiente: (+1 d)");
ok(fmtSunClock(new Date(2026, 5, 20, 23, 30, 0).getTime(), ref) === "23:30 (\u22121 d)", "al día anterior: (−1 d)");
ok(/^UTC[+\u2212]\d+(:\d\d)?$/.test(utcOffsetLabel(new Date())), "desfase con forma UTC+2 / UTC−5 / UTC+5:30: " + utcOffsetLabel(new Date()));
const html = sunTimesHtml(40.4168, -3.7038, new Date("2026-06-21T10:00:00Z"));
for (const t of ["Crep\u00FAsculo astron\u00F3mico (inicio)", "Crep\u00FAsculo n\u00E1utico (fin)", "Crep\u00FAsculo civil (inicio)",
  "Salida del sol", "Mediod\u00EDa solar", "Puesta del sol"]) ok(html.includes(t), "la ficha incluye «" + t + "»");
ok((html.match(/<tr>/g) || []).length === 9, "nueve filas: 4 de amanecer, mediodía y 4 de anochecer");
const polar = sunTimesHtml(69.65, 18.96, new Date("2026-06-21T12:00:00Z"));
ok(polar.includes("no ocurre: el sol no baja del horizonte") && polar.includes("no baja de \u22126\u00B0"),
  "sol de medianoche: las filas lo explican");
ok(sunTimesHtml(-85, 0, new Date("2026-06-21T12:00:00Z")).includes("no ocurre: el sol no llega al horizonte"),
  "noche polar: las filas lo explican");

if (!process.exitCode) console.log("DAYNIGHT TESTS OK");
