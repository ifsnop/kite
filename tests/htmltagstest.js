const { DOMParser } = require("@xmldom/xmldom");
const { fn, constDecl } = require("./_extract");

/* HTML_LIKE_TAG_RE is a const the extracted functions close over. */
const constSrc = constDecl("HTML_LIKE_TAG_RE");

const src = [constSrc, fn("elsByTag"), fn("hasHtmlLikeTags"), fn("stripHtmlLikeTags"),
             fn("kmlNamesHaveHtmlTags"), fn("stripHtmlTagsFromKmlNames"),
             constDecl("propsOf"), fn("valueHasHtmlTags"),
             fn("geojsonPropsHaveHtmlTags"), fn("stripHtmlTagsFromGeojsonProps")].join("\n");
const api = new Function(src +
  "\nreturn { hasHtmlLikeTags, stripHtmlLikeTags, kmlNamesHaveHtmlTags, stripHtmlTagsFromKmlNames,"
  + " geojsonPropsHaveHtmlTags, stripHtmlTagsFromGeojsonProps };")();
const { hasHtmlLikeTags, stripHtmlLikeTags, kmlNamesHaveHtmlTags, stripHtmlTagsFromKmlNames,
        geojsonPropsHaveHtmlTags, stripHtmlTagsFromGeojsonProps } = api;

const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* Real file seen in the wild (2026-08-27): an export tool's unrendered
   "bold"/"font" markup left as literal text in <name>.                 */
const REAL_NAME = 'A27<_bol><fnt scale="80">    </fnt></_bol>';

ok(hasHtmlLikeTags(REAL_NAME) === true, "detecta el caso real: " + REAL_NAME);
ok(hasHtmlLikeTags("Ruta normal") === false, "un nombre corriente no dispara nada");
ok(hasHtmlLikeTags("Cota < 100") === false, "un '<' suelto sin '>' detrás no es una etiqueta");
ok(hasHtmlLikeTags("<3 amigos") === false, "'<3' (sin letra entre < y el siguiente carácter, y sin '>') no es una etiqueta");
ok(hasHtmlLikeTags("</fnt>") === true, "una etiqueta de cierre también cuenta (tiene letras)");
ok(hasHtmlLikeTags("<1>") === false, "un '<>' con solo dígitos dentro no cuenta como HTML (regla del usuario: hace falta letra)");

/* Límite aceptado y documentado, no un bug: la regla es deliberadamente
   simple ("letras dentro de <>", tal cual la pidió el usuario) y no
   distingue una etiqueta real de un uso literal de "<"/">" que por
   casualidad tenga letras en medio.                                    */
ok(hasHtmlLikeTags("A < B and C > D") === true,
   "falso positivo aceptado y documentado: '<'/'>' usados como comparación con letras en medio");

ok(stripHtmlLikeTags(REAL_NAME) === "A27    ",
   "quita las etiquetas y conserva el texto de fuera (los 4 espacios entre <fnt> y </fnt>): "
   + JSON.stringify(stripHtmlLikeTags(REAL_NAME)));
ok(stripHtmlLikeTags("Ruta normal") === "Ruta normal", "un nombre sin etiquetas no cambia");
ok(stripHtmlLikeTags("<b>Río</b> Ebro") === "Río Ebro", "varias etiquetas en el mismo nombre, todas fuera");

/* A KML file represents a literal "<"/">" in text content as entities
   (the real file this feature is for does exactly this — see the
   MultiGeometry/PolyStyle bug fixed earlier this session, same file).
   Embedding REAL_NAME's raw characters as XML would parse them as
   actual elements instead of text, so it must be entity-escaped here,
   same as any real KML producer would.                                */
const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function docFrom(kmlInner) {
  return new DOMParser().parseFromString(`<kml><Document>${kmlInner}</Document></kml>`, "text/xml");
}

{
  const doc = docFrom(`<name>Carpeta normal</name>
    <Placemark><name>${escapeXml(REAL_NAME)}</name><Point><coordinates>0,0</coordinates></Point></Placemark>`);
  ok(kmlNamesHaveHtmlTags(doc) === true, "detecta el caso real dentro de un documento KML completo");
}
{
  const doc = docFrom(`<name>Carpeta normal</name>
    <Placemark><name>Punto normal</name><Point><coordinates>0,0</coordinates></Point></Placemark>`);
  ok(kmlNamesHaveHtmlTags(doc) === false, "un KML sin etiquetas no dispara el aviso");
}
{
  const doc = docFrom(`<name>Carpeta ${escapeXml(REAL_NAME)}</name>
    <Placemark><name>Punto normal</name><Point><coordinates>0,0</coordinates></Point></Placemark>
    <Placemark><name>${escapeXml(REAL_NAME)}</name><Point><coordinates>1,1</coordinates></Point></Placemark>`);
  ok(kmlNamesHaveHtmlTags(doc) === true, "también detecta etiquetas en el nombre de una carpeta, no solo de un placemark");
  stripHtmlTagsFromKmlNames(doc);
  const names = [...doc.getElementsByTagName("name")].map(el => el.textContent);
  ok(names[0] === "Carpeta A27    ", "limpia el nombre de la carpeta: " + JSON.stringify(names[0]));
  ok(names[1] === "Punto normal", "un nombre ya limpio no se toca: " + JSON.stringify(names[1]));
  ok(names[2] === "A27    ", "limpia el nombre del placemark: " + JSON.stringify(names[2]));
  ok(kmlNamesHaveHtmlTags(doc) === false, "tras limpiar, ya no quedan etiquetas que detectar");
}

/* ================= properties de un GeoJSON =================
   Mismo problema que en los <name> de un KML: valores con etiquetas
   literales que afean la tabla del panel de información, el nombre del
   árbol, el texto del marcador y el globo.                            */

/* ---------- La idea equivocada que hay que matar ----------
   Se reportó como que los `<` escapados (`\u003c`) quizá no se
   procesaban bien. No: en un literal de cadena JSON eso es solo otra
   forma de escribir el mismo carácter. Esta prueba existe para que
   nadie vuelva a sospechar de ahí — cuesta una línea y ahorra una
   tarde.                                                             */
{
  const conEscapes = JSON.parse('{"a":"\\u003cb\\u003eMadrid\\u003c/b\\u003e"}').a;
  const literal = JSON.parse('{"a":"<b>Madrid</b>"}').a;
  ok(conEscapes === literal,
    "JSON.parse normaliza \\u003c: la aplicación NO puede distinguirlos");
  ok(conEscapes.charCodeAt(0) === 60, "y lo que llega es un '<' de verdad (60)");
  ok(hasHtmlLikeTags(conEscapes) === true, "así que la detección los ve igual");
}

/* ---------- Detección ---------- */
const fc = (...props) => ({
  type: "FeatureCollection",
  features: props.map(p => ({ type: "Feature", properties: p, geometry: null }))
});
ok(geojsonPropsHaveHtmlTags(fc({ nombre: "<b>Madrid</b>" }).features) === true,
  "detecta una etiqueta en un valor");
ok(geojsonPropsHaveHtmlTags(fc({ nombre: "Madrid", pob: 3200000 }).features) === false,
  "un archivo limpio no dispara nada");
/* La regla acordada: hace falta una LETRA dentro de los símbolos, para
   que un "<" usado como comparación no se confunda con una etiqueta. */
ok(geojsonPropsHaveHtmlTags(fc({ nota: "3 < 5" }).features) === false,
  "un '<' de comparación sin cierre no es una etiqueta");
/* Y el MISMO falso positivo aceptado que en los nombres de KML: si entre
   un "<" y un ">" hay letras, cuenta como etiqueta. Se documenta aquí
   también para que quede claro que es deliberado y compartido, no un
   descuido de este camino.                                            */
ok(geojsonPropsHaveHtmlTags(fc({ nota: "a < b y c > d" }).features) === true,
  "falso positivo aceptado, igual que en KML: letras entre < y >");
/* Valores que no son cadenas no pueden romper el recorrido */
ok(geojsonPropsHaveHtmlTags(fc({ n: 42, x: null, b: true }).features) === false,
  "números, null y booleanos no rompen nada");
ok(geojsonPropsHaveHtmlTags([{ type: "Feature", geometry: null }]) === false,
  "un feature sin properties tampoco");
/* Anidado: una property no tiene por qué ser plana */
ok(geojsonPropsHaveHtmlTags(fc({ meta: { titulo: "<i>x</i>" } }).features) === true,
  "mira dentro de un objeto anidado");
ok(geojsonPropsHaveHtmlTags(fc({ lista: ["ok", ["<b>hola</b>"]] }).features) === true,
  "y dentro de arrays anidados");

/* ---------- Limpieza ---------- */
{
  const doc = fc({ nombre: "<b>Madrid</b>", pob: 3200000, nota: "a < b" },
                 { nombre: "Sevilla" });
  const n = stripHtmlTagsFromGeojsonProps(doc.features);
  ok(n === 1, "devuelve cuántos valores tocó, para poder decirlo: " + n);
  ok(doc.features[0].properties.nombre === "Madrid",
    "limpia el valor: " + JSON.stringify(doc.features[0].properties.nombre));
  ok(doc.features[0].properties.pob === 3200000, "y no toca los números");
  ok(doc.features[0].properties.nota === "a < b", "ni un '<' de comparación");
  ok(doc.features[1].properties.nombre === "Sevilla", "ni lo que ya estaba limpio");
  ok(geojsonPropsHaveHtmlTags(doc.features) === false, "tras limpiar no queda nada que detectar");
}

/* Se muta SOBRE EL PROPIO OBJETO: es lo que hace que limpiar `features`
   deje limpio el `gj` que después recibe buildGeoJsonRecords.        */
{
  const gj = fc({ nombre: "<b>Madrid</b>" });
  stripHtmlTagsFromGeojsonProps(gj.features);
  ok(gj.features[0].properties.nombre === "Madrid",
    "el objeto original queda limpio, no una copia");
}

/* Un Feature suelto, que es el otro caso que geojsonFeatures devuelve
   por referencia                                                      */
{
  const feat = { type: "Feature", properties: { n: "<b>x</b>" }, geometry: null };
  stripHtmlTagsFromGeojsonProps([feat]);
  ok(feat.properties.n === "x", "un Feature suelto también se limpia por referencia");
}

/* Anidado, con la cuenta correcta */
{
  const doc = fc({ meta: { t: "<i>a</i>", n: 1 }, lista: ["<b>b</b>", "limpio"] });
  const n = stripHtmlTagsFromGeojsonProps(doc.features);
  ok(n === 2, "cuenta los valores anidados que tocó: " + n);
  ok(doc.features[0].properties.meta.t === "a", "limpia dentro del objeto");
  ok(doc.features[0].properties.meta.n === 1, "sin estropear un número anidado");
  ok(doc.features[0].properties.lista[0] === "b" && doc.features[0].properties.lista[1] === "limpio",
    "y dentro del array: " + JSON.stringify(doc.features[0].properties.lista));
}

/* El caso real del reporte, escrito con escapes como en sus archivos */
{
  const gj = JSON.parse('{"type":"FeatureCollection","features":[{"type":"Feature",'
    + '"properties":{"nombre":"\\u003cb\\u003eMadrid\\u003c/b\\u003e"},"geometry":null}]}');
  ok(geojsonPropsHaveHtmlTags(gj.features) === true, "el caso reportado se detecta");
  stripHtmlTagsFromGeojsonProps(gj.features);
  ok(gj.features[0].properties.nombre === "Madrid",
    "y se limpia: " + JSON.stringify(gj.features[0].properties.nombre));
}

if (!process.exitCode) console.log("HTML-LIKE TAGS TESTS OK");
