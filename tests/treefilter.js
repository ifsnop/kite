/* Filtro del árbol (45-tree-filter.js, 40-panel-actions.js): lo PURO.

   La normalización que decide qué coincide, el recuento de coincidencias
   dentro de carpetas sin desplegar y el criterio con el que se construyen
   solo las filas que importan. Que el filtro oculte, abra y deje el árbol
   idéntico, con teclado y ratón de verdad, lo prueba
   tests/browser/tree-filter.mjs; la construcción parcial y el guardado a
   medio construir, tests/lazytree.js.                                    */
const { fn, constDecl } = require("./_extract");

const src = [
  constDecl("normSearch"), fn("rowKey"), "const recKeys = new WeakMap();", fn("recKey"),
  fn("countMatches"), fn("recWanted"),
  "let treeFilter = null; let filterWanted = new WeakMap();"
].join("\n");
const api = new Function(src + `\nreturn { normSearch, rowKey, recKey, countMatches, recWanted,
  setFilter: t => { treeFilter = t ? { term: normSearch(t) } : null; filterWanted = new WeakMap(); } };`)();

const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const { normSearch, rowKey, recKey, countMatches, recWanted, setFilter } = api;

/* ---------- Normalización: sin mayúsculas ni tildes, tal cual en lo demás ---------- */
ok(normSearch("Cañada") === "canada", "la ñ pierde la tilde: " + normSearch("Cañada"));
ok(normSearch("ZONA ÁÉÍÓÚ üñ") === "zona aeiou un", "mayúsculas y tildes: " + normSearch("ZONA ÁÉÍÓÚ üñ"));
ok(normSearch("Parcela 12-B") === "parcela 12-b", "dígitos, espacios y signos no cambian");
ok(normSearch("é") === "e" && normSearch("é") === "e", "una e con tilde combinada y la precompuesta dan lo mismo");
ok(normSearch(42) === "42" && normSearch("") === "", "no revienta con un número ni con vacío");
ok(normSearch("Zona").includes(normSearch("ON")), "busca dentro de las palabras, no palabras enteras");

/* ---------- Clave de una fila: se calcula una vez y se rehace al renombrar ---------- */
const li = { _name: "Zona Ñ" };
const k1 = rowKey(li);
ok(k1 === "zona n" && li._nk && li._nk.s === "Zona Ñ", "la clave de una fila: " + k1);
const guardada = li._nk;
ok(rowKey(li) === k1 && li._nk === guardada, "la segunda vez no se recalcula");
li._name = "Otra Cosa";
ok(rowKey(li) === "otra cosa" && li._nk !== guardada, "si se renombra, se rehace");

/* ---------- Clave de un registro: igual, pero sin ensuciar el registro ---------- */
const rec = { t: "layer", name: "Parcela É" };
ok(recKey(rec) === "parcela e" && !("_nk" in rec), "la clave de un registro va aparte, sin añadirle campos");
rec.name = "Zona";
ok(recKey(rec) === "zona", "y se rehace si el nombre cambia");

/* ---------- Recuento en carpetas sin desplegar (a cualquier profundidad) ---------- */
const arbol = [
  { name: "Zona 1", children: undefined },
  { name: "Otra", children: [{ name: "zona 2" }, { name: "Nada" }, { name: "Más", children: [{ name: "ZONA 3" }] }] },
  { name: "Parcela" }
];
ok(countMatches(arbol, "zon") === 3, "cuenta las coincidencias de todos los niveles: " + countMatches(arbol, "zon"));
ok(countMatches(arbol, "zzz") === 0 && countMatches([], "zon") === 0, "sin coincidencias, cero");
ok(countMatches(arbol, "a") >= 3, "una letra cuenta mucho y no revienta");

/* ---------- Qué se construye: lo que coincide o lleva algo que coincide dentro ---------- */
setFilter("zon");
ok(recWanted(arbol[0]) && recWanted(arbol[1]) && !recWanted(arbol[2]),
   "una carpeta se construye si algo de dentro coincide aunque ella no, y lo que no coincide queda fuera");
ok(recWanted(arbol[1].children[2]) && !recWanted(arbol[1].children[1]),
   "también a mayor profundidad: «Más» (con «ZONA 3» dentro) sí, «Nada» no");
setFilter("nada");
ok(recWanted(arbol[1]) && !recWanted(arbol[0]), "al cambiar el término se evalúa de nuevo (caché de cada pasada)");
setFilter("Ñ");
ok(!recWanted(arbol[2]), "sin coincidencia, no");

if (!process.exitCode) console.log("TREE FILTER TESTS OK");
