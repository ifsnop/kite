/* Filtro del árbol: el buscador del panel deja en el árbol SOLO lo que
   coincide con lo teclado (sin mayúsculas ni tildes, dentro de las palabras).

   Con teclado y ratón de verdad, y con estilos calculados (`offsetParent`:
   lo que el usuario VE, no solo el atributo `hidden`). Lo que se protege:

   - Cuándo filtra: a la tercera letra, o con Intro con cualquier longitud.
     Con menos de tres no hace nada y, si había filtro, lo quita.
   - Qué NO toca: `collapsed` (las carpetas se ven abiertas con `filter-open`),
     ni casillas ni lo guardado: el árbol serializado es idéntico con y sin
     filtro, y al quitarlo.
   - Carpetas sin desplegar: con muchas coincidencias, cerradas con «(n)» y
     sin construir nada; con pocas, se construyen SOLO ellas. Desplegar con el
     filtro puesto construye solo las coincidentes. Y en todos esos estados a
     medio construir lo guardado es lo mismo, en el mismo orden: disco =
     memoria, también tras RECARGAR (Fase 1: serializeChildren, _pos).
   - Quitar el filtro con la × o con Escape (que no llega al Escape global), y
     que una carpeta abierta a medias se complete.
   - El teclado salta las filas ocultas (isRow) y una carpeta abierta solo por
     el filtro cuenta como abierta; Ctrl+A no selecciona lo que no se ve.
   - Lo que nazca con el filtro puesto se filtra solo (MutationObserver).
   - Several words match along the path («madrid resto» finds «Resto» inside
     «Madrid»), a folder that matches shows its content one level deep (what
     was saved open is open, what was saved closed stays closed and is built
     whole when opened), and one huge matching folder does not eat the budget
     of the small matches elsewhere (sections 13-15).
   - The typed words are marked through the CSS Custom Highlight API.      */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER TREE FILTER TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8914);
const { page, errors } = await openApp(browser, srv.url);
await page.setViewportSize({ width: 1280, height: 1000 });

/* ---------- Datos ---------- */
const poly = (x, y) => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: {},
  geometry: { type: "Polygon", coordinates: [[[x, y], [x + 0.001, y], [x + 0.001, y + 0.001], [x, y]]] } }] });
const layer = (name, i) => ({ name, checked: false, t: "layer", style: null, geo: poly(-3 + (i % 100) * 0.002, 40 + Math.floor(i / 100) * 0.002) });
const N = 2000;
const grande = Array.from({ length: N }, (_, i) => layer(i % 500 === 0 ? `Zona ${i}` : `Parcela ${i}`, i));
const enorme = Array.from({ length: N }, (_, i) => layer(i % 2 === 0 ? `Zona E${i}` : `Parcela E${i}`, i));
const cuarto = Array.from({ length: N }, (_, i) => layer(`Elemento ${i}`, i));
const doc = { app: "kite-local/tree", format: 1, db: 5, schema: 9, nodes: [{ name: "Datos", checked: true, t: "file", collapsed: false, children: [
  { name: "Abierta", checked: true, t: "folder", collapsed: false, children: [
    layer("Zona A", 1), layer("Zona B", 2), layer("Base", 3), layer("Cañada", 4),
    { name: "Interior", checked: true, t: "folder", collapsed: true, children: [layer("Zona C", 5), layer("Otro", 6)] } ] },
  { name: "Grande", checked: false, t: "folder", collapsed: true, children: grande },
  { name: "Enorme", checked: false, t: "folder", collapsed: true, children: enorme },
  /* sections 13-15 (checked: false all through: a folder saved checked over unchecked layers is recomputed when its row is built). No name holds «z», «zon», «nad» or «qqq», so the older sections do not see them */
  { name: "Madrid", checked: false, t: "folder", collapsed: true, children: [
    layer("Parcela 1", 7), layer("Otra", 8),
    { name: "Sub", checked: false, t: "folder", collapsed: false, children: [layer("Parcela 2", 9), layer("Resto", 10)] },
    { name: "Cerrada", checked: false, t: "folder", collapsed: true, children: [layer("Hondo", 11)] } ] },
  { name: "Cuarto", checked: false, t: "folder", collapsed: true, children: cuarto },
  { name: "Reserva", checked: false, t: "folder", collapsed: true, children: [layer("Cuarto extra", 12), layer("Otra cosa", 13)] }
] }] };
await page.evaluate(async txt => {
  await handleDroppedFiles([new File([txt], "datos.kite.json", { type: "application/json" })]);
}, JSON.stringify(doc));

/* ---------- Ayudantes de página ---------- */
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
  window.__disco = async () => {
    await saveTree();
    const { root, segs } = await __crudo();
    const nodes = structuredClone(root.nodes);
    const missing = joinPayloads(nodes, segs);
    return { missing, json: JSON.stringify(canon(nodes)) };
  };
  window.__buscar = name => [...document.querySelectorAll("#tree li")].find(li => li._name === name);
  /* Lo que el usuario VE: ni `hidden` propio ni de un ancestro, ni dentro de una carpeta cerrada */
  window.__visibles = () => [...document.querySelectorAll("#tree li")]
    .filter(li => li._name !== undefined && li.offsetParent !== null).map(li => li._name);
  /* Los nombres de los hijos de una carpeta, EN EL ORDEN GUARDADO */
  window.__hijos = nombre => {
    const f = serializeTree()[0].children.find(c => c.name === nombre);
    return f.children.map(c => c.name);
  };
};
await page.evaluate(helpers);

const visibles = () => page.evaluate(() => __visibles());
/* The text under each range of the typed-words highlight, or null when there is none */
const marcado = () => page.evaluate(() => { const h = CSS.highlights.get("kite-search"); return h ? [...h].map(r => r.toString()) : null; });
const filtrado = term => page.waitForFunction(t => treeFilter && treeFilter.raw === t && !filterApplying, term);
const sinFiltro = () => page.waitForFunction(() => !treeFilter && !filterApplying);
const teclear = async txt => { await page.click("#search-box"); await page.keyboard.type(txt); };
const esperaPausa = () => page.evaluate(ms => new Promise(r => setTimeout(r, ms)), 450); /* más que la pausa de la tecla: esperar a algo que NO debe ocurrir */
const original = await page.evaluate(() => __memoria());
const nombresGrande = grande.map(l => l.name), nombresEnorme = enorme.map(l => l.name);

/* Construir «Interior» (colapsada pero con filas): abrir y volver a cerrar */
await page.evaluate(() => {
  const c = __buscar("Interior").querySelector(":scope > .node-row > .caret");
  c.click(); c.click();
});
await page.waitForFunction(() => __buscar("Interior").children.length && !__buscar("Interior")._pending);
const inicio = await page.evaluate(() => __memoria());
ok(inicio === original, "abrir y cerrar una carpeta no cambia lo guardado (punto de partida)");
ok((await visibles()).includes("Base") && !(await visibles()).includes("Zona C"), "al empezar se ve todo y «Interior» está cerrada");

/* ---------- 1. A la tercera letra, no antes ---------- */
await teclear("zo");
await esperaPausa();
ok(!(await page.evaluate(() => treeFilter)), "con dos letras no se filtra");
ok((await visibles()).includes("Base"), "y el árbol sigue entero");
await page.keyboard.type("n");
await filtrado("zon");
const v1 = await visibles();
ok(["Datos", "Abierta", "Zona A", "Zona B", "Interior", "Zona C", "Grande", "Enorme"].every(n => v1.includes(n)),
   "con tres letras queda lo que coincide y sus ancestros: " + v1);
ok(!v1.includes("Base") && !v1.includes("Cañada") && !v1.includes("Otro"), "y lo que no coincide se oculta: " + v1);
ok(await page.evaluate(() => document.getElementById("search-box").classList.contains("filtering")), "el campo avisa de que hay un filtro");
ok(await page.evaluate(() => __buscar("Interior").classList.contains("collapsed") && __buscar("Interior").classList.contains("filter-open")),
   "«Interior» se ve abierta por el filtro sin dejar de estar colapsada");
ok(await page.evaluate(() => document.getElementById("search-count").textContent) === "1007",
   "el contador da el total (3 filas + 4 + 1000 pendientes)");
ok(!(await page.evaluate(() => document.getElementById("search-clear").hidden)), "la × aparece con texto");
const hl1 = await marcado();
ok(hl1 && hl1.length === 3 && hl1.every(t => t === "Zon"), "lo escrito se marca en las filas que se ven («Zon» ×3): " + JSON.stringify(hl1));

/* ---------- 2. Lo guardado no cambia; las carpetas pendientes no se construyen ---------- */
ok(await page.evaluate(() => __memoria()) === original, "con el filtro puesto, lo guardado es idéntico");
const pend = await page.evaluate(() => ({ g: __buscar("Grande")._pending.length, e: __buscar("Enorme")._pending.length,
  rg: __buscar("Grande").querySelector(":scope > ul").children.length,
  bg: __buscar("Grande").querySelector(":scope > .node-row > .filter-count")?.textContent,
  be: __buscar("Enorme").querySelector(":scope > .node-row > .filter-count")?.textContent }));
ok(pend.g === N && pend.e === N && pend.rg === 0, "sobre el tope no se construye NINGUNA fila: " + JSON.stringify(pend));
ok(pend.bg === "(4)" && pend.be === "(1000)", "las carpetas salen cerradas con su contador: " + pend.bg + " / " + pend.be);

/* ---------- 3. El teclado salta lo oculto ---------- */
const clicRow = name => page.evaluate(n => { const r = __buscar(n).querySelector(":scope > .node-row > label").getBoundingClientRect();
  return { x: r.left + 6, y: r.top + r.height / 2 }; }, name).then(p => page.mouse.click(p.x, p.y));
const cursor = () => page.evaluate(() => selCursor && selCursor._name);
await clicRow("Zona A");
await page.keyboard.press("ArrowDown");
ok(await cursor() === "Zona B", "↓ desde «Zona A» llega a «Zona B»: " + await cursor());
await page.keyboard.press("ArrowDown");
ok(await cursor() === "Interior", "↓ salta «Base» y «Cañada», ocultas: " + await cursor());
await page.keyboard.press("ArrowDown");
ok(await cursor() === "Zona C", "y entra en una carpeta abierta solo por el filtro: " + await cursor());
await clicRow("Zona A");
await page.keyboard.press("Control+a");
await page.keyboard.press("Control+a");
const sel = await page.evaluate(() => ({ n: selection.size, ocultas: [...selection].filter(li => li.offsetParent === null).length }));
ok(sel.n > 0 && sel.ocultas === 0, "Ctrl+A no selecciona lo que no se ve: " + JSON.stringify(sel));
await page.keyboard.press("Escape"); /* fuera del buscador: limpia la selección como siempre */
ok(await page.evaluate(() => selection.size) === 0, "Escape fuera del buscador sigue limpiando la selección");

/* ---------- 4. La × quita el filtro ---------- */
await page.click("#search-clear");
await sinFiltro();
const v2 = await visibles();
ok(v2.includes("Base") && v2.includes("Cañada") && !v2.includes("Zona C"), "la × devuelve el árbol entero: " + v2);
ok(await page.evaluate(() => !document.querySelector("#tree li[hidden], #tree li.filter-open, #tree .filter-count")), "sin restos del filtro");
ok(await page.evaluate(() => document.getElementById("search-box").value === "" && document.activeElement.id === "search-box"),
   "el campo queda vacío y con el foco");
ok(await page.evaluate(() => __memoria()) === original, "y lo guardado sigue idéntico");
ok(await marcado() === null, "y no queda nada marcado");

/* ---------- 5. Escape en el buscador borra y NO llega al Escape global ---------- */
await clicRow("Zona A");
await teclear("zon");
await filtrado("zon");
await page.keyboard.press("Escape");
await sinFiltro();
ok(await page.evaluate(() => document.getElementById("search-box").value) === "", "Escape con texto borra la búsqueda");
ok(await page.evaluate(() => selection.size) === 1, "y no llegó al Escape global: la selección sigue");

/* ---------- 6. Intro filtra con cualquier longitud y después salta ---------- */
await teclear("z");
await page.keyboard.press("Enter");
await filtrado("z");
ok(!(await visibles()).includes("Base"), "Intro filtra con una sola letra");
await page.keyboard.press("Enter");
await page.waitForFunction(() => selCursor && selCursor._name === "Zona A");
ok(await cursor() === "Zona A", "y el siguiente Intro salta a la primera coincidencia");
await page.keyboard.press("Enter");
await page.waitForFunction(() => selCursor && selCursor._name === "Zona B");
ok(await cursor() === "Zona B", "y a la siguiente");
await page.click("#search-clear");
await sinFiltro();

/* ---------- 7. Quitar letras por debajo de tres quita el filtro ---------- */
await teclear("zon");
await filtrado("zon");
await page.keyboard.press("Backspace");
await page.keyboard.press("Backspace");
await sinFiltro();
ok((await visibles()).includes("Base"), "con menos de tres letras el árbol vuelve a verse entero");
await page.click("#search-clear");

/* ---------- 8. Sin tildes y sin mayúsculas ---------- */
await teclear("CANADA");
await filtrado("CANADA");
const v3 = await visibles();
ok(v3.includes("Cañada") && !v3.includes("Base") && !v3.includes("Zona A"), "«CANADA» encuentra «Cañada»: " + v3);
ok(JSON.stringify(await marcado()) === JSON.stringify(["Cañada"]), "y se marca «Cañada» entera, con su ñ: " + JSON.stringify(await marcado()));
await page.click("#search-clear");
await sinFiltro();
await teclear("nad");
await filtrado("nad");
const v4 = await visibles();
ok(v4.includes("Cañada") && v4.includes("Abierta") && !v4.includes("Base") && !v4.includes("Zona A"),
   "«nad» encuentra «Cañada»: busca dentro de las palabras, no palabras enteras: " + v4);
await page.click("#search-clear");
await sinFiltro();

/* ---------- 9. Sin coincidencias ---------- */
await teclear("qqq");
await filtrado("qqq");
ok((await visibles()).length === 0, "sin coincidencias no queda ninguna fila");
const vacio = await page.evaluate(() => { const p = document.getElementById("tree-filter-empty"); return { oculto: p.hidden, txt: p.textContent }; });
ok(!vacio.oculto && vacio.txt.includes("qqq"), "y se dice, con lo buscado: " + vacio.txt);
await page.click("#search-clear");
await sinFiltro();
ok(await page.evaluate(() => document.getElementById("tree-filter-empty").hidden), "al quitar el filtro el aviso desaparece");

/* ---------- 10. Lo que nazca con el filtro puesto se filtra solo ---------- */
await teclear("zon");
await filtrado("zon");
await page.evaluate(() => {
  const ul = __buscar("Abierta").querySelector(":scope > ul");
  ul.appendChild(makeNode({ name: "Carpeta nueva", isFolder: true, checked: true }));
  ul.appendChild(makeNode({ name: "Zona nueva", isFolder: true, checked: true }));
});
await page.waitForFunction(() => __buscar("Carpeta nueva").hidden);
ok(!(await visibles()).includes("Carpeta nueva") && (await visibles()).includes("Zona nueva"),
   "una fila nueva que no coincide se oculta y una que sí, se ve");
await page.evaluate(() => { __buscar("Carpeta nueva").remove(); __buscar("Zona nueva").remove(); });
await page.click("#search-clear");
await sinFiltro();

/* ---------- 11. Desplegar con el filtro puesto construye SOLO las coincidentes ---------- */
await teclear("zon");
await filtrado("zon");
await page.evaluate(() => __buscar("Grande").querySelector(":scope > .node-row > .caret").click());
await page.waitForFunction(() => __buscar("Grande").querySelector(":scope > ul").children.length === 4 && !__buscar("Grande")._materializing);
const g = await page.evaluate(() => ({ filas: [...__buscar("Grande").querySelector(":scope > ul").children].map(l => l._name),
  pend: __buscar("Grande")._pending.length, abierta: !__buscar("Grande").classList.contains("collapsed"), parcial: partialFolders.has(__buscar("Grande")) }));
ok(g.filas.join() === "Zona 0,Zona 500,Zona 1000,Zona 1500" && g.pend === N - 4 && g.abierta && g.parcial,
   "se construyen las 4 coincidentes y el resto queda pendiente: " + JSON.stringify(g));
const dg = await page.evaluate(async () => ({ d: await __disco(), m: __memoria() }));
ok(dg.d.missing === 0 && dg.d.json === dg.m, "a medio construir: disco = memoria");
ok(JSON.stringify(await page.evaluate(() => __hijos("Grande"))) === JSON.stringify(nombresGrande),
   "y los hijos se guardan completos y en su orden original");
await page.click("#search-clear");
await sinFiltro();
await page.waitForFunction(() => !__buscar("Grande")._pending && !__buscar("Grande")._materializing);
const filasG = await page.evaluate(() => [...__buscar("Grande").querySelector(":scope > ul").children].map(l => l._name));
ok(filasG.length === N && filasG.join() === nombresGrande.join(),
   "al quitar el filtro, una carpeta ABIERTA a medias se completa, en orden: " + filasG.length);
ok(await page.evaluate(() => !partialFolders.has(__buscar("Grande"))), "y deja de estar anotada como a medias");

/* ---------- 12. Bajo el tope se construye solo, y el guardado sigue siendo fiel tras recargar ---------- */
await teclear("zona e1500");
await filtrado("zona e1500");
await page.waitForFunction(() => __buscar("Enorme").querySelector(":scope > ul").children.length === 1 && !__buscar("Enorme")._materializing);
const e = await page.evaluate(() => ({ filas: [...__buscar("Enorme").querySelector(":scope > ul").children].map(l => l._name),
  pend: __buscar("Enorme")._pending.length, collapsed: __buscar("Enorme").classList.contains("collapsed"),
  fopen: __buscar("Enorme").classList.contains("filter-open"), badge: !!__buscar("Enorme").querySelector(":scope > .node-row > .filter-count") }));
ok(e.filas.join() === "Zona E1500" && e.pend === N - 1 && e.collapsed && e.fopen && !e.badge,
   "con pocas coincidencias se construyen solas, la carpeta se ve abierta sin tocar collapsed y sin contador: " + JSON.stringify(e));
ok((await visibles()).includes("Zona E1500") && !(await visibles()).includes("Zona A"), "se ve esa fila y nada más");
await page.evaluate(() => __buscar("Enorme").querySelector(":scope > .node-row > .caret").click());
ok(await page.evaluate(() => !__buscar("Enorme").classList.contains("filter-open") && __buscar("Enorme").classList.contains("collapsed")),
   "el caret de una carpeta abierta solo por el filtro la cierra a la vista, sin tocar lo guardado");
await page.click("#search-clear");
await sinFiltro();
ok(await page.evaluate(() => __buscar("Enorme")._pending.length) === N - 1, "una carpeta CERRADA a medias sigue a medias al quitar el filtro");
ok(JSON.stringify(await page.evaluate(() => __hijos("Enorme"))) === JSON.stringify(nombresEnorme), "y se guarda completa y en su orden");
const de = await page.evaluate(async () => ({ d: await __disco(), m: __memoria() }));
ok(de.d.missing === 0 && de.d.json === de.m, "disco = memoria con la carpeta cerrada a medias");
await page.reload();
await waitAppReady(page);
await page.evaluate(helpers);
/* restaurar es asíncrono (lotes que ceden el hilo): se espera a que la carpeta exista */
await page.waitForFunction(() => __buscar("Enorme") && !__buscar("Datos")._materializing);
const trasRecargar = await page.evaluate(() => __hijos("Enorme"));
ok(JSON.stringify(trasRecargar) === JSON.stringify(nombresEnorme),
   "tras RECARGAR la carpeta tiene sus " + N + " hijos en el mismo orden (no se mueven las coincidentes al principio): " + trasRecargar.length);

/* ---------- 13. Several words match along the path ---------- */
await page.waitForFunction(() => __buscar("Madrid") && __buscar("Madrid")._pending);
const base13 = await page.evaluate(() => __memoria());
await teclear("madrid resto");
await filtrado("madrid resto");
const v13 = await visibles();
ok(["Madrid", "Sub", "Resto"].every(n => v13.includes(n)) && !v13.includes("Base"),
   "«madrid resto» deja «Resto» dentro de «Madrid», con el camino: " + v13);
const m13 = await page.evaluate(() => ({ madrid: __buscar("Madrid")._pending.length, sub: __buscar("Sub")._pending.length,
  count: document.getElementById("search-count").textContent }));
ok(m13.madrid === 3 && m13.sub === 1, "solo se construyó la coincidencia y su camino: " + JSON.stringify(m13));
ok(m13.count === "1", "el contador cuenta la coincidencia, no el camino: " + m13.count);
ok(JSON.stringify((await marcado()).sort()) === JSON.stringify(["Madrid", "Resto"]),
   "se marca cada palabra en la fila que la lleva, también en la carpeta que solo aporta una: " + JSON.stringify(await marcado()));
ok(await page.evaluate(() => __memoria()) === base13, "con las dos palabras, lo guardado es idéntico");
await page.click("#search-clear");
await sinFiltro();

/* ---------- 14. A folder that matches shows its content, one level deep ---------- */
await teclear("madrid");
await filtrado("madrid");
const v14 = await visibles();
ok(["Madrid", "Parcela 1", "Otra", "Sub", "Parcela 2", "Resto", "Cerrada"].every(n => v14.includes(n)) && !v14.includes("Base"),
   "la carpeta que coincide enseña sus hijas aunque ninguna coincida: " + v14);
const c14 = await page.evaluate(() => ({
  collapsed: __buscar("Madrid").classList.contains("collapsed"), fopen: __buscar("Madrid").classList.contains("filter-open"),
  subOpen: !__buscar("Sub").classList.contains("collapsed"),
  cerrada: { pend: __buscar("Cerrada")._pending.length, rows: __buscar("Cerrada").querySelector(":scope > ul").children.length,
    collapsed: __buscar("Cerrada").classList.contains("collapsed") },
  count: document.getElementById("search-count").textContent, hijos: __hijos("Madrid") }));
ok(c14.collapsed && c14.fopen, "«Madrid» se ve abierta por el filtro sin dejar de estar colapsada: " + JSON.stringify(c14));
ok(c14.subOpen, "lo que estaba guardado abierto se ve abierto");
ok(c14.cerrada.pend === 1 && c14.cerrada.rows === 0 && c14.cerrada.collapsed && !v14.includes("Hondo"),
   "lo guardado cerrado sigue cerrado y sin construir: " + JSON.stringify(c14.cerrada));
ok(c14.count === "1", "el contador no cuenta lo que solo se enseña: " + c14.count);
ok(c14.hijos.join() === "Parcela 1,Otra,Sub,Cerrada", "y se guardan en su orden original: " + c14.hijos);
ok(await page.evaluate(() => __memoria()) === base13, "con la carpeta enseñada, lo guardado es idéntico");
const d14 = await page.evaluate(async () => ({ d: await __disco(), m: __memoria() }));
ok(d14.d.missing === 0 && d14.d.json === d14.m, "y disco = memoria");
await page.keyboard.press("Enter");
await page.waitForFunction(() => document.getElementById("search-count").textContent === "1/1");
ok(await page.evaluate(() => selCursor && selCursor._name) === "Madrid", "Intro salta entre coincidencias, no entre lo enseñado (1/1, en «Madrid»)");
/* Opening what was saved closed, with the filter on, builds it whole */
await page.evaluate(() => __buscar("Cerrada").querySelector(":scope > .node-row > .caret").click());
await page.waitForFunction(() => !__buscar("Cerrada")._pending && !__buscar("Cerrada")._materializing && !filterApplying);
await esperaPausa();
ok((await visibles()).includes("Hondo"), "desplegar lo que enseña una carpeta que coincide la construye entera y se ve");
await page.click("#search-clear");
await sinFiltro();

/* ---------- 15. A huge matching folder does not eat the small matches' budget ---------- */
await teclear("cuarto");
await filtrado("cuarto");
const c15 = await page.evaluate(() => ({
  pend: __buscar("Cuarto")._pending.length, fopen: __buscar("Cuarto").classList.contains("filter-open"),
  reserva: [...__buscar("Reserva").querySelector(":scope > ul").children].map(l => l._name),
  ropen: __buscar("Reserva").classList.contains("filter-open"), count: document.getElementById("search-count").textContent }));
ok(c15.pend === N && !c15.fopen, "«Cuarto» no cabe en lo que queda: sale cerrada y sin construir: " + JSON.stringify(c15));
ok(c15.reserva.join() === "Cuarto extra" && c15.ropen, "y la coincidencia pequeña de otra carpeta sí se construye y se ve");
ok(c15.count === "2", "el contador: la carpeta y la capa: " + c15.count);
const v15 = await visibles();
ok(v15.includes("Cuarto") && v15.includes("Cuarto extra") && !v15.includes("Base"), "se ven las dos: " + v15);
await page.evaluate(() => __buscar("Cuarto").querySelector(":scope > .node-row > .caret").click());
await page.waitForFunction(() => !__buscar("Cuarto")._pending && !__buscar("Cuarto")._materializing);
const f15 = await page.evaluate(() => ({ rows: __buscar("Cuarto").querySelector(":scope > ul").children.length,
  collapsed: __buscar("Cuarto").classList.contains("collapsed") }));
ok(f15.rows === N && !f15.collapsed, "al desplegarla se construye entera, sin tope: " + JSON.stringify(f15));
await page.click("#search-clear");
await sinFiltro();

ok(errors.length === 0, "sin errores en consola: " + errors.join(" | "));
await browser.close();
srv.close();
done();
