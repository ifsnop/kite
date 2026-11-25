/* Marker style of an imported KML (20-kml-geom.js `kmlMarkerToMstyle`,
   31-tree-node.js `buildKmlRecords`): a point keeps the colour, size and shape
   of its <IconStyle>, and a <LabelStyle> scale of 0 keeps its name out of the
   map. The image behind <Icon><href> is NEVER requested: it only picks one of
   our own icons by its file name, and an image with no equivalent is named in
   the import notice so someone can look at it.

   1) The reported sample (a StyleMap whose "normal" Style is a green half-size
      dot with no label): a circle, 21 px, green, no permanent tooltip.
   2) A pushpin with a colour -> coloured circle, and its address is in the
      notice (and in the log); a plain point keeps the Leaflet pin; scale 0
      -> «Ninguno» with its name hidden by LabelStyle scale 0.
   3) Nothing is requested from the icons' server, and the CSP is silent.
   4) A marker in a folder that is never expanded already has its icon on the
      raw layer, and keeps it when the folder is switched on.
   5) Saving and reloading keeps all of it.
   6) A styleUrl without the "#" (`<styleUrl>error_75</styleUrl>`, as in a real
      file) names the local style: same look, and no «estilo en archivos
      externos» notice.
   7) Many sticky notices do not push «Aceptar» out of the panel: the notice box
      scrolls inside a cap and the button stays in view and works.
   8) A REAL file (tests/fixtures/msda-lemd-marker-styles.kml, the user's
      test.kml): import, switch on and draw, save and reload, and export and
      read back, with nothing requested from the icons' server.             */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";
import fs from "node:fs";

const { ok, done } = reporter("BROWSER KML MARKER STYLE TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8990);
const { ctx, page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

const requested = [];
page.on("request", r => requested.push(r.url()));

const GREEN_DOT = "http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png";
const PUSHPIN = "http://maps.google.com/mapfiles/kml/pushpin/grn-pushpin.png";
const pt = (name, style, x, extra = "") => `<Placemark><name>${name}</name>${style}${extra}<Point><coordinates>${x},40</coordinates></Point></Placemark>`;
const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Doc</name><open>1</open>
<StyleMap id="error_75"><Pair><key>normal</key><styleUrl>#error_75_normal</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#error_75_highlight</styleUrl></Pair></StyleMap>
<Style id="error_75_normal"><IconStyle><color>ff00ff00</color><scale>0.5</scale><Icon><href>${GREEN_DOT}</href></Icon></IconStyle><LabelStyle><scale>0</scale></LabelStyle></Style>
<Style id="error_75_highlight"><IconStyle><hotSpot x="20" y="2" xunits="pixels" yunits="pixels"/><Icon><href>${PUSHPIN}</href></Icon></IconStyle></Style>
<Style id="pin"><IconStyle><color>ff0000ff</color><Icon><href>${PUSHPIN}</href></Icon></IconStyle></Style>
<Style id="hidden"><IconStyle><scale>0</scale></IconStyle><LabelStyle><scale>0</scale></LabelStyle></Style>
<Folder><name>Abierta</name><open>1</open>
  ${pt("Punto verde", "<styleUrl>#error_75</styleUrl>", 1)}
  ${pt("Chincheta roja", "<styleUrl>#pin</styleUrl>", 2)}
  ${pt("Sin estilo", "", 3)}
  ${pt("Sin icono", "<styleUrl>#hidden</styleUrl>", 4)}
  ${pt("Sin almohadilla", "<styleUrl>error_75</styleUrl>", 6)}
</Folder>
<Folder><name>Cerrada</name><visibility>0</visibility>
  ${pt("Verde dentro", "<styleUrl>#error_75</styleUrl>", 5, "<visibility>0</visibility>")}
</Folder>
</Document></kml>`;
await page.evaluate(async kml => { await handleDroppedFiles([new File([kml], "m.kml")]); }, kml);

/* What a marker looks like, read from its layer (a row's, or a pending record's) */
const look = name => page.evaluate(n => {
  const find = list => { for (const r of list) { if (r.name === n) return r; if (r.children) { const x = find(r.children); if (x) return x; } if (r._pending) { const x = find(r._pending); if (x) return x; } } return null; };
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  let layer, mstyle;
  if (li) { layer = nodeLayer(li); mstyle = li._mstyle; }
  else { const rec = find(serializeTreeRecordsForTest()); layer = rec && rec._layer; mstyle = rec && rec.mstyle; }
  let marker = null;
  const each = l => { if (l instanceof L.Marker) marker = l; if (l.eachLayer) l.eachLayer(each); };
  if (layer) each(layer);
  const el = marker && marker._icon;
  return {
    found: !!marker, mstyle: mstyle ? { icon: mstyle.icon, color: mstyle.color, size: mstyle.size, textAlways: mstyle.textAlways } : null,
    iconClass: el ? el.className : (marker && marker.options.icon.options.className) || null,
    tooltip: !!(marker && marker.getTooltip && marker.getTooltip()),
    popup: !!(marker && marker.getPopup && marker.getPopup()),
    isPin: !!(marker && marker.options.icon.options.iconUrl)
  };
}, name);
/* the pending records of the folders that were never expanded */
await page.evaluate(() => { window.serializeTreeRecordsForTest = () => [...document.querySelectorAll("#tree li")].flatMap(li => li._pending || []); });

/* ---------- 1 and 2. The looks ---------- */
const green = await look("Punto verde");
ok(green.found && green.mstyle.icon === "circle" && green.mstyle.color === "#00ff00" && green.mstyle.size === 21,
  "the reported sample: a green circle of 21 px: " + JSON.stringify(green));
ok(!green.tooltip && green.popup && green.mstyle.textAlways === false, "LabelStyle scale 0: no permanent name, the popup on click is still there: " + JSON.stringify(green));
ok(/mdi-pin/.test(green.iconClass) && !green.isPin, "it is drawn with our own MDI icon, not the Leaflet pin image: " + green.iconClass);

const red = await look("Chincheta roja");
ok(red.mstyle.icon === "circle" && red.mstyle.color === "#ff0000", "a pushpin with a colour -> a circle of that colour: " + JSON.stringify(red.mstyle));
const bare = await look("Sin estilo");
ok(bare.mstyle.icon === "leaflet-pin" && bare.isPin, "a point with no marker style keeps the Leaflet pin: " + JSON.stringify(bare));
const none = await look("Sin icono");
ok(none.mstyle.icon === "none" && none.mstyle.textAlways === false && !none.tooltip, "IconStyle scale 0 + LabelStyle scale 0: «Ninguno» with no name: " + JSON.stringify(none));

const bareRef = await look("Sin almohadilla");
ok(bareRef.mstyle.icon === "circle" && bareRef.mstyle.color === "#00ff00" && bareRef.mstyle.size === 21,
  "a styleUrl without the # names the local style: " + JSON.stringify(bareRef.mstyle));

const log = await page.evaluate(() => msgLog.map(m => m.text).join(" | "));
ok(!/archivos externos/.test(log), "and it is not reported as a style in another file: " + log);
ok(log.includes(PUSHPIN) && /sin equivalente/.test(log), "the notice names the pushpin address: " + log);
ok(!log.includes(GREEN_DOT), "a shape we know is not reported");

/* ---------- 3. Nothing is requested from the icons' server ---------- */
ok(!requested.some(u => u.includes("maps.google.com")), "the icon images are never requested: " + requested.filter(u => u.includes("google")).join(" "));
ok((await page.evaluate(() => window.__csp)).length === 0, "no CSP violation");

/* ---------- 4. A folder never expanded already has the icon on the raw layer ---------- */
const closed = await look("Verde dentro");
ok(closed.found && closed.mstyle.icon === "circle" && closed.mstyle.color === "#00ff00" && /mdi-pin/.test(closed.iconClass || ""),
  "a marker in a folder never expanded has its icon on the raw layer: " + JSON.stringify(closed));
await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Cerrada");
  const chk = li.querySelector(":scope > .node-row > input[type=checkbox]"); chk.click();
});
await page.waitForFunction(() => rootGroup.getLayers().length === 6);
const switched = await look("Verde dentro");
ok(switched.mstyle.icon === "circle" && /mdi-pin/.test(switched.iconClass || ""), "switched on through the folder checkbox it is still the circle: " + JSON.stringify(switched));

/* ---------- 5. Save and reload ---------- */
await page.evaluate(() => saveTree());
await page.reload(); await waitAppReady(page);
const after = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#tree li")]
  .filter(li => li._mstyle).map(li => [li._name, li._mstyle.icon + "/" + li._mstyle.color + "/" + li._mstyle.size])));
ok(after["Punto verde"] === "circle/#00ff00/21" && after["Chincheta roja"] === "circle/#ff0000/41" && after["Sin icono"] === "none/#1b5e97/41" && after["Sin almohadilla"] === "circle/#00ff00/21",
  "after saving and reloading the marker styles are the same: " + JSON.stringify(after));

/* ---------- 7. Many sticky notices: «Aceptar» stays reachable ---------- */
await page.evaluate(() => {
  for (let i = 1; i <= 30; i++) navMessage(`«archivo-${i}.kml»: ${i} elemento(s) cargado(s); 3 omitido(s) por una causa larga que ocupa más de una línea del panel`, { sticky: true });
});
const pos = await page.evaluate(() => {
  const ok = document.querySelector("#nav-msg .nav-msg-ok").getBoundingClientRect();
  const box = document.getElementById("nav-msg");
  return { top: ok.top, bottom: ok.bottom, vh: innerHeight, boxH: box.getBoundingClientRect().height, scrolls: box.scrollHeight > box.clientHeight };
});
ok(pos.top >= 0 && pos.bottom <= pos.vh, "with 30 sticky notices «Aceptar» is inside the window: " + JSON.stringify(pos));
ok(pos.scrolls && pos.boxH < pos.vh / 2, "the notice box is capped and scrolls instead of growing: " + JSON.stringify(pos));
await page.mouse.click((await page.locator("#nav-msg .nav-msg-ok").boundingBox()).x + 10, (await page.locator("#nav-msg .nav-msg-ok").boundingBox()).y + 8);
ok(await page.evaluate(() => document.querySelectorAll("#nav-msg .nav-msg-line").length) === 0, "pressing «Aceptar» with the real mouse clears them all");

/* ---------- 8. A real file, from import to export ---------- */
const realKml = fs.readFileSync(new URL("../fixtures/msda-lemd-marker-styles.kml", import.meta.url), "utf8");
const R = await openApp(browser, srv.url, { viewport: { width: 1400, height: 800 } });
const realRequests = [];
R.page.on("request", r => realRequests.push(r.url()));
await R.page.evaluate(async k => { await handleDroppedFiles([new File([k], "test.kml")]); }, realKml);

const realLog = await R.page.evaluate(() => msgLog.map(m => m.text).join(" | "));
ok(/17 elemento\(s\) cargado\(s\)/.test(realLog) && !/omitido|archivos externos/.test(realLog),
  "the summary: 17 loaded, none skipped, no style in another file: " + realLog);
ok(/1 icono de KML sin equivalente/.test(realLog) && realLog.includes("http://maps.google.com/mapfiles/kml/shapes/polygon.png")
  && !realLog.includes("shaded_dot") && !realLog.includes("pushpin"),
  "and exactly one image with no equivalent is named (the dots and the unused highlight pushpins are not): " + realLog);

const leaves = () => R.page.evaluate(() => {
  const out = [];
  const walk = ns => { for (const n of ns) {
    if (n.children) walk(n.children);
    else out.push({ name: n.name, on: !!n.checked, geo: n.geo && n.geo.features[0].geometry.type,
      ms: n.mstyle ? [n.mstyle.icon, n.mstyle.color, n.mstyle.size, !!n.mstyle.textAlways].join("/") : null,
      line: n.style ? n.style.color + "/" + n.style.weight : null });
  } };
  const t = serializeTree(); walk(t.nodes || t);
  return out;
});
const dotsOf = ls => ls.filter(l => /^\d\.\d\dm$/.test(l.name));
let ls = await leaves();
ok(ls.length === 17 && ls.every(l => !l.on), "17 records, all off (the folder is <visibility>0): " + ls.length);
ok(dotsOf(ls).length === 12 && dotsOf(ls).every(l => l.ms === "circle/#00ff00/21/false"),
  "the 12 measurements are green circles of 21 px with no permanent name: " + JSON.stringify(dotsOf(ls).map(l => l.ms)));
ok(ls.find(l => l.name === "RXTX31-342351").ms === "leaflet-pin/#1b5e97/49/false", "the centre keeps the pin at 1.2 x");
const banners = ls.filter(l => /^P9[59]/.test(l.name) && l.geo === "Point");
ok(banners.length === 2 && banners.every(l => /^none\/.*\/true$/.test(l.ms)), "both banners are «Ninguno» with their name shown: " + JSON.stringify(banners));
const lines = ls.filter(l => l.geo === "LineString");
ok(lines.length === 2 && lines.find(l => l.name.startsWith("P95")).line === "#00ff00/3" && lines.find(l => l.name.startsWith("P99")).line === "#0000ff/3",
  "the two lines keep their inline colours over the shared 3 px style: " + JSON.stringify(lines));

/* switch the whole file on and look at what is drawn */
await R.page.evaluate(() => document.querySelector("#tree input[type=checkbox]").click());
await R.page.waitForFunction(() => rootGroup.getLayers().length === 17);
await R.page.evaluate(() => map.fitBounds(rootGroup.getBounds().pad(0.2), { animate: false }));
/* bounded, and a failure is reported by the checks below rather than as a bare timeout */
await R.page.waitForFunction(() => document.querySelectorAll(".leaflet-tooltip").length === 2, null, { timeout: 5000 }).catch(() => {});
const drawn = await R.page.evaluate(() => {
  const dots = [...document.querySelectorAll(".leaflet-marker-icon.mdi-pin:not(.no-icon)")];
  return {
    dots: dots.length, dotLook: dots[0] && dots[0].innerHTML,
    noIcon: document.querySelectorAll(".leaflet-marker-icon.no-icon").length,
    pins: document.querySelectorAll("img.leaflet-marker-icon").length,
    labels: [...document.querySelectorAll(".leaflet-tooltip")].map(t => t.textContent).sort()
  };
});
ok(drawn.dots === 12 && /color:#00ff00/.test(drawn.dotLook) && /width:21px/.test(drawn.dotLook),
  "12 green circle icons of 21 px are on the map: " + JSON.stringify(drawn));
ok(drawn.noIcon === 2 && drawn.pins === 1, "and 2 icon-less markers plus the one Leaflet pin: " + JSON.stringify(drawn));
ok(JSON.stringify(drawn.labels) === JSON.stringify(["P95≤7.5m", "P99≤12m"]), "only the banners show a permanent name: " + JSON.stringify(drawn.labels));

/* save and reload: the same records */
ls = await leaves();
await R.page.evaluate(() => saveTree());
await R.page.reload(); await waitAppReady(R.page);
const reloaded = await leaves();
ok(JSON.stringify(reloaded) === JSON.stringify(ls), "after saving and reloading every record is the same, styles included");
await R.page.waitForFunction(() => rootGroup.getLayers().length === 17);
const reloadedLabels = await R.page.evaluate(() => [...document.querySelectorAll(".leaflet-tooltip")].map(t => t.textContent).sort());
ok(JSON.stringify(reloadedLabels) === JSON.stringify(["P95≤7.5m", "P99≤12m"]),
  "after reloading, with the folder still folded, the banners still show their name: " + JSON.stringify(reloadedLabels));

/* export to KML and read it back with the importer's own functions */
const back = await R.page.evaluate(() => {
  const k = recordsToKml(serializeTree().nodes || serializeTree());
  const doc = new DOMParser().parseFromString(k.text, "text/xml");
  const idx = buildStyleIndex(doc), hrefs = new Set();
  const looks = elsByTag(doc, "Placemark").filter(pm => elsByTag(pm, "Point").length).map(pm => {
    const m = kmlMarkerToMstyle(placemarkMarkerStyle(pm, idx), hrefs);
    return text(pm, "name") + "=" + (m ? [m.icon, m.color, m.size].join("/") : "-");
  });
  return { looks, hrefs: hrefs.size, count: k.count, skipped: k.skipped.length, external: idx.externalRefs };
});
ok(back.count === 17 && back.skipped === 0 && back.external === 0, "17 placemarks exported, none skipped: " + JSON.stringify({ c: back.count, s: back.skipped, e: back.external }));
const backDots = back.looks.filter(l => /^\d\.\d\dm=/.test(l));
ok(backDots.length === 12 && backDots.every(l => /=circle\/#00ff00\/21$/.test(l)), "the 12 green circles come back with colour and size: " + JSON.stringify(backDots));
ok(back.looks.includes("RXTX31-342351=leaflet-pin/#1b5e97/49"), "the pin comes back as the pin at 49 px, not tinted: " + JSON.stringify(back.looks.filter(l => l.startsWith("RXTX"))));
ok(back.looks.filter(l => /^P9[59]/.test(l)).every(l => /=none\//.test(l)) && back.hrefs === 0, "the banners come back as «Ninguno» and nothing in the export names an image");

/* the icons' server was never contacted, and the content policy stayed quiet */
ok(!realRequests.some(u => u.includes("maps.google.com")), "nothing was requested from maps.google.com: " + realRequests.filter(u => u.includes("google")).join(" "));
ok((await R.page.evaluate(() => window.__csp)).length === 0, "no CSP violation with the real file");
ok(R.errors.length === 0, "no page errors with the real file: " + R.errors.join(" | "));
await R.ctx.close();

ok(errors.length === 0, "no page errors: " + errors.join(" | "));
await ctx.close(); await browser.close();
srv.close();
done();
