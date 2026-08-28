const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const { DOMParser } = require("@xmldom/xmldom");
const fs = require("fs");
const html = fs.readFileSync(HTML_PATH, "utf8");
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];

/* Same brace-matching extraction as kmltest.js/navtest.js. */
function fn(name) {
  const i = script.indexOf(`function ${name}(`);
  if (i < 0) throw new Error("no encontrada: " + name);
  let depth = 0, j = script.indexOf("{", i);
  for (let k = j; k < script.length; k++) {
    if (script[k] === "{") depth++;
    else if (script[k] === "}" && --depth === 0) return script.slice(i, k + 1);
  }
}
/* HTML_LIKE_TAG_RE is a const the extracted functions close over. */
const constSrc = script.slice(
  script.indexOf("const HTML_LIKE_TAG_RE"),
  script.indexOf(";", script.indexOf("const HTML_LIKE_TAG_RE")) + 1
);

const src = [constSrc, fn("elsByTag"), fn("hasHtmlLikeTags"), fn("stripHtmlLikeTags"),
             fn("kmlNamesHaveHtmlTags"), fn("stripHtmlTagsFromKmlNames")].join("\n");
const api = new Function(src +
  "\nreturn { hasHtmlLikeTags, stripHtmlLikeTags, kmlNamesHaveHtmlTags, stripHtmlTagsFromKmlNames };")();
const { hasHtmlLikeTags, stripHtmlLikeTags, kmlNamesHaveHtmlTags, stripHtmlTagsFromKmlNames } = api;

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

if (!process.exitCode) console.log("HTML-LIKE TAGS TESTS OK");
