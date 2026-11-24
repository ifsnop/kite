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
      scrolls inside a cap and the button stays in view and works.          */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

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

ok(errors.length === 0, "no page errors: " + errors.join(" | "));
await ctx.close(); await browser.close();
srv.close();
done();
