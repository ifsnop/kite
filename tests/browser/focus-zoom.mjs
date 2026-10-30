/* La lupa 🔍 de un marcador del panel de navegación centra el visor en él
   y lo acerca al zoom de trabajo, 14 (antes 9). Con un clic real sobre el
   botón de la fila. El zoom es SIEMPRE el mismo, vengamos de más lejos o
   de más cerca; un polígono, en cambio, se encuadra entero con margen y
   no usa ese zoom fijo (ver tree-navigation-selection.md).              */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER FOCUS ZOOM TESTS OK");

const KML = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Sitios</name><open>1</open>
<Placemark><name>Faro</name><Point><coordinates>-3.7,40.4,0</coordinates></Point></Placemark>
<Placemark><name>Region</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-5,39 -3,39 -3,41 -5,41 -5,39</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;

const browser = await launch();
const srv = await serve(READABLE, 8953);
const { ctx, page, errors } = await openApp(browser, srv.url);
await page.evaluate(t => { window.__imp = handleDroppedFiles([new File([t], "sitios.kml")]); }, KML);
await page.evaluate(() => window.__imp);

const lupa = name => page.evaluate(n => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  const b = li.querySelector(':scope > .node-row button[aria-label^="Centrar la vista"]');
  const title = b.title;
  b.click();
  return title;
}, name);
const view = () => page.evaluate(() => ({ z: map.getZoom(), lat: map.getCenter().lat, lng: map.getCenter().lng }));

/* ---- desde lejos ---- */
await page.evaluate(() => map.setView([10, 10], 4, { animate: false }));
const title = await lupa("Faro");
await page.waitForFunction(() => map.getZoom() === 14);
let v = await view();
ok(v.z === 14, "la lupa de un marcador acerca al zoom 14: " + v.z);
ok(Math.abs(v.lat - 40.4) < 1e-4 && Math.abs(v.lng + 3.7) < 1e-4, "y lo deja centrado: " + JSON.stringify(v));
ok(/zoom 14\)/.test(title), "el título del botón dice el zoom: " + title);

/* ---- desde más cerca: también 14, siempre igual ---- */
await page.evaluate(() => map.setView([40.45, -3.65], 18, { animate: false }));
await lupa("Faro");
await page.waitForFunction(() => map.getZoom() === 14);
v = await view();
ok(v.z === 14 && Math.abs(v.lat - 40.4) < 1e-4, "desde el zoom 18 vuelve al 14, sin depender de la vista previa: " + JSON.stringify(v));

/* ---- un polígono NO usa ese zoom: se encuadra entero ---- */
await page.evaluate(() => map.setView([10, 10], 4, { animate: false }));
await lupa("Region");
await page.waitForFunction(() => Math.abs(map.getCenter().lat - 40) < 0.2);
v = await view();
ok(v.z < 10 && v.z !== 14, "un polígono de 2° se encuadra con margen, no a zoom fijo: " + v.z);
ok(await page.evaluate(() => map.getBounds().contains(L.latLng(39, -5)) && map.getBounds().contains(L.latLng(41, -3))), "y cabe entero en el visor");

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
await ctx.close(); await browser.close();
srv.close();
done();
