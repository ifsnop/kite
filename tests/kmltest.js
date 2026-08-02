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
