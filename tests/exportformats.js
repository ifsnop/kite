/* Exportar a KML y GeoJSON (35-export-formats.js): funciones puras sobre
   los registros serializados, con ida y vuelta por el importador real. */
const { DOMParser } = require("@xmldom/xmldom");
const { fn, between, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const L = { latLng: (lat, lng) => ({ lat, lng }) };
const prelude = [constDecl("EARTH_R"), constDecl("toRad"), constDecl("toDeg"), fn("destPoint"), fn("arcPoints"),
  fn("normalizePathStyle"), fn("stringifyPropValue")].join("\n");
const region = between("const EXPORT_CIRCLE_SEGMENTS", "/* ---------- Descarga");
const x = new Function("L", `${prelude}\n${region}\n${fn("skippedMessage")}
return { haversineM, geoToFeatures, recordFeatures, exportRoot, simpleStyle, putProp, recordsToGeoJson,
         recordsToKml, xmlEsc, cssToKmlColor, skippedMessage };`)(L);

/* El importador real, para la ida y vuelta */
const coordsSrc = [constDecl("COORD_EPS"), "let coordClamped = 0;", fn("clampDeg"), fn("clampLatLng")].join("\n");
const imp = new Function(between("/* Nombre sin prefijo", "/* Crea las capas Leaflet de un placemark")
  + "\nreturn { elsByTag, text, directChildText, ownVisibility, buildStyleIndex, placemarkStyle, parseCoords, parsePolygon, kmlColor, parseExtendedData };")();
const gj = new Function(coordsSrc + "\n" + fn("geojsonStyle") + "\n"
  + between("const GEOJSON_TYPES = new Set(", "/* Convierte una topología TopoJSON")
  + "\nreturn { geojsonStyle, validGeometry };")();

const parseXml = text => {
  const errors = [];
  const doc = new DOMParser({ onError: (level, msg) => { if (level !== "warning") errors.push(msg); } })
    .parseFromString(text, "text/xml");
  return { doc, errors };
};
const fc = features => ({ type: "FeatureCollection", features });
const feat = (geometry, properties = {}) => ({ type: "Feature", properties, geometry });

const ROOT = "Raíz <&> \"x\"";
const tree = [{
  name: ROOT, checked: true, t: "folder", collapsed: false, children: [
    { name: "Marcador \"A\"", checked: true, t: "layer", style: { color: "#3388ff" },
      mstyle: { icon: "flag", color: "#ff0000", size: 41 }, desc: "<b>hola</b> & adiós",
      geo: fc([feat({ type: "Point", coordinates: [-3.7, 40.4, 650] }, { ref: "A-1", n: 7, name: "orig" })]) },
    { name: "Sub", checked: false, t: "folder", collapsed: true, children: [
      { name: "Línea", checked: true, t: "layer", style: { color: "#00ff00", weight: 5 },
        geo: fc([feat({ type: "LineString", coordinates: [[0, 0], [1, 1], [2, 0]] })]) },
      { name: "Polígono", checked: true, t: "layer",
        style: { color: "#0000ff", weight: 3, fillColor: "#ffff00", fillOpacity: 0.5 },
        geo: fc([feat({ type: "Polygon", coordinates: [
          [[0, 0], [1, 0], [1, 1], [0, 0]], [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.2]]] })]) },
      { name: "Mismo estilo", checked: true, t: "layer", style: { color: "#00ff00", weight: 5 },
        geo: fc([feat({ type: "LineString", coordinates: [[5, 5], [6, 6]] })]) }
    ] },
    { name: "Multi", checked: true, t: "layer", style: { color: "#123456" },
      geo: fc([feat({ type: "Point", coordinates: [1, 1] }), feat({ type: "LineString", coordinates: [[1, 1], [2, 2]] })]) },
    { name: "Ruta", checked: true, t: "measure", mtype: "route", style: { color: "#ff00ff" },
      waypoints: [{ lat: 40, lng: -3 }, { lat: 41, lng: -3 }] },
    { name: "Círculo", checked: true, t: "measure", mtype: "circle", style: { color: "#ff8800" },
      waypoints: [{ lat: 40, lng: -3 }, { lat: 40, lng: -2 }] },
    { name: "Cuadrícula", checked: true, t: "elevGrid", cells: [] },
    { name: "Ortofoto", checked: true, t: "imageOverlay", box: [0, 0, 1, 1], dataUrl: "data:,", opacity: 1 }
  ]
}];

/* ---------- GeoJSON ---------- */
const g = x.recordsToGeoJson(tree);
const out = JSON.parse(g.text);
ok(out.type === "FeatureCollection" && out.name === ROOT, "FeatureCollection con el nombre del nodo exportado");
/* marcador, línea, polígono, mismo estilo, las 2 del multi, ruta y círculo */
ok(g.count === 8 && out.features.length === 8, "8 entidades: " + g.count);
ok(g.skipped.map(s => s.name).join() === "Cuadrícula,Ortofoto", "lo no representable se nombra: " + JSON.stringify(g.skipped));

const byName = n => out.features.filter(f => f.properties.name === n);
const marker = byName("Marcador \"A\"")[0];
ok(marker.geometry.coordinates[2] === 650, "la altitud se conserva");
ok(marker.properties.ref === "A-1" && marker.properties.n === 7, "las properties originales se conservan");
ok(marker.properties.name_orig === "orig", "un `name` distinto del original no lo pisa sin dejar rastro");
ok(marker.properties.description === "<b>hola</b> & adiós", "la ficha va a description");
ok(marker.properties["marker-color"] === "#ff0000" && !("folder" in marker.properties), "marker-color; sin carpeta en el primer nivel");

const line = byName("Línea")[0];
ok(line.properties.folder === "Sub", "la carpeta (relativa al nodo exportado) va en properties.folder");
ok(line.properties.stroke === "#00ff00" && line.properties["stroke-width"] === 5, "estilo de línea en simplestyle");
ok(!("fill" in line.properties), "una línea no lleva relleno");
const poly = byName("Polígono")[0];
ok(poly.properties.fill === "#ffff00" && poly.properties["fill-opacity"] === 0.5, "relleno del polígono");
ok(poly.geometry.coordinates.length === 2, "el agujero del polígono se conserva");

/* Las claves simplestyle son las que lee el importador: ida y vuelta del aspecto */
const back = gj.geojsonStyle(poly.properties);
ok(back.color === "#0000ff" && back.weight === 3 && back.fillColor === "#ffff00" && back.fillOpacity === 0.5,
  "geojsonStyle(exportado) recupera el estilo: " + JSON.stringify(back));
ok(out.features.every(f => gj.validGeometry(JSON.parse(JSON.stringify(f.geometry)))), "toda geometría exportada pasa validGeometry");

/* Mediciones */
const route = byName("Ruta")[0];
ok(route.geometry.type === "LineString" && route.properties.measure === "route", "ruta → LineString");
ok(near(route.properties.length_m, 111195, 100), "longitud de la ruta (1° de meridiano): " + route.properties.length_m);
const circle = byName("Círculo")[0];
const ring = circle.geometry.coordinates[0];
const center = { lat: 40, lng: -3 };
ok(circle.geometry.type === "Polygon" && ring.length === 121, "círculo → polígono de 120 lados");
ok(ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1], "anillo cerrado exacto");
const r = x.haversineM(center, { lat: 40, lng: -2 });
ok(ring.every(([lng, lat]) => near(x.haversineM(center, { lat, lng }), r, r * 1e-3)),
  "cada vértice del círculo está a r del centro (geodésico, ±0,1 %)");
ok(near(circle.properties.radius_m, r, 0.01), "radio en properties");

/* Un nodo suelto (hoja) se exporta tal cual, sin carpeta */
const single = JSON.parse(x.recordsToGeoJson([tree[0].children[0]]).text);
ok(single.name === "Marcador \"A\"" && single.features.length === 1, "una capa suelta: su nombre y su entidad");

/* ---------- KML ---------- */
const k = x.recordsToKml(tree);
const { doc, errors } = parseXml(k.text);
ok(errors.length === 0, "el KML es XML bien formado: " + errors.join("; "));
ok(k.count === 7, "7 Placemark (las dos geometrías de 'Multi' van juntas en una MultiGeometry): " + k.count);
ok(k.skipped.length === 2, "lo no representable se nombra");
ok(imp.text(doc, "name") === ROOT, "el nombre del documento se escapa y se recupera");
const pms = imp.elsByTag(doc, "Placemark");
ok(pms.length === 7, "7 Placemarks en el documento");
ok(imp.elsByTag(doc, "Folder").length === 1, "las carpetas internas son Folder");
const folder = imp.elsByTag(doc, "Folder")[0];
ok(imp.ownVisibility(folder) === false, "una carpeta desmarcada va con <visibility>0");
ok(imp.directChildText(folder, "open") === null, "una carpeta colapsada no lleva <open>");

const idx = imp.buildStyleIndex(doc);
const pmByName = n => pms.find(p => imp.text(p, "name") === n);
const pLine = pmByName("Línea");
const sLine = imp.placemarkStyle(pLine, idx);
ok(sLine.color === "#00ff00" && sLine.weight === 5, "estilo de línea recuperado por el importador: " + JSON.stringify(sLine));
const sPoly = imp.placemarkStyle(pmByName("Polígono"), idx);
ok(sPoly.color === "#0000ff" && sPoly.fillColor === "#ffff00" && near(sPoly.fillOpacity, 0.5, 0.01),
  "estilo de polígono recuperado: " + JSON.stringify(sPoly));
const nStyles = imp.elsByTag(doc, "Style").length;
ok(nStyles === 6, "los estilos iguales se comparten (línea y 'Mismo estilo' un solo Style): " + nStyles);

const pPoint = pmByName("Marcador \"A\"");
ok(imp.text(pPoint, "description") === "<b>hola</b> & adiós", "la ficha HTML se escapa y se recupera como texto");
const pos = imp.parseCoords(imp.text(pPoint, "coordinates"));
ok(pos.length === 1 && pos[0][0] === 40.4 && pos[0][1] === -3.7 && pos[0][2] === 650, "coordenadas y altitud: " + JSON.stringify(pos));
ok(imp.elsByTag(doc, "IconStyle").length === 1, "el color del marcador va en IconStyle");
ok(/<Data name="ref"><value>A-1<\/value>/.test(k.text) && /<Data name="n"><value>7<\/value>/.test(k.text),
  "las properties van a ExtendedData");
/* Y vuelven: el importador lee ExtendedData como properties (siempre texto) */
const back2 = imp.parseExtendedData(pPoint);
ok(back2 && back2.ref === "A-1" && back2.n === "7" && back2.name === "orig", "ida y vuelta de las properties por ExtendedData: " + JSON.stringify(back2));

const pPoly = pmByName("Polígono");
const rings = imp.parsePolygon(imp.elsByTag(pPoly, "Polygon")[0]);
ok(rings && rings.length === 2, "el polígono vuelve con su agujero");
ok(imp.elsByTag(pmByName("Multi"), "MultiGeometry").length === 1, "varias geometrías → MultiGeometry");
ok(imp.ownVisibility(pPoint) === true, "visibilidad por defecto");

/* Colores: aabbggrr */
ok(x.cssToKmlColor("#ff0000") === "ff0000ff", "rojo opaco = ff0000ff");
ok(x.cssToKmlColor("#abc") === "ffccbbaa", "#rgb se expande");
ok(x.cssToKmlColor("#336699", 0.5) === "80996633", "alfa 0,5 = 80");
ok(x.cssToKmlColor("red") === "ffff8833", "un nombre CSS cae al azul por defecto");
ok(imp.kmlColor(x.cssToKmlColor("#12ab34", 1)).color === "#12ab34", "kmlColor deshace cssToKmlColor");

/* Escapes y caracteres de control */
ok(x.xmlEsc("<a href=\"x\">&'") === "&lt;a href=&quot;x&quot;&gt;&amp;&apos;", "xmlEsc");
const dirty = x.recordsToKml([{ name: "Mal\u0001o\u0000", checked: true, t: "layer", style: null,
  geo: fc([feat({ type: "Point", coordinates: [0, 0] })]) }]);
ok(parseXml(dirty.text).errors.length === 0 && !/[\u0000-\u0008]/.test(dirty.text), "se quitan los caracteres de control no válidos en XML 1.0");

/* Entradas hostiles: no lanzan y no inventan geometría */
const junk = [
  { name: "a", checked: true, t: "layer", geo: null },
  { name: "b", checked: true, t: "layer", geo: fc([feat({ type: "Point", coordinates: [NaN, 1] })]) },
  { name: "c", checked: true, t: "measure", mtype: "route", waypoints: [{ lat: 1, lng: 1 }] },
  { name: "d", checked: true, t: "layer", geo: { type: "FeatureCollection", features: "no" } },
  { name: "e", checked: true, t: "folder", collapsed: false, children: [] }
];
const jk = x.recordsToKml(junk), jg = x.recordsToGeoJson(junk);
ok(jk.count === 0 && JSON.parse(jg.text).features.length === 0, "basura: nada que exportar, sin lanzar");

/* Un servicio ArcGIS tiene hijos pero NO es una carpeta: se deja fuera
   entero y se nombra UNA vez (no una por cada capa del catálogo), tanto
   suelto como dentro de una carpeta, y no arrastra a sus vecinos.       */
const svc = { t: "arcgis", name: "Servicio_5", checked: true, collapsed: false, url: "https://x.example.org/rest/services/S/MapServer",
  children: [{ t: "arcgisLayer", name: "TMA", checked: true, id: 1 }, { t: "arcgisLayer", name: "CTR", checked: true, id: 2 }] };
const pin = { name: "Faro", checked: true, t: "layer", style: null, geo: fc([feat({ type: "Point", coordinates: [1, 2] })]) };
for (const [fmt, out] of [["KML", x.recordsToKml([svc])], ["GeoJSON", x.recordsToGeoJson([svc])]]) {
  ok(out.count === 0 && out.skipped.map(s => s.name).join() === "Servicio_5", fmt + ": un servicio suelto se nombra una vez y no exporta nada: " + JSON.stringify(out.skipped));
}
for (const [fmt, out] of [["KML", x.recordsToKml([{ t: "folder", name: "Carpeta", checked: true, collapsed: false, children: [svc, pin] }])],
  ["GeoJSON", x.recordsToGeoJson([{ t: "folder", name: "Carpeta", checked: true, collapsed: false, children: [svc, pin] }])]]) {
  ok(out.count === 1 && out.skipped.map(s => s.name).join() === "Servicio_5", fmt + ": dentro de una carpeta se deja fuera sin tocar a su vecino: " + JSON.stringify(out.skipped) + " " + out.count);
}

/* Mensaje de lo omitido: plural y tope de nombres */
ok(x.skippedMessage([{ name: "A" }], "KML") === "«A» se queda fuera de KML: solo se exportan capas y mediciones.", "singular");
ok(/se quedan fuera de GeoJSON/.test(x.skippedMessage([{ name: "A" }, { name: "B" }], "GeoJSON")), "plural");
const many = Array.from({ length: 7 }, (_, i) => ({ name: "N" + i }));
ok(/«N4» \+2 se quedan/.test(x.skippedMessage(many, "KML")) && !/N5/.test(x.skippedMessage(many, "KML")), "más de cinco: los cinco primeros y +N");

if (!process.exitCode) console.log("EXPORT FORMATS TESTS OK");
