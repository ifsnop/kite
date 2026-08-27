const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const { parseHTML } = require("linkedom");
const fs = require("fs");
const script = fs.readFileSync(HTML_PATH, "utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];

/* Same isolated-function extraction as navtest.js/reordertest.js. */
function fn(name) {
  let i = script.indexOf(`function ${name}(`);
  if (i < 0) throw new Error("no encontrada: " + name);
  let depth = 0, j = script.indexOf("{", i);
  for (let k = j; k < script.length; k++) {
    if (script[k] === "{") depth++;
    else if (script[k] === "}" && --depth === 0) return script.slice(i, k + 1);
  }
}

const { document } = parseHTML("<div id='tree'></div>");
global.document = document;
const treeEl = document.getElementById("tree");

const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* ---- ensureRootUl: role="group" on the tree's own top-level <ul> ----
   Found via axe-core against a live, populated tree (2026-08-26): without
   it, #tree (role=tree) has an untyped <ul> child, which axe flags as
   THREE cascading violations (aria-required-children on #tree,
   aria-required-parent on every top-level treeitem, and the generic
   `list` rule) — all three are really this one missing attribute.      */
{
  let rootUl = null;
  const src = `let rootUl = null;\n${fn("ensureRootUl")}\nreturn { ensureRootUl, get rootUl() { return rootUl; } };`;
  const { ensureRootUl } = new Function("treeEl", src)(treeEl);
  const ul = ensureRootUl();
  ok(ul.getAttribute("role") === "group", "el <ul> raíz del árbol lleva role=group: " + ul.getAttribute("role"));
  ok(ul.className === "node-list", "sigue siendo .node-list");
  ok(ul.parentElement === treeEl, "cuelga directamente de #tree");
}

/* ---- setNodeName: aria-label del checkbox se mantiene al renombrar ----
   Sin `for` en el <label> (decisión de UX: el nombre selecciona la fila,
   no activa la casilla), la casilla se queda sin nombre accesible salvo
   por este aria-label — y como el texto vive en dos sitios (label y
   aria-label), renombrar solo el primero lo deja obsoleto.             */
{
  const li = document.createElement("li");
  li._name = "Capa original";
  const row = document.createElement("div");
  row.className = "node-row";
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.setAttribute("aria-label", "Activar o desactivar «Capa original»");
  const label = document.createElement("label");
  label.textContent = "Capa original";
  row.append(chk, label);
  li.appendChild(row);

  const src = `
    const scheduleSave = () => {};
    const applyMarkerText = () => {};
    ${fn("setNodeName")}
    return { setNodeName };
  `;
  const { setNodeName } = new Function(src)();

  setNodeName(li, "Capa renombrada");
  ok(label.textContent === "Capa renombrada", "el <label> se actualiza: " + label.textContent);
  ok(chk.getAttribute("aria-label") === "Activar o desactivar «Capa renombrada»",
     "el aria-label de la casilla sigue al nombre nuevo: " + chk.getAttribute("aria-label"));

  // A no-op rename (same name, or blank after trim) must not desync either.
  setNodeName(li, "Capa renombrada");
  ok(chk.getAttribute("aria-label") === "Activar o desactivar «Capa renombrada»",
     "un renombrado sin cambio no rompe el aria-label existente");
}

/* ---- setSelCursor: aria-activedescendant sigue al cursor de teclado ----
   #tree tiene un único tabindex; sin esto, un lector de pantalla no
   puede saber qué fila movieron las flechas (el resaltado ".cursor" es
   solo visual). Cada <li> necesita su `id` propio: aquí se simula el que
   makeNode ya les da (ver ese test de más abajo para la asignación real). */
{
  const li1 = document.createElement("li");
  li1.id = "node-1";
  const row1 = document.createElement("div"); row1.className = "node-row";
  li1.appendChild(row1); li1._row = row1;

  const li2 = document.createElement("li");
  li2.id = "node-2";
  const row2 = document.createElement("div"); row2.className = "node-row";
  li2.appendChild(row2); li2._row = row2;

  const src = `
    let selCursor = null;
    const nodeRow = li => li._row || li.querySelector(":scope > .node-row");
    ${fn("setSelCursor")}
    return { setSelCursor, get selCursor() { return selCursor; } };
  `;
  const { setSelCursor } = new Function("treeEl", src)(treeEl);

  setSelCursor(li1);
  ok(treeEl.getAttribute("aria-activedescendant") === "node-1",
     "aria-activedescendant apunta a la primera fila: " + treeEl.getAttribute("aria-activedescendant"));
  ok(row1.classList.contains("cursor"), "resaltado visual también presente");

  setSelCursor(li2);
  ok(treeEl.getAttribute("aria-activedescendant") === "node-2",
     "se mueve con el cursor: " + treeEl.getAttribute("aria-activedescendant"));
  ok(!row1.classList.contains("cursor"), "la fila anterior pierde el resaltado");

  setSelCursor(null);
  ok(!treeEl.hasAttribute("aria-activedescendant"),
     "se retira del todo cuando no hay cursor (Escape/clearSelection)");
}

/* makeNode también le da a cada <li> un id propio (necesario para que
   aria-activedescendant, arriba, pueda señalar una fila): no se
   comprueba aquí porque makeNode arrastra demasiada maquinaria ajena
   (iconos, arrastre, menú de acciones) para extraerlo sin un mock tan
   grande como el propio código; se verificó en vivo con axe-core sobre
   el navegador real, que es donde se detectó todo lo que cubre esta
   suite (ver tests/README.md).                                         */

if (!process.exitCode) console.log("A11Y TREE TESTS OK");
