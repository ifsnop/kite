/* ¿Lo escrito en el buscador de lugares son coordenadas? (43-points-editor.js,
   parsePlaceCoordinates, PURA). Se prueba lo que SÍ se reconoce, en los
   formatos de la aplicación (decimal, coma decimal, grados-minutos-segundos con
   letras de hemisferio en cualquier orden), y sobre todo lo que NO: un nombre
   de lugar, una dirección, una latitud fuera de rango o una cifra suelta tienen
   que seguir yendo a Nominatim.                                              */
const { fn } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const { parsePlaceCoordinates: parse } = new Function(fn("parseCoordRaw") + "\n" + fn("parseCoord") + "\n" + fn("parsePlaceCoordinates")
  + "\nreturn { parsePlaceCoordinates };")();

const near = (at, lat, lng, tol = 1e-6) => !!at && Math.abs(at.lat - lat) < tol && Math.abs(at.lng - lng) < tol;
const show = t => JSON.stringify(parse(t));

/* ---------- Decimales ---------- */
for (const t of ["40.4168, -3.7038", "40.4168,-3.7038", "40.4168 -3.7038", "40.4168 , -3.7038", "40.4168; -3.7038", "40.4168 / -3.7038", "  40.4168   -3.7038  "]) {
  ok(near(parse(t), 40.4168, -3.7038), `decimales con punto «${t}»: ${show(t)}`);
}
ok(near(parse("-33.8688, 151.2093"), -33.8688, 151.2093), "hemisferio sur y este, con signo");
ok(near(parse("40, -3"), 40, -3) && near(parse("40 -3"), 40, -3), "enteros");
ok(near(parse("+40.4168 +3.7038"), 40.4168, 3.7038), "signo más explícito");
ok(near(parse("40.4168 -3.7038".replace(" ", " ")), 40.4168, -3.7038), "espacio");
ok(near(parse("40.4168, −3.7038"), 40.4168, -3.7038), "el signo menos tipográfico (−)");
ok(near(parse("90, 180"), 90, 180) && near(parse("-90, -180"), -90, -180), "los límites valen");

/* ---------- Coma decimal ---------- */
for (const t of ["40,4168 -3,7038", "40,4168; -3,7038", "40,4168 ; -3,7038", "40,4168 / -3,7038"]) {
  ok(near(parse(t), 40.4168, -3.7038), `coma decimal «${t}»: ${show(t)}`);
}

/* ---------- Con letras de hemisferio ---------- */
const MAD_LAT = 40 + 25 / 60 + 0.5 / 3600, MAD_LNG = -(3 + 42 / 60 + 13 / 3600);
for (const t of ["40°25'0.5\"N 3°42'13\"W", "40 25 0.5 N, 3 42 13 W", "40°25′0.5″N, 3°42′13″W", "N 40 25 0.5, W 3 42 13", "N40 25 0.5 W3 42 13",
  "3 42 13 W 40 25 0.5 N", "W 3°42'13\", N 40°25'0.5\"", "40º 25' 0,5\" N ; 3º 42' 13\" O"]) {
  ok(near(parse(t), MAD_LAT, MAD_LNG), `GMS «${t}»: ${show(t)}`);
}
ok(near(parse("40.4168 N, 3.7038 W"), 40.4168, -3.7038) && near(parse("N 40.4168 W 3.7038"), 40.4168, -3.7038), "decimal con letras");
ok(near(parse("3.7038 W 40.4168 N"), 40.4168, -3.7038), "con letras manda la letra, no el orden: la longitud primero");
ok(near(parse("33.8688 S 151.2093 E"), -33.8688, 151.2093), "S y E");
ok(near(parse("40,4168 N 3,7038 O"), 40.4168, -3.7038), "coma decimal con N y O (oeste en español)");
ok(near(parse("40.4168n, 3.7038w"), 40.4168, -3.7038), "letras en minúscula");

/* ---------- Lo que NO son coordenadas ---------- */
const NO = ["", "   ", "Madrid", "Madrid, España", "Calle Mayor 12, Madrid", "Torre Eiffel", "40.4168", "40", "28001", "N", "40°N", "N 40 25", "40 25 N 3 42",
  "120, 3", "40, 200", "-91 5", "40.4168 -3.7038 Madrid", "Madrid 40.4168 -3.7038", "40.4168, -3.7038, 600", "40.4168 N, 41 N", "3.7 W, 4 E", "1 2 3 4", "40..4, 3", "40.4.1 3.7",
  "a, b", "NaN, 3", "Infinity 3", "1e2 3", "40.4168 ,, -3.7038", "40,4168,-3,7038", "https://example.com", "<script>alert(1)</script>"];
for (const t of NO) ok(parse(t) === null, `«${t}» no son coordenadas: ${show(t)}`);
ok(parse("1".repeat(300) + ", 3") === null, "una cadena larguísima, no");
ok(parse(null) === null && parse(undefined) === null, "null y undefined, no");

/* Los números bien formados pero fuera de rango no se «arreglan» cambiando el orden */
ok(parse("-3.7038, 240.4168") === null && parse("140.4168, -3.7038") === null, "fuera de rango: no se da la vuelta sola");
/* Idempotente: lo que devuelve es un par de números finitos */
for (const t of ["40.4168, -3.7038", "40 25 0.5 N, 3 42 13 W"]) { const a = parse(t); ok(Number.isFinite(a.lat) && Number.isFinite(a.lng), "números finitos"); }

if (!process.exitCode) console.log("PLACE COORDINATES TESTS OK");
