const { parseHTML } = require("linkedom");
const { fn, between } = require("./_extract");
const src = between("/* ---------- Selección ----------", "/* Nombre legible del tipo");
const top = fn("topLevelSelection");

const { document } = parseHTML("<div id='tree'><ul id='root'></ul></div>");
global.document = document;
const treeEl = document.getElementById("tree");
const mk = (name, kind) => {
  const li = document.createElement("li");
  li._name = name; li._kind = kind;
  const row = document.createElement("div"); row.className = "node-row";
  li.appendChild(row); li._row = row;
  return li;
};
const styleKind = li => li._kind;
/* navMessage de prueba: registra cada llamada en vez de pintar nada,
   para comprobar que seleccionar NO avisa de nada.                   */
let navCalls = [];
const navMessage = (txt, opts) => { navCalls.push({ txt, opts }); };
/* selectRange queda fuera: depende de nextRow/prevRow/isRow, del
   recorrido del árbol que prueba tests/navtest.js aparte. Aquí basta
   con toggleOne, que no necesita nada de eso.                        */
const api = new Function("treeEl", "styleKind", "navMessage",
  src + "\n" + top +
  "\nreturn {selection, selectNode, toggleOne, clearSelection, setSelected," +
  " topLevelSelection, cursor: () => selCursor};")(treeEl, styleKind, navMessage);
const { selection, selectNode, toggleOne, clearSelection, topLevelSelection, setSelected } = api;
const ok = (c,m) => { if(!c){ console.error("FAIL: "+m); process.exitCode=1; } };

const root = document.getElementById("root");
const a = mk("a","marker"), b = mk("b","marker"), c = mk("c","polygon"), f = mk("f","group");
for (const n of [a,b,c,f]) root.appendChild(n);
const inner = mk("inner","marker"); f.appendChild(inner);

// la selección ya NO exige un tipo común: eso lo comprueba el diálogo
selectNode(a, true); selectNode(b, true);
ok(selection.size === 2, "dos marcadores conviven");
setSelected(c, true);
ok(selection.size === 3, "y un polígono se les puede sumar: " + selection.size);
clearSelection();
ok(selection.size === 0 && api.cursor() === null, "limpiar deja el cursor libre");

// el cursor solo marca una fila
selectNode(a, true); selectNode(b, true);
ok(api.cursor() === b, "el cursor es el último tocado");
ok(!a._row.className.includes("cursor"), "el anterior pierde la marca de cursor");
ok(b._row.className.includes("cursor"), "el actual la tiene");

// topLevelSelection: lo contenido viaja con su ancestro
clearSelection();
setSelected(f, true); setSelected(inner, true); setSelected(a, true);
const tops = topLevelSelection().map(n => n._name).sort();
ok(tops.join() === "a,f", "el nodo interior no sube como raíz: " + tops.join());
ok(topLevelSelection().length === 2, "y solo suben dos");

/* ---------- Seleccionar no avisa de nada ----------
   Antes, con dos o más nodos el panel decía «N nodos seleccionados.»
   (announceSelectionCount, retirado): ruido en cada Mayús+clic o
   Mayús+flecha. La cifra ya se ve en las filas marcadas.            */
clearSelection(); navCalls = [];
toggleOne(a); toggleOne(b); toggleOne(c); toggleOne(f);
ok(selection.size === 4, "se seleccionan los cuatro: " + selection.size);
ok(navCalls.length === 0, "seleccionar varios nodos no genera aviso: " + JSON.stringify(navCalls));
toggleOne(c); toggleOne(f);
ok(navCalls.length === 0, "ni deseleccionarlos: " + JSON.stringify(navCalls));

if (!process.exitCode) console.log("SELECTION CORRECTNESS OK");
