/* Fuentes de elevación y consulta puntual, de punta a punta en el
   navegador. Los servicios WCS se sirven FALSOS con page.route (el IGN
   con rejillas ASCII calculadas a partir del recorte pedido; Digital
   Earth Africa con un GeoTIFF REAL que dio ese servicio, LZW y float32
   con hueco NaN), así que la prueba no depende de la red ni de que el
   IGN responda, y cada petición queda contada.

   1) Ya no hay botón ⛰ ni m/ft en la barra del visor.
   2) Propiedades → «Fuentes de datos»: opciones desde el catálogo, IGN
      por defecto, dirección del servicio elegido; Cancelar deshace y
      Aceptar guarda.
   3) Sin fuentes, la entrada del menú contextual sale deshabilitada.
   4) «Consultar elevación aquí» desde el menú: crea «Sesión …» ›
      «Elevación 1» en la sección «Elevaciones»; una segunda consulta va
      a la MISMA carpeta; repetir la tesela no pide nada; GetCapabilities
      UNA vez por fuente y la elección (cobertura, formato, celda) UNA
      vez en el registro de avisos.
   5) La unidad de Propiedades manda en las cifras de las celdas y en el
      cuadro de coordenadas, que lee la celda bajo el ratón sin red.
   6) Con el MDS en «Ninguna» no se pide al MDS y la celda no lo lleva.
   7) Digital Earth Africa: GeoTIFF leído y dibujado; fuera de su caja
      WGS84 no se pide; `InvalidSubsetting` (404) es «sin dato» y no
      hace abandonar la vía Web Mercator.
   8) Tras recargar, la elección de fuentes sigue y la sesión nueva
      tiene su propia carpeta.                                        */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER ELEVATION SOURCES TESTS OK");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEA_TIF = fs.readFileSync(path.join(HERE, "..", "fixtures", "dea-cop30-tenerife.tif"));

const browser = await launch();
const srv = await serve(READABLE, 8945);
const { page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

/* ---------- Servicios falsos ---------- */
const seen = []; /* { host, request, params } de cada petición WCS */
const capsXml = ({ formats, crs, coverages }) => `<?xml version="1.0"?>
<wcs:Capabilities xmlns:wcs="http://www.opengis.net/wcs/2.0" xmlns:ows="http://www.opengis.net/ows/2.0"
  xmlns:crs="http://www.opengis.net/wcs/crs/1.0"><wcs:ServiceMetadata>
  ${formats.map(f => `<wcs:formatSupported>${f}</wcs:formatSupported>`).join("")}
  <wcs:Extension><crs:CrsMetadata>${crs.map(c => `<crs:crsSupported>${c}</crs:crsSupported>`).join("")}
  </crs:CrsMetadata></wcs:Extension></wcs:ServiceMetadata><wcs:Contents>
  ${coverages.map(([id, bb]) => `<wcs:CoverageSummary>${bb ? `<ows:WGS84BoundingBox><ows:LowerCorner>${bb[0]} ${bb[1]}</ows:LowerCorner>`
    + `<ows:UpperCorner>${bb[2]} ${bb[3]}</ows:UpperCorner></ows:WGS84BoundingBox>` : ""}<wcs:CoverageId>${id}</wcs:CoverageId></wcs:CoverageSummary>`).join("")}
</wcs:Contents></wcs:Capabilities>`;
const IGN_CRS = ["http://www.opengis.net/def/crs/EPSG/0/25830", "http://www.opengis.net/def/crs/EPSG/0/4258",
  "http://www.opengis.net/def/crs/EPSG/0/3857", "http://www.opengis.net/def/crs/EPSG/0/4326"];
/* La malla geográfica declara su paso en GRADOS: 5 m de latitud */
const ignDesc = (cell, geo) => (geo ? ignDescRaw(cell / 111320, true) : ignDescRaw(cell, false));
const ignDescRaw = (cell, geo) => `<?xml version="1.0"?><wcs:CoverageDescriptions xmlns:wcs="http://www.opengis.net/wcs/2.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"><gml:Envelope srsName="http://www.opengis.net/def/crs/EPSG/0/${geo ? 4258 : 25830}"
  axisLabels="${geo ? "Lat Long" : "x y"}"><gml:lowerCorner>${geo ? "27 -19" : "-16000 3000000"}</gml:lowerCorner>
  <gml:upperCorner>${geo ? "44 5" : "1200000 4900000"}</gml:upperCorner></gml:Envelope>
  <gml:domainSet><gml:RectifiedGrid dimension="2"><gml:offsetVector>${cell} 0</gml:offsetVector>
  <gml:offsetVector>0 -${cell}</gml:offsetVector></gml:RectifiedGrid></gml:domainSet></wcs:CoverageDescriptions>`;
const DEA_DESC = `<wcs:CoverageDescriptions xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:wcs="http://www.opengis.net/wcs/2.0">
<wcs:CoverageDescription gml:id="dem_cop_30"><gml:boundedBy><gml:EnvelopeWithTimePeriod srsName="EPSG:4326" srsDimension="2"
 axisLabels="latitude longitude"><gml:lowerCorner>-46.9998611111111 -26.0001388888889</gml:lowerCorner>
 <gml:upperCorner>39.0001388888889 64.9998611111111</gml:upperCorner></gml:EnvelopeWithTimePeriod></gml:boundedBy>
 <gml:domainSet><gml:Grid dimension="3"><gml:limits><gml:GridLimits><gml:low>0 0 0</gml:low><gml:high>309600 327600 1</gml:high>
 </gml:GridLimits></gml:limits><gml:axisLabels>latitude longitude time</gml:axisLabels></gml:Grid></gml:domainSet>
 </wcs:CoverageDescription></wcs:CoverageDescriptions>`;
const owsError = code => `<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/2.0"><ows:Exception exceptionCode="${code}">
  <ows:ExceptionText>The requested spatio-temporal subsets return no data.</ows:ExceptionText></ows:Exception></ows:ExceptionReport>`;

/* Rejilla ASCII de 8x8 que cubre exactamente el recorte pedido: base
   600 m en el MDT y 603 m en el MDS (3 m de diferencia, con aviso).   */
function asciiFor(params, base) {
  const sub = params.getAll("subset").map(s => /\(([-\d.]+),([-\d.]+)\)/.exec(s).slice(1).map(Number));
  const [[x0, x1], [y0, y1]] = sub;
  const n = 8, cs = (x1 - x0) / n;
  const rows = [];
  for (let r = 0; r < n; r++) rows.push(Array.from({ length: n }, (_, c) => (base + r + c * 0.5).toFixed(2)).join(" "));
  return `ncols ${n}\nnrows ${n}\nxllcorner ${x0}\nyllcorner ${y0}\ncellsize ${cs}\nNODATA_value -9999\n${rows.join("\n")}\n`;
}

await page.route(/servicios\.idee\.es|wcs-mds\.idee\.es|ows\.digitalearth\.africa/, route => {
  const u = new URL(route.request().url());
  const params = u.searchParams;
  const request = params.get("request");
  seen.push({ host: u.host, request, params });
  const xml = body => route.fulfill({ status: 200, contentType: "application/xml", body });
  if (u.host === "servicios.idee.es") {
    if (request === "GetCapabilities") return xml(capsXml({ formats: ["image/tiff", "ArcGrid"], crs: IGN_CRS,
      coverages: [["Elevacion4258_25"], ["Elevacion4258_5"], ["Elevacion25830_5"]] }));
    if (request === "DescribeCoverage") return xml(ignDesc(5, /4258/.test(params.get("coverageId"))));
    return route.fulfill({ status: 200, contentType: "text/plain", body: asciiFor(params, 600) });
  }
  if (u.host === "wcs-mds.idee.es") {
    if (request === "GetCapabilities") return xml(capsXml({ formats: ["ArcGrid"], crs: IGN_CRS,
      coverages: [["mdsn_e025"], ["mds05"]] }));
    if (request === "DescribeCoverage") return xml(ignDesc(5, false));
    return route.fulfill({ status: 200, contentType: "text/plain", body: asciiFor(params, 603) });
  }
  /* Digital Earth Africa: solo GeoTIFF, CRS en forma corta, caja WGS84 */
  if (request === "GetCapabilities") return xml(capsXml({ formats: ["image/geotiff", "application/x-netcdf"],
    crs: ["EPSG:3857", "EPSG:4326"], coverages: [["crop_mask", [-17, -35, 58, 38]], ["dem_cop_30", [-26.0001, -46.9998, 64.9998, 39.0001]]] }));
  if (request === "DescribeCoverage") return xml(DEA_DESC);
  /* Un punto del Sáhara (x > 0) hace de «dentro de la caja pero sin dato» */
  const xs = /\(([-\d.]+),/.exec(params.getAll("subset")[0]);
  if (xs && Number(xs[1]) > 0) return route.fulfill({ status: 404, contentType: "application/xml", body: owsError("InvalidSubsetting") });
  return route.fulfill({ status: 200, contentType: "image/geotiff", body: DEA_TIF });
});
const count = (host, request) => seen.filter(s => s.host === host && s.request === request).length;

/* Elige en el menú contextual la entrada de elevación para un punto y
   espera a que la consulta termine (aparece la capa o un aviso).      */
const MADRID = { lat: 40.4168, lng: -3.7038 };
async function queryViaMenu(ll) {
  return page.evaluate(async ({ lat, lng }) => {
    /* Un aviso igual a uno aún visible se FUNDE con él (cuenta ×N) en
       vez de añadir entrada: lo nuevo es lo añadido o lo que ha subido
       de cuenta.                                                     */
    const before = elevGridGroups.length, counts = msgLog.map(e => e.count);
    const fresh = () => msgLog.filter((e, i) => i >= counts.length || e.count > counts[i]).map(e => e.text);
    /* El tope de peticiones por segundo es real (demRateOk); aquí las
       consultas se encadenan más rápido de lo que nadie pulsa.        */
    demTimes.length = 0;
    const latlng = L.latLng(lat, lng);
    map.setView(latlng, 20, { animate: false });
    openCtxMenu(latlng, 600, 400, []);
    const item = [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")]
      .find(x => /Consultar elevación aquí/.test(x.textContent));
    if (!item || item.disabled) return { item: !!item, disabled: item && item.disabled };
    item.click();
    const t0 = performance.now();
    while (performance.now() - t0 < 5000) {
      await new Promise(r => setTimeout(r, 30));
      const last = fresh();
      if (elevGridGroups.length > before || last.some(t => /sin datos|ya está descargada|Elevación: /.test(t) && !/Consultando/.test(t))) break;
    }
    return { added: elevGridGroups.length - before, log: fresh() };
  }, ll);
}
const treeShape = () => page.evaluate(() => {
  const sec = [...document.querySelectorAll("#tree li")].find(li => li._name === "Elevaciones");
  if (!sec) return null;
  return [...nodeUl(sec).children].map(f => ({
    name: f._name, children: nodeUl(f) ? [...nodeUl(f).children].map(c => c._name) : []
  }));
});

/* ---------- 1. Sin botones del modo altura ---------- */
const bar = await page.evaluate(() => [...document.querySelectorAll(".measure-bar a")]
  .map(a => ({ t: a.textContent, title: a.title })));
ok(!bar.some(b => b.t === "\u26F0" || /Modo altura/.test(b.title)), "ya no hay botón ⛰: " + JSON.stringify(bar.map(b => b.t)));
ok(!bar.some(b => /cuadrícula de elevaciones/.test(b.title)), "ni el de m/ft");

/* ---------- 2. Pestaña «Fuentes de datos» ---------- */
const tab = await page.evaluate(async () => {
  await togglePropsDialog();
  document.getElementById("props-tab-btn-sources").click();
  const opts = id => [...document.getElementById(id).options].map(o => o.value);
  const r = {
    visible: !document.getElementById("props-tab-sources").hidden,
    prefsHidden: document.getElementById("props-tab-prefs").hidden,
    mdt: opts("props-src-mdt"), mds: opts("props-src-mds"),
    mdtVal: document.getElementById("props-src-mdt").value,
    mdsVal: document.getElementById("props-src-mds").value,
    url: document.getElementById("props-src-mds-url").textContent
  };
  const sel = document.getElementById("props-src-mds");
  sel.value = "";
  sel.dispatchEvent(new Event("change"));
  r.noneUrl = document.getElementById("props-src-mds-url").textContent;
  r.during = elevSources.mds;
  document.getElementById("props-cancel").click();
  r.afterCancel = elevSources.mds;
  return r;
});
ok(tab.visible && tab.prefsHidden, "la pestaña se muestra y oculta las demás");
ok(tab.mdt.join() === "ign-mdt," && tab.mds.join() === "ign-mds,dea-cop30,", "opciones del catálogo más «Ninguna»: "
  + JSON.stringify([tab.mdt, tab.mds]));
ok(tab.mdtVal === "ign-mdt" && tab.mdsVal === "ign-mds", "por defecto, las del IGN");
ok(tab.url === "https://wcs-mds.idee.es/mds", "bajo el selector, la dirección del servicio: " + tab.url);
ok(tab.during === null && /No se consulta/.test(tab.noneUrl), "«Ninguna» se aplica al elegirla y lo dice");
ok(tab.afterCancel === "ign-mds", "Cancelar la deshace");
ok(count("servicios.idee.es", "GetCapabilities") + count("wcs-mds.idee.es", "GetCapabilities") === 0,
  "abrir Propiedades no consulta ningún servicio");

/* ---------- 3. Sin fuentes, la entrada se deshabilita ---------- */
const noSrc = await page.evaluate(() => {
  const keep = elevSources;
  elevSources = { mdt: null, mds: null };
  openCtxMenu(map.getCenter(), 600, 400, []);
  const b = [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")].find(x => /Consultar elevación/.test(x.textContent));
  const r = { disabled: b.disabled, title: b.title };
  closeCtxMenu();
  elevSources = keep;
  return r;
});
ok(noSrc.disabled && /Fuentes de datos/.test(noSrc.title), "sin fuentes, deshabilitada con el motivo: " + JSON.stringify(noSrc));

/* ---------- 4. Consultas con el IGN ---------- */
const q1 = await queryViaMenu(MADRID);
ok(q1.added === 1, "la consulta crea una capa: " + JSON.stringify(q1));
let shape = await treeShape();
ok(shape && shape.length === 1 && /^Sesión \d{4}-\d\d-\d\d \d\d:\d\d$/.test(shape[0].name)
  && shape[0].children.join() === "Elevación 1", "Elevaciones › Sesión … › Elevación 1: " + JSON.stringify(shape));
const cells1 = await page.evaluate(() => elevGridGroups.at(-1).getLayers().filter(l => l instanceof L.Rectangle).map(l => l._cell));
ok(cells1.length === 64, "las 64 celdas de la rejilla: " + cells1.length);
ok(cells1.every(c => typeof c.mdt === "number" && typeof c.mds === "number" && Math.abs(c.diff - 3) < 1e-6),
  "MDT, MDS y su diferencia en cada celda");
const coverage = seen.filter(s => s.request === "GetCoverage");
ok(coverage.every(s => /3857$/.test(s.params.get("subsettingCrs"))), "se pide en Web Mercator");
ok(coverage.some(s => s.params.get("coverageId") === "Elevacion4258_5") && coverage.some(s => s.params.get("coverageId") === "mds05"),
  "coberturas de 5 m: la geográfica del MDT (desempate) y la absoluta del MDS: " + coverage.map(s => s.params.get("coverageId")));
ok(coverage.every(s => s.params.get("format") === "ArcGrid"), "en ASCII aunque el MDT ofrezca también TIFF");

/* segunda consulta, otra tesela (unos 80 m al este) → misma carpeta */
const q2 = await queryViaMenu({ lat: MADRID.lat, lng: MADRID.lng + 0.001 });
shape = await treeShape();
ok(q2.added === 1 && shape.length === 1 && shape[0].children.join() === "Elevación 1,Elevación 2",
  "la segunda consulta va a la MISMA carpeta de sesión: " + JSON.stringify(shape));
ok(count("servicios.idee.es", "GetCapabilities") === 1 && count("wcs-mds.idee.es", "GetCapabilities") === 1,
  "GetCapabilities una sola vez por fuente y sesión");
ok(count("servicios.idee.es", "DescribeCoverage") === 2, "y la descripción solo de las candidatas de 5 m (2), no de todas: "
  + count("servicios.idee.es", "DescribeCoverage"));
const choice = await page.evaluate(() => msgLog.filter(e => /· IGN/.test(e.text)).map(e => ({ t: e.text, n: e.count })));
ok(choice.length === 2 && choice.every(c => c.n === 1), "la elección, una vez por fuente en el registro: " + JSON.stringify(choice));
ok(choice.some(c => /^MDT \(terreno\) · IGN.*Elevacion4258_5.*ArcGrid \(rejilla ASCII\).*celda ≈ 5\.0 m/.test(c.t)),
  "con cobertura, formato y celda: " + choice.map(c => c.t).join(" | "));

/* repetir la misma tesela: no pide nada, señala la que hay */
const nCov = seen.filter(s => s.request === "GetCoverage").length;
const q3 = await queryViaMenu(MADRID);
ok(q3.added === 0 && seen.filter(s => s.request === "GetCoverage").length === nCov
  && q3.log.some(t => /ya está descargada/.test(t)), "la misma tesela no se vuelve a pedir: " + JSON.stringify(q3.log));

/* ---------- 5. Unidades y cuadro de coordenadas ---------- */
const units = await page.evaluate(async () => {
  const g = elevGridGroups.at(-1);
  const label = g.getLayers().find(l => l instanceof L.Marker);
  const cell = label._cell;
  /* La unidad por defecto es la náutica: se parte de metros a mano */
  setMeasureUnit("m");
  map.setView(L.latLng(cell.center), 20, { animate: false });
  const html = () => label.getElement().innerHTML;
  const r = { m: html() };
  setMeasureUnit("ft");
  r.ft = html();
  /* el ratón sobre la celda: el cuadro lee lo descargado, sin red */
  const p = map.latLngToContainerPoint(L.latLng(cell.center));
  const rect = map.getContainer().getBoundingClientRect();
  r.point = { x: rect.left + p.x, y: rect.top + p.y };
  r.mdt = cell.mdt;
  return r;
});
ok(/ec-t">\d+\.\d</.test(units.m) && units.ft !== units.m, "cambiar la unidad repinta las celdas");
ok(units.ft.includes(`>${(units.mdt / 0.3048).toFixed(1)}<`), "en pies: " + units.ft);
const covBefore = seen.length;
await page.mouse.move(units.point.x, units.point.y);
await page.mouse.move(units.point.x + 1, units.point.y + 1);
await page.waitForFunction(() => !document.querySelector(".coords-alt").hidden);
const box = await page.evaluate(() => ({
  alt: document.querySelector(".coords-alt").textContent, sup: document.querySelector(".coords-sup").textContent
}));
ok(/^MDT \(terreno\): \d+\.\d ft$/.test(box.alt), "cuadro de coordenadas en pies: " + box.alt);
ok(/^MDS \(superficie\): .* ft · sobre el suelo \+9\.8 ft$/.test(box.sup), "con la diferencia (3 m = 9,8 ft): " + box.sup);
ok(seen.length === covBefore, "leer bajo el cursor no pide nada");
await page.evaluate(() => setMeasureUnit("m"));
await page.mouse.move(5, 5); /* fuera del visor, saliendo desde ENCIMA de la cuadrícula */
await page.waitForFunction(() => document.querySelector(".coords-alt").hidden);
ok(true, "al salir del visor (desde el lienzo de la cuadrícula), las filas de elevación se ocultan");

/* ---------- 6. MDS en «Ninguna» ---------- */
const mdsBefore = count("wcs-mds.idee.es", "GetCoverage");
await page.evaluate(() => { elevSources = { mdt: "ign-mdt", mds: null }; });
const q4 = await queryViaMenu({ lat: MADRID.lat, lng: MADRID.lng + 0.002 });
const only = await page.evaluate(() => {
  const ls = elevGridGroups.at(-1).getLayers();
  return {
    cells: ls.filter(l => l instanceof L.Rectangle).map(l => l._cell),
    html: ls.find(l => l instanceof L.Marker).getElement().innerHTML
  };
});
ok(q4.added === 1 && count("wcs-mds.idee.es", "GetCoverage") === mdsBefore, "con el MDS en «Ninguna» no se le pide nada");
ok(only.cells.every(c => !("mds" in c) && typeof c.mdt === "number" && c.diff === null), "y las celdas no llevan MDS");
ok(!/ec-s|ec-d/.test(only.html) && /ec-t/.test(only.html), "la cifra es solo la del terreno: " + only.html);

/* ---------- 7. Digital Earth Africa (GeoTIFF) ---------- */
await page.evaluate(() => { elevSources = { mdt: null, mds: "dea-cop30" }; });
const deaMadrid = seen.filter(s => s.host === "ows.digitalearth.africa" && s.request === "GetCoverage").length;
const q5 = await queryViaMenu(MADRID);
ok(!q5.log.some(t => /ya está descargada/.test(t)),
  "con otra fuente, la tesela de Madrid ya pedida al IGN es OTRA consulta: " + JSON.stringify(q5.log));
ok(q5.added === 0 && q5.log.some(t => /sin datos/.test(t)), "Madrid queda fuera de su caja WGS84: aviso y sin capa: " + JSON.stringify(q5.log));
ok(seen.filter(s => s.host === "ows.digitalearth.africa" && s.request === "GetCoverage").length === deaMadrid,
  "y no se llega a pedir la tesela");
const q6 = await queryViaMenu({ lat: 25, lng: 10 }); /* Sáhara: dentro de la caja, InvalidSubsetting */
ok(q6.added === 0 && q6.log.some(t => /sin datos/.test(t)), "InvalidSubsetting (404) se lee como «sin dato»: " + JSON.stringify(q6.log));
/* Centro del GeoTIFF real: x -1810026, y 3307026 en EPSG:3857 */
const tfe = await page.evaluate(() => { const ll = map.options.crs.unproject(L.point(-1810026, 3307026)); return { lat: ll.lat, lng: ll.lng }; });
const q7 = await queryViaMenu(tfe);
const dea = await page.evaluate(() => elevGridGroups.at(-1).getLayers().filter(l => l instanceof L.Rectangle).map(l => l._cell));
ok(q7.added === 1 && dea.length === 4, "el GeoTIFF de Digital Earth Africa se dibuja (2x2): " + JSON.stringify(q7));
ok(dea.every(c => !("mdt" in c) && "mds" in c), "solo superficie, sin terreno");
ok(dea.some(c => Math.abs(c.mds - 53.68) < 0.01), "con la altura del ráster: " + dea.map(c => c.mds));
const deaCov = seen.filter(s => s.host === "ows.digitalearth.africa" && s.request === "GetCoverage");
ok(deaCov.length >= 2 && deaCov.every(s => s.params.get("format") === "image/geotiff"), "pide GeoTIFF");
ok(deaCov.at(-1).params.get("subsettingCrs") === "EPSG:3857",
  "tras un InvalidSubsetting sigue pidiendo en Web Mercator (no abandona esa vía)");
const deaLog = await page.evaluate(() => msgLog.filter(e => /Digital Earth Africa/.test(e.text)).map(e => e.text));
ok(deaLog.length === 1 && /dem_cop_30.*image\/geotiff \(el servicio no ofrece rejilla ASCII\).*celda ≈ 3\d m/.test(deaLog[0]),
  "su elección en el registro, una vez: " + JSON.stringify(deaLog));
const attrib = await page.evaluate(() => document.querySelector(".leaflet-control-attribution").innerHTML);
ok(/IGN/.test(attrib) && /Copernicus DEM/.test(attrib), "atribución de cada fuente consultada");

/* ---------- 8. Aceptar persiste; tras recargar, sesión nueva ---------- */
await page.evaluate(async () => {
  await togglePropsDialog();
  document.getElementById("props-tab-btn-sources").click();
  document.getElementById("props-accept").click();
  await new Promise(r => setTimeout(r, 600)); /* guardado del árbol (debounce) */
});
await page.reload();
await page.waitForFunction(() => typeof map === "object" && document.querySelector("#tree ul.node-list"));
await page.waitForFunction(() => elevSources && elevSources.mds === "dea-cop30");
const after = await page.evaluate(() => elevSources);
ok(after.mdt === null && after.mds === "dea-cop30", "la elección sobrevive a la recarga: " + JSON.stringify(after));
const q8 = await queryViaMenu(tfe);
shape = await treeShape();
ok(q8.added === 1 && shape.length === 2 && shape[1].children.join() === "Elevación 5",
  "la carga nueva abre su propia carpeta de sesión, y la numeración sigue: " + JSON.stringify(shape));

/* El único 404 es el InvalidSubsetting simulado del paso 7 */
const realErrors = errors.filter(e => !/status of 404/.test(e));
ok(realErrors.length === 0, "sin errores en la consola: " + realErrors.join(" | "));
await browser.close();
srv.close();
done();
