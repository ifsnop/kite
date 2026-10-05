const { fn, constDecl, between } = require("./_extract");
const src = [
  constDecl("EARTH_R"), constDecl("toRad"), constDecl("toDeg"),
  constDecl("REFRACTION_K"), constDecl("elevationRadius"), constDecl("silenceConeDeg"),
  fn("bearingDeg"), fn("surfaceFromSlant"), fn("elevationAngleDeg"), fn("elevationInputError"),
  fn("gpsVector"), fn("gpsVectorError"),
  /* Constantes de la atmósfera estándar: el tramo entero, entre sus dos marcas */
  between("const ISA_P0_HPA", "/* p/p0 a la altitud h (m)"),
  fn("isaPressureRatio"), fn("isaAltitudeFromRatio"), fn("trueAltitudeM"), fn("pressureInputError")
].join("\n");
const { elevationAngleDeg, elevationInputError, surfaceFromSlant, silenceConeDeg, gpsVector, gpsVectorError,
  isaPressureRatio, isaAltitudeFromRatio, trueAltitudeM, pressureInputError, P0, BARO_N, R, K } =
  new Function(src + "\nreturn {elevationAngleDeg, elevationInputError, surfaceFromSlant, silenceConeDeg, gpsVector, gpsVectorError," +
    " isaPressureRatio, isaAltitudeFromRatio, trueAltitudeM, pressureInputError, P0: ISA_P0_HPA, BARO_N: ISA_BARO_N," +
    " R: EARTH_R, K: REFRACTION_K};")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`);

/* --- Plano: trigonometría directa --- */
near(elevationAngleDeg(0, 1000, 1000, "flat"), 45, 1e-12, "plano: Δh = d da 45°");
near(elevationAngleDeg(500, 500, 3000, "flat"), 0, 1e-12, "plano: alturas iguales da 0°");
near(elevationAngleDeg(1000, 0, 1000, "flat"), -45, 1e-12, "plano: bajar da ángulo negativo");
near(elevationAngleDeg(0, 100, 0, "flat"), 90, 1e-12, "plano: d = 0 hacia arriba da 90°");
near(elevationAngleDeg(100, 0, 0, "flat"), -90, 1e-12, "plano: d = 0 hacia abajo da -90°");

/* --- Esfera con alturas iguales: la horizontal del observador queda por
       encima del objetivo exactamente la mitad del ángulo central --- */
for (const [model, Re] of [["sphere", R], ["refr", R * K]]) {
  for (const [h, d] of [[0, 10000], [3000, 50000], [10000, 500000]]) {
    const expected = -(d / Re / 2) * 180 / Math.PI;
    near(elevationAngleDeg(h, h, d, model), expected, 1e-9, `${model}: alturas iguales h=${h} d=${d}`);
  }
}
/* La refracción reduce la curvatura aparente: menos caída que sin ella */
ok(Math.abs(elevationAngleDeg(1000, 1000, 100000, "refr")) < Math.abs(elevationAngleDeg(1000, 1000, 100000, "sphere")),
  "la refracción 4/3 da una caída menor que la esfera sola");

/* --- Distancias cortas: la esfera converge al plano --- */
near(elevationAngleDeg(10, 60, 200, "sphere"), elevationAngleDeg(10, 60, 200, "flat"), 1e-3,
  "a 200 m esfera ≈ plano");

/* --- Horizonte geométrico: un objetivo a nivel del mar justo en el
       horizonte del observador se ve a -acos(R/(R+h1)) --- */
{
  const h1 = 1000, a = Math.acos(R / (R + h1));
  near(elevationAngleDeg(h1, 0, R * a, "sphere"), -a * 180 / Math.PI, 1e-9, "horizonte geométrico");
}

/* --- El resultado es finito y sin saltos al cruzar la vertical --- */
ok(Number.isFinite(elevationAngleDeg(0, 100, 0, "sphere")), "esfera con d = 0 sigue siendo finita");
near(elevationAngleDeg(0, 100, 0, "sphere"), 90, 1e-9, "esfera con d = 0 hacia arriba da 90°");

/* --- Validación --- */
ok(elevationInputError(0, 100, 1000, "refr") === null, "datos normales no dan error");
ok(elevationInputError(NaN, 100, 1000, "flat"), "altura no numérica es error");
ok(elevationInputError(0, 100, Infinity, "flat"), "distancia infinita es error");
ok(elevationInputError(0, 100, -1, "flat"), "distancia negativa es error");
ok(elevationInputError(50, 50, 0, "flat"), "d = 0 con alturas iguales es error");
ok(elevationInputError(0, 100, 0, "flat") === null, "d = 0 con alturas distintas es válido");
ok(elevationInputError(-R, 0, 100, "sphere"), "altura en el centro de la Tierra es error");
ok(elevationInputError(0, 0, Math.PI * R + 1, "sphere"), "más de media vuelta es error en la esfera");
ok(elevationInputError(0, 0, Math.PI * R + 1, "flat") === null, "el modelo plano no limita la distancia");

/* --- Cono de silencio: complementario de la elevación --- */
near(silenceConeDeg(90), 0, 1e-12, "blanco en la vertical: cono 0°");
near(silenceConeDeg(0), 90, 1e-12, "blanco en la horizontal: cono 90°");
near(silenceConeDeg(30), 60, 1e-12, "elevación 30°: cono 60°");
near(silenceConeDeg(-10), 100, 1e-12, "blanco por debajo del centro de fases: cono mayor de 90°, sin recortar");
{
  /* Antena a 25 m, aeronave a 30000 ft, blanco a 40 NM: elevación y cono suman 90° */
  const elev = elevationAngleDeg(25, 30000 * 0.3048, 40 * 1852, "refr");
  ok(elev > 0 && elev < 90, "elevación razonable de un avión alto: " + elev);
  near(elev + silenceConeDeg(elev), 90, 1e-12, "elevación + cono = 90°");
}

/* --- Vector GPS, contra una formulación independiente: puntos en 3D
       (ECEF esférico), ángulo entre radios con atan2(|a×b|, a·b), cuerda
       como norma de la diferencia y acimut con las componentes este/norte
       del vector en A --- */
function ecef(lat, lng, alt) {
  const p = lat * Math.PI / 180, l = lng * Math.PI / 180, r = R + alt;
  return [r * Math.cos(p) * Math.cos(l), r * Math.cos(p) * Math.sin(l), r * Math.sin(p)];
}
function independent(a, b) {
  const A = ecef(a.lat, a.lng, a.alt), B = ecef(b.lat, b.lng, b.alt);
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const A0 = ecef(a.lat, a.lng, 0), B0 = ecef(b.lat, b.lng, 0);
  const horizontal = R * Math.atan2(Math.hypot(...cross(A0, B0)), dot(A0, B0));
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const p = a.lat * Math.PI / 180, l = a.lng * Math.PI / 180;
  const east = [-Math.sin(l), Math.cos(l), 0];
  const north = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
  return { horizontal, slant: Math.hypot(...d), bearing: (Math.atan2(dot(d, east), dot(d, north)) * 180 / Math.PI + 360) % 360 };
}
const pairs = [
  [{ lat: 40.4168, lng: -3.7038, alt: 667 }, { lat: 41.3874, lng: 2.1686, alt: 12 }],      /* Madrid → Barcelona */
  [{ lat: 40, lng: -3, alt: 0 }, { lat: 40, lng: -3, alt: 9144 }],                         /* misma vertical */
  [{ lat: -33.9, lng: 151.2, alt: 50 }, { lat: 35.7, lng: 139.7, alt: 10000 }],             /* Sídney → Tokio */
  [{ lat: 10, lng: 179.5, alt: 1000 }, { lat: 12, lng: -179.5, alt: 3000 }],               /* cruza ±180° */
  [{ lat: 70, lng: 20, alt: 0 }, { lat: 80, lng: -160, alt: 0 }]                           /* por el polo */
];
for (const [a, b] of pairs) {
  const got = gpsVector(a, b), want = independent(a, b), tag = `${a.lat},${a.lng} → ${b.lat},${b.lng}`;
  near(got.horizontal, want.horizontal, 1e-3, "distancia horizontal " + tag);
  near(got.slant, want.slant, 1e-3, "distancia en línea recta " + tag);
  if (got.bearing !== null) {
    const dB = Math.abs(((got.bearing - want.bearing + 540) % 360) - 180);
    ok(dB < 1e-6, `orientación ${tag}: ${got.bearing} vs ${want.bearing}`);
  }
}
/* Casos de referencia fáciles de verificar a mano */
{
  const eq = gpsVector({ lat: 0, lng: 0, alt: 0 }, { lat: 0, lng: 1, alt: 0 });
  near(eq.horizontal, R * Math.PI / 180, 1e-6, "1° de longitud en el ecuador");
  near(eq.bearing, 90, 1e-9, "hacia el este: 90°");
  near(eq.slant, 2 * R * Math.sin(Math.PI / 360), 1e-6, "cuerda de 1° a nivel del mar");
  near(gpsVector({ lat: 0, lng: 0, alt: 0 }, { lat: 1, lng: 0, alt: 0 }).bearing, 0, 1e-9, "hacia el norte: 0°");
  near(gpsVector({ lat: 0, lng: 0, alt: 0 }, { lat: -1, lng: 0, alt: 0 }).bearing, 180, 1e-9, "hacia el sur: 180°");
  near(gpsVector({ lat: 0, lng: 0, alt: 0 }, { lat: 0, lng: -1, alt: 0 }).bearing, 270, 1e-9, "hacia el oeste: 270°");
  /* Con altitud la línea recta es más larga que a nivel del mar, y la horizontal no cambia */
  const hi = gpsVector({ lat: 0, lng: 0, alt: 10000 }, { lat: 0, lng: 1, alt: 10000 });
  ok(hi.slant > eq.slant, "a 10 km de altitud la cuerda es más larga");
  near(hi.horizontal, eq.horizontal, 1e-9, "la distancia horizontal no depende de la altitud");
  /* Misma vertical: la distancia es la diferencia de altitudes y no hay orientación */
  const up = gpsVector({ lat: 40, lng: -3, alt: 100 }, { lat: 40, lng: -3, alt: 1100 });
  near(up.slant, 1000, 1e-9, "misma vertical: distancia = diferencia de altitudes");
  ok(up.horizontal === 0 && up.bearing === null, "misma vertical: sin distancia horizontal ni orientación (no un 0° falso)");
  /* Puntos muy cercanos: sin pérdida de cifras (la ley de los cosenos directa daría ruido) */
  const close = gpsVector({ lat: 40, lng: -3, alt: 0 }, { lat: 40, lng: -3 + 1e-7, alt: 0 });
  near(close.slant, close.horizontal, 1e-6, "a ~1 cm la cuerda y el arco coinciden");
  ok(close.slant > 0.005 && close.slant < 0.02, "y la distancia de 1e-7° de longitud sale ~0,85 cm: " + close.slant);
}
/* Validación */
const P = { lat: 10, lng: 20, alt: 0 };
ok(gpsVectorError(P, P) === null, "dos puntos válidos no dan error (incluso iguales)");
ok(gpsVectorError({ ...P, lat: NaN }, P), "latitud no numérica es error");
ok(gpsVectorError(P, { ...P, alt: NaN }), "altitud no numérica es error");
ok(gpsVectorError({ ...P, lat: 90.5 }, P), "latitud fuera de rango es error");
ok(gpsVectorError(P, { ...P, lng: -181 }), "longitud fuera de rango es error");
ok(gpsVectorError(P, { ...P, alt: -R }), "altitud en el centro de la Tierra es error");
ok(gpsVectorError({ ...P, lat: 90 }, { ...P, lat: -90 }) === null, "los polos son válidos");

/* --- Distancia OBLICUA (kind = "slant"): la recta entre el punto inicial
       a su altura y el final a la suya --- */
/* Plano: triángulo 3-4-5 */
near(elevationAngleDeg(0, 3, 5, "flat", "slant"), Math.asin(3 / 5) * 180 / Math.PI, 1e-9, "plano, oblicua 5 con Δh 3: asin(3/5)");
near(elevationAngleDeg(10, 7, 5, "flat", "slant"), -Math.asin(3 / 5) * 180 / Math.PI, 1e-9, "plano, bajando: ángulo negativo");
/* Oblicua = Δh: los dos puntos en la misma vertical */
near(elevationAngleDeg(0, 100, 100, "flat", "slant"), 90, 1e-9, "plano, oblicua = Δh hacia arriba: 90°");
near(elevationAngleDeg(0, 100, 100, "sphere", "slant"), 90, 1e-9, "esfera, oblicua = Δh hacia arriba: 90°");
near(elevationAngleDeg(100, 0, 100, "refr", "slant"), -90, 1e-9, "refracción, oblicua = Δh hacia abajo: -90°");
/* Esfera y refracción: se parte de una distancia de superficie, se calcula la cuerda con OTRA
   fórmula (coordenadas 2D del objetivo respecto del observador) y el ángulo por oblicua debe
   coincidir con el de superficie */
for (const [model, Re] of [["sphere", R], ["refr", R * K]]) {
  for (const [h1, h2, d] of [[1000, 0, 50000], [0, 9144, 200000], [300, 12000, 400000], [10, 10, 3000]]) {
    const th = d / Re, r1 = Re + h1, r2 = Re + h2;
    const chord = Math.hypot(r2 * Math.sin(th), r1 - r2 * Math.cos(th));
    near(elevationAngleDeg(h1, h2, chord, model, "slant"), elevationAngleDeg(h1, h2, d, model),
      1e-7, `${model}: la oblicua equivalente da el mismo ángulo (h1=${h1} h2=${h2} d=${d})`);
    near(surfaceFromSlant(h1, h2, chord, model).d, d, 1e-3, `${model}: surfaceFromSlant recupera la distancia de superficie`);
  }
}
/* Cruce con el vector GPS (otro camino de código): su cuerda 3D y su arco horizontal */
{
  const a = { lat: 40.4168, lng: -3.7038, alt: 650 }, b = { lat: 41.3874, lng: 2.1686, alt: 12 };
  const v = gpsVector(a, b);
  near(surfaceFromSlant(a.alt, b.alt, v.slant, "sphere").d, v.horizontal, 1e-3,
    "la oblicua de gpsVector convertida da su distancia horizontal");
}
/* Puntos muy cercanos: acos de la ley de los cosenos daría ruido, aquí no */
near(surfaceFromSlant(0, 0, 0.01, "sphere").d, 0.01, 1e-9, "oblicua de 1 cm a nivel del mar: 1 cm de superficie");
/* A 5 km de altura la cuerda de 1 cm corresponde a un arco A NIVEL DEL MAR algo menor: el
   mismo ángulo central sobre un radio más corto (factor Re/(Re+h)). Es lo que mide la distancia
   de superficie, no un fallo. */
near(surfaceFromSlant(5000, 5000, 0.01, "refr").d, 0.01 * R * K / (R * K + 5000), 1e-12,
  "y a 5 km de altura, con refracción, el arco a nivel del mar es algo menor que la cuerda");
/* El tipo por defecto sigue siendo la distancia de superficie */
near(elevationAngleDeg(0, 1000, 1000, "flat"), elevationAngleDeg(0, 1000, 1000, "flat", "surface"), 0, "sin tipo = superficie");
ok(elevationAngleDeg(0, 1000, 1000, "flat", "surface") !== elevationAngleDeg(0, 1000, 1000, "flat", "slant"),
  "y distinto del oblicuo con la misma cifra");
/* Validación de la oblicua */
ok(elevationInputError(0, 100, 50, "flat", "slant"), "oblicua menor que la diferencia de alturas es error");
ok(/oblicua/.test(elevationInputError(0, 100, 50, "sphere", "slant")), "y el aviso habla de la distancia oblicua");
ok(elevationInputError(0, 100, 100, "flat", "slant") === null, "oblicua igual a la diferencia de alturas es válida");
ok(elevationInputError(0, 304.8, 304.8 * (1 - 1e-12), "flat", "slant") === null, "pasarse un redondeo de unidades de la diferencia de alturas no es error");
ok(elevationInputError(0, 100, 100 * (1 - 1e-3), "flat", "slant"), "pero un 0,1 % menos sí lo es");
ok(elevationInputError(0, 0, 0, "sphere", "slant"), "oblicua 0 con alturas iguales: no hay dirección");
ok(elevationInputError(0, 0, 2 * R + 1, "sphere", "slant"), "oblicua mayor que la cuerda máxima (diámetro) es error en la esfera");
ok(elevationInputError(0, 0, 2 * R * 10, "flat", "slant") === null, "el modelo plano no limita la oblicua");
ok(elevationInputError(0, 0, 2 * R - 1, "sphere", "slant") === null, "una oblicua casi igual al diámetro cabe (puntos casi antípodas)");
ok(elevationInputError(0, 0, Math.PI * R, "sphere", "slant"), "una oblicua de π·R es mayor que el diámetro de la Tierra: imposible, aunque como ARCO sí cabría");
ok(elevationInputError(0, 100, -1, "flat", "slant"), "oblicua negativa es error");
ok(Number.isNaN(elevationAngleDeg(0, 100, 50, "flat", "slant")), "y el ángulo de un caso imposible es NaN, no un número falso");

/* --- Caso reportado como fallo del cono de silencio ---
   Antena a 24,21 m, aeronave a 45000 ft, 12,2 NM: otras aplicaciones daban
   ~37° de elevación y KITE ~31°. No era la fórmula: era la distancia. Como
   alcance OBLICUO (el que da un radar) son 37°, como arco sobre el suelo 31°.
   Los dos se derivan aquí a mano: asin(Δh/s) y atan(Δh/d) en el plano. */
{
  const ha = 24.21, hb = 45000 * 0.3048, d = 12.2 * 1852, dh = hb - ha;
  near(elevationAngleDeg(ha, hb, d, "flat", "slant"), Math.asin(dh / d) * 180 / Math.PI, 1e-9, "plano, oblicua: asin(Δh/d)");
  near(elevationAngleDeg(ha, hb, d, "flat", "surface"), Math.atan(dh / d) * 180 / Math.PI, 1e-9, "plano, superficie: atan(Δh/d)");
  near(elevationAngleDeg(ha, hb, d, "flat", "slant"), 37.30, 0.005, "oblicua: ~37,3° (lo que dan las otras aplicaciones)");
  near(elevationAngleDeg(ha, hb, d, "flat", "surface"), 31.22, 0.005, "superficie: ~31,2° (lo que daba antes KITE)");
  /* El modelo de Tierra apenas importa a esta distancia (lo dicho en el informe) */
  for (const kind of ["slant", "surface"]) {
    const f = elevationAngleDeg(ha, hb, d, "flat", kind);
    for (const model of ["sphere", "refr"]) {
      const m = elevationAngleDeg(ha, hb, d, model, kind);
      ok(Math.abs(m - f) < 0.15, `${kind}: el modelo ${model} mueve menos de 0,15° respecto del plano: ${m} vs ${f}`);
    }
  }
  ok(Math.round(elevationAngleDeg(ha, hb, d, "refr", "slant")) === 37, "con el modelo por defecto, la oblicua da 37°");
  ok(Math.round(silenceConeDeg(elevationAngleDeg(ha, hb, d, "refr", "slant"))) === 53, "y el cono de silencio, 53°");
}

/* --- Corrección de la altitud por presión (atmósfera estándar ISA) --- */
/* Constantes: la presión estándar es EXACTAMENTE 1013.25 hPa (101325 Pa), no 1013.1 */
ok(P0 === 1013.25, "presión estándar al nivel del mar: 1013.25 hPa exactos: " + P0);
near(BARO_N, 5.25588, 1e-5, "exponente barométrico g·M/(R*·L) = 5.25588");
near(1 / BARO_N, 0.190263, 1e-6, "y su inverso, 0.190263 (el de la fórmula del altímetro)");

/* Presión a cada altitud contra la tabla publicada de la atmósfera estándar (US 1976 / ICAO), en hPa */
for (const [h, hpa] of [[0, 1013.25], [1000, 898.746], [2000, 794.952], [5000, 540.199], [10000, 264.363],
  [11000, 226.321], [15000, 120.446], [20000, 54.749]]) {
  near(P0 * isaPressureRatio(h), hpa, 0.02, `ISA a ${h} m: ${hpa} hPa`);
}
/* Continuidad en la tropopausa (valor y pendiente): un salto ahí movería la altitud de 45000 ft */
{
  const e = 1e-6, a = isaPressureRatio(11000 - e), b = isaPressureRatio(11000 + e);
  near(a, b, 1e-9, "p/p0 continua en 11 km");
  const sl = (isaPressureRatio(11000) - isaPressureRatio(11000 - 1)) , sr = (isaPressureRatio(11001) - isaPressureRatio(11000));
  ok(Math.abs(sl - sr) / Math.abs(sl) < 1e-3, "y con pendiente continua: " + sl + " vs " + sr);
}
/* La inversa deshace a la directa en las dos capas */
for (let h = -5000; h <= 20000; h += 500) {
  near(isaAltitudeFromRatio(isaPressureRatio(h)), h, 1e-6, `ida y vuelta a ${h} m`);
}

/* Con la presión estándar, la altitud no cambia NI UN BIT, incluso fuera del rango ISA */
for (const alt of [-100000, 0, 13716, 20000, 50000]) ok(trueAltitudeM(alt, 1013.25) === alt, `presión estándar: ${alt} m tal cual`);

/* Nivel del mar: la sensibilidad es 8.324 m/hPa = 27.31 ft/hPa (NO los 30 de la regla del pulgar) */
{
  const dh = (trueAltitudeM(0, 1013.25 + 0.001) - 0) / 0.001;
  near(dh, 8.3242, 1e-3, "nivel del mar: 8.324 m/hPa: " + dh);
  near(dh / 0.3048, 27.31, 0.01, "= 27.31 ft/hPa");
  ok(dh / 0.3048 < 28 && dh / 0.3048 > 26, "no son 30 ft/hPa");
}
/* Y baja con la altitud: la columna de aire de debajo es más fría */
{
  const perHpa = ft => (trueAltitudeM(ft * 0.3048, 1014.25) - ft * 0.3048) / 0.3048;
  ok(perHpa(5000) < perHpa(0) && perHpa(18000) < perHpa(5000) && perHpa(45000) < perHpa(18000), "el efecto de 1 hPa baja al subir");
  near(perHpa(5000), 26.36, 0.05, "a 5000 ft: 26.4 ft/hPa");
  near(perHpa(45000), 20.52, 0.05, "a 45000 ft: 20.5 ft/hPa");
}
/* Fórmulas cerradas independientes, una por capa */
{
  /* Troposfera, desde el nivel del mar: h = (T0/L)·(1 − (p0/QNH)^0.190263) */
  const q = 1030;
  near(trueAltitudeM(0, q), 44330.77 * (1 - (1013.25 / q) ** 0.190263), 0.01, "troposfera: fórmula cerrada del altímetro");
  near(trueAltitudeM(0, 980), 44330.77 * (1 - (1013.25 / 980) ** 0.190263), 0.01, "…y con presión baja");
  /* Estratosfera baja: h = alt + Hs·ln(QNH/p0), con Hs = R*·T/(g·M) = 6341.62 m (isoterma) */
  near(trueAltitudeM(13716, q), 13716 + 6341.62 * Math.log(q / 1013.25), 0.01, "estratosfera: alt + Hs·ln(QNH/p0)");
  near(trueAltitudeM(13716, 1000), 13716 + 6341.62 * Math.log(1000 / 1013.25), 0.01, "…y con presión baja");
}
/* Sentido: QNH mayor → más alta que lo que marca; menor → más baja; creciente y sin saltos al cruzar los 11 km */
for (const alt of [0, 3000, 10900, 11500, 13716, 19000]) {
  ok(trueAltitudeM(alt, 1030) > alt && trueAltitudeM(alt, 990) < alt, `a ${alt} m: QNH mayor sube, menor baja`);
  let prev = -Infinity;
  for (let q = 900; q <= 1100; q += 10) {
    const h = trueAltitudeM(alt, q);
    ok(h > prev, `a ${alt} m, la altitud verdadera crece con QNH (${q} hPa)`); prev = h;
  }
}
/* La presión en la aeronave es la misma en las dos atmósferas: QNH·f(h) = p0·f(alt) */
for (const [alt, q] of [[0, 1030], [5000, 990], [10900, 1100], [13716, 1030], [19000, 950]]) {
  const h = trueAltitudeM(alt, q);
  near(q * isaPressureRatio(h) / (P0 * isaPressureRatio(alt)), 1, 1e-12, `misma presión en el avión (${alt} m, QNH ${q})`);
}
/* Validación de la presión y del rango */
ok(pressureInputError(5000, NaN), "presión no numérica: error");
ok(/800 y 1100/.test(pressureInputError(5000, 799) || ""), "por debajo de 800 hPa: error con el rango");
ok(pressureInputError(5000, 1101), "por encima de 1100 hPa: error");
ok(pressureInputError(5000, 1013.25) === null, "la presión estándar es válida");
ok(pressureInputError(50000, 1013.25) === null, "con la estándar no se exige rango a la altitud (no hay corrección)");
ok(pressureInputError(5000, 1000) === null, "presión y altitud normales: sin error");
ok(pressureInputError(50000, 1000), "fuera de la atmósfera estándar (50 km) con otra presión: error");
ok(pressureInputError(-6000, 1000), "por debajo de −5 km con otra presión: error");
ok(pressureInputError(19990, 1100), "si la corrección la saca de los 20 km: error");
ok(pressureInputError(NaN, 1000), "altitud no numérica con otra presión: error");

if (!process.exitCode) console.log("GEOCALC TESTS OK");
