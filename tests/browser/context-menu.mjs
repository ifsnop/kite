/* Menú contextual del visor: «Editar propiedades», nuevo.

   Ya había «Ir al nodo en el panel» y, si la capa tiene algo que
   enseñar, «Mostrar propiedades» (el panel de SOLO LECTURA de la ficha
   KML/`properties`, `showLayerInfo`). Pedido: un acceso directo al
   diálogo de ESTILOS (el que abren el botón 🎨 o Alt+Intro) desde el
   propio menú contextual, para no tener que ir al árbol primero. Se
   llama «Editar propiedades», deliberadamente distinto de «Mostrar
   propiedades» —si llevaran el mismo nombre, uno de los dos parecería
   no hacer nada—, y solo aparece para los tipos de capa que
   `openStyleDialog` acepta (`STYLE_EDITABLE_KINDS`, el mismo criterio
   que ya usa ese diálogo para rechazar una capa sin estilos editables).

   `tests/geojsonnametest.js` ya prueba el enrutado de `layerCtxItems`/
   `ctxItemsFor` a nivel de función, con capas sueltas de mentira; aquí
   hace falta lo que ese nivel no puede dar: un clic derecho DE VERDAD
   sobre el mapa, que pase por el hit-testing real (`layersAtPoint`) y
   abra el diálogo de estilos real.                                    */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER CONTEXT MENU TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8892);
const { page, errors } = await openApp(browser, srv.url);

const setup = await page.evaluate(async () => {
  const ul = ensureRootUl();
  const pol = L.polygon([[40.4, -3.7], [40.5, -3.7], [40.5, -3.6]]).addTo(rootGroup);
  const li = makeNode({ name: "Parcela contextual", layer: pol, style: normalizePathStyle({}) });
  ul.appendChild(li);
  const centroid = pol.getBounds().getCenter();
  const pt = map.latLngToContainerPoint(centroid);
  const mapRect = map.getContainer().getBoundingClientRect();
  return { x: mapRect.left + pt.x, y: mapRect.top + pt.y };
});

/* Clic derecho de verdad sobre el polígono */
await page.mouse.move(setup.x, setup.y);
await page.mouse.click(setup.x, setup.y, { button: "right" });
await page.waitForTimeout(100);

const menu = await page.evaluate(() => {
  const items = [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")].map(b => b.textContent);
  return { items, hidden: document.getElementById("map-ctxmenu").hidden };
});
ok(!menu.hidden, "clic derecho sobre el polígono abre el menú contextual");
ok(menu.items.includes("Editar propiedades"), "y ofrece «Editar propiedades»: " + JSON.stringify(menu.items));
ok(menu.items.includes("Mostrar propiedades") === false || menu.items.includes("Editar propiedades"),
  "distinto de «Mostrar propiedades» (nombres no colisionan)");

/* Pulsarlo abre el diálogo de estilos, mostrando ESTA capa */
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")]
    .find(b => b.textContent === "Editar propiedades");
  btn.click();
});
const opened = await page.evaluate(() => ({
  dialogOpen: !styleDialog.hidden,
  title: document.getElementById("style-title").textContent,
  menuClosedAfter: document.getElementById("map-ctxmenu").hidden
}));
ok(opened.dialogOpen, "«Editar propiedades» abre el diálogo de estilos");
ok(opened.title.includes("Parcela contextual"), "mostrando la capa correcta: " + opened.title);
ok(opened.menuClosedAfter, "y cierra el menú contextual al elegir la acción");

await page.evaluate(() => closeStyleDialog(true));

/* Clic derecho en un punto del mapa SIN ninguna capa debajo: menú
   genérico, sin "Editar propiedades" (no hay a qué aplicarlo). El caso
   de una capa con un tipo no editable (elevGrid, sin estilos propios)
   ya lo prueba tests/geojsonnametest.js a nivel de función — sus celdas
   son `interactive: false` (60-elevation.js) y nunca llegan a ser un
   "hit" de un clic real, así que no hay forma de probarlo aquí con una
   capa de verdad.                                                     */
await page.mouse.click(setup.x + 200, setup.y + 200, { button: "right" });
await page.waitForTimeout(100);
const menu2 = await page.evaluate(() =>
  [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")].map(b => b.textContent));
ok(!menu2.includes("Editar propiedades"),
  "clic derecho sin ninguna capa debajo: no ofrece «Editar propiedades»: " + JSON.stringify(menu2));
ok(menu2.includes("Copiar coordenadas"), "y sí el menú genérico del mapa: " + JSON.stringify(menu2));

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
