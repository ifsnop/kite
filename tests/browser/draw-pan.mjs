/* Desplazar el mapa arrastrando MIENTRAS se dibuja. El polígono («Polígono o
   línea») y la ruta añaden vértices con CLIC, así que el arrastre puede ser un
   pan; solo el círculo y el arco dibujan arrastrando.

   1) Polígono: con un vértice puesto, arrastrar el mapa lo desplaza, NO añade
      vértice (el clic que sigue a un arrastre se ignora) y el siguiente clic
      añade uno en la posición nueva; un clic con 2 px de temblor sigue siendo
      un clic; arrastrar un vértice lo mueve sin hacer pan; el doble clic sigue
      cerrando el polígono.
   2) Ruta: lo mismo, antes y después del 2.º punto (con su diálogo abierto).
   3) Círculo y arco: el arrastre sigue dibujando y NO desplaza el mapa.
   4) El pan queda activo al soltar la herramienta.                       */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER DRAW PAN TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8976);
const { page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

/* Sin inercia: tras soltar, Leaflet sigue deslizando el mapa un rato y las medidas de «el mapa no se mueve» no serían deterministas */
await page.evaluate(() => { map.options.inertia = false; });
const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const center = () => page.evaluate(() => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; });
const moved = (a, b) => Math.abs(a.lat - b.lat) > 1e-4 || Math.abs(a.lng - b.lng) > 1e-4;
const tool = t => page.evaluate(x => { setTool(null); setTool(x); }, t);
const state = () => page.evaluate(() => ({ tool: activeTool, poly: polyDraft ? polyDraft.vertices.length : 0,
  routeDraft: !!routeDraft, route: routeMeasurement ? routeMeasurement.handles.length : 0, pan: map.dragging.enabled() }));
const click = (x, y) => page.mouse.click(x, y);
const drag = async (x0, y0, x1, y1) => {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 4 });
  await page.mouse.up();
  await frames();
};
/* Un punto de la pantalla (px de la página) → lat/lng, con la vista de ahora */
const latlngAt = (x, y) => page.evaluate(([px, py]) => {
  const r = map.getContainer().getBoundingClientRect();
  const ll = map.containerPointToLatLng([px - r.left, py - r.top]);
  return { lat: ll.lat, lng: ll.lng };
}, [x, y]);
const near = (a, b) => Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;

/* ---------- 1. Polígono ---------- */
await tool("polygon");
let s = await state();
ok(s.tool === "polygon" && s.pan, "con el polígono armado, el pan del mapa sigue activo");
await click(600, 400);
ok((await state()).poly === 1, "el primer clic añade un vértice");

let c0 = await center();
await drag(900, 600, 780, 540);
s = await state();
ok(moved(c0, await center()), "arrastrar el mapa lo desplaza mientras se dibuja");
ok(s.poly === 1 && s.tool === "polygon", "y el clic que sigue al arrastre NO añade un vértice: " + JSON.stringify(s));

const p2 = { x: 820, y: 330 };
const want2 = await latlngAt(p2.x, p2.y);
await click(p2.x, p2.y);
const v2 = await page.evaluate(() => polyDraft.vertices.map(v => ({ lat: v.lat, lng: v.lng })));
ok(v2.length === 2 && near(v2[1], want2), "el siguiente clic añade el vértice en la posición NUEVA del mapa: " + JSON.stringify(v2[1]));

/* Un clic con algo de temblor sigue siendo un clic */
await page.mouse.move(900, 500);
await page.mouse.down();
await page.mouse.move(902, 501, { steps: 2 });
await page.mouse.up();
await frames();
ok((await state()).poly === 3, "un clic con 2 px de temblor añade vértice (no es un arrastre)");

/* Arrastrar un vértice lo mueve y no hace pan */
const h0 = await page.evaluate(() => {
  const p = map.latLngToContainerPoint(polyDraft.vertices[0]), r = map.getContainer().getBoundingClientRect();
  return { x: r.left + p.x, y: r.top + p.y, ll: { lat: polyDraft.vertices[0].lat, lng: polyDraft.vertices[0].lng } };
});
c0 = await center();
await drag(h0.x, h0.y, h0.x + 40, h0.y + 30);
const after = await page.evaluate(() => ({ v0: { lat: polyDraft.vertices[0].lat, lng: polyDraft.vertices[0].lng }, n: polyDraft.vertices.length, pan: map.dragging.enabled() }));
ok(moved(h0.ll, after.v0) && after.n === 3, "arrastrar un vértice lo mueve (y no añade otro): " + JSON.stringify(after));
ok(!moved(c0, await center()), "y no desplaza el mapa");
ok(after.pan, "con el pan activo otra vez al soltar el vértice");

/* El doble clic sobre el último vértice sigue cerrando el polígono */
const last = await page.evaluate(() => {
  const p = map.latLngToContainerPoint(polyDraft.vertices[polyDraft.vertices.length - 1]), r = map.getContainer().getBoundingClientRect();
  return { x: r.left + p.x, y: r.top + p.y };
});
await page.mouse.dblclick(last.x, last.y);
await frames();
const closed = await page.evaluate(() => ({ nodes: [...document.querySelectorAll("#tree li")].filter(x => /^Polígono \d+/.test(x._name || "")).length, tool: activeTool }));
ok(closed.nodes === 1 && closed.tool === null, "el doble clic sobre el último vértice sigue cerrando el polígono: " + JSON.stringify(closed));
ok((await state()).pan, "y el pan queda activo al soltar la herramienta");

/* ---------- 2. Ruta ---------- */
await tool("route");
await click(500, 350);
s = await state();
ok(s.routeDraft && s.pan, "ruta: el primer punto es la vista previa y el pan sigue activo");
c0 = await center();
await drag(900, 650, 800, 600);
s = await state();
ok(moved(c0, await center()) && s.routeDraft && s.route === 0, "arrastrar el mapa no crea la ruta: " + JSON.stringify(s));
await click(560, 380);
s = await state();
ok(s.route === 2, "el siguiente clic crea la ruta con dos waypoints (y abre su diálogo)");
c0 = await center();
await drag(900, 650, 820, 590);
s = await state();
ok(moved(c0, await center()) && s.route === 2, "con la ruta ya creada, arrastrar el mapa lo desplaza sin añadir waypoint: " + JSON.stringify(s));
await click(640, 420);
ok((await state()).route === 3, "y el siguiente clic añade el waypoint");
await page.keyboard.press("Escape");
await page.evaluate(() => { setTool(null); });

/* ---------- 3. Círculo y arco: el arrastre dibuja ---------- */
await tool("circle");
s = await state();
ok(s.tool === "circle" && !s.pan, "con el círculo armado, el pan está desactivado");
c0 = await center();
await drag(600, 400, 700, 460);
const circ = await page.evaluate(() => [...document.querySelectorAll("#tree li")].filter(x => x._measure && x._measure.type === "circle").length);
const c1 = await center(); ok(circ === 1 && !moved(c0, c1), "el círculo se dibuja arrastrando y no desplaza el mapa: " + circ + JSON.stringify([c0, c1]));
await tool("arc");
ok(!(await state()).pan, "con el arco armado, el pan también está desactivado");
await page.evaluate(() => { setTool(null); });
ok((await state()).pan, "al soltar la herramienta, el pan vuelve");

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
await browser.close();
srv.close();
done();
