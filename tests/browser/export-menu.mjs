/* El botón 💾 abre un minimenú con tres formatos (KITE, KML, GeoJSON).
   Aquí, con clics y descargas reales: el menú se abre y se cierra de
   las cuatro maneras previstas (Escape sin que el Escape llegue al
   árbol, clic fuera, volver a pulsar 💾 y elegir una entrada), las dos
   exportaciones bajan con el nombre y la extensión debidos y el
   contenido que toca, el KML vuelve a entrar con el importador real, y
   una carpeta que nadie ha desplegado se exporta sin construir ni una
   fila (se lee de los registros, igual que se guarda).               */
import fs from "node:fs";
import path from "node:path";
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER EXPORT MENU TESTS OK");
const EJEMPLOS = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "docs", "ejemplos");
const SIERRA = fs.readFileSync(path.join(EJEMPLOS, "operacion-sierra.kml"), "utf8");

const browser = await launch();
const srv = await serve(READABLE, 8947);
const { ctx, page, errors } = await openApp(browser, srv.url);

await page.evaluate(t => { window.__imp = handleDroppedFiles([new File([t], "operacion-sierra.kml")]); }, SIERRA);
await page.evaluate(() => window.__imp);

/* Lo que hay bajo «Zonas»: hojas (capas) contadas del registro, sin materializar */
const zonas = () => page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Zonas");
  const leaves = rs => rs.reduce((n, r) => n + (r.children ? leaves(r.children) : 1), 0);
  return { pending: !!li._pending, leaves: leaves(serializeNode(li)[0].children), stillPending: !!li._pending };
});
const z0 = await zonas();
ok(z0.leaves === 3, "«Zonas» tiene 3 capas: " + z0.leaves);

const menuItems = () => page.evaluate(() => [...document.querySelectorAll(".ctx-menu:not(#map-ctxmenu) .ctx-menu-item")].map(b => b.textContent));
const openMenu = name => page.evaluate(n => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  li.querySelector(':scope > .node-row button[aria-label^="Guardar o exportar"]').click();
}, name);

/* ---- abrir y cerrar ---- */
await openMenu("Zonas");
ok(JSON.stringify(await menuItems()) === JSON.stringify(["Archivo de KITE (.kite.json)", "KML (.kml)", "GeoJSON (.geojson)"]),
  "el menú ofrece los tres formatos: " + JSON.stringify(await menuItems()));

await page.evaluate(() => { window.__esc = 0; document.addEventListener("keydown", e => { if (e.key === "Escape") window.__esc++; }); });
await page.keyboard.press("Escape");
ok((await menuItems()).length === 0, "Escape cierra el menú");
ok(await page.evaluate(() => window.__esc) === 0, "ese Escape no llega al árbol (no limpia además la selección)");

await openMenu("Zonas");
await page.mouse.click(900, 500); /* en el mapa */
ok((await menuItems()).length === 0, "un clic fuera cierra el menú");

await openMenu("Zonas");
await openMenu("Zonas");
ok((await menuItems()).length === 0, "volver a pulsar 💾 lo cierra");

await openMenu("Zonas");
await openMenu("Zona A");
ok((await menuItems()).length === 3, "abrir el de otra fila sustituye al anterior, no se apilan");
await page.keyboard.press("Escape");

/* ---- Con el RATÓN de verdad: ir del 💾 a una entrada no cierra el menú ----
   Se reportó: «el diálogo desaparece al mover el ratón fuera de la opción de
   guardar». Los botones de una fila solo se ven con el ratón encima; al salir
   de la fila el 💾 —que tiene el foco tras pulsarlo— se oculta y pierde el foco,
   y el `blur` de ese ELEMENTO llegaba al oyente de captura de `window` y cerraba
   el menú. Con `.click()` de JavaScript (todo lo de arriba) no se ve nunca.   */
await page.mouse.move(10, 10);
const filaZonas = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Zonas");
  const r = li.querySelector(":scope > .node-row").getBoundingClientRect();
  return { x: r.x + 60, y: r.y + r.height / 2 };
});
await page.mouse.move(filaZonas.x, filaZonas.y);
const botonGuardar = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Zonas");
  const b = li.querySelector(':scope > .node-row button[aria-label^="Guardar o exportar"]').getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
await page.mouse.click(botonGuardar.x, botonGuardar.y);
ok((await menuItems()).length === 3, "el menú se abre al pulsar 💾 con el ratón");
const caja = await page.evaluate(() => { const r = document.querySelector(".ctx-menu:not(#map-ctxmenu)").getBoundingClientRect(); return { x: r.x, y: r.y }; });
const destino = { x: caja.x + 40, y: caja.y + 14 };         /* la primera entrada */
let abiertoEnTodoElCamino = true;
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(botonGuardar.x + (destino.x - botonGuardar.x) * i / 12, botonGuardar.y + (destino.y - botonGuardar.y) * i / 12);
  await page.waitForTimeout(30);   /* deja que el navegador reparta hover y foco */
  if ((await menuItems()).length !== 3) { abiertoEnTodoElCamino = false; break; }
}
ok(abiertoEnTodoElCamino, "al llevar el ratón del 💾 a una entrada el menú sigue abierto (los botones de la fila se ocultan por el camino)");
const [dlRaton] = await Promise.all([page.waitForEvent("download"), page.mouse.click(destino.x, destino.y)]);
ok(/^Zonas\.kite\.json$/.test(dlRaton.suggestedFilename()), "y pulsar la entrada con el ratón la elige y baja el archivo: " + dlRaton.suggestedFilename());
ok((await menuItems()).length === 0, "tras elegir, el menú se cierra");
/* Lo que sí debe cerrarlo con el ratón: pulsar fuera */
await page.mouse.move(filaZonas.x, filaZonas.y);
await page.mouse.click(botonGuardar.x, botonGuardar.y);
await page.mouse.move(900, 500);
ok((await menuItems()).length === 3, "mover el ratón al mapa NO cierra el menú: solo un clic fuera, Escape o desplazarse");
await page.mouse.click(900, 500);
ok((await menuItems()).length === 0, "el clic fuera sí");


/* ---- exportar ---- */
const pick = label => page.evaluate(l => {
  [...document.querySelectorAll(".ctx-menu:not(#map-ctxmenu) .ctx-menu-item")].find(b => b.textContent === l).click();
}, label);
async function download(label) {
  await openMenu("Zonas");
  const [dl] = await Promise.all([page.waitForEvent("download"), pick(label)]);
  return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), "utf8") };
}

const kml = await download("KML (.kml)");
ok(kml.name === "Zonas.kml", "nombre del KML: " + kml.name);
const kmlInfo = await page.evaluate(t => {
  const d = new DOMParser().parseFromString(t, "text/xml");
  return { bad: !!d.querySelector("parsererror"), pms: d.getElementsByTagName("Placemark").length,
           name: d.getElementsByTagName("name")[0].textContent };
}, kml.text);
ok(!kmlInfo.bad && kmlInfo.pms === 3 && kmlInfo.name === "Zonas", "KML bien formado con 3 Placemark: " + JSON.stringify(kmlInfo));

const gj = await download("GeoJSON (.geojson)");
ok(gj.name === "Zonas.geojson", "nombre del GeoJSON: " + gj.name);
const fc = JSON.parse(gj.text);
ok(fc.type === "FeatureCollection" && fc.name === "Zonas" && fc.features.length === 3, "GeoJSON con 3 entidades");
ok(fc.features.every(f => typeof f.properties.name === "string" && f.geometry.type === "Polygon"), "cada entidad lleva su nombre y su polígono");

const kite = await download("Archivo de KITE (.kite.json)");
ok(kite.name === "Zonas.kite.json" && JSON.parse(kite.text).app === "kite-local/tree", "el formato propio sigue funcionando: " + kite.name);

/* Un Document sin <open> llega cerrado y nadie lo despliega: toda su rama son registros pendientes */
const CERRADA = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Doc</name>
<Folder><name>Cerrada</name>
<Placemark><name>P1</name><Point><coordinates>-3.7,40.4,650</coordinates></Point></Placemark>
<Placemark><name>P2</name><Point><coordinates>-3.6,40.5</coordinates></Point></Placemark>
</Folder></Document></kml>`;
await page.evaluate(t => { window.__imp = handleDroppedFiles([new File([t], "cerrada.kml")]); }, CERRADA);
await page.evaluate(() => window.__imp);
const pend = () => page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Doc");
  return { pending: !!li._pending, rows: li.querySelectorAll(":scope > ul > li").length };
});
const c0 = await pend();
ok(c0.pending && c0.rows === 0, "«Doc» (el Document, cerrado) llega con sus capas sin construir: " + JSON.stringify(c0));
await openMenu("Doc");
const [dlC] = await Promise.all([page.waitForEvent("download"), pick("GeoJSON (.geojson)")]);
const cfc = JSON.parse(fs.readFileSync(await dlC.path(), "utf8"));
ok(cfc.features.length === 2 && cfc.features[0].geometry.coordinates[2] === 650, "exporta sus 2 puntos, con la altitud");
ok(cfc.features.every(f => f.properties.folder === "Cerrada"), "con su carpeta (relativa al nodo exportado): " + JSON.stringify(cfc.features.map(f => f.properties.folder)));
const c1 = await pend();
ok(c1.pending && c1.rows === 0, "exportar no desplegó la carpeta: se leyó de los registros: " + JSON.stringify(c1));

/* ---- ida y vuelta: el KML exportado vuelve a entrar ---- */
const before = await page.evaluate(() => [...document.querySelectorAll("#tree li")].filter(l => l._name === "Zona A").length);
await page.evaluate(t => { window.__imp = handleDroppedFiles([new File([t], "Zonas.kml")]); }, kml.text);
await page.evaluate(() => window.__imp);
const back = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].filter(x => x._name === "Zonas").pop();
  const leaves = rs => rs.reduce((n, r) => n + (r.children ? leaves(r.children) : 1), 0);
  return { leaves: leaves(serializeNode(li)[0].children) };
});
ok(back.leaves === 3, "el KML exportado se importa con sus 3 capas: " + back.leaves);

/* ---- una capa suelta también lleva 💾 ---- */
await page.evaluate(() => {
  const z = [...document.querySelectorAll("#tree li")].find(x => x._name === "Zonas");
  z.classList.remove("collapsed"); syncExpanded(z);
  return ensureMaterialized(z);
});
await openMenu("Zona A");
const single = await Promise.all([page.waitForEvent("download"), pick("GeoJSON (.geojson)")]).then(([d]) => d.suggestedFilename());
ok(single === "Zona A.geojson", "una capa suelta se exporta con su nombre: " + single);

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");

await ctx.close(); await browser.close();
srv.close();
done();
