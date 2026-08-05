const path = require("path");
const fs = require("fs");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const script = fs.readFileSync(HTML_PATH, "utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];
function fn(name) {
  const i = script.indexOf(`function ${name}(`);
  let d = 0;
  for (let k = script.indexOf("{", i); k < script.length; k++) {
    if (script[k] === "{") d++;
    else if (script[k] === "}" && --d === 0) return script.slice(i, k + 1);
  }
}
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const api = new Function(
  fn("dmsParts") + "\n" +
  fn("formatCoord") + "\n" +
  fn("formatCoordCompactHtml") + "\n" +
  fn("parseCoord") + "\n" +
  "return { dmsParts, formatCoord, formatCoordCompactHtml, parseCoord };"
)();

/* ---- formatCoord: decimal degrees and spaced GMS (editable dialog fields) ---- */
ok(api.formatCoord(40.416775, true, "dec") === "40.416775",
   "grados decimales: " + api.formatCoord(40.416775, true, "dec"));
ok(api.formatCoord(40.5, true, "dms") === "40° 30' 00.00\" N",
   "GMS con espacios de separación: " + api.formatCoord(40.5, true, "dms"));
ok(api.formatCoord(-3.70379, false, "dms") === "3° 42' 13.64\" W",
   "hemisferio W para longitud negativa: " + api.formatCoord(-3.70379, false, "dms"));
ok(api.formatCoord(0.5, true, "dms").endsWith(" N"), "0.5° de latitud es N, no S");

/* ---- formatCoordCompactHtml: same digits, no spaces, degrees in bold
   (used only by the read-only coordinate readout of the viewer) ---- */
ok(api.formatCoordCompactHtml(40.5, true) === "<b>40°</b>30'00.00\"N",
   "sin espacios y grados en negrita: " + api.formatCoordCompactHtml(40.5, true));
ok(api.formatCoordCompactHtml(-3.70379, false) === "<b>3°</b>42'13.64\"W",
   "misma cifra que formatCoord pero compacta: " + api.formatCoordCompactHtml(-3.70379, false));
ok(!api.formatCoordCompactHtml(40.5, true).includes(" "),
   "no debe quedar ningún espacio de separación en la versión compacta");
ok(api.formatCoordCompactHtml(89.999999, true) === "<b>90°</b>00'00.00\"N",
   "el acarreo de segundos/minutos que sube a grados también se compacta bien");
ok(api.formatCoordCompactHtml(NaN, true) === "", "un valor no finito no produce HTML roto");

/* ---- parseCoord: acepta lo que formatCoord acaba de escribir ---- */
ok(Math.abs(api.parseCoord(api.formatCoord(40.416775, true, "dec"), true) - 40.416775) < 1e-6,
   "ida y vuelta en grados decimales");
ok(Math.abs(api.parseCoord(api.formatCoord(-3.70379, false, "dms"), false) - (-3.70379)) < 1e-4,
   "ida y vuelta en grados/minutos/segundos");

if (!process.exitCode) console.log("COORDINATE FORMAT TESTS OK");
