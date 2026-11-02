/* Estilo por atributo (55-attr-style.js): la clasificación y los colores,
   puros. El diálogo, la vista previa en vivo y Cancelar sobre el mapa los
   cubre tests/browser/attr-style.mjs.                                   */
const { fn, between, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const LEAFLET_PIN = "leaflet-pin";
const DEFAULT_MARKER_STYLE = { icon: LEAFLET_PIN, color: "#1b5e97", size: 41, textSize: 13, textColor: "#2b2b28", textAlways: false };
const api = new Function("LEAFLET_PIN", "DEFAULT_MARKER_STYLE", [
  "ATTRSTYLE_CATEGORICAL", "ATTRSTYLE_RAMP", "ATTRSTYLE_NONE", "ATTRSTYLE_OTHER", "ATTRSTYLE_MAX_CATEGORIES", "ATTRSTYLE_MIN_CLASSES",
  "ATTRSTYLE_MAX_CLASSES", "ATTRSTYLE_DEFAULT_CLASSES", "ATTRSTYLE_POINT_ICON", "ATTRSTYLE_POINT_SIZE", "attrHexRgb", "attrRgbHex", "attrEdgeText"].map(constDecl).join("\n")
  + "\n" + [fn("rampColor"), fn("attrNumber"), between("const quantileAt", "/* Los bordes de los tramos"), fn("breakEdges"), fn("edgeClass"),
    fn("buildClassing"), fn("attrMarkerStyle")].join("\n")
  + "\nreturn { ATTRSTYLE_CATEGORICAL, ATTRSTYLE_RAMP, ATTRSTYLE_NONE, ATTRSTYLE_OTHER, rampColor, attrNumber, breakEdges, edgeClass, buildClassing, attrMarkerStyle };")(LEAFLET_PIN, DEFAULT_MARKER_STYLE);
const { ATTRSTYLE_CATEGORICAL, ATTRSTYLE_RAMP, ATTRSTYLE_NONE, ATTRSTYLE_OTHER, rampColor, attrNumber, breakEdges, edgeClass, buildClassing, attrMarkerStyle } = api;

/* ---------- Paletas ---------- */
const HEX = /^#[0-9a-f]{6}$/i;
ok(ATTRSTYLE_CATEGORICAL.length === 12 && ATTRSTYLE_CATEGORICAL.every(c => HEX.test(c)) && new Set(ATTRSTYLE_CATEGORICAL.map(c => c.toLowerCase())).size === 12,
  "12 colores categóricos válidos y todos distintos");
ok(!ATTRSTYLE_CATEGORICAL.some(c => c.toLowerCase() === ATTRSTYLE_NONE.toLowerCase() || c.toLowerCase() === ATTRSTYLE_OTHER.toLowerCase()), "los grises de «sin valor» y «Otros» no se confunden con una categoría");
const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
ok(ATTRSTYLE_RAMP.every((c, i) => i === 0 || lum(ATTRSTYLE_RAMP[i - 1]) > lum(c)), "la rampa oscurece de principio a fin (se lee sin color)");

/* ---------- Rampa ---------- */
ok(rampColor(0) === ATTRSTYLE_RAMP[0] && rampColor(1) === ATTRSTYLE_RAMP[ATTRSTYLE_RAMP.length - 1], "los extremos son las paradas primera y última");
ok(rampColor(0.25) === ATTRSTYLE_RAMP[1] && rampColor(0.5) === ATTRSTYLE_RAMP[2], "en una parada, esa parada exacta");
ok(HEX.test(rampColor(0.1)) && rampColor(0.1) !== rampColor(0.2), "entre paradas, interpolado");
ok(rampColor(-5) === rampColor(0) && rampColor(9) === rampColor(1) && rampColor(NaN) === rampColor(0), "fuera de [0, 1] o NaN se acota");
ok(rampColor(0.5, ["#000000", "#ffffff"]) === "#808080", "con otras paradas: el punto medio de negro y blanco");

/* ---------- Número de una celda ---------- */
ok(attrNumber("12") === 12 && attrNumber(" -3,5 ") === -3.5 && attrNumber("1e3") === 1000 && attrNumber(7) === 7, "números, con coma o punto decimal y espacios");
ok(attrNumber("") === null && attrNumber(null) === null && attrNumber("12 m") === null && attrNumber("abc") === null && attrNumber("1.2.3") === null, "lo que no es un número llano, null");

/* ---------- Bordes de los tramos ---------- */
ok(breakEdges([0, 3, 10], 5, "equal").join() === "0,2,4,6,8,10", "intervalos iguales entre el mínimo y el máximo: " + breakEdges([0, 3, 10], 5, "equal"));
ok(breakEdges([5, 5, 5], 4, "equal").join() === "5,5" && breakEdges([7], 3, "quantile").join() === "7,7", "todos iguales: un solo tramo degenerado");
const q = breakEdges([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5, "quantile");
ok(q.length === 6 && q[0] === 1 && q[5] === 10 && Math.abs(q[1] - 2.8) < 1e-9, "cuantiles de 1..10 en 5: " + q);
const skew = [1, 1, 1, 1, 1, 1, 1, 1, 2, 100];
const qs = breakEdges(skew, 5, "quantile");
ok(qs.every((e, i) => i === 0 || e > qs[i - 1]) && qs.length < 6, "con valores repetidos los bordes no se repiten (salen menos tramos): " + qs);
ok(breakEdges(skew, 5, "equal").length === 6, "los intervalos iguales no dependen de cómo se reparten los valores");
ok(breakEdges([-10, 10], 2, "equal").join() === "-10,0,10", "con negativos");

/* ---------- Tramo de un valor ---------- */
const e5 = [0, 2, 4, 6, 8, 10];
ok(edgeClass(0, e5) === 0 && edgeClass(1.99, e5) === 0 && edgeClass(2, e5) === 1, "un valor en un borde cae en el tramo de ARRIBA");
ok(edgeClass(10, e5) === 4 && edgeClass(9.99, e5) === 4, "el máximo cae en el último tramo");
ok(edgeClass(5, [5, 5]) === 0, "un tramo degenerado");

/* ---------- Categorías ---------- */
const cat = buildClassing(["b", "a", "b", "c", "b", "a", ""], "categories");
ok(cat.classes.map(c => c.label).join() === "b,a,c," && cat.classes[3].kind === "none", "más frecuentes primero, empates por orden alfabético, y «sin valor» al final: " + JSON.stringify(cat.classes.map(c => [c.kind, c.label, c.count])));
ok(cat.classes.map(c => c.count).join() === "3,2,1,1", "recuentos");
ok(cat.rowClass.join() === "0,1,0,2,0,1,3", "la clase de cada fila: " + cat.rowClass);
ok(cat.classes[0].color === ATTRSTYLE_CATEGORICAL[0] && cat.classes[2].color === ATTRSTYLE_CATEGORICAL[2] && cat.classes[3].color === ATTRSTYLE_NONE, "colores por orden de la paleta; sin valor, gris");
const caseSens = buildClassing(["a", "A", " a "], "categories");
ok(caseSens.classes.length === 2 && caseSens.classes[0].label === "a" && caseSens.classes[0].count === 2, "distingue mayúsculas y recorta espacios");
const many = Array.from({ length: 20 }, (_, i) => "v" + i);
const lots = buildClassing(many.concat(["v0", "v0", "v1"]), "categories");
ok(lots.classes.length === 12 && lots.classes[11].kind === "other" && lots.classes[11].color === ATTRSTYLE_OTHER, "más valores de los que caben: 11 + «Otros»: " + lots.classes.length);
ok(lots.classes[0].label === "v0" && lots.classes[1].label === "v1", "se quedan los más frecuentes");
ok(lots.classes.reduce((n, c) => n + c.count, 0) === 23 && lots.rowClass.every(c => c >= 0 && c < 12), "todas las filas tienen clase y los recuentos suman");
const withNone = buildClassing(many.concat([""]), "categories");
ok(withNone.classes.length === 12 && withNone.classes[10].kind === "other" && withNone.classes[11].kind === "none", "con «sin valor», 10 + «Otros» + «sin valor» sigue siendo 12: " + withNone.classes.map(c => c.kind));
ok(buildClassing(["x", "x"], "categories").classes.length === 1 && buildClassing([], "categories").classes.length === 0, "un solo valor, una clase; sin filas, ninguna");
ok(buildClassing([null, undefined, ""], "categories").classes.length === 1 && buildClassing([null], "categories").classes[0].kind === "none", "todo vacío: solo «sin valor»");

/* ---------- Graduado ---------- */
const grad = buildClassing(["0", "3", "10", "", "x", "10"], "graduated", 5, "equal");
ok(grad.classes.length === 6 && grad.classes[5].kind === "none" && grad.classes[5].count === 2, "5 tramos y «sin valor» para lo vacío o no numérico: " + JSON.stringify(grad.classes.map(c => [c.label, c.count])));
ok(grad.classes.slice(0, 5).map(c => c.label).join("|") === "0 – 2|2 – 4|4 – 6|6 – 8|8 – 10", "etiquetas de tramo: " + grad.classes.map(c => c.label));
ok(grad.rowClass.join() === "0,1,4,5,5,4", "tramo de cada fila (el 3 en el segundo, los 10 en el último): " + grad.rowClass);
ok(grad.classes[0].color === ATTRSTYLE_RAMP[0] && grad.classes[4].color === ATTRSTYLE_RAMP[4], "de la primera a la última parada de la rampa");
ok(grad.classes.reduce((n, c) => n + c.count, 0) === 6, "los recuentos suman");
const one = buildClassing(["4", "4"], "graduated", 5);
ok(one.classes.length === 1 && one.classes[0].label === "4" && one.classes[0].count === 2, "todos iguales: un tramo con ese valor: " + JSON.stringify(one.classes));
ok(buildClassing(["a", "b"], "graduated").classes.length === 1 && buildClassing(["a", "b"], "graduated").classes[0].kind === "none", "sin ningún número, solo «sin valor»");
ok(buildClassing(["1", "2", "3"], "graduated", 1).classes.length === 2 && buildClassing(Array.from({ length: 50 }, (_, i) => String(i)), "graduated", 50).classes.length === 9, "el número de clases se acota a 2–9");
const qg = buildClassing(Array.from({ length: 100 }, (_, i) => String(i)), "graduated", 4, "quantile");
ok(qg.classes.length === 4 && qg.classes.every(c => Math.abs(c.count - 25) <= 1), "cuantiles: unas 25 capas en cada una de 4 clases: " + qg.classes.map(c => c.count));
const qd = buildClassing(["1", "1", "1", "1", "1", "1", "2", "3"], "graduated", 4, "quantile");
ok(qd.classes.length < 4 && qd.classes.reduce((n, c) => n + c.count, 0) === 8, "cuantiles con muchos repetidos: menos clases y ninguna fila perdida: " + qd.classes.map(c => c.label));
ok(buildClassing(["-5", "5"], "graduated", 2).classes.map(c => c.label).join("|") === "-5 – 0|0 – 5", "con negativos");

/* ---------- Estilo de un marcador ---------- */
const pin = attrMarkerStyle({ ...DEFAULT_MARKER_STYLE }, "#ff0000");
ok(pin.icon === "circle" && pin.size === 26 && pin.color === "#ff0000" && pin.textSize === 13, "la gota de Leaflet (un PNG) pasa a un icono coloreable, conservando lo demás: " + JSON.stringify(pin));
const mdi = attrMarkerStyle({ ...DEFAULT_MARKER_STYLE, icon: "airplane", size: 30 }, "#00ff00");
ok(mdi.icon === "airplane" && mdi.size === 30 && mdi.color === "#00ff00", "un icono de MDI conserva icono y tamaño y solo cambia de color");
ok(attrMarkerStyle(undefined, "#123456").icon === "circle" && attrMarkerStyle(null, "#123456").color === "#123456", "sin estilo previo, parte del por defecto");
const base = { ...DEFAULT_MARKER_STYLE };
attrMarkerStyle(base, "#ff0000");
ok(base.icon === LEAFLET_PIN && base.color === "#1b5e97", "no muta el estilo de partida (los estilos se sustituyen, nunca se tocan)");

if (!process.exitCode) console.log("ATTR STYLE TESTS OK");
