/* Anillos de alcance y sectores, de punta a punta: el clic derecho real
   sobre el mapa, «Crear» › «Anillos de alcance…» / «Sector…», el diálogo
   con su vista previa en vivo (Cancelar no deja nada), las capas que
   quedan en el árbol, deshacer/rehacer y que sobrevivan a una recarga
   —también un anillo que cruza el antimeridiano—.                      */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER RINGS TESTS OK");
const NM = 1852;
const browser = await launch();
const srv = await serve(READABLE, 8949);
const { ctx, page, errors } = await openApp(browser, srv.url);

await page.evaluate(() => map.setView([40.4, -3.7], 8, { animate: false }));
const centre = await page.evaluate(() => {
  const p = map.latLngToContainerPoint(map.getCenter()), r = map.getContainer().getBoundingClientRect();
  return { x: r.left + p.x + 40, y: r.top + p.y + 40 };
});
const clicked = await page.evaluate(([x, y]) => {
  const r = map.getContainer().getBoundingClientRect();
  const ll = map.containerPointToLatLng([x - r.left, y - r.top]);
  return { lat: ll.lat, lng: ll.lng };
}, [centre.x, centre.y]);

/* Clic derecho → «Crear ▸» → hoja */
async function openFromMenu(leaf) {
  await page.mouse.click(centre.x, centre.y, { button: "right" });
  await page.evaluate(() => [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")].find(b => b.textContent.startsWith("Crear")).click());
  await page.waitForSelector(".ctx-menu:not(#map-ctxmenu)");
  const leaves = await page.evaluate(() => [...document.querySelectorAll(".ctx-menu:not(#map-ctxmenu) .ctx-menu-item")].map(b => b.textContent));
  await page.evaluate(l => [...document.querySelectorAll(".ctx-menu:not(#map-ctxmenu) .ctx-menu-item")].find(b => b.textContent === l).click(), leaf);
  await page.waitForFunction(() => !document.getElementById("range-dialog").hidden);
  return leaves;
}
const leaves = await openFromMenu("Anillos de alcance…");
ok(["Polígono o línea", "Pin", "Anillos de alcance…", "Sector…"].every(l => leaves.includes(l)), "«Crear» ofrece las dos entradas nuevas: " + JSON.stringify(leaves));

const field = id => page.inputValue("#" + id);
const set = (id, v) => page.fill("#" + id, v);
const treeNames = () => page.evaluate(() => [...document.querySelectorAll("#tree li")].map(l => l._name).filter(Boolean));
const before = await treeNames();

/* ---- el centro es el punto pulsado, en el formato global (decimal) ---- */
const lat0 = Number(await field("rg-lat")), lng0 = Number(await field("rg-lng"));
ok(Math.abs(lat0 - clicked.lat) < 1e-5 && Math.abs(lng0 - clicked.lng) < 1e-5, `centro = punto pulsado: ${lat0}, ${lng0}`);
ok(await field("rg-radii") === "10, 20, 30", "radios por defecto en NM: " + await field("rg-radii"));
ok(await page.evaluate(() => document.title !== "" && document.getElementById("rg-title").textContent) === "Anillos de alcance", "título");

/* ---- vista previa en vivo ---- */
const previewCount = () => page.evaluate(() => (typeof rangePreview !== "undefined" && rangePreview) ? rangePreview.getLayers().length : 0);
await page.waitForFunction(() => rangePreview && rangePreview.getLayers().length === 3);
ok(await previewCount() === 3, "la vista previa dibuja los 3 anillos");
await set("rg-radii", "5, 10");
await page.waitForFunction(() => rangePreview && rangePreview.getLayers().length === 2);
await set("rg-radials", "90");
await page.waitForFunction(() => rangePreview && rangePreview.getLayers().length === 3);
ok(await previewCount() === 3, "y se actualiza al teclear (2 anillos + radiales)");
ok(JSON.stringify(await treeNames()) === JSON.stringify(before), "la vista previa no toca el árbol");

/* ---- entradas inválidas: motivo y Aceptar deshabilitado ---- */
await set("rg-radii", "abc");
await page.waitForFunction(() => !document.getElementById("rg-status").hidden);
ok(await page.evaluate(() => document.getElementById("rg-accept").disabled), "con un radio ilegible no se puede aceptar");
ok(/radios son números positivos/.test(await page.textContent("#rg-status")), "y dice por qué: " + await page.textContent("#rg-status"));
ok(await previewCount() === 0, "sin vista previa mientras sea inválido");
await set("rg-radii", "9000");
await page.waitForFunction(() => /radio máximo/.test(document.getElementById("rg-status").textContent));
await set("rg-lat", "95");
await page.waitForFunction(() => /posición del centro/.test(document.getElementById("rg-status").textContent));
await set("rg-lat", String(clicked.lat));

/* ---- Cancelar: no queda nada ---- */
await set("rg-radii", "10 20 30");
await page.click("#rg-cancel");
ok(await page.evaluate(() => document.getElementById("range-dialog").hidden), "Cancelar cierra el diálogo");
ok(await previewCount() === 0, "y retira la vista previa");
ok(JSON.stringify(await treeNames()) === JSON.stringify(before), "sin nodos nuevos");

/* ---- Escape también cancela ---- */
await openFromMenu("Anillos de alcance…");
await page.waitForFunction(() => rangePreview && rangePreview.getLayers().length >= 1);
await page.keyboard.press("Escape");
ok(await page.evaluate(() => document.getElementById("range-dialog").hidden) && await previewCount() === 0, "Escape cancela igual");

/* ---- Aceptar: carpeta con un anillo por radio y las radiales ---- */
await openFromMenu("Anillos de alcance…");
await set("rg-radii", "10 20");
await set("rg-radials", "90");
await page.click("#rg-accept");
ok(await page.evaluate(() => document.getElementById("range-dialog").hidden) && await previewCount() === 0, "Aceptar cierra y limpia la vista previa");
const made = await page.evaluate(async () => {
  const sec = [...document.querySelectorAll("#tree li")].find(l => l._name === "Polígonos");
  const folder = [...document.querySelectorAll("#tree li")].find(l => l._name === "Anillos de alcance 1");
  if (!sec || !folder) return null;
  const kids = [...nodeUl(folder).children].filter(l => l._name !== undefined);
  const c = map.getCenter();
  const first = nodeLayer(kids[0]);
  const pts = first.getLatLngs()[0];
  const dist = pts.map(p => map.distance(L.latLng(+document.getElementById("rg-lat").value, +document.getElementById("rg-lng").value), p));
  return { names: kids.map(k => k._name), n: pts.length, fill: first.options.fill, inRoot: rootGroup.hasLayer(first),
           radial: nodeLayer(kids[2]).getLatLngs().length, hasSection: !!sec };
});
ok(made && made.hasSection, "la carpeta cuelga de la sección «Polígonos»: " + JSON.stringify(made));
ok(JSON.stringify(made.names) === JSON.stringify(["10 NM", "20 NM", "Radiales cada 90°"]), "un nodo por radio y uno para las radiales: " + made.names);
ok(made.n === 180 && made.fill === false && made.inRoot, "anillos de 180 vértices, solo contorno, en el mapa: " + JSON.stringify(made));
ok(made.radial === 4, "4 radiales cada 90°");
const radius = await page.evaluate(([la, ln]) => {
  const li = [...document.querySelectorAll("#tree li")].find(l => l._name === "10 NM");
  return nodeLayer(li).getLatLngs()[0].map(p => map.distance(L.latLng(la, ln), p));
}, [clicked.lat, clicked.lng]);
ok(radius.every(d => Math.abs(d - 10 * NM) < 10 * NM * 2e-3), "cada vértice del anillo de 10 NM a 10 NM del centro (map.distance, ±0,2 %)");

/* ---- deshacer / rehacer: todo el conjunto a la vez ---- */
await page.evaluate(() => undoLast());
ok(!(await treeNames()).includes("Anillos de alcance 1"), "Ctrl+Z quita la carpeta entera");
ok(!(await treeNames()).includes("10 NM"), "y sus anillos");
await page.evaluate(() => redoLast());
ok((await treeNames()).includes("Anillos de alcance 1") && (await treeNames()).includes("20 NM"), "Ctrl+Y los devuelve");

/* ---- Sector: de 330° a 30°, pasando por el norte ---- */
await openFromMenu("Sector…");
ok(await page.evaluate(() => document.getElementById("rg-title").textContent) === "Sector" && !(await page.isVisible("#rg-radii")), "el diálogo se abre en modo sector, sin los campos de anillos");
await set("rg-az1", "330"); await set("rg-az2", "30"); await set("rg-rout", "15"); await set("rg-rin", "5");
await page.waitForFunction(() => rangePreview && rangePreview.getLayers().length === 1);
await set("rg-rin", "20");
await page.waitForFunction(() => /radio interior/.test(document.getElementById("rg-status").textContent));
await set("rg-rin", "5");
await set("rg-az2", "330");
await page.waitForFunction(() => /azimut final/.test(document.getElementById("rg-status").textContent));
await set("rg-az2", "30");
await page.click("#rg-accept");
const sec = await page.evaluate(([la, ln]) => {
  const li = [...document.querySelectorAll("#tree li")].find(l => l._name === "Sector 1");
  if (!li) return null;
  const pts = nodeLayer(li).getLatLngs()[0];
  const c = L.latLng(la, ln);
  const d = pts.map(p => map.distance(c, p));
  return { n: pts.length, fill: nodeLayer(li).options.fill, dmin: Math.min(...d), dmax: Math.max(...d) };
}, [clicked.lat, clicked.lng]);
ok(sec && sec.fill === true, "el sector es un polígono relleno: " + JSON.stringify(sec));
ok(sec && Math.abs(sec.dmax - 15 * NM) < 15 * NM * 2e-3 && Math.abs(sec.dmin - 5 * NM) < 5 * NM * 2e-3, "corona entre 5 y 15 NM: " + JSON.stringify(sec));
ok(sec && sec.n === 2 * (30 + 1), "arco de 60° en tramos de 2°, ida y vuelta: " + (sec && sec.n));

/* ---- recargar: siguen ahí, y el anillo del antimeridiano también ---- */
await page.evaluate(() => {
  openRangeDialog("rings", { lat: -17, lng: 179.9 });
  document.getElementById("rg-radii").value = "50";
  document.getElementById("rg-radii").dispatchEvent(new Event("input"));
});
await page.waitForFunction(() => rangePreview && rangePreview.getLayers().length === 1);
await page.click("#rg-accept");
const cross = await page.evaluate(() => {
  const f = [...document.querySelectorAll("#tree li")].find(l => l._name === "Anillos de alcance 2");
  const kid = [...nodeUl(f).children].find(l => l._name === "50 NM");
  return { maxLng: Math.max(...nodeLayer(kid).getLatLngs()[0].map(p => p.lng)) };
});
ok(cross.maxLng > 180, "el anillo que cruza ±180° tiene longitudes continuas (>180): " + cross.maxLng);
await page.waitForTimeout(1500); /* el guardado va con retardo */
await page.reload();
await waitAppReady(page);
const after = await page.evaluate(async () => {
  const find = n => [...document.querySelectorAll("#tree li")].find(l => l._name === n);
  const sectionLi = find("Polígonos");
  await ensureMaterialized(sectionLi);
  const f2 = find("Anillos de alcance 2");
  await ensureMaterialized(f2);
  const kid = find("50 NM");
  /* restaurada, la capa es un L.geoJSON (un grupo): su polígono es el primer sub-trazo */
  const poly = kid && nodeLayer(kid).getLayers()[0];
  const pts = poly ? poly.getLatLngs()[0] : [];
  return { names: [...document.querySelectorAll("#tree li")].map(l => l._name),
           sector: !!find("Sector 1"), ringPts: pts.length,
           maxLng: pts.length ? Math.max(...pts.map(p => p.lng)) : null };
});
ok(after.names.includes("Anillos de alcance 1") && after.names.includes("20 NM") && after.sector, "tras recargar siguen las capas: " + after.names.join("|"));
ok(after.ringPts === 180 && after.maxLng > 180, "y el anillo del antimeridiano sigue entero, sin que la restauración lo rechace: " + JSON.stringify(after));

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");
await ctx.close(); await browser.close();
srv.close();
done();
