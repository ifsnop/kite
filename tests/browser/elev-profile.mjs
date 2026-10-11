/* «Obtener perfil» de una ruta, de punta a punta en el navegador, con el
   MDS del IGN servido FALSO por page.route: una rejilla ASCII de celdas
   de ~5 m que cubre exactamente cada recorte pedido, con alturas que
   dependen de la posición (la curva tiene forma).

   1) El ítem «Obtener perfil» del menú contextual existe en una ruta y
      no en un círculo; deshabilitado (con su motivo) con el MDS en
      «Ninguna» y con la ruta más larga que el límite de Preferencias.
      El botón del diálogo de propiedades de la ruta, igual.
   2) La descarga va por TROZOS (unas pocas peticiones, no cientos), la
      barra llega al 100 % y el botón pasa de «Cancelar» a «Cerrar».
   3) La gráfica: distancia en horizontal en la unidad de distancia,
      altura en vertical en la de altitud; una cifra en NEGRITA por
      vértice (inicio, quiebro y final); cambiar una unidad la redibuja.
   4) En el árbol, «Perfil de «Ruta 1» — MDS (IGN)» en la carpeta de la
      sesión, solo con las celdas RECORRIDAS (una por punto de la
      curva); deshacer la quita.
   5) Un trozo que falla tras sus reintentos (500 siempre) deja un hueco
      en la curva y lo dice; cancelar a mitad no deja nada.           */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER ROUTE PROFILE TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8946);
const { page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

/* ---------- MDS falso ---------- */
const seen = [];
let failBox = null;   /* (x0) del recorte que falla siempre (paso 5) */
let slow = 0;         /* ms de espera por respuesta (paso 5, cancelar) */
const capsXml = `<?xml version="1.0"?><wcs:Capabilities xmlns:wcs="http://www.opengis.net/wcs/2.0"
  xmlns:crs="http://www.opengis.net/wcs/crs/1.0"><wcs:ServiceMetadata><wcs:formatSupported>ArcGrid</wcs:formatSupported>
  <wcs:Extension><crs:CrsMetadata><crs:crsSupported>http://www.opengis.net/def/crs/EPSG/0/3857</crs:crsSupported>
  <crs:crsSupported>http://www.opengis.net/def/crs/EPSG/0/25830</crs:crsSupported></crs:CrsMetadata></wcs:Extension>
  </wcs:ServiceMetadata><wcs:Contents><wcs:CoverageSummary><wcs:CoverageId>mds05</wcs:CoverageId></wcs:CoverageSummary>
  </wcs:Contents></wcs:Capabilities>`;
const desc = `<?xml version="1.0"?><wcs:CoverageDescriptions xmlns:wcs="http://www.opengis.net/wcs/2.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"><gml:Envelope srsName="http://www.opengis.net/def/crs/EPSG/0/25830"
  axisLabels="x y"><gml:lowerCorner>-16000 3000000</gml:lowerCorner><gml:upperCorner>1200000 4900000</gml:upperCorner></gml:Envelope>
  <gml:domainSet><gml:RectifiedGrid dimension="2"><gml:offsetVector>5 0</gml:offsetVector>
  <gml:offsetVector>0 -5</gml:offsetVector></gml:RectifiedGrid></gml:domainSet></wcs:CoverageDescriptions>`;
/* Celdas de 6,5 m Web Mercator (≈ 5 m reales a 40°N), alineadas a una
   malla fija como haría el servicio; altura = 600 + 50·sen(x/300).    */
const CS = 6.5;
function asciiFor(params) {
  const [[x0, x1], [y0, y1]] = params.getAll("subset").map(s => /\(([-\d.]+),([-\d.]+)\)/.exec(s).slice(1).map(Number));
  const gx0 = Math.floor(x0 / CS) * CS, gy0 = Math.floor(y0 / CS) * CS;
  const cols = Math.ceil((x1 - gx0) / CS), rows = Math.ceil((y1 - gy0) / CS);
  const lines = [];
  for (let r = rows - 1; r >= 0; r--) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push((600 + 50 * Math.sin((gx0 + (c + 0.5) * CS) / 300)).toFixed(2));
    lines.push(row.join(" "));
  }
  return `ncols ${cols}\nnrows ${rows}\nxllcorner ${gx0}\nyllcorner ${gy0}\ncellsize ${CS}\nNODATA_value -9999\n${lines.join("\n")}\n`;
}
await page.route(/wcs-mds\.idee\.es|servicios\.idee\.es/, async route => {
  const u = new URL(route.request().url());
  const params = u.searchParams, request = params.get("request");
  seen.push({ request, params });
  if (request === "GetCapabilities") return route.fulfill({ status: 200, contentType: "application/xml", body: capsXml });
  if (request === "DescribeCoverage") return route.fulfill({ status: 200, contentType: "application/xml", body: desc });
  if (slow) await new Promise(r => setTimeout(r, slow));
  const x0 = Number(/\(([-\d.]+),/.exec(params.getAll("subset")[0])[1]);
  if (failBox !== null && Math.abs(x0 - failBox) < 1) {
    return route.fulfill({ status: 500, contentType: "text/html", body: "<h1>Internal Server Error</h1>" });
  }
  return route.fulfill({ status: 200, contentType: "text/plain", body: asciiFor(params) });
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

/* ---------- 1. Dónde está la opción, y cuándo no ---------- */
const where = await page.evaluate(() => {
  const lis = [...document.querySelectorAll("#tree li")].filter(x => x._measure);
  const route = lis.find(x => x._measure.type === "route"), circle = lis.find(x => x._measure.type === "circle");
  const item = li => layerCtxItems(li).find(i => i.label === "Obtener perfil");
  const r = { route: !!item(route), circle: !!item(circle), enabled: item(route).disabled() };
  elevSources = { ...elevSources, mds: null };
  r.noMds = item(route).disabled();
  elevSources = { ...elevSources, mds: "ign-mds" };
  const keep = profileMaxM;
  profileMaxM = 1000;
  r.tooLong = item(route).disabled();
  openStyleDialog(route);
  r.btnTooLong = { hidden: document.getElementById("ms-profile-row").hidden,
                   disabled: document.getElementById("ms-profile").disabled,
                   title: document.getElementById("ms-profile").title };
  document.getElementById("style-cancel").click();
  profileMaxM = keep;
  openStyleDialog(circle);
  r.btnCircle = document.getElementById("ms-profile-row").hidden;
  document.getElementById("style-cancel").click();
  return r;
});
ok(where.route && !where.circle, "«Obtener perfil» en una ruta y no en un círculo: " + JSON.stringify(where));
ok(where.enabled === false, "habilitado con MDS y ruta corta");
ok(/Sin fuente MDS/.test(where.noMds), "sin MDS, deshabilitado con el motivo: " + where.noMds);
ok(/límite de un perfil es 1\.00 km/.test(where.tooLong), "ruta más larga que el límite: " + where.tooLong);
ok(!where.btnTooLong.hidden && where.btnTooLong.disabled && /límite/.test(where.btnTooLong.title),
  "el botón del diálogo de la ruta, igual: " + JSON.stringify(where.btnTooLong));
ok(where.btnCircle, "y en el diálogo de un círculo no aparece");

/* ---------- 2. Descarga por trozos, con progreso ---------- */
async function runProfile() {
  return page.evaluate(async () => {
    demTimes.length = 0;
    const li = [...document.querySelectorAll("#tree li")].find(x => x._measure && x._measure.type === "route");
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
  });
}
const before = coverages().length;
const run1 = await runProfile();
const asked = coverages().length - before;
ok(asked >= 2 && asked <= 4, "por trozos: unas pocas peticiones para ~2 km, no cientos: " + asked);
ok(run1.steps.some(t => /^Descargando celdas MDS: \d+ % \(1 de \d+ zonas?\)$/.test(t))
  && run1.steps.some(t => /100 %/.test(t)), "la barra avanza hasta el 100 %: " + JSON.stringify(run1.steps));
ok(run1.button === "Cerrar" && run1.progressHidden && !run1.note, "al terminar, «Cerrar» y sin avisos: " + JSON.stringify(run1));

/* ---------- 3. La gráfica ---------- */
const chart = await page.evaluate(() => {
  const svg = document.querySelector("#profile-chart svg");
  const t = cls => [...svg.querySelectorAll("text." + cls.split(" ").join("."))];
  return {
    bold: t("pf-tick vertex").map(x => ({ txt: x.textContent, w: getComputedStyle(x).fontWeight })),
    vlines: svg.querySelectorAll("line.pf-vertex").length,
    lines: svg.querySelectorAll("polyline.pf-line").length,
    labels: t("pf-tick").map(x => x.textContent).filter(x => /\(/.test(x)),
    points: profileData.points.length, withData: profileData.points.filter(p => p.ref && p.v !== null).length,
    vertices: profileData.vertices
  };
});
const km = d => (d / 1000).toFixed(2);
ok(chart.vlines === 3 && chart.bold.map(b => b.txt).join() === [0, route.legs[0], route.total].map(km).join(),
  "una cifra por vértice (inicio, quiebro, final), en km: " + JSON.stringify(chart.bold));
ok(chart.bold.every(b => Number(b.w) >= 700), "en negrita: " + chart.bold.map(b => b.w));
ok(Math.abs(chart.vertices[1] - route.legs[0]) < 1e-6, "el quiebro, exactamente en la distancia del primer tramo");
ok(chart.lines === 1, "una curva continua: " + chart.lines);
ok(chart.labels.some(l => l === "Distancia desde el inicio (km)") && chart.labels.some(l => l === "Altura MDS (m)"),
  "ejes con sus unidades: " + JSON.stringify(chart.labels));
ok(chart.withData > 350 && chart.withData < 480, "un punto por celda de ~5 m recorrida (~2,1 km): " + chart.withData);
const redraw = await page.evaluate(() => {
  setMeasureUnit("nm");
  setAltitudeUnit("ft");
  const svg = document.querySelector("#profile-chart svg");
  const r = [...svg.querySelectorAll("text.pf-tick")].map(x => x.textContent).filter(x => /\(/.test(x));
  setMeasureUnit("km");
  setAltitudeUnit("m");
  return r;
});
ok(redraw.includes("Distancia desde el inicio (NM)") && redraw.includes("Altura MDS (ft)"),
  "cambiar las unidades la redibuja: " + JSON.stringify(redraw));

/* ---------- 4. En el árbol, solo las celdas recorridas ---------- */
/* el nodo llega tras crear la carpeta de sesión (asíncrono) */
await page.waitForFunction(() => [...document.querySelectorAll("#tree li")].some(li => /^Perfil de/.test(li._name || "")));
const tree = await page.evaluate(() => {
  const sec = [...document.querySelectorAll("#tree li")].find(li => li._name === "Elevaciones");
  const folder = nodeUl(sec).children[0];
  const node = nodeUl(folder).children[0];
  return { folder: folder._name, name: node._name, cells: node._elevGrid.cells.length,
           keys: Object.keys(node._elevGrid.cells[0]).sort().join() };
});
ok(/^Sesión /.test(tree.folder) && tree.name === "Perfil de «Ruta 1» — MDS (IGN)",
  "nodo del perfil en la carpeta de la sesión: " + JSON.stringify(tree));
ok(tree.cells === chart.withData, `solo las celdas recorridas (${tree.cells}), no todo lo descargado`);
ok(tree.keys === "center,diff,mds,ne,sw", "celdas con solo MDS: " + tree.keys);
const undone = await page.evaluate(async () => {
  await undoLast();
  return [...document.querySelectorAll("#tree li")].some(li => /^Perfil de/.test(li._name || ""));
});
ok(!undone, "deshacer quita el perfil del árbol");
await page.evaluate(() => closeProfileDialog());

/* ---------- 5. Un trozo que no responde, y cancelar ---------- */
failBox = Number(/\(([-\d.]+),/.exec(coverages().at(-1).params.getAll("subset")[0])[1]);
const run2 = await runProfile();
ok(/1 de \d+ zonas sin respuesta .*tras 4 intentos.*huecos/.test(run2.note), "el trozo caído, dicho: " + run2.note);
const gaps = await page.evaluate(() => ({
  lines: document.querySelectorAll("#profile-chart polyline.pf-line").length,
  holes: profileData.points.some(p => !p.ref)
}));
ok(gaps.holes && gaps.lines >= 1, "y en la curva queda un hueco: " + JSON.stringify(gaps));
await page.evaluate(() => closeProfileDialog());
failBox = null;

slow = 800;
const nodesBefore = await page.evaluate(() => elevGridGroups.length);
const cancelled = await page.evaluate(async () => {
  demTimes.length = 0;
  const li = [...document.querySelectorAll("#tree li")].find(x => x._measure && x._measure.type === "route");
  obtainRouteProfile(li);
  await new Promise(r => setTimeout(r, 300));
  document.getElementById("profile-close").click(); /* «Cancelar» */
  await new Promise(r => setTimeout(r, 2500));
  return { hidden: document.getElementById("profile-dialog").hidden, groups: elevGridGroups.length };
});
slow = 0;
ok(cancelled.hidden && cancelled.groups === nodesBefore, "cancelar a mitad cierra y no deja nada: " + JSON.stringify(cancelled));

/* Los 500 son los simulados del paso 5 */
const realErrors = errors.filter(e => !/status of 500/.test(e));
ok(realErrors.length === 0, "sin errores en la consola: " + realErrors.join(" | "));
await browser.close();
srv.close();
done();
