const { parseHTML } = require("linkedom");
const { fn } = require("./_extract");

const { document } = parseHTML("<div id='tree'></div>");
global.document = document;
const treeEl = document.getElementById("tree");
const rootUl = document.createElement("ul");
rootUl.className = "node-list";
treeEl.appendChild(rootUl);

/* Árbol de prueba:  A  [F1: b, c, [F2: d]]  E   */
function node(name, folder) {
  const li = document.createElement("li");
  li._name = name;
  const row = document.createElement("div"); row.className = "node-row";
  li.appendChild(row); li._row = row;
  row.scrollIntoView = () => {};
  if (folder) {
    const ul = document.createElement("ul"); ul.className = "node-list";
    li.appendChild(ul);
  }
  return li;
}
const A = node("A"), F1 = node("F1", true), E = node("E");
const b = node("b"), c = node("c"), F2 = node("F2", true), d = node("d");
rootUl.append(A, F1, E);
F1.lastElementChild.append(b, c, F2);
F2.lastElementChild.append(d);

/* Se cargan las funciones reales del panel, una a una: extraer rangos
   amplios arrastraba código con efectos (showEmptyMessage) que borraba
   el árbol de prueba antes de mirarlo.                                */
const src = `
  const nodeUl = li => li.querySelector(':scope > ul.node-list');
  const scheduleSave = () => {}; const syncExpanded = () => {};
  const navMessage = () => {};
  const materializeCalls = [];
  const ensureMaterialized = async li => { materializeCalls.push(li); }; /* nada pendiente en este árbol de prueba */
  const ensureRootUl = () => rootUl;
  function makeNode({ name, isFolder }) {
    const li = document.createElement("li");
    li._name = name;
    const row = document.createElement("div"); row.className = "node-row";
    li.appendChild(row); li._row = row;
    row.scrollIntoView = () => {};
    if (isFolder) {
      const ul = document.createElement("ul"); ul.className = "node-list";
      li.appendChild(ul);
    }
    return li;
  }
  const nodeRow = li => li._row;
  const selection = new Set();
  let selCursor = null, selAnchor = null;
  const isRow = li => li && li.tagName === "LI" && li._name !== undefined;
  const isOpen = li => nodeUl(li) && !li.classList.contains("collapsed");
  const childRows = ul => (ul ? [...ul.children].filter(isRow) : []);
  const parentRow = li => { const p = li.parentElement && li.parentElement.closest("li"); return isRow(p) ? p : null; };
  const siblingRows = li => childRows(li ? li.parentElement : rootUl);
  const firstRow = () => childRows(rootUl)[0] || null;
` + ["setSelected","setSelCursor","clearSelection","selectNode","selectRange",
     "toggleOne","nextSiblingRow","prevSiblingRow","nextRow","lastVisibleIn",
     "prevRow","stepRows","moveCursorTo","expandOrEnter","collapseOrLeave",
     "createFolderNode","cursorAfterDelete"].map(fn).join("\n");
const api = new Function("treeEl", "rootUl", src +
  "\nreturn {nextRow, prevRow, stepRows, siblingRows, selectRange, moveCursorTo, selectNode, toggleOne," +
  " clearSelection, selection, expandOrEnter, collapseOrLeave, cursor:()=>selCursor," +
  " createFolderNode, materializeCalls, cursorAfterDelete};")(treeEl, rootUl);

const ok = (c,m) => { if(!c){ console.error("FAIL: "+m); process.exitCode=1; } };
const names = set => [...set].map(n => n._name).sort().join("");

// con todo desplegado, el recorrido visible es el árbol entero en orden
const order = () => { const out=[]; for (let n=A; n; n=api.nextRow(n)) out.push(n._name); return out.join(""); };
const orderBack = () => { const out=[]; for (let n=E; n; n=api.prevRow(n)) out.unshift(n._name); return out.join(""); };
ok(order() === "AF1bcF2dE", "orden visible hacia delante: " + order());
ok(orderBack() === "AF1bcF2dE", "y el mismo hacia atrás: " + orderBack());

// una carpeta colapsada oculta su rama, pero NO cambia el estado interno
F1.classList.add("collapsed");
ok(order() === "AF1E", "F1 colapsada oculta su rama: " + order());
F2.classList.add("collapsed");
F1.classList.remove("collapsed");
ok(order() === "AF1bcF2E", "F2 sigue colapsada al reabrir F1: " + order());
F2.classList.remove("collapsed");

// Inicio/Fin trabajan sobre la carpeta actual, no sobre la lista entera
ok(api.siblingRows(c).map(n=>n._name).join("") === "bcF2", "hermanos dentro de F1");
ok(api.siblingRows(A).map(n=>n._name).join("") === "AF1E", "en la raíz, los de la raíz");

// las flechas olvidan la selección anterior
api.selectNode(b, true); api.selectNode(c, true);
ok(api.selection.size === 2, "dos nodos marcados a mano");
api.moveCursorTo(d, false);
ok(api.selection.size === 1 && api.selection.has(d), "moverse sin Shift deja solo el nodo nuevo");

// Shift extiende el rango desde el ancla, en ambos sentidos
api.clearSelection(); api.selectNode(b, true);
api.moveCursorTo(F2, true);
ok(names(api.selection) === "F2bc", "rango hacia abajo: " + names(api.selection));
api.moveCursorTo(A, true);
ok(names(api.selection) === "AF1b", "rango hacia arriba desde la misma ancla: " + names(api.selection));

// Ctrl+Shift añade sin arrastrar los intermedios
api.clearSelection(); api.selectNode(A, true); api.toggleOne(d);
ok(names(api.selection) === "Ad", "solo los dos extremos: " + names(api.selection));
api.toggleOne(d);
ok(names(api.selection) === "A", "y vuelve a quitarlo: " + names(api.selection));

// derecha despliega y luego entra; izquierda colapsa y luego sube
F1.classList.add("collapsed");
api.clearSelection(); api.selectNode(F1, true);
api.expandOrEnter(F1, false);
ok(!F1.classList.contains("collapsed"), "derecha despliega");
api.expandOrEnter(F1, false);
ok(api.cursor() === b, "derecha otra vez entra en el primer hijo");
api.collapseOrLeave(b, false);
ok(api.cursor() === F1, "izquierda desde una hoja sube a la carpeta");
api.collapseOrLeave(F1, false);
ok(F1.classList.contains("collapsed"), "izquierda sobre una carpeta abierta la cierra");
// se vuelve a dejar todo desplegado: las pruebas anteriores cerraron F1
F1.classList.remove("collapsed"); F2.classList.remove("collapsed");
ok(order() === "AF1bcF2dE", "árbol de nuevo desplegado: " + order());

// saltos de página, con tope en los extremos
ok(api.stepRows(A, 3)._name === "c", "tres filas abajo desde A: " + api.stepRows(A,3)._name);
ok(api.stepRows(A, 99)._name === "E", "el salto largo se para en la última");
ok(api.stepRows(E, -99)._name === "A", "y hacia arriba en la primera");
ok(api.stepRows(d, 1)._name === "E", "salir de una subcarpeta al hermano del ancestro");
ok(api.prevRow(E)._name === "d", "la anterior a E es la última visible de la rama");

/* cursorAfterDelete: dónde debe aterrizar el cursor de teclado tras borrar
   (botón × o Supr), sobre el árbol AF1[bcF2[d]]E, con las relaciones
   todavía intactas (se llama ANTES de borrar de verdad).               */
ok(api.cursorAfterDelete(c, [c])._name === "F2",
   "borrar una hoja: el cursor pasa a la siguiente fila visible");
ok(api.cursorAfterDelete(E, [E])._name === "d",
   "borrar la última fila: cae hacia atrás, a la anterior");
ok(api.cursorAfterDelete(F1, [F1])._name === "E",
   "borrar una carpeta entera: salta toda su rama, no entra en ella");
ok(api.cursorAfterDelete(A, [A, F1])._name === "E",
   "borrar varios nodos contiguos: salta todos los que desaparecen");
ok(api.cursorAfterDelete(A, [A, F1, E]) === null,
   "borrar el árbol entero: no queda nada donde aterrizar");
ok(api.cursorAfterDelete(rootUl, [A]) === null,
   "ancla que no es una fila: no hay cursor que mover");

/* createFolderNode: "Nueva carpeta" cuelga SIEMPRE dentro de una carpeta
   activa (desplegándola si hacía falta), nunca como su hermana; para
   cualquier otro cursor (u hoja, o ninguno) se coloca como hermano
   justo después, o en la raíz.                                        */
(async () => {
  const r1 = await api.createFolderNode(null, "Nueva1");
  ok(r1.parentElement === rootUl && rootUl.lastElementChild === r1,
     "sin cursor: a la raíz, al final");

  const r2 = await api.createFolderNode(E, "Nueva2");
  ok(r2.parentElement === rootUl && E.nextSibling === r2,
     "cursor en una hoja: como hermano justo después");

  const beforeExpanded = api.materializeCalls.length;
  const r3 = await api.createFolderNode(F1, "Nueva3");
  ok(r3.parentElement === F1.lastElementChild && r3.parentElement.lastElementChild === r3,
     "cursor en carpeta ya desplegada: dentro, al final");
  ok(api.materializeCalls.length === beforeExpanded,
     "una carpeta ya desplegada no llama a ensureMaterialized");

  F2.classList.add("collapsed");
  const beforeCollapsed = api.materializeCalls.length;
  const r4 = await api.createFolderNode(F2, "Nueva4");
  ok(!F2.classList.contains("collapsed"), "cursor en carpeta colapsada: se despliega");
  ok(api.materializeCalls.length === beforeCollapsed + 1 && api.materializeCalls.at(-1) === F2,
     "y se materializa antes de insertar");
  ok(r4.parentElement === F2.lastElementChild && r4.parentElement.lastElementChild === r4,
     "y entra dentro, al final");

  if (!process.exitCode) console.log("NAV TESTS OK");
})();
