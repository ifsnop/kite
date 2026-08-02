const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const { parseHTML } = require("linkedom");
const fs = require("fs");
const html = fs.readFileSync(HTML_PATH, "utf8");
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const src = script.slice(script.indexOf("/* ---------- Selección ----------"),
                         script.indexOf("/* Nombre legible del tipo"));
const top = script.slice(script.indexOf("function topLevelSelection"),
                         script.indexOf("function topLevelSelection") + 600).split("\n}")[0] + "\n}";

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
const api = new Function("treeEl", "styleKind", src + "\n" + top +
  "\nreturn {selection, selectNode, clearSelection, setSelected, topLevelSelection, cursor: () => selCursor};")(treeEl, styleKind);
const { selection, selectNode, clearSelection, topLevelSelection, setSelected } = api;
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

if (!process.exitCode) console.log("SELECTION CORRECTNESS OK");
