/* The info card's stack of recent cards, end to end with a REAL mouse.

   What matters is what the user sees while sweeping the map, and only real
   pointer events produce the mouseover/mouseout sequence (and the timings)
   it depends on: a fast sweep must neither rewrite the card on every marker
   nor fill the stack; resting on markers must leave one tab each, in the strip
   under the title; hovering a tab must change nothing and clicking it must
   show its card in the body, outline its layer, move no tab and stay when
   the pointer leaves; selecting text to copy it must change nothing;
   «Mostrar atributos» stacks like ℹ; the queue is first in, first out; F pins
   the layer under the pointer; the × keeps only pinned cards; a deleted layer
   leaves the stack. The state rules (intent, expiry, queue, pins, pause) are
   also covered in Node by tests/toolstest.js. */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER INFO STACK TESTS OK");

const browser = await launch();
const srv = await serve(READABLE, 8981);
const { ctx, page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

/* Five markers with a description on a row in the left half of the map (the
   card opens top right), and three more out of view for the queue. */
const NAMES = ["M1", "M2", "M3", "M4", "M5"];
const EXTRA = ["X6", "X7", "X8", "MLAT LEPA RX 30"];
const pm = (n, lng, lat) => `<Placemark><name>${n}</name><description>Ficha de ${n}, texto para copiar</description>`
  + `<Point><coordinates>${lng.toFixed(2)},${lat.toFixed(2)},0</coordinates></Point></Placemark>`;
const KML = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Doc</name>`
  + NAMES.map((n, i) => pm(n, -3.80 + i * 0.02, 40.40)).join("")
  + EXTRA.map((n, i) => pm(n, -3.80 + i * 0.02, 40.20)).join("")
  + `</Document></kml>`;
await page.evaluate(t => handleDroppedFiles([new File([t], "m.kml")]), KML);
await page.evaluate(async () => {
  const f = [...document.querySelectorAll("#tree li")].find(x => x._name === "Doc");
  await ensureMaterialized(f);
  map.setView([40.40, -3.76], 13, { animate: false });
});
await page.waitForFunction(() => document.querySelectorAll(".leaflet-marker-icon").length >= 5);

/* Screen point inside each marker's pin (anchored at its tip, 41 px tall) */
const spots = await page.evaluate(names => {
  const c = map.getContainer().getBoundingClientRect();
  const out = {};
  for (const n of names) {
    const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
    const l = nodeLayer(li);
    const p = map.latLngToContainerPoint(l.getLayers ? l.getLayers()[0].getLatLng() : l.getLatLng());
    out[n] = { x: c.left + p.x, y: c.top + p.y - 20 };
  }
  out.empty = { x: c.left + 120, y: c.top + c.height - 120 };
  return out;
}, NAMES);

const state = () => page.evaluate(() => ({
  hidden: document.getElementById("desc-dialog").hidden,
  title: document.getElementById("desc-title").textContent,
  bodyHidden: document.getElementById("desc-body").hidden,
  body: document.getElementById("desc-body").textContent,
  rows: [...document.querySelectorAll("#desc-stack-list .info-tab:not(.live) .info-tab-name")].map(e => e.textContent),
  live: [...document.querySelectorAll("#desc-stack-list .info-tab.live .info-tab-name")].map(e => e.textContent),
  selected: [...document.querySelectorAll("#desc-stack-list .info-tab.selected .info-tab-name")].map(e => e.textContent),
  stack: infoStack.map(r => r.li._name),
  peek: infoPeek ? infoPeek._name : null,
  pinned: infoStack.filter(r => r.pinned).map(r => r.li._name)
}));
const watchTitles = () => page.evaluate(() => {
  const t = document.getElementById("desc-title");
  window.__titles = [];
  window.__titleObs?.disconnect();
  window.__titleObs = new MutationObserver(() => window.__titles.push(t.textContent));
  window.__titleObs.observe(t, { childList: true, characterData: true, subtree: true });
});
const rest = async (n, ms) => {
  await page.mouse.move(spots[n].x - 30, spots[n].y + 25);
  await page.mouse.move(spots[n].x, spots[n].y, { steps: 3 });
  for (let t = 0; t < ms; t += 100) { await page.mouse.move(spots[n].x + (t / 100) % 2, spots[n].y); await page.waitForTimeout(100); }
};
const toEmpty = async () => { await page.mouse.move(spots.empty.x, spots.empty.y, { steps: 4 }); await page.waitForTimeout(400); };
const tabAt = name => page.evaluate(n => {
  const el = [...document.querySelectorAll("#desc-stack-list .info-tab")].find(r => r.querySelector(".info-tab-name").textContent === n);
  const r = el.querySelector(".info-tab-btn").getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top };
}, name);

/* The markers came out of a never-expanded folder (ensureMaterialized): the
   waiting listeners of wirePendingLayerEvents were swapped for the definitive
   ones, and that swap used to take the only mouseout away (the card never
   heard the pointer leave). */
const outs = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "M2");
  return ((nodeLayer(li)._events || {}).mouseout || []).length;
});
ok(outs === 1, "a layer built from a pending record keeps exactly one mouseout listener: " + outs);

/* ---------- 1. A fast sweep neither rewrites the card nor fills the stack ---------- */
await page.mouse.move(spots.empty.x, spots.empty.y);
await watchTitles();
await page.mouse.move(spots.M1.x - 40, spots.M1.y);
await page.mouse.move(spots.M5.x + 40, spots.M5.y, { steps: 25 }); /* across the five markers in a few frames */
await toEmpty();
let s = await state();
const titles = await page.evaluate(() => window.__titles);
ok(!titles.some(t => /M[2-5]/.test(t)), "sweeping across five markers does not rewrite the card with the ones only crossed: " + JSON.stringify(titles));
ok(s.hidden && s.rows.length === 0, "and nothing rested on: no stack, the card closed: " + JSON.stringify(s));

/* ---------- 2. Resting on markers leaves one tab each, in the strip under the title ---------- */
await rest("M1", 700);
await rest("M2", 700);
await rest("M3", 700);
s = await state();
const order = await page.evaluate(() => {
  const body = document.getElementById("desc-body"), stack = document.getElementById("desc-stack");
  return stack.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING ? "tabs-then-body" : "body-then-tabs";
});
ok(!s.hidden && s.title === "M3" && s.live.join() === "M3" && s.rows.join() === "M2,M1" && s.selected.join() === "M3",
  "on M3: its card live (first tab, selected), M2 and M1 as tabs: " + JSON.stringify(s));
ok(order === "tabs-then-body", "the tabs sit between the title and the card, on one line");
await toEmpty();
s = await state();
ok(!s.hidden && s.title === "Fichas recientes" && s.bodyHidden && s.rows.join() === "M3,M2,M1" && !s.live.length,
  "leaving them all: the card shrinks to its title and tabs: " + JSON.stringify(s));

/* ---------- 3. A click on a tab shows its card in the body; hovering does nothing ---------- */
const view0 = await page.evaluate(() => [map.getCenter().lat, map.getCenter().lng, map.getZoom()]);
const t3a = await tabAt("M3"), t2a = await tabAt("M2");
await page.mouse.move(t2a.x, t2a.y, { steps: 5 });
await page.waitForTimeout(400);
s = await state();
ok(s.title === "Fichas recientes" && !s.selected.length && s.bodyHidden, "resting on the M2 tab changes nothing: " + JSON.stringify(s));
await page.mouse.click(t2a.x, t2a.y);
s = await state();
const look = await page.evaluate(() => ({ halo: !!infoHalo && map.hasLayer(infoHalo), view: [map.getCenter().lat, map.getCenter().lng, map.getZoom()] }));
ok(s.title === "M2" && /Ficha de M2/.test(s.body) && s.selected.join() === "M2" && !s.bodyHidden,
  "clicking the M2 tab shows its card in the body, one at a time: " + JSON.stringify(s));
ok(look.halo && JSON.stringify(look.view) === JSON.stringify(view0), "its layer is outlined on the map, without moving the view");
ok(await page.evaluate(() => !document.activeElement.closest("#desc-dialog")),
  "the click does not take the focus into the card (with the focus inside, the card would never shrink again)");
const t3b = await tabAt("M3"), t2b = await tabAt("M2");
ok(t3b.top === t3a.top && t2b.top === t2a.top && t2b.left === t2a.left, "showing a card moved no tab: " + JSON.stringify({ t2a, t2b, t3a, t3b }));
const t1 = await tabAt("M1");
await page.mouse.move(t1.x, t1.y, { steps: 6 });
await page.waitForTimeout(400);
ok((await state()).title === "M2", "resting on the M1 tab does not switch either");
await page.mouse.click(t1.x, t1.y);
s = await state();
ok(s.title === "M1" && /Ficha de M1/.test(s.body) && s.selected.join() === "M1", "clicking the M1 tab replaces it: " + JSON.stringify(s.selected));
await toEmpty();
s = await state();
ok(s.title === "M1" && s.selected.join() === "M1" && (await page.evaluate(() => !!infoHalo)), "leaving the card: the chosen card and its outline stay: " + JSON.stringify(s));
await rest("M5", 600);
s = await state();
ok(s.title === "M5" && s.live.join() === "M5" && s.peek === null && !(await page.evaluate(() => !!infoHalo)),
  "resting on another layer of the map makes it live and ends the choice: " + JSON.stringify(s));
await toEmpty();
s = await state();
ok(s.title === "Fichas recientes" && !s.selected.length, "leaving everything: compact again: " + JSON.stringify(s));

/* ---------- 4. Selecting text to copy it changes nothing ---------- */
await rest("M4", 300); /* live card M4, the tabs above its text */
const text = await page.evaluate(() => {
  const r = document.querySelector("#desc-body").getBoundingClientRect();
  return { x: r.left + 6, y: r.top + 8 };
});
const farTab = await tabAt("M1");
await page.mouse.move(text.x, text.y, { steps: 6 });
await page.mouse.down();
await page.mouse.move(farTab.x, farTab.y, { steps: 12 }); /* drags the selection up across the tabs */
await page.waitForTimeout(350);
await page.mouse.up();
s = await state();
const sel = await page.evaluate(() => getSelection().toString());
ok(s.title === "M4" && s.peek === null && /icha de M4/.test(s.body) && sel.length > 0, "dragging a selection up across the tabs switches none and keeps the text: " + JSON.stringify({ s, sel }));
await page.mouse.move(farTab.x + 1, farTab.y);
await page.waitForTimeout(350);
s = await state();
ok(s.peek === null && s.title === "M4", "with text selected, resting on a tab switches nothing");
await toEmpty();
s = await state();
ok(s.title === "M4" && (await page.evaluate(() => getSelection().toString())).length > 0, "leaving the card with text selected: it stays as it was, to copy it");
await page.evaluate(() => getSelection().removeAllRanges());
await page.waitForTimeout(400);
s = await state();
ok(s.title === "Fichas recientes", "once the selection goes, the card goes on to compact: " + s.title);

/* ---------- 5. «Mostrar atributos» stacks like ℹ ---------- */
const ctxShow = async n => {
  await page.mouse.click(spots[n].x, spots[n].y, { button: "right" });
  await page.waitForSelector(".ctx-menu:not([hidden])");
  await page.locator(".ctx-menu .ctx-menu-item", { hasText: "Mostrar atributos" }).first().click();
};
await ctxShow("M5");
s = await state();
ok(!s.hidden && s.title === "M5", "«Mostrar atributos» on M5 opens its card");
await ctxShow("M2");
s = await state();
ok(s.title === "M2" && s.stack[0] === "M5", "«Mostrar atributos» on M2: M5 goes to the stack, on top, without having rested on it: " + JSON.stringify(s.stack));

/* ---------- 6. First in, first out ---------- */
await page.evaluate(() => hideLayerInfo({ dismiss: true }));
await page.evaluate(names => {
  for (const n of names) showLayerInfo([...document.querySelectorAll("#tree li")].find(x => x._name === n));
}, ["M1", "M2", "M3", "M4", "M5", "X6", "X7", "X8"]);
s = await state();
ok(s.title === "X8" && s.stack.join() === "X7,X6,M5,M4,M3,M2", "eight opened, X8 live: the six newest in the stack, M1 (the first) went out: " + JSON.stringify(s.stack));
await page.evaluate(() => showLayerInfo([...document.querySelectorAll("#tree li")].find(x => x._name === "M4")));
s = await state();
ok(s.stack.join() === "X8,X7,X6,M5,M4,M3" && s.live.join() === "M4" && s.rows.join() === "X8,X7,X6,M5,M3",
  "revisiting M4 leaves it where it was in the stack (X8 enters, M2 goes); its tab is the live one: " + JSON.stringify(s));

/* ---------- 7. F pins the layer under the pointer; the × keeps only pinned rows ---------- */
/* closed with dismiss: hovering stays off until an explicit open (existing behaviour); re-armed here */
await page.evaluate(() => { hideLayerInfo({ dismiss: true }); layerInfoDismissed = false; });
await page.evaluate(() => map.getContainer().focus());
await rest("M3", 300);
await page.keyboard.press("f");
s = await state();
const pinBtn = await page.evaluate(() => document.getElementById("desc-pin").getAttribute("aria-pressed"));
ok(s.title === "M3" && s.pinned.join() === "M3" && pinBtn === "true", "F pins the card on screen: " + JSON.stringify({ s, pinBtn }));
await toEmpty();
await page.click("#desc-dialog .dlg-close");
s = await state();
ok(s.hidden && s.pinned.join() === "M3" && (await page.evaluate(() => infoStack.length)) === 1, "the × closes the card and keeps only the pinned row");

/* ---------- 8. An explicit open shows the pinned row; focus does not land on the stack ---------- */
await page.evaluate(() => showLayerInfo([...document.querySelectorAll("#tree li")].find(x => x._name === "M5")));
s = await state();
const focus = await page.evaluate(() => ({ inStack: !!document.activeElement.closest("#desc-stack, .dlg-pin"), inBox: !!document.activeElement.closest("#desc-dialog") }));
ok(!s.hidden && s.title === "M5" && s.rows.join() === "M3", "ℹ of M5: its card, with the pinned M3 row: " + JSON.stringify(s));
ok(focus.inBox && !focus.inStack, "the opening focus goes to the card, not to the pin or a tab (focus would switch the card): " + JSON.stringify(focus));

/* ---------- 9. A pin from the card header, and a deleted layer leaves the stack ---------- */
await page.click("#desc-pin");
s = await state();
ok(s.pinned.sort().join() === "M3,M5", "the header pin pins the card shown: " + JSON.stringify(s.pinned));
await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "M3");
  deleteNode(li);
  scheduleSave();
});
s = await state();
ok(!s.rows.includes("M3"), "deleting M3 takes its row out of the stack: " + JSON.stringify(s.rows));

/* ---------- 10. A tab has room for a name like «MLAT LEPA RX 30» ---------- */
await page.evaluate(() => {
  hideLayerInfo({ dismiss: true });
  const row = n => [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  showLayerInfo(row("MLAT LEPA RX 30"));
  showLayerInfo(row("M1")); /* MLAT… becomes a recent tab */
});
const cut = () => page.evaluate(() => {
  const el = [...document.querySelectorAll("#desc-stack-list .info-tab-name")].find(e => e.textContent === "MLAT LEPA RX 30");
  return { cut: el.scrollWidth > el.clientWidth, w: el.clientWidth, need: el.scrollWidth };
});
const plain = await cut();
ok(!plain.cut, "«MLAT LEPA RX 30» fits in its tab: " + JSON.stringify(plain));
await page.evaluate(() => [...document.querySelectorAll("#desc-stack-list .info-tab-btn")].find(b => b.textContent.includes("MLAT")).click());
const bold = await cut();
ok(!bold.cut, "and still fits chosen, in bold: " + JSON.stringify(bold));

ok(errors.length === 0, "no page errors: " + JSON.stringify(errors));
await ctx.close();
await browser.close();
srv.close();
done();
