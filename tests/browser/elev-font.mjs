/* El tamaño de las cifras de las celdas de elevación (A− / A+ encima de la
   escala) y la regla de que unas cifras que no caben en su celda se sustituyen
   por el relleno de aviso del zoom 18 (rojo si el MDS supera al MDT, blanco si
   no). Con una cuadrícula SINTÉTICA (celdas de 5 m con sus valores a mano) para
   que cada medida sea exacta, sin servicios.

   1) A− / A+ solo se ven con una cuadrícula en el mapa; se esconden al apagar
      la capa o borrarla; llevan su título; en los extremos, deshabilitados.
   2) Con el tamaño de partida, a zoom 20 las cifras caben y se ven; las cajas
      de las cifras medidas en el navegador caben dentro de su celda (lo que
      dice elevCellBand es lo que pinta el DOM).
   3) A+ las agranda hasta que ya no caben: entonces ninguna cifra, y el relleno
      de las celdas con diferencia > 1 m en rojo y el resto en blanco; A− las
      devuelve.
   4) A zoom 19 las celdas de 5 m (22 px) tampoco acogen ni la diferencia: relleno
      de aviso, como a zoom 18; a zoom 21, cifras de nuevo.
   5) El tamaño se guarda: tras recargar sigue el escalón elegido.
   6) El PNG del visor no incluye los botones.                                  */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER ELEVATION FONT TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8964);
const { ctx, page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

const LAT = 40.4168, LNG = -3.7038;
/* 4×4 celdas de 5 m: la mitad con el MDS 5,2 m por encima del MDT (aviso) y la otra con 0,3 m */
await page.evaluate(([lat, lng]) => {
  setAltitudeUnit("m");
  const dLat = 5 / 111195, dLng = dLat / Math.cos(lat * Math.PI / 180), cells = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const sw = [lat + r * dLat, lng + c * dLng], ne = [sw[0] + dLat, sw[1] + dLng];
    const alert = (r + c) % 2 === 0, mdt = 610.2, mds = alert ? 615.4 : 610.5;
    cells.push({ sw, ne, center: [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2], mdt, mds, diff: +(mds - mdt).toFixed(1) });
  }
  window.__cells = cells;
  map.setView([lat + 2 * dLat, lng + 2 * dLng], 20, { animate: false });
}, [LAT, LNG]);

const bar = () => page.evaluate(() => { const b = document.querySelector(".elev-font-bar"); return b && {
  hidden: b.hidden, shown: b.offsetWidth > 0,
  minus: b.querySelector(".ef-minus").classList.contains("disabled"), plus: b.querySelector(".ef-plus").classList.contains("disabled"),
  titles: [...b.querySelectorAll("a")].map(a => a.title), text: [...b.querySelectorAll("a")].map(a => a.textContent),
  step: elevFontStep }; });
const labels = () => page.evaluate(() => [...document.querySelectorAll(".elev-cell")].length);
const fills = () => page.evaluate(() => { const out = {}; for (const g of elevGridGroups) for (const r of g._rects) out[r.options.fillColor] = (out[r.options.fillColor] || 0) + 1; return out; });
const settle = () => page.evaluate(() => new Promise(r => setTimeout(r, 250)));

/* ---------- 1. Solo con una cuadrícula en el mapa ---------- */
let b = await bar();
ok(b && b.hidden && !b.shown, "sin cuadrículas, A− / A+ no se ven: " + JSON.stringify(b));
await page.evaluate(() => { ensureRootUl().appendChild(makeElevGridNode("Prueba", window.__cells)); syncElevLabels(); });
await settle();
b = await bar();
ok(!b.hidden && b.shown && b.text.join() === "A−,A+", "con una cuadrícula en el mapa, sí: " + JSON.stringify(b.text));
ok(/Reducir/.test(b.titles[0]) && /Aumentar/.test(b.titles[1]), "con su título: " + JSON.stringify(b.titles));
const pos = await page.evaluate(() => { const r = document.querySelector(".elev-font-bar").getBoundingClientRect(), s = document.querySelector(".leaflet-control-scale").getBoundingClientRect();
  return { barBottom: r.bottom, scaleTop: s.top, barRight: r.right, scaleRight: s.right }; });
ok(pos.barBottom <= pos.scaleTop + 1, "encima de la escala: " + JSON.stringify(pos));
ok(b.step === 2 && !b.minus && !b.plus, "tamaño de partida, con margen para los dos lados");

/* ---------- 2. Zoom 20, tamaño de partida: las cifras caben ---------- */
ok(await labels() === 16, "16 celdas, 16 cifras: " + await labels());
const fits = await page.evaluate(() => {
  const out = [];
  for (const g of elevGridGroups) for (const r of g._rects) {
    if (!r._label) continue;
    const el = r._label.getElement().querySelector("span"), sp = el.getBoundingClientRect();
    const px = elevCellPx(r._cell, map.getZoom());
    out.push({ w: sp.width, h: sp.height, cw: px.w, ch: px.h });
  }
  return out;
});
ok(fits.length === 16 && fits.every(f => f.w <= f.cw + 0.5 && f.h <= f.ch + 0.5),
  "el texto medido en el navegador cabe en cada celda: " + JSON.stringify(fits[0]));
let f = await fills();
ok(!f["#ff8a80"], "con cifras, el relleno es el blanco de siempre: " + JSON.stringify(f));

/* ---------- 3. A+ hasta que no caben ---------- */
await page.click(".elev-font-bar .ef-plus"); await settle();
b = await bar();
ok(b.step === 3 && await labels() === 16, "un escalón más (×1,2): todavía caben, step " + b.step + ", " + await labels() + " cifras");
const fs3 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".elev-cell > span")).fontSize));
ok(fs3 === 12, "y las cifras son de 12 px: " + fs3);
await page.click(".elev-font-bar .ef-plus"); await settle();
b = await bar();
ok(b.step === 4 && await labels() === 0, "otro más (×1,45): ya no caben en 44 px y desaparecen: " + await labels());
f = await fills();
ok(f["#ff8a80"] === 8 && f["#ffffff"] === 8, "y se pinta el aviso del zoom 18: 8 en rojo (diferencia > 1 m) y 8 en blanco: " + JSON.stringify(f));
await page.click(".elev-font-bar .ef-minus"); await settle();
ok((await bar()).step === 3 && await labels() === 16, "A− devuelve las cifras");
f = await fills();
ok(!f["#ff8a80"] && f["#ffffff"] === 16, "y el relleno de siempre: " + JSON.stringify(f));

/* ---------- 4. Otros zooms ---------- */
await page.evaluate(() => map.setZoom(19, { animate: false })); await settle();
ok(await labels() === 0, "a zoom 19, la celda de 5 m (22 px) no acoge ni la diferencia: ninguna cifra");
f = await fills();
ok(f["#ff8a80"] === 8, "y se pinta como a zoom 18: " + JSON.stringify(f));
await page.evaluate(() => { map.setZoom(21, { animate: false }); }); await settle();
ok(await labels() > 0, "a zoom 21, cifras de nuevo: " + await labels());
await page.evaluate(() => map.setZoom(20, { animate: false })); await settle();

/* ---------- Extremos ---------- */
for (let i = 0; i < 10; i++) await page.click(".elev-font-bar .ef-plus");
b = await bar();
ok(b.plus && !b.minus && b.step === 7, "en el máximo, A+ queda deshabilitado: " + JSON.stringify(b));
for (let i = 0; i < 10; i++) await page.click(".elev-font-bar .ef-minus");
b = await bar();
ok(b.minus && !b.plus && b.step === 0, "y en el mínimo, A−: " + JSON.stringify(b));

/* ---------- Tras el clic, el botón no se queda «pulsado» ----------
   `.leaflet-bar a:focus` pinta el fondo oscuro del hover: si el botón conserva el foco
   tras el clic (y el ratón ya se ha ido), se queda oscuro. El foco vuelve al visor.   */
await page.click(".elev-font-bar .ef-plus");
await page.mouse.move(700, 300);
const after = await page.evaluate(() => {
  const a = document.querySelector(".elev-font-bar .ef-plus");
  return { focusOnButton: document.activeElement === a, focusOnMap: document.activeElement === map.getContainer(),
    bg: getComputedStyle(a).backgroundColor, surface: (() => { const t = document.createElement("div");
      t.style.backgroundColor = "var(--surface)"; document.body.appendChild(t);
      const c = getComputedStyle(t).backgroundColor; t.remove(); return c; })() };
});
ok(!after.focusOnButton && after.focusOnMap, "el foco vuelve al visor: " + JSON.stringify(after));
ok(after.bg === after.surface, "y el botón recupera su color claro, no el del hover: " + JSON.stringify(after));

/* ---------- 5. Se guarda ---------- */
/* (el bloque anterior ya dejó el escalón 1) */
await page.click(".elev-font-bar .ef-plus"); /* escalón 2 */
await page.click(".elev-font-bar .ef-plus"); /* escalón 3 */
await page.waitForTimeout(400);
await page.reload();
await waitAppReady(page);
ok(await page.evaluate(() => elevFontStep) === 3, "tras recargar sigue el escalón elegido: " + await page.evaluate(() => elevFontStep));
ok(await page.evaluate(() => dbLoadElevFont()) === 3, "guardado en IndexedDB (clave elevFont)");
/* un valor ajeno o viejo no vale */
const val = await page.evaluate(() => [validElevFont({ v: 1, step: 99 }), validElevFont({ v: 1, step: -1 }), validElevFont({ v: 1, step: 1.5 }),
  validElevFont({ v: 2, step: 1 }), validElevFont(null), validElevFont({ v: 1, step: 4 })]);
ok(JSON.stringify(val) === "[null,null,null,null,null,4]", "validación de lo leído: " + JSON.stringify(val));

/* ---------- 1b. Se esconden con la capa apagada o borrada ---------- */
await page.evaluate(([lat, lng]) => {
  const dLat = 5 / 111195, dLng = dLat / Math.cos(lat * Math.PI / 180), cells = [];
  const sw = [lat, lng], ne = [lat + dLat, lng + dLng];
  cells.push({ sw, ne, center: [lat + dLat / 2, lng + dLng / 2], mdt: 1, mds: 2, diff: 1 });
  window.__li = ensureRootUl().appendChild(makeElevGridNode("Otra", cells));
  map.setView([lat, lng], 20, { animate: false });
}, [LAT, LNG]);
await settle();
ok(!(await bar()).hidden, "tras recargar y crear otra cuadrícula, se ven");
await page.evaluate(() => { const c = nodeCheckbox(window.__li); c.checked = false; c.dispatchEvent(new Event("change", { bubbles: true })); });
await settle();
ok((await bar()).hidden, "al apagar la única capa visible, se esconden");
await page.evaluate(() => { const c = nodeCheckbox(window.__li); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); });
await settle();
ok(!(await bar()).hidden, "al encenderla, vuelven");
await page.evaluate(() => deleteNode(window.__li));
await settle();
ok((await bar()).hidden, "y al borrarla, se esconden");

/* ---------- 6. Fuera del PNG ---------- */
ok(await page.evaluate(() => HIDE_FOR_PNG.includes(".elev-font-bar")), "el PNG del visor no lleva A− / A+");

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");
await ctx.close(); await browser.close();
srv.close();
done();
