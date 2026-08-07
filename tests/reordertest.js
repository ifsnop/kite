const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const { parseHTML } = require("linkedom");
const fs = require("fs");
const script = fs.readFileSync(HTML_PATH, "utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];

/* Same isolated-function extraction as navtest.js: pull just the named
   function bodies instead of a wide index slice, so nothing else in the
   surrounding code (with its own side effects) gets dragged in.       */
function fn(name) {
  const i = script.indexOf(`function ${name}(`);
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

/* L.DomUtil.toFront is the only Leaflet call reordertest exercises
   (bringToFront/eachLayer/getElement are read straight off the layer
   objects passed in) — stubbed to record into the same order log the
   mock layers use, rather than pulling in real Leaflet.               */
const order = [];
global.L = { DomUtil: { toFront(el) { order.push(el.tag); } } };

const src = fn("bringLayerToFront") + "\n" + fn("reorderPaintOrder");
const api = new Function("treeEl", src + "\nreturn {bringLayerToFront, reorderPaintOrder};")(treeEl);
const { bringLayerToFront, reorderPaintOrder } = api;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* ---------- bringLayerToFront: dispatch by layer shape ---------- */
order.length = 0;
const path1 = { tag: "path1", bringToFront() { order.push(this.tag); } };
bringLayerToFront(path1);
ok(order.join(",") === "path1", "L.Path-like layers use bringToFront()");

order.length = 0;
const marker1 = { tag: "marker1", getElement: () => ({ tag: "marker1" }) };
bringLayerToFront(marker1);
ok(order.join(",") === "marker1", "Marker/ImageOverlay-like layers use L.DomUtil.toFront(getElement())");

order.length = 0;
const groupSub1 = { tag: "sub1", bringToFront() { order.push(this.tag); } };
const groupSub2 = { tag: "sub2", getElement: () => ({ tag: "sub2" }) };
const group = { eachLayer(cb) { cb(groupSub1); cb(groupSub2); } };
bringLayerToFront(group);
ok(order.join(",") === "sub1,sub2", "FeatureGroup/LayerGroup layers recurse via eachLayer, in member order");

order.length = 0;
bringLayerToFront({}); // no bringToFront, no eachLayer, no getElement
ok(order.length === 0, "a layer with none of the three never throws and does nothing");

/* ---------- reorderPaintOrder: walks the tree, checked layers only ---------- */
function row(tagOrNull, checked) {
  const li = document.createElement("li");
  const rowDiv = document.createElement("div");
  rowDiv.className = "node-row";
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.checked = checked;
  if (tagOrNull) chk._layer = { tag: tagOrNull, bringToFront() { order.push(this.tag); } };
  rowDiv.appendChild(chk);
  li.appendChild(rowDiv);
  return li;
}
const rootUl = document.createElement("ul");
treeEl.appendChild(rootUl);
/* tree order: A (checked), B (unchecked), folder-checkbox (no _layer), C (checked) */
const a = row("A", true), b = row("B", false), folder = row(null, true), c = row("C", true);
rootUl.append(a, b, folder, c);

order.length = 0;
reorderPaintOrder();
ok(order.join(",") === "A,C", "only checked layers are brought forward, in tree/DOM order: " + order.join(","));

/* Reordering the DOM (simulating a drag-and-drop move) changes the result
   without needing anything Leaflet-specific re-run: this is the exact
   bug being fixed — order follows the tree, not insertion history.    */
rootUl.insertBefore(c, a); // tree order is now: C, A, B, folder
order.length = 0;
reorderPaintOrder();
ok(order.join(",") === "C,A", "reordering the tree DOM changes the paint order to match: " + order.join(","));

if (!process.exitCode) console.log("REORDER TESTS OK");
