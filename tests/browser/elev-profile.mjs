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
   7) La flecha del mapa sigue al cursor de la gráfica: en un vértice,
      sobre ese waypoint; a mitad de tramo, sobre la línea; al salir de
      la gráfica o cerrar, desaparece.
   8) Deshacer quita el perfil; con el MDT en «Ninguna», una sola curva
      y celdas sin MDT; un trozo que falla deja un hueco; cancelar a
      mitad no deja nada.                                             */
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
/* Celdas de 6,5 m Web Mercator (≈ 5 m reales a 40°N), alineadas a una
   malla fija como haría el servicio. MDS = 600 + 50·sen(x/300); el MDT,
   10 m por debajo.                                                   */
const CS = 6.5;
function asciiFor(params, base) {
  const [[x0, x1], [y0, y1]] = params.getAll("subset").map(s => /\(([-\d.]+),([-\d.]+)\)/.exec(s).slice(1).map(Number));
  const gx0 = Math.floor(x0 / CS) * CS, gy0 = Math.floor(y0 / CS) * CS;
  const cols = Math.ceil((x1 - gx0) / CS), rows = Math.ceil((y1 - gy0) / CS);
  const lines = [];
  for (let r = rows - 1; r >= 0; r--) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push((base + 50 * Math.sin((gx0 + (c + 0.5) * CS) / 300)).toFixed(2));
    lines.push(row.join(" "));
  }
  return `ncols ${cols}\nnrows ${rows}\nxllcorner ${gx0}\nyllcorner ${gy0}\ncellsize ${CS}\nNODATA_value -9999\n${lines.join("\n")}\n`;
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

/* ---------- 7. La flecha del mapa sigue al cursor ---------- */
const arrow = await page.evaluate(async wps => {
  const svg = document.querySelector("#profile-chart svg");
  const r = svg.getBoundingClientRect();
  const W = Number(svg.getAttribute("viewBox").split(" ")[2]);
  const pw = W - PF_MARGIN.l - PF_MARGIN.r;
  const move = d => svg.dispatchEvent(new MouseEvent("mousemove", { bubbles: true,
    clientX: r.left + (PF_MARGIN.l + d / profileData.total * pw) * r.width / W, clientY: r.top + r.height / 2 }));
  const frames = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
  const px = ll => map.latLngToContainerPoint(ll);
  const out = {};
  move(profileData.vertices[1]);
  await frames();
  out.shown = map.hasLayer(profileArrow);
  out.atVertex = px(profileArrow.getLatLng()).distanceTo(px(wps[1]));
  out.readout = document.getElementById("pf-readout").textContent;
  out.cursorVisible = document.getElementById("pf-cursor").getAttribute("visibility");
  /* A mitad del segundo tramo (hacia el norte): sobre la línea y apuntando arriba */
  move((profileData.vertices[1] + profileData.vertices[2]) / 2);
  await frames();
  const a = px(wps[1]), b = px(wps[2]), p = px(profileArrow.getLatLng());
  out.offLine = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / a.distanceTo(b);
  out.between = p.y < a.y && p.y > b.y;
  out.rotate = profileArrow.getElement().firstChild.style.transform;
  svg.dispatchEvent(new MouseEvent("mouseleave"));
  await frames();
  out.afterLeave = map.hasLayer(profileArrow);
  move(100);
  await frames();
  closeProfileDialog();
  out.afterClose = map.hasLayer(profileArrow);
  out.inTree = layersAtPoint(L.latLng(wps[1]), px(wps[1])).length;
  return out;
}, WAYPOINTS);
/* 2 px: el ratón va en píxeles enteros de la gráfica (~1,6 m cada uno aquí) */
ok(arrow.shown && arrow.atVertex <= 2, "en el vértice de la gráfica, la flecha está en ese waypoint: " + JSON.stringify(arrow));
ok(arrow.cursorVisible === "visible" && /km · MDT [\d.]+ m · MDS [\d.]+ m/.test(arrow.readout),
  "la línea roja y la lectura de las dos alturas: " + arrow.readout);
ok(arrow.offLine < 1 && arrow.between, "a mitad de tramo, sobre la línea dibujada: " + arrow.offLine);
ok(/rotate\(-90deg\)/.test(arrow.rotate), "apuntando en el sentido de la marcha (norte): " + arrow.rotate);
ok(!arrow.afterLeave && !arrow.afterClose, "al salir de la gráfica o cerrar, desaparece");

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

/* Los 500 son los simulados del paso 8 */
const realErrors = errors.filter(e => !/status of 500/.test(e));
ok(realErrors.length === 0, "sin errores en la consola: " + realErrors.join(" | "));
await browser.close();
srv.close();
done();
