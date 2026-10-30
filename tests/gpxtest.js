/* Importar GPX (36-gpx-import.js): conversión pura a FeatureCollection.
   La lectura real del XML (parseKmlDocument, que usa querySelector) la
   cubre tests/browser/gpx-import.mjs; aquí un analizador de xmldom. */
const fs = require("fs");
const path = require("path");
const { DOMParser } = require("@xmldom/xmldom");
const { fn, between, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const xmlHelpers = between("/* Nombre sin prefijo", "/* Crea las capas Leaflet de un placemark");
const build = (maxPoints = null) => {
  let region = [constDecl("GPX_NAME_KEYS"), constDecl("GPX_MAX_POINTS"), constDecl("GPX_TEXT_FIELDS"),
    fn("gpxPosition"), fn("gpxTime"), fn("gpxProps"), fn("gpxLine"), fn("gpxToGeoJson")].join("\n");
  if (maxPoints) region = region.replace("const GPX_MAX_POINTS = 2000000;", `const GPX_MAX_POINTS = ${maxPoints};`);
  return new Function("DOMParser", `${xmlHelpers}
${constDecl("MAX_REPORT_DETAIL")}\n${fn("makeImportReport")}
const parseKmlDocument = text => ({ xml: new DOMParser({ onError() {} }).parseFromString(text, "text/xml"), repaired: [] });
${region}
return { gpxToGeoJson, makeImportReport, GPX_NAME_KEYS, getClamped: () => coordClamped };`)(DOMParser);
};
const api = build();
const parse = (text, a = api) => { const report = a.makeImportReport("x.gpx"); return { gj: a.gpxToGeoJson(text, report), report }; };
const throwsMsg = (text, a = api) => { try { parse(text, a); } catch (e) { return e.message; } return null; };

/* ---------- El archivo de ejemplo ---------- */
const { gj, report } = parse(fs.readFileSync(path.join(__dirname, "fixtures", "ruta-sierra.gpx"), "utf8"));
ok(gj.type === "FeatureCollection" && gj.features.length === 4, "2 waypoints + 1 ruta + 1 track: " + gj.features.length);
const byGpx = k => gj.features.filter(f => f.properties.gpx === k);
const [cumbre, refugio] = byGpx("waypoint");
ok(cumbre.geometry.type === "Point" && cumbre.geometry.coordinates.join() === "-3.9507,40.8118,1342.5", "waypoint con altitud como z: " + cumbre.geometry.coordinates);
ok(cumbre.properties.name === "Cumbre & mirador", "el nombre se decodifica");
ok(cumbre.properties.desc === "Vista <b>completa</b> del valle", "la descripción se conserva tal cual (el filtro de etiquetas lo decide addFileNode)");
ok(cumbre.properties.sym === "Summit" && cumbre.properties.type === "Pico", "sym y type");
ok(cumbre.properties.time === "2026-09-12T08:15:00Z", "time del waypoint");
ok(cumbre.properties.link === "https://example.org/cumbre", "link como texto");
ok(refugio.geometry.coordinates.length === 2, "sin <ele> la posición queda en dos elementos, sin inventar 0");
ok(!("time" in refugio.properties) && !("desc" in refugio.properties), "solo lo que el archivo trae");

const route = byGpx("route")[0];
ok(route.geometry.type === "LineString" && route.geometry.coordinates.length === 3 && route.properties.name === "Variante por el collado", "ruta → LineString");
ok(route.geometry.coordinates[1][2] === 1280, "altitud de cada punto de la ruta");

const track = byGpx("track")[0];
ok(track.geometry.type === "MultiLineString" && track.geometry.coordinates.length === 2, "track de dos segmentos → MultiLineString");
ok(track.geometry.coordinates[0].length === 3 && track.geometry.coordinates[1].length === 2, "puntos de cada segmento");
ok(JSON.stringify(track.properties.coordTimes) === JSON.stringify([
  ["2026-09-12T07:00:00Z", "2026-09-12T07:20:00Z", "2026-09-12T08:15:00Z"], [null, "2026-09-12T09:00:00Z"]]),
  "coordTimes alineado con las coordenadas, null donde falta: " + JSON.stringify(track.properties.coordTimes));
ok(!("extensions" in track.properties), "las extensiones del fabricante no se vuelcan");
ok(report.skipped === 0 && !report.hasIssues, "el ejemplo se lee sin avisos");
ok(api.GPX_NAME_KEYS.join() === "name", "el nombre sale de <name>");

/* ---------- Variantes de namespace ---------- */
const v10 = parse(`<gpx version="1.0" xmlns="http://www.topografix.com/GPX/1/0"><wpt lat="1" lon="2"><name>A</name></wpt></gpx>`).gj;
ok(v10.features.length === 1 && v10.features[0].geometry.coordinates.join() === "2,1", "GPX 1.0");
const pref = parse(`<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:wpt lat="1" lon="2"/></g:gpx>`).gj;
ok(pref.features.length === 1, "con prefijo de namespace");
const bare = parse(`<gpx><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk></gpx>`).gj;
ok(bare.features[0].geometry.type === "LineString" && !("coordTimes" in bare.features[0].properties), "un segmento → LineString; sin <time>, sin coordTimes");
const oneSeg = parse(`<gpx><trk><trkseg><trkpt lat="1" lon="1"><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="2" lon="2"/></trkseg></trk></gpx>`).gj;
ok(JSON.stringify(oneSeg.features[0].properties.coordTimes) === '["2026-01-01T00:00:00Z",null]', "un segmento: coordTimes plano");

/* ---------- Entrada hostil o rota ---------- */
const bad = parse(`<gpx>
  <wpt lon="2"/><wpt lat="95" lon="2"/><wpt lat="x" lon="y"/><wpt lat="" lon=""/>
  <wpt lat="10" lon="20"><time>no es una fecha</time><name>ok</name></wpt>
  <rte><rtept lat="1" lon="1"/></rte>
  <trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk>
  <trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="999" lon="1"/><trkpt lat="3" lon="3"/></trkseg><trkseg><trkpt lat="5" lon="5"/></trkseg></trk>
</gpx>`);
ok(bad.gj.features.length === 2, "solo lo válido entra (el waypoint bueno y el track con dos puntos): " + bad.gj.features.length);
ok(bad.gj.features[0].properties.name === "ok" && !("time" in bad.gj.features[0].properties), "una fecha ilegible no se copia");
ok(bad.report.skipped === 6, "4 waypoints, una ruta y un track perdidos se cuentan: " + bad.report.skipped);
ok(bad.report.notes.some(n => /punto\(s\) sin coordenadas/.test(n)) && bad.report.notes.some(n => /segmento\(s\) de menos de dos puntos/.test(n)),
  "lo descartado de dentro de un elemento se anota: " + JSON.stringify(bad.report.notes));

ok(/no es un archivo GPX/.test(throwsMsg(`<kml xmlns="http://www.opengis.net/kml/2.2"/>`)), "otro XML no es un GPX");
ok(/ningún waypoint, ruta ni track/.test(throwsMsg(`<gpx><metadata/></gpx>`)), "un GPX vacío se rechaza con su motivo");
ok(throwsMsg("") !== null && throwsMsg("no es xml") !== null, "texto vacío o suelto: error, no una capa vacía");

/* Redondeo en el borde del rango: se ajusta Y se avisa */
const edge = parse(`<gpx><wpt lat="90.000001" lon="180.000004"/></gpx>`);
ok(edge.gj.features[0].geometry.coordinates.join() === "180,90", "ajustado al límite: " + edge.gj.features[0].geometry.coordinates);
ok(edge.report.notes.some(n => /fuera de rango por redondeo/.test(n)), "el ajuste se comunica, no es en silencio");

/* Cota de puntos */
const capped = build(5);
const many = `<gpx><trk><trkseg>${Array.from({ length: 20 }, (_, i) => `<trkpt lat="${i}" lon="${i}"/>`).join("")}</trkseg></trk></gpx>`;
const c = parse(many, capped);
ok(c.gj.features[0].geometry.coordinates.length === 5, "la cota corta el track en 5 puntos");
ok([...c.report.causes.keys()].some(k => /tope por archivo GPX/.test(k)), "y lo dice");

if (!process.exitCode) console.log("GPX TESTS OK");
