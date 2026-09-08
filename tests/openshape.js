/* Formas abiertas: una línea no tiene área ni relleno.

   Rellenar un trazo abierto obliga a Leaflet a cerrarlo por su cuenta
   para pintar la superficie, dibujando un lado que el usuario nunca
   trazó. La regla se aplica en la CAPA (clearFillOnOpenPaths), no solo
   en el diálogo, porque un placemark KML comparte un mismo objeto de
   estilo entre todas sus geometrías: si trae un polígono y una línea,
   el polígono sí quiere relleno y la línea no debe recibirlo.        */
const { fn } = require("./_extract");

/* Jerarquía real de Leaflet: Polygon extiende Polyline, que es lo que
   obliga a comprobar Polygon ANTES que Polyline en cada recorrido.   */
class Polyline {
  constructor(tag) { this.tag = tag; this.style = {}; }
  setStyle(s) { Object.assign(this.style, s); }
}
class Polygon extends Polyline {}
class Group {
  constructor(tag, kids) { this.tag = tag; this.kids = kids; }
  eachLayer(f) { this.kids.forEach(f); }
}
global.L = { Polyline, Polygon };

/* nodeLayer se stubea: isOpenOnly solo lo usa para llegar a la capa */
const src = "function nodeLayer(li) { return li.layer; }\n"
  + fn("isOpenOnly") + "\n" + fn("clearFillOnOpenPaths");
const api = new Function(src + "\nreturn {isOpenOnly, clearFillOnOpenPaths};")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* ---------- isOpenOnly ---------- */
ok(api.isOpenOnly({ layer: new Polyline("l") }) === true, "una polilínea suelta es abierta");
ok(api.isOpenOnly({ layer: new Polygon("p") }) === false, "un polígono no es abierto");
/* Polygon extiende Polyline: si el orden de comprobación se invirtiera,
   un polígono contaría como línea y perdería su relleno y su área.   */
ok(api.isOpenOnly({ layer: new Group("g", [new Polygon("p")]) }) === false,
  "un polígono dentro de un grupo tampoco (Polygon extiende Polyline)");
ok(api.isOpenOnly({ layer: new Group("g", [new Polyline("l1"), new Polyline("l2")]) }) === true,
  "un grupo de solo líneas es abierto");
/* El caso del placemark KML con las dos geometrías: manda el polígono */
ok(api.isOpenOnly({ layer: new Group("g", [new Polyline("l"), new Polygon("p")]) }) === false,
  "un grupo con línea Y polígono no es abierto: el polígono sí puede rellenarse");
ok(api.isOpenOnly({ layer: new Group("g", []) }) === false, "un grupo vacío no es una forma abierta");
ok(api.isOpenOnly({ layer: null }) === false, "un nodo sin capa no es una forma abierta");
/* Anidamiento a dos niveles */
ok(api.isOpenOnly({ layer: new Group("g", [new Group("h", [new Polygon("p")])]) }) === false,
  "el polígono se encuentra aunque esté anidado");

/* ---------- clearFillOnOpenPaths ---------- */
const line = new Polyline("l"), poly = new Polygon("p");
line.setStyle({ fill: true, color: "#f00" });
poly.setStyle({ fill: true, color: "#f00" });
api.clearFillOnOpenPaths(new Group("g", [line, poly]));
ok(line.style.fill === false, "a la línea se le quita el relleno: " + line.style.fill);
ok(poly.style.fill === true, "al polígono del MISMO grupo se le respeta: " + poly.style.fill);
ok(line.style.color === "#f00", "y no se le toca nada más que el relleno");

/* Una capa suelta (una línea dibujada se añade directa, sin grupo) */
const bare = new Polyline("bare");
bare.setStyle({ fill: true });
api.clearFillOnOpenPaths(bare);
ok(bare.style.fill === false, "también sobre una línea suelta, sin grupo");

/* Anidada a dos niveles */
const deep = new Polyline("deep");
deep.setStyle({ fill: true });
api.clearFillOnOpenPaths(new Group("g", [new Group("h", [deep])]));
ok(deep.style.fill === false, "y a través de grupos anidados");

if (!process.exitCode) console.log("OPEN SHAPE TESTS OK");
