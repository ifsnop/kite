const { DOMParser } = require("@xmldom/xmldom");
const { fn, between, constDecl } = require("./_extract");
const src = between("/* Nombre sin prefijo", "/* Crea las capas Leaflet de un placemark");
/* LEAFLET_PIN, NO_ICON and DEFAULT_MARKER_STYLE live in 41-selection.js and are only read when the
   marker functions RUN, so the suite brings them from the delivered file. */
const api = new Function(constDecl("LEAFLET_PIN") + constDecl("NO_ICON") + constDecl("DEFAULT_MARKER_STYLE")
  + src + "\nreturn {elsByTag, text, directChildText, ownVisibility, buildStyleIndex, placemarkStyle, kmlColor, parseCoords, parsePolygon,"
  + " parseMarkerStyleElement, placemarkMarkerStyle, kmlIconName, kmlMarkerToMstyle, DEFAULT_MARKER_STYLE};")();
const { elsByTag, text, directChildText, ownVisibility, buildStyleIndex, placemarkStyle, kmlColor, parsePolygon,
  parseMarkerStyleElement, placemarkMarkerStyle, kmlIconName, kmlMarkerToMstyle, DEFAULT_MARKER_STYLE } = api;

/* geojsonStyle / normalizePathStyle / polygonModeOf viven fuera del rango
   extraído arriba (que se corta antes de "Crea las capas Leaflet"), así
   que se sacan por nombre. Las tres son autónomas: no llaman a nada
   fuera de sí mismas. */
const styleApi = new Function(
  fn("geojsonStyle") + fn("normalizePathStyle") + fn("polygonModeOf") +
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
/* stroke ya no se toca aquí: <PolyStyle><outline> solo tiene efecto
   sobre un polígono real, y buildPlacemarkLayer (fuera del rango que
   extrae este test) es quien decide si aplica — ver placemarklayertest.js */
ok(noOutlineStyle.polyOutline === false, "outline 0 -> polyOutline false: " + JSON.stringify(noOutlineStyle));

const noFillKml = `<kml><Document><Style id="noFill"><PolyStyle><fill>0</fill></PolyStyle></Style>
  <Placemark><styleUrl>#noFill</styleUrl><Polygon><outerBoundaryIs><LinearRing>
  <coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  </Document></kml>`;
const noFillDoc = new DOMParser().parseFromString(noFillKml, "text/xml");
const noFillIdx = buildStyleIndex(noFillDoc);
const noFillStyle = placemarkStyle(elsByTag(noFillDoc, "Placemark")[0], noFillIdx);
ok(noFillStyle.fill === false && noFillStyle.fillOpacity === 0, "fill 0 -> fill false: " + JSON.stringify(noFillStyle));

/* <LineStyle><width>0</width></LineStyle>: contorno declarado pero de
   grosor 0, que a todos los efectos es "sin contorno" (un lineWidth 0 de
   canvas no deja de dibujarse solo por poner weight:0). */
const zeroWidthKml = `<kml><Document><Style id="zeroWidth"><LineStyle><width>0</width></LineStyle></Style>
  <Placemark><styleUrl>#zeroWidth</styleUrl><Polygon><outerBoundaryIs><LinearRing>
  <coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  </Document></kml>`;
const zeroWidthDoc = new DOMParser().parseFromString(zeroWidthKml, "text/xml");
const zeroWidthIdx = buildStyleIndex(zeroWidthDoc);
const zeroWidthStyle = placemarkStyle(elsByTag(zeroWidthDoc, "Placemark")[0], zeroWidthIdx);
ok(zeroWidthStyle.stroke === false, "width 0 -> stroke false: " + JSON.stringify(zeroWidthStyle));

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
ok(geojsonStyle({ "stroke-width": 0 }).stroke === false, "stroke-width 0 -> stroke false");
const plainGeo = geojsonStyle({});
ok(plainGeo.stroke === undefined && plainGeo.fill === undefined, "sin señal: stroke/fill sin definir: " + JSON.stringify(plainGeo));

/* ---- normalizePathStyle: valores por defecto concretos para el diálogo ---- */
ok(normalizePathStyle({}).stroke === true, "sin stroke -> por defecto true (contorno)");
ok(normalizePathStyle({ stroke: false }).stroke === false, "stroke false se conserva");
ok(normalizePathStyle({}).fill === true, "sin fill -> por defecto true (relleno)");
/* Opacidad del contorno: editable, 1 si falta o no es válida */
ok(normalizePathStyle({}).opacity === 1, "sin opacity -> contorno opaco");
ok(normalizePathStyle({ opacity: 0.4 }).opacity === 0.4, "opacity del contorno se conserva");
ok(normalizePathStyle({ opacity: 7 }).opacity === 1 && normalizePathStyle({ opacity: "x" }).opacity === 1,
  "opacity fuera de [0,1] o no numérica -> 1");

/* ---- polygonModeOf: traducción de los dos booleanos al selector único ---- */
ok(polygonModeOf({ stroke: false, fill: true }) === "fill", "solo relleno");
ok(polygonModeOf({ stroke: true, fill: false }) === "stroke", "solo contorno");
ok(polygonModeOf({ stroke: true, fill: true }) === "both", "contorno y relleno");
ok(polygonModeOf({ stroke: false, fill: false }) === "none", "ni contorno ni relleno: «Ninguno» (solo queda el nombre)");
ok(polygonModeOf({}) === "both" && polygonModeOf({ stroke: true }) === "both", "sin booleanos, o con el contorno solo, el de siempre");
if (!process.exitCode) console.log("POLYGON STROKE/FILL TESTS OK");

{ /* its own scope: the names above (plain, sample…) are taken */
/* ---- Marker style: IconStyle / LabelStyle -> mstyle ---- */
const markerKml = body => new DOMParser().parseFromString(
  `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`, "text/xml");
const pmOf = (doc, name) => elsByTag(doc, "Placemark").find(p => text(p, "name") === name);

/* The sample that was reported: a StyleMap whose "normal" Style is a green half-size dot, label scale 0 */
const sample = markerKml(`
  <StyleMap id="error_75"><Pair><key>normal</key><styleUrl>#error_75_normal</styleUrl></Pair>
    <Pair><key>highlight</key><styleUrl>#error_75_highlight</styleUrl></Pair></StyleMap>
  <Style id="error_75_normal"><IconStyle><color>ff00ff00</color><scale>0.5</scale>
    <Icon><href>http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon></IconStyle>
    <LabelStyle><scale>0</scale></LabelStyle></Style>
  <Style id="error_75_highlight"><IconStyle><hotSpot x="20" y="2" xunits="pixels" yunits="pixels"/>
    <Icon><href>http://maps.google.com/mapfiles/kml/pushpin/grn-pushpin.png</href></Icon></IconStyle></Style>
  <Placemark><name>A</name><styleUrl>#error_75</styleUrl><Point><coordinates>-3.7,40.4</coordinates></Point></Placemark>`);
const sIdx = buildStyleIndex(sample);
const unknown = new Set();
const sm = kmlMarkerToMstyle(placemarkMarkerStyle(pmOf(sample, "A"), sIdx), unknown);
ok(sm && sm.icon === "circle" && sm.color === "#00ff00", "StyleMap -> normal: shaded_dot is a circle, KML ff00ff00 (aabbggrr) is #00ff00: " + JSON.stringify(sm));
ok(sm.size === 21, "scale 0.5 -> round(0.5 x 41) = 21 px: " + sm.size);
ok(sm.textAlways === false, "LabelStyle scale 0: the name is not permanent");
ok(unknown.size === 0, "a recognised shape is not reported: " + [...unknown]);
ok(sIdx.externalRefs === 0, "resolving marker styles counts no external reference");
ok(placemarkStyle(pmOf(sample, "A"), sIdx).color === "#3388ff", "the path style of that placemark is untouched (defaults)");

/* No IconStyle/LabelStyle -> null: the marker keeps the default pin */
const plain = markerKml(`<Style id="l"><LineStyle><color>ff0000ff</color></LineStyle></Style>
  <Placemark><name>B</name><styleUrl>#l</styleUrl><Point><coordinates>1,1</coordinates></Point></Placemark>
  <Placemark><name>C</name><Point><coordinates>1,1</coordinates></Point></Placemark>`);
const pIdx = buildStyleIndex(plain);
ok(placemarkMarkerStyle(pmOf(plain, "B"), pIdx) === null && placemarkMarkerStyle(pmOf(plain, "C"), pIdx) === null,
  "a style with only LineStyle, or none at all, says nothing about the marker");
ok(kmlMarkerToMstyle(null, null) === null, "no marker style -> no mstyle (default pin)");
ok(placemarkStyle(pmOf(plain, "B"), pIdx).color === "#ff0000", "and the line colour still resolves as before");

/* Inline <Style> over a shared one, field by field */
const mix = markerKml(`<Style id="s"><IconStyle><color>ff0000ff</color><scale>2</scale>
    <Icon><href>x/square.png</href></Icon></IconStyle></Style>
  <Placemark><name>D</name><styleUrl>#s</styleUrl><Style><IconStyle><color>ffff0000</color></IconStyle></Style>
    <Point><coordinates>1,1</coordinates></Point></Placemark>`);
const mk = placemarkMarkerStyle(pmOf(mix, "D"), buildStyleIndex(mix));
ok(mk.color === "#0000ff" && mk.scale === 2 && mk.href === "x/square.png", "inline colour wins, scale and href come from the shared style: " + JSON.stringify(mk));
const mm = kmlMarkerToMstyle(mk, null);
ok(mm.icon === "square" && mm.size === 64, "scale 2 -> 82 px clamped to the dialog's 64: " + JSON.stringify(mm));
ok(kmlMarkerToMstyle({ scale: 0.1 }, null).size === 12, "a tiny scale is clamped to 12");
ok(kmlMarkerToMstyle({ color: "#ff0000" }, null).size === DEFAULT_MARKER_STYLE.size, "no scale -> the default size");

/* Shapes by file name; anything else is reported and drawn as a circle (with a colour) or the pin */
const names = { "http://a/b/shaded_dot.png": "circle", "http://a/open-diamond.png": null, "http://a/STAR.PNG?x=1": "star",
  "http://a/triangle.png": "triangle", "http://a/square.png#f": "square", "http://a/dot": "circle", "": null };
for (const [h, want] of Object.entries(names)) ok(kmlIconName(h) === want, `kmlIconName(${JSON.stringify(h)}) = ${want}`);
const seen = new Set();
const pushpin = kmlMarkerToMstyle({ color: "#00ff00", href: "http://maps.google.com/mapfiles/kml/pushpin/grn-pushpin.png" }, seen);
ok(pushpin.icon === "circle" && pushpin.color === "#00ff00" && seen.has("http://maps.google.com/mapfiles/kml/pushpin/grn-pushpin.png"),
  "a pushpin with a colour -> coloured circle, and its address is reported");
const seen2 = new Set();
const bare = kmlMarkerToMstyle({ href: "http://x/y/paddle/blank.png" }, seen2);
ok(bare.icon === "leaflet-pin" && bare.color === DEFAULT_MARKER_STYLE.color && seen2.size === 1,
  "an unknown image without a colour keeps the Leaflet pin, reported: " + JSON.stringify(bare));
ok(kmlMarkerToMstyle({ color: "#112233" }, null).icon === "circle", "a colour and no image: a circle");
ok(kmlMarkerToMstyle({ labelScale: 1 }, null).icon === "leaflet-pin", "only a LabelStyle: still the pin");

/* scale 0 -> no icon; the text shows unless LabelStyle also says 0 */
ok(kmlMarkerToMstyle({ scale: 0, color: "#ff0000" }, null).icon === "none", "IconStyle scale 0 -> «Ninguno»");
ok(kmlMarkerToMstyle({ scale: 0 }, null).textAlways === true, "«Ninguno» shows its name (nothing else would show)");
ok(kmlMarkerToMstyle({ scale: 0, labelScale: 0 }, null).textAlways === false, "unless LabelStyle scale 0 asks for no label");
ok(kmlMarkerToMstyle({ scale: 0 }, new Set()).icon === "none", "scale 0 does not report its image");
ok(kmlMarkerToMstyle({ scale: 0 }, null).size === DEFAULT_MARKER_STYLE.size, "«Ninguno» keeps the default size, not the clamp's floor");

/* A styleUrl without the "#" (real file: <styleUrl>error_75</styleUrl>) is the local style when the document has it */
const bareDoc = markerKml(`<StyleMap id="error_75"><Pair><key>normal</key><styleUrl>error_75_normal</styleUrl></Pair></StyleMap>
  <Style id="error_75_normal"><IconStyle><color>ff00ff00</color><scale>0.5</scale></IconStyle></Style>
  <Style id="a.b"><IconStyle><color>ff0000ff</color></IconStyle></Style>
  <Placemark><name>E</name><styleUrl>error_75</styleUrl><Point><coordinates>1,1</coordinates></Point></Placemark>
  <Placemark><name>F</name><styleUrl>a.b</styleUrl><Point><coordinates>1,1</coordinates></Point></Placemark>
  <Placemark><name>G</name><styleUrl>otro.kml#x</styleUrl><Point><coordinates>1,1</coordinates></Point></Placemark>
  <Placemark><name>H</name><styleUrl>no_existe</styleUrl><Point><coordinates>1,1</coordinates></Point></Placemark>`);
const bIdx = buildStyleIndex(bareDoc);
const be = kmlMarkerToMstyle(placemarkMarkerStyle(pmOf(bareDoc, "E"), bIdx), null);
ok(be && be.color === "#00ff00" && be.size === 21, "a bare styleUrl names the local StyleMap (and its bare Pair styleUrl too): " + JSON.stringify(be));
ok((placemarkMarkerStyle(pmOf(bareDoc, "F"), bIdx) || {}).color === "#ff0000", "an id with a dot is still local");
ok(bIdx.externalRefs === 0, "neither counts as an external style: " + bIdx.externalRefs);
ok(placemarkMarkerStyle(pmOf(bareDoc, "G"), bIdx) === null && placemarkMarkerStyle(pmOf(bareDoc, "H"), bIdx) === null, "a file reference or an id the document lacks resolves to nothing");
ok(bIdx.externalRefs === 2, "and those two are counted as external: " + bIdx.externalRefs);
ok(placemarkStyle(pmOf(bareDoc, "E"), bIdx).color === "#3388ff", "the path style of a bare reference resolves through the same chain");

/* Foreign input: junk values are ignored, never thrown on */
const junk = parseMarkerStyleElement(markerKml(`<Style><IconStyle><color>zz</color><scale>-3</scale><Icon><href>  </href></Icon></IconStyle>
  <LabelStyle><scale>abc</scale></LabelStyle></Style>`).getElementsByTagName("Style")[0]);
ok(junk === null, "invalid colour, negative or text scale and an empty href are dropped: " + JSON.stringify(junk));
}
/* ---- A real file: tests/fixtures/msda-lemd-marker-styles.kml (the user's test.kml, byte for byte) ----
   It has what the synthetic cases above do not have together: 12 points whose <styleUrl> lacks the "#",
   a StyleMap onto an image we have no equivalent for (polygon.png, scale 1.2, no colour), two banners
   with an EMPTY <Icon></Icon> at scale 0 and a label of scale 0.8, a "highlight" pair that points at a
   style the file does not have, and two lines whose inline <Style> overrides a shared one. */
{
  const real = new DOMParser().parseFromString(require("fs").readFileSync(
    require("path").join(__dirname, "fixtures", "msda-lemd-marker-styles.kml"), "utf8"), "text/xml");
  const rIdx = buildStyleIndex(real);
  const pms = elsByTag(real, "Placemark");
  ok(pms.length === 17, "the file has 17 placemarks: " + pms.length);
  const hrefs = new Set();
  const marker = pm => kmlMarkerToMstyle(placemarkMarkerStyle(pm, rIdx), hrefs);
  const isPoint = pm => elsByTag(pm, "Point").length > 0;
  const points = pms.filter(isPoint), lines = pms.filter(pm => !isPoint(pm));
  ok(points.length === 15 && lines.length === 2, "15 points and 2 lines: " + points.length + "/" + lines.length);

  /* the 12 measurements: the bare styleUrl "error_75" -> StyleMap -> a green dot at half size, no label */
  const dots = points.filter(pm => /^\d\.\d\dm$/.test(text(pm, "name")));
  ok(dots.length === 12, "12 measurement points: " + dots.length);
  for (const pm of dots) {
    const m = marker(pm);
    ok(m && m.icon === "circle" && m.color === "#00ff00" && m.size === 21 && m.textAlways === false,
      text(pm, "name") + " is a green circle of 21 px with no permanent name: " + JSON.stringify(m));
  }
  ok(hrefs.size === 0 || [...hrefs].every(h => /polygon\.png$/.test(h)), "no measurement point reports an image: " + [...hrefs]);

  /* the centre: StyleMap -> sn_polygon, an image we do not know, scale 1.2 and no colour -> the pin, 49 px, reported */
  const centre = marker(pms.find(pm => text(pm, "name") === "RXTX31-342351"));
  ok(centre.icon === "leaflet-pin" && centre.size === 49 && centre.color === DEFAULT_MARKER_STYLE.color,
    "the centre keeps the Leaflet pin at 1.2 x: " + JSON.stringify(centre));
  ok(hrefs.size === 1 && [...hrefs][0] === "http://maps.google.com/mapfiles/kml/shapes/polygon.png",
    "exactly one image is reported, the one with no equivalent: " + [...hrefs]);

  /* the banners: an empty <Icon></Icon> at scale 0 is «Ninguno»; the label at 0.8 keeps the name on */
  const banners = points.filter(pm => /^P9[59]/.test(text(pm, "name")));
  ok(banners.length === 2 && banners.every(pm => { const m = marker(pm); return m.icon === "none" && m.textAlways === true; }),
    "both banners are «Ninguno» with their name shown");

  /* the lines: path styles are untouched by the marker work, and the inline LineStyle wins over the shared one */
  const line = n => placemarkStyle(lines.find(pm => text(pm, "name") === n), rIdx);
  ok(line("P95≤7.5m").color === "#00ff00" && line("P99≤12m").color === "#0000ff" && line("P95≤7.5m").weight === 3,
    "inline LineStyle colours (aabbggrr) over the shared 3 px style: " + JSON.stringify([line("P95≤7.5m"), line("P99≤12m")]));
  ok(lines.every(pm => placemarkMarkerStyle(pm, rIdx) === null), "a line has no marker style");

  /* nothing in the file counts as a style in another file (the "highlight" pair is never followed) */
  ok(rIdx.externalRefs === 0, "no external style references: " + rIdx.externalRefs);
}
if (!process.exitCode) console.log("KML MARKER STYLE TESTS OK");
