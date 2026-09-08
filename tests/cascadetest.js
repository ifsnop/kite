const { parseHTML } = require("linkedom");
const { fn } = require("./_extract");

const { document } = parseHTML("<div id='tree'></div>");
global.document = document;
const treeEl = document.getElementById("tree");
const rootUl = document.createElement("ul");
treeEl.appendChild(rootUl);

/* rootGroup mock: records every add/remove in call order, by layer tag */
let calls = [];
const rootGroup = {
  addLayer(l) { calls.push(["add", l.tag]); },
  removeLayer(l) { calls.push(["remove", l.tag]); }
};

/* yieldFrame: resolves on a microtask (no real timers needed) and counts
   how many times a cascade actually yielded the thread.                */
let yieldCount = 0;
const yieldFrame = () => { yieldCount++; return Promise.resolve(); };

let saveCalls = 0;
const scheduleSave = () => { saveCalls++; };

const CASCADE_BATCH = 3; /* small on purpose: exercise the yield path with a manageable tree */

const src = "const nodeUl = li => li.querySelector(':scope > ul.node-list');\n"
  + fn("setLayerVisible") + "\n" + fn("applyVisibility") + "\n"
  + fn("cascadeVisibility") + "\n" + fn("setPendingChecked") + "\n" + fn("setAllChecked");
const api = new Function("rootGroup", "yieldFrame", "CASCADE_BATCH", "scheduleSave", "treeEl", "rootUl",
  src + "\nreturn {applyVisibility, cascadeVisibility, setAllChecked};"
)(rootGroup, yieldFrame, CASCADE_BATCH, scheduleSave, treeEl, rootUl);
const { cascadeVisibility, setAllChecked } = api;

const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* Builds a folder <li> with `count` leaf-layer descendants, each with its
   own checkbox + _layer, all starting unchecked. Returns { li, boxes }.
   Note li.querySelectorAll("input[type=checkbox]") inside cascadeVisibility
   also matches the folder's OWN checkbox (harmless in production: a
   folder's chk._layer is always null, so applyVisibility no-ops on it,
   same as before this fix) — so the cascade actually walks count+1 items,
   which is what the yield-count assertions below account for.          */
function makeFolder(name, count) {
  const li = document.createElement("li");
  li._cascadeGen = 0; /* makeNode() sets this in the real app */
  const row = document.createElement("div"); row.className = "node-row";
  const chk = document.createElement("input"); chk.type = "checkbox";
  row.appendChild(chk);
  li.appendChild(row);
  const ul = document.createElement("ul"); ul.className = "node-list";
  li.appendChild(ul);
  const boxes = [];
  for (let i = 0; i < count; i++) {
    const sub = document.createElement("li");
    const subRow = document.createElement("div"); subRow.className = "node-row";
    const subChk = document.createElement("input");
    subChk.type = "checkbox";
    subChk.checked = false;
    subChk._layer = { tag: `${name}-${i}` };
    subRow.appendChild(subChk);
    sub.appendChild(subRow);
    ul.appendChild(sub);
    boxes.push(subChk);
  }
  return { li, boxes };
}

/* ---------- small folder: no yielding needed ---------- */
(async () => {
  const { li, boxes } = makeFolder("small", 1); // +1 own checkbox = 2 items, < CASCADE_BATCH
  rootUl.appendChild(li);
  yieldCount = 0; saveCalls = 0; calls = [];
  await cascadeVisibility(li, true);
  ok(boxes.every(b => b.checked), "small folder: every descendant ends up checked");
  ok(calls.length === 1 && calls.every(c => c[0] === "add"), "small folder: rootGroup.addLayer called once per descendant");
  ok(yieldCount === 0, "small folder: cascade never yields (under CASCADE_BATCH)");
  ok(saveCalls === 1, "small folder: scheduleSave called exactly once");

  /* ---------- large folder: yields, still ends up fully correct ---------- */
  const big = makeFolder("big", CASCADE_BATCH * 3 - 1); // +1 own checkbox = 9 items, batch 3 -> 3 yields
  rootUl.appendChild(big.li);
  yieldCount = 0; saveCalls = 0; calls = [];
  await cascadeVisibility(big.li, true);
  ok(big.boxes.every(b => b.checked), "large folder: every descendant ends up checked");
  ok(calls.length === CASCADE_BATCH * 3 - 1, "large folder: rootGroup received one call per descendant: " + calls.length);
  ok(yieldCount === 3, "large folder: yields exactly floor(9/CASCADE_BATCH) times: " + yieldCount);
  ok(saveCalls === 1, "large folder: scheduleSave called exactly once, not once per chunk");

  /* ---------- rapid re-toggle mid-cascade: last intent wins ---------- */
  const rt = makeFolder("rt", CASCADE_BATCH * 3 - 1);
  rootUl.appendChild(rt.li);
  yieldCount = 0; saveCalls = 0; calls = [];
  const p1 = cascadeVisibility(rt.li, true);   // starts, suspends at first yield
  const p2 = cascadeVisibility(rt.li, false);  // fired before p1 resumes: bumps the generation
  await Promise.all([p1, p2]);
  ok(rt.boxes.every(b => !b.checked), "rapid re-toggle: final state matches the SECOND (winning) call's intent");
  ok(saveCalls === 1, "rapid re-toggle: scheduleSave fires once, from the winning generation only: " + saveCalls);

  /* ---------- folder removed mid-cascade: stops touching rootGroup ---------- */
  const del = makeFolder("del", CASCADE_BATCH * 3 - 1);
  rootUl.appendChild(del.li);
  yieldCount = 0; saveCalls = 0; calls = [];
  const pDel = cascadeVisibility(del.li, true);
  del.li.remove(); /* simulates deleteNode() firing mid-cascade */
  await pDel;
  const callsAtRemoval = calls.length;
  ok(callsAtRemoval <= CASCADE_BATCH, "deleted folder: cascade stops at the first post-removal check, not the full set: " + callsAtRemoval);
  ok(saveCalls === 0, "deleted folder: scheduleSave never fires for an aborted cascade");

  /* ---------- setAllChecked: same batching, whole-tree scope ---------- */
  rootUl.innerHTML = "";
  const whole = [];
  for (let i = 0; i < CASCADE_BATCH * 2 + 1; i++) {
    const li = document.createElement("li");
    const row = document.createElement("div"); row.className = "node-row";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = false;
    chk._layer = { tag: "w" + i };
    row.appendChild(chk);
    li.appendChild(row);
    rootUl.appendChild(li);
    whole.push(chk);
  }
  yieldCount = 0; saveCalls = 0; calls = [];
  await setAllChecked(true);
  ok(whole.every(c => c.checked), "setAllChecked: every checkbox in the tree ends up checked");
  ok(yieldCount === 2, "setAllChecked: yields exactly floor(7/CASCADE_BATCH) times: " + yieldCount);
  ok(saveCalls === 1, "setAllChecked: scheduleSave called exactly once");

  /* ---------- pending records: a checkbox toggle must reach into
     li._pending too, not just materialized DOM (the bug this fixes:
     a checked-but-collapsed layer used to be unreachable by any
     cascade, so it never left rootGroup when its ancestor was
     unchecked) ---------- */
  const pendFolder = makeFolder("pend", 0).li; // a folder with no materialized children
  rootUl.innerHTML = "";
  rootUl.appendChild(pendFolder);
  const leafRec = { t: "layer", name: "hidden-leaf", checked: true, _layer: { tag: "pending-leaf" } };
  const nestedFolderRec = {
    t: "folder", name: "nested", checked: true, collapsed: true,
    children: [{ t: "layer", name: "nested-leaf", checked: true, _layer: { tag: "nested-leaf" } }]
  };
  pendFolder._pending = [leafRec, nestedFolderRec];

  yieldCount = 0; saveCalls = 0; calls = [];
  await cascadeVisibility(pendFolder, false);
  ok(leafRec.checked === false, "cascadeVisibility: a leaf record inside li._pending gets unchecked");
  ok(nestedFolderRec.checked === false, "cascadeVisibility: a folder record inside li._pending gets unchecked");
  ok(nestedFolderRec.children[0].checked === false, "cascadeVisibility: recurses into a pending folder record's own children");
  ok(calls.some(c => c[0] === "remove" && c[1] === "pending-leaf"), "cascadeVisibility: removes the pending leaf's layer from rootGroup");
  ok(calls.some(c => c[0] === "remove" && c[1] === "nested-leaf"), "cascadeVisibility: removes the nested pending leaf's layer too");

  /* same gap, at setAllChecked's whole-tree scope */
  const pendFolder2 = makeFolder("pend2", 0).li;
  rootUl.appendChild(pendFolder2);
  const leafRec2 = { t: "layer", name: "hidden-leaf-2", checked: false, _layer: { tag: "pending-leaf-2" } };
  pendFolder2._pending = [leafRec2];

  yieldCount = 0; saveCalls = 0; calls = [];
  await setAllChecked(true);
  ok(leafRec2.checked === true, "setAllChecked: reaches a pending record anywhere in the tree, not just materialized rows");
  ok(calls.some(c => c[0] === "add" && c[1] === "pending-leaf-2"), "setAllChecked: adds the pending leaf's layer to rootGroup");

  if (!process.exitCode) console.log("CASCADE TESTS OK");
})();
