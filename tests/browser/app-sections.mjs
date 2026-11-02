/* Las secciones que crea la aplicación (Marcadores, Elevaciones, Descargas,
   Mediciones…) van en azul pastel: el gris de un archivo es el mismo que toma
   una fila con el ratón encima y no se distinguían. Aquí, con el ratón de
   verdad y los colores calculados por el navegador:
   - la sección se distingue de un archivo importado y de una fila bajo el ratón,
     en claro y en oscuro;
   - sobrevive a recargar (se guarda como `sec`, el nombre no sirve: queda en el
     idioma del momento) y un árbol anterior, sin la marca, la recibe al usarla;
   - `sec` es entrada ajena: solo vale un `true` exacto y solo en un archivo.   */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER APP SECTIONS TESTS OK");

const browser = await launch();
const srv = await serve(READABLE, 8957);
const { ctx, page, errors } = await openApp(browser, srv.url);

/* Un archivo importado, y una sección de la aplicación con una capa dentro */
await page.evaluate(async () => {
  const geo = { type: "FeatureCollection", features: [
    { type: "Feature", properties: null, geometry: { type: "Point", coordinates: [-3.7, 40.4] } } ] };
  await handleDroppedFiles([new File([JSON.stringify(geo)], "uno.geojson")]);
  const ul = ensureNamedSection(tr("Marcadores"));
  const mk = L.marker([40, -3]).addTo(rootGroup);
  const li = makeNode({ name: "Pin", layer: mk, style: { color: "#1b5e97" } });
  ul.appendChild(li); ensureMarkerDefaults(li);
  ensureMeasureSection();
  await saveTree();
});

const fila = nombre => page.evaluate(n => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  const r = li.querySelector(":scope > .node-row");
  const b = r.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, bg: getComputedStyle(r).backgroundColor,
           cls: li.className, sec: !!li._appSection };
}, nombre);
const rgb = c => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
const azul = c => { const [r, g, b] = rgb(c); return b > r + 8 && b >= g; };

async function comprobar(etiqueta) {
  const sec = await fila("Marcadores"), med = await fila("Mediciones"), arch = await fila("uno.geojson");
  await page.evaluate(() => {
    const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Marcadores");
    li.classList.remove("collapsed"); syncExpanded(li);
  });
  const pin = await fila("Pin");
  await page.mouse.move(pin.x, pin.y);
  const hover = await page.evaluate(() => getComputedStyle(
    [...document.querySelectorAll("#tree li")].find(x => x._name === "Pin").querySelector(":scope > .node-row")).backgroundColor);
  ok(sec.sec && /app-section/.test(sec.cls), `${etiqueta}: «Marcadores» es una sección de la aplicación`);
  ok(med.sec, `${etiqueta}: «Mediciones» también`);
  ok(!arch.sec && !/app-section/.test(arch.cls), `${etiqueta}: un archivo importado no lo es`);
  ok(sec.bg !== arch.bg, `${etiqueta}: la sección (${sec.bg}) no es del color de un archivo (${arch.bg})`);
  ok(sec.bg !== hover, `${etiqueta}: ni del de una fila con el ratón encima (${hover})`);
  ok(azul(sec.bg), `${etiqueta}: es azulada: ${sec.bg}`);
  ok(med.bg === sec.bg, `${etiqueta}: «Mediciones» tiene el mismo color`);
  return sec.bg;
}

const claro = await comprobar("claro");
await page.evaluate(() => applyUiTheme("dark"));
const oscuro = await comprobar("oscuro");
ok(claro !== oscuro, `el tema oscuro tiene su propio azul: ${claro} → ${oscuro}`);
await page.evaluate(() => applyUiTheme("auto"));

/* Lo guardado: `sec` solo en la sección, no en el archivo importado */
const guardado = await page.evaluate(() => serializeTree().map(n => ({ name: n.name, sec: n.sec })));
ok(guardado.find(n => n.name === "Marcadores").sec === true, "se guarda como sec: true");
ok(guardado.find(n => n.name === "uno.geojson").sec === undefined, "el archivo importado no lleva sec");

/* Recargar: sigue siendo de la aplicación */
await page.reload();
await waitAppReady(page);
const tras = await fila("Marcadores");
ok(tras.sec && azul(tras.bg), "tras recargar sigue en azul: " + tras.bg);
ok(!(await fila("uno.geojson")).sec, "y el archivo importado, no");

/* Un árbol anterior (sin la marca): la recibe al usar la sección */
const vieja = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Marcadores");
  li._appSection = false; li.classList.remove("app-section");
  ensureNamedSection(tr("Marcadores"));
  return { sec: li._appSection, cls: li.classList.contains("app-section") };
});
ok(vieja.sec && vieja.cls, "una sección sin marca la recibe al usarla");

/* Entrada ajena: solo `true` exacto y solo en un archivo */
const ajena = await page.evaluate(async () => {
  const r = await buildRecordsFromStorage([
    { t: "file", name: "a", checked: true, sec: true, children: [] },
    { t: "file", name: "b", checked: true, sec: "yes", children: [] },
    { t: "file", name: "c", checked: true, sec: 1, children: [] },
    { t: "folder", name: "d", checked: true, sec: true, children: [] }
  ]);
  return r.map(x => x.sec === true);
});
ok(JSON.stringify(ajena) === "[true,false,false,false]", "sec: solo true exacto y solo en un archivo: " + JSON.stringify(ajena));

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");

await ctx.close(); await browser.close();
srv.close();
done();
