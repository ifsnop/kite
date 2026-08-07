const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const { DOMParser } = require("@xmldom/xmldom");
const fs = require("fs");
const html = fs.readFileSync(HTML_PATH, "utf8");
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const src = script.slice(script.indexOf("/* Nombre sin prefijo"),
                         script.indexOf("/* Crea las capas Leaflet de un placemark"));
const api = new Function(src + "\nreturn {elsByTag, text, directChildText, ownVisibility, buildStyleIndex, placemarkStyle, kmlColor, parseCoords, parsePolygon};")();
const { elsByTag, text, directChildText, ownVisibility, buildStyleIndex, placemarkStyle, kmlColor, parsePolygon } = api;

/* geojsonStyle / normalizePathStyle / polygonModeOf viven fuera del rango
   extraído arriba (que se corta antes de "Crea las capas Leaflet"), así
   que se sacan por nombre con el mismo emparejador de llaves que usan
   otras suites (ver tests/newfeat.js). Las tres son autónomas: no llaman
   a nada fuera de sí mismas. */
function extractFn(name) {
  const i = script.indexOf(`function ${name}(`);
  let d = 0;
  for (let k = script.indexOf("{", i); k < script.length; k++) {
    if (script[k] === "{") d++;
    else if (script[k] === "}" && --d === 0) return script.slice(i, k + 1);
  }
}
const styleApi = new Function(
  extractFn("geojsonStyle") + extractFn("normalizePathStyle") + extractFn("polygonModeOf") +
  "\nreturn { geojsonStyle, normalizePathStyle, polygonModeOf };"
)();
const { geojsonStyle, normalizePathStyle, polygonModeOf } = styleApi;

const kml = `<?xml version="1.0"?>
<kml:kml xmlns:kml="http://www.opengis.net/kml/2.2">
 <kml:Document>
  <kml:Style id="base"><kml:LineStyle><kml:color>ff0000ff</kml:color><kml:width>4</kml:width></kml:LineStyle></kml:Style>
  <kml:StyleMap id="mapa"><kml:Pair><kml:key>normal</kml:key><kml:styleUrl>#base</kml:styleUrl></kml:Pair></kml:StyleMap>
  <kml:StyleMap id="cadena"><kml:Pair><kml:key>normal</kml:key><kml:styleUrl>#mapa</kml:styleUrl></kml:Pair></kml:StyleMap>
  <kml:StyleMap id="ciclo"><kml:Pair><kml:key>normal</kml:key><kml:styleUrl>#ciclo2</kml:styleUrl></kml:Pair></kml:StyleMap>
  <kml:StyleMap id="ciclo2"><kml:Pair><kml:key>normal</kml:key><kml:styleUrl>#ciclo</kml:styleUrl></kml:Pair></kml:StyleMap>
  <kml:StyleMap id="fuera"><kml:Pair><kml:key>normal</kml:key><kml:styleUrl>otro.kml#x</kml:styleUrl></kml:Pair></kml:StyleMap>
  <kml:Folder><kml:name>Carpeta</kml:name><kml:open>1</kml:open>
    <kml:Placemark><kml:name>P1</kml:name><kml:styleUrl>#cadena</kml:styleUrl>
      <kml:Point><kml:coordinates>-3.7,40.4,0</kml:coordinates></kml:Point></kml:Placemark>
    <kml:Placemark><kml:name>Oculto</kml:name><kml:visibility>0</kml:visibility>
      <kml:Point><kml:coordinates>0,0</kml:coordinates></kml:Point></kml:Placemark>
    <kml:Placemark><kml:name>Poly</kml:name><kml:Polygon>
      <kml:outerBoundaryIs><kml:LinearRing><kml:coordinates>0,0 1,0 1,1 0,0</kml:coordinates></kml:LinearRing></kml:outerBoundaryIs>
      <kml:innerBoundaryIs><kml:LinearRing><kml:coordinates>0.2,0.2 0.4,0.2 0.4,0.4 0.2,0.2</kml:coordinates></kml:LinearRing></kml:innerBoundaryIs>
      </kml:Polygon></kml:Placemark>
 </kml:Folder>
 </kml:Document>
</kml:kml>`;
const doc = new DOMParser().parseFromString(kml, "text/xml");
const ok = (c,m) => { if(!c){ console.error("FAIL: "+m); process.exitCode=1; } };

ok(elsByTag(doc, "Placemark").length === 3, "prefixed Placemarks: " + elsByTag(doc,"Placemark").length);
ok(text(doc, "name") === "Carpeta", "prefixed <name>: " + text(doc,"name"));
ok(directChildText(elsByTag(doc,"Folder")[0], "open") === "1", "direct child through prefix");
ok(ownVisibility(elsByTag(doc,"Placemark")[0]) === true, "default visibility");
ok(ownVisibility(elsByTag(doc,"Placemark")[1]) === false, "visibility 0");

const idx = buildStyleIndex(doc);
ok(idx.resolve("#base").color === "#ff0000", "direct style");
ok(idx.resolve("#mapa").weight === 4, "StyleMap -> Style");
ok(idx.resolve("#cadena").color === "#ff0000", "chained StyleMap -> StyleMap -> Style");
ok(idx.resolve("#ciclo") === null, "cycle terminates");
ok(idx.resolve("otro.kml#x") === null, "external ref unresolved");
ok(idx.externalRefs >= 1, "external refs counted: " + idx.externalRefs);
ok(idx.resolve(null) === null, "missing styleUrl safe");

const st = placemarkStyle(elsByTag(doc,"Placemark")[0], idx);
ok(st.color === "#ff0000" && st.weight === 4 && st.fillOpacity === 0.35, "effective style: " + JSON.stringify(st));

/* <outline>0</outline> / <fill>0</fill>: polígonos sin contorno o sin
   relleno, la traducción a los booleanos que consume el diálogo.       */
const outlineKml = `<kml><Document><Style id="noOutline"><PolyStyle><outline>0</outline></PolyStyle></Style>
  <Placemark><styleUrl>#noOutline</styleUrl><Polygon><outerBoundaryIs><LinearRing>
  <coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  </Document></kml>`;
const outlineDoc = new DOMParser().parseFromString(outlineKml, "text/xml");
const outlineIdx = buildStyleIndex(outlineDoc);
const noOutlineStyle = placemarkStyle(elsByTag(outlineDoc, "Placemark")[0], outlineIdx);
ok(noOutlineStyle.stroke === false, "outline 0 -> stroke false: " + JSON.stringify(noOutlineStyle));

const noFillKml = `<kml><Document><Style id="noFill"><PolyStyle><fill>0</fill></PolyStyle></Style>
  <Placemark><styleUrl>#noFill</styleUrl><Polygon><outerBoundaryIs><LinearRing>
  <coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  </Document></kml>`;
const noFillDoc = new DOMParser().parseFromString(noFillKml, "text/xml");
const noFillIdx = buildStyleIndex(noFillDoc);
const noFillStyle = placemarkStyle(elsByTag(noFillDoc, "Placemark")[0], noFillIdx);
ok(noFillStyle.fill === false && noFillStyle.fillOpacity === 0, "fill 0 -> fill false: " + JSON.stringify(noFillStyle));

const rings = parsePolygon(elsByTag(doc,"Polygon")[0]);
ok(rings && rings.length === 2 && rings[0].length === 4, "polygon with hole");
ok(rings[0][1][0] === 0 && rings[0][1][1] === 1, "ring stored as [lat,lon]");
ok(kmlColor("ff0000ff").color === "#ff0000", "aabbggrr order");
ok(kmlColor("zzz") === null, "invalid colour rejected");
if (!process.exitCode) console.log("KML PARSER TESTS OK");

/* Segunda pasada: el MISMO KML sin namespaces y con prefijos literales,
   para comprobar que el parser no depende de la vía de namespaces */
const plain = kml.replace(/kml:/g, "").replace(/ xmlns="[^"]*"/g, "");
const doc2 = new DOMParser().parseFromString(plain, "text/xml");
ok(elsByTag(doc2, "Placemark").length === 3, "sin namespaces: placemarks");
ok(placemarkStyle(elsByTag(doc2,"Placemark")[0], buildStyleIndex(doc2)).color === "#ff0000", "sin namespaces: estilos");

/* Y con un namespace por defecto (el caso más común de KML real) */
const defaultNs = kml.replace(/kml:/g, "").replace("<kml ", '<kml xmlns="http://www.opengis.net/kml/2.2" ');
const doc3 = new DOMParser().parseFromString(defaultNs.replace("<kml>", '<kml xmlns="http://www.opengis.net/kml/2.2">'), "text/xml");
ok(elsByTag(doc3, "Placemark").length === 3, "namespace por defecto: placemarks");
ok(directChildText(elsByTag(doc3,"Folder")[0], "open") === "1", "namespace por defecto: hijo directo");
if (!process.exitCode) console.log("NAMESPACE VARIANTS OK");

/* ---- geojsonStyle: stroke-opacity/fill-opacity a 0 son "sin contorno"
   / "sin relleno", igual que <outline>0</outline>/<fill>0</fill> en KML */
ok(geojsonStyle({ "stroke-opacity": 0 }).stroke === false, "stroke-opacity 0 -> stroke false");
ok(geojsonStyle({ "fill-opacity": 0 }).fill === false, "fill-opacity 0 -> fill false");
const plainGeo = geojsonStyle({});
ok(plainGeo.stroke === undefined && plainGeo.fill === undefined, "sin señal: stroke/fill sin definir: " + JSON.stringify(plainGeo));

/* ---- normalizePathStyle: valores por defecto concretos para el diálogo ---- */
ok(normalizePathStyle({}).stroke === true, "sin stroke -> por defecto true (contorno)");
ok(normalizePathStyle({ stroke: false }).stroke === false, "stroke false se conserva");
ok(normalizePathStyle({}).fill === true, "sin fill -> por defecto true (relleno)");

/* ---- polygonModeOf: traducción de los dos booleanos al selector único ---- */
ok(polygonModeOf({ stroke: false, fill: true }) === "fill", "solo relleno");
ok(polygonModeOf({ stroke: true, fill: false }) === "stroke", "solo contorno");
ok(polygonModeOf({ stroke: true, fill: true }) === "both", "contorno y relleno");
ok(polygonModeOf({ stroke: false, fill: false }) === "fill", "caso defensivo (ambos false) cae a relleno");
if (!process.exitCode) console.log("POLYGON STROKE/FILL TESTS OK");
