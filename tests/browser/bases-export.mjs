/* Saving and loading the configuration of the base layers (11-base-panel.js),
   end to end in the browser.

   1. 💾 at the bottom of the base-map list (opened with the layers button)
      downloads a .kite.json with the order, on/off, opacity, the user's own
      servers and the background colour, and no credential.
   2. Everything is changed (order, on/off, opacity, background, the user layer
      deleted, another one added); dropping the file on the navigation panel
      (handleDroppedFiles) brings it back: the fixed layers as in the file, the
      background, the deleted server added again but SWITCHED OFF (new to this
      browser) and named in a notice, the layer not in the file kept, off and at
      the end. Nothing enters the tree.
   3. Dropping it again reuses the server (no duplicate) and keeps its state.
   4. After a reload it is all kept.                                        */
import fs from "node:fs";
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER BASES EXPORT TESTS OK");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const browser = await launch();
const srv = await serve(READABLE, 8988);
const { ctx, page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });
/* the user's tile servers, faked */
await page.route(/ejemplo\.org/, route => route.fulfill({ status: 200, contentType: "image/png", body: PNG,
  headers: { "access-control-allow-origin": "*" } }));
const URL_A = "https://a.ejemplo.org/{z}/{x}/{y}.png", URL_B = "https://b.ejemplo.org/{z}/{x}/{y}.png";

const state = () => page.evaluate(() => ({
  order: [...baseState.keys()],
  on: Object.fromEntries([...baseState].map(([id, st]) => [id, st.on])),
  opacity: Object.fromEntries([...baseState].map(([id, st]) => [id, st.opacity])),
  users: userBaseStates().map(st => ({ id: st.def.id, name: st.def.name, url: st.def.user.url, on: st.on })),
  bg: mapBgColor, treeRows: document.querySelectorAll("#tree li").length
}));

/* ---------- 1. The configuration to save ---------- */
await page.evaluate(url => {
  const a = createUserBase({ type: "tiles", name: "Caché A", url });
  baseState.get("pnoa").opacity = 0.4;
  /* pnoa (off) to the top: the order is part of the configuration */
  const entries = [...baseState].filter(([id]) => id !== "pnoa");
  entries.push(["pnoa", baseState.get("pnoa")]);
  baseState.clear();
  entries.forEach(([id, st], i) => { st.zIndex = i + 1; baseState.set(id, st); });
  setMapBackground("#112233");
  renderBasePanel();
  return a;
}, URL_A);
const saved = await state();
await page.click(".base-toggle");
await page.waitForSelector(".base-list:not([hidden])");
const btn = await page.evaluate(() => { const b = document.querySelector(".base-list .base-foot .base-save");
  return b && { label: b.getAttribute("aria-label"), title: b.title, nextToAdd: !!b.parentElement.querySelector(".base-add") }; });
ok(btn && btn.label === "Guardar la configuración de las capas" && btn.nextToAdd && /arrástrelo al panel de navegación/.test(btn.title),
  "💾 al pie de la lista, junto a «+ Añadir capa…», con su nombre y cómo se carga: " + JSON.stringify(btn));
const [dl] = await Promise.all([page.waitForEvent("download"), page.click(".base-save")]);
const text = fs.readFileSync(await dl.path(), "utf8");
const doc = JSON.parse(text);
ok(/^capas-base-\d{8}\.kite\.json$/.test(dl.suggestedFilename()), "se descarga como capas-base-AAAAMMDD.kite.json: " + dl.suggestedFilename());
ok(doc.app === "kite-local/bases" && doc.order.join() === saved.order.join() && doc.bases.pnoa.opacity === 0.4
  && doc.userBases.length === 1 && doc.userBases[0].url === URL_A && doc.bases[doc.userBases[0].id].on === true && doc.background === "#112233",
  "con el orden, la activación, la opacidad, la capa propia y el color de fondo");
ok(!/instance|shCreds/i.test(text), "y sin la credencial de Copernicus");

/* ---------- 2. Change everything, then drop the file ---------- */
await page.evaluate(([urlB, idA]) => {
  removeUserBase(idA);
  createUserBase({ type: "tiles", name: "Caché B", url: urlB });
  baseState.get("osm").on = false; applyBaseLayer("osm");
  baseState.get("pnoa").opacity = 1;
  setMapBackground("#ffffff");
  renderBasePanel();
}, [URL_B, doc.userBases[0].id]);
const drop = () => page.evaluate(async t => {
  const before = msgLog.length;
  await handleDroppedFiles([new File([t], "capas-base.kite.json")]);
  return msgLog.slice(before).map(e => e.text);
}, text);
let log = await drop();
let s = await state();
const a = s.users.find(u => u.url === URL_A), b = s.users.find(u => u.url === URL_B);
ok(s.on.osm === true && s.opacity.pnoa === 0.4 && s.bg === "#112233", "las capas fijas y el color de fondo vuelven a como estaban: " + JSON.stringify({ osm: s.on.osm, pnoa: s.opacity.pnoa, bg: s.bg }));
ok(a && a.on === false && log.some(t => /Llegan apagadas/.test(t) && t.includes("Caché A")),
  "el servidor del archivo, que ya no estaba, vuelve APAGADO y el aviso lo nombra: " + log.join(" | "));
ok(b && b.on === false && s.order[s.order.length - 1] === b.id, "la capa que el archivo no nombra se queda, apagada y al final");
ok(s.order.slice(0, -1).join() === saved.order.map(id => id === doc.userBases[0].id ? a.id : id).join(), "el resto, en el orden del archivo");
ok(log.some(t => /Configuración de capas cargada de «capas-base\.kite\.json»: 1 capa\(s\) propia\(s\) añadida\(s\), 0 ya existía\(n\)/.test(t)),
  "un aviso resume lo que cambió");
ok(s.treeRows === saved.treeRows, "nada entra en el árbol");

/* ---------- 3. Again: the server is reused, not duplicated ---------- */
await page.evaluate(id => { baseState.get(id).on = true; applyBaseLayer(id); }, a.id);
log = await drop();
s = await state();
ok(s.users.filter(u => u.url === URL_A).length === 1 && s.users.find(u => u.url === URL_A).on === true
  && log.some(t => /0 capa\(s\) propia\(s\) añadida\(s\), 1 ya existía\(n\)/.test(t)) && !log.some(t => /Llegan apagadas/.test(t)),
  "cargarlo otra vez reutiliza el servidor, sin duplicarlo, y como ya se usaba aquí sigue la activación del archivo");

/* ---------- 4. Reload ---------- */
await page.evaluate(() => new Promise(r => setTimeout(r, 700))); /* past the save delay of the bases */
await page.reload();
await waitAppReady(page);
const after = await state();
ok(after.order.join() === s.order.join() && after.on.osm === true && after.opacity.pnoa === 0.4 && after.bg === "#112233"
  && after.users.length === 2, "tras recargar todo sigue igual");

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");
await ctx.close();
await browser.close();
srv.close();
done();
