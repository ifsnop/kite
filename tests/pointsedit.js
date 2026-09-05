/* Editor de la lista de puntos de una capa de trazos.

   Formato de intercambio: una línea por punto, campos separados por
   tabulador, con cabecera, y una línea en blanco entre anillos (el
   contorno exterior primero, luego los agujeros). Se eligió así porque
   es lo que una hoja de cálculo pega y copia sin pedir nada, y porque un
   <textarea> aguanta miles de líneas sin construir DOM por punto.     */
const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const fs = require("fs");
const script = fs.readFileSync(HTML_PATH, "utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];
function fn(n) {
  const i = script.indexOf(`function ${n}(`); let d = 0;
  for (let k = script.indexOf("{", i); k < script.length; k++) {
    if (script[k] === "{") d++; else if (script[k] === "}" && --d === 0) return script.slice(i, k + 1);
  }
}
/* clampLatLng valida cada punto, y arrastra COORD_EPS/clampDeg */
const clampSrc = script.slice(script.indexOf("const COORD_EPS ="), script.indexOf("/* Opciones del globo compacto"));
const constsSrc = script.slice(script.indexOf("const POINTS_HEADER"), script.indexOf("/* Anillos de una capa"));
const src = clampSrc + constsSrc +
  [fn("pointsToText"), fn("textToPoints")].join("\n");
const api = new Function(src +
  "\nreturn {pointsToText, textToPoints, POINTS_HEADER};")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const P = (lat, lng, alt) => (alt === undefined ? { lat, lng } : { lat, lng, alt });

/* ---------- Escritura ---------- */
const ring = [P(40.416775, -3.703790), P(41.385064, 2.173404), P(39.469907, -0.376288)];
const text = api.pointsToText([ring]);
const lines = text.split("\n");
ok(lines[0] === api.POINTS_HEADER, "la primera línea es la cabecera: " + JSON.stringify(lines[0]));
ok(lines[1] === "", "una línea en blanco separa la cabecera de los datos");
ok(lines[2] === "40.416775\t-3.703790\t0.000000",
  "campos separados por tabulador, altitud 0 cuando no la hay: " + JSON.stringify(lines[2]));
ok(lines.length === 5, "tres puntos → cinco líneas con cabecera: " + lines.length);
/* La altitud presente se escribe tal cual */
ok(api.pointsToText([[P(40, -3, 650.5)]]).split("\n")[2].endsWith("\t650.500000"),
  "una altitud real se escribe en su columna");

/* ---------- Varios anillos ---------- */
const holes = api.pointsToText([ring, [P(40.1, -3.1), P(40.2, -3.2), P(40.3, -3.3)]]);
ok(holes.split("\n\n").length === 3,
  "cabecera + dos anillos = tres bloques separados por línea en blanco: " + holes.split("\n\n").length);
const backHoles = api.textToPoints(holes);
ok(backHoles.rings.length === 2, "y vuelven a leerse como dos anillos: " + backHoles.rings.length);
ok(backHoles.rings[0].length === 3 && backHoles.rings[1].length === 3, "cada uno con sus tres puntos");

/* ---------- Ida y vuelta ---------- */
const back = api.textToPoints(text);
ok(back.errors.length === 0, "el texto que genera el propio editor se relee sin errores");
ok(back.rings.length === 1 && back.rings[0].length === 3, "un anillo con tres puntos");
ok(Math.abs(back.rings[0][0][0] - 40.416775) < 1e-9 && Math.abs(back.rings[0][0][1] + 3.703790) < 1e-9,
  "latitud y longitud sobreviven en ese orden: " + JSON.stringify(back.rings[0][0]));
/* La altitud 0 que escribe el editor vuelve como 0 explícito: es un
   valor legítimo (nivel del mar) y no debe perderse en el viaje.     */
ok(back.rings[0][0][2] === 0, "la altitud 0 vuelve como tercer elemento: " + JSON.stringify(back.rings[0][0]));

/* ---------- Tolerancia al pegar ---------- */
ok(api.textToPoints("40.4,-3.7,0").rings[0].length === 1, "separación por comas (pegado de un CSV)");
ok(api.textToPoints("40.4 -3.7").rings[0].length === 1, "separación por espacios");
ok(api.textToPoints("40.4;-3.7").rings[0].length === 1, "separación por punto y coma");
ok(api.textToPoints("Lat\tLon\tAlt\n40.4\t-3.7\t0").rings[0].length === 1,
  "la cabecera se ignora al pegar");
/* Pegar dos veces deja una cabecera en medio: tampoco debe contar */
const twice = api.textToPoints("40.4\t-3.7\nLat\tLon\tAlt\n41.4\t-3.8");
ok(twice.errors.length === 0 && twice.rings.length === 1 && twice.rings[0].length === 2,
  "una cabecera repetida en medio no rompe ni parte el anillo");
/* Líneas en blanco al principio y al final no crean anillos vacíos */
const padded = api.textToPoints("\n\n40.4\t-3.7\n41.4\t-3.8\n\n\n");
ok(padded.rings.length === 1 && padded.rings[0].length === 2,
  "las líneas en blanco de los extremos no crean anillos vacíos: " + padded.rings.length);

/* ---------- Errores ---------- */
const bad = api.textToPoints("40.4\t-3.7\nesto no vale\n41.4\t-3.8\n32400\t-2");
ok(bad.errors.length === 2, "dos líneas inválidas detectadas: " + bad.errors.length);
ok(bad.errors[0].line === 2, "se reporta el número de línea real: " + bad.errors[0].line);
/* Una línea de texto suelto falla por lat/lon, no por la altitud: decir
   "altitud no numérica" mandaría a mirar la columna equivocada.       */
ok(/latitud o longitud no num/.test(bad.errors[0].why),
  "el texto basura se achaca a lat/lon, no a la altitud: " + JSON.stringify(bad.errors[0].why));
ok(bad.errors[1].line === 4 && /rango/.test(bad.errors[1].why),
  "una latitud imposible se rechaza por rango: " + JSON.stringify(bad.errors[1]));
ok(bad.rings[0].length === 2, "los puntos válidos se conservan pese a los errores");
ok(api.textToPoints("40.4\t-3.7\tarriba").errors.length === 1, "altitud no numérica es un error");
ok(api.textToPoints("").rings.length === 0, "texto vacío no da ningún anillo");

/* ---------- Tamaño objetivo ---------- */
const big = [];
for (let i = 0; i < 1000; i++) big.push(P(40 + i / 10000, -3 + i / 10000));
const bigText = api.pointsToText([big]);
const bigBack = api.textToPoints(bigText);
ok(bigBack.rings[0].length === 1000, "1000 puntos sobreviven la ida y vuelta: " + bigBack.rings[0].length);
ok(bigBack.errors.length === 0, "sin errores en la lista grande");

if (!process.exitCode) console.log("POINTS EDITOR TESTS OK");
