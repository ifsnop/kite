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

const { ok, done } = reporter("BROWSER ROUTE PROFILE TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8946);
const { page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

/* ---------- MDT y MDS falsos ---------- */
const seen = [];
let failBox = null;   /* (host, x0) del recorte que falla siempre (paso 8) */
let slow = 0;         /* ms de espera por respuesta (paso 8, cancelar) */
const caps = cov => `<?xml version="1.0"?><wcs:Capabilities xmlns:wcs="http://www.opengis.net/wcs/2.0"
  xmlns:crs="http://www.opengis.net/wcs/crs/1.0"><wcs:ServiceMetadata><wcs:formatSupported>ArcGrid</wcs:formatSupported>
  <wcs:Extension><crs:CrsMetadata><crs:crsSupported>http://www.opengis.net/def/crs/EPSG/0/3857</crs:crsSupported>
  <crs:crsSupported>http://www.opengis.net/def/crs/EPSG/0/25830</crs:crsSupported></crs:CrsMetadata></wcs:Extension>
  </wcs:ServiceMetadata><wcs:Contents><wcs:CoverageSummary><wcs:CoverageId>${cov}</wcs:CoverageId></wcs:CoverageSummary>
  </wcs:Contents></wcs:Capabilities>`;
const desc = `<?xml version="1.0"?><wcs:CoverageDescriptions xmlns:wcs="http://www.opengis.net/wcs/2.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"><gml:Envelope srsName="http://www.opengis.net/def/crs/EPSG/0/25830"
  axisLabels="x y"><gml:lowerCorner>-16000 3000000</gml:lowerCorner><gml:upperCorner>1200000 4900000</gml:upperCorner></gml:Envelope>
  <gml:domainSet><gml:RectifiedGrid dimension="2"><gml:offsetVector>5 0</gml:offsetVector>
  <gml:offsetVector>0 -5</gml:offsetVector></gml:RectifiedGrid></gml:domainSet></wcs:CoverageDescriptions>`;
/* Como el servicio real (comprobado contra el IGN y Digital Earth
   Africa): la rejilla empieza en la esquina de la caja pedida; con
   `scaleSize`, tantas celdas como diga; sin él, celdas de ~6,5 m Web
   Mercator (≈ 5 m reales a 40°N) que reparten el ancho en un número
   entero que elige el servicio. MDS = 600 + 50·sen(x/300) en el centro
   de cada celda; el MDT, 10 m por debajo.                            */
const CS = 6.5;
let rejectScale = false; /* paso 10: un servicio que no entiende scaleSize */
function asciiFor(params, base) {
  const [[x0, x1], [y0, y1]] = params.getAll("subset").map(s => /\(([-\d.]+),([-\d.]+)\)/.exec(s).slice(1).map(Number));
  const sc = params.get("scaleSize");
  const [nx, ny] = sc ? sc.match(/\((\d+)\)/g).map(t => Number(t.slice(1, -1)))
    : [Math.max(1, Math.round((x1 - x0) / CS)), Math.max(1, Math.round((y1 - y0) / CS))];
  const gx0 = x0, gy0 = y0, cols = nx, rows = ny, CX = (x1 - x0) / nx, CY = (y1 - y0) / ny;
  const lines = [];
  for (let r = rows - 1; r >= 0; r--) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push((base + 50 * Math.sin((gx0 + (c + 0.5) * CX) / 300)).toFixed(2));
    lines.push(row.join(" "));
  }
  return `ncols ${cols}\nnrows ${rows}\nxllcorner ${gx0}\nyllcorner ${gy0}\ndx ${CX}\ndy ${CY}\nNODATA_value -9999\n${lines.join("\n")}\n`;
}
await page.route(/wcs-mds\.idee\.es|servicios\.idee\.es/, async route => {
  const u = new URL(route.request().url());
  const mdt = u.host === "servicios.idee.es";
  const params = u.searchParams, request = params.get("request");
  seen.push({ request, params, host: u.host });
  if (request === "GetCapabilities") {
    return route.fulfill({ status: 200, contentType: "application/xml", body: caps(mdt ? "Elevacion4258_5" : "mds05") });
  }
  if (request === "DescribeCoverage") return route.fulfill({ status: 200, contentType: "application/xml", body: desc });
  if (slow) await new Promise(r => setTimeout(r, slow));
  if (rejectScale && params.get("scaleSize")) {
    return route.fulfill({ status: 400, contentType: "application/xml", body: `<?xml version="1.0"?>
      <ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/2.0"><ows:Exception exceptionCode="InvalidParameterValue"
      locator="scaleSize"><ows:ExceptionText>scaleSize no soportado</ows:ExceptionText></ows:Exception></ows:ExceptionReport>` });
  }
  const x0 = Number(/\(([-\d.]+),/.exec(params.getAll("subset")[0])[1]);
  if (failBox && failBox.host === u.host && Math.abs(x0 - failBox.x0) < 1) {
    return route.fulfill({ status: 500, contentType: "text/html", body: "<h1>Internal Server Error</h1>" });
  }
  return route.fulfill({ status: 200, contentType: "text/plain", body: asciiFor(params, mdt ? 590 : 600) });
});
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
ok(/límite de un perfil es 1\.00 km/.test(where.tooLong), "ruta más larga que el límite: " + where.tooLong);
ok(!where.btnTooLong.hidden && where.btnTooLong.disabled && where.btnTooLong.text === "Obtener perfil"
  && /límite/.test(where.btnTooLong.title), "el botón del diálogo de la ruta, igual: " + JSON.stringify(where.btnTooLong));
ok(where.btnCircle, "y en el diálogo de un círculo no aparece");
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
    while (performance.now() - t0 < 20000 && document.getElementById("profile-close").textContent !== "Cerrar") {
      await new Promise(r => setTimeout(r, 30));
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    obs.disconnect();
    return {
      steps, button: document.getElementById("profile-close").textContent,
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
ok(run1.button === "Cerrar" && run1.progressHidden && !run1.note, "al terminar, «Cerrar» y sin avisos: " + JSON.stringify(run1));

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
await page.evaluate(() => closeProfileDialog());
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
  r.close = document.getElementById("profile-close").textContent;
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
const arrowState = () => page.evaluate(wps => {
  const px = ll => map.latLngToContainerPoint(ll);
  if (!map.hasLayer(profileArrow)) return { shown: false };
  const a = px(wps[1]), b = px(wps[2]), p = px(profileArrow.getLatLng());
  return { shown: true, atVertex: p.distanceTo(a),
           offLine: Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / a.distanceTo(b),
           between: p.y < a.y && p.y > b.y, rotate: profileArrow.getElement().firstChild.style.transform,
           readout: document.getElementById("pf-readout").textContent,
           cursor: document.getElementById("pf-cursor").getAttribute("visibility") };
}, WAYPOINTS);
let g = await chartGeom();
await mouseAt(g, g.vertices[1]);
const atV = await arrowState();
await mouseAt(g, (g.vertices[1] + g.vertices[2]) / 2);
const midLeg = await arrowState();
await page.mouse.move(700, 150); /* fuera de la gráfica, sobre el mapa */
await frames();
const afterLeave = await arrowState();
await mouseAt(g, 100);
await page.evaluate(() => closeProfileDialog());
const afterClose = await arrowState();
/* 2 px: el ratón va en píxeles enteros de la gráfica (~3 m cada uno aquí) */
ok(atV.shown && atV.atVertex <= 2, "en el vértice de la gráfica, la flecha está en ese waypoint: " + JSON.stringify(atV));
ok(atV.cursor === "visible" && /km · MDT [\d.]+ m · MDS [\d.]+ m/.test(atV.readout),
  "la línea roja y la lectura de las dos alturas: " + atV.readout);
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
/* Alejar con el botón − de distancia (al doble cada vez, centrado) y arrastrar hasta pasarse */
const span3 = g3.view.x1 - g3.view.x0, mid3 = (g3.view.x0 + g3.view.x1) / 2;
await page.click("#pf-x-out");
await frames();
const gOut = await chartGeom();
ok(Math.abs((gOut.view.x1 - gOut.view.x0) - 2 * span3) < 1e-6 && Math.abs((gOut.view.x0 + gOut.view.x1) / 2 - mid3) < 1e-6,
  "el botón − de distancia aleja al doble, centrado: " + JSON.stringify(gOut.view));
for (let i = 0; i < 4; i++) await page.click("#pf-x-out");
await frames();
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
/* Botones de altura: al doble / a la mitad, centrados */
await page.click("#pf-y-in");
await frames();
let y7s = await yState();
ok(Math.abs(spanY(y7s.yView) - spanY(y6s.yView) / 2) < 1e-9
  && Math.abs((y7s.yView.a + y7s.yView.b) - (y6s.yView.a + y6s.yView.b)) < 1e-9, "el botón + de altura acerca a la mitad, centrado");
await page.click("#pf-y-out");
await frames();
ok(Math.abs(spanY((await yState()).yView) - spanY(y6s.yView)) < 1e-9, "y el − lo deshace");
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
failBox = { host: "wcs-mds.idee.es", x0: Number(/\(([-\d.]+),/.exec(lastMds.params.getAll("subset")[0])[1]) };
const run2 = await runProfile();
ok(/MDS: 1 de \d+ zonas sin respuesta .*tras 4 intentos.*huecos/.test(run2.note), "el trozo caído, dicho: " + run2.note);
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
failBox = null;

slow = 800;
const nodesBefore = await page.evaluate(() => elevGridGroups.length);
const cancelled = await page.evaluate(async sel => {
  demTimes.length = 0;
  openRouteProfile(eval(sel));
  await new Promise(r => setTimeout(r, 300));
  document.getElementById("profile-close").click(); /* «Cancelar» */
  await new Promise(r => setTimeout(r, 2500));
  return { hidden: document.getElementById("profile-dialog").hidden, groups: elevGridGroups.length };
}, routeLi);
slow = 0;
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
rejectScale = true;
const from = seen.length;
const fallback = await page.evaluate(async sel => {
  elevSources = { mdt: null, mds: "ign-mds" };
  await obtainRouteProfile(eval(sel));
  const r = { cells: elevGridGroups.length ? elevGridGroups.at(-1)._rects.length : 0,
              note: document.getElementById("profile-note").hidden ? "" : document.getElementById("profile-note").textContent };
  closeProfileDialog();
  return r;
}, routeLi);
rejectScale = false;
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
