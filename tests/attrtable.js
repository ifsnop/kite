/* Tabla de atributos (54-attr-table.js) y lectura de <ExtendedData>
   (20-kml-geom.js): lo puro. El diálogo, la ventana de filas y el clic que
   lleva a una capa los cubre tests/browser/attr-table.mjs.               */
const { DOMParser } = require("@xmldom/xmldom");
const { fn, between, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const api = new Function([constDecl("ATTR_MAX_COLS"), fn("stringifyPropValue"), fn("layerProperties"),
  fn("collectAttrRows"), fn("attrColumns"), constDecl("attrCell"), fn("attrIsNumeric"), fn("attrSort"), fn("attrFilter"),
  between("const csvCell", "const toCsv"), constDecl("toCsv"),
  "const nodeUl = li => li._ul || null; const nodeLayer = li => li._layer || null;",
  "return { collectAttrRows, attrColumns, attrCell, attrIsNumeric, attrSort, attrFilter, csvCell, toCsv, ATTR_MAX_COLS };"].join("\n"))();
const { collectAttrRows, attrColumns, attrCell, attrIsNumeric, attrSort, attrFilter, csvCell, toCsv, ATTR_MAX_COLS } = api;
const row = (name, props) => ({ name, props });

/* ---------- Columnas ---------- */
const rows = [row("A", { ref: "r1", n: 9 }), row("B", { n: 10, extra: "x" }), row("C", null)];
const { cols, capped } = attrColumns(rows);
ok(cols.map(c => c.key).join("|") === "|ref|n|extra" && cols[0].key === null, "el nombre primero y las claves en el orden en que se ven: " + JSON.stringify(cols));
ok(!capped, "sin tope");
const wide = [row("W", Object.fromEntries(Array.from({ length: 200 }, (_, i) => ["k" + i, i])))];
const w = attrColumns(wide);
ok(w.cols.length === 1 + ATTR_MAX_COLS && w.capped, `con 200 claves, el tope (${ATTR_MAX_COLS}) y se dice: ${w.cols.length}`);
ok(attrColumns([]).cols.length === 1, "sin filas, solo el nombre");

/* ---------- Celdas ---------- */
ok(attrCell(rows[0], null) === "A" && attrCell(rows[0], "ref") === "r1" && attrCell(rows[0], "n") === "9", "nombre y valores como texto");
ok(attrCell(rows[0], "extra") === "" && attrCell(rows[2], "ref") === "", "lo ausente (o una fila sin atributos) es vacío");
ok(attrCell(row("O", { o: { a: 1 }, z: null }), "o") === '{"a":1}' && attrCell(row("O", { z: null }), "z") === "", "un objeto, como JSON; null, vacío");

/* ---------- Numérica o de texto ---------- */
ok(attrIsNumeric(rows, "n") === true, "9 y 10: numérica");
ok(attrIsNumeric(rows, "ref") === false && attrIsNumeric(rows, null) === false, "texto: no");
ok(attrIsNumeric([row("a", { v: "1,5" }), row("b", { v: "-2.25e3" }), row("c", { v: "" })], "v") === true, "coma o punto decimal, notación científica y vacíos que no cuentan");
ok(attrIsNumeric([row("a", { v: "12 m" })], "v") === false && attrIsNumeric([row("a", {})], "v") === false, "una unidad pegada la hace texto; todo vacío, no es numérica");

/* ---------- Orden ---------- */
const num = [row("a", { v: 10 }), row("b", { v: 9 }), row("c", { v: "" }), row("d", { v: 2 }), row("e", { v: 9 })];
ok(attrSort(num, "v", 1).map(r => r.name).join("") === "dbeac", "numérico ascendente: 9 antes que 10, vacíos al final y empates estables: " + attrSort(num, "v", 1).map(r => r.name).join(""));
ok(attrSort(num, "v", -1).map(r => r.name).join("") === "abedc", "descendente: los vacíos SIGUEN al final: " + attrSort(num, "v", -1).map(r => r.name).join(""));
const txt = [row("Zona 10"), row("zona 2"), row("Zona 1"), row("Área")];
ok(attrSort(txt, null, 1).map(r => r.name).join("|") === "Área|Zona 1|zona 2|Zona 10", "texto con números dentro, sin distinguir mayúsculas: " + attrSort(txt, null, 1).map(r => r.name).join("|"));
ok(num[0].name === "a" && num.length === 5, "ordenar no toca la lista original");

/* ---------- Filtro ---------- */
const frows = [row("Madrid", { pais: "España", pob: 3200000 }), row("Lyon", { pais: "Francia" }), row("Faro", { o: { calle: "Mayor" } })];
ok(attrFilter(frows, "") === frows && attrFilter(frows, "   ") === frows, "sin término devuelve la misma lista");
ok(attrFilter(frows, "MAD").map(r => r.name).join() === "Madrid", "por nombre, sin distinguir mayúsculas");
ok(attrFilter(frows, "franc").map(r => r.name).join() === "Lyon", "por valor");
ok(attrFilter(frows, "mayor").map(r => r.name).join() === "Faro", "dentro de un objeto anidado");
ok(attrFilter(frows, "3200").map(r => r.name).join() === "Madrid", "un número, como texto");
ok(attrFilter(frows, "nada").length === 0, "sin coincidencias");

/* ---------- CSV ---------- */
ok(csvCell("hola") === "hola" && csvCell("a,b") === '"a,b"' && csvCell('di "x"') === '"di ""x"""' && csvCell("l1\nl2") === '"l1\nl2"', "comillas, comas y saltos de línea");
ok(csvCell("=1+1") === "'=1+1" && csvCell("@SUMA(A1)") === "'@SUMA(A1)" && csvCell("+x") === "'+x" && csvCell("-x") === "'-x" && csvCell("\tx") === "'\tx",
  "un valor que una hoja leería como fórmula lleva un apóstrofo delante");
ok(csvCell("-5") === "-5" && csvCell("+3.5") === "+3.5" && csvCell("-.5") === "-.5" && csvCell("a=b") === "a=b", "números (negativos incluidos) y un = que no está al principio, intactos");
ok(csvCell("=A,B") === '"\'=A,B"', "la defensa y las comillas se combinan");
ok(toCsv(["Nombre", "pob"], [["Madrid", "3200000"], ["A, B", ""]]) === 'Nombre,pob\r\nMadrid,3200000\r\n"A, B",\r\n', "cabecera, CRLF y salto final: " + JSON.stringify(toCsv(["Nombre", "pob"], [["Madrid", "3200000"], ["A, B", ""]])));
ok(toCsv(["a"], []) === "a\r\n", "sin filas, solo la cabecera");

/* ---------- Filas del árbol (sin construir nada) ---------- */
const layer = props => ({ getLayers: () => [{ feature: { properties: props } }] });
const leaf = (name, props) => ({ _name: name, _layer: layer(props) });
const rec = (name, props) => ({ t: "layer", name, _layer: layer(props) });
const tree = {
  _name: "Raíz", _isContainer: true,
  _pending: [
    { t: "folder", name: "Cerrada", children: [rec("P1", { id: 1 }), { t: "folder", name: "Honda", children: [rec("P2", { id: 2 })] }] },
    rec("P3", null),
    { t: "measure", name: "Ruta" }, { t: "elevGrid", name: "Cuadrícula" }
  ],
  _ul: { children: [
    leaf("Abierta", { id: 3 }),
    { _name: "Medición", _measure: {}, _layer: layer({ x: 1 }) },
    { _name: "Rejilla", _elevGrid: {} }, { _name: "Orto", _imageOverlay: {} }, { _name: "Cog", _cog: {} },
    { /* mensaje «Sin geometrías»: sin _name */ },
    { _name: "Carpeta", _isContainer: true, _ul: { children: [leaf("Dentro", { id: 4 })] } }
  ] }
};
const got = collectAttrRows(tree);
ok(got.map(r => r.name).join("|") === "P1|P2|P3|Abierta|Dentro", "solo capas con geometría, de los registros pendientes y de las filas, a cualquier profundidad: " + got.map(r => r.name).join("|"));
ok(got[0].rec && got[0].rec.name === "P1" && !got[0].li && got[3].li && got[3].li._name === "Abierta", "un registro pendiente lleva su `rec` y una fila, su `li` (para llegar a ella)");
ok(got[0].props.id === 1 && got[2].props === null, "y sus atributos (null si no tiene)");
ok(collectAttrRows({ _name: "Vacía", _isContainer: true }).length === 0, "una carpeta vacía no da filas");

/* ---------- <ExtendedData> del KML ---------- */
const imp = new Function(between("/* Nombre sin prefijo", "/* Crea las capas Leaflet de un placemark")
  + "\nreturn { parseExtendedData };")();
const pm = xml => new DOMParser({ onError() {} }).parseFromString(`<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark>${xml}</Placemark></kml>`, "text/xml").getElementsByTagName("Placemark")[0];
const ed = imp.parseExtendedData(pm('<name>x</name><ExtendedData><Data name="ref"><value>A-1</value></Data><Data name="pob"><value>3200000</value></Data></ExtendedData>'));
ok(ed && ed.ref === "A-1" && ed.pob === "3200000", "Data/value: " + JSON.stringify(ed));
const sd = imp.parseExtendedData(pm('<ExtendedData><SchemaData schemaUrl="#s"><SimpleData name="uso"> Mixto </SimpleData><SimpleData name="a">1</SimpleData></SchemaData></ExtendedData>'));
ok(sd && sd.uso === "Mixto" && sd.a === "1", "SchemaData/SimpleData, con el texto recortado: " + JSON.stringify(sd));
const both = imp.parseExtendedData(pm('<ExtendedData><Data name="k"><value>1</value></Data><Data name="k"><value>2</value></Data><SchemaData><SimpleData name="k">3</SimpleData></SchemaData></ExtendedData>'));
ok(both.k === "1", "con un nombre repetido, el primero");
ok(imp.parseExtendedData(pm("<name>x</name>")) === null && imp.parseExtendedData(pm("<ExtendedData></ExtendedData>")) === null, "sin datos, null");
ok(imp.parseExtendedData(pm('<ExtendedData><Data><value>sin nombre</value></Data><Data name=""><value>v</value></Data></ExtendedData>')) === null, "un dato sin nombre no es un atributo");
const noval = imp.parseExtendedData(pm('<ExtendedData><Data name="vacio"/></ExtendedData>'));
ok(noval && noval.vacio === "", "un Data sin value es una cadena vacía");
const evil = imp.parseExtendedData(pm('<ExtendedData><Data name="__proto__"><value>x</value></Data><Data name="constructor"><value>c</value></Data><Data name="toString"><value>t</value></Data></ExtendedData>'));
ok(evil && Object.getPrototypeOf(evil) === Object.prototype && evil.constructor === "c" && evil.toString === "t" && Object.keys(evil).join() === "constructor,toString", "`__proto__` no es un atributo; `constructor` y `toString` sí, como propios: " + Object.keys(evil));
const many = imp.parseExtendedData(pm("<ExtendedData>" + Array.from({ length: 500 }, (_, i) => `<Data name="k${i}"><value>${i}</value></Data>`).join("") + "</ExtendedData>"));
ok(Object.keys(many).length === 200, "tope de 200 campos por Placemark: " + Object.keys(many).length);
const nsd = new DOMParser({ onError() {} }).parseFromString('<k:kml xmlns:k="http://www.opengis.net/kml/2.2"><k:Placemark><k:ExtendedData><k:Data name="p"><k:value>v</k:value></k:Data></k:ExtendedData></k:Placemark></k:kml>', "text/xml").getElementsByTagName("k:Placemark")[0];
ok((imp.parseExtendedData(nsd) || {}).p === "v", "con prefijo de namespace");

if (!process.exitCode) console.log("ATTR TABLE TESTS OK");
