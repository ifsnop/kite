/* Tree filter (45-tree-filter.js, 40-panel-actions.js): the PURE parts.

   The normalization that decides what matches, the words of a search and the
   mask that lets a name match through the folders above it, where the typed
   words fall in a name (the highlight), and the plan over pending records:
   which ones match, which hold a match, and which a matching folder would
   show. That the filter hides, opens and leaves the tree identical, with real
   keyboard and mouse, is tests/browser/tree-filter.mjs; the partial build and
   the save of a half-built folder, tests/lazytree.js.                    */
const { fn, constDecl } = require("./_extract");

const src = [
  constDecl("normSearch"), fn("rowKey"), "const recKeys = new WeakMap();", fn("recKey"),
  constDecl("SEARCH_MAX_TOKENS"), fn("searchTokens"), fn("tokenMask"),
  constDecl("tokensAll"), constDecl("maskMatches"), fn("highlightRanges"),
  constDecl("F_MATCH"),
  "let treeFilter = null; let filterFlags = new WeakMap();",
  constDecl("recWanted"), fn("pendingMatches"), fn("planRecs")
].join("\n");
const api = new Function(src + `\nreturn { normSearch, rowKey, recKey, searchTokens, tokenMask, tokensAll,
  maskMatches, highlightRanges, pendingMatches, recWanted, SEARCH_MAX_TOKENS,
  setFilter: text => { const tokens = searchTokens(text); treeFilter = { tokens, all: tokensAll(tokens) };
    filterFlags = new WeakMap(); },
  plan: (records, inh, showing) => { const ctx = { matches: 0 }, list = [];
    planRecs(records, inh, showing, true, ctx, list); return { matches: ctx.matches, list: list.map(r => r.name) }; },
  flags: rec => filterFlags.get(rec) || 0 };`)();

const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const { normSearch, rowKey, recKey, searchTokens, tokenMask, tokensAll, maskMatches, highlightRanges,
  pendingMatches, recWanted, setFilter, plan, flags } = api;

/* ---------- Normalización: sin mayúsculas ni tildes, tal cual en lo demás ---------- */
ok(normSearch("Cañada") === "canada", "la ñ pierde la tilde: " + normSearch("Cañada"));
ok(normSearch("ZONA ÁÉÍÓÚ üñ") === "zona aeiou un", "mayúsculas y tildes: " + normSearch("ZONA ÁÉÍÓÚ üñ"));
ok(normSearch("Parcela 12-B") === "parcela 12-b", "dígitos, espacios y signos no cambian");
ok(normSearch("é") === "e" && normSearch("é") === "e", "una e con tilde combinada y la precompuesta dan lo mismo");
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

/* ---------- Las palabras de una búsqueda ---------- */
ok(same(searchTokens("Madrid  Parcela"), ["madrid", "parcela"]), "dos palabras, espacios de más ignorados");
ok(same(searchTokens("zona ZONA Zona"), ["zona"]), "las repetidas cuentan una vez");
ok(same(searchTokens("  Cañada "), ["canada"]), "sin tildes ni mayúsculas, sin espacios en los bordes");
ok(same(searchTokens(""), []) && same(searchTokens("   "), []), "vacío o solo espacios: ninguna palabra");
const diez = "a1 b2 c3 d4 e5 f6 g7 h8 i9 j10";
ok(searchTokens(diez).length === api.SEARCH_MAX_TOKENS && searchTokens(diez)[7] === "h8",
   "como mucho ocho palabras, las primeras: " + searchTokens(diez));

/* ---------- La máscara: qué palabras lleva un nombre y cuándo coincide ---------- */
const tk = ["madrid", "parcela"], todas = tokensAll(tk);
ok(todas === 3 && tokensAll(["x"]) === 1 && tokensAll([]) === 0, "la máscara de «todas»");
ok(tokenMask("parcela 3", tk) === 2 && tokenMask("madrid", tk) === 1 && tokenMask("x", tk) === 0
   && tokenMask("madrid parcela", tk) === 3, "bit i = la palabra i está en el nombre");
ok(maskMatches(2, 1, todas), "«Parcela 3» dentro de «Madrid» coincide con «madrid parcela»");
ok(!maskMatches(2, 0, todas), "sola, «Parcela 3» no tiene «madrid»");
ok(!maskMatches(0, todas, todas), "un nombre que no lleva ninguna palabra no coincide aunque la ruta las tenga todas");
ok(maskMatches(3, 0, todas), "un nombre con las dos coincide solo");
ok(maskMatches(1, 0, 1) && !maskMatches(0, 0, 1), "con una palabra es «el nombre la contiene», como siempre");

/* ---------- Dónde cae lo escrito en un nombre (el resaltado) ---------- */
ok(same(highlightRanges("Cañada", ["cana"]), [[0, 4]]), "«cana» marca «Caña»: " + JSON.stringify(highlightRanges("Cañada", ["cana"])));
ok(same(highlightRanges("Zona Zona", ["zon"]), [[0, 3], [5, 8]]), "todas las apariciones");
ok(same(highlightRanges("Parcela 3 Madrid", ["madrid", "parcela"]), [[0, 7], [10, 16]]),
   "varias palabras, en orden de aparición y no en el de escritura");
ok(same(highlightRanges("abcd", ["abc", "bcd"]), [[0, 4]]), "los solapes se funden");
ok(same(highlightRanges("abab", ["ab"]), [[0, 4]]), "los contiguos también");
ok(same(highlightRanges("Cañada", ["cana"]), [[0, 5]]),
   "una ñ escrita descompuesta (n + tilde combinada) se marca entera: " + JSON.stringify(highlightRanges("Cañada", ["cana"])));
ok(same(highlightRanges("😀 zona", ["zona"]), [[3, 7]]), "un carácter fuera del plano básico no desplaza los índices");
ok(same(highlightRanges("Nada", ["zzz"]), []) && same(highlightRanges("", ["a"]), []), "sin coincidencia, nada");

/* ---------- El plan sobre registros pendientes ---------- */
const arbol = [
  { name: "Madrid", collapsed: true, children: [
    { name: "Parcela 1" }, { name: "Otra" },
    { name: "Sub", collapsed: false, children: [{ name: "Parcela 2" }, { name: "Nada" }] },
    { name: "Cerrada", collapsed: true, children: [{ name: "Zona" }] } ] },
  { name: "Parcela 9" }
];
const [madrid, parcela9] = arbol, [p1, otra, sub, cerrada] = madrid.children;

setFilter("parcela");
let r = plan(arbol, 0, false);
ok(r.matches === 3, "«parcela»: tres coincidencias a cualquier profundidad: " + r.matches);
ok(recWanted(madrid) && recWanted(sub) && recWanted(parcela9) && !recWanted(otra) && !recWanted(cerrada),
   "se construye lo que coincide o lleva una coincidencia dentro, y nada más");
ok((flags(madrid) & 1) === 0 && (flags(p1) & 1) === 1, "«Madrid» no coincide por sí mismo; «Parcela 1», sí");
ok(pendingMatches(arbol) === 3, "el «(n)» de una carpeta sin construir: " + pendingMatches(arbol));
ok(r.list.length === 0, "con la carpeta sin enseñarse, no hay nada que construir de su contenido");

/* Una carpeta que coincide enseña lo que tiene, un nivel: lo guardado abierto se ve abierto */
setFilter("madrid");
r = plan(madrid.children, tokenMask("madrid", searchTokens("madrid")), true);
ok(same(r.list, ["Parcela 1", "Otra", "Sub", "Parcela 2", "Nada", "Cerrada"]),
   "lo que se vería: sus hijas y lo de dentro de la subcarpeta abierta, en orden: " + r.list);
ok(!r.list.includes("Zona"), "lo de dentro de la subcarpeta CERRADA no se enseña (se vería al desplegarla)");
ok(r.matches === 0, "enseñarlo no son coincidencias: el contador no lo cuenta");

/* Una carpeta que coincide pero cuyo padre no se enseña no se puede construir por esta lista */
setFilter("madrid");
r = plan(arbol, 0, false);
ok(r.matches === 1 && r.list.length === 0, "«Madrid» coincide pero no se construye a través de otra carpeta que no se ve: " + r.list);

/* Varias palabras: la ruta cuenta */
setFilter("madrid parcela");
r = plan(arbol, 0, false);
ok(r.matches === 2, "«madrid parcela»: «Parcela 1» y «Parcela 2» dentro de «Madrid»; «Parcela 9» no: " + r.matches);
ok(recWanted(madrid) && recWanted(sub) && !recWanted(parcela9) && (flags(p1) & 1) === 1 && (flags(madrid) & 1) === 0,
   "«Madrid» solo lleva una de las dos palabras: es camino, no coincidencia");

/* Un término cambiado se evalúa de nuevo: las marcas son de cada pasada */
setFilter("zona");
r = plan(arbol, 0, false);
ok(r.matches === 1 && recWanted(cerrada) && recWanted(madrid) && !recWanted(p1),
   "otro término, otras marcas (las de la pasada anterior no valen)");
ok(pendingMatches(arbol) === 1, "y otro recuento");
setFilter("nadaquecoincida");
r = plan(arbol, 0, false);
ok(r.matches === 0 && pendingMatches(arbol) === 0 && !recWanted(madrid), "sin coincidencias, todo en cero");

if (!process.exitCode) console.log("TREE FILTER TESTS OK");
