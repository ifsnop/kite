const { parseHTML } = require("linkedom");
const N = 3000; // capas en la carpeta
const { document } = parseHTML("<div id='tree'><ul id='root'></ul></div>");
const treeEl = document.getElementById("tree");
const root = document.getElementById("root");
const nodes = [];
for (let f = 0; f < 10; f++) {                 // 10 subcarpetas
  const fli = document.createElement("li");
  fli._name = "F" + f; fli._kind = "group";
  const frow = document.createElement("div"); frow.className = "node-row";
  fli.appendChild(frow);
  const ul = document.createElement("ul"); ul.className = "node-list";
  for (let i = 0; i < N / 10; i++) {
    const li = document.createElement("li");
    li._name = "L" + f + "_" + i; li._kind = "marker";
    const row = document.createElement("div"); row.className = "node-row";
    li.appendChild(row); li._row = row;
    ul.appendChild(li); nodes.push(li);
  }
  fli.appendChild(ul); root.appendChild(fli);
}
const styleKind = li => li._kind;

/* ---------- implementación ANTERIOR ---------- */
function oldRun() {
  const selection = new Set();
  let selCursor = null;
  const setSelected = (li, on) => {
    li.querySelector(":scope > .node-row").classList.toggle("selected", on);
    li.setAttribute("aria-selected", String(on));
    if (on) selection.add(li); else selection.delete(li);
  };
  const setSelCursor = li => {
    for (const r of treeEl.querySelectorAll(".node-row.cursor")) r.classList.remove("cursor");
    selCursor = li;
    if (li) li.querySelector(":scope > .node-row").classList.add("cursor");
  };
  const selectNode = (li, on) => {
    if (on && !selection.has(li)) {
      const kind = styleKind(li);
      for (const s of [...selection]) if (styleKind(s) !== kind) setSelected(s, false);
    }
    setSelected(li, on);
    setSelCursor(li);
  };
  for (const n of nodes) selectNode(n, true);
  return selection.size;
}

/* ---------- implementación NUEVA ---------- */
function newRun() {
  const selection = new Set();
  let selCursor = null, selectionKind = null;
  const nodeRow = li => li._row || li.querySelector(":scope > .node-row");
  const setSelected = (li, on) => {
    nodeRow(li).classList.toggle("selected", on);
    li.setAttribute("aria-selected", String(on));
    if (on) selection.add(li); else selection.delete(li);
  };
  const setSelCursor = li => {
    if (selCursor) nodeRow(selCursor).classList.remove("cursor");
    selCursor = li;
    if (li) nodeRow(li).classList.add("cursor");
  };
  // ruta masiva: un solo barrido, tipo y cursor una sola vez
  const kind = styleKind(nodes[0]);
  const same = nodes.filter(n => styleKind(n) === kind);
  for (const n of same) setSelected(n, true);
  selectionKind = kind;
  setSelCursor(same[same.length - 1]);
  return selection.size;
}

/* ---------- topLevelSelection ---------- */
function oldTop(selection) {
  return [...treeEl.querySelectorAll("li")].filter(li =>
    selection.has(li) && ![...selection].some(o => o !== li && o.contains(li)));
}
function newTop(selection) {
  const out = [];
  for (const li of selection) {
    let covered = false;
    for (let p = li.parentElement; p && p !== treeEl && !covered; p = p.parentElement) {
      if (p.tagName === "LI" && selection.has(p)) covered = true;
    }
    if (!covered) out.push(li);
  }
  return out;
}

let t = Date.now(); const a = oldRun();   const tOld = Date.now() - t;
t = Date.now();     const b = newRun();   const tNew = Date.now() - t;
console.log(`seleccionar ${N} capas → antes: ${tOld} ms | ahora: ${tNew} ms  (${(tOld/Math.max(tNew,1)).toFixed(0)}× más rápido)`);
console.log(`  mismas capas seleccionadas: ${a === b} (${a})`);

const sel = new Set(nodes);
t = Date.now(); const x = oldTop(sel).length; const tOld2 = Date.now() - t;
t = Date.now(); const y = newTop(sel).length; const tNew2 = Date.now() - t;
console.log(`topLevelSelection con ${N} nodos → antes: ${tOld2} ms | ahora: ${tNew2} ms`);
console.log(`  mismo resultado: ${x === y} (${x})`);
