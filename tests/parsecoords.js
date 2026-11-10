/* parseCoords (20-kml-geom.js) se reescribió a una sola pasada, sin
   `trim().split(/\s+/)` ni `split(",")` por tupla: 2,9 s de un KML real de
   309 MB. Tiene que dar EXACTAMENTE lo de siempre, así que aquí va la
   implementación anterior copiada y se compara con entradas aleatorias y
   las hostiles. También: que `isSpaceCode` es `\s` carácter a carácter y que
   una tupla sin comas en un texto enorme no es cuadrática.                 */
const { between } = require("./_extract");

const src = between("/* ---------- Coordenadas: rango con tolerancia", '/* "lon,lat[,alt] lon,lat…"')
  + between("function isSpaceCode(c)", "/* Un <Polygon> KML");
const api = new Function(src + "\nreturn { isSpaceCode, parseCoords, clampLatLng, counter: () => coordClamped, reset: () => { coordClamped = 0; } };")();

/* La implementación ANTERIOR, tal cual estaba */
const oldApi = new Function(between("/* ---------- Coordenadas: rango con tolerancia", '/* "lon,lat[,alt] lon,lat…"') + `
function parseCoordsOld(str) {
  const out = [];
  let skipped = 0;
  for (const tuple of String(str).trim().split(/\\s+/)) {
    if (!tuple) continue;
    const parts = tuple.split(",");
    if (parts.length < 2) { skipped++; continue; }
    const pair = clampLatLng(Number(parts[1]), Number(parts[0]),
      parts.length > 2 ? Number(parts[2]) : undefined);
    if (!pair) { skipped++; continue; }
    out.push(pair);
  }
  out.skipped = skipped;
  return out;
}
return { parseCoordsOld, counter: () => coordClamped, reset: () => { coordClamped = 0; } };`)();

const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* ---- isSpaceCode == /\s/ en TODOS los puntos de código BMP ---- */
const re = /\s/;
let wrong = [];
for (let c = 0; c < 65536; c++) if (api.isSpaceCode(c) !== re.test(String.fromCharCode(c))) wrong.push(c.toString(16));
ok(!wrong.length, "isSpaceCode coincide con \\s en los 65 536 códigos; difieren: " + wrong.slice(0, 8).join(","));

/* ---- mismas entradas, mismo resultado (incluidos .skipped y los ajustes de rango) ---- */
function run(str) {
  api.reset(); oldApi.reset();
  const a = api.parseCoords(str), b = oldApi.parseCoordsOld(str);
  return { a, b, same: JSON.stringify(a) === JSON.stringify(b) && a.skipped === b.skipped && api.counter() === oldApi.counter() };
}
const fixed = [
  "", "   ", "\n\t ", "1,2", "1,2,3", "1,2,3,4", "1,2,3,4,5", "1,", ",2", ",", ",,", ",,,", "a,b", "1,b", "a,2",
  "1,2 3,4\n5,6,7\t8,9", "  1,2  ", "1,2 3,4", "1,2 3,4﻿5,6", "1 2 3", "1,2,", "1,2,,", "1,2,3,",
  "180.00000044,90.00000044", "-180.00000044,-90.00000044", "181,0", "0,91", "0,32400", "Infinity,1", "1,-Infinity",
  "1e3,2e-3", "0x10,0b1", "  -3.5,40.1,650 \n -3.4,40.2,0 ", "1,2 ,3,4  5,6", "NaN,1", "1,NaN", "1,2,NaN", "1,2,abc",
  "-5.687986999999999,37.332986,0 -5.687935,37.324659,0"
];
for (const s of fixed) { const r = run(s); ok(r.same, "entrada fija " + JSON.stringify(s) + ": " + JSON.stringify(r.a) + " vs " + JSON.stringify(r.b)); }

let seed = 123456789;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const alphabet = ["0", "1", "2", "5", "9", ".", "-", "+", ",", ",", ",", " ", " ", "\t", "\n", "\r", " ", " ", "﻿", "e", "x", "a", "180", "90", "-0", "1e2"];
let bad = 0;
for (let i = 0; i < 40000; i++) {
  let s = ""; const n = Math.floor(rnd() * 24);
  for (let j = 0; j < n; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
  const r = run(s);
  if (!r.same && bad++ < 5) ok(false, "aleatoria " + JSON.stringify(s) + ": " + JSON.stringify(r.a) + " vs " + JSON.stringify(r.b));
}
ok(bad === 0, "40 000 cadenas aleatorias: " + bad + " difieren");

/* ---- un anillo realista, de varios miles de vértices ---- */
let ring = "\n\t\t\t";
for (let i = 0; i < 5000; i++) ring += `${(-5 + rnd()).toFixed(15)},${(37 + rnd()).toFixed(15)},0 `;
const rr = run(ring);
ok(rr.same && rr.a.length === 5000, "un anillo de 5 000 vértices con 15 decimales");

/* ---- no es cuadrático con una tupla sin comas en un texto enorme (nada de indexOf sobre todo el texto) ---- */
const huge = ("x ").repeat(400000) + "1,2";
let t0 = Date.now();
const h = api.parseCoords(huge);
const dt = Date.now() - t0;
ok(h.length === 1 && h.skipped === 400000 && dt < 1500, "800 000 caracteres de tuplas sin coma: " + dt + " ms, " + h.skipped + " descartadas");

if (!process.exitCode) console.log("PARSE COORDS TESTS OK");
