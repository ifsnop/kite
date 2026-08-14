const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const { parseHTML } = require("linkedom");
const fs = require("fs");
const script = fs.readFileSync(HTML_PATH, "utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];

/* Same isolated-function extraction as navtest.js/reordertest.js/
   cascadetest.js, async-aware (materializeRecords, ensureMaterialized,
   resolveMatch are all async), PLUS skipping the parameter list before
   brace-matching the body: deleteNode(li, { pruneSelection = true } = {})
   has its own {}-pairs in the signature (a destructured default), and
   naively brace-matching from the first "{" after the name matches the
   destructure's own closing brace, truncating the extraction before the
   real body.                                                          */
function fn(name) {
  let i = script.indexOf(`function ${name}(`);
  if (i < 0) throw new Error("no encontrada: " + name);
  if (script.slice(Math.max(0, i - 6), i) === "async ") i -= 6;
  let pd = 0, p = script.indexOf("(", i);
  for (; p < script.length; p++) {
    if (script[p] === "(") pd++;
    else if (script[p] === ")" && --pd === 0) break;
  }
  let depth = 0, j = script.indexOf("{", p);
  for (let k = j; k < script.length; k++) {
    if (script[k] === "{") depth++;
    else if (script[k] === "}" && --depth === 0) return script.slice(i, k + 1);
  }
}

const { document } = parseHTML("<div id='tree'></div>");
global.document = document;
const treeEl = document.getElementById("tree");
const rootUl = document.createElement("ul");
treeEl.appendChild(rootUl);

/* rootGroup mock: records every add/remove by layer tag, in order, and
   tracks membership (hasLayer) for visibleElevGridNodes.               */
let calls = [];
const inMap = new Set();
const rootGroup = {
  addLayer(l) { calls.push(["add", l.tag]); inMap.add(l); },
  removeLayer(l) { calls.push(["remove", l.tag]); inMap.delete(l); },
  hasLayer(l) { return inMap.has(l); }
};

let yieldCount = 0;
const yieldFrame = () => { yieldCount++; return Promise.resolve(); };
const PROGRESS_BATCH = 3; /* small on purpose: exercise the yield path with a manageable tree */

let saveCalls = 0;
const scheduleSave = () => { saveCalls++; };
const navMessage = () => {};
const showEmptyMessage = () => {};
const syncExpanded = () => {};
let measureLi = null;
const selection = new Set();
const searchBox = { value: "" };
let highlightCalls = [];
const highlightNode = li => highlightCalls.push(li);
const showLayerInfo = () => {};

/* Mock Leaflet layer: just enough .on()/.off() bookkeeping to verify
   wirePendingLayerEvents wires listeners and materializeRecords removes
   the pending ones once the "real" makeNode-wired ones exist (the leak
   this fix specifically guards against).                              */
function mockLayer(tag) {
  const listeners = {};
  return {
    tag,
    on(evt, f) { (listeners[evt] = listeners[evt] || []).push(f); return this; },
    off(evt, f) { if (listeners[evt]) listeners[evt] = listeners[evt].filter(x => x !== f); },
    count(evt) { return (listeners[evt] || []).length; },
    async trigger(evt) { for (const f of (listeners[evt] || []).slice()) await f(); }
  };
}

/* Minimal L: enough for layerKind (a mock leaf layer is never instanceof
   Marker/Path, so ensureMarkerDefaults's "styleKind !== marker" branch
   returns immediately without ever reaching applyMarkerStyle — which is
   why applyMarkerStyle/DEFAULT_MARKER_STYLE don't need to be extracted:
   free-variable references in unreached code never get resolved) and
   latLngBounds (subtreeBounds tests: a tiny real accumulator, not a
   Leaflet LatLngBounds, but extend()-compatible with what extendBounds
   feeds it).                                                          */
global.L = {
  Marker: class {}, Path: class {},
  latLngBounds: () => {
    const pts = [];
    return { extend(v) { if (v) pts.push(v); }, points: pts };
  }
};

/* Minimal row factory: real <li>/<ul> structure (enough for nodeUl,
   serializeNode, subtreeBounds, deleteNode...) without the full UI
   machinery (buttons, drag wiring, icons) makeNode itself pulls in —
   same "supply a stand-in via the Function's parameter list" approach
   navtest.js already uses for nodeUl/scheduleSave/etc.                */
function makeNode({ name, layer = null, isFolder = false, isFile = false, checked = true, desc = null, style = null }) {
  const li = document.createElement("li");
  if (isFile) li.className = "file";
  li._name = name;
  li._isContainer = isFolder || isFile;
  li._cascadeGen = 0;
  li._desc = desc;
  li._style = style;
  const row = document.createElement("div");
  row.className = "node-row";
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.checked = checked;
  chk._layer = layer;
  row.appendChild(chk);
  li.appendChild(row);
  if (isFolder || isFile) {
    const ul = document.createElement("ul");
    ul.className = "node-list";
    li.appendChild(ul);
  }
  return li;
}

const src = [
  "const nodeUl = li => li.querySelector(':scope > ul.node-list');",
  fn("layerKind"), fn("styleKind"), fn("nodeLayer"), fn("setLayerVisible"), fn("ensureMarkerDefaults"),
  fn("materializeRecords"), fn("ensureMaterialized"),
  fn("serializeNode"), "const serializeNodes = ul => [...ul.children].flatMap(serializeNode);",
  fn("serializePendingRecords"),
  fn("extendBounds"), fn("extendBoundsFromRecords"), fn("subtreeBounds"),
  fn("findMatches"), fn("searchMatches"), fn("resolveMatch"),
  fn("resolveRecordLi"), fn("wirePendingLayerEvents"), fn("visibleElevGridNodes"),
  fn("blinkLayer"),
  fn("removeRecordsFromMap"), fn("removeSubtreeFromMap"), fn("deleteNode")
].join("\n");

const api = new Function(
  "rootGroup", "yieldFrame", "PROGRESS_BATCH", "scheduleSave", "navMessage", "showEmptyMessage",
  "syncExpanded", "measureLi", "selection", "searchBox", "treeEl", "rootUl", "makeNode",
  "highlightNode", "showLayerInfo", "BLINK_STEPS", "BLINK_INTERVAL_MS",
  src + `\nreturn {
    materializeRecords, ensureMaterialized, serializeNode, serializeNodes, serializePendingRecords,
    subtreeBounds, findMatches, searchMatches, resolveMatch, resolveRecordLi,
    wirePendingLayerEvents, visibleElevGridNodes, blinkLayer, deleteNode
  };`
)(rootGroup, yieldFrame, PROGRESS_BATCH, scheduleSave, navMessage, showEmptyMessage,
  syncExpanded, measureLi, selection, searchBox, treeEl, rootUl, makeNode,
  highlightNode, showLayerInfo, 4 /* BLINK_STEPS, igual que en producción */, 2 /* BLINK_INTERVAL_MS: mínimo, para que el test no espere */);
const {
  materializeRecords, ensureMaterialized, serializeNode, serializeNodes,
  subtreeBounds, findMatches, searchMatches, resolveMatch, resolveRecordLi,
  wirePendingLayerEvents, visibleElevGridNodes, blinkLayer, deleteNode
} = api;

const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
let tag = 0;
const layerRec = (name, checked = true) =>
  ({ t: "layer", name, checked, style: null, geo: { fake: true }, _layer: { tag: "L" + (++tag), getLatLng: () => ({ lat: tag, lng: -tag }) } });
const folderRec = (name, collapsed, children) => ({ t: "folder", name, checked: children.some(c => c.checked), collapsed, children });

(async () => {
  /* ---------- test diferencial: el formato serializado no cambia ----------
     El mismo árbol construido dos veces: una vez con TODO abierto (ruta
     materializada de siempre) y otra con una subcarpeta colapsada (ruta
     _pending) debe serializar IGUAL — es la garantía central de todo
     Fix 2: TREE_SCHEMA no cambia porque el formato persistido no cambia. */
  const buildTree = () => [
    layerRec("suelto"),
    folderRec("sub", false, [layerRec("a"), layerRec("b", false)])
  ];

  const openUl = document.createElement("ul");
  await materializeRecords(buildTree(), openUl);

  const collapsedTree = buildTree();
  collapsedTree[1].collapsed = true; /* la subcarpeta arranca colapsada esta vez */
  const pendingUl = document.createElement("ul");
  await materializeRecords(collapsedTree, pendingUl);
  const subLi = [...pendingUl.children].find(li => li._name === "sub");
  ok(!!subLi._pending, "la subcarpeta colapsada queda pendiente (sin materializar)");
  ok(subLi.querySelector(":scope > ul.node-list").children.length === 0,
     "y su <ul> real está vacío mientras siga pendiente");

  /* "collapsed" en la subcarpeta es justo lo que se varía a propósito
     entre las dos rutas (por eso una queda pendiente y la otra no): se
     normaliza antes de comparar, porque lo que hay que probar es que el
     CONTENIDO (sus hijos, la geometría, los estilos) es idéntico, no que
     el flag de colapso lo sea — ese ya se sabe que difiere.           */
  const stripCollapsed = v => JSON.parse(JSON.stringify(v).replace(/"collapsed":(true|false)/g, '"collapsed":null'));
  const openOut = JSON.stringify(stripCollapsed(serializeNodes(openUl)));
  const pendingOut = JSON.stringify(stripCollapsed(serializeNodes(pendingUl)));
  ok(openOut === pendingOut, "serializar da EXACTAMENTE lo mismo abierto que pendiente (aparte del propio flag collapsed):\n  "
    + openOut + "\n  " + pendingOut);

  /* ---------- ensureMaterialized: lotes, cascada a abiertas, diferido en colapsadas ---------- */
  const manyLeaves = Array.from({ length: PROGRESS_BATCH * 3 - 1 }, (_, i) => layerRec("leaf" + i));
  const openChild = folderRec("open-child", false, [layerRec("oc1")]);
  const collapsedChild = folderRec("collapsed-child", true, [layerRec("cc1")]);
  const bigTree = [...manyLeaves, openChild, collapsedChild];

  const li = makeNode({ name: "big", isFolder: true, checked: true });
  li._pending = bigTree;
  rootUl.appendChild(li);

  yieldCount = 0;
  await ensureMaterialized(li);
  ok(!li._pending, "tras materializar, li._pending queda vacío");
  const ul = li.querySelector(":scope > ul.node-list");
  ok(ul.children.length === bigTree.length, "todas las filas del nivel directo se crean: " + ul.children.length);
  ok(yieldCount >= Math.floor(bigTree.length / PROGRESS_BATCH),
     "cede el hilo varias veces para un lote grande: " + yieldCount);
  const openChildLi = [...ul.children].find(c => c._name === "open-child");
  ok(openChildLi.querySelector(":scope > ul.node-list").children.length === 1,
     "una subcarpeta ABIERTA se materializa en cascada en la misma pasada");
  const collapsedChildLi = [...ul.children].find(c => c._name === "collapsed-child");
  ok(!!collapsedChildLi._pending && collapsedChildLi.querySelector(":scope > ul.node-list").children.length === 0,
     "una subcarpeta COLAPSADA solo recibe su propio _pending, no se materializa de más");

  /* ---------- llamada re-entrante: no duplica filas ---------- */
  const li2 = makeNode({ name: "reentrant", isFolder: true, checked: true });
  li2._pending = [layerRec("x"), layerRec("y")];
  rootUl.appendChild(li2);
  const p1 = ensureMaterialized(li2);
  const p2 = ensureMaterialized(li2); /* dispara antes de que p1 termine */
  await Promise.all([p1, p2]);
  ok(li2.querySelector(":scope > ul.node-list").children.length === 2,
     "una segunda llamada mientras la primera está en marcha no duplica filas");

  /* ---------- subtreeBounds: mismo resultado pendiente que materializado ---------- */
  const boundsTree = [layerRec("p1"), folderRec("nested", true, [layerRec("p2")])];
  const materializedLi = makeNode({ name: "bounds-open", isFolder: true, checked: true });
  rootUl.appendChild(materializedLi);
  await materializeRecords(JSON.parse(JSON.stringify(boundsTree)).map((r, idx) =>
    ({ ...r, _layer: boundsTree[idx]._layer, children: r.children && r.children.map((c, j) =>
      ({ ...c, _layer: boundsTree[idx].children[j]._layer })) })
  ), materializedLi.querySelector(":scope > ul.node-list"));
  // fully materialize the nested folder too, for a fair comparison
  const nestedLi = [...materializedLi.querySelectorAll("li")].find(n => n._name === "nested");
  if (nestedLi && nestedLi._pending) await ensureMaterialized(nestedLi);

  const pendingBoundsLi = makeNode({ name: "bounds-pending", isFolder: true, checked: true });
  pendingBoundsLi._pending = boundsTree;
  rootUl.appendChild(pendingBoundsLi);

  const bOpen = subtreeBounds(materializedLi);
  const bPending = subtreeBounds(pendingBoundsLi);
  ok(JSON.stringify(bOpen.points.slice().sort()) === JSON.stringify(bPending.points.slice().sort()),
     "subtreeBounds ve las mismas coordenadas materializada o pendiente: "
     + JSON.stringify(bOpen.points) + " vs " + JSON.stringify(bPending.points));
  ok(bPending.points.length === 2, "y encuentra las DOS capas (una directa, una dentro de una subcarpeta pendiente)");

  /* ---------- searchMatches/resolveMatch: encuentra dentro de lo pendiente ---------- */
  searchBox.value = "needle";
  const searchLi = makeNode({ name: "search-root", isFolder: true, checked: true });
  searchLi._pending = [
    layerRec("otra cosa"),
    folderRec("carpeta-anidada", true, [layerRec("needle-aquí")])
  ];
  rootUl.appendChild(searchLi);
  const matches = searchMatches();
  ok(matches.length === 1, "encuentra la única coincidencia dentro de una carpeta pendiente: " + matches.length);
  const resolved = await resolveMatch(matches[0]);
  ok(!!resolved && resolved._name === "needle-aquí", "resolveMatch materializa la cadena y devuelve el <li> real");
  ok(!searchLi._pending, "materializar para llegar al resultado también resuelve el nivel superior");
  searchBox.value = "";

  /* ---------- serializeNode sobre pendiente: no crea DOM ---------- */
  const untouched = makeNode({ name: "untouched", isFolder: true, checked: true });
  untouched._pending = [layerRec("z1"), layerRec("z2")];
  rootUl.appendChild(untouched);
  const rec = serializeNode(untouched)[0];
  ok(rec.children.length === 2 && rec.t === "folder", "serializeNode devuelve los 2 hijos pendientes: " + JSON.stringify(rec));
  ok(untouched.querySelector(":scope > ul.node-list").children.length === 0,
     "y no ha construido ninguna fila para conseguirlo");

  /* ---------- deleteNode: quita del mapa las capas de una carpeta pendiente ---------- */
  const delLi = makeNode({ name: "borrar", isFolder: true, checked: true });
  const delLeaf = layerRec("oculta-pero-marcada");
  delLi._pending = [delLeaf, folderRec("nested-del", true, [layerRec("nested-oculta")])];
  rootUl.appendChild(delLi);
  calls = [];
  deleteNode(delLi);
  ok(calls.some(c => c[0] === "remove" && c[1] === delLeaf._layer.tag),
     "borrar una carpeta pendiente quita del mapa la capa marcada que escondía");
  ok(calls.length === 2, "y también la del nivel anidado dentro: " + calls.length);
  ok(!delLi.isConnected, "la fila desaparece del panel");

  /* ---------- resolveRecordLi/wirePendingLayerEvents: clic sobre una
     capa pendiente resalta el nodo real, y el listener de espera se
     retira al materializar (no se queda disparando por duplicado)  ---------- */
  const clickOuter = makeNode({ name: "click-outer", isFolder: true, checked: true });
  rootUl.appendChild(clickOuter);
  const clickLayer = mockLayer("clickable");
  const clickRec = { t: "layer", name: "clickable-leaf", checked: true, style: null, _layer: clickLayer };
  wirePendingLayerEvents(clickRec);
  ok(clickLayer.count("click") === 1 && clickLayer.count("mouseover") === 1,
     "wirePendingLayerEvents engancha un clic y un hover de espera");
  clickOuter._pending = [clickRec];

  highlightCalls = [];
  await clickLayer.trigger("click");
  ok(!clickOuter._pending, "el clic sobre la capa pendiente materializa su carpeta");
  ok(highlightCalls.length === 1 && highlightCalls[0]._name === "clickable-leaf",
     "y resalta el <li> real recién creado: " + JSON.stringify(highlightCalls.map(l => l && l._name)));
  ok(clickLayer.count("click") === 0 && clickLayer.count("mouseover") === 0,
     "materializeRecords retira los listeners de espera (si no, quedarían disparando por duplicado para siempre): "
     + clickLayer.count("click") + "/" + clickLayer.count("mouseover"));

  /* llamar otra vez, ya materializada: resuelve por rec._li sin recorrer nada */
  highlightCalls = [];
  const liAgain = await resolveRecordLi(clickRec);
  ok(liAgain === clickRec._li, "una segunda resolución usa rec._li directamente, sin nuevo recorrido");

  /* ---------- visibleElevGridNodes: encuentra una capa de elevaciones
     marcada dentro de una carpeta nunca desplegada ---------- */
  const elevOuter = makeNode({ name: "elev-outer", isFolder: true, checked: true });
  rootUl.appendChild(elevOuter);
  const elevLayer = { tag: "elev1" };
  rootGroup.addLayer(elevLayer); /* la marca "visible" para hasLayer */
  const elevRec = { t: "elevGrid", name: "Elevación pendiente", checked: true, cells: [], _layer: elevLayer };
  elevOuter._pending = [elevRec];

  const foundElev = await visibleElevGridNodes();
  ok(foundElev.length === 1 && foundElev[0]._name === "Elevación pendiente",
     "encuentra la capa de elevaciones visible dentro de una carpeta pendiente: " + foundElev.length);
  ok(!elevOuter._pending, "y materializa lo necesario para devolver un <li> real, listo para fusionar la sesión");

  /* ---------- blinkLayer: parpadeo de identificación ---------- */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const BLINK_WAIT = 4 /* BLINK_STEPS pasado arriba */ * 2 /* BLINK_INTERVAL_MS pasado arriba */ + 30;

  const blinkTag = { tag: "blink1" };
  const blinkLi = makeNode({ name: "blink-target", checked: true, layer: blinkTag });
  rootGroup.addLayer(blinkTag); /* como si ya estuviera visible (hit-testeada) */
  calls = [];
  blinkLayer(blinkLi);
  await sleep(BLINK_WAIT);
  const blinkCalls = calls.filter(c => c[1] === "blink1").map(c => c[0]);
  ok(blinkCalls.join(",") === "remove,add,remove,add",
     "oculta/muestra dos veces, en orden: " + blinkCalls.join(","));
  ok(rootGroup.hasLayer(blinkTag), "termina visible, que es el estado real de su checkbox");

  /* repetir antes de que termine el primero: no se solapan dos secuencias */
  calls = [];
  blinkLayer(blinkLi);
  blinkLayer(blinkLi); /* cancela la anterior y empieza de cero */
  await sleep(BLINK_WAIT);
  const restartCalls = calls.filter(c => c[1] === "blink1");
  ok(restartCalls.length === 4, "un parpadeo repetido cancela el anterior en vez de solaparse: " + restartCalls.length);

  /* si el checkbox cambia mientras parpadea, el estado final es el suyo, no "visible" a ciegas */
  blinkLayer(blinkLi);
  blinkLi.querySelector(":scope > .node-row > input").checked = false;
  await sleep(BLINK_WAIT);
  ok(!rootGroup.hasLayer(blinkTag),
     "si se desactiva el checkbox mientras parpadea, termina oculta (el estado real), no visible a la fuerza");

  if (!process.exitCode) console.log("LAZY TREE TESTS OK");
})();
