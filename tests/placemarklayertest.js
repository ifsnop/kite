const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const { DOMParser } = require("@xmldom/xmldom");
const fs = require("fs");
const html = fs.readFileSync(HTML_PATH, "utf8");
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];

/* Same source window as kmltest.js, widened past buildPlacemarkLayer's own
   closing brace (kmltest.js stops right before it, since it only needs
   the helpers this file exercises directly). escapeHtml lives far below
   (used only for the popup label of a NAMED, successfully built
   placemark) and is pulled in separately.                              */
const src = script.slice(script.indexOf("/* Nombre sin prefijo"),
                         script.indexOf("/* Maps a file extension to the MIME type"));
const escapeHtmlSrc = script.slice(script.indexOf("const escapeHtml = s =>"),
                                   script.indexOf("/* Leaflet layer behind a tree node"));

/* Minimal Leaflet stand-in: buildPlacemarkLayer only needs constructors
   that return a truthy object and, for the group, a bindPopup it can call
   when the placemark has a <name>.                                     */
const L = {
  polygon: () => ({ kind: "polygon" }),
  polyline: () => ({ kind: "polyline" }),
  marker: () => ({ kind: "marker" }),
  featureGroup: (layers) => ({ kind: "group", layers, bindPopup() {} }),
};

const { buildPlacemarkLayer } = new Function("L", escapeHtmlSrc + "\n" + src +
  "\nreturn { buildPlacemarkLayer };")(L);

const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

function placemarkFrom(xml) {
  const doc = new DOMParser().parseFromString(`<kml><Document>${xml}</Document></kml>`, "text/xml");
  return doc.getElementsByTagName("Placemark")[0];
}
function fakeReport() {
  return { warns: [], warn(w) { this.warns.push(w); } };
}

/* Regression for the bug found via live QA (2026-08-26): a Placemark whose
   only geometry is entirely unusable was counted as TWO omitted entities
   in the import summary — once from buildPlacemarkLayer's own specific
   reason, once more from buildKmlRecords' generic fallback message, since
   both fired for the exact same lost Placemark. */
{
  const pm = placemarkFrom(
    "<Placemark><name>Roto</name><Point><coordinates></coordinates></Point></Placemark>"
  );
  const report = fakeReport();
  const { group, reported } = buildPlacemarkLayer(pm, {}, report);
  ok(group === null, "una geometría enteramente inválida no produce capa");
  ok(reported === true, "buildPlacemarkLayer avisa por su cuenta de la causa concreta");
  ok(report.warns.length === 1, "una sola causa registrada, no una por cada intento: " + JSON.stringify(report.warns));
  ok(report.warns[0] === "punto sin coordenadas válidas", "mensaje específico conservado: " + report.warns[0]);
  // Mirrors buildKmlRecords' caller-side guard: with `reported` true, the
  // generic "sin geometría utilizable" fallback must NOT fire again.
  if (!reported && report) report.warn(`«Roto» sin geometría utilizable`);
  ok(report.warns.length === 1, "el llamador no debe duplicar el aviso cuando ya hubo uno: " + JSON.stringify(report.warns));
}

/* A Placemark with no geometry element at all never calls fail() itself
   (nothing to fail at), so `reported` must stay false — that's the ONE
   case where the caller's generic fallback is the only signal and must
   still fire exactly once. */
{
  const pm = placemarkFrom("<Placemark><name>SinGeometria</name></Placemark>");
  const report = fakeReport();
  const { group, reported } = buildPlacemarkLayer(pm, {}, report);
  ok(group === null, "sin ninguna geometría reconocida no produce capa");
  ok(reported === false, "sin intentos fallidos que contar, reported queda en false");
  ok(report.warns.length === 0, "buildPlacemarkLayer no inventa un aviso genérico por su cuenta");
  if (!reported && report) report.warn(`«SinGeometria» sin geometría utilizable`);
  ok(report.warns.length === 1 && report.warns[0].includes("sin geometría utilizable"),
     "el llamador SÍ debe avisar una vez en este caso: " + JSON.stringify(report.warns));
}

/* Sanity check: the { group, reported } shape doesn't break the ordinary
   success path (a single valid Point). */
{
  const pm = placemarkFrom(
    "<Placemark><name>Bueno</name><Point><coordinates>-3.7,40.4,0</coordinates></Point></Placemark>"
  );
  const report = fakeReport();
  const { group, reported } = buildPlacemarkLayer(pm, {}, report);
  ok(group !== null && group.kind === "group", "una geometría válida sí produce capa");
  ok(reported === false, "sin fallos, reported es false");
  ok(report.warns.length === 0, "ningún aviso para un placemark válido");
}

if (!process.exitCode) console.log("PLACEMARK LAYER REPORT TESTS OK");
