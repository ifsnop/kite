/* Pin, anillos de alcance y sector: UN CLIC fija el centro, y entonces se abren
   sus propiedades, donde todavía se puede cambiar casi todo antes de guardar.
   Antes los botones 📍, ◎ y ◔ creaban en el CENTRO de la vista (y el «Pin» del
   menú contextual también, ignorando el punto pulsado) y eso no servía.

   1) Pulsar 📍 arma la herramienta y NO crea nada; el clic crea el marcador EN
      ese punto y abre su diálogo (isNew); Cancelar lo borra y Aceptar lo deja.
   2) Escape antes del clic cancela la herramienta sin crear nada; pulsar otro
      botón de herramienta la cambia; pulsar el botón armado la suelta.
   3) ◎ y ◔: el diálogo de anillos y sector abre con el punto pulsado como
      centro, Cancelar no deja nada y Aceptar crea las capas alrededor de él.
   4) «Pin» del menú contextual lo crea donde se hizo el clic derecho.
   5) Desplazar el mapa arrastrando con la herramienta armada no la dispara.
   6) Una capa bajo el punto no se resalta en el árbol ni abre su ficha.      */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER CLICK TO PLACE TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8978);
const { page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
await page.evaluate(() => { map.options.inertia = false; map.setView([40.5, -3.9], 14, { animate: false }); });
const px = ll => page.evaluate(([la, ln]) => {
  const p = map.latLngToContainerPoint([la, ln]), r = map.getContainer().getBoundingClientRect();
  return { x: r.left + p.x, y: r.top + p.y };
}, ll);
const bar = n => page.locator(".leaflet-top.leaflet-left .measure-bar").nth(1).locator("a").nth(n); /* 0 ⬠, 1 ◎, 2 ◔, 3 📍 */
const nodes = () => page.evaluate(() => [...document.querySelectorAll("#tree li")].filter(x => x._name && /^(Marcador|Anillos de alcance|Sector) \d+/.test(x._name)).map(x => x._name));
const st = () => page.evaluate(() => ({ tool: activeTool, style: !styleDialog.hidden, range: !document.getElementById("range-dialog").hidden,
  crosshair: map.getContainer().classList.contains("leaflet-crosshair"), pan: map.dragging.enabled(),
  active: [...document.querySelectorAll(".leaflet-top.leaflet-left .measure-bar a.active")].map(a => a.textContent).join("") }));
const markerAt = () => page.evaluate(() => { let m = null; rootGroup.eachLayer(l => { if (l instanceof L.Marker && l._li) m = l; }); const ll = m && m.getLatLng(); return ll && { lat: ll.lat, lng: ll.lng }; });
const near = (a, b, tol = 2e-4) => a && Math.abs(a.lat - b[0]) < tol && Math.abs(a.lng - b[1]) < tol;
const center = () => page.evaluate(() => { const c = map.getCenter(); return [c.lat, c.lng]; });

/* ---------- 1. El pin ---------- */
const target = [40.512, -3.884]; /* a un lado del centro de la vista */
const base = await nodes();
await bar(3).click();
let s = await st();
ok(s.tool === "pin" && s.crosshair && s.active === "📍" && !s.style, "📍 arma la herramienta (cruz, botón resaltado) y NO abre nada todavía: " + JSON.stringify(s));
ok((await nodes()).length === base.length, "ni crea ningún marcador");
let p = await px(target);
await page.mouse.click(p.x, p.y);
await page.waitForFunction(() => !styleDialog.hidden);
s = await st();
const made = await markerAt();
ok(near(made, target), "el clic crea el marcador EN el punto pulsado: " + JSON.stringify(made) + " frente a " + JSON.stringify(target));
const c = await center();
ok(Math.abs(made.lat - c[0]) > 1e-3 || Math.abs(made.lng - c[1]) > 1e-3, "y no en el centro de la vista");
ok(s.tool === null && s.style && !s.crosshair, "con su diálogo de propiedades abierto y la herramienta ya soltada: " + JSON.stringify(s));
ok((await nodes()).length === base.length + 1, "un marcador nuevo en el árbol");
await page.click("#style-cancel");
ok((await nodes()).length === base.length && (await markerAt()) === null, "Cancelar lo borra (era nuevo)");

/* Se puede mover antes de aceptar: la posición del diálogo manda, y Aceptar lo deja */
await bar(3).click();
p = await px(target);
await page.mouse.click(p.x, p.y);
await page.waitForFunction(() => !styleDialog.hidden);
await page.fill("#mk-lat", "40.52");
await page.dispatchEvent("#mk-lat", "input");
await page.click("#style-accept");
const moved = await markerAt();
ok(near(moved, [40.52, target[1]]), "la posición se puede corregir en el diálogo antes de aceptar y Aceptar lo deja: " + JSON.stringify(moved));
await page.evaluate(() => { for (const li of [...document.querySelectorAll("#tree li")].filter(x => /^Marcador \d+/.test(x._name || ""))) deleteNode(li); });

/* ---------- 2. Escape, cambiar de herramienta, soltar ---------- */
await bar(3).click();
await page.keyboard.press("Escape");
s = await st();
ok(s.tool === null && !s.crosshair && s.active === "", "Escape cancela la herramienta armada: " + JSON.stringify(s));
p = await px(target);
await page.mouse.click(p.x, p.y);
await frames();
ok((await nodes()).length === base.length && !(await st()).style, "y el clic siguiente ya no crea nada");

await bar(3).click();
await bar(1).click();
s = await st();
ok(s.tool === "rings" && s.active === "◎", "pulsar otro botón de herramienta cambia a esa: " + JSON.stringify(s));
await bar(1).click();
s = await st();
ok(s.tool === null && s.active === "", "pulsar el botón armado la suelta");

/* ---------- 3. Anillos y sector ---------- */
const rg = () => page.evaluate(() => ({ open: !document.getElementById("range-dialog").hidden, mode: document.getElementById("rg-mode").value,
  lat: Number(document.getElementById("rg-lat").value), lng: Number(document.getElementById("rg-lng").value) }));
for (const [n, mode, glyph] of [[1, "rings", "◎"], [2, "sector", "◔"]]) {
  await bar(n).click();
  s = await st();
  ok(s.tool === mode && !s.range && s.active === glyph, `${glyph} arma la herramienta y NO abre el diálogo todavía: ` + JSON.stringify(s));
  p = await px(target);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => !document.getElementById("range-dialog").hidden);
  const d = await rg();
  ok(d.mode === mode && near({ lat: d.lat, lng: d.lng }, target, 1e-3), `el clic abre el diálogo con el punto pulsado como centro (${mode}): ` + JSON.stringify(d));
  ok((await st()).tool === null, "y la herramienta se suelta");
  await page.click("#rg-cancel");
  ok((await nodes()).length === base.length, "Cancelar no deja nada");
}
await bar(1).click();
p = await px(target);
await page.mouse.click(p.x, p.y);
await page.waitForFunction(() => !document.getElementById("range-dialog").hidden);
await page.click("#rg-accept");
const ringInfo = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => /^Anillos de alcance \d+/.test(x._name || ""));
  if (!li) return null;
  const b = subtreeBounds(li);
  return b.isValid() ? { name: li._name, center: [b.getCenter().lat, b.getCenter().lng] } : { name: li._name, center: null };
});
ok(ringInfo && ringInfo.center, "Aceptar crea los anillos: " + JSON.stringify(ringInfo));
ok(ringInfo && ringInfo.center && Math.abs(ringInfo.center[0] - target[0]) < 5e-3 && Math.abs(ringInfo.center[1] - target[1]) < 5e-3,
  "centrados en el punto pulsado: " + JSON.stringify(ringInfo));
await page.evaluate(() => { for (const li of [...document.querySelectorAll("#tree li")].filter(x => /^Anillos de alcance \d+/.test(x._name || ""))) deleteNode(li); });

/* ---------- 4. «Pin» del menú contextual ---------- */
p = await px([40.49, -3.92]);
await page.mouse.click(p.x, p.y, { button: "right" });
await page.waitForSelector("#map-ctxmenu:not([hidden])");
const ctxItem = label => page.evaluate(l => [...document.querySelectorAll(".ctx-menu-item")].some(x => x.textContent.trim().startsWith(l)), label);
const clickCtx = label => page.evaluate(l => [...document.querySelectorAll(".ctx-menu-item")].find(x => x.textContent.trim().startsWith(l)).click(), label);
await clickCtx("Crear");
await page.waitForFunction(() => [...document.querySelectorAll(".ctx-menu-item")].some(x => x.textContent.trim() === "Pin"));
await clickCtx("Pin");
await page.waitForFunction(() => !styleDialog.hidden);
ok(near(await markerAt(), [40.49, -3.92], 5e-4), "«Crear › Pin» del menú contextual lo crea donde se hizo el clic derecho: " + JSON.stringify(await markerAt()));
await page.click("#style-cancel");

/* ---------- 5. Desplazar el mapa no dispara la herramienta ---------- */
await bar(3).click();
const c0 = await center();
await page.mouse.move(700, 600);
await page.mouse.down();
await page.mouse.move(640, 560, { steps: 5 });
await page.mouse.up();
await frames();
s = await st();
const c1 = await center();
ok(Math.abs(c1[0] - c0[0]) > 1e-4 || Math.abs(c1[1] - c0[1]) > 1e-4, "arrastrar el mapa con la herramienta armada lo desplaza");
ok(s.tool === "pin" && !s.style && (await nodes()).length === base.length, "y NO crea el marcador (la herramienta sigue armada): " + JSON.stringify(s));
await page.keyboard.press("Escape");

/* ---------- 6. Una capa bajo el punto no se resalta ---------- */
await page.evaluate(async () => {
  const gj = { type: "FeatureCollection", features: [{ type: "Feature", properties: null,
    geometry: { type: "Polygon", coordinates: [[[-3.93, 40.47], [-3.85, 40.47], [-3.85, 40.53], [-3.93, 40.53], [-3.93, 40.47]]] } }] };
  await handleDroppedFiles([new File([JSON.stringify(gj)], "zona.geojson")]);
});
await frames();
const sel0 = await page.evaluate(() => selection.size);
await bar(3).click();
p = await px([40.5, -3.9]);
await page.mouse.click(p.x, p.y);
await page.waitForFunction(() => !styleDialog.hidden);
const sel1 = await page.evaluate(() => ({ n: selection.size, info: !descDialog.hidden }));
ok(near(await markerAt(), [40.5, -3.9], 5e-4) && sel1.n === sel0 && !sel1.info,
  "con un polígono bajo el punto, el marcador se crea ahí sin resaltar la capa ni abrir su ficha: " + JSON.stringify(sel1));
await page.click("#style-cancel");

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
await browser.close();
srv.close();
done();
