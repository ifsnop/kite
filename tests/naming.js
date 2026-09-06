/* Autonumerado de las formas dibujadas y de las mediciones.

   El número se deduce de los nombres que YA hay en el árbol, no de un
   contador en memoria: una línea o un polígono dibujados vuelven de
   IndexedDB por el camino genérico t:"layer", que no sabe que los creó
   la herramienta de dibujo, así que un contador se reiniciaría en cada
   recarga y repetiría "Línea 1". Mediciones y formas comparten el
   mecanismo para que tampoco puedan llamarse igual entre sí.         */
const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const { parseHTML } = require("linkedom");
const fs = require("fs");
const script = fs.readFileSync(HTML_PATH, "utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];
function fn(name) {
  const i = script.indexOf(`function ${name}(`);
  if (i < 0) throw new Error("no encontrada: " + name);
  let depth = 0;
  for (let k = script.indexOf("{", i); k < script.length; k++) {
    if (script[k] === "{") depth++;
    else if (script[k] === "}" && --depth === 0) return script.slice(i, k + 1);
  }
}
const { document } = parseHTML("<div id='tree'></div>");
const treeEl = document.getElementById("tree");
const api = new Function("treeEl", "document",
  fn("nextNumberedName") + "\nreturn {nextNumberedName};")(treeEl, document);
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* Añade una fila con nombre; `pending` cuelga registros sin materializar */
function addRow(name, pending) {
  const li = document.createElement("li");
  li._name = name;
  if (pending) li._pending = pending;
  treeEl.appendChild(li);
  return li;
}
const reset = () => { treeEl.innerHTML = ""; };

/* ---------- Árbol vacío ---------- */
ok(api.nextNumberedName("Línea") === "Línea 1", "el primero es 1");
ok(api.nextNumberedName("Polígono") === "Polígono 1", "y por familia: Polígono 1");

/* ---------- Secuencia ---------- */
reset();
addRow("Línea 1"); addRow("Línea 2");
ok(api.nextNumberedName("Línea") === "Línea 3", "sigue la secuencia: " + api.nextNumberedName("Línea"));
/* Cada familia va por su cuenta */
ok(api.nextNumberedName("Polígono") === "Polígono 1",
  "los polígonos no heredan el número de las líneas");

/* ---------- Manda el MÁXIMO, no la cuenta ---------- */
reset();
addRow("Línea 1"); addRow("Línea 7");
ok(api.nextNumberedName("Línea") === "Línea 8",
  "con huecos manda el mayor, para no repetir un número vivo: " + api.nextNumberedName("Línea"));
/* Borrar el último no debe reciclar su número mientras quede uno mayor */
reset();
addRow("Línea 3");
ok(api.nextNumberedName("Línea") === "Línea 4", "tras borrar los anteriores sigue por encima del que queda");

/* ---------- Mediciones y formas comparten numeración ---------- */
reset();
addRow("Línea 1"); /* una medición */
ok(api.nextNumberedName("Línea") === "Línea 2",
  "una línea dibujada no reutiliza el número de una medición ya existente");

/* ---------- Nombres que NO son de la familia ---------- */
reset();
addRow("Línea"); addRow("Línea A"); addRow("Línea 2b"); addRow("Mi Línea 9"); addRow("Polígono 5");
ok(api.nextNumberedName("Línea") === "Línea 1",
  "solo cuenta el patrón exacto 'base N': " + api.nextNumberedName("Línea"));
/* El anclaje ^...$ es lo que impide que "Mi Línea 9" cuente como 9 */

/* ---------- Registros pendientes (carpeta nunca desplegada) ---------- */
reset();
addRow("Polígonos", [{ name: "Línea 4" }, { name: "Polígono 2" }]);
ok(api.nextNumberedName("Línea") === "Línea 5",
  "cuenta los registros pendientes, que existen aunque no tengan fila: " + api.nextNumberedName("Línea"));
ok(api.nextNumberedName("Polígono") === "Polígono 3", "y también los de la otra familia");
/* Anidados: una carpeta pendiente dentro de otra */
reset();
addRow("Raíz", [{ name: "Sub", children: [{ name: "Línea 11" }] }]);
ok(api.nextNumberedName("Línea") === "Línea 12",
  "también los pendientes anidados: " + api.nextNumberedName("Línea"));

/* ---------- Nodos sin nombre ---------- */
reset();
addRow(null); addRow(undefined); addRow("Línea 2");
ok(api.nextNumberedName("Línea") === "Línea 3", "un nodo sin nombre no rompe el barrido");

if (!process.exitCode) console.log("NAMING TESTS OK");
