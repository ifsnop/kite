const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const fs = require("fs");
const html = fs.readFileSync(HTML_PATH, "utf8");
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const src = script.slice(script.indexOf("const MAX_REPORT_DETAIL"),
                         script.indexOf("async function buildKmlTree"));
const { makeImportReport } = new Function(src + "\nreturn {makeImportReport};")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

// clean import: summary shown, but nothing that needs acknowledging
let r = makeImportReport("bueno.kml");
r.loaded = 12; r.kinds.add("marker"); r.kinds.add("polygon");
ok(r.hasIssues === false, "sin problemas no exige lectura");
ok(r.summary().includes("12 elemento(s) cargado(s)"), "cuenta lo cargado: " + r.summary());
ok(r.summary().includes("tipos: marker, polygon"), "informa de los tipos");
ok(!r.summary().includes("omitido"), "no habla de omisiones si no las hay");

// skipped entities make it sticky
r = makeImportReport("roto.kml");
r.loaded = 5;
r.warn("punto sin coordenadas válidas");
r.warn("punto sin coordenadas válidas");
r.warn("línea con menos de dos puntos válidos");
ok(r.hasIssues === true, "con omisiones exige lectura");
ok(r.skipped === 3, "cuenta las omisiones");
ok(r.summary().includes("3 omitido(s)"), "resume las omisiones: " + r.summary());
ok(r.summary().includes("(×2)"), "agrupa por causa");

// a warning with no lost entity is still worth reading
r = makeImportReport("aviso.kml");
r.loaded = 100;
r.note("prefijos XML sin declarar, corregidos al vuelo: xsi");
ok(r.skipped === 0, "una nota no cuenta como elemento perdido");
ok(r.hasIssues === true, "pero sí exige lectura");
ok(r.summary().includes("xsi"), "la nota aparece en el resumen");

// many distinct causes are summarised, not dumped
r = makeImportReport("muchos.kml");
for (let i = 0; i < 9; i++) r.warn("causa " + i);
const parts = r.summary();
ok((parts.match(/causa \d/g) || []).length === 3, "solo se detallan 3 causas");
ok(parts.includes("6 causa(s) más"), "y se dice cuántas quedan: " + parts);
if (!process.exitCode) console.log("REPORT TESTS OK");
