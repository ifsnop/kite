/* «Artículos de Wikipedia en la vista» in the viewer's context menu, end to end in a
   real browser. The Wikipedia API is FAKED with page.route, answering with the
   REAL responses captured in tests/fixtures (2026-11-09), so the test does not
   depend on the network and every request is counted and inspected.

   1) Right click → «Consultas» › «Artículos de Wikipedia en la vista»: creates the
      «Wikipedia» section with a folder «Wikipedia 1» holding one marker per
      article, in order of distance, each with the "W" icon, the view does not
      move, and the card carries the summary, the link and the licence credit.
   2) The requests: ONE geosearch (the reach of the view, 100 articles, coordinates of the click)
      and five extracts requests of 20 pages, one after the other, all plain GETs
      (no headers of their own, no cookies).
   3) Repeating the query makes «Wikipedia 2»; the attribution is added once.
   4) With the English interface the English Wikipedia is asked, and the texts
      are in English.
   5) No articles in the radius: a notice, nothing in the tree.
   6) A transient failure (the real "search is too busy" answer, which comes with
      HTTP 200, and a 503) is retried and never reaches the user; the wait cursor
      shows while it lasts.
   7) A permanent API error is shown with the service's own text and NOT retried.
   8) A chunk of summaries that keeps failing does not sink the query: its
      articles keep the link and the user is told.
   9) Hostile data (a title that is markup, a summary with a script, a latitude
      out of range) never becomes markup, and the bad entry is skipped.
  10) Undo removes everything; the entry stays enabled with the map rotated; the
      result survives a reload with its cards.                                */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER WIKIPEDIA TESTS OK");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = n => JSON.parse(fs.readFileSync(path.join(HERE, "..", "fixtures", n), "utf8"));
const GEO = fx("wikipedia-geosearch-madrid.json");
const EXT = fx("wikipedia-extracts-madrid.json");
const BUSY = fx("wikipedia-error-busy.json");
const TITLES = new Map(GEO.query.geosearch.map(r => [r.pageid, r.title]));
const REAL_EXTRACTS = new Map(EXT.query.pages.map(p => [p.pageid, p]));

const browser = await launch();
const srv = await serve(READABLE, 8915);
const { ctx, page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

/* ---------- The fake service ---------- */
const seen = [];          /* { kind: "geo" | "extracts", host, params, headers } */
const state = { geoBusy: 0, extractsDown: 0, geoOverride: null, extractsOverride: null, permanentFromExtract: 0 };
let extractsInQuery = 0, active = 0, maxActive = 0;
const route = async r => {
  const req = r.request();
  const u = new URL(req.url());
  const json = (body, status = 200) => r.fulfill({ status, contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body), headers: { "access-control-allow-origin": "*" } });
  active++; maxActive = Math.max(maxActive, active);
  await new Promise(res => setTimeout(res, 15));
  try {
    if (u.searchParams.get("list") === "geosearch") {
      seen.push({ kind: "geo", host: u.host, params: u.searchParams, headers: req.headers() });
      if (state.geoBusy > 0) { state.geoBusy--; return await json(BUSY); }
      if (state.geoOverride) return await json(state.geoOverride(u.searchParams));
      return await json(GEO);
    }
    seen.push({ kind: "extracts", host: u.host, params: u.searchParams, headers: req.headers() });
    extractsInQuery++;
    if (state.extractsDown > 0) { state.extractsDown--; return await json({ error: "unavailable" }, 503); }
    if (state.permanentFromExtract && extractsInQuery >= state.permanentFromExtract) {
      return await json({ error: { code: "badvalue", info: "Invalid value for pageids" } });
    }
    const ids = u.searchParams.get("pageids").split("|").map(Number);
    if (state.extractsOverride) return await json(state.extractsOverride(ids));
    return await json({ batchcomplete: true, query: { pages: ids.map(id => REAL_EXTRACTS.get(id)
      || { pageid: id, ns: 0, title: TITLES.get(id) || "Article " + id, extract: `Synthetic summary of article ${id}.` }) } });
  } finally { active--; }
};
await page.route(/\.wikipedia\.org/, route);
const count = kind => seen.filter(s => s.kind === kind).length;
const reset = () => { state.geoBusy = 0; state.extractsDown = 0; state.geoOverride = null; state.extractsOverride = null;
  state.permanentFromExtract = 0; extractsInQuery = 0; };

const POINTS = { sol: { lat: 40.4169, lng: -3.7035 }, empty: { lat: 10.0, lng: 10.0 } };

/* Picks «Consultas › Artículos de Wikipedia en la vista» from the context menu of a point and
   waits until the query is over (the wait cursor comes back). Returns what happened. */
async function queryViaMenu(pg, ll, { watchBusy = false } = {}) {
  return pg.evaluate(async ({ lat, lng, watchBusy }) => {
    const countsBefore = msgLog.map(e => e.count);
    const fresh = () => msgLog.filter((e, i) => i >= countsBefore.length || e.count > countsBefore[i]).map(e => e.text);
    const markers = () => [...document.querySelectorAll("#tree li")].filter(x => x._mstyle && x._mstyle.icon === "wikipedia").length;
    const before = markers();
    openCtxMenu(L.latLng(lat, lng), 600, 400, []);
    const trigger = [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")].find(x => x.textContent === tr("Consultas") + " ▸");
    trigger.click();
    const item = [...document.querySelectorAll(".ctx-menu:not(#map-ctxmenu) .ctx-menu-item")]
      .find(x => x.textContent === tr("Artículos de Wikipedia en la vista"));
    if (!item || item.disabled) return { item: !!item, disabled: item && item.disabled };
    const view = { c: map.getCenter(), z: map.getZoom() };
    item.click();
    const busy = () => map.getContainer().classList.contains("wikipedia-busy");
    let sawBusy = busy();
    const t0 = performance.now();
    while (busy() && performance.now() - t0 < 40000) {
      await new Promise(r => setTimeout(r, 30));
      if (watchBusy && busy()) sawBusy = true;
    }
    return { added: markers() - before, log: fresh(), sawBusy, busyAfter: busy(),
             viewMoved: !map.getCenter().equals(view.c) || map.getZoom() !== view.z };
  }, { ...ll, watchBusy });
}
const treeShape = pg => pg.evaluate(() => {
  const sec = [...document.querySelectorAll("#tree li")].find(li => li._name === "Wikipedia" && li.classList.contains("file"));
  if (!sec) return null;
  return { name: sec._name, folders: [...nodeUl(sec).children].map(f => ({ name: f._name, n: nodeUl(f).children.length })) };
});
const folderRow = (pg, name) => pg.evaluate(n => {
  const f = [...document.querySelectorAll("#tree li")].find(li => li._name === n);
  return f ? [...nodeUl(f).children].map(c => c._name) : null;
}, name);

await page.evaluate(({ lat, lng }) => map.setView([lat, lng], 15, { animate: false }), POINTS.sol);

/* What the view covers from a point, worked out here on its own: the distance to the farthest corner of the viewer, in whole metres */
const reachOf = (pg, ll) => pg.evaluate(({ lat, lng }) => {
  const sz = map.getSize(), from = L.latLng(lat, lng);
  return Math.ceil(Math.max(...[[0, 0], [sz.x, 0], [0, sz.y], [sz.x, sz.y]]
    .map(c => map.distance(from, map.containerPointToLatLng(L.point(c[0], c[1]))))));
}, ll);
const radiusAsked = () => Number(seen.filter(s => s.kind === "geo").at(-1).params.get("gsradius"));
const REACH15 = await reachOf(page, POINTS.sol);

/* ---------- 1. One query: section, folder, markers ---------- */
const q1 = await queryViaMenu(page, POINTS.sol, { watchBusy: true });
ok(q1.added === 100, "the query adds 100 markers: " + JSON.stringify(q1));
ok(!q1.viewMoved, "the user's view does not move");
ok(q1.sawBusy && !q1.busyAfter, "the wait cursor shows while it lasts and goes away: " + JSON.stringify(q1));
let shape = await treeShape(page);
ok(shape && shape.folders.length === 1 && shape.folders[0].name === "Wikipedia 1" && shape.folders[0].n === 100,
  "«Wikipedia» › «Wikipedia 1» with 100 markers: " + JSON.stringify(shape));
const names1 = await folderRow(page, "Wikipedia 1");
ok(names1[0] === "Puerta del Sol" && names1.join() === GEO.query.geosearch.map(r => r.title).join(), "in order of distance, nearest first: " + names1.slice(0, 3));
ok(q1.log.some(t => /100 artículos de Wikipedia añadidos en «Wikipedia 1»/.test(t)), "an info notice says how many: " + JSON.stringify(q1.log));
ok(q1.log.some(t => /Se muestran los 100 artículos más cercanos/.test(t)), "and that there may be more (the limit was reached): " + JSON.stringify(q1.log));
ok(q1.log.some(t => /pulse 🔍 en la carpeta para verlos/.test(t)), "the notice says how to see them (the folder's lupa), since the view does not move: " + JSON.stringify(q1.log));
ok(!q1.log.some(t => /Error/.test(t)), "no error notices");
const revealed = await page.evaluate(() => {
  const f = [...document.querySelectorAll("#tree li")].find(x => x._name === "Wikipedia 1");
  const sec = f.parentElement.closest("li");
  const r = f.querySelector(":scope > .node-row").getBoundingClientRect(), t = document.getElementById("tree").getBoundingClientRect();
  return { collapsed: f.classList.contains("collapsed"), expanded: f.getAttribute("aria-expanded"), selected: selection.has(f),
           sectionOpen: !sec.classList.contains("collapsed"), inView: r.top >= t.top - 1 && r.bottom <= t.bottom + 1 };
});
ok(revealed.collapsed && revealed.expanded === "false", "the new folder is added collapsed (100 rows would push the user's layers away): " + JSON.stringify(revealed));
ok(revealed.selected && revealed.sectionOpen && revealed.inView, "and its row is revealed and selected: " + JSON.stringify(revealed));

/* ---------- 2. The requests ---------- */
ok(count("geo") === 1 && count("extracts") === 5, "one geosearch and five extracts requests (100 pages in chunks of 20): " + count("geo") + "/" + count("extracts"));
ok(maxActive === 1, "one request at a time, never in parallel: " + maxActive);
const geoReq = seen.find(s => s.kind === "geo");
ok(geoReq.host === "es.wikipedia.org", "the Spanish Wikipedia for the Spanish interface: " + geoReq.host);
ok(REACH15 > 500 && REACH15 < 10000 && geoReq.params.get("gsradius") === String(REACH15), "the radius is what the view covers from the click (" + REACH15 + " m), not a fixed one: " + geoReq.params.get("gsradius"));
ok(geoReq.params.get("gslimit") === "100" && geoReq.params.get("origin") === "*"
  && geoReq.params.get("gscoord") === `${POINTS.sol.lat.toFixed(6)}|${POINTS.sol.lng.toFixed(6)}`, "100 articles, the clicked point, CORS: " + geoReq.params);
const extReqs = seen.filter(s => s.kind === "extracts");
ok(extReqs.every(s => s.params.get("pageids").split("|").length === 20 && s.params.get("exintro") === "1" && s.params.get("explaintext") === "1"),
  "every extracts request asks for 20 pages, intro only, as plain text");
ok(new Set(extReqs.flatMap(s => s.params.get("pageids").split("|"))).size === 100, "and between them all 100 distinct pages");
ok(seen.every(s => !Object.keys(s.headers).some(h => /^(authorization|x-|content-type)/.test(h)) && !s.headers.cookie),
  "plain requests: no headers of our own, no cookies: " + Object.keys(seen[0].headers));

/* ---------- The cards, the icon, the attribution ---------- */
const card = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Puerta del Sol");
  const layer = nodeLayer(li);
  showLayerInfo(li);
  const dlg = document.getElementById("desc-dialog");
  const a = [...dlg.querySelectorAll("a")].find(x => /wikipedia\.org/.test(x.href));
  const out = {
    html: infoHtmlFor(li), icon: li._mstyle.icon, inGroup: rootGroup.hasLayer(layer), checked: li.querySelector("input[type=checkbox]").checked,
    link: a && { href: a.href, target: a.target, rel: a.rel, text: a.textContent },
    shown: !dlg.hidden, hasSvg: !!(layer.getElement() && layer.getElement().querySelector("svg")),
    at: layer.getLatLng()
  };
  hideLayerInfo && hideLayerInfo();
  return out;
});
ok(card.icon === "wikipedia" && card.hasSvg, "the marker carries the Wikipedia «W» icon: " + card.icon);
ok(card.inGroup && card.checked, "it is on the map and active");
ok(Math.abs(card.at.lat - 40.41694) < 1e-5 && Math.abs(card.at.lng + 3.70361) < 1e-5, "at the article's coordinates: " + JSON.stringify(card.at));
ok(/La Puerta del Sol|Puerta del Sol/.test(card.html) && card.html.length > 200, "the card has the summary of the article");
ok(card.link && card.link.href === "https://es.wikipedia.org/wiki/Puerta_del_Sol", "and a link to the full article: " + JSON.stringify(card.link));
ok(card.link && card.link.target === "_blank" && /noopener/.test(card.link.rel), "that opens in a new tab with noopener: " + JSON.stringify(card.link));
ok(card.link && /Leer el artículo completo en Wikipedia/.test(card.link.text), "labelled for the user: " + (card.link && card.link.text));
ok(/CC BY-SA 4\.0/.test(card.html) && /del punto consultado/.test(card.html), "with the distance and the licence credit the text requires");
ok(/A \d+\.\d{3} NM del punto consultado/.test(card.html), "the distance has useful decimals in the default unit (NM): " + card.html.slice(-120));
ok(card.shown, "the card opens like any other (the ℹ button / hover)");
const look = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Puerta del Sol");
  const el = nodeLayer(li).getElement(), badge = el && el.querySelector(".icon-badge");
  const cs = badge && getComputedStyle(badge);
  return { aria: el && el.getAttribute("aria-label"), role: el && el.getAttribute("role"), badge: !!badge,
           bg: cs && cs.backgroundColor, radius: cs && cs.borderRadius, glyph: badge && getComputedStyle(badge.querySelector("svg")).color };
});
ok(look.badge && look.bg === "rgb(255, 255, 255)" && /50%|\d+px/.test(look.radius), "the «W» is not a bare letter: it sits on a round white badge, readable on any base map: " + JSON.stringify(look));
ok(look.aria === "Puerta del Sol" && look.role === "button", "the marker icon has an accessible name (the article's title): " + JSON.stringify({ aria: look.aria, role: look.role }));
let attrib = await page.evaluate(() => document.querySelector(".leaflet-control-attribution").textContent);
ok(/Wikipedia \(CC BY-SA 4\.0\)/.test(attrib), "the attribution is on the map: " + attrib);

/* ---------- 3. Repeating makes another folder; the attribution is added once ---------- */
reset();
const q3 = await queryViaMenu(page, POINTS.sol);
shape = await treeShape(page);
ok(q3.added === 100 && shape.folders.map(f => f.name).join() === "Wikipedia 1,Wikipedia 2", "a second query makes «Wikipedia 2»: " + JSON.stringify(shape));
attrib = await page.evaluate(() => document.querySelector(".leaflet-control-attribution").textContent);
ok((attrib.match(/Wikipedia \(CC BY-SA/g) || []).length === 1, "the attribution is not repeated: " + attrib);

/* ---------- 5. Nothing within the radius ---------- */
reset();
state.geoOverride = () => ({ batchcomplete: true, query: { geosearch: [] } });
const nExt = count("extracts");
const q5 = await queryViaMenu(page, POINTS.empty);
ok(q5.added === 0 && q5.log.some(t => /Wikipedia no tiene ningún artículo a menos de \d+\.\d{3} NM de ese punto/.test(t)), "no articles: an info notice: " + JSON.stringify(q5));
ok(count("extracts") === nExt, "and no summaries are asked for");
shape = await treeShape(page);
ok(shape.folders.length === 2, "and nothing new in the tree");

/* ---------- 6. Transient failures are retried and never reach the user ---------- */
reset();
state.geoBusy = 1;     /* the real «search is too busy», with HTTP 200 */
state.extractsDown = 1; /* and a 503 on the first summaries */
const nGeo = count("geo"), nExt6 = count("extracts");
const q6 = await queryViaMenu(page, POINTS.sol, { watchBusy: true });
ok(q6.added === 100 && !q6.log.some(t => /Error/.test(t)), "a busy answer and a 503 end in a normal result, with no error: " + JSON.stringify(q6.log));
ok(count("geo") - nGeo === 2, "the geosearch was retried once: " + (count("geo") - nGeo));
ok(count("extracts") - nExt6 === 6, "so was the first extracts request (5 chunks + 1 retry): " + (count("extracts") - nExt6));
ok(q6.sawBusy && !q6.busyAfter, "the wait cursor lasted the whole time");

/* ---------- 7. A permanent API error: shown with the service's text, not retried ---------- */
reset();
state.geoOverride = () => ({ error: { code: "badvalue", info: "Invalid value for the gscoord parameter" } });
const nGeo7 = count("geo");
const q7 = await queryViaMenu(page, POINTS.sol);
ok(q7.added === 0 && q7.log.some(t => /Error al consultar Wikipedia: badvalue: Invalid value for the gscoord parameter/.test(t)),
  "the service's own error is shown: " + JSON.stringify(q7.log));
ok(count("geo") - nGeo7 === 1, "and it is a response, not a failure: no retry (" + (count("geo") - nGeo7) + " requests)");
ok(!q7.busyAfter, "the wait cursor does not stay on after an error");

/* ---------- 8. A chunk of summaries that keeps failing ---------- */
reset();
state.permanentFromExtract = 2; /* from the second extracts request on, permanent errors */
const folderBefore = (await treeShape(page)).folders.length;
const q8 = await queryViaMenu(page, POINTS.sol);
ok(q8.added === 100, "the markers are still added: " + JSON.stringify({ added: q8.added }));
ok(q8.log.some(t => /No se pudo obtener el resumen de 80 artículo\(s\) \(badvalue: Invalid value for pageids\): solo llevan el enlace/.test(t)), "the user is told how many have no summary: " + JSON.stringify(q8.log));
const cards8 = await page.evaluate(() => {
  const folders = [...document.querySelectorAll("#tree li")].filter(l => /^Wikipedia \d+$/.test(l._name));
  const last = folders[folders.length - 1];
  const rows = [...nodeUl(last).children];
  const summ = li => /<p>[^<]/.test((li._desc || "").replace(/<p><a[\s\S]*$/, ""));
  return { n: rows.length, withSummary: rows.filter(summ).length, allHaveLink: rows.every(li => /<a href="https:\/\/es\.wikipedia\.org\/wiki\//.test(li._desc)) };
});
ok(cards8.withSummary === 20 && cards8.allHaveLink, "only the first chunk has summaries, every article has its link: " + JSON.stringify(cards8));

/* ---------- 9. Hostile data ---------- */
reset();
state.geoOverride = () => ({ query: { geosearch: [
  { pageid: 9001, ns: 0, title: "<img src=x onerror=window.__pwned=1>", lat: 40.41, lon: -3.70, dist: 5, primary: true },
  { pageid: 9002, ns: 0, title: "Latitude out of range", lat: 95, lon: 0, dist: 1, primary: true },
  { pageid: 9003, ns: 0, title: 'Good one "quoted" & <b>bold</b>', lat: 40.42, lon: -3.71, dist: 20, primary: true }
] } });
state.extractsOverride = ids => ({ query: { pages: ids.map(id => ({ pageid: id, ns: 0, title: "x",
  extract: "<script>window.__pwned=1</script> text & <img src=x onerror=window.__pwned=2>" })) } });
const q9 = await queryViaMenu(page, POINTS.sol);
const hostile = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#tree li")].filter(l => l._mstyle && l._mstyle.icon === "wikipedia" && /onerror|Good one/.test(l._name));
  const row = rows.find(l => /onerror/.test(l._name));
  return {
    n: rows.length, name: row._name, label: row._row.querySelector("label").textContent, html: infoHtmlFor(row),
    pwned: window.__pwned, imgs: document.querySelectorAll("#tree img").length,
    scripts: [...document.querySelectorAll("#tree script, #desc-dialog script")].length
  };
});
ok(q9.added === 2, "the entry with a latitude of 95 is skipped, the other two are added: " + q9.added);
ok(hostile.label === "<img src=x onerror=window.__pwned=1>" && hostile.imgs === 0, "a title that is markup stays text in the tree");
ok(!/<script|<img/.test(hostile.html) && /&lt;script&gt;/.test(hostile.html), "and in the card: " + hostile.html.slice(0, 110));
ok(hostile.pwned === undefined && hostile.scripts === 0, "nothing ran: " + String(hostile.pwned));

/* ---------- 10. Rotated map, undo, reload ---------- */
reset();
const rotated = await page.evaluate(() => {
  map.setBearing(30);
  openCtxMenu(map.getCenter(), 600, 400, []);
  [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")].find(x => x.textContent === tr("Consultas") + " ▸").click();
  const b = [...document.querySelectorAll(".ctx-menu:not(#map-ctxmenu) .ctx-menu-item")].find(x => x.textContent === tr("Artículos de Wikipedia en la vista"));
  const r = { found: !!b, disabled: b && b.disabled };
  closeCtxMenu();
  map.setBearing(0);
  return r;
});
ok(rotated.found && !rotated.disabled, "with the map rotated the entry stays enabled (a query is about one point): " + JSON.stringify(rotated));

/* counted over the serialized tree: folders come back collapsed, with their rows still unbuilt (lazy) */
const COUNT_WIKIPEDIA = () => { const walk = rs => rs.reduce((n, r) => n + (r.mstyle && r.mstyle.icon === "wikipedia" ? 1 : 0) + (r.children ? walk(r.children) : 0), 0); return walk(serializeTree()); };
const COUNT_WIKIPEDIA_FN = () => (() => { const walk = rs => rs.reduce((n, r) => n + (r.mstyle && r.mstyle.icon === "wikipedia" ? 1 : 0) + (r.children ? walk(r.children) : 0), 0); return walk(serializeTree()); })() >= 100;
const total = () => page.evaluate(COUNT_WIKIPEDIA);
const layersBefore = await page.evaluate(() => rootGroup.getLayers().length);
const markersBefore = await total();
const q10 = await queryViaMenu(page, POINTS.sol);
ok(q10.added === 100, "one more query for the undo check");
await page.evaluate(() => undoLast());
ok(await total() === markersBefore, "undo takes away the whole query (the folder and its markers): " + await total() + " vs " + markersBefore);
ok(await page.evaluate(() => rootGroup.getLayers().length) === layersBefore, "and its layers leave the map");

await page.evaluate(() => saveTree());
await page.reload();
await waitAppReady(page);
await page.waitForFunction(COUNT_WIKIPEDIA_FN, null, { timeout: 20000 });
/* the folders come back collapsed with their rows unbuilt: open one, as a user would */
const back = await page.evaluate(() => {
  const f = [...document.querySelectorAll("#tree li")].find(x => x._name === "Wikipedia 1");
  expandFolder(f);
  const li = [...nodeUl(f).children].find(x => x._name === "Puerta del Sol");
  return li ? { html: infoHtmlFor(li), icon: li._mstyle.icon, n: 0 } : null;
});
ok(back && back.icon === "wikipedia", "the markers survive a reload with their icon: " + JSON.stringify(back && { icon: back.icon }));
ok(back && /https:\/\/es\.wikipedia\.org\/wiki\/Puerta_del_Sol/.test(back.html) && /CC BY-SA 4\.0/.test(back.html), "and with their cards, link included");
attrib = await page.evaluate(() => document.querySelector(".leaflet-control-attribution").textContent);
ok((attrib.match(/Wikipedia \(CC BY-SA/g) || []).length === 1, "after a reload, with no query, the credit is on the map because saved Wikipedia markers are: " + attrib);
const restoredLook = await page.evaluate(() => ({
  badges: document.querySelectorAll(".leaflet-marker-icon .icon-badge").length,
  named: [...document.querySelectorAll(".leaflet-marker-icon")].filter(e => e.getAttribute("aria-label")).length,
  all: document.querySelectorAll(".leaflet-marker-icon").length
}));
ok(restoredLook.badges > 0 && restoredLook.named === restoredLook.all, "restored markers keep their badge and their accessible name: " + JSON.stringify(restoredLook));

/* ---------- 11. The network is down: the cause is said, the cursor is released, nothing is left half-done ---------- */
reset();
const failRoute = r => r.abort("failed");
await page.route(/\.wikipedia\.org/, failRoute);
const foldersBefore11 = (await treeShape(page)).folders.length;
const q11 = await queryViaMenu(page, POINTS.sol);
await page.unroute(/\.wikipedia\.org/, failRoute);
ok(q11.added === 0 && q11.log.some(t => /Error al consultar Wikipedia: error de red, o el servicio no admite consultas desde el navegador \(CORS\)/.test(t)),
  "a network failure is explained: " + JSON.stringify(q11.log));
ok(!q11.busyAfter && (await treeShape(page)).folders.length === foldersBefore11, "the cursor is released and the tree is untouched");

/* ---------- 12. Everything the service sent was unusable: that is not "no articles" ---------- */
reset();
state.geoOverride = () => ({ query: { geosearch: [
  { pageid: 9101, ns: 0, title: "", lat: 40.41, lon: -3.70, dist: 5 },
  { pageid: 9102, ns: 0, title: "Out of range", lat: 95, lon: 0, dist: 1 }
] } });
const q12 = await queryViaMenu(page, POINTS.sol);
ok(q12.added === 0 && q12.log.some(t => /Error al consultar Wikipedia: el servicio ha devuelto artículos que no se pueden usar/.test(t)) && !q12.log.some(t => /no tiene ningún artículo/.test(t)),
  "unusable rows are reported as an error, not as an empty area: " + JSON.stringify(q12.log));

/* ---------- 13. A second click on the same point while it is busy ---------- */
reset();
const foldersBefore13 = (await treeShape(page)).folders.length;
const nGeo13 = count("geo");
const [q13a, q13b] = await Promise.all([queryViaMenu(page, POINTS.sol), queryViaMenu(page, POINTS.sol)]);
ok([...q13a.log, ...q13b.log].some(t => /Ya se está consultando Wikipedia en ese punto/.test(t)), "the repeated click is answered, not ignored: " + JSON.stringify([q13a.log, q13b.log]));
ok(count("geo") - nGeo13 === 1 && (await treeShape(page)).folders.length === foldersBefore13 + 1, "and it makes one query and one folder: " + (count("geo") - nGeo13));

/* ---------- 14. The radius follows the view: closer in, a smaller one; wider than the service allows, its maximum ---------- */
const setZoom = z => page.evaluate(({ lat, lng, z }) => map.setView([lat, lng], z, { animate: false }), { ...POINTS.sol, z });
reset();
await setZoom(18);
const reach18 = await reachOf(page, POINTS.sol);
const q14a = await queryViaMenu(page, POINTS.sol);
ok(reach18 < REACH15 / 4 && radiusAsked() === reach18, "zoomed in, the radius shrinks with the view (" + reach18 + " m against " + REACH15 + " m): " + radiusAsked());
ok(!q14a.log.some(t => /La vista es más grande/.test(t)) && !q14a.log.some(t => /Error/.test(t)), "and nothing is said about it: " + JSON.stringify(q14a.log));

reset();
await setZoom(9);
const reach9 = await reachOf(page, POINTS.sol);
const q14b = await queryViaMenu(page, POINTS.sol);
ok(reach9 > 10000 && radiusAsked() === 10000, "a view wider than 10 km asks for the service's maximum, not for an out-of-range radius (" + reach9 + " m view): " + radiusAsked());
ok(q14b.added === 100 && q14b.log.some(t => /La vista es más grande de lo que Wikipedia permite buscar: se han buscado los artículos a menos de 5\.\d{3} NM del punto/.test(t)),
  "the user is told the view was wider than what can be searched, and how far it was: " + JSON.stringify(q14b.log));
ok(q14b.log.some(t => /Se muestran los 100 artículos más cercanos; puede haber más a menos de 5\.\d{3} NM/.test(t)), "and the 100 nearest are the limit that applies there: " + JSON.stringify(q14b.log));

reset();
await setZoom(25);
const q14c = await queryViaMenu(page, POINTS.sol);
ok(radiusAsked() === 10 && !q14c.log.some(t => /Error/.test(t)), "a view of a few metres asks for the minimum the service accepts (10 m): " + radiusAsked());

reset();
const unitKm = await page.evaluate(() => { setMeasureUnit("km"); return measureUnit; });
await setZoom(15);
const q14d = await queryViaMenu(page, POINTS.sol);
ok(unitKm === "km" && radiusAsked() === REACH15 && q14d.log.some(t => /Se muestran los 100 artículos más cercanos; puede haber más a menos de \d+\.\d{3} km/.test(t)),
  "the reach in the notices is written in the chosen unit: " + JSON.stringify(q14d.log));
await page.evaluate(() => setMeasureUnit("nm"));

/* ---------- 15. The hover card stays while the pointer is on it ----------
   The card always opens in the same corner (top right), so a «W» that sits under that
   corner is covered by the card the moment it opens: the pointer is then over the card, the
   layer gets a mouseout, the card closed 200 ms later, the layer was under the pointer again
   and it reopened, blinking for ever (reproduced with a real mouse before the fix). Also the
   link inside a hover-opened card used to close under the pointer even once it had reached it. */
reset();
await page.evaluate(() => map.setView([10, 10], 15, { animate: false })); /* empty land: no other marker to hover */
const spots = await page.evaluate(() => {
  const c = map.getContainer().getBoundingClientRect();
  const li0 = [...document.querySelectorAll("#tree li")].find(x => x._mstyle && x._mstyle.icon === "wikipedia");
  showLayerInfo(li0, { focus: false });
  const r = descBox.getBoundingClientRect();
  hideLayerInfo();
  const under = map.containerPointToLatLng(L.point((r.left + r.right) / 2 - c.left, r.top + 40 - c.top));
  const far = map.containerPointToLatLng(L.point(300, 260)); /* ~140 px from the card: reachable within the deferred close */
  const at = ll => { const p = map.latLngToContainerPoint(ll); return { x: c.left + p.x, y: c.top + p.y }; };
  return { under: { lat: under.lat, lng: under.lng, px: at(under) }, far: { lat: far.lat, lng: far.lng, px: at(far) },
           card: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, empty: { x: c.left + 150, y: c.top + 760 } };
});
state.geoOverride = () => ({ query: { geosearch: [
  { pageid: 9201, ns: 0, title: "Bajo la ficha", lat: spots.under.lat, lon: spots.under.lng, dist: 5, primary: true },
  { pageid: 9202, ns: 0, title: "Lejos de la ficha", lat: spots.far.lat, lon: spots.far.lng, dist: 50, primary: true }
] } });
const q15 = await queryViaMenu(page, { lat: 10, lng: 10 });
ok(q15.added === 2, "two articles for the hover check: " + JSON.stringify(q15.log));
const watchCard = () => page.evaluate(() => {
  const d = document.getElementById("desc-dialog");
  window.__cardLog = []; window.__cardT0 = performance.now(); window.__cardObs?.disconnect();
  window.__cardObs = new MutationObserver(() => window.__cardLog.push([Math.round(performance.now() - window.__cardT0), d.hidden ? "hide" : "show"]));
  window.__cardObs.observe(d, { attributes: true, attributeFilter: ["hidden"] });
});
const cardLog = () => page.evaluate(() => ({ log: window.__cardLog, hidden: document.getElementById("desc-dialog").hidden, title: document.getElementById("desc-title").textContent }));
const cardHidden = () => page.waitForFunction(() => document.getElementById("desc-dialog").hidden, null, { timeout: 3000 }).then(() => true, () => false);

await page.mouse.move(spots.empty.x, spots.empty.y);
await watchCard();
await page.mouse.move(spots.under.px.x - 60, spots.under.px.y + 90);
await page.mouse.move(spots.under.px.x, spots.under.px.y, { steps: 8 });
for (let t = 0; t < 1600; t += 100) { await page.mouse.move(spots.under.px.x + (t / 100) % 2, spots.under.px.y); await page.waitForTimeout(100); } /* a hand is never still */
let cl = await cardLog();
ok(cl.title === "Bajo la ficha" && cl.log.length === 1 && cl.log[0][1] === "show" && !cl.hidden,
  "a «W» under the corner where the card opens: the card opens once and STAYS, it does not blink: " + JSON.stringify(cl));
await page.mouse.move(spots.empty.x, spots.empty.y, { steps: 6 });
ok(await cardHidden(), "and it closes when the pointer leaves it");

await watchCard();
await page.mouse.move(spots.far.px.x - 30, spots.far.px.y + 30);
await page.mouse.move(spots.far.px.x, spots.far.px.y, { steps: 6 });
await page.waitForFunction(() => !document.getElementById("desc-dialog").hidden && document.getElementById("desc-title").textContent === "Lejos de la ficha", null, { timeout: 3000 });
const link = await page.evaluate(() => { const r = document.querySelector("#desc-body a").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, href: document.querySelector("#desc-body a").href }; });
await page.mouse.move(link.x, link.y, { steps: 4 }); /* straight to the link, well within the 200 ms of the deferred close */
await page.waitForTimeout(700);                       /* longer than the deferred close */
cl = await cardLog();
const under = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e && e.closest("a") ? e.closest("a").href : null; }, link);
ok(!cl.hidden && cl.log.length === 1 && under === link.href, "once the pointer is on the card it keeps it open (it used to close after 200 ms with the pointer on it), and the link is under it: " + JSON.stringify({ cl, under }));
await page.mouse.move(spots.empty.x, spots.empty.y, { steps: 10 });
ok(await cardHidden(), "and leaving the card closes it");
state.geoOverride = null;
await page.evaluate(({ lat, lng }) => map.setView([lat, lng], 15, { animate: false }), POINTS.sol);

/* ---------- 4. The English interface asks the English Wikipedia ---------- */
const en = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 }, locale: "en-US" });
await en.page.route(/\.wikipedia\.org/, route);
ok(!/Wikipedia/.test(await en.page.evaluate(() => document.querySelector(".leaflet-control-attribution").textContent)),
  "a fresh session with no Wikipedia markers has no Wikipedia credit");
reset();
const nSeen = seen.length;
await en.page.evaluate(({ lat, lng }) => map.setView([lat, lng], 15, { animate: false }), POINTS.sol);
const qe = await queryViaMenu(en.page, POINTS.sol);
const hostsEn = seen.slice(nSeen).map(s => s.host);
ok(qe.added === 100 && hostsEn.length === 6 && hostsEn.every(h => h === "en.wikipedia.org"), "English interface → en.wikipedia.org for every request: " + [...new Set(hostsEn)]);
ok(qe.log.some(t => /100 Wikipedia articles added in «Wikipedia 1»/.test(t)), "the notice is in English: " + JSON.stringify(qe.log));
const cardEn = await en.page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Puerta del Sol");
  return infoHtmlFor(li);
});
ok(/https:\/\/en\.wikipedia\.org\/wiki\/Puerta_del_Sol/.test(cardEn) && /Read the full article on Wikipedia/.test(cardEn) && /Text from Wikipedia, under the CC BY-SA 4\.0 licence/.test(cardEn),
  "and the card too: " + cardEn.slice(-230));
ok(en.errors.length === 0, "no page errors in English: " + en.errors.join(" | "));
await en.ctx.close();

/* the browser logs every failed resource: the 503 of step 6 and the aborted requests of step 11 are on purpose */
const realErrors = errors.filter(e => !/status of 503|net::ERR_FAILED/.test(e));
ok(realErrors.length === 0, "no page errors: " + realErrors.join(" | "));
await ctx.close();
await browser.close();
srv.close();
done();
