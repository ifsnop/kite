/* Perfil de una ruta, de punta a punta en el navegador, con el MDT y el
   MDS del IGN servidos FALSOS por page.route: una rejilla ASCII de
   celdas de ~5 m que cubre exactamente cada recorte pedido, con alturas
   que dependen de la posición (cada curva tiene forma, y la del MDS va
   por encima de la del MDT).

   1) «Obtener perfil» existe en una ruta y no en un círculo;
      deshabilitado (con su motivo) sin fuentes y con la ruta más larga
      que el límite. El botón del diálogo de la ruta, igual.
   2) La descarga va por TROZOS, de las dos fuentes (unas pocas
      peticiones, no cientos), la barra llega al 100 % y el botón pasa
      de «Cancelar» a «Cerrar».
   3) La gráfica: dos curvas, MDT azul y MDS verde, con su leyenda;
      distancia en la unidad de distancia, altura en la de altitud; una
      cifra en NEGRITA por vértice; cambiar una unidad la redibuja.
   4) En el árbol, «Perfil de «Ruta 1» — MDT05 + MDS (IGN)» en la raíz
      «Perfiles de ruta», solo con las celdas RECORRIDAS.
   5) El clic derecho REAL sobre la ruta, con su perfil debajo (dos
      capas bajo el cursor), ofrece «Mostrar perfil»: era el fallo.
   6) Mostrar: ni peticiones ni capa nueva, desde el botón y desde el
      menú; también tras recargar la página. Mover un vértice vuelve a
      «Obtener perfil».
   7) La flecha del mapa sigue al cursor de la gráfica (ratón real): en
      un vértice, sobre ese waypoint; a mitad de tramo, sobre la línea;
      al salir de la gráfica o cerrar, desaparece. La rueda acerca con
      el punto bajo el ratón fijo, hasta 0,1 m por píxel, y aleja hasta
      la ruta entera; la altura se ajusta a lo visible; arrastrar
      desplaza sin cambiar el zoom y se para en los extremos. Zoom de
      altura (rueda sobre el eje, Mayús+rueda, botones), que bloquea el
      eje Y; bloqueado, la distancia se mueve sin tocar la altura y
      arrastrar en vertical la desplaza; «Ver todo». Las series son
      solo segmentos rectos entre valores de celda.
   8) Deshacer quita el perfil; con el MDT en «Ninguna», una sola curva
      y celdas sin MDT; un trozo que falla deja un hueco; cancelar a
      mitad no deja nada.
   9) Con el simulador haciendo lo que el servicio real (rejilla con
      origen en la esquina pedida, `scaleSize` respetado): las celdas de
      una consulta puntual y las del perfil coinciden al centímetro, y
      todas las del perfil caen en una sola malla.
  10) Un servicio que rechaza `scaleSize`: se prueba una vez y el
      perfil sale igual sin él.                                       */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";
import { ignFakes, IGN_ROUTE } from "./_fakes.mjs";

const { ok, done } = reporter("BROWSER ROUTE PROFILE TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8946);
const { page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

/* ---------- MDT y MDS falsos (tests/browser/_fakes.mjs) ---------- */
const fake = ignFakes();
const seen = fake.seen;
await page.route(IGN_ROUTE, fake.handler);
const coverages = () => seen.filter(s => s.request === "GetCoverage");

/* Ruta de dos tramos en Madrid: ~1,2 km al este y ~0,9 km al norte */
const WAYPOINTS = [{ lat: 40.4168, lng: -3.7038 }, { lat: 40.4168, lng: -3.69 }, { lat: 40.425, lng: -3.69 }];
const route = await page.evaluate(async wps => {
  setMeasureUnit("km");
  setAltitudeUnit("m");
  elevSources = { mdt: "ign-mdt05", mds: "ign-mds" };
  const m = buildRouteMeasurement(wps);
  finalizeRouteMeasurement(m);
  const c = buildMeasurement("circle", L.latLng(40.41, -3.70), L.latLng(40.411, -3.70));
  finalizeMeasurement(c);
  map.fitBounds(m.group.getBounds(), { animate: false });
  return { total: m.totalDist, legs: m.legs.map(l => l.dist) };
}, WAYPOINTS);

/* Lo que ofrece el clic derecho DE VERDAD en un punto de la ruta: el
   hit-testing real (todas las capas bajo el cursor) y el menú que sale. */
const RIGHT_CLICK_AT = { lat: 40.4168, lng: -3.697 };
const menuAt = () => page.evaluate(at => {
  const ll = L.latLng(at.lat, at.lng);
  const hits = layersAtPoint(ll, map.latLngToContainerPoint(ll));
  const items = ctxItemsFor(hits);
  return { hits: hits.map(h => h._name), labels: items.map(i => i.label).filter(Boolean),
           profile: (items.find(i => /perfil/.test(i.label || "")) || {}).label };
}, RIGHT_CLICK_AT);

/* ---------- 1. Dónde está la opción, y cuándo no ---------- */
const where = await page.evaluate(() => {
  const lis = [...document.querySelectorAll("#tree li")].filter(x => x._measure);
  const route = lis.find(x => x._measure.type === "route"), circle = lis.find(x => x._measure.type === "circle");
  const item = li => layerCtxItems(li).find(i => /perfil/.test(i.label));
  const r = { route: item(route) && item(route).label, circle: !!item(circle), enabled: item(route).disabled() };
  elevSources = { mdt: null, mds: null };
  r.noSources = item(route).disabled();
  elevSources = { mdt: "ign-mdt05", mds: null };
  r.onlyMdt = item(route).disabled();
  elevSources = { mdt: "ign-mdt05", mds: "ign-mds" };
  const keep = profileMaxM;
  profileMaxM = 1000;
  r.tooLong = item(route).disabled();
  /* El límite es para mallas finas: con el MDT200 como única fuente no cuenta */
  elevSources = { mdt: "ign-mdt200", mds: null };
  r.coarseOnly = item(route).disabled();
  elevSources = { mdt: "ign-mdt200", mds: "ign-mds" };
  r.coarseWithMds = item(route).disabled();
  elevSources = { mdt: "ign-mdt05", mds: "ign-mds" };
  openStyleDialog(route);
  r.btnTooLong = { hidden: document.getElementById("ms-profile-row").hidden,
                   disabled: document.getElementById("ms-profile").disabled,
                   text: document.getElementById("ms-profile").textContent,
                   title: document.getElementById("ms-profile").title };
  document.getElementById("style-cancel").click();
  profileMaxM = keep;
  openStyleDialog(circle);
  r.btnCircle = document.getElementById("ms-profile-row").hidden;
  document.getElementById("style-cancel").click();
  return r;
});
ok(where.route === "Obtener perfil" && !where.circle, "«Obtener perfil» en una ruta y no en un círculo: " + JSON.stringify(where));
ok(where.enabled === false && where.onlyMdt === false, "habilitado con fuentes (basta una) y ruta corta");
ok(/Sin fuentes de elevación/.test(where.noSources), "sin ninguna fuente, deshabilitado con el motivo: " + where.noSources);
ok(/límite de un perfil con las fuentes elegidas es 1\.00 km/.test(where.tooLong), "ruta más larga que el límite: " + where.tooLong);
ok(!where.btnTooLong.hidden && where.btnTooLong.disabled && where.btnTooLong.text === "Obtener perfil"
  && /límite/.test(where.btnTooLong.title), "el botón del diálogo de la ruta, igual: " + JSON.stringify(where.btnTooLong));
ok(where.btnCircle, "y en el diálogo de un círculo no aparece");
ok(where.coarseOnly === false, "MDT200 como única fuente: el límite no cuenta: " + where.coarseOnly);
ok(/límite/.test(where.coarseWithMds), "MDT200 + MDS de 5 m: el límite sigue contando: " + where.coarseWithMds);

/* El campo del límite: 150 NM (por encima de 100) se queda en 100 y avisa,
   no vuelve en silencio al valor anterior (fallo reportado). */
const limitField = await page.evaluate(() => {
  const keep = { unit: measureUnit, max: profileMaxM };
  setMeasureUnit("nm");
  const inp = document.getElementById("props-profile-max");
  const out = {};
  const type = v => { inp.value = v; inp.dispatchEvent(new Event("change")); };
  document.getElementById("nav-msg").textContent = "";
  type("150");
  out.high = { shown: inp.value, m: profileMaxM, max: inp.max, min: inp.min,
               msg: document.getElementById("nav-msg").textContent };
  type("0.001");
  out.low = { m: profileMaxM };
  type("25");
  out.ok = { m: profileMaxM, shown: inp.value };
  type("");
  out.empty = { m: profileMaxM };
  type("abc");
  out.junk = { m: profileMaxM };
  setMeasureUnit(keep.unit);
  profileMaxM = keep.max;
  return out;
});
ok(limitField.high.m === 100 * 1852 && limitField.high.shown === "100" && /va de .* a 100 NM.*se queda en 100 NM/.test(limitField.high.msg),
  "150 NM se queda en 100 NM y lo dice: " + JSON.stringify(limitField.high));
ok(limitField.high.max === "100" && Number(limitField.high.min) > 0, "el campo lleva sus cotas en la unidad vigente: " + JSON.stringify(limitField.high));
ok(Math.abs(limitField.low.m - 100) < 1e-6, "por debajo del mínimo, se queda en el mínimo (100 m)");
ok(limitField.ok.m === 25 * 1852 && limitField.ok.shown === "25", "un valor válido se guarda tal cual");
ok(limitField.empty.m === 25 * 1852 && limitField.junk.m === 25 * 1852, "vacío o ilegible: vuelve el vigente");
const menu0 = await menuAt();
ok(menu0.hits.join() === "Ruta 1" && menu0.profile === "Obtener perfil",
  "clic derecho sobre la ruta sola: «Obtener perfil»: " + JSON.stringify(menu0));

/* ---------- 2. Descarga por trozos, de las dos fuentes ---------- */
const routeLi = "[...document.querySelectorAll('#tree li')].find(x => x._measure && x._measure.type === 'route')";
async function runProfile() {
  return page.evaluate(async sel => {
    demTimes.length = 0;
    const li = eval(sel);
    openStyleDialog(li);
    const steps = [];
    const label = document.getElementById("profile-progress-label");
    const obs = new MutationObserver(() => steps.push(label.textContent));
    obs.observe(label, { childList: true, characterData: true, subtree: true });
    document.getElementById("ms-profile").click();
    document.getElementById("style-cancel").click();
    const t0 = performance.now();
    /* Mientras descarga: alto de la ventana y si el registro ya scrollea */
    const box = document.querySelector("#profile-dialog .dlg-box"), logEl = document.getElementById("profile-log");
    const heights = [], chartShown = [];
    let logScrolls = false;
    while (performance.now() - t0 < 20000 && document.getElementById("profile-close").title !== "Cerrar") {
      heights.push(Math.round(box.getBoundingClientRect().height));
      chartShown.push(!profileChart.hidden);
      if (logEl.scrollHeight > logEl.clientHeight + 1) logScrolls = true;
      await new Promise(r => setTimeout(r, 30));
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    obs.disconnect();
    return {
      steps, button: document.getElementById("profile-close").title,
      heights: [Math.min(...heights), Math.max(...heights)], chartShown: chartShown.some(Boolean), logScrolls,
      log: [...logEl.children].map(e => `${e.className}|${e.textContent}`), chartAfter: !profileChart.hidden,
      progressHidden: document.getElementById("profile-progress").hidden,
      note: document.getElementById("profile-note").hidden ? "" : document.getElementById("profile-note").textContent
    };
  }, routeLi);
}
const before = coverages().length;
const run1 = await runProfile();
const asked = coverages().slice(before);
ok(asked.length >= 4 && asked.length <= 8, "por trozos: unas pocas peticiones para ~2 km, no cientos: " + asked.length);
ok(asked.some(s => s.host === "servicios.idee.es") && asked.some(s => s.host === "wcs-mds.idee.es"),
  "pide al MDT y al MDS");
ok(run1.steps.some(t => /^Descargando celdas MDT y MDS: \d+ % \(1 de \d+ zonas?\)$/.test(t))
  && run1.steps.some(t => /100 %/.test(t)), "la barra cuenta las zonas de las dos y llega al 100 %: " + JSON.stringify(run1.steps));
ok(run1.button === "Cerrar" && run1.progressHidden && !run1.note, "al terminar, «Cerrar» y sin avisos: " + JSON.stringify({ ...run1, log: run1.log.length }));
/* Registro de depuración: qué pide la aplicación y qué le llega */
{
  const L = run1.log;
  const gets = L.filter(l => /^pl-req\|.*→ GetCoverage, intento 1: https:\/\/.*scaleSize=/.test(l));
  const oks = L.filter(l => /^pl-res\|.*← HTTP 200 · .* · [\d.]+ (B|kB) · \d+ ms$/.test(l));
  const grids = L.filter(l => /^pl-info\|.*rejilla de \d+ × \d+ celdas de [\d.]+ · \d+ sin dato · alturas [\d.]+–[\d.]+ m$/.test(l));
  ok(gets.length === asked.length, `una línea por cada GetCoverage lanzado, con la dirección entera: ${gets.length} de ${asked.length}`);
  ok(oks.length >= asked.length && grids.length === asked.length, `y lo recibido: estado, tipo, tamaño, tiempo y la rejilla leída: ${oks.length}, ${grids.length}`);
  ok(L.some(l => /^pl-head\|.*MDT05 \(IGN\) · zona 1 de \d+: lat /.test(l)) && L.some(l => /^pl-head\|.*MDS \(IGN\) · zona 1 de/.test(l)),
    "cada zona, con su fuente y su caja: " + L.filter(l => /^pl-head/.test(l)).slice(0, 4).join(" / "));
  ok(L.some(l => /GetCapabilities, intento 1/.test(l) || /descubrimiento ya hecho/.test(l)), "y el descubrimiento de cada fuente");
  ok(run1.heights[1] - run1.heights[0] <= 1 && run1.logScrolls,
    "la ventana no crece con el registro, que scrollea por su cuenta: " + JSON.stringify(run1.heights));
  ok(!run1.chartShown && run1.chartAfter, "descargando, el sitio es del registro; al terminar, de la gráfica");
}

/* ---------- 3. La gráfica ---------- */
const readChart = () => page.evaluate(() => {
  const svg = document.querySelector("#profile-chart svg");
  const t = cls => [...svg.querySelectorAll("text." + cls.split(" ").join("."))];
  const stroke = sel => [...svg.querySelectorAll(sel)].map(x => getComputedStyle(x).stroke);
  return {
    bold: t("pf-tick vertex").map(x => ({ txt: x.textContent, w: getComputedStyle(x).fontWeight })),
    vlines: svg.querySelectorAll("line.pf-vertex").length,
    mdt: stroke("polyline.pf-line.mdt"), mds: stroke("polyline.pf-line.mds"),
    legend: t("pf-legend-label").map(x => x.textContent),
    labels: t("pf-tick").map(x => x.textContent).filter(x => /\(\w+\)$/.test(x) && !/IGN/.test(x)),
    series: profileData.series.map(s => ({ kind: s.kind, withData: s.points.filter(p => p.v !== null).length })),
    vertices: profileData.vertices
  };
});
const chart = await readChart();
const km = d => (d / 1000).toFixed(2);
ok(chart.vlines === 3 && chart.bold.map(b => b.txt).join() === [0, route.legs[0], route.total].map(km).join(),
  "una cifra por vértice (inicio, quiebro, final), en km: " + JSON.stringify(chart.bold));
ok(chart.bold.every(b => Number(b.w) >= 700), "en negrita: " + chart.bold.map(b => b.w));
ok(Math.abs(chart.vertices[1] - route.legs[0]) < 1e-6, "el quiebro, exactamente en la distancia del primer tramo");
ok(chart.mdt.length === 1 && chart.mdt[0] === "rgb(21, 101, 192)", "curva del MDT, en azul: " + chart.mdt);
ok(chart.mds.length === 1 && chart.mds[0] === "rgb(46, 125, 50)", "curva del MDS, en verde: " + chart.mds);
ok(chart.legend.join() === "MDT05 (IGN),MDS (IGN)", "leyenda con cada fuente: " + chart.legend);
ok(chart.labels.includes("Distancia desde el inicio (km)") && chart.labels.includes("Altura (m)"),
  "ejes con sus unidades: " + JSON.stringify(chart.labels));
ok(chart.series.every(s => s.withData > 350 && s.withData < 480),
  "un punto por celda de ~5 m recorrida (~2,1 km), en cada serie: " + JSON.stringify(chart.series));
const redraw = await page.evaluate(() => {
  setMeasureUnit("nm");
  setAltitudeUnit("ft");
  const svg = document.querySelector("#profile-chart svg");
  const r = [...svg.querySelectorAll("text.pf-tick")].map(x => x.textContent).filter(x => /\(/.test(x));
  setMeasureUnit("km");
  setAltitudeUnit("m");
  return r;
});
ok(redraw.includes("Distancia desde el inicio (NM)") && redraw.includes("Altura (ft)"),
  "cambiar las unidades la redibuja: " + JSON.stringify(redraw));
/* Regla de los diálogos de un solo botón: el × arriba a la derecha y,
   sin pie, la gráfica hasta abajo */
const layout = await page.evaluate(() => {
  const box = profileBox.getBoundingClientRect(), x = document.getElementById("profile-close");
  const b = x.getBoundingClientRect(), chart = document.getElementById("profile-foot").getBoundingClientRect();
  return { inHead: x.parentElement === profileBox.querySelector("h2"), right: Math.round(box.right - b.right),
           top: Math.round(b.top - box.top), footer: !!profileBox.querySelector(".dlg-actions"),
           gap: Math.round(box.bottom - chart.bottom),
           name: document.getElementById(profileBox.getAttribute("aria-labelledby")).textContent,
           title: document.getElementById("profile-title").textContent };
});
ok(layout.inHead && layout.right < 16 && layout.top < 16, "el × de cerrar, arriba a la derecha en la cabecera: " + JSON.stringify(layout));
ok(!layout.footer && layout.gap < 12, "sin pie de botones (.dlg-actions): lo último, los controles de la gráfica, llega hasta abajo de la ventana: " + JSON.stringify(layout));
ok(layout.name === layout.title, "la ventana se llama por su título, sin el «Cerrar» del ×: " + layout.name);

/* ---------- 4. En el árbol: raíz «Perfiles de ruta» ---------- */
await page.waitForFunction(() => [...document.querySelectorAll("#tree li")].some(li => /^Perfil de/.test(li._name || "")));
const treeOf = () => page.evaluate(() => {
  const sec = [...document.querySelectorAll("#tree > ul > li")].find(li => li._name === "Perfiles de ruta");
  if (!sec) return null;
  const nodes = [...nodeUl(sec).children];
  const n = nodes[0];
  return { count: nodes.length, name: n._name, cells: n._elevGrid.cells.length,
           keys: Object.keys(n._elevGrid.cells[0]).sort().join(),
           diff: n._elevGrid.cells.every(c => Math.abs(c.diff - 10) < 0.02),
           profile: !!n._elevGrid.profile,
           elevaciones: [...document.querySelectorAll("#tree li")].some(li => li._name === "Elevaciones") };
});
const tree = await treeOf();
ok(tree && tree.count === 1 && tree.name === "Perfil de «Ruta 1» — MDT05 + MDS (IGN)" && !tree.elevaciones,
  "nodo del perfil en la raíz «Perfiles de ruta», no en «Elevaciones»: " + JSON.stringify(tree));
ok(tree.cells >= Math.min(...chart.series.map(s => s.withData)) && tree.cells <= Math.max(...chart.series.map(s => s.withData)),
  `solo las celdas recorridas (${tree.cells}), no todo lo descargado`);
ok(tree.keys === "center,diff,mds,mdt,ne,sw" && tree.diff, "celdas con MDT, MDS y su diferencia: " + tree.keys);
ok(tree.profile, "y la capa guarda las curvas");

/* ---------- 5. El clic derecho real, con el perfil debajo ---------- */
const menu1 = await menuAt();
ok(menu1.hits.length === 2 && menu1.profile === "Mostrar perfil",
  "ruta y perfil bajo el cursor: el menú sigue ofreciendo el perfil, ya «Mostrar»: " + JSON.stringify(menu1));

/* ---------- 6. Mostrar: sin red, sin capa nueva ---------- */
await page.click("#profile-close"); /* ratón real: el × vive en el asa de arrastre */
ok(await page.evaluate(() => profileDialog.hidden && !profileBox.style.left),
  "pulsar el × cierra la ventana, sin empezar a arrastrarla");
const n0 = coverages().length + seen.length;
const shown = await page.evaluate(async sel => {
  const li = eval(sel);
  openStyleDialog(li);
  const btn = document.getElementById("ms-profile");
  const r = { text: btn.textContent, disabled: btn.disabled };
  btn.click();
  document.getElementById("style-cancel").click();
  await new Promise(r2 => requestAnimationFrame(() => requestAnimationFrame(r2)));
  r.lines = document.querySelectorAll("#profile-chart polyline.pf-line").length;
  r.close = document.getElementById("profile-close").title;
  closeProfileDialog();
  ctxItemsFor([li]).find(i => i.label === "Mostrar perfil").action();
  await new Promise(r2 => requestAnimationFrame(() => requestAnimationFrame(r2)));
  r.menuLines = document.querySelectorAll("#profile-chart polyline.pf-line").length;
  return r;
}, routeLi);
ok(shown.text === "Mostrar perfil" && !shown.disabled, "el botón pasa a «Mostrar perfil»: " + JSON.stringify(shown));
ok(shown.lines >= 2 && shown.close === "Cerrar" && shown.menuLines >= 2, "y enseña la gráfica: " + JSON.stringify(shown));
ok(coverages().length + seen.length === n0, "sin ninguna petición");
ok((await treeOf()).count === 1, "ni capa nueva");

/* ---------- 7. La flecha del mapa sigue al cursor (ratón real) ---------- */
const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
/* Píxel de pantalla de una distancia con la vista actual de la gráfica */
const chartGeom = () => page.evaluate(() => {
  const r = profileChart.getBoundingClientRect();
  return { left: r.left, top: r.top, height: r.height, pw: profileChart.clientWidth - PF_MARGIN.l - PF_MARGIN.r,
           l: PF_MARGIN.l, view: { ...profileView }, total: profileData.total, vertices: profileData.vertices,
           zoomed: profileChart.classList.contains("zoomed") };
});
const screenX = (g, d) => g.left + g.l + (d - g.view.x0) / (g.view.x1 - g.view.x0) * g.pw;
const mouseAt = async (g, d) => { await page.mouse.move(screenX(g, d), g.top + g.height / 2); await frames(); };
/* El rectángulo de lectura (#profile-info): las ocho filas, y su caja */
const infoRows = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#profile-info .pf-info-row")]
  .map(r => [r.dataset.k, { txt: r.querySelector(".pf-info-val").textContent, off: r.classList.contains("off"),
                            alert: r.querySelector(".pf-info-val").classList.contains("alert") }])));
const infoBox = () => page.evaluate(() => {
  const b = document.getElementById("profile-info").getBoundingClientRect(), c = profileChart.getBoundingClientRect();
  return { l: Math.round(b.left * 10) / 10, t: Math.round(b.top * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10,
           aboveChart: b.bottom <= c.top + 1 };
});
const sameBox = (a, b) => a.l === b.l && a.t === b.t && a.w === b.w && a.h === b.h;
const arrowState = () => page.evaluate(wps => {
  const px = ll => map.latLngToContainerPoint(ll);
  if (!map.hasLayer(profileArrow)) return { shown: false };
  const a = px(wps[1]), b = px(wps[2]), p = px(profileArrow.getLatLng());
  return { shown: true, atVertex: p.distanceTo(a),
           offLine: Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / a.distanceTo(b),
           between: p.y < a.y && p.y > b.y, rotate: profileArrow.getElement().firstChild.style.transform,
           readout: (v => `${v.dist} · MDT ${v.mdt} · MDS ${v.mds} · MDS−MDT ${v.diff}`)(Object.fromEntries(
             [...document.querySelectorAll("#profile-info .pf-info-row")].map(r => [r.dataset.k, r.querySelector(".pf-info-val").textContent]))),
           diffAlert: !!document.querySelector('#profile-info .pf-info-row[data-k="diff"] .pf-info-val.alert'),
           cursor: document.getElementById("pf-cursor").getAttribute("visibility") };
}, WAYPOINTS);
let g = await chartGeom();
await mouseAt(g, g.vertices[1]);
const atV = await arrowState();
const boxV = await infoBox();
await mouseAt(g, (g.vertices[1] + g.vertices[2]) / 2);
const midLeg = await arrowState();
const boxM = await infoBox();
await page.mouse.move(700, 150); /* fuera de la gráfica, sobre el mapa */
await frames();
const afterLeave = await arrowState();
const boxIdle = await infoBox(), rowsIdle = await infoRows();
await mouseAt(g, 100);
await page.evaluate(() => closeProfileDialog());
const afterClose = await arrowState();
/* 2 px: el ratón va en píxeles enteros de la gráfica (~3 m cada uno aquí) */
ok(atV.shown && atV.atVertex <= 2, "en el vértice de la gráfica, la flecha está en ese waypoint: " + JSON.stringify(atV));
ok(atV.cursor === "visible" && /km · MDT [\d.]+ m · MDS [\d.]+ m/.test(atV.readout),
  "la línea roja y la lectura de las dos alturas: " + atV.readout);
{
  const m = atV.readout.match(/MDT ([\d.]+) m · MDS ([\d.]+) m · MDS−MDT ([+-][\d.]+) m$/);
  const diff = m && +m[2] - +m[1];
  ok(m && Math.abs(+m[3] - diff) < 0.11, "y su diferencia MDS−MDT, con signo: " + atV.readout);
  ok(m && atV.diffAlert === diff > 1, "en rojo solo por encima de 1 m, como en las celdas: " + JSON.stringify(atV));
  ok(boxV.aboveChart && sameBox(boxV, boxM) && sameBox(boxV, boxIdle) && boxV.h > 0,
    "la lectura vive en su rectángulo, encima de la gráfica, y su caja no cambia entre lectura y reposo: " + JSON.stringify([boxV, boxM, boxIdle]));
  ok(Object.values(rowsIdle).every(r => r.txt === "—"), "en reposo, guiones en todos los valores: " + JSON.stringify(rowsIdle));
  ok(rowsIdle.bulge.off && rowsIdle.clear.off && rowsIdle.fres.off && rowsIdle.margin.off && !rowsIdle.mdt.off && !rowsIdle.diff.off,
    "las filas de lo que no está activado (curvatura, despeje, Fresnel, margen) quedan atenuadas, no ocultas: " + JSON.stringify(rowsIdle));
  ok(await page.evaluate(() => !document.getElementById("pf-readout") && ["pf-x-out", "pf-x-in", "pf-y-out", "pf-y-in", "pf-freq"].every(id => !document.getElementById(id))),
    "ya no hay texto de lectura sobre la gráfica ni botones de zoom ni campo de frecuencia en la ventana");
}
ok(midLeg.offLine < 1 && midLeg.between, "a mitad de tramo, sobre la línea dibujada: " + JSON.stringify(midLeg));
ok(/rotate\(-90deg\)/.test(midLeg.rotate), "apuntando en el sentido de la marcha (norte): " + midLeg.rotate);
ok(!afterLeave.shown && !afterClose.shown, "al salir de la gráfica o cerrar, desaparece");

/* ---------- 7b. Rueda = zoom con ancla; arrastrar = desplazar ---------- */
await page.evaluate(sel => routeProfileCtxItem(eval(sel)).action(), routeLi);
await frames();
g = await chartGeom();
const yRange = () => page.evaluate(() => {
  const ys = [...document.querySelectorAll("#profile-chart text.pf-tick[dominant-baseline=middle]")]
    .filter(t => t.getAttribute("text-anchor") === "end").map(t => Number(t.textContent));
  return Math.max(...ys) - Math.min(...ys);
});
const fullY = await yRange();
ok(g.view.x0 === 0 && g.view.x1 === g.total && !g.zoomed, "abre con la ruta entera: " + JSON.stringify(g.view));
/* Acercar con el ratón en el quiebro: el quiebro no se mueve */
const anchorD = g.vertices[1];
await mouseAt(g, anchorD);
await page.mouse.wheel(0, -300);
await frames();
let g2 = await chartGeom();
const anchorNow = g2.view.x0 + (screenX(g, anchorD) - g2.left - g2.l) / g2.pw * (g2.view.x1 - g2.view.x0);
ok(g2.view.x1 - g2.view.x0 < g.total * 0.8 && g2.zoomed, "la rueda acerca: " + JSON.stringify(g2.view));
ok(Math.abs(anchorNow - anchorD) < 2, `el punto bajo el ratón se queda bajo el ratón (${anchorNow.toFixed(1)} frente a ${anchorD.toFixed(1)} m)`);
const zoomLabels = await page.evaluate(() => [...document.querySelectorAll("#profile-chart text.pf-tick.vertex")].map(t => t.textContent));
ok(zoomLabels.length >= 1, "el quiebro sigue con su cifra en negrita: " + zoomLabels);
/* Hasta el tope: 0,1 m por píxel */
for (let i = 0; i < 16; i++) { await page.mouse.wheel(0, -400); await frames(); }
g2 = await chartGeom();
ok(Math.abs((g2.view.x1 - g2.view.x0) - 0.1 * g2.pw) < 1e-6,
  `tope de zoom: 0,1 m por píxel (${(g2.view.x1 - g2.view.x0).toFixed(1)} m en ${g2.pw} px)`);
ok(await yRange() < fullY, "la altura se ajusta a lo que se ve");
const zoomArrow = await (async () => { await mouseAt(g2, g2.vertices[1]); return arrowState(); })();
ok(zoomArrow.shown && zoomArrow.atVertex <= 2, "con zoom, la flecha sigue cayendo en su sitio: " + zoomArrow.atVertex);
ok(/^\d+\.\d{4} km/.test(zoomArrow.readout), "a 0,1 m por píxel, la lectura distingue la décima de metro: " + zoomArrow.readout);
/* Arrastrar 100 px a la derecha: se ven 10 m anteriores, sin cambiar el zoom */
const sx = screenX(g2, (g2.view.x0 + g2.view.x1) / 2), sy = g2.top + g2.height / 2;
await page.mouse.move(sx, sy);
await page.mouse.down();
const grabbing = await page.evaluate(() => profileChart.classList.contains("dragging"));
await page.mouse.move(sx + 50, sy, { steps: 3 });
await page.mouse.move(sx + 100, sy, { steps: 3 });
await page.mouse.up();
await frames();
const g3 = await chartGeom();
ok(grabbing && Math.abs((g3.view.x0 - g2.view.x0) + 10) < 0.15 && Math.abs((g3.view.x1 - g3.view.x0) - 0.1 * g2.pw) < 1e-6,
  "arrastrar 100 px desplaza 10 m, mismo zoom: " + JSON.stringify([g2.view, g3.view]));
/* Alejar con la rueda (sin botones: e^(462·0,0015) = 2, al doble, con el ratón en el centro) y arrastrar hasta pasarse */
const span3 = g3.view.x1 - g3.view.x0, mid3 = (g3.view.x0 + g3.view.x1) / 2;
await mouseAt(g3, mid3);
await page.mouse.wheel(0, 462);
await frames();
const gOut = await chartGeom();
ok(Math.abs((gOut.view.x1 - gOut.view.x0) / span3 - 2) < 0.01 && Math.abs((gOut.view.x0 + gOut.view.x1) / 2 - mid3) < 0.05,
  "la rueda hacia abajo aleja (al doble con 462 px), con el centro en su sitio: " + JSON.stringify(gOut.view));
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 462); await frames(); }
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx - 3000, sy, { steps: 5 });
await page.mouse.up();
await frames();
const g4 = await chartGeom();
ok(Math.abs(g4.view.x1 - g4.total) < 1e-6, "y se para al final de la ruta: " + JSON.stringify(g4.view));
await mouseAt(g4, (g4.view.x0 + g4.view.x1) / 2); /* el arrastre dejó el ratón fuera de la gráfica */
for (let i = 0; i < 15; i++) { await page.mouse.wheel(0, 600); await frames(); }
const g5 = await chartGeom();
ok(g5.view.x0 === 0 && g5.view.x1 === g5.total && !g5.zoomed, "alejar tiene tope en la ruta entera: " + JSON.stringify(g5.view));

/* ---------- 7c. Eje de alturas: zoom propio y bloqueo ---------- */
const yState = () => page.evaluate(() => ({
  yView: profileYView && { ...profileYView }, auto: { ...profileLayout.ym }, view: { ...profileView },
  lock: document.getElementById("pf-y-lock").checked,
  tools: !document.getElementById("profile-tools").hidden
}));
let y0s = await yState();
ok(y0s.tools && !y0s.lock && !y0s.yView, "con la gráfica, la barra de controles; el eje Y, automático: " + JSON.stringify(y0s));
/* Rueda sobre el eje de alturas: acerca la ALTURA, no la distancia */
const axisX = g5.left + 30, midY = g5.top + g5.height / 2;
await page.mouse.move(axisX, midY);
await page.mouse.wheel(0, -300);
await frames();
let y1s = await yState();
const spanY = r => r.b - r.a;
ok(y1s.yView && spanY(y1s.yView) < spanY(y0s.auto) * 0.8 && y1s.lock,
  "rueda sobre el eje: acerca la altura y bloquea el eje Y: " + JSON.stringify([y0s.auto, y1s.yView]));
ok(y1s.view.x0 === y0s.view.x0 && y1s.view.x1 === y0s.view.x1, "y la distancia no cambia");
/* Mayús+rueda sobre la gráfica: también altura (aquí, alejar) */
await mouseAt(g5, g5.total / 2);
await page.keyboard.down("Shift");
await page.mouse.wheel(0, 300);
await page.keyboard.up("Shift");
await frames();
let y2s = await yState();
ok(spanY(y2s.yView) > spanY(y1s.yView) * 1.2 && y2s.view.x1 - y2s.view.x0 === y1s.view.x1 - y1s.view.x0,
  "Mayús+rueda: zoom de altura, sin tocar la distancia: " + JSON.stringify([y1s.yView, y2s.yView]));
/* Bloqueado: acercar y desplazar la distancia no mueve la altura */
await mouseAt(g5, g5.total / 3);
await page.mouse.wheel(0, -500);
await frames();
const gz = await chartGeom();
await page.mouse.move(screenX(gz, (gz.view.x0 + gz.view.x1) / 2), midY);
await page.mouse.down();
await page.mouse.move(screenX(gz, (gz.view.x0 + gz.view.x1) / 2) + 120, midY, { steps: 4 });
await page.mouse.up();
await frames();
let y3s = await yState();
ok(y3s.view.x1 - y3s.view.x0 < g5.total * 0.8 && y3s.yView.a === y2s.yView.a && y3s.yView.b === y2s.yView.b,
  "con el eje bloqueado, zoom y arrastre de distancia no cambian la altura: " + JSON.stringify([y2s.yView, y3s.yView]));
/* …y arrastrar en vertical sí la desplaza (hacia abajo = ver más arriba) */
const gy = await chartGeom();
const cx = screenX(gy, (gy.view.x0 + gy.view.x1) / 2);
await page.mouse.move(cx, midY);
await page.mouse.down();
await page.mouse.move(cx, midY + 40, { steps: 4 });
await page.mouse.up();
await frames();
let y4s = await yState();
const ph = await page.evaluate(() => profileLayout.ph);
/* tolerancia: el contenedor mide subpíxeles distintos en pantalla y en el viewBox (201,6 frente a 202) */
ok(Math.abs((y4s.yView.a - y3s.yView.a) - 40 / ph * spanY(y3s.yView)) < 0.005 * spanY(y3s.yView)
  && Math.abs(spanY(y4s.yView) - spanY(y3s.yView)) < 1e-9,
  "arrastrar 40 px hacia abajo sube la ventana de alturas lo mismo: " + JSON.stringify([y3s.yView, y4s.yView]));
/* Desbloquear: vuelve al ajuste automático */
await page.click("#pf-y-lock");
await frames();
let y5s = await yState();
ok(!y5s.lock && !y5s.yView, "desmarcar «Bloquear eje Y» vuelve a la altura automática");
/* Marcarlo congela lo que se ve */
await page.click("#pf-y-lock");
await frames();
let y6s = await yState();
ok(y6s.lock && y6s.yView && y6s.yView.a === y5s.auto.a && y6s.yView.b === y5s.auto.b, "marcarlo congela la altura que se veía");
/* Mayús+rueda sobre la gráfica: altura, centrada en el ratón (ya no hay botones de zoom) */
const gY = await chartGeom();
await page.mouse.move(gY.left + gY.l + gY.pw / 2, gY.top + gY.height / 2);
await page.keyboard.down("Shift");
await page.mouse.wheel(0, -462);
await frames();
await page.keyboard.up("Shift");
const y7s = await yState();
ok(spanY(y7s.yView) < spanY(y6s.yView) * 0.55 && spanY(y7s.yView) > spanY(y6s.yView) * 0.45,
  "Mayús+rueda hacia arriba acerca la altura a la mitad: " + JSON.stringify([y6s.yView, y7s.yView]));
/* Ver todo */
await page.click("#pf-reset");
await frames();
const yr = await yState();
ok(!yr.yView && !yr.lock && yr.view.x0 === 0 && yr.view.x1 === g5.total, "«Ver todo»: ruta entera y altura automática");

/* ---------- 7d. Solo segmentos rectos entre los valores ---------- */
/* Cada vértice de cada <polyline> es un valor de celda (x = su distancia,
   y = su altura) y nada más: sin curvas, sin puntos inventados. Con la
   ruta entera (diezmado a mín/máx por columna) y con zoom (todos). */
const straight = async () => page.evaluate(() => {
  const lay = profileLayout, svg = profileChart.firstChild;
  const curves = svg.querySelectorAll("path").length;
  let vertices = 0, matched = 0, expected = 0;
  for (const s of profileData.series) {
    const want = new Set(visibleProfilePoints(s.points, lay.x0, lay.x1)
      .filter(p => typeof p.v === "number").map(p => `${lay.xOf(p.d).toFixed(1)},${lay.yOf(p.v).toFixed(1)}`));
    expected += want.size;
    for (const pl of svg.querySelectorAll(`polyline.pf-line.${s.kind}`)) {
      for (const pt of pl.getAttribute("points").trim().split(/\s+/)) { vertices++; if (want.has(pt)) matched++; }
    }
  }
  const joins = [...svg.querySelectorAll("polyline.pf-line")].map(pl => getComputedStyle(pl).strokeLinejoin);
  return { curves, vertices, matched, expected, joins: [...new Set(joins)] };
});
const stFull = await straight();
ok(stFull.curves === 0 && stFull.vertices > 0 && stFull.matched === stFull.vertices,
  "ruta entera: solo polilíneas, y cada vértice es un valor de celda: " + JSON.stringify(stFull));
await mouseAt(g5, g5.total / 2);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -400); await frames(); }
const stZoom = await straight();
ok(stZoom.curves === 0 && stZoom.matched === stZoom.vertices && stZoom.vertices === stZoom.expected,
  "con zoom, una línea recta de valor a valor, todos los valores: " + JSON.stringify(stZoom));

/* ---------- 7e. Línea inicio–fin y curvatura terrestre (k = 4/3) ---------- */
/* La recta es una polilínea muestreada (se curva con «Tierra plana»): sus extremos */
await page.evaluate(() => {
  window.losEnds = (cls = "pf-los") => {
    const ln = profileChart.querySelector("polyline." + cls);
    if (!ln) return null;
    const p = ln.getAttribute("points").trim().split(/\s+/).map(t => t.split(",").map(Number));
    return { x1: p[0][0], y1: p[0][1], x2: p[p.length - 1][0], y2: p[p.length - 1][1], n: p.length };
  };
});
await page.click("#pf-reset");
await frames();
const opt0 = await page.evaluate(() => ({ los: !!profileChart.querySelector(".pf-los"), earth: !!profileChart.querySelector(".pf-earth"),
  losBox: document.getElementById("pf-los").checked, curve: document.getElementById("pf-curve").value }));
ok(!opt0.los && !opt0.earth && !opt0.losBox && opt0.curve === "none", "por defecto, sin recta ni curvatura: " + JSON.stringify(opt0));
await page.click("#pf-los");
await frames();
const los1 = await page.evaluate(() => {
  const ln = profileChart.querySelector("polyline.pf-los"), lay = profileLayout, e = window.losEnds();
  const mds = profileData.series.find(s => s.kind === "mds").points.filter(p => typeof p.v === "number");
  return { y1: e.y1, y2: e.y2, x1: e.x1, x2: e.x2,
           ey1: lay.yOf(mds[0].v), ey2: lay.yOf(mds[mds.length - 1].v), ex1: lay.xOf(lay.x0), ex2: lay.xOf(lay.x1),
           stroke: getComputedStyle(ln).stroke, legend: !!profileChart.querySelector(".pf-legend.los"),
           legendText: [...profileChart.querySelectorAll(".pf-legend-label")].map(t => t.textContent).join("|") };
});
ok(Math.abs(los1.y1 - los1.ey1) < 0.2 && Math.abs(los1.y2 - los1.ey2) < 0.2
  && Math.abs(los1.x1 - los1.ex1) < 0.2 && Math.abs(los1.x2 - los1.ex2) < 0.2,
  "la recta une la altura del MDS del primer y del último punto: " + JSON.stringify(los1));
ok(los1.stroke === "rgb(0, 0, 0)" && los1.legend && /Línea inicio–fin \(MDS\)/.test(los1.legendText),
  "negra y con su leyenda: " + JSON.stringify(los1));
/* Sin el MDS, la recta sale del MDT */
const losMdt = await page.evaluate(() => {
  const keep = profileData.series;
  profileData.series = keep.filter(s => s.kind === "mdt");
  renderProfileChart();
  const r = { text: [...profileChart.querySelectorAll(".pf-legend-label")].map(t => t.textContent).join("|"),
              y1: window.losEnds().y1,
              ey1: profileLayout.yOf(profileData.series[0].points.find(p => typeof p.v === "number").v) };
  profileData.series = keep;
  renderProfileChart();
  return r;
});
ok(/Línea inicio–fin \(MDT\)/.test(losMdt.text) && Math.abs(losMdt.y1 - losMdt.ey1) < 0.2,
  "sin MDS, la recta usa el MDT: " + JSON.stringify(losMdt));
/* Con zoom la recta sigue siendo la misma recta (se dibuja solo lo visible) */
await mouseAt(g5, g5.total / 2);
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -400); await frames(); }
const losZoom = await page.evaluate(() => {
  const lay = profileLayout, l = lay.los, e = window.losEnds();
  const at = d => lay.yOf(l.a + (l.b - l.a) * d / lay.total);
  return { y1: e.y1, y2: e.y2, e1: at(lay.x0), e2: at(lay.x1) };
});
ok(Math.abs(losZoom.y1 - losZoom.e1) < 0.2 && Math.abs(losZoom.y2 - losZoom.e2) < 0.2, "con zoom, sigue la misma recta: " + JSON.stringify(losZoom));
await page.click("#pf-reset");
await frames();

await page.selectOption("#pf-curve", "classic");
await frames();
const earth1 = await page.evaluate(() => {
  const lay = profileLayout, mid = lay.total / 2, ph = lay.ph;
  const lift = lay.lift(mid);
  const mds = profileData.series.find(s => s.kind === "mds").points.find(p => typeof p.v === "number");
  return { arc: !!profileChart.querySelector("polyline.pf-earth"), fill: !!profileChart.querySelector("polygon.pf-earth-fill"),
           lift, expected: lay.total * lay.total / (8 * (4 / 3) * EARTH_R),
           raise: lay.yOf(100, 0) - lay.yOf(100, mid), want: lift / (lay.ym.b - lay.ym.a) * ph,
           seaLevelInView: lay.ym.a <= 0 && lay.ym.b >= 0,
           axis: [...profileChart.querySelectorAll("text.pf-tick")].map(t => t.textContent).find(t => /^Altura/.test(t)),
           legend: [...profileChart.querySelectorAll(".pf-legend-label")].map(t => t.textContent).join("|"),
           stroke: getComputedStyle(profileChart.querySelector("polyline.pf-earth")).stroke };
});
ok(earth1.arc && earth1.fill, "con la curvatura, el arco de la Tierra y su relleno: " + JSON.stringify(earth1));
ok(Math.abs(earth1.lift - earth1.expected) < 1e-6 && earth1.lift > 0, "el abultamiento central es L²/(8·k·R): " + earth1.lift);
ok(Math.abs(earth1.raise - earth1.want) < 0.01, "el terreno se dibuja elevado ese abultamiento: " + JSON.stringify([earth1.raise, earth1.want]));
ok(earth1.seaLevelInView, "el nivel del mar entra en la escala de alturas (el arco parte de 0)");
ok(/Altura \+ curvatura k = 4\/3/.test(earth1.axis) && /Tierra/.test(earth1.legend), "el eje y la leyenda lo dicen: " + earth1.axis + " | " + earth1.legend);
/* La lectura: alturas reales + curvatura + despeje con signo */
await mouseAt(g5, g5.total / 2);
const rd = await infoRows();
ok(/^\+[\d.]+ m$/.test(rd.bulge.txt) && !rd.bulge.off, "la lectura da la curvatura: " + JSON.stringify(rd.bulge));
ok(/^[+-][\d.]+ m$/.test(rd.clear.txt) && !rd.clear.off, "y el despeje de la recta sobre el terreno elevado: " + JSON.stringify(rd.clear));
const clear = await page.evaluate(() => {
  const lay = profileLayout, d = lay.dOf(lay.lastX);
  const s = profileData.series.find(x => x.kind === lay.los.kind);
  const p = nearestProfilePoint(s.points, d);
  return { shown: document.querySelector('#profile-info [data-k="clear"] .pf-info-val').textContent,
           want: lay.losAt(d) - (p.v + lay.lift(d)) };
});
ok(Math.abs(Number(clear.shown.replace(/[^\d.+-]/g, "").replace(/^[+]/, "")) - clear.want) < 0.11,
  "el despeje = recta − (terreno + curvatura): " + JSON.stringify(clear));
await page.click("#pf-los");
await page.selectOption("#pf-curve", "none");
await frames();
const opt2 = await page.evaluate(() => ({ los: !!profileChart.querySelector(".pf-los"), earth: !!profileChart.querySelector(".pf-earth") }));
const rowsOff = await infoRows();
ok(!opt2.los && !opt2.earth && rowsOff.bulge.off && rowsOff.bulge.txt === "—" && rowsOff.clear.off && rowsOff.clear.txt === "—",
  "desmarcadas, desaparecen del dibujo y sus filas de la lectura quedan atenuadas y en guiones: " + JSON.stringify([opt2, rowsOff.bulge, rowsOff.clear]));

/* ---------- 7f. Torres, frecuencia y elipsoide de Fresnel ---------- */
await page.evaluate(() => setAltitudeUnit("m"));
await frames();
const tw0 = await page.evaluate(() => ({ a: document.getElementById("pf-tower-a").value, b: document.getElementById("pf-tower-b").value,
  unit: [...document.querySelectorAll(".pf-tower-unit")].map(x => x.textContent).join(),
  fr: !!profileChart.querySelector(".pf-fresnel"), f: fresnelFreqMHz }));
ok(tw0.a === "0" && tw0.b === "0" && tw0.f === 1090 && tw0.unit === "m,m" && !tw0.fr, "torres a 0, 1090 MHz de Propiedades, unidad de altitud y sin elipsoide: " + JSON.stringify(tw0));
const setField = async (id, v) => { await page.fill("#" + id, v); await page.$eval("#" + id, el => el.dispatchEvent(new Event("change"))); await frames(); };
await page.click("#pf-los");
await setField("pf-tower-a", "30");
await setField("pf-tower-b", "12.5");
const tw1 = await page.evaluate(() => {
  const lay = profileLayout, e = window.losEnds();
  const mds = profileData.series.find(s => s.kind === "mds").points.filter(p => typeof p.v === "number");
  return { y1: e.y1, y2: e.y2, ey1: lay.yOf(mds[0].v + 30), ey2: lay.yOf(mds[mds.length - 1].v + 12.5),
           towers: [...profileChart.querySelectorAll("line.pf-tower")].map(t => ({ h: Math.abs(+t.getAttribute("y1") - +t.getAttribute("y2")),
             x: +t.getAttribute("x1") })), tower: profileTowerM, ex1: lay.xOf(0), ex2: lay.xOf(lay.total) };
});
ok(Math.abs(tw1.y1 - tw1.ey1) < 0.2 && Math.abs(tw1.y2 - tw1.ey2) < 0.2, "las torres suben los extremos de la recta: " + JSON.stringify(tw1));
ok(tw1.towers.length === 2 && tw1.towers[0].h > tw1.towers[1].h && tw1.towers[1].h > 0 && Math.abs(tw1.towers[0].x - tw1.ex1) < 0.2,
  "y se dibujan, del terreno a la antena: " + JSON.stringify(tw1.towers));
/* en pies: el campo se reconvierte y lo guardado sigue siendo el mismo (metros) */
await page.evaluate(() => setAltitudeUnit("ft"));
await frames();
const twFt = await page.evaluate(() => ({ a: document.getElementById("pf-tower-a").value, m: profileTowerM.a, unit: document.querySelector(".pf-tower-unit").textContent }));
ok(Math.abs(+twFt.a - 30 / 0.3048) < 0.01 && twFt.m === 30 * 1 && twFt.unit === "ft", "al cambiar la unidad, el campo se reconvierte: " + JSON.stringify(twFt));
await page.evaluate(() => setAltitudeUnit("m"));
await frames();
/* un valor fuera de rango se ajusta y avisa; ilegible vuelve */
await page.evaluate(() => { document.getElementById("nav-msg").textContent = ""; });
await setField("pf-tower-a", "999999");
const twClamp = await page.evaluate(() => ({ v: document.getElementById("pf-tower-a").value, m: profileTowerM.a, msg: document.getElementById("nav-msg").textContent }));
ok(twClamp.m === 10000 && twClamp.v === "10000" && /altura de torre va de 0 a 10\D?000 m/i.test(twClamp.msg), "una torre de 999999 m se queda en el tope y avisa: " + JSON.stringify(twClamp));
await setField("pf-tower-a", "30");
await setField("pf-tower-a", "");
ok((await page.evaluate(() => profileTowerM.a)) === 30, "campo vacío: vuelve el vigente");
/* Fresnel */
await page.click("#pf-fresnel");
await frames();
const fr1 = await page.evaluate(() => {
  const lay = profileLayout, d = lay.total / 2;
  const el = profileChart.querySelector("polygon.pf-fresnel60"), full = profileChart.querySelector("polygon.pf-fresnel");
  const pts = o => o.getAttribute("points").trim().split(/\s+/).map(p => p.split(",").map(Number));
  const p60 = pts(el), pf = pts(full);
  const n = (p60.length - 2) / 2;      /* n+1 puntos arriba, n+1 abajo */
  const mid = Math.round(n / 2);
  const h = p => Math.abs(p[mid][1] - p[p.length - 1 - mid][1]);
  const r = lay.fresnel(d);
  return { has60: !!el, hasFull: !!full, legend: [...profileChart.querySelectorAll(".pf-legend-label")].map(t => t.textContent).join("|"),
           ratio: h(p60) / h(pf), want: 0.6, px: h(pf) / 2, wantPx: r / (lay.ym.b - lay.ym.a) * lay.ph, fill: getComputedStyle(el).fillOpacity };
});
ok(fr1.has60 && fr1.hasFull && /Fresnel 1090 MHz \(zona 60 %\)/.test(fr1.legend), "el elipsoide y su leyenda: " + JSON.stringify(fr1));
ok(Math.abs(fr1.ratio - 0.6) < 0.03, "la zona rellena mide el 60 % del contorno: " + fr1.ratio);
ok(Math.abs(fr1.px - fr1.wantPx) < 0.6, "el radio central es el de Fresnel (sqrt(λ·d·(L−d)/L)): " + JSON.stringify([fr1.px, fr1.wantPx]));
/* La frecuencia ya no está en la ventana: es de Propiedades → Frecuencias (persistente, con Cancelar/Aceptar) */
const r1090 = await page.evaluate(() => profileLayout.fresnel(profileLayout.total / 2));
await page.evaluate(() => { togglePropsDialog(); });
await page.waitForFunction(() => !document.getElementById("props-dialog").hidden);
await page.click("#props-tab-btn-freq");
const fq0 = await page.evaluate(() => ({ visible: !document.getElementById("props-tab-freq").hidden,
  tabs: [...document.querySelectorAll("#props-dialog .dlg-tab")].map(t => t.textContent).join("|"),
  label: document.querySelector("#props-tab-freq .dlg-row span").textContent, value: document.getElementById("props-fresnel-freq").value }));
ok(fq0.visible && /Frecuencias/.test(fq0.tabs) && fq0.tabs.split("|").length === 4 && /^Frecuencia cálculos de Fresnel$/.test(fq0.label) && fq0.value === "1090",
  "Propiedades tiene la pestaña «Frecuencias» con «Frecuencia cálculos de Fresnel» = 1090: " + JSON.stringify(fq0));
await setField("props-fresnel-freq", "4360");
const r4360 = await page.evaluate(() => ({ r: profileLayout.fresnel(profileLayout.total / 2), legend: [...profileChart.querySelectorAll(".pf-legend-label")].map(t => t.textContent).join("|") }));
ok(Math.abs(r4360.r * 2 - r1090) < 1e-9 && /4360 MHz/.test(r4360.legend), "la frecuencia se previsualiza en vivo en el perfil abierto: a 4× la frecuencia, la mitad de radio: " + JSON.stringify([r1090, r4360]));
await page.evaluate(() => { document.getElementById("nav-msg").textContent = ""; });
await setField("props-fresnel-freq", "0");
const fq1 = await page.evaluate(() => ({ f: fresnelFreqMHz, v: document.getElementById("props-fresnel-freq").value, msg: document.getElementById("nav-msg").textContent }));
ok(fq1.f === 1 && fq1.v === "1" && /La frecuencia va de 1 a 300\D?000 MHz: se queda en 1 MHz/.test(fq1.msg), "una frecuencia de 0 se queda en el mínimo y avisa: " + JSON.stringify(fq1));
await page.click("#props-cancel");
await frames();
ok(await page.evaluate(() => fresnelFreqMHz === 1090 && /1090 MHz/.test([...profileChart.querySelectorAll(".pf-legend-label")].map(t => t.textContent).join("|"))),
  "Cancelar la deshace y el perfil vuelve a 1090 MHz");
await page.evaluate(() => { togglePropsDialog(); });
await page.waitForFunction(() => !document.getElementById("props-dialog").hidden);
await page.click("#props-tab-btn-freq");
await setField("props-fresnel-freq", "2400");
await page.click("#props-accept");
let saved = null;
for (let i = 0; i < 40 && saved !== 2400; i++) { saved = await page.evaluate(() => dbLoadFresnelFreq()); if (saved !== 2400) await page.waitForTimeout(50); }
ok(saved === 2400, "Aceptar la guarda en IndexedDB: " + saved);
/* con la curvatura, el elipsoide sigue alrededor de la misma recta (el terreno es lo que sube) */
const frNoEarth = await page.evaluate(() => profileChart.querySelector("polygon.pf-fresnel60").getAttribute("points"));
await page.selectOption("#pf-curve", "classic");
await frames();
const frEarth = await page.evaluate(() => ({ pts: profileChart.querySelector("polygon.pf-fresnel60") && profileChart.querySelector("polygon.pf-fresnel60").getAttribute("points"),
  los: profileChart.querySelector("polyline.pf-los") && window.losEnds() }));
ok(frEarth.pts && frEarth.los, "con la curvatura también se dibuja el elipsoide y la recta: " + JSON.stringify(frEarth).slice(0, 120));
/* la lectura, con margen sobre la zona del 60 % */
await mouseAt(g5, g5.total / 2);
const rdF = await infoRows();
ok(/^[\d.]+ m$/.test(rdF.fres.txt) && /^[+-][\d.]+ m$/.test(rdF.margin.txt) && !rdF.fres.off && !rdF.margin.off,
  "la lectura da el radio al 60 % y el margen: " + JSON.stringify([rdF.fres, rdF.margin]));
await page.selectOption("#pf-curve", "none");
await page.click("#pf-fresnel");
await page.click("#pf-los");
await frames();
const fr0 = await page.evaluate(() => ({ f: !!profileChart.querySelector(".pf-fresnel"), t: !!profileChart.querySelector(".pf-tower"), l: !!profileChart.querySelector(".pf-los") }));
ok(!fr0.f && !fr0.t && !fr0.l, "todo desmarcado: sin elipsoide, torres ni recta (las alturas de torre se conservan): " + JSON.stringify(fr0));
/* solo Fresnel (sin la recta marcada): el elipsoide sale igual, sin línea negra */
await page.click("#pf-fresnel");
await frames();
const frOnly = await page.evaluate(() => ({ f: !!profileChart.querySelector(".pf-fresnel60"), l: !!profileChart.querySelector(".pf-los") }));
ok(frOnly.f && !frOnly.l, "solo el elipsoide: se dibuja alrededor de la recta sin pintarla: " + JSON.stringify(frOnly));
await page.click("#pf-fresnel");
await page.evaluate(() => { profileTowerM.a = 0; profileTowerM.b = 0; renderProfileChart(); });

/* ---------- 7g0. Tres maneras de dibujar la curvatura, y torres en vértices ---------- */
await page.click("#pf-reset");
await page.click("#pf-los");
await frames();
const curveState = async mode => {
  await page.selectOption("#pf-curve", mode);
  await frames();
  return page.evaluate(() => {
    const lay = profileLayout, mid = lay.total / 2, e = window.losEnds(), sea = profileChart.querySelector("polyline.pf-earth");
    const seaY = sea && sea.getAttribute("points").trim().split(/\s+/).map(t => +t.split(",")[1]);
    return { lift0: lay.lift(0), liftMid: lay.lift(mid), liftEnd: lay.lift(lay.total), bendMid: lay.bend(mid), bendEnd: lay.bend(lay.total),
             seaFlat: !!seaY && Math.max(...seaY) - Math.min(...seaY) < 0.01, sea: !!sea,
             axis: [...profileChart.querySelectorAll("text.pf-tick")].map(t => t.textContent).find(t => /^Altura/.test(t)),
             legend: [...profileChart.querySelectorAll(".pf-legend-label")].map(t => t.textContent).join("|"),
             straight: (() => { const p = profileChart.querySelector("polyline.pf-los").getAttribute("points").trim().split(/\s+/).map(t => t.split(",").map(Number));
               const a = p[0], b = p[p.length - 1], q = p[Math.floor(p.length / 2)];
               return Math.abs(q[1] - (a[1] + (b[1] - a[1]) * (q[0] - a[0]) / (b[0] - a[0]))) < 0.05; })(),
             total: lay.total, y: e.y1 };
  });
};
const R2k = 2 * (4 / 3) * 6371000;
const cNone = await curveState("none");
ok(!cNone.sea && cNone.liftMid === 0 && cNone.bendMid === 0 && cNone.axis === "Altura (m)", "sin curvatura: ni arco ni corrección: " + JSON.stringify(cNone));
const cFlat = await curveState("flat");
ok(cFlat.sea && cFlat.seaFlat && cFlat.liftMid === 0 && Math.abs(cFlat.bendMid + cFlat.total * cFlat.total / 4 / R2k) < 1e-9 && cFlat.bendEnd === 0,
  "tierra plana: el nivel del mar es una recta y la línea baja L²/(8kR) en el centro: " + JSON.stringify(cFlat));
ok(/Tierra plana/.test(cFlat.legend) && cFlat.axis === "Altura (m)", "con su leyenda: " + cFlat.legend);
const cOrg = await curveState("origin");
ok(cOrg.lift0 === 0 && Math.abs(cOrg.liftEnd + cOrg.total * cOrg.total / R2k) < 1e-9 && cOrg.bendMid === 0 && cOrg.straight,
  "desde el inicio: la Tierra cae L²/(2kR) en el final y la línea sigue recta: " + JSON.stringify(cOrg));
ok(/desde el inicio/.test(cOrg.legend) && /^Altura − caída k = 4\/3/.test(cOrg.axis), "con su leyenda y su eje: " + cOrg.legend + " | " + cOrg.axis);
const cCls = await curveState("classic");
ok(Math.abs(cCls.liftMid - cCls.total * cCls.total / 4 / R2k) < 1e-9 && cCls.liftEnd === 0 && cCls.bendMid === 0 && /^Altura \+ curvatura/.test(cCls.axis),
  "clásica, como siempre: " + JSON.stringify(cCls));
await page.selectOption("#pf-curve", "none");

/* Torres en vértices intermedios */
const towerSel = await page.evaluate(() => ({
  a: [...document.getElementById("pf-tower-a-at").options].map(o => o.textContent + (o.disabled ? " [x]" : "")),
  b: [...document.getElementById("pf-tower-b-at").options].map(o => o.textContent + (o.disabled ? " [x]" : "")),
  va: document.getElementById("pf-tower-a-at").value, vb: document.getElementById("pf-tower-b-at").value }));
ok(towerSel.a.length === 3 && /^1 · Inicio · 0\.00 /.test(towerSel.a[0]) && /^2 · \d/.test(towerSel.a[1]) && /^3 · Final · /.test(towerSel.a[2])
  && towerSel.va === "0" && towerSel.vb === "2" && /\[x\]$/.test(towerSel.a[2]) && /\[x\]$/.test(towerSel.b[0]) && !/\[x\]/.test(towerSel.b[1]),
  "un vértice por opción (numerados desde 1), inicio y final por defecto, y el orden se impone deshabilitando: " + JSON.stringify(towerSel));
await setField("pf-tower-a", "20");
await page.selectOption("#pf-tower-a-at", "1");
await page.click("#pf-fresnel");
await frames();
const tv = await page.evaluate(() => {
  const lay = profileLayout, v1 = profileData.vertices[1], x1 = lay.xOf(v1);
  const ext = window.losEnds("pf-los-ext"), los = window.losEnds();
  const fr = profileChart.querySelector("polygon.pf-fresnel").getAttribute("points").trim().split(/\s+/).map(t => +t.split(",")[0]);
  const tw = [...profileChart.querySelectorAll("line.pf-tower")].map(t => +t.getAttribute("x1"));
  return { x1, extEnd: ext && ext.x2, extStart: ext && ext.x1, ex0: lay.xOf(0), losStart: los.x1, losEnd: los.x2, ex2: lay.xOf(lay.total),
           frMin: Math.min(...fr), tw, at: { ...profileTowerAt }, dash: ext && getComputedStyle(profileChart.querySelector("polyline.pf-los-ext")).strokeDasharray,
           bOpts: [...document.getElementById("pf-tower-b-at").options].map(o => o.disabled).join() };
});
ok(Math.abs(tv.losStart - tv.x1) < 0.2 && Math.abs(tv.losEnd - tv.ex2) < 0.2, "la línea continua empieza en la torre del vértice 2: " + JSON.stringify(tv));
ok(Math.abs(tv.extStart - tv.ex0) < 0.2 && Math.abs(tv.extEnd - tv.x1) < 0.2 && tv.dash !== "none", "y antes de ella sigue, discontinua, hasta el inicio de la ruta: " + JSON.stringify(tv));
ok(Math.abs(tv.frMin - tv.x1) < 0.2, "Fresnel solo entre las torres: " + tv.frMin + " vs " + tv.x1);
ok(tv.tw.length === 1 && Math.abs(tv.tw[0] - tv.x1) < 0.2 && tv.bOpts === "true,true,false", "la torre se dibuja en su vértice y el final no puede quedar antes: " + JSON.stringify([tv.tw, tv.bOpts]));
/* La lectura: despeje fuera de las torres solo con la línea dibujada; Fresnel y margen, solo entre ellas */
await mouseAt(g5, g5.vertices[1] / 2);
const rdOut = await infoRows();
await mouseAt(g5, (g5.vertices[1] + g5.vertices[2]) / 2);
const rdIn = await infoRows();
ok(/^[+-][\d.]+ m$/.test(rdOut.clear.txt) && rdOut.fres.txt === "—" && rdOut.margin.txt === "—", "antes de la torre: despeje de la prolongación, sin Fresnel: " + JSON.stringify([rdOut.clear, rdOut.fres, rdOut.margin]));
ok(/^[+-][\d.]+ m$/.test(rdIn.clear.txt) && /^[\d.]+ m$/.test(rdIn.fres.txt) && /^[+-][\d.]+ m$/.test(rdIn.margin.txt), "entre ellas: despeje, Fresnel y margen: " + JSON.stringify([rdIn.clear, rdIn.fres, rdIn.margin]));
await page.click("#pf-los");
await frames();
await mouseAt(g5, g5.vertices[1] / 2);
const rdNoLine = await infoRows();
ok(rdNoLine.clear.txt === "—", "sin la línea marcada, fuera de las torres no hay despeje que leer: " + JSON.stringify(rdNoLine.clear));
await page.click("#pf-los");
/* la torre final en el vértice 2, con la de inicio en el 1: nada tras ella, la línea se prolonga hasta el final de la ruta */
await page.selectOption("#pf-tower-a-at", "0");
await page.selectOption("#pf-tower-b-at", "1");
await frames();
const tb = await page.evaluate(() => {
  const lay = profileLayout, ext = window.losEnds("pf-los-ext"), los = window.losEnds(), x1 = lay.xOf(profileData.vertices[1]);
  return { at: { ...profileTowerAt }, extStart: ext && ext.x1, extEnd: ext && ext.x2, losEnd: los.x2, x1, ex2: lay.xOf(lay.total),
           aOpts: [...document.getElementById("pf-tower-a-at").options].map(o => o.disabled).join() };
});
ok(tb.at.a === 0 && tb.at.b === 1 && Math.abs(tb.losEnd - tb.x1) < 0.2 && Math.abs(tb.extStart - tb.x1) < 0.2 && Math.abs(tb.extEnd - tb.ex2) < 0.2 && tb.aOpts === "false,true,true",
  "la torre final en el vértice 2: la línea continua acaba allí y la prolongación llega al final: " + JSON.stringify(tb));
/* Presentación: velo fuera del enlace, vértices de torre con tinta, antenas con su altura, y puntos bajo el cursor */
await page.selectOption("#pf-tower-b-at", "2");
await page.selectOption("#pf-tower-a-at", "1");
await frames();
await mouseAt(g5, (g5.vertices[1] + g5.vertices[2]) / 2);
const pres = await page.evaluate(() => {
  const lay = profileLayout, q = sel => [...profileChart.querySelectorAll(sel)];
  const veil = q("rect.pf-outside").map(r => ({ x: +r.getAttribute("x"), w: +r.getAttribute("width") }));
  return { veil, ex0: lay.xOf(0), x1: lay.xOf(profileData.vertices[1]),
           towerLines: q("line.pf-vertex.tower").map(l => +l.getAttribute("x1")), plainLines: q("line.pf-vertex:not(.tower)").length,
           antennas: q("circle.pf-antenna").length, labels: q("text.pf-tower-label").map(t => t.textContent),
           dots: q("#pf-dots circle").map(c => c.getAttribute("class").replace("pf-dot ", "")).sort().join(),
           dotR: q("#pf-dots circle").map(c => +c.getAttribute("r")), ring: getComputedStyle(q("#pf-dots circle")[0]).strokeWidth,
           lineW: getComputedStyle(q("polyline.pf-line")[0]).strokeWidth };
});
ok(pres.veil.length === 1 && Math.abs(pres.veil[0].x - pres.ex0) < 0.2 && Math.abs(pres.veil[0].w - (pres.x1 - pres.ex0)) < 0.2,
  "el velo cubre solo lo anterior a la torre de inicio: " + JSON.stringify(pres.veil));
ok(pres.towerLines.length === 2 && Math.abs(pres.towerLines[0] - pres.x1) < 0.2 && pres.plainLines === 1,
  "los vértices de las torres llevan tinta y el otro queda apagado: " + JSON.stringify([pres.towerLines, pres.plainLines]));
ok(pres.antennas === 2 && pres.labels.length === 1 && /^20(\.0)? m$/.test(pres.labels[0]),
  "una antena por torre, y la altura rotulada solo en la que mide algo: " + JSON.stringify([pres.antennas, pres.labels]));
ok(pres.dots === "los,mds,mdt" && pres.dotR.every(r => r >= 4) && pres.ring === "2px" && pres.lineW === "2px",
  "bajo el cursor, un punto de al menos 8 px con anillo de 2 px en cada curva y en la recta; las curvas, a 2 px: " + JSON.stringify([pres.dots, pres.dotR, pres.ring, pres.lineW]));
await page.mouse.move(5, 5);
await frames();
ok((await page.evaluate(() => profileChart.querySelectorAll("#pf-dots circle").length)) === 0, "sin cursor sobre la gráfica, sin puntos");
/* tema oscuro: los pasos oscuros validados (contraste ≥ 3:1 sobre el panel) */
await page.emulateMedia({ colorScheme: "dark" });
const dark = await page.evaluate(() => { const c = sel => getComputedStyle(profileChart.querySelector(sel)).stroke;
  return { mdt: c("polyline.pf-line.mdt"), mds: c("polyline.pf-line.mds"), fres: c("polygon.pf-fresnel") }; });
await page.emulateMedia({ colorScheme: "light" });
ok(dark.mdt === "rgb(63, 148, 230)" && dark.mds === "rgb(69, 168, 75)" && dark.fres === "rgb(168, 111, 224)", "en oscuro, MDT, MDS y Fresnel usan sus pasos oscuros: " + JSON.stringify(dark));
await page.selectOption("#pf-tower-a-at", "0");
await frames();
/* los vértices son de la RUTA: otro perfil, otros vértices; las alturas se conservan */
const keyReset = await page.evaluate(() => {
  const key = profileData.key;
  setProfileData({ ...profileData, key: key + "-otra" });
  const other = { ...profileTowerAt, h: profileTowerM.a };
  setProfileData({ ...profileData, key });
  return other;
});
ok(keyReset.a === 0 && keyReset.b === null && keyReset.h === 20, "otra ruta: los vértices vuelven a los extremos y la altura se conserva: " + JSON.stringify(keyReset));
await page.click("#pf-fresnel");
await page.click("#pf-los");
await page.evaluate(() => { profileTowerM.a = 0; profileTowerM.b = 0; renderProfileChart(); });
await frames();

/* ---------- 7h. Disposición de la ventana ---------- */
await page.click("#pf-reset");
await frames();
const L = await page.evaluate(() => {
  const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const box = id => r(id);
  return { los: box("pf-los"), fres: box("pf-fresnel"), ta: box("pf-tower-a"), tb: box("pf-tower-b"), sa: box("pf-tower-a-at"), sb: box("pf-tower-b-at"), info: box("profile-info"),
           chart: box("profile-chart"), lock: box("pf-y-lock"), earth: box("pf-curve"), reset: box("pf-reset"),
           hint: !!document.querySelector("#profile-foot .pf-hint"), footShown: !document.getElementById("profile-foot").hidden,
           headShown: !document.getElementById("profile-tools").hidden };
});
const sameRow = (a, b) => Math.abs((a.t + a.b) / 2 - (b.t + b.b) / 2) < 6;
ok(L.headShown && L.footShown, "con la gráfica, se ven la cabecera y el pie");
ok(sameRow(L.los, L.fres) && L.fres.l > L.los.l, "«Línea inicio–fin» y «Elipsoide de Fresnel» van juntos, en una fila: " + JSON.stringify([L.los, L.fres]));
ok(sameRow(L.ta, L.sa) && sameRow(L.tb, L.sb) && L.sa.l > L.ta.l && L.sb.l > L.tb.l && L.tb.t >= L.ta.b - 4 && L.ta.t >= L.los.b - 4,
  "cada torre con su vértice en una fila, la de inicio sobre la final, debajo de la línea y el elipsoide: " + JSON.stringify([L.ta, L.sa, L.tb, L.sb, L.los]));
ok(L.info.l >= Math.max(L.sa.r, L.sb.r) && L.info.b <= L.chart.t + 1 && L.info.l > L.chart.l + (L.chart.r - L.chart.l) / 3,
  "el rectángulo de lectura, a la derecha de las opciones y encima de la gráfica: " + JSON.stringify([L.info, L.chart]));
ok(L.lock.t >= L.chart.b - 1 && sameRow(L.lock, L.earth) && sameRow(L.earth, L.reset) && L.earth.l > L.lock.l && L.reset.l > L.earth.l && L.hint,
  "bajo la gráfica: Bloquear eje Y, Curvatura terrestre, Ver todo y la pista de gestos: " + JSON.stringify([L.lock, L.earth, L.reset]));
const hit = await page.evaluate(() => ["pf-los", "pf-fresnel", "pf-y-lock", "pf-curve"].map(id => document.getElementById(id).closest("label").getBoundingClientRect().height));
ok(hit.every(h => h >= 24), "cada casilla se pulsa por su etiqueta entera, de al menos 24 px de alto: " + hit);

/* ---------- 7g. Arrastrar desplaza también la altura ---------- */
await page.click("#pf-reset");
await frames();
await mouseAt(g5, g5.total / 2);
for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -400); await frames(); }
const dragState = () => page.evaluate(() => ({ yView: profileYView && { ...profileYView }, auto: { ...profileLayout.ym }, view: { ...profileView },
  lock: document.getElementById("pf-y-lock").checked }));
const dg0 = await dragState();
const gDrag = await chartGeom();
const dragX = screenX(gDrag, (gDrag.view.x0 + gDrag.view.x1) / 2), dragY = gDrag.top + gDrag.height / 2;
/* arrastre casi horizontal (3 px de temblor vertical): no toca la altura */
await page.mouse.move(dragX, dragY);
await page.mouse.down();
await page.mouse.move(dragX - 40, dragY + 3, { steps: 4 });
await page.mouse.up();
await frames();
const dg1 = await dragState();
ok(!dg1.yView && !dg1.lock && dg1.view.x0 > dg0.view.x0, "un arrastre horizontal con la mano algo torcida no bloquea la altura: " + JSON.stringify(dg1));
/* arrastre con 60 px hacia abajo: bloquea y desplaza la altura */
const ph60 = await page.evaluate(() => profileLayout.ph);
await page.mouse.move(dragX, dragY);
await page.mouse.down();
await page.mouse.move(dragX, dragY + 60, { steps: 6 });
await page.mouse.up();
await frames();
const dg2 = await dragState();
const spanA = dg1.auto.b - dg1.auto.a;
ok(dg2.lock && dg2.yView && Math.abs(spanY(dg2.yView) - spanA) < 1e-6 * spanA
  && Math.abs((dg2.yView.a - dg1.auto.a) - 60 / ph60 * spanA) < 0.01 * spanA,
  "arrastrar 60 px en vertical bloquea el eje y lo desplaza lo mismo (hacia abajo = ver más arriba): " + JSON.stringify([dg1.auto, dg2.yView]));
await page.click("#pf-reset");
await frames();
await page.evaluate(() => closeProfileDialog());

/* ---------- 6b. Tras recargar, sigue siendo «Mostrar» ---------- */
await page.evaluate(() => new Promise(r => setTimeout(r, 700))); /* guardado (debounce) */
await page.reload();
await page.waitForFunction(() => typeof map === "object" && document.querySelector("#tree ul.node-list"));
const n1 = seen.length;
const reloaded = await page.evaluate(async sel => {
  const li = eval(sel);
  const item = routeProfileCtxItem(li);
  item.action();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const r = { label: item.label, lines: document.querySelectorAll("#profile-chart polyline.pf-line").length,
              series: profileData.series.map(s => s.label) };
  closeProfileDialog();
  return r;
}, routeLi);
ok(reloaded.label === "Mostrar perfil" && reloaded.lines >= 2 && reloaded.series.join() === "MDT05 (IGN),MDS (IGN)",
  "tras recargar, el perfil sale de lo guardado: " + JSON.stringify(reloaded));
ok(seen.length === n1, "sin pedir nada");
const frRestored = await page.evaluate(async () => {
  const f = fresnelFreqMHz;
  fresnelFreqMHz = FRESNEL_FREQ_DEFAULT;
  await dbSaveFresnelFreq(FRESNEL_FREQ_DEFAULT); /* que lo que sigue parta de 1090 */
  return f;
});
ok(frRestored === 2400, "la frecuencia de Fresnel guardada se restaura al arrancar: " + frRestored);
await page.evaluate(() => { setMeasureUnit("km"); setAltitudeUnit("m"); });

/* Mover un vértice: otra geometría, otro perfil */
const moved = await page.evaluate(sel => {
  const li = eval(sel);
  const m = li._measure;
  const keep = m.handles[2].getLatLng();
  m.handles[2].setLatLng([keep.lat + 0.0005, keep.lng]);
  const r = routeProfileCtxItem(li).label;
  m.handles[2].setLatLng(keep);
  return { moved: r, back: routeProfileCtxItem(li).label };
}, routeLi);
ok(moved.moved === "Obtener perfil" && moved.back === "Mostrar perfil",
  "mover un vértice vuelve a «Obtener perfil»; devolverlo, a «Mostrar»: " + JSON.stringify(moved));

/* ---------- 8. Deshacer, una sola fuente, huecos, cancelar ---------- */
const undone = await page.evaluate(async sel => {
  pushUndo("prueba"); /* deshacer lo que sigue, no lo de antes de recargar */
  const li = eval(sel);
  deleteNode([...document.querySelectorAll("#tree li")].find(x => /^Perfil de/.test(x._name || "")));
  const r = { afterDelete: routeProfileCtxItem(eval(sel)).label };
  await undoLast();
  r.afterUndo = routeProfileCtxItem(eval(sel)).label;
  r.groups = elevGridGroups.length; /* deshacer rehace la lista, sin restos */
  return r;
}, routeLi);
ok(undone.afterDelete === "Obtener perfil" && undone.afterUndo === "Mostrar perfil" && undone.groups === 1,
  "borrar el perfil vuelve a «Obtener»; deshacer el borrado, a «Mostrar»: " + JSON.stringify(undone));
await page.evaluate(async () => {
  const p = [...document.querySelectorAll("#tree li")].find(x => x._name === "Perfiles de ruta");
  deleteNode(p);
});

await page.evaluate(() => { elevSources = { mdt: null, mds: "ign-mds" }; });
const runMds = await runProfile();
const mdsOnly = await page.evaluate(() => ({
  mdt: document.querySelectorAll("#profile-chart polyline.pf-line.mdt").length,
  mds: document.querySelectorAll("#profile-chart polyline.pf-line.mds").length
}));
await page.waitForFunction(() => [...document.querySelectorAll("#tree li")].some(li => /^Perfil de/.test(li._name || "")));
const treeMds = await treeOf();
ok(runMds.button === "Cerrar" && mdsOnly.mdt === 0 && mdsOnly.mds === 1, "solo MDS: una curva: " + JSON.stringify(mdsOnly));
ok(treeMds.name === "Perfil de «Ruta 1» — MDS (IGN)" && treeMds.keys === "center,diff,mds,ne,sw",
  "y celdas sin la clave del MDT: " + JSON.stringify(treeMds));
await page.evaluate(() => {
  closeProfileDialog();
  deleteNode([...document.querySelectorAll("#tree li")].find(x => x._name === "Perfiles de ruta"));
  elevSources = { mdt: "ign-mdt05", mds: "ign-mds" };
});

const lastMds = coverages().filter(s => s.host === "wcs-mds.idee.es").at(-1);
fake.failBox = { host: "wcs-mds.idee.es", x0: Number(/\(([-\d.]+),/.exec(lastMds.params.getAll("subset")[0])[1]) };
const run2 = await runProfile();
ok(/MDS: 1 de \d+ zonas sin respuesta .*tras 4 intentos.*huecos/.test(run2.note), "el trozo caído, dicho: " + run2.note);
{
  const fails = run2.log.filter(l => /^pl-err\|.*✗ HTTP 500/.test(l));
  ok(fails.length === 4 && /se reintenta en 1 s$/.test(fails[0]) && !/reintenta/.test(fails[3])
    && run2.log.some(l => /^pl-err\|.*zona sin respuesta/.test(l)),
    "en el registro, cada intento fallido con su espera, y la zona perdida: " + JSON.stringify(fails));
}
const gaps = await page.evaluate(() => {
  const mds = profileData.series.find(s => s.kind === "mds"), mdt = profileData.series.find(s => s.kind === "mdt");
  return { holes: mds.points.some(p => !p.ref), mdtWhole: !mdt.points.some(p => !p.ref),
           lines: document.querySelectorAll("#profile-chart polyline.pf-line.mds").length };
});
ok(gaps.holes && gaps.mdtWhole && gaps.lines >= 1, "y en la curva del MDS queda un hueco (el MDT, entera): " + JSON.stringify(gaps));
await page.evaluate(() => {
  closeProfileDialog();
  deleteNode([...document.querySelectorAll("#tree li")].find(x => x._name === "Perfiles de ruta"));
});
fake.failBox = null;

fake.slow = 800;
const nodesBefore = await page.evaluate(() => elevGridGroups.length);
const cancelled = await page.evaluate(async sel => {
  demTimes.length = 0;
  openRouteProfile(eval(sel));
  await new Promise(r => setTimeout(r, 300));
  document.getElementById("profile-close").click(); /* × = «Cancelar la descarga» */
  await new Promise(r => setTimeout(r, 2500));
  return { hidden: document.getElementById("profile-dialog").hidden, groups: elevGridGroups.length };
}, routeLi);
fake.slow = 0;
ok(cancelled.hidden && cancelled.groups === nodesBefore, "cancelar a mitad cierra y no deja nada: " + JSON.stringify(cancelled));

/* ---------- 9. Consulta puntual y perfil, en la misma malla ---------- */
/* Celdas en Web Mercator, para comparar esquinas al centímetro */
const aligned = await page.evaluate(async sel => {
  demTimes.length = 0;
  const li = eval(sel);
  const before = elevGridGroups.length;
  const at = li._measure.handles[0].getLatLng();
  const p = L.latLng(at.lat + 0.00002, at.lng + 0.0009); /* sobre el primer tramo (al este) */
  await queryElevationAt(p);
  const q = elevGridGroups[before];
  await obtainRouteProfile(li);
  closeProfileDialog();
  const pr = elevGridGroups.at(-1);
  const W = ll => toWebMercator(ll[0], ll[1]);
  const key = c => { const a = W(c.sw); return `${a.x.toFixed(2)}:${a.y.toFixed(2)}`; };
  const qc = q._rects.map(r => r._cell), pc = pr._rects.map(r => r._cell);
  const qMap = new Map(qc.map(c => [key(c), c]));
  const box = qc.reduce((b, c) => ({ s: Math.min(b.s, c.sw[0]), n: Math.max(b.n, c.ne[0]),
    w: Math.min(b.w, c.sw[1]), e: Math.max(b.e, c.ne[1]) }), { s: 90, n: -90, w: 180, e: -180 });
  const inside = pc.filter(c => c.center[0] > box.s && c.center[0] < box.n && c.center[1] > box.w && c.center[1] < box.e);
  const a0 = W(pc[0].sw), cell = W(pc[0].ne).x - a0.x;
  const off = pc.filter(c => { const a = W(c.sw);
    return [(a.x - a0.x) / cell, (a.y - a0.y) / cell].some(f => Math.abs(f - Math.round(f)) > 1e-3); }).length;
  return { inside: inside.length, same: inside.filter(c => qMap.has(key(c))).length,
           sameValue: inside.filter(c => { const o = qMap.get(key(c)); return o && o.mds === c.mds && o.mdt === c.mdt; }).length,
           off, cell };
}, routeLi);
const scaled = coverages().slice(-12).filter(s => s.params.get("scaleSize")).length;
ok(aligned.inside > 0 && aligned.same === aligned.inside && aligned.sameValue === aligned.inside,
  "las celdas del perfil dentro de la tesela de una consulta puntual tienen sus mismas esquinas y valores: " + JSON.stringify(aligned));
ok(aligned.off === 0, "todas las celdas del perfil en una sola malla: los trozos contiguos encajan");
ok(scaled === 12, "cada recorte se pide con scaleSize: " + scaled);
await page.evaluate(() => {
  for (const name of ["Perfiles de ruta", "Elevaciones"]) {
    const li = [...document.querySelectorAll("#tree li")].find(x => x._name === name);
    if (li) deleteNode(li);
  }
});

/* ---------- 10. Un servicio que no entiende scaleSize ---------- */
await page.reload(); /* clientes nuevos: nada recordado de la sesión anterior */
await page.waitForFunction(() => typeof map === "object" && document.querySelector("#tree ul.node-list"));
fake.rejectScale = true;
const from = seen.length;
const fallback = await page.evaluate(async sel => {
  elevSources = { mdt: null, mds: "ign-mds" };
  await obtainRouteProfile(eval(sel));
  const r = { cells: elevGridGroups.length ? elevGridGroups.at(-1)._rects.length : 0,
              note: document.getElementById("profile-note").hidden ? "" : document.getElementById("profile-note").textContent };
  closeProfileDialog();
  return r;
}, routeLi);
fake.rejectScale = false;
const asked10 = seen.slice(from).filter(x => x.request === "GetCoverage");
ok(fallback.cells > 300 && !fallback.note, "sin scaleSize el perfil sale igual: " + JSON.stringify(fallback));
ok(asked10.filter(x => x.params.get("scaleSize")).length === 1 && asked10.length >= 3,
  "se prueba scaleSize una vez, y el resto de recortes ya va sin él: " + asked10.map(x => !!x.params.get("scaleSize")));

/* Los 500 son los simulados del paso 8, y el 400 el del paso 10 */
const realErrors = errors.filter(e => !/status of (500|400)/.test(e));
ok(realErrors.length === 0, "sin errores en la consola: " + realErrors.join(" | "));
await browser.close();
srv.close();
done();
