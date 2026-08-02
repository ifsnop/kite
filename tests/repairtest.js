const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const { DOMParser } = require("@xmldom/xmldom");
const fs = require("fs");
const html = fs.readFileSync(HTML_PATH, "utf8");
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const src = script.slice(script.indexOf("const MAX_REPAIRED_PREFIXES"),
                         script.indexOf("/* Mensaje legible del <parsererror>"));
const { repairUndeclaredPrefixes, tagEnd } = new Function(src + "\nreturn {repairUndeclaredPrefixes, tagEnd};")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

// tagEnd must ignore ">" inside quoted attribute values
ok(tagEnd('<kml a="x>y">rest', 0) === 12, "tagEnd skips quoted >: " + tagEnd('<kml a="x>y">rest', 0));
ok(tagEnd("<kml>", 0) === 4, "plain tag end");
ok(tagEnd("<kml", 0) === -1, "unterminated tag");

// the actual failure of doc.kml, reduced
const broken = `<?xml version="1.0"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document xsi:schemaLocation="a b"><name>x</name></Document></kml>`;
let r = repairUndeclaredPrefixes(broken);
ok(r.prefixes.join() === "xsi", "detects the undeclared prefix: " + r.prefixes);
ok(r.text.includes('xmlns:xsi="urn:kite:undeclared:xsi"'), "declares it on the root");
ok(r.text.indexOf("xmlns:xsi") < r.text.indexOf("<Document"), "declaration goes on the root element");
let doc = new DOMParser({onError(){}}).parseFromString(r.text, "text/xml");
ok(doc.getElementsByTagName("Document").length === 1, "repaired document parses");

// nothing to repair -> untouched
r = repairUndeclaredPrefixes(`<kml xmlns:gx="u"><gx:Track/></kml>`);
ok(r.prefixes.length === 0, "declared prefixes left alone");

// element prefixes also count
r = repairUndeclaredPrefixes(`<kml><foo:bar/></kml>`);
ok(r.prefixes.join() === "foo", "undeclared element prefix: " + r.prefixes);

// self-closing root
r = repairUndeclaredPrefixes(`<kml a:b="1"/>`);
ok(r.text === `<kml a:b="1" xmlns:a="urn:kite:undeclared:a"/>`, "self-closing root: " + r.text);

// prolog, comments and doctype are skipped
r = repairUndeclaredPrefixes(`<?xml version="1.0"?><!-- c --><!DOCTYPE kml><kml x:y="1"></kml>`);
ok(r.text.includes(`<kml x:y="1" xmlns:x=`), "root found after prologue: " + r.text);

// a flood of prefixes is refused rather than rewriting the file
const many = "<kml " + Array.from({length: 20}, (_, i) => `p${i}:a="1"`).join(" ") + "/>";
ok(repairUndeclaredPrefixes(many).prefixes.length === 0, "too many prefixes: no repair");

/* --- Reproducción del archivo real ---
   El KML que destapó este fallo pesa 37 MB y no se distribuye con los
   tests. Se genera aquí uno equivalente: mismo defecto (prefijo `xsi`
   usado sin declarar) y tamaño suficiente para medir el coste de la
   reparación sobre un archivo grande.                                */
const bulk = Array.from({ length: 20000 }, (_, i) => `
    <Placemark><name>P${i}</name>
      <Point><coordinates>${(-3 + i / 1e5).toFixed(6)},40.4,0</coordinates></Point>
    </Placemark>`).join("");
const content = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document id="ESPACIOS" xsi:schemaLocation="http://www.opengis.net/kml/2.2 ogckml22.xsd">
    <name>Prueba</name>${bulk}
  </Document>
</kml>`;
console.log(`  (KML sintético de ${(content.length / 1024 / 1024).toFixed(1)} MB)`);

let threw = false;
try { new DOMParser({ onError(e) { throw new Error(e); } }).parseFromString(content, "text/xml"); }
catch { threw = true; }
ok(threw, "un analizador estricto rechaza el prefijo sin declarar");

const t0 = Date.now();
const fixed = repairUndeclaredPrefixes(content);
console.log(`  reparación: ${Date.now() - t0} ms, prefijos: ${fixed.prefixes}`);
ok(fixed.prefixes.join() === "xsi", "solo falta xsi");
const realDoc = new DOMParser({ onError() {} }).parseFromString(fixed.text, "text/xml");
ok(realDoc.getElementsByTagNameNS("*", "Placemark").length === 20000,
   "tras reparar se analiza entero: " + realDoc.getElementsByTagNameNS("*", "Placemark").length);
ok(fixed.text.indexOf("xmlns:xsi") < fixed.text.indexOf("<Document"), "la declaración va en la raíz");
if (!process.exitCode) console.log("REPAIR TESTS OK");
