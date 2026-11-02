/* El clic derecho sobre una capa cuya carpeta NO se ha desplegado nunca
   (tras recargar, cualquiera que se guardara colapsada): la capa está
   dibujada en el mapa pero su fila todavía es un registro pendiente, y el
   hit-testing del menú contextual solo veía capas con fila. El menú salía
   sin «Ir al nodo en el panel», sin «Editar propiedades» y, en una ruta con
   su perfil, sin «Mostrar perfil»: el fallo reportado. Ahora el clic derecho
   materializa lo que haga falta (como pasar el ratón por una capa pendiente).

   A) Un polígono de un KML en carpetas colapsadas, tras recargar.
   B) Una ruta con su perfil (MDT y MDS falsos), con «Mediciones» y/o
      «Perfiles de ruta» colapsadas, tras recargar: siempre «Mostrar perfil».
   Todo con el clic derecho REAL del ratón sobre el mapa.                   */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";
import { ignFakes, IGN_ROUTE } from "./_fakes.mjs";

const { ok, done } = reporter("BROWSER CONTEXT PENDING TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8961);
const { ctx, page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });
const fake = ignFakes();
await page.route(IGN_ROUTE, fake.handler);

const settle = () => page.evaluate(() => new Promise(r => setTimeout(r, 900))); /* guardado (debounce) */
const reload = async () => {
  await settle();
  await page.reload();
  await waitAppReady(page);
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
};
const rightClickAt = async (lat, lng) => {
  const pt = await page.evaluate(([la, lo]) => {
    const p = map.latLngToContainerPoint(L.latLng(la, lo)), r = map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lat, lng]);
  await page.mouse.click(pt.x, pt.y, { button: "right" });
  await page.waitForFunction(() => !document.getElementById("map-ctxmenu").hidden);
  return page.evaluate(() => [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")].map(b => b.textContent));
};
const closeMenu = () => page.keyboard.press("Escape");
const rowState = name => page.evaluate(n => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  return li ? { pending: !!(li._pending && li._pending.length), collapsed: li.classList.contains("collapsed"),
                rows: li.querySelectorAll(":scope > ul > li").length } : null;
}, name);
const setCollapsed = (name, want) => page.evaluate(([n, w]) => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  if (li.classList.contains("collapsed") !== w) li.querySelector(":scope > .node-row .caret").click();
}, [name, want]);

/* ---------- A) una capa de una carpeta nunca desplegada ---------- */
const KML = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Datos</name>
<Folder><name>Zona</name><Placemark><name>P1</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
-3.72,40.40,0 -3.66,40.40,0 -3.66,40.44,0 -3.72,40.44,0 -3.72,40.40,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Folder>
</Document></kml>`;
await page.evaluate(async t => { window.__imp = handleDroppedFiles([new File([t], "datos.kml")]); await window.__imp; map.setView([40.42, -3.69], 12, { animate: false }); }, KML);
await reload();
let st = await rowState("Datos");
ok(st && st.pending && st.rows === 0 && (await rowState("Zona")) === null, "tras recargar, «Datos» (con «Zona» dentro) es una carpeta pendiente, sin filas: " + JSON.stringify(st));
const mA = await rightClickAt(40.42, -3.69);
ok(mA.some(t => /^Ir al nodo en el panel/.test(t)) && mA.some(t => /^Editar propiedades/.test(t)),
  "clic derecho sobre la capa de la carpeta cerrada: ofrece «Ir al nodo» y «Editar propiedades»: " + JSON.stringify(mA));
st = await rowState("Zona");
ok(st && st.rows === 1 && !st.pending, "y se materializó la cadena hasta la capa («Zona» con su fila): " + JSON.stringify(st));
await closeMenu();

/* ---------- B) una ruta con su perfil ---------- */
const WP = [{ lat: 40.4168, lng: -3.7038 }, { lat: 40.4168, lng: -3.69 }, { lat: 40.425, lng: -3.69 }];
await page.evaluate(async wps => {
  setMeasureUnit("km"); setAltitudeUnit("m");
  elevSources = { mdt: "ign-mdt05", mds: "ign-mds" };
  const m = buildRouteMeasurement(wps); finalizeRouteMeasurement(m);
  map.fitBounds(m.group.getBounds(), { animate: false });
  await obtainRouteProfile([...document.querySelectorAll("#tree li")].find(x => x._measure));
  closeProfileDialog();
}, WP);
const AT = { lat: 40.4168, lng: -3.697 };
for (const collapsed of [[], ["Perfiles de ruta"], ["Mediciones"], ["Mediciones", "Perfiles de ruta"]]) {
  for (const n of ["Mediciones", "Perfiles de ruta"]) await setCollapsed(n, collapsed.includes(n));
  await reload();
  const name = collapsed.length ? "con " + collapsed.join(" y ") + " colapsada(s)" : "con todo desplegado";
  if (collapsed.includes("Mediciones")) {
    const s = await rowState("Mediciones");
    ok(s.pending && s.rows === 0, `${name}: la ruta es un registro pendiente tras recargar`);
  }
  const m = await rightClickAt(AT.lat, AT.lng);
  ok(m.includes("Mostrar perfil"), `${name}: el clic derecho sobre la ruta ofrece «Mostrar perfil»: ${JSON.stringify(m)}`);
  ok(m.some(t => /^Ir al nodo en el panel/.test(t)) && m.some(t => /^Editar propiedades/.test(t)), `${name}: y sus entradas de capa`);
  if (!m.includes("Mostrar perfil")) { await closeMenu(); continue; }
  /* La opción funciona de verdad: abre el perfil guardado, sin pedir nada */
  const n0 = fake.seen.length;
  await page.evaluate(() => [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")].find(b => b.textContent === "Mostrar perfil").click());
  await page.waitForFunction(() => !document.getElementById("profile-dialog").hidden && document.querySelectorAll("#profile-chart polyline.pf-line").length >= 2);
  ok(fake.seen.length === n0, `${name}: «Mostrar perfil» abre el guardado sin pedir nada`);
  await page.evaluate(() => closeProfileDialog());
}

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");
await ctx.close(); await browser.close();
srv.close();
done();
