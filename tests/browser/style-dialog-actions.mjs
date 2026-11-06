/* La lupa (🔍) y Borrar (×) en el diálogo de propiedades de una capa: las
   mismas opciones que la fila del árbol, cableadas desde el diálogo.

   1) UNA capa: la lupa deja la vista exactamente como la del árbol (mismo
      centro y zoom); Borrar la quita SIN preguntar, cierra el diálogo, y
      Ctrl+Z la devuelve con su estilo ORIGINAL aunque se estuviera
      previsualizando otro.
   2) VARIAS capas (el diálogo admite selección múltiple): la lupa encuadra el
      conjunto; Borrar pide confirmación con el recuento y los nombres;
      Cancelar, la × y Escape no borran nada y dejan el diálogo abierto;
      «Borrar» las quita todas y UN Ctrl+Z las devuelve.
   3) Una capa recién creada (pin con isNew) no enseña Borrar: Cancelar ya la
      borra. Sin geometría, la lupa sale deshabilitada.
   4) El × de la fila del árbol sigue como estaba, con y sin selección
      múltiple (sin confirmación).                                        */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER STYLE DIALOG ACTIONS TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8979);
const { page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
await page.evaluate(() => { map.options.inertia = false; });

/* Tres marcadores bien separados (hay que alejar la vista para verlos juntos) */
const PINS = { "Pin A": [40.5, -3.9], "Pin B": [40.8, -3.3], "Pin C": [40.2, -4.4] };
const makePins = () => page.evaluate(pins => {
  for (const [name, ll] of Object.entries(pins)) {
    createPin(L.latLng(ll[0], ll[1]));
    const li = styleTargets[0];
    $id("mk-name").value = name;
    $id("mk-name").dispatchEvent(new Event("input", { bubbles: true }));
    acceptStyleDialog();
  }
}, PINS);
const liOf = name => `[...document.querySelectorAll("#tree li")].find(x => x._name === ${JSON.stringify(name)})`;
const names = () => page.evaluate(() => [...document.querySelectorAll("#tree li")].filter(x => /^Pin [ABC]$/.test(x._name || "")).map(x => x._name).sort().join());
const view = () => page.evaluate(() => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng, z: map.getZoom() }; });
const dlg = () => page.evaluate(() => ({ style: !styleDialog.hidden, confirm: !document.getElementById("delete-confirm").hidden,
  title: document.getElementById("style-title").textContent }));
const openFor = name => page.evaluate(n => { openStyleDialog([...document.querySelectorAll("#tree li")].find(x => x._name === n)); }, name);
const select = async (...ns) => page.evaluate(arr => {
  clearSelection();
  const lis = arr.map(n => [...document.querySelectorAll("#tree li")].find(x => x._name === n));
  lis.forEach((li, i) => selectNode(li, true));
}, ns);

await makePins();
ok((await names()) === "Pin A,Pin B,Pin C", "tres marcadores de partida: " + await names());

/* ---------- 1. UNA capa ---------- */
await select("Pin A");
await openFor("Pin A");
let d = await dlg();
ok(d.style && /Pin A/.test(d.title), "el diálogo de propiedades de «Pin A»");
const tools = await page.evaluate(() => ({
  focus: document.getElementById("style-focus").title, focusAria: document.getElementById("style-focus").getAttribute("aria-label"),
  del: document.getElementById("style-delete").title, delAria: document.getElementById("style-delete").getAttribute("aria-label"),
  focusDisabled: document.getElementById("style-focus").disabled, delHidden: document.getElementById("style-delete").hidden,
  order: [...document.querySelectorAll("#style-dialog .dlg-box > *")].map(e => e.id || e.className).slice(0, 3).join() }));
ok(/zoom 14/.test(tools.focus) && tools.focus === tools.focusAria && tools.del === "Borrar" && tools.del === tools.delAria,
  "los dos iconos llevan título y aria-label, como los de la fila: " + JSON.stringify(tools));
ok(!tools.focusDisabled && !tools.delHidden, "habilitados en una capa ya creada");
ok(/style-tools/.test(tools.order), "bajo el título, antes del nombre: " + tools.order);

/* La lupa del diálogo = la del árbol */
await page.evaluate(n => focusOnNode([...document.querySelectorAll("#tree li")].find(x => x._name === n)), "Pin A");
await frames();
const viaTree = await view();
await page.evaluate(() => map.setView([41.9, -1.2], 7, { animate: false }));
await page.click("#style-focus");
await frames();
const viaDialog = await view();
ok(Math.abs(viaDialog.lat - viaTree.lat) < 1e-6 && Math.abs(viaDialog.lng - viaTree.lng) < 1e-6 && viaDialog.z === viaTree.z && viaDialog.z === 14,
  "la lupa del diálogo deja la vista igual que la del árbol (centro y zoom 14): " + JSON.stringify([viaTree, viaDialog]));
d = await dlg();
ok(d.style, "y no cierra el diálogo");

/* Borrar, con una vista previa en marcha: sin pregunta, cierra, y deshacer devuelve el estilo ORIGINAL */
const sizeBefore = await page.evaluate(n => { const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n); return (li._mstyle && li._mstyle.size) || 41; }, "Pin A");
await page.fill("#mk-size", "33");
await page.dispatchEvent("#mk-size", "input");
await frames();
await page.click("#style-delete");
await frames();
d = await dlg();
ok(!d.style && !d.confirm, "con UNA capa borra sin confirmación y cierra el diálogo: " + JSON.stringify(d));
ok((await names()) === "Pin B,Pin C", "«Pin A» ya no está: " + await names());
await page.evaluate(() => undoLast());
await frames();
ok((await names()) === "Pin A,Pin B,Pin C", "Ctrl+Z la devuelve");
const sizeAfter = await page.evaluate(n => { const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n); return (li._mstyle && li._mstyle.size) || 41; }, "Pin A");
ok(sizeAfter === sizeBefore, `y con su estilo ORIGINAL (${sizeBefore}), no con el previsualizado (33): ${sizeAfter}`);

/* ---------- 2. VARIAS capas ---------- */
await select("Pin A", "Pin B", "Pin C");
await openFor("Pin A");
d = await dlg();
ok(d.style && /3 capas/.test(d.title), "con tres seleccionadas, el diálogo es de las tres: " + d.title);
await page.evaluate(() => map.setView([40.5, -3.9], 14, { animate: false }));
await page.click("#style-focus");
await frames();
const all = await page.evaluate(() => {
  const b = map.getBounds(), pts = [[40.5, -3.9], [40.8, -3.3], [40.2, -4.4]];
  return { inside: pts.every(p => b.contains(p)), z: map.getZoom() };
});
ok(all.inside && all.z < 14, "la lupa encuadra el conjunto de las tres (todas a la vista, con menos zoom que uno solo): " + JSON.stringify(all));

await page.click("#style-delete");
const c = await page.evaluate(() => ({ confirm: !document.getElementById("delete-confirm").hidden, style: !styleDialog.hidden,
  text: document.getElementById("delete-confirm-text").textContent }));
ok(c.confirm && c.style, "con varias, Borrar PIDE CONFIRMACIÓN y deja el diálogo de propiedades abierto: " + JSON.stringify(c));
ok(/3 capas/.test(c.text) && /Pin A/.test(c.text) && /Pin B/.test(c.text) && /Pin C/.test(c.text), "con el recuento y los nombres: " + c.text);
ok((await names()) === "Pin A,Pin B,Pin C", "todavía no se ha borrado nada");

const confirmOpen = () => page.evaluate(() => !document.getElementById("delete-confirm").hidden);
const cancelHow = {
  "Cancelar": () => page.click("#delete-cancel"),
  "la ×": () => page.click("#delete-confirm .dlg-close"),
  "Escape": () => page.keyboard.press("Escape")
};
for (const [how, fn] of Object.entries(cancelHow)) {
  await fn();
  await frames();
  const x = await dlg();
  ok(!x.confirm && x.style && (await names()) === "Pin A,Pin B,Pin C", `${how} cierra la confirmación sin borrar y deja el diálogo de propiedades: ` + JSON.stringify(x));
  await page.click("#style-delete");
  ok(await confirmOpen(), "(Borrar la vuelve a pedir)");
}
/* «Borrar» a la derecha de «Cancelar» */
const order = await page.evaluate(() => document.getElementById("delete-cancel").getBoundingClientRect().left < document.getElementById("delete-accept").getBoundingClientRect().left);
ok(order, "Cancelar a la izquierda y «Borrar» a la derecha");

await page.click("#delete-accept");
await frames();
d = await dlg();
ok(!d.confirm && !d.style && (await names()) === "", "«Borrar» quita las tres y cierra los dos diálogos: " + JSON.stringify(d) + " " + await names());
await page.evaluate(() => undoLast());
await frames();
ok((await names()) === "Pin A,Pin B,Pin C", "UN solo Ctrl+Z las devuelve todas");

/* ---------- 3. Una capa nueva y una capa sin geometría ---------- */
await page.evaluate(() => { clearSelection(); createPin(L.latLng(40.5, -3.9)); });
const nw = await page.evaluate(() => ({ delHidden: document.getElementById("style-delete").hidden, focusDisabled: document.getElementById("style-focus").disabled }));
ok(nw.delHidden && !nw.focusDisabled, "un pin recién creado no enseña Borrar (Cancelar ya lo borra) y su lupa vale: " + JSON.stringify(nw));
await page.click("#style-cancel");
ok((await names()) === "Pin A,Pin B,Pin C", "(y Cancelar lo quitó)");

/* ---------- 4. El × de la fila del árbol sigue igual ---------- */
await page.evaluate(() => { clearSelection(); document.querySelector("#tree li").scrollIntoView(); });
await page.evaluate(n => { const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n); li.querySelector(".actions button.delete").click(); }, "Pin C");
ok((await names()) === "Pin A,Pin B" && !(await confirmOpen()), "el × de una fila borra esa capa sin confirmación: " + await names());
await page.evaluate(() => undoLast());
await select("Pin A", "Pin B", "Pin C");
await page.evaluate(n => { const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n); li.querySelector(".actions button.delete").click(); }, "Pin B");
ok((await names()) === "" && !(await confirmOpen()), "y con varias seleccionadas, borra TODAS, también sin confirmación (como siempre): " + await names());
await page.evaluate(() => undoLast());
ok((await names()) === "Pin A,Pin B,Pin C", "(deshecho)");

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
await browser.close();
srv.close();
done();
