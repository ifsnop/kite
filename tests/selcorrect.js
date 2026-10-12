const { parseHTML } = require("linkedom");
const { fn, between } = require("./_extract");
const src = between("/* ---------- Selección ----------", "/* Nombre legible del tipo");
const top = fn("topLevelSelection");

/* Temporizadores controlados a mano (mismo patrón que tests/msglog.js):
   announceSelectionCount debate con setTimeout, así que hace falta
   poder expirarlo a voluntad en vez de esperar de verdad.             */
const timers = new Map();
let nextTimer = 1;
global.setTimeout = f => { const id = nextTimer++; timers.set(id, f); return id; };
global.clearTimeout = id => timers.delete(id);
const fireTimers = () => { for (const f of timers.values()) f(); timers.clear(); };

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
   para comprobar el aviso del número de nodos seleccionados.         */
let navCalls = [];
const navMessage = (txt, opts) => { navCalls.push({ txt, opts }); };
/* selectRange queda fuera: depende de nextRow/prevRow/isRow, del
   recorrido del árbol que prueba tests/navtest.js aparte. Aquí basta
   con toggleOne, que llama a announceSelectionCount igual que
   selectRange y no necesita nada de eso.                             */
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

/* ---------- announceSelectionCount: aviso informativo, no un error ----------
   toggleOne llama a announceSelectionCount, que debate con setTimeout
   (SEL_COUNT_DEBOUNCE_MS) para no inundar el panel si Mayús+flecha se
   mantiene pulsado: hace falta expirar el temporizador a mano.       */
clearSelection(); navCalls = [];
toggleOne(a); // 1 nodo: nada que avisar
fireTimers();
ok(navCalls.length === 0, "un solo nodo seleccionado no genera aviso: " + navCalls.length);

toggleOne(b); // 2 nodos
fireTimers();
ok(navCalls.length === 1 && navCalls[0].txt === "2 nodos seleccionados.",
  "dos nodos avisan con el recuento: " + JSON.stringify(navCalls));
ok(navCalls[0].opts.tone === "info", "el aviso es informativo, no un error: " + navCalls[0].opts.tone);

toggleOne(c); // 3 nodos
fireTimers();
ok(navCalls.length === 2 && navCalls[1].txt === "3 nodos seleccionados.",
  "seguir añadiendo nodos sigue avisando con el recuento nuevo: " + JSON.stringify(navCalls));

toggleOne(c); // vuelve a 2 nodos (quita c)
fireTimers();
ok(navCalls.length === 3 && navCalls[2].txt === "2 nodos seleccionados.",
  "quitar un nodo también actualiza el recuento mientras queden varios");

toggleOne(b); // vuelve a 1 nodo (queda solo a)
fireTimers();
ok(navCalls.length === 3, "volver a un solo nodo no genera un aviso nuevo: " + navCalls.length);

/* Pulsaciones rápidas (Mayús+flecha mantenido): solo se avisa una vez,
   con el recuento final, no una vez por pulsación.                    */
clearSelection(); navCalls = [];
toggleOne(a); toggleOne(b); toggleOne(c); toggleOne(f);
ok(navCalls.length === 0, "mientras no se expire el temporizador no hay aviso todavía: " + navCalls.length);
fireTimers();
ok(navCalls.length === 1 && navCalls[0].txt === "4 nodos seleccionados.",
  "cuatro toques rápidos fundidos en un único aviso con el recuento final: " + JSON.stringify(navCalls));

if (!process.exitCode) console.log("SELECTION CORRECTNESS OK");
