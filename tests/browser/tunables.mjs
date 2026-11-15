/* The settings tunable in Propiedades (04-tunables.js) and the windows
   that always open whole inside the browser window, end to end.

   0. «Preferencias avanzadas»: unticked (the default) the advanced tabs
      and the advanced rows of «Elevación y perfil» are hidden; ticked they
      show, their tabs in red; Cancel puts it back, Accept keeps it after a
      reload, and unticking it while an advanced tab is shown goes back to
      «Preferencias». The values still apply while hidden.
   1. Propiedades has the new tabs, one row per setting, each with its
      default (and the default in the row's title).
   2. A change applies at once (CFG) and marks the row; a value out of
      bounds is adjusted with a notice; Cancel puts everything back.
   3. Accept saves only what differs; after a reload the values are back
      and in use (the session log keeps CFG.MSG_LOG_MAX entries).
   4. «Restaurar» (wipes the database) brings every default back.
   5. The info card restored to a place saved in a bigger window opens
      whole inside a smaller one, without overwriting the saved place; a
      bigger window gives that place back; resizing the browser with the
      card open keeps it inside; a saved size bigger than the window is
      capped by the window; dragging can still leave it half outside.
   6. Any other moved window (the calculator) is fitted when the browser
      shrinks.                                                           */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER TUNABLES TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8986);
const { ctx, page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

const openProps = async tab => {
  await page.click("#gnp-editor-btn");
  await page.waitForSelector("#props-dialog:not([hidden])");
  if (tab) await page.click(`#props-tab-btn-${tab}`);
};
const setField = async (id, text) => {
  await page.fill(`#tunable-${id}`, text);
  await page.dispatchEvent(`#tunable-${id}`, "change");
};
const cfg = ids => page.evaluate(list => Object.fromEntries(list.map(id => [id, CFG[id]])), ids);

/* ---------- 0. «Preferencias avanzadas» ---------- */
const visibleTabs = () => page.evaluate(() => [...document.querySelectorAll("#props-dialog .dlg-tab")]
  .filter(b => b.offsetWidth > 0).map(b => b.textContent));
const advancedState = () => page.evaluate(() => ({
  box: document.getElementById("props-advanced").checked,
  elevRows: document.querySelector('.tunables-list[data-tunables="elev"]').offsetHeight > 0,
  head: document.querySelector(".props-advanced-head").offsetHeight > 0,
  fresnel: document.getElementById("props-fresnel-freq").offsetParent !== null || null
}));
await openProps();
ok(JSON.stringify(await visibleTabs()) === JSON.stringify(["Preferencias", "Elevación y perfil", "Fuentes de datos", "Índices de GeoJSON", "Restaurar"]),
  "sin «Preferencias avanzadas», solo las pestañas de siempre: " + (await visibleTabs()).join("|"));
ok((await page.isVisible("#props-kmz-max")), "el tope del KMZ sigue en Preferencias");
await page.click("#props-tab-btn-freq");
let adv = await advancedState();
ok(!adv.box && !adv.elevRows && !adv.head && (await page.isVisible("#props-fresnel-freq")),
  "en «Elevación y perfil», la frecuencia de Fresnel sí y las filas avanzadas no: " + JSON.stringify(adv));
await page.click("#props-tab-btn-prefs");
await page.check("#props-advanced");
ok((await visibleTabs()).length === 10, "con la casilla, las diez pestañas: " + (await visibleTabs()).join("|"));
const red = await page.evaluate(() => {
  const rgb = el => getComputedStyle(el).color;
  const danger = (() => { const p = document.createElement("span"); p.style.color = "var(--danger)"; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; })();
  const tabs = [...document.querySelectorAll("#props-dialog .dlg-tab")];
  return { danger, advanced: tabs.filter(b => b.classList.contains("advanced")).map(b => [b.textContent, rgb(b) === danger]),
    usual: tabs.filter(b => !b.classList.contains("advanced")).every(b => rgb(b) !== danger),
    head: rgb(document.querySelector(".props-advanced-head")) === danger };
});
ok(JSON.stringify(red.advanced.map(a => a[0])) === JSON.stringify(["Interfaz", "Fichas", "Mapa y teclado", "Archivos", "Red"])
  && red.advanced.every(a => a[1]) && red.usual && red.head,
  "las cinco pestañas avanzadas y el rótulo «Avanzadas» en rojo, las demás no: " + JSON.stringify(red));
await page.click("#props-tab-btn-net");
await page.click("#props-tab-btn-prefs");
await page.click("#props-tab-btn-net");
await page.evaluate(() => { const i = document.getElementById("props-advanced"); i.checked = false; i.dispatchEvent(new Event("change")); });
ok((await page.isVisible("#props-tab-prefs")) && (await visibleTabs()).length === 5,
  "desmarcarla con una pestaña avanzada a la vista vuelve a «Preferencias»");
await page.check("#props-advanced");
await page.click("#props-cancel");
await page.waitForSelector("#props-dialog", { state: "hidden" });
await openProps();
ok((await visibleTabs()).length === 5 && !(await advancedState()).box, "Cancelar deja la casilla como estaba (sin marcar)");
await page.check("#props-advanced");
await page.click("#props-accept");
await page.waitForSelector("#props-dialog", { state: "hidden" });
let advSaved = false;
for (let i = 0; i < 50 && !advSaved; i++) advSaved = await page.evaluate(() => dbLoadAdvancedPrefs());
ok(advSaved, "Aceptar la guarda");
await page.reload();
await waitAppReady(page);

/* ---------- 1. The tabs and their rows ---------- */
await openProps();
ok((await advancedState()).box && (await visibleTabs()).length === 10, "tras recargar, la casilla sigue marcada y se ven las diez pestañas");
const tabs = await page.evaluate(() => {
  const out = {};
  for (const t of TUNABLES) {
    const row = document.getElementById(`tunable-${t.id}`).closest(".dlg-row");
    const list = row.closest(".tunables-list");
    out[t.id] = { tab: list.dataset.tunables === t.tab, value: Number(document.getElementById(`tunable-${t.id}`).value),
      shown: tunableShown(t, t.def), title: row.title, changed: row.classList.contains("changed") };
  }
  return { rows: out, names: [...document.querySelectorAll("#props-dialog .dlg-tab")].map(b => b.textContent) };
});
ok(JSON.stringify(tabs.names) === JSON.stringify(["Preferencias", "Interfaz", "Fichas", "Mapa y teclado", "Archivos", "Red",
  "Elevación y perfil", "Fuentes de datos", "Índices de GeoJSON", "Restaurar"]), "las diez pestañas, en orden: " + tabs.names.join("|"));
const rows = Object.entries(tabs.rows);
ok(rows.every(([, r]) => r.tab), "cada ajuste está en su pestaña");
ok(rows.every(([, r]) => r.value === r.shown && !r.changed), "cada campo enseña su valor de partida, sin marcar como cambiado");
ok(tabs.rows.INFO_STACK_TTL_MS.value === 30 && /Valor de partida: 30 s/.test(tabs.rows.INFO_STACK_TTL_MS.title),
  "la duración de una ficha reciente se escribe en segundos y el título dice su valor de partida: " + tabs.rows.INFO_STACK_TTL_MS.title);
const tabsFit = await page.evaluate(() => {
  const box = document.querySelector("#props-dialog .dlg-box").getBoundingClientRect();
  return [...document.querySelectorAll("#props-dialog .dlg-tab")].every(b => b.getBoundingClientRect().right <= box.right + 0.5);
});
ok(tabsFit, "las pestañas caben en la caja (pasan a una segunda línea)");

/* ---------- 2. Live, adjusted, cancelled ---------- */
await page.click("#props-tab-btn-ui");
await setField("UNDO_MAX", "50");
await page.click("#props-tab-btn-net");
const before = await page.evaluate(() => msgLog.length);
await setField("ELEV_MAX_RPS", "99");
const live = await page.evaluate(() => ({ undo: CFG.UNDO_MAX, rps: CFG.ELEV_MAX_RPS, field: document.getElementById("tunable-ELEV_MAX_RPS").value,
  changed: document.getElementById("tunable-UNDO_MAX").closest(".dlg-row").classList.contains("changed"),
  msg: msgLog.slice(-1)[0].text }));
ok(live.undo === 50 && live.changed, "un cambio se aplica al momento y su rótulo se marca: " + JSON.stringify(live));
ok(live.rps === 10 && live.field === "10" && /va de 1 a 10/.test(live.msg) && (await page.evaluate(() => msgLog.length)) > before,
  "fuera de rango se ajusta al límite y se avisa: " + JSON.stringify(live));
await page.click("#props-tab-btn-cards");
await page.evaluate(() => { const i = document.getElementById("tunable-INFO_STACK_TTL_MS"); i.value = ""; i.dispatchEvent(new Event("change")); });
ok((await cfg(["INFO_STACK_TTL_MS"])).INFO_STACK_TTL_MS === 30000 && (await page.inputValue("#tunable-INFO_STACK_TTL_MS")) === "30",
  "un campo vacío deja el valor vigente");
await page.click("#props-cancel");
await page.waitForSelector("#props-dialog", { state: "hidden" });
const cancelled = await cfg(["UNDO_MAX", "ELEV_MAX_RPS"]);
ok(cancelled.UNDO_MAX === 20 && cancelled.ELEV_MAX_RPS === 4, "Cancelar deja los valores de antes: " + JSON.stringify(cancelled));

/* ---------- 3. Accept, reload, in use ---------- */
await openProps("ui");
await setField("UNDO_MAX", "50");
await setField("MSG_LOG_MAX", "12");
await page.click("#props-tab-btn-cards");
await setField("INFO_STACK_TTL_MS", "12.5");
await page.click("#props-tab-btn-freq");
await setField("PF_FRESNEL_ZONE", "80");
await page.click("#props-accept");
await page.waitForSelector("#props-dialog", { state: "hidden" });
let saved = null;
for (let i = 0; i < 50 && !(saved && saved.UNDO_MAX); i++) saved = await page.evaluate(() => dbLoadTunables());
ok(JSON.stringify(saved) === JSON.stringify({ INFO_STACK_TTL_MS: 12500, MSG_LOG_MAX: 12, UNDO_MAX: 50, PF_FRESNEL_ZONE: 0.8 }),
  "Aceptar guarda solo lo que difiere de lo de partida: " + JSON.stringify(saved));
await page.reload();
await waitAppReady(page);
const after = await cfg(["UNDO_MAX", "MSG_LOG_MAX", "INFO_STACK_TTL_MS", "PF_FRESNEL_ZONE", "FOCUS_ZOOM"]);
ok(after.UNDO_MAX === 50 && after.MSG_LOG_MAX === 12 && after.INFO_STACK_TTL_MS === 12500 && after.PF_FRESNEL_ZONE === 0.8 && after.FOCUS_ZOOM === 14,
  "tras recargar, los valores cambiados siguen y el resto, de partida: " + JSON.stringify(after));
const capped = await page.evaluate(() => { for (let i = 0; i < 30; i++) navMessage("aviso " + i, { tone: "info" }); return msgLog.length; });
ok(capped === 12, "y se usan: el registro de avisos se queda en 12: " + capped);
await openProps("cards");
const shown = await page.evaluate(() => ({ v: document.getElementById("tunable-INFO_STACK_TTL_MS").value,
  changed: document.getElementById("tunable-INFO_STACK_TTL_MS").closest(".dlg-row").classList.contains("changed") }));
ok(shown.v === "12.5" && shown.changed, "el diálogo los enseña al reabrirlo: " + JSON.stringify(shown));
/* hidden, the advanced values still apply */
await page.click("#props-tab-btn-prefs");
await page.uncheck("#props-advanced");
await page.click("#props-accept");
await page.waitForSelector("#props-dialog", { state: "hidden" });
for (let i = 0; i < 50 && await page.evaluate(() => dbLoadAdvancedPrefs()); i++);
await page.reload();
await waitAppReady(page);
const hiddenStill = await page.evaluate(() => ({ advanced: advancedPrefs, undo: CFG.UNDO_MAX }));
ok(!hiddenStill.advanced && hiddenStill.undo === 50, "con las avanzadas ocultas, sus valores siguen valiendo: " + JSON.stringify(hiddenStill));
await page.evaluate(() => dbSaveAdvancedPrefs(true)); /* Restaurar must bring it back too */

/* ---------- 4. «Restaurar» brings the defaults back ---------- */
await openProps("restore");
await page.click("#props-restore-btn");
const reloaded = page.waitForEvent("load");
await page.click("#restore-accept");
await reloaded;
await waitAppReady(page);
const restored = await page.evaluate(async () => ({ overrides: tunableOverrides(), saved: await dbLoadTunables(),
  advanced: advancedPrefs, advancedSaved: await dbLoadAdvancedPrefs() }));
ok(!restored.advanced && !restored.advancedSaved, "y las preferencias avanzadas vuelven a estar ocultas");
ok(Object.keys(restored.overrides).length === 0 && Object.keys(restored.saved).length === 0,
  "tras «Restaurar», todos vuelven a su valor de partida: " + JSON.stringify(restored));

/* ---------- 5. The info card inside the window ---------- */
const KML = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Doc</name>`
  + `<Placemark><name>P1</name><description>Ficha de P1</description><Point><coordinates>-3.7,40.4,0</coordinates></Point></Placemark>`
  + `</Document></kml>`;
const openCard = () => page.evaluate(async () => {
  hideLayerInfo({ dismiss: true });
  await ensureMaterialized([...document.querySelectorAll("#tree li")].find(x => x._name === "Doc"));
  showLayerInfo([...document.querySelectorAll("#tree li")].find(x => x._name === "P1"));
});
const card = () => page.evaluate(() => ({ left: descBox.offsetLeft, top: descBox.offsetTop, w: descBox.offsetWidth, h: descBox.offsetHeight,
  W: innerWidth, H: innerHeight, styleLeft: descBox.style.left, shown: !document.getElementById("desc-dialog").hidden }));
const inside = c => c.shown && c.left >= 0 && c.top >= 0 && c.left + c.w <= c.W && c.top + c.h <= c.H;
await page.evaluate(t => handleDroppedFiles([new File([t], "p.kml")]), KML);
await page.waitForFunction(() => [...document.querySelectorAll("#tree li")].some(x => x._name === "Doc"));
await page.evaluate(() => saveTree()); /* the tree must be on disk before the reload */
/* saved where only a bigger window had room */
await page.evaluate(() => dbSaveInfoBox({ left: 1000, top: 700, width: null, height: null }));
await page.setViewportSize({ width: 800, height: 600 });
await page.reload();
await waitAppReady(page);
await openCard();
let c = await card();
ok(inside(c), "la ficha guardada en (1000, 700) se abre entera dentro de una ventana de 800 × 600: " + JSON.stringify(c));
await page.waitForTimeout(600); /* past the card's save delay */
ok((await page.evaluate(() => dbLoadInfoBox())).left === 1000, "y su sitio guardado no se pisa");
await page.setViewportSize({ width: 1600, height: 1100 });
await page.waitForFunction(() => descBox.style.left === "1000px");
c = await card();
ok(c.left === 1000 && c.top === 700, "al agrandar la ventana vuelve a su sitio: " + JSON.stringify(c));
await page.setViewportSize({ width: 700, height: 500 });
await page.waitForFunction(() => descBox.offsetLeft + descBox.offsetWidth <= innerWidth);
ok(inside(await card()), "al encoger la ventana con la ficha abierta, sigue entera dentro");
/* a size bigger than the window */
await page.evaluate(() => dbSaveInfoBox({ left: 300, top: 200, width: 3000, height: 3000 }));
await page.reload();
await waitAppReady(page);
await openCard();
c = await card();
ok(inside(c), "una ficha guardada de 3000 × 3000 cabe en la ventana: " + JSON.stringify(c));
await page.waitForTimeout(600);
ok((await page.evaluate(() => dbLoadInfoBox())).width === 3000, "y su tamaño guardado se conserva para una ventana mayor");
/* dragging stays free */
const head = await page.evaluate(() => { const r = descBox.querySelector("h2").getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; });
await page.mouse.move(head.x, head.y);
await page.mouse.down();
await page.mouse.move((await card()).W - 40, head.y, { steps: 10 });
await page.mouse.up();
c = await card();
ok(c.left + c.w > c.W, "arrastrarla sigue pudiendo dejarla medio fuera: " + JSON.stringify(c));

/* ---------- 6. Any other moved window ---------- */
await page.setViewportSize({ width: 1400, height: 900 });
await page.click("#geocalc-btn");
await page.waitForSelector("#geocalc-dialog:not([hidden])");
await page.evaluate(() => {
  const box = document.querySelector("#geocalc-dialog .dlg-box");
  Object.assign(box.style, { position: "fixed", margin: "0", left: "1100px", top: "600px" }); /* as a drag leaves it */
});
await page.setViewportSize({ width: 900, height: 650 });
await page.waitForFunction(() => innerWidth === 900);
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const gc = await page.evaluate(() => { const b = document.querySelector("#geocalc-dialog .dlg-box");
  return { left: b.offsetLeft, top: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight, W: innerWidth, H: innerHeight, shown: true }; });
ok(inside(gc), "la calculadora movida queda entera dentro al encoger la ventana: " + JSON.stringify(gc));

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");
await ctx.close();
await browser.close();
srv.close();
done();
