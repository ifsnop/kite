/* Estilo por atributo, de punta a punta: desde la tabla de atributos de
   una carpeta CERRADA (sus capas son registros pendientes), clasificar por
   categorías o por tramos numéricos, ver el resultado EN VIVO en el mapa,
   Cancelar (todo vuelve) y Aceptar (queda como estilo normal de cada
   capa, sin desplegar la carpeta, con deshacer y tras recargar).        */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER ATTR STYLE TESTS OK");

const data = o => "<ExtendedData>" + Object.entries(o).map(([k, v]) => `<Data name="${k}"><value>${v}</value></Data>`).join("") + "</ExtendedData>";
const poly = (name, o, x) => `<Placemark><name>${name}</name>${data(o)}<Polygon><outerBoundaryIs><LinearRing><coordinates>`
  + `${x},40 ${x + 0.01},40 ${x + 0.01},40.01 ${x},40.01 ${x},40</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
const pt = (name, o, x) => `<Placemark><name>${name}</name>${data(o)}<Point><coordinates>${x},41</coordinates></Point></Placemark>`;
const KML = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Zonas</name>`
  + poly("Z1", { tipo: "A", n: 10 }, -3.0) + poly("Z2", { tipo: "B", n: 20 }, -3.1) + poly("Z3", { tipo: "A", n: 30 }, -3.2)
  + poly("Z4", { tipo: "C", n: 40 }, -3.3) + poly("Z5", { n: 50 }, -3.4)
  + pt("P1", { tipo: "A", n: 1 }, -3.0) + pt("P2", { tipo: "B", n: 2 }, -3.1)
  + `</Document></kml>`;

const browser = await launch();
const srv = await serve(READABLE, 8952);
const { ctx, page, errors } = await openApp(browser, srv.url);
await page.evaluate(t => { window.__imp = handleDroppedFiles([new File([t], "zonas.kml")]); }, KML);
await page.evaluate(() => window.__imp);

/* El estado de cada capa de la instantánea de la tabla: color del trazo/relleno o del icono */
const colors = () => page.evaluate(() => attrState.rows.map(r => {
  const layer = r.li ? nodeLayer(r.li) : r.rec._layer;
  let c = null;
  layer.eachLayer(l => {
    if (l instanceof L.Marker) { const h = l.options.icon.options.html || ""; c = (/color:(#[0-9a-f]{6})/i.exec(h) || [])[1] || "pin"; }
    else if (l.options) c = l.options.color + "/" + (l.options.fillColor || l.options.color); /* sin fillColor Leaflet rellena con el del trazo */
  });
  return [r.name, c];
}));
const byName = list => Object.fromEntries(list);
const pending = () => page.evaluate(() => { const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Zonas"); return !!li._pending && li.querySelectorAll(":scope > ul > li").length === 0; });
const openTable = () => page.evaluate(() => [...document.querySelectorAll("#tree li")].find(x => x._name === "Zonas")
  .querySelector(':scope > .node-row button[aria-label^="Tabla de atributos"]').click());
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

await openTable();
await page.waitForFunction(() => !document.getElementById("attr-dialog").hidden);
const before = byName(await colors());
ok(await pending(), "la carpeta llega cerrada: sus capas son registros pendientes");
ok(before.Z1 === before.Z3 && before.Z1 === before.Z5, "al principio todas con el mismo estilo (el de por defecto de KML): " + before.Z1);

/* ---- abrir el diálogo: categorías por el primer atributo, en vivo ---- */
await page.click("#attr-style");
await page.waitForFunction(() => !document.getElementById("attrstyle-dialog").hidden);
const ui = () => page.evaluate(() => ({
  attrs: [...document.querySelectorAll("#as-attr option")].map(o => o.value),
  mode: document.getElementById("as-mode").value,
  gradDisabled: document.querySelector('#as-mode option[value="graduated"]').disabled,
  gradFieldsHidden: document.getElementById("as-grad-fields").hidden,
  classes: [...document.querySelectorAll("#as-classes .as-class")].map(r => [r.querySelector(".as-label").textContent, r.querySelector(".dlg-note").textContent, r.querySelector(".color-btn").dataset.color]),
  summary: document.getElementById("as-summary").textContent,
  accept: !document.getElementById("as-accept").disabled
}));
let u = await ui();
ok(u.attrs.join() === "tipo,n", "el selector ofrece los atributos de la tabla: " + u.attrs);
ok(u.mode === "categories" && u.gradDisabled && u.gradFieldsHidden, "categorías por defecto, y graduado deshabilitado: «tipo» no es numérico");
ok(u.classes.map(c => c[0]).join("|") === "A|B|C|(sin valor)", "una clase por valor, las más frecuentes primero, y «(sin valor)»: " + JSON.stringify(u.classes.map(c => c[0])));
ok(u.classes.map(c => c[1]).join("|") === "3 capas|2 capas|1 capa|1 capa", "con su recuento (marcadores incluidos): " + JSON.stringify(u.classes.map(c => c[1])));
ok(/7 capas/.test(u.summary), "y dice a cuántas capas se aplica: " + u.summary);
await frame();
let now = byName(await colors());
ok(now.Z1 === now.Z3 && now.Z1 !== now.Z2 && now.Z2 !== now.Z4 && now.Z1 !== before.Z1, "EN VIVO: A y A iguales, B y C distintos y distintos del de antes: " + JSON.stringify(now));
ok(now.Z1 === `${u.classes[0][2]}/${u.classes[0][2]}`, "con el color de su clase en trazo y relleno");
ok(now.Z5 === `#9E9E9E/#9E9E9E`, "una capa sin el atributo, en el gris de «sin valor»: " + now.Z5);
ok(now.P1 === u.classes[0][2] && /^#/.test(now.P1) && now.P1 !== "pin", "un marcador con la gota de Leaflet pasa a un icono coloreable, del color de su clase: " + now.P1);
ok(await page.evaluate(() => document.getElementById("tree").querySelector("li") && true) && await pending(), "la vista previa no desplegó la carpeta");

/* ---- cambiar de atributo: graduado ---- */
await page.selectOption("#as-attr", "n");
u = await ui();
ok(!u.gradDisabled, "con una columna numérica el graduado se habilita");
await page.selectOption("#as-mode", "graduated");
await page.fill("#as-n", "2");
u = await ui();
ok(!u.gradFieldsHidden && u.classes.length === 2, "graduado en 2 clases: " + JSON.stringify(u.classes.map(c => c[0])));
ok(u.classes[0][0] === "1 – 25.5" && u.classes[1][0] === "25.5 – 50", "tramos entre el mínimo (1, un marcador) y el máximo (50): " + u.classes.map(c => c[0]));
ok(u.classes[0][2] === "#ffffcc" && u.classes[1][2] === "#253494", "de la primera a la última parada de la rampa");
await frame();
now = byName(await colors());
ok(now.Z1 === "#ffffcc/#ffffcc" && now.Z4 === "#253494/#253494" && now.Z5 === "#253494/#253494", "10 en el primer tramo; 40 y 50 en el segundo: " + JSON.stringify(now));
await page.selectOption("#as-method", "quantile");
u = await ui();
ok(u.classes.length === 2 && u.classes.reduce((n, c) => n + parseInt(c[1]), 0) === 7, "cuantiles: sigue habiendo 2 clases y todas las capas");

/* ---- Cancelar: todo vuelve ---- */
await page.click("#as-cancel");
await frame();
ok(await page.evaluate(() => document.getElementById("attrstyle-dialog").hidden), "Cancelar cierra el diálogo");
const afterCancel = byName(await colors());
ok(JSON.stringify(afterCancel) === JSON.stringify(before), "y devuelve cada capa a su estilo original (polígonos y marcadores): " + JSON.stringify(afterCancel));

/* ---- Escape también cancela ---- */
await page.click("#attr-style");
await page.waitForFunction(() => !document.getElementById("attrstyle-dialog").hidden);
await frame();
ok(byName(await colors()).Z1 !== before.Z1, "(se abre de nuevo y vuelve a colorear)");
await page.keyboard.press("Escape");
await frame();
ok(await page.evaluate(() => document.getElementById("attrstyle-dialog").hidden) && JSON.stringify(byName(await colors())) === JSON.stringify(before), "Escape cancela igual");
ok(await page.evaluate(() => !document.getElementById("attr-dialog").hidden), "y la tabla sigue abierta debajo");

/* ---- Aceptar: queda como estilo normal ---- */
await page.click("#attr-style");
await page.waitForFunction(() => !document.getElementById("attrstyle-dialog").hidden);
const classes = (await ui()).classes;
await page.click("#as-accept");
await frame();
const accepted = byName(await colors());
ok(accepted.Z1 === `${classes[0][2]}/${classes[0][2]}` && accepted.Z2 === `${classes[1][2]}/${classes[1][2]}`, "Aceptar deja los colores: " + JSON.stringify(accepted));
const stored = await page.evaluate(() => attrState.rows.map(r => ({ n: r.name, st: r.rec && r.rec.style && r.rec.style.color, ms: r.rec && r.rec.mstyle && r.rec.mstyle.color })));
ok(stored.find(s => s.n === "Z1").st === classes[0][2] && stored.find(s => s.n === "P1").ms === classes[0][2], "y lo escribe en el registro de cada capa (estilo del trazo, color del marcador): " + JSON.stringify(stored.slice(0, 2)));
ok(await pending(), "sin desplegar la carpeta");
ok(await page.evaluate(() => attrState.rows.find(r => r.name === "P1").rec.mstyle.icon) === "circle", "el marcador, con el icono coloreable");

/* ---- deshacer ---- */
await page.evaluate(() => undoLast());
await page.waitForTimeout(200);
await page.evaluate(() => document.getElementById("attr-close").click());
await openTable();
await page.waitForFunction(() => !document.getElementById("attr-dialog").hidden);
const undone = byName(await colors());
ok(JSON.stringify(undone) === JSON.stringify(before), "Ctrl+Z devuelve toda la carpeta a su estilo original: " + JSON.stringify(undone));
await page.evaluate(() => redoLast());
await page.waitForTimeout(200);
await page.evaluate(() => document.getElementById("attr-close").click());

/* ---- sobrevive a guardar y recargar ---- */
await page.waitForTimeout(1500);
await page.reload();
await waitAppReady(page);
await openTable();
await page.waitForFunction(() => !document.getElementById("attr-dialog").hidden);
const reloaded = byName(await colors());
ok(reloaded.Z1 === accepted.Z1 && reloaded.Z2 === accepted.Z2 && reloaded.P1 === accepted.P1, "tras recargar siguen los colores (Z1, Z2 y el marcador P1): " + JSON.stringify(reloaded));
await page.evaluate(() => document.getElementById("attr-close").click());

/* ---- los estilos son normales: la fila lleva el color y se puede retocar ---- */
const row = await page.evaluate(async () => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Zonas");
  await ensureMaterialized(li);
  const z1 = [...nodeUl(li).children].find(x => x._name === "Z1");
  return { color: z1._style.color, swatch: z1.querySelector(".swatch").style.background };
});
ok(row.color === accepted.Z1.split("/")[0] && row.swatch !== "", "al desplegar, la capa lleva su estilo y su muestra de color: " + JSON.stringify(row));

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");
await ctx.close(); await browser.close();
srv.close();
done();
