/* Itineraries with openrouteservice (69-routing.js), end to end in the
   browser, with a FAKE openrouteservice (page.route) answering the documented
   format (tests/fixtures/ors-route.json), so every request is counted and no
   key or network is needed.

   1. Without a key the entries («Consultas › Ruta desde aquí / hasta aquí»,
      «Itinerario › Desde/Hasta este marcador») are disabled with the reason.
   2. The key in Propiedades › Fuentes de datos, with the service address
      under it (and nothing of it left in Preferencias): Cancel does not keep
      it, an invalid one is refused, Accept saves it.
   3. «Desde este marcador» opens the dialog with the marker's name;
      «Ruta hasta aquí» on the map fills the destination with coordinates;
      «Elegir en el mapa» on another marker (real mouse) takes that marker;
      ⇅ swaps; Escape gives up a pick before closing the dialog.
   4. «Calcular»: ONE simple request (api_key, start/end as lon,lat, the
      chosen profile, no headers of our own) → «Itinerarios › Itinerario 1 —
      A pie · … · …» with its card and the attribution, the view unchanged.
   5. 403, 404 (code 2009) and 429 give readable notices and leave nothing;
      a 503 is retried; cancelling leaves nothing and no notice.
   6. Undo; reload (the layer, its attribution and the key come back); the
      key is not in the saved tree; «Restaurar» deletes it.             */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER ROUTING TESTS OK");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTE = fs.readFileSync(path.join(HERE, "..", "fixtures", "ors-route.json"));
const KEY = "5b3ce3597851110001cf6248abcdefabcdefabcdefabcdef12345678";

const browser = await launch();
const srv = await serve(READABLE, 8987);
const { ctx, page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

/* ---------- Fake openrouteservice ---------- */
const seen = [];
let mode = "ok"; /* ok | 403 | 2009 | 429 | 503once | hang */
/* Every request the page makes, to prove none goes to the old host (api.openrouteservice.org answers 410) */
const everyUrl = [];
page.on("request", r => everyUrl.push(r.url()));
await page.route(/api\.heigit\.org/, async route => {
  const req = route.request();
  seen.push({ url: new URL(req.url()), headers: req.headers(), method: req.method() });
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "access-control-allow-origin": "*" } });
  if (mode === "hang") return; /* never answered: only the cancel ends it */
  if (mode === "403") return json(403, { error: "Access to this API has been disallowed" });
  if (mode === "2009") return json(404, { error: { code: 2009, message: "Route could not be found" } });
  if (mode === "429") return json(429, { error: "Rate limit exceeded" });
  if (mode === "503once") { mode = "ok"; return json(503, "<h1>Service Unavailable</h1>"); }
  return json(200, ROUTE.toString());
});

/* Two markers (a KML: no name picker) in Madrid, the folder expanded */
const KML = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Doc</name>`
  + `<Placemark><name>Sol</name><Point><coordinates>-3.70379,40.416775,0</coordinates></Point></Placemark>`
  + `<Placemark><name>Cibeles</name><Point><coordinates>-3.6931,40.4192,0</coordinates></Point></Placemark>`
  + `</Document></kml>`;
await page.evaluate(t => handleDroppedFiles([new File([t], "p.kml")]), KML);
await page.evaluate(async () => {
  await ensureMaterialized([...document.querySelectorAll("#tree li")].find(x => x._name === "Doc"));
  map.setView([40.418, -3.699], 15, { animate: false });
});
const liOf = name => `[...document.querySelectorAll("#tree li")].find(x => x._name === ${JSON.stringify(name)})`;

/* The items of a submenu of the context menu, opened on a point (with the
   layers under it, as the real right click passes them) */
const menuItems = (latlng, hitNames, trigger) => page.evaluate(({ latlng, hitNames, trigger }) => {
  const hits = hitNames.map(n => [...document.querySelectorAll("#tree li")].find(x => x._name === n));
  openCtxMenu(L.latLng(latlng.lat, latlng.lng), 600, 300, hits);
  const t = [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")].find(x => x.textContent === trigger + " ▸");
  if (!t) return null;
  t.click();
  return [...document.querySelectorAll(".ctx-menu:not(#map-ctxmenu) .ctx-menu-item")]
    .map(b => ({ text: b.textContent, disabled: b.disabled, title: b.title }));
}, { latlng, hitNames, trigger });
const choose = (latlng, hitNames, trigger, label) => page.evaluate(({ latlng, hitNames, trigger, label }) => {
  const hits = hitNames.map(n => [...document.querySelectorAll("#tree li")].find(x => x._name === n));
  openCtxMenu(L.latLng(latlng.lat, latlng.lng), 600, 300, hits);
  [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")].find(x => x.textContent === trigger + " ▸").click();
  [...document.querySelectorAll(".ctx-menu:not(#map-ctxmenu) .ctx-menu-item")].find(x => x.textContent === label).click();
}, { latlng, hitNames, trigger, label });
const dialogState = () => page.evaluate(() => ({ open: !document.getElementById("route-dialog").hidden,
  from: document.getElementById("route-from").value, to: document.getElementById("route-to").value,
  calcDisabled: document.getElementById("route-calc").disabled, calcTitle: document.getElementById("route-calc").title,
  tool: activeTool }));
const SOL = { lat: 40.416775, lng: -3.70379 }, CIBELES = { lat: 40.4192, lng: -3.6931 }, POINT = { lat: 40.4204, lng: -3.7002 };

/* ---------- 1. Without a key ---------- */
let items = await menuItems(POINT, [], "Consultas");
const desde = items.find(i => i.text === "Ruta desde aquí"), hasta = items.find(i => i.text === "Ruta hasta aquí");
ok(desde && hasta && desde.disabled && hasta.disabled && /clave de openrouteservice/.test(desde.title),
  "sin clave, «Ruta desde aquí» y «Ruta hasta aquí» salen deshabilitadas con el motivo: " + JSON.stringify(desde));
items = await menuItems(SOL, ["Sol"], "Itinerario");
ok(items && items.map(i => i.text).join("|") === "Desde este marcador|Hasta este marcador" && items.every(i => i.disabled),
  "sobre un marcador, «Itinerario ›» con sus dos entradas, deshabilitadas: " + JSON.stringify(items));
await page.keyboard.press("Escape");

/* ---------- 2. The key in Propiedades ---------- */
const openPrefs = async () => {
  await page.click("#gnp-editor-btn");
  await page.waitForSelector("#props-dialog:not([hidden])");
  await page.click("#props-tab-btn-sources");
};
const setKey = async v => { await page.fill("#props-ors-key", v); await page.dispatchEvent("#props-ors-key", "change"); };
await openPrefs();
const where = await page.evaluate(() => ({ inSources: !!document.querySelector("#props-tab-sources #props-ors-key"),
  inPrefs: !!document.querySelector("#props-tab-prefs #props-ors-key") || /openrouteservice/.test(document.getElementById("props-tab-prefs").textContent),
  url: document.getElementById("props-ors-url").textContent }));
ok(where.inSources && !where.inPrefs && where.url === "https://api.heigit.org/openrouteservice/v2/directions",
  "la clave y la dirección del servicio están en «Fuentes de datos», nada en Preferencias: " + JSON.stringify(where));
/* The key is hidden, an eye shows it whole, and a line under it always tells how it ends */
const keyState = () => page.evaluate(() => {
  const i = document.getElementById("props-ors-key"), b = document.getElementById("props-ors-key-eye");
  return { type: i.type, value: i.value, pressed: b.getAttribute("aria-pressed"), label: b.getAttribute("aria-label"),
    title: b.title, hint: document.getElementById("props-ors-key-tail").textContent, focused: document.activeElement === i };
});
const keyBox = () => page.evaluate(() => { const r = document.getElementById("props-ors-key").getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; });
const clickEye = async () => { const r = await page.locator("#props-ors-key-eye").boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); };
let k = await keyState();
ok(k.type === "password" && k.pressed === "false" && k.label === "Mostrar la clave" && k.hint === "", "empty: hidden, eye off, no line: " + JSON.stringify(k));
await page.fill("#props-ors-key", KEY);
k = await keyState();
ok(k.type === "password" && k.hint === "Termina en …5678 · 56 caracteres", "typing a key tells how it ends WITHOUT showing it: " + JSON.stringify(k));
const boxHidden = await keyBox();
await clickEye();
const boxShown = await keyBox();
ok(boxHidden[0] > 300 && JSON.stringify(boxHidden) === JSON.stringify(boxShown),
  "the field keeps its size when the eye shows the key (the generic text-field cap of 190px must not apply): " + JSON.stringify({ boxHidden, boxShown }));
k = await keyState();
ok(k.type === "text" && k.value === KEY && k.pressed === "true" && k.label === "Ocultar la clave" && k.title === "Ocultar la clave" && k.focused,
  "the eye shows the key whole, says it will hide it, and leaves the focus in the field: " + JSON.stringify(k));
await clickEye();
k = await keyState();
ok(k.type === "password" && k.pressed === "false" && k.label === "Mostrar la clave", "and the same eye hides it again: " + JSON.stringify(k));
await page.fill("#props-ors-key", "abc");
ok((await keyState()).hint === "3 caracteres", "a short value says only its length, not its end");
await page.fill("#props-ors-key", KEY.slice(0, -1) + "9");
ok((await keyState()).hint === "Termina en …5679 · 56 caracteres", "the line follows what is typed, key by key");
await page.fill("#props-ors-key", "");
ok((await keyState()).hint === "", "emptied: no line");
await page.fill("#props-ors-key", KEY);
await clickEye();
ok((await keyState()).type === "text", "revealed again before closing");
await page.click("#props-cancel");
await openPrefs();
k = await keyState();
ok(k.type === "password" && k.pressed === "false" && k.value === "", "a key left on view does not outlive the dialog: it opens hidden again: " + JSON.stringify(k));
/* Keyboard: the eye is a real button reachable with Tab and pressed with Space */
await page.focus("#props-ors-key");
await page.keyboard.press("Tab");
ok(await page.evaluate(() => document.activeElement && document.activeElement.id === "props-ors-key-eye"), "Tab goes from the field to the eye");
await page.keyboard.press("Space");
ok((await keyState()).type === "text", "Space on the eye shows the key");
await page.keyboard.press("Space");
ok((await keyState()).type === "password", "and Space again hides it");
ok((await keyState()).value === "", "and no space was typed into the key");
await page.click("#props-cancel");
await openPrefs();
await setKey(KEY);
await page.click("#props-cancel");
ok(await page.evaluate(async () => orsKey === null && await dbLoadOrsKey() === null), "Cancelar no se queda con la clave");
await openPrefs();
await setKey("no es una clave");
ok(await page.evaluate(() => orsKey === null && document.getElementById("props-ors-key").value === "" && /no es válida/.test(msgLog.slice(-1)[0].text)),
  "una clave mal formada se rechaza con aviso");
await setKey(KEY);
await page.click("#props-accept");
let savedKey = null;
for (let i = 0; i < 50 && savedKey !== KEY; i++) savedKey = await page.evaluate(() => dbLoadOrsKey());
ok(savedKey === KEY && await page.evaluate(k => orsKey === k, KEY), "Aceptar la guarda en el navegador");
items = await menuItems(POINT, [], "Consultas");
ok(!items.find(i => i.text === "Ruta desde aquí").disabled, "con la clave, las entradas se habilitan");
await page.keyboard.press("Escape");

/* ---------- 3. The dialog ---------- */
await choose(SOL, ["Sol"], "Itinerario", "Desde este marcador");
let d = await dialogState();
ok(d.open && d.from === "Sol" && d.to === "" && d.calcDisabled && /Falta/.test(d.calcTitle),
  "«Desde este marcador» abre el diálogo con «Sol» de origen y Calcular deshabilitado: " + JSON.stringify(d));
await choose(POINT, [], "Consultas", "Ruta hasta aquí");
d = await dialogState();
ok(d.to === "40.420400, -3.700200" && !d.calcDisabled, "«Ruta hasta aquí» pone las coordenadas de destino: " + d.to);
/* «Elegir en el mapa» + a real click on the «Cibeles» marker */
await page.click("#route-to-pick");
ok((await dialogState()).tool === "route-to", "«Elegir en el mapa» arma la herramienta");
const pt = await page.evaluate(ll => { const p = map.latLngToContainerPoint(ll); const r = map.getContainer().getBoundingClientRect();
  return { x: r.left + p.x, y: r.top + p.y - 10 }; }, CIBELES);
await page.mouse.click(pt.x, pt.y);
d = await dialogState();
ok(d.to === "Cibeles" && d.tool === null, "un clic sobre un marcador lo toma de destino y suelta la herramienta: " + JSON.stringify(d));
await page.click("#route-swap");
d = await dialogState();
ok(d.from === "Cibeles" && d.to === "Sol", "⇅ intercambia origen y destino");
await page.click("#route-swap");
/* Escape: first the pick, then the dialog */
await page.click("#route-from-pick");
await page.keyboard.press("Escape");
d = await dialogState();
ok(d.tool === null && d.open, "Escape deja de elegir sin cerrar el diálogo");
/* typed coordinates */
await page.fill("#route-to", "no son coordenadas");
await page.dispatchEvent("#route-to", "change");
d = await dialogState();
ok(d.calcDisabled && await page.evaluate(() => document.getElementById("route-to").classList.contains("bad")), "un texto que no son coordenadas se marca y deshabilita Calcular");
await page.fill("#route-to", "40.4192, -3.6931");
await page.dispatchEvent("#route-to", "change");
ok(!(await dialogState()).calcDisabled, "unas coordenadas escritas valen");
await page.selectOption("#route-profile", "foot-walking");

/* ---------- 4. Calcular ---------- */
const calc = () => page.evaluate(async () => {
  const before = msgLog.length;
  const view = { c: map.getCenter(), z: map.getZoom() };
  document.getElementById("route-calc").click();
  const t0 = performance.now();
  await new Promise(r => setTimeout(r, 30));
  while (map.getContainer().classList.contains("route-busy") && performance.now() - t0 < 15000) await new Promise(r => setTimeout(r, 30));
  const sec = [...document.querySelectorAll("#tree li")].find(x => x._name === "Itinerarios");
  return { rows: sec ? [...nodeUl(sec).children].map(c => c._name) : [], log: msgLog.slice(before).map(e => e.text),
    viewMoved: !map.getCenter().equals(view.c) || map.getZoom() !== view.z };
});
let r = await calc();
ok(r.rows.length === 1 && /^Itinerario 1 — A pie · 0\.\d\d NM · 2 min$/.test(r.rows[0]),
  "«Itinerarios › Itinerario 1 — A pie · … · 2 min»: " + JSON.stringify(r.rows));
ok(!r.viewMoved, "la vista no se mueve");
ok(r.log.some(t => /Itinerario añadido en «Itinerarios»/.test(t)), "un aviso dice dónde está: " + r.log.join(" | "));
const q = seen[seen.length - 1];
ok(seen.length === 1 && q.method === "GET" && q.url.host === "api.heigit.org" && q.url.pathname === "/openrouteservice/v2/directions/foot-walking"
  && q.url.searchParams.get("api_key") === KEY && q.url.searchParams.get("start") === "-3.703790,40.416775"
  && q.url.searchParams.get("end") === "-3.693100,40.419200",
  "UNA petición con la clave, origen y destino en lon,lat y el modo: " + q.url.search);
ok(!q.headers.authorization && !Object.keys(q.headers).some(h => /^x-/.test(h)), "petición simple: sin cabeceras propias");
const card = await page.evaluate(`(() => { const li = [...document.querySelectorAll("#tree li")].find(x => /^Itinerario 1/.test(x._name)); return infoHtmlFor(li); })()`);
ok(/Origen/.test(card) && /Sol/.test(card) && /Destino/.test(card) && /A pie/.test(card) && /2 min/.test(card), "la ficha lleva el resumen");
ok(await page.evaluate(() => /openrouteservice/.test(map.attributionControl._container.textContent)), "y la atribución de openrouteservice");

/* ---------- 5. Errors, retry, cancel ---------- */
for (const [m, re, what] of [["403", /clave de openrouteservice no es válida/, "clave rechazada"], ["2009", /ningún itinerario/, "sin itinerario"],
  ["429", /cuota/, "cuota agotada"]]) {
  mode = m;
  const n0 = seen.length;
  r = await calc();
  ok(r.rows.length === 1 && r.log.some(t => re.test(t)) && seen.length === n0 + 1, `${what}: aviso claro, nada nuevo y sin reintentos: ` + r.log.join(" | "));
}
mode = "503once";
let n0 = seen.length;
r = await calc();
ok(r.rows.length === 2 && seen.length === n0 + 2 && !r.log.some(t => /Error/.test(t)), "un 503 se reintenta y acaba en el itinerario 2");
mode = "hang";
const cancelled = await page.evaluate(async () => {
  const before = msgLog.length;
  const btn = document.getElementById("route-calc");
  btn.click();
  await new Promise(r => setTimeout(r, 200));
  const label = btn.textContent, busy = map.getContainer().classList.contains("route-busy");
  btn.click();
  await new Promise(r => setTimeout(r, 200));
  return { label, busy, after: btn.textContent, busyAfter: map.getContainer().classList.contains("route-busy"), log: msgLog.slice(before).map(e => e.text) };
});
ok(cancelled.label === "Cancelar cálculo" && cancelled.busy && cancelled.after === "Calcular" && !cancelled.busyAfter && !cancelled.log.length,
  "«Cancelar cálculo» corta la petición sin aviso: " + JSON.stringify(cancelled));
mode = "ok";

/* ---------- 6. Undo, reload, saved tree, Restaurar ---------- */
await page.evaluate(() => undoLast());
const afterUndo = await page.evaluate(() => { const s = [...document.querySelectorAll("#tree li")].find(x => x._name === "Itinerarios"); return s ? nodeUl(s).children.length : 0; });
ok(afterUndo === 1, "deshacer quita el último itinerario");
await page.evaluate(() => saveTree());
ok(!(await page.evaluate(k => JSON.stringify(serializeTree()).includes(k), KEY)), "la clave no va en el árbol guardado ni en un .kite.json");
await page.reload();
await waitAppReady(page);
const back = await page.evaluate(() => ({ key: orsKey, attrib: /openrouteservice/.test(map.attributionControl._container.textContent),
  route: routesInRecords(serializeTree()) }));
ok(back.key === KEY && back.attrib && back.route, "tras recargar vuelven la clave, el itinerario y su atribución: " + JSON.stringify({ ...back, key: !!back.key }));
await page.click("#gnp-editor-btn");
await page.waitForSelector("#props-dialog:not([hidden])");
await page.click("#props-tab-btn-restore");
await page.click("#props-restore-btn");
const reloaded = page.waitForEvent("load");
await page.click("#restore-accept");
await reloaded;
await waitAppReady(page);
ok(await page.evaluate(async () => orsKey === null && await dbLoadOrsKey() === null), "«Restaurar» borra la clave");

const realErrors = errors.filter(e => !/status of (503|403|404|429)/.test(e));
ok(realErrors.length === 0, "sin errores de página: " + realErrors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");
ok(!everyUrl.some(u => u.includes("api.openrouteservice.org")), "ninguna petición fue al servidor antiguo (responde 410): " + everyUrl.filter(u => u.includes("openrouteservice")).join(" "));
ok(everyUrl.some(u => u.startsWith("https://api.heigit.org/openrouteservice/v2/directions/")), "y sí al nuevo");
await ctx.close();
await browser.close();
srv.close();
done();
