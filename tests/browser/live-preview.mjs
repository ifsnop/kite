/* Diálogo de estilos: los cambios de tamaño, icono y color se ven en el
   mapa AL MOMENTO, «Cancelar» los revierte y «Aceptar» los deja. Antes
   el diálogo trabajaba solo sobre un borrador y no se veía el efecto
   hasta aceptar. Cubre marcador (tamaño, color por el popover, icono
   por su selector), polígono, y una selección mixta, donde cancelar
   debe devolver a CADA nodo su propio valor.                          */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER LIVE PREVIEW TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8857);
const { page, errors } = await openApp(browser, srv.url);
const frame = () => page.waitForTimeout(120); /* un fotograma de vista previa */

await page.evaluate(() => {
  const capa = L.marker([40.4, -3.7]).addTo(rootGroup);
  const ul = ensureRootUl();
  const mk = (n, lat, style) => {
    const c = L.marker([lat, -3.7]).addTo(rootGroup);
    const li = makeNode({ name: n, layer: c });
    li._mstyle = { ...DEFAULT_MARKER_STYLE, ...style };
    ul.appendChild(li);
    applyMarkerStyle(li);
    return li;
  };
  rootGroup.removeLayer(capa);
  window.__m = [mk("M1", 40.4, { icon: "star", size: 24, color: "#ff0000" }),
                mk("M2", 40.5, { icon: "airplane", size: 41, color: "#00ff00" })];
  const poly = L.geoJSON({ type: "Feature", properties: {}, geometry: { type: "Polygon",
    coordinates: [[[-3.7, 40.4], [-3.6, 40.4], [-3.6, 40.5], [-3.7, 40.4]]] } }).addTo(rootGroup);
  const st = { color: "#ff0000", weight: 2, fillColor: "#ff0000", fillOpacity: 0.3 };
  window.__p = makeNode({ name: "P", layer: poly, style: st });
  ul.appendChild(window.__p);
  applyPolygonStyle(window.__p);
  window.__tocar = (id, v) => {
    const el = document.getElementById(id);
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  window.__pathOpt = () => nodeLayer(__p).getLayers()[0].options;
});

/* ---------- Marcador: tamaño ---------- */
await page.evaluate(() => openStyleDialog(__m[0]));
await page.evaluate(() => __tocar("mk-size", "60"));
await frame();
ok(await page.evaluate(() => __m[0]._mstyle.size === 60 && nodeLayer(__m[0]).getIcon
  ? nodeLayer(__m[0]).getIcon().options.iconSize[1] >= 60 || nodeLayer(__m[0]).getIcon().options.iconSize[0] >= 60 : false),
  "el tamaño se aplica a la capa mientras el diálogo sigue abierto");
ok(await page.evaluate(() => posMarker.dragging.enabled()),
  "y el marcador sigue siendo arrastrable tras repintar su icono");
await page.click("#style-cancel");
ok(await page.evaluate(() => __m[0]._mstyle.size === 24),
  "Cancelar devuelve el tamaño original");

/* ---------- Marcador: color por el popover ---------- */
await page.evaluate(() => openStyleDialog(__m[0]));
await page.click("#mk-color");
await page.click("#color-swatches button:nth-child(3)");
await frame();
const colorVivo = await page.evaluate(() => __m[0]._mstyle.color);
ok(colorVivo !== "#ff0000", "el color de la muestra llega a la capa antes de aceptar: " + colorVivo);
await page.click("#color-cancel");
await frame();
ok(await page.evaluate(() => __m[0]._mstyle.color) === "#ff0000",
  "cancelar el popover devuelve el color");
await page.click("#mk-color");
await page.click("#color-swatches button:nth-child(3)");
await page.click("#color-accept");
await frame();
await page.click("#style-cancel");
ok(await page.evaluate(() => __m[0]._mstyle.color) === "#ff0000",
  "y cancelar el diálogo deshace un color ya aceptado en el popover");

/* ---------- Marcador: icono por su selector ---------- */
await page.evaluate(() => openStyleDialog(__m[0]));
await page.click("#icon-preview-btn");
const otro = await page.evaluate(() => {
  const b = [...document.querySelectorAll("#icon-grid .icon-opt")].find(x => x.title !== "star");
  b.click();
  return b.title;
});
await frame();
ok(await page.evaluate(() => __m[0]._mstyle.icon) === otro, "pulsar un icono lo aplica ya a la capa: " + otro);
await page.click("#icon-cancel");
await frame();
ok(await page.evaluate(() => __m[0]._mstyle.icon) === "star", "cancelar el selector devuelve el icono");
await page.click("#icon-preview-btn");
await page.evaluate(() => [...document.querySelectorAll("#icon-grid .icon-opt")].find(x => x.title !== "star").click());
await page.click("#icon-accept");
await frame();
await page.click("#style-accept");
ok(await page.evaluate(() => __m[0]._mstyle.icon) !== "star", "Aceptar deja el icono elegido");

/* ---------- Polígono ---------- */
await page.evaluate(() => openStyleDialog(__p));
await page.evaluate(() => __tocar("pg-weight", "9"));
await frame();
ok(await page.evaluate(() => __pathOpt().weight) === 9, "el grosor se ve en el trazo antes de aceptar");
await page.click("#style-cancel");
ok(await page.evaluate(() => __pathOpt().weight) === 2, "Cancelar devuelve el grosor");
await page.evaluate(() => openStyleDialog(__p));
await page.evaluate(() => __tocar("pg-weight", "7"));
await page.click("#style-accept");
ok(await page.evaluate(() => __pathOpt().weight) === 7 && (await page.evaluate(() => __p._style.weight)) === 7,
  "Aceptar lo deja");

/* ---------- Selección mixta: cancelar devuelve a CADA uno lo suyo ---------- */
await page.evaluate(() => {
  clearSelection();
  for (const n of __m) setSelected(n, true);
  setSelCursor(__m[0]);
  openStyleDialog(__m[0]);
  __m.push(__m.shift()); __m.push(__m.shift()); /* orden estable */
});
const antes = await page.evaluate(() => __m.map(m => ({ c: m._mstyle.color, s: m._mstyle.size })));
await page.click("#mk-color");
await page.click("#color-swatches button:nth-child(5)");
await frame();
const vivo = await page.evaluate(() => __m.map(m => m._mstyle.color));
ok(vivo[0] === vivo[1], "con una mezcla tocada, el color nuevo llega a todos en vivo: " + vivo);
await page.click("#color-cancel");
await frame();
const trasCancelarPopover = await page.evaluate(() => __m.map(m => m._mstyle.color));
ok(JSON.stringify(trasCancelarPopover) === JSON.stringify(antes.map(a => a.c)),
  "cancelar el popover devuelve a cada uno su color: " + trasCancelarPopover);
await page.click("#style-cancel");
ok(JSON.stringify(await page.evaluate(() => __m.map(m => m._mstyle.size))) === JSON.stringify(antes.map(a => a.s)),
  "y nada más cambió de tamaño");

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));
await browser.close();
srv.close();
done();
