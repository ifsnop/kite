/* Guardado en dos niveles (DB_VERSION v5): el "root" es un esqueleto y
   lo pesado de cada hoja va al almacén "segments".

   Lo que se protege aquí es que NO SE PIERDA NADA: tras cada operación
   que cambia el árbol —borrar, mover, ordenar, cortar, pegar, editar una
   geometría, deshacer— lo que hay en disco, reconstruido, tiene que ser
   EXACTAMENTE lo que hay en memoria (`disco`). Y lo que se gana: plegar,
   desplegar, marcar o borrar solo reescriben el esqueleto.

   Medido al introducirlo (Chromium sin GPU, 7 copias de un .kite.json
   real, 114 MB): el guardado que seguía a cada acción bloqueaba el hilo
   330 ms; ahora, 32-46 ms en total.                                    */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER SPLIT SAVE TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8852);
const { ctx, page, errors } = await openApp(browser, srv.url);
await page.setViewportSize({ width: 1280, height: 1000 });

/* ---------- Datos: marcadores con ficha, polígonos, una imagen ---------- */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const pt = (x, y) => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: {},
  geometry: { type: "Point", coordinates: [x, y, 600] } }] });
const poly = (x, y) => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: {},
  geometry: { type: "Polygon", coordinates: [[[x, y], [x + 0.01, y], [x + 0.01, y + 0.01], [x, y]]] } }] });
const layer = (name, geo, extra = {}) => ({ name, checked: true, t: "layer", style: { color: "#3388ff", weight: 2 }, geo, ...extra });
const doc = (tag, n = 12) => ({
  app: "kite-local/tree", format: 1, db: 5, schema: 8, nodes: [{ name: `Datos ${tag}`, checked: true, t: "file", collapsed: false, children: [
    { name: `Abierta ${tag}`, checked: true, t: "folder", collapsed: false, children:
      Array.from({ length: n }, (_, i) => layer(`M${tag}${i}`, pt(-3 + i * 0.01, 40), { desc: `<table><tr><th style='color:red'>Ficha</th><td>${tag}${i}</td></tr></table>` })) },
    { name: `Cerrada ${tag}`, checked: false, t: "folder", collapsed: true, children: [
      ...Array.from({ length: n }, (_, i) => layer(`P${tag}${i}`, poly(-4 + i * 0.01, 41))),
      { name: `Honda ${tag}`, checked: false, t: "folder", collapsed: true, children:
        Array.from({ length: 4 }, (_, i) => layer(`H${tag}${i}`, pt(-5, 42 + i * 0.01), { desc: `honda ${i}` })) }
    ] },
    { name: `Img ${tag}`, checked: true, t: "imageOverlay", box: { south: 40, west: -3, north: 40.1, east: -2.9 }, dataUrl: PNG, opacity: 0.8 }
  ] }]
});
const importDoc = (p, d) => p.evaluate(async txt => {
  await handleDroppedFiles([new File([txt], "datos.kite.json", { type: "application/json" })]);
}, JSON.stringify(d));

/* Ayudantes de página: forma canónica del árbol en memoria, y lo que hay
   en disco reconstruido igual que al arrancar. */
const helpers = () => {
  const canon = x => Array.isArray(x) ? x.map(canon)
    : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x;
  window.__memoria = () => JSON.stringify(canon(serializeTree()));
  window.__crudo = async () => {
    const db = await openDb();
    return new Promise((res, rej) => {
      const tx = db.transaction(["tree", "segments"], "readonly");
      const r = tx.objectStore("tree").get("root");
      const k = tx.objectStore("segments").getAllKeys();
      const v = tx.objectStore("segments").getAll();
      tx.oncomplete = () => res({ root: r.result, segs: new Map(k.result.map((key, i) => [key, v.result[i]])) });
      tx.onerror = () => rej(tx.error);
    });
  };
  /* `guardar: false` mira el disco TAL CUAL lo dejó el arranque: si una
     compactación no reescribiera bien el «root», el siguiente guardado
     lo taparía y solo se perderían capas cerrando antes de guardar.  */
  window.__disco = async ({ guardar = true } = {}) => {
    if (guardar) await saveTree();
    const { root, segs } = await __crudo();
    const nodes = structuredClone(root.nodes);
    const missing = joinPayloads(nodes, segs);
    return { missing, json: JSON.stringify(canon(nodes)), segs: segs.size };
  };
  window.__buscar = name => [...document.querySelectorAll("#tree li")].find(li => li._name === name);
  window.__puts = [];
  const orig = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (v, k) { __puts.push(this.name + ":" + k); return orig.call(this, v, k); };
};
await page.evaluate(helpers);

let paso = 0;
const disco = async (p, etiqueta) => {
  const d = await p.evaluate(() => __disco());
  const m = await p.evaluate(() => __memoria());
  paso++;
  ok(d.missing === 0, `${etiqueta}: nada perdido en disco (${d.missing})`);
  ok(d.json === m, `${etiqueta}: disco = memoria` + (d.json === m ? "" : ` (${d.json.length} frente a ${m.length})`));
  return d;
};

await importDoc(page, doc("A"));
await importDoc(page, doc("B"));
const d0 = await disco(page, "tras importar dos archivos");
ok(d0.segs >= 1, "lo importado está en segmentos: " + d0.segs);
const raw0 = await page.evaluate(async () => JSON.stringify((await __crudo()).root));
ok(!/"geo"|"desc"|"dataUrl"/.test(raw0), "el «root» guardado no lleva ningún campo pesado");
ok(/"p":\[/.test(raw0), "y sus hojas apuntan a segmentos");

/* ---------- 1. Acciones corrientes: solo se reescribe el esqueleto ---------- */
const soloRoot = async (etiqueta, fn) => {
  await page.evaluate(() => { __puts.length = 0; });
  await page.evaluate(fn);
  await disco(page, etiqueta);
  const puts = await page.evaluate(() => __puts.filter(p => !p.startsWith("bench")));
  ok(puts.length > 0 && puts.every(p => p === "tree:root"), `${etiqueta}: solo se escribe «root» — ${puts.join(", ")}`);
};
await soloRoot("plegar", () => __buscar("Abierta A").querySelector(":scope > .node-row > .caret").click());
await soloRoot("desplegar (materializa sus filas)", () => __buscar("Cerrada A").querySelector(":scope > .node-row > .caret").click());
await soloRoot("marcar una capa", () => __buscar("PA0").querySelector(":scope > .node-row > input").click());
await page.waitForFunction(() => !cascadingNodes.size);
await soloRoot("marcar una carpeta (cascada)", () => __buscar("Cerrada A").querySelector(":scope > .node-row > input").click());
await page.waitForFunction(() => !cascadingNodes.size);
await disco(page, "tras la cascada");
await soloRoot("borrar una capa con ×", () => __buscar("PA1").querySelector(":scope > .node-row .actions button.delete").click());
await soloRoot("borrar una carpeta colapsada con hijos pendientes", () =>
  __buscar("Honda A").querySelector(":scope > .node-row .actions button.delete").click());

/* ---------- 2. Borrar con Supr una selección múltiple ---------- */
await page.evaluate(() => {
  clearSelection();
  for (const n of ["MA2", "MA3", "PA2"]) setSelected(__buscar(n), true);
  setSelCursor(__buscar("MA2"));
  document.activeElement && document.activeElement.blur();
});
await page.keyboard.press("Delete");
ok(await page.evaluate(() => !__buscar("MA2") && !__buscar("PA2")), "Supr borra la selección");
await disco(page, "Supr con selección múltiple");

/* ---------- 3. Mover arrastrando con el ratón de verdad ---------- */
await page.evaluate(() => {
  window.__punto = (nombre, donde) => {
    const li = __buscar(nombre);
    li.scrollIntoView({ block: "nearest" });
    const r = li.querySelector(":scope > .node-row").getBoundingClientRect();
    return { x: Math.round(r.x + 45), y: Math.round(donde === "antes" ? r.y + 2 : r.y + r.height / 2) };
  };
});
const arrastrar = async (origen, destino, donde) => {
  await page.evaluate(n => { clearSelection(); setSelected(__buscar(n), true); setSelCursor(__buscar(n)); }, origen);
  const a = await page.evaluate(n => __punto(n, "dentro"), origen);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + 4, { steps: 3 });
  const b = await page.evaluate(([n, d]) => __punto(n, d), [destino, donde]);
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
};
await page.evaluate(() => { __buscar("Abierta A").classList.remove("collapsed"); });
await arrastrar("MA4", "Cerrada A", "dentro");
ok(await page.evaluate(() => __buscar("MA4").parentElement === nodeUl(__buscar("Cerrada A"))), "arrastrar dentro de una carpeta mueve el nodo");
await disco(page, "arrastrar dentro de otra carpeta");
await arrastrar("PA3", "MA5", "antes");
ok(await page.evaluate(() => __buscar("PA3").nextElementSibling === __buscar("MA5")), "arrastrar entre hermanos lo coloca delante");
await disco(page, "arrastrar entre hermanos de otra rama");
/* Una carpeta COLAPSADA entera, con registros pendientes, a otro archivo */
await arrastrar("Cerrada B", "Datos A", "dentro");
await disco(page, "arrastrar una carpeta colapsada con hijos pendientes");

/* ---------- 4. Ordenar, Subir y Bajar ---------- */
await page.evaluate(() => __buscar("Abierta A").querySelector(":scope > .node-row .actions button.az").click());
await page.waitForTimeout(50);
await disco(page, "ordenar AZ");
const boton = (nodo, titulo) => page.evaluate(([n, t]) =>
  [...__buscar(n).querySelectorAll(":scope > .node-row .actions button")].find(b => b.title === t).click(), [nodo, titulo]);
await boton("MA6", "Subir");
await disco(page, "Subir");
await boton("MA6", "Bajar");
await disco(page, "Bajar");

/* ---------- 5. Cortar y pegar, copiar y pegar dos veces ---------- */
await page.evaluate(async () => {
  clearSelection(); setSelected(__buscar("MA7"), true); setSelCursor(__buscar("MA7"));
  copySelection(true);
  clearSelection(); setSelCursor(__buscar("Abierta B"));
  await pasteClipboard();
});
ok(await page.evaluate(() => __buscar("MA7").parentElement === nodeUl(__buscar("Abierta B"))), "cortar y pegar mueve el nodo");
await disco(page, "cortar y pegar");
await page.evaluate(async () => {
  clearSelection(); setSelected(__buscar("MA8"), true); setSelCursor(__buscar("MA8"));
  copySelection(false);
  clearSelection(); setSelCursor(__buscar("Abierta B"));
  await pasteClipboard();
  await pasteClipboard();
});
const copias = await page.evaluate(() => [...document.querySelectorAll("#tree li")].filter(li => li._name === "MA8").length);
ok(copias === 3, "copiar y pegar dos veces deja tres nodos MA8: " + copias);
await disco(page, "copiar y pegar dos veces");
/* Editar la geometría de UNA copia, como el diálogo de estilos */
const coords = () => page.evaluate(() => [...document.querySelectorAll("#tree li")].filter(li => li._name === "MA8")
  .map(li => { serializeNode(li); return li._geo.features[0].geometry.coordinates.slice(0, 2).join(); }));
const antes = await coords();
await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].filter(x => x._name === "MA8")[1];
  const m = nodeCheckbox(li)._layer.getLayers()[0];
  m.setLatLng([45, 5]);
  invalidateGeo(li);
  scheduleSave();
});
const despues = await coords();
ok(despues[1] === "5,45" && despues[0] === antes[0] && despues[2] === antes[2],
  `mover una copia no mueve las otras: ${antes.join(" | ")} → ${despues.join(" | ")}`);
await page.evaluate(() => { __puts.length = 0; });
await disco(page, "editar la geometría de una copia");
ok(await page.evaluate(() => __puts.some(p => p.startsWith("segments:"))), "y esa geometría nueva sí se escribe en un segmento");

/* ---------- 6. Deshacer y rehacer ---------- */
for (let i = 0; i < 4; i++) { await page.evaluate(() => undoLast()); await disco(page, `deshacer ${i + 1}`); }
for (let i = 0; i < 2; i++) { await page.evaluate(() => redoLast()); await disco(page, `rehacer ${i + 1}`); }

/* ---------- 7. Una secuencia aleatoria, con semilla ---------- */
await page.evaluate(() => {
  let s = 12345;
  window.__rnd = n => (s = (s * 16807) % 2147483647) % n;
  const filas = () => [...document.querySelectorAll("#tree li[role=treeitem]")].filter(li => li._name !== undefined);
  const carpetas = () => filas().filter(li => li._isContainer);
  const hojas = () => filas().filter(li => !li._isContainer);
  window.__op = async () => {
    const op = __rnd(9);
    const f = filas(), c = carpetas(), h = hojas();
    if (!f.length) return "vacío";
    const any = a => a[__rnd(a.length)];
    switch (op) {
      case 0: { const li = any(f); nodeCheckbox(li).click(); return "marcar"; }
      case 1: { const li = any(c); if (li) li.querySelector(":scope > .node-row > .caret").click(); return "plegar"; }
      case 2: { const li = any(f); if (f.length > 6) { pushUndo("t"); deleteNode(li); } return "borrar"; }
      case 3: { const li = any(f), to = any(c);
        if (to && li !== to && !li.contains(to)) {
          pushUndo("t"); await ensureMaterialized(to);
          const from = li.parentElement; nodeUl(to).appendChild(li); refreshChecksFrom(from); refreshChecksFrom(nodeUl(to)); scheduleSave();
        } return "mover"; }
      case 4: { const li = any(c); if (li) await withUndo("t", () => sortChildren(li)); return "ordenar"; }
      case 5: { const li = h.find(x => x._geo !== undefined && nodeCheckbox(x)._layer && nodeCheckbox(x)._layer.getLayers && nodeCheckbox(x)._layer.getLayers()[0] && nodeCheckbox(x)._layer.getLayers()[0].setLatLng);
        if (li) { nodeCheckbox(li)._layer.getLayers()[0].setLatLng([40 + __rnd(100) / 100, -3]); invalidateGeo(li); scheduleSave(); } return "geometría"; }
      case 6: { const li = any(f), to = any(c);
        if (to && li !== to && !li.contains(to)) { clearSelection(); setSelected(li, true); setSelCursor(li); copySelection(false);
          clearSelection(); setSelCursor(to); to.classList.remove("collapsed"); await pasteClipboard(); } return "copiar"; }
      case 7: await undoLast(); return "deshacer";
      default: await redoLast(); return "rehacer";
    }
  };
});
let fallos = 0;
for (let i = 0; i < 200 && !fallos; i++) {
  const op = await page.evaluate(() => __op());
  await page.waitForFunction(() => !cascadingNodes.size && !materializingNow);
  const d = await page.evaluate(() => __disco());
  const m = await page.evaluate(() => __memoria());
  if (d.missing || d.json !== m) { fallos++; ok(false, `secuencia aleatoria, paso ${i} (${op}): disco ≠ memoria`); }
}
ok(!fallos, "200 operaciones aleatorias: el disco sigue siempre a la memoria");

/* ---------- 8. Recargar: árbol idéntico, segmentos fundidos ----------
   Tres geometrías editadas en tres guardados = tres segmentos pequeños
   VIVOS: al arrancar se tienen que fundir en uno nuevo, y eso obliga a
   reescribir las referencias del «root».                            */
await importDoc(page, doc("E", 4));   /* marcadores seguros: la secuencia aleatoria pudo borrar cualquiera */
await page.evaluate(() => __disco());
for (let i = 0; i < 3; i++) {
  await page.evaluate(i => {
    const li = __buscar("ME" + i);
    nodeCheckbox(li)._layer.getLayers()[0].setLatLng([39 + i / 10, -1]);
    invalidateGeo(li);
    scheduleSave();
  }, i);
  await page.evaluate(() => __disco());
}
const antesRecarga = await page.evaluate(() => __memoria());
const segsAntes = (await page.evaluate(() => __disco())).segs;
const idsAntes = await page.evaluate(async () => [...(await __crudo()).segs.keys()]);
await page.reload(); await waitAppReady(page);
await page.evaluate(helpers);
/* El árbol se reconstruye colapsado o no según estaba: comparar tal cual */
ok(await page.evaluate(() => __memoria()) === antesRecarga, "recargar devuelve exactamente el mismo árbol, geometrías y fichas incluidas");
const nSegs = await page.evaluate(async () => (await __crudo()).segs.size);
ok(nSegs < segsAntes, `al arrancar se funden los segmentos pequeños o medio muertos: ${segsAntes} → ${nSegs}`);
const idsDespues = await page.evaluate(async () => [...(await __crudo()).segs.keys()]);
ok(idsDespues.some(id => !idsAntes.includes(id)), "hubo fusión de verdad: hay un segmento nuevo con lo vivo de los pequeños");
const sinGuardar = await page.evaluate(() => __disco({ guardar: false }));
ok(sinGuardar.missing === 0 && sinGuardar.json === antesRecarga,
  `tras fundir, el disco ya es coherente SIN esperar a guardar (perdidas: ${sinGuardar.missing})`);
await page.evaluate(() => { __puts.length = 0; });
await disco(page, "primer guardado tras recargar");
ok(await page.evaluate(() => __puts.every(p => p === "tree:root")), "y no reescribe nada pesado: " + await page.evaluate(() => __puts.join()));

/* ---------- 9. Un archivo soltado mientras se lee al arrancar ---------- */
await page.evaluate(async d => {
  await handleDroppedFiles([new File([JSON.stringify(d)], "c.kite.json", { type: "application/json" })]);
  await Promise.all([saveTree(), dbLoadTree()]);
}, doc("C", 4));
await disco(page, "guardar y leer a la vez (arranque con un archivo recién soltado)");
await page.reload(); await waitAppReady(page);
await page.evaluate(helpers);
ok(await page.evaluate(() => !!__buscar("Datos C")), "el archivo soltado sobrevive a la limpieza del arranque");
await disco(page, "tras recargar con el archivo soltado");

/* ---------- 10. Dos pestañas: una limpia lo que la otra sigue usando ---------- */
const pageB = await ctx.newPage();
await pageB.goto(srv.url); await waitAppReady(pageB);
await pageB.evaluate(helpers);
await importDoc(pageB, doc("D", 4));
await pageB.evaluate(() => saveTree());                         /* B: root con D, segmento de D */
const segD = await pageB.evaluate(async () => {
  const { root } = await __crudo();
  return skeletonRefs(root.nodes).find(n => n.name === "MD0").p[0];
});
/* El primer nodo raíz que quede: la secuencia aleatoria pudo borrar cualquiera */
await page.evaluate(() => { nodeCheckbox(rootUl.firstElementChild).click(); });
await page.waitForFunction(() => !cascadingNodes.size);
await page.evaluate(() => saveTree());                          /* A: root SIN D (gana el último) */
await page.reload(); await waitAppReady(page);                  /* A: limpia el segmento de D */
await page.evaluate(helpers);
ok(!(await page.evaluate(async () => [...(await __crudo()).segs.keys()])).includes(segD),
  "la otra pestaña, al arrancar, borró el segmento que esta seguía usando (es el caso a cubrir)");
await pageB.evaluate(() => { nodeCheckbox(__buscar("Datos D")).click(); });
await pageB.waitForFunction(() => !cascadingNodes.size);
await disco(pageB, "otra pestaña borró los segmentos que esta usaba: se reescriben");
const enB = await pageB.evaluate(() => __memoria());
await pageB.reload(); await waitAppReady(pageB);
await pageB.evaluate(helpers);
ok(await pageB.evaluate(() => __memoria()) === enB, "y al recargar no falta ninguna capa");
await pageB.close();

ok(!errors.length, "sin errores de página: " + errors.join(" | "));

/* ---------- 11. Una base v4 con un «root» v8 con todo en línea ---------- */
const ctx2 = await browser.newContext({ serviceWorkers: "block", locale: "es-ES" });
await ctx2.route("**/blank", r => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>b</title>" }));
const p2 = await ctx2.newPage();
const errors2 = [];
p2.on("pageerror", e => errors2.push(e.message));
await p2.goto(srv.url + "blank");
const viejo = doc("V", 5).nodes;
await p2.evaluate(nodes => new Promise((res, rej) => {
  const rq = indexedDB.open("visor-kml", 4);
  rq.onupgradeneeded = () => { rq.result.createObjectStore("tree"); rq.result.createObjectStore("rasters"); };
  rq.onsuccess = () => {
    const tx = rq.result.transaction("tree", "readwrite");
    tx.objectStore("tree").put({ v: 8, nodes }, "root");
    tx.oncomplete = () => { rq.result.close(); res(); };
    tx.onerror = () => rej(tx.error);
  };
}), viejo);
await p2.goto(srv.url);
await waitAppReady(p2);
await p2.evaluate(helpers);
ok(await p2.evaluate(() => !!__buscar("Datos V")), "abrir esta versión sobre una base v4 conserva el árbol v8 (leído tal cual)");
const v = await p2.evaluate(() => new Promise(r => {
  const rq = indexedDB.open("visor-kml");
  rq.onsuccess = () => { const d = rq.result; r({ ver: d.version, segs: d.objectStoreNames.contains("segments"), rasters: d.objectStoreNames.contains("rasters") }); d.close(); };
}));
ok(v.ver === 5 && v.segs && v.rasters, "la base sube a v5 con «segments» y sin perder «rasters»: " + JSON.stringify(v));
const memV = await p2.evaluate(() => __memoria());
ok(/"geo"/.test(memV) && /honda 0/.test(memV), "las geometrías y fichas del árbol antiguo están en memoria");
const dV = await disco(p2, "primer guardado sobre el árbol antiguo");
ok(dV.segs === 1, "lo reparte en un solo segmento: " + dV.segs);
await p2.reload(); await waitAppReady(p2);
await p2.evaluate(helpers);
ok(await p2.evaluate(() => __memoria()) === memV, "y al recargar es el mismo árbol");
ok(!errors2.length, "sin errores de página en la subida: " + errors2.join(" | "));
await ctx2.close();

await browser.close();
srv.close();
done();
