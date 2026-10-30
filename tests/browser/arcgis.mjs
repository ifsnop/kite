/* Servicios ArcGIS (MapServer) como nodo del árbol, de punta a punta.

   Va en navegador porque lo que se prueba es el encadenado: que pegar una
   dirección en 🔗 lea SOLO el catálogo, que el nodo salga con una fila por
   capa, que las casillas decidan el `layers=show:` de las teselas (con UN
   redibujado aunque se pulsen varias seguidas), que la caja de cada tesela
   sea la que Leaflet calcula —también con el mapa girado—, que recargar no
   vuelva a pedir el catálogo, y que lo ajeno (un `.kite.json`) llegue
   apagado. El servidor es simulado con `ctx.route` sobre un dominio https
   de mentira: la CSP deja `connect-src`/`img-src` abiertas a https.   */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER ARCGIS TESTS OK");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const CORS = { "Access-Control-Allow-Origin": "*" };
const HOST = "https://mi-servidor.ejemplo.org";
const BASE = HOST + "/insignias/rest/services/CARPETA/Servicio_5/MapServer";
const L = (id, name, extra = {}) => ({ id, name, parentLayerId: -1, defaultVisibility: false,
  type: "Feature Layer", geometryType: "esriGeometryPolygon", ...extra });
const CATALOG = {
  currentVersion: 11.3, capabilities: "Map,Query,Data", copyrightText: "AIS de pruebas",
  maxImageWidth: 4096, maxImageHeight: 4096,
  fullExtent: { xmin: -1500000, ymin: 4200000, xmax: 500000, ymax: 5500000, spatialReference: { wkid: 102100, latestWkid: 3857 } },
  layers: [
    L(0, "FBZ"), L(10, "TMA_CTA", { defaultVisibility: true }), L(23, "TMA_CTA_texto", { defaultVisibility: true }),
    L(6, "CTR"), L(40, "Grupo", { type: "Group Layer", subLayerIds: [41, 42] }),
    L(41, "Hija A", { parentLayerId: 40 }), L(42, "Hija B", { parentLayerId: 40 })
  ],
  tables: [{ id: 19, name: "AIRSPACELAYERCLASS", type: "Table" }]
};

const srv = await serve(READABLE, 8874);
const browser = await launch();
const { ctx, page, errors } = await openApp(browser, srv.url);

/* Lo que ve el servidor simulado */
const peticiones = [];
/* Los datos de las capas: 5 entidades por capa, de 2 en 2 (maxRecordCount 2) */
const FEATS = id => Array.from({ length: 5 }, (_, i) => ({ type: "Feature", id: i + 1,
  properties: { OBJECTID: i + 1, NAME_TXT: `Zona ${id}-${i + 1}`, ...(id === 6 ? { LABEL: '<FNT name="x"> C </FNT> FL195' } : {}) },
  geometry: { type: "Polygon", coordinates: [[[-4 + i * 0.1, 40], [-3.9 + i * 0.1, 40], [-3.9 + i * 0.1, 40.1], [-4 + i * 0.1, 40]]] } }));
let qmodo = "ok";   /* "ok" | "error" | "503" | "big" | "hang" */
let fallos503 = 0;
const json = (route, body) => route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function datos(route, q, id, esQuery) {
  if (!esQuery) {
    return json(route, { name: CATALOG.layers.find(l => l.id === id).name, type: "Feature Layer", capabilities: "Map,Query,Data",
      supportedQueryFormats: "JSON, geoJSON, PBF", maxRecordCount: 2, advancedQueryCapabilities: { supportsPagination: id !== 23 },
      fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }] });
  }
  if (q.returnCountOnly) return json(route, { count: qmodo === "big" ? 100001 : 5 });
  if (qmodo === "error") return json(route, { error: { code: 400, message: "Consulta rota", details: [] } });
  if (qmodo === "503" && fallos503++ === 0) return route.fulfill({ status: 503, headers: CORS, body: "no" });
  if (qmodo === "hang") return new Promise(() => {});
  const all = FEATS(id), off = Number(q.resultOffset || 0), cnt = Number(q.resultRecordCount || 2);
  /* La capa 23 no pagina: ignora el desplazamiento y corta en su límite */
  const slice = id === 23 ? all.slice(0, 2) : all.slice(off, off + cnt);
  const cortado = id === 23 || off + cnt < all.length;
  const body = { type: "FeatureCollection", features: slice };
  if (id === 6) body.exceededTransferLimit = cortado;       /* la otra forma del indicador */
  else body.properties = { exceededTransferLimit: cortado };
  return json(route, body);
}
let modo = "ok"; /* "ok" | "error" (HTTP 200 con un {error} en el cuerpo, como ArcGIS) */
await ctx.route(HOST + "/**", route => {
  const u = new URL(route.request().url());
  const q = Object.fromEntries(u.searchParams);
  peticiones.push({ ruta: u.pathname, ...q });
  if (u.pathname.endsWith("/export")) {
    if (modo === "error") {
      return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: { code: 400, message: "Unable to complete operation.", details: ["Capa de prueba rota"] } }) });
    }
    return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "image/png" }, body: PNG });
  }
  const capa = /\/MapServer\/(\d+)(\/query)?$/.exec(u.pathname);
  if (capa) return datos(route, q, Number(capa[1]), !!capa[2]);
  return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(CATALOG) });
});
const catalogos = () => peticiones.filter(p => (p.f === "json" || p.f === "pjson") && p.ruta.endsWith("/MapServer")).length;
const exports_ = () => peticiones.filter(p => p.ruta.endsWith("/export"));
const esperar = async (cond, msg) => {
  for (let i = 0; i < 120; i++) { if (await cond()) return true; await page.waitForTimeout(50); }
  ok(false, "tiempo agotado: " + msg); return false;
};
const showDe = p => (p.layers || "").replace("show:", "");

/* El nodo del servicio y sus filas, tal como las ve el usuario */
const estado = () => page.evaluate(() => {
  const svc = [...document.querySelectorAll("#tree li.arcgis-service")][0];
  if (!svc) return null;
  const chk = li => li.querySelector(":scope > .node-row > input[type=checkbox]");
  const filas = [...svc.querySelectorAll("li")].map(li => ({
    nombre: li._name, id: li._arcgisLayer && li._arcgisLayer.id, marcada: chk(li).checked,
    botones: [...li.querySelectorAll(":scope > .node-row > .actions button")].map(b => b.getAttribute("aria-label")),
    fija: !!li._fixed
  }));
  return { nombre: svc._name, marcada: chk(svc).checked, mixta: chk(svc).indeterminate,
    enMapa: map.hasLayer(chk(svc)._layer), url: svc._arcgis.url, filas,
    seccion: svc.parentElement.closest("li") && svc.parentElement.closest("li")._name };
});
const marcar = (nombre, valor) => page.evaluate(([nombre, valor]) => {
  const li = [...document.querySelectorAll("#tree li.arcgis-service li")].find(l => l._name === nombre);
  const c = li.querySelector(":scope > .node-row > input[type=checkbox]");
  if (c.checked !== valor) c.click();
}, [nombre, valor]);

/* ---------- 1. Pegar una petición /export entera con un token ---------- */
await page.click("#url-btn");
await page.fill("#url-input", BASE + "/export?bbox=0,0,1,1&bboxSR=3857&size=512,512&layers=show:1,2&token=SECRETO&f=image");
await page.click("#url-fetch");
await esperar(async () => /Servicio de mapas ArcGIS/.test(await page.textContent("#url-status")), "el diálogo reconoce el servicio");
const estadoDlg = await page.textContent("#url-status");
ok(/Servicio_5/.test(estadoDlg) && /7 capa/.test(estadoDlg) && /6 con datos/.test(estadoDlg),
  "dice el nombre, cuántas capas (7: las tablas no cuentan) y cuántas con datos (6: sin el grupo): " + estadoDlg);
ok(peticiones.length === 1 && peticiones[0].f === "json" && !peticiones[0].token && !("layers" in peticiones[0]),
  "solo se pidió el catálogo (?f=json), sin la consulta ni el token pegados: " + JSON.stringify(peticiones));
ok(await page.evaluate(() => !document.querySelector("#tree li")), "y el árbol sigue vacío hasta pulsar «Añadir al árbol»");

/* ---------- 2. Añadir ---------- */
await page.click("#url-add");
await esperar(async () => !!(await estado()), "el nodo del servicio");
let st = await estado();
ok(st.seccion === "Servicios de mapas" && st.nombre === "Servicio_5", "cuelga de «Servicios de mapas» con el nombre del servicio: " + JSON.stringify([st.seccion, st.nombre]));
ok(st.url === BASE, "guarda la dirección sin consulta ni token: " + st.url);
ok(st.filas.map(f => f.nombre).join() === "FBZ,TMA_CTA,TMA_CTA_texto,CTR,Grupo,Hija A,Hija B", "una fila por capa, en el orden del servidor: " + st.filas.map(f => f.nombre));
ok(st.filas.filter(f => f.marcada).map(f => f.id).join() === "10,23", "marcadas las que el servidor da por visibles: " + JSON.stringify(st.filas.filter(f => f.marcada).map(f => f.id)));
ok(st.marcada && st.mixta && st.enMapa, "el servicio está en el mapa y su casilla en estado mixto");
ok(st.filas.every(f => f.fija && !f.botones.includes("Borrar") && !f.botones.includes("Subir") && !f.botones.includes("Bajar")),
  "las filas de las capas no se mueven ni se borran por separado: " + JSON.stringify(st.filas[0].botones));
ok(await page.evaluate(() => !!document.querySelector("#tree li.arcgis-service > .node-row > .actions button.delete")),
  "pero el servicio sí se puede borrar");

/* ---------- 3. Las teselas: show y caja ---------- */
await esperar(() => exports_().length > 0, "se piden teselas");
let e = exports_().pop();
ok(showDe(e) === "10,23", "layers=show: con las dos marcadas, en orden del catálogo: " + e.layers);
ok(e.bboxSR === "3857" && e.imageSR === "3857" && e.size === "512,512" && e.dpi === "96" && e.format === "png32" && e.transparent === "true" && e.f === "image",
  "parámetros de /export: " + JSON.stringify(e));
/* La caja de CADA tesela pedida es la que Leaflet calcula para esa tesela */
const cajas = () => page.evaluate(() => {
  const chk = document.querySelector("#tree li.arcgis-service > .node-row > input[type=checkbox]");
  const layer = chk._layer;
  const out = [];
  for (const t of Object.values(layer._tiles)) {
    const src = t.el.src;
    if (!src.includes("/export?")) continue;
    const bbox = new URL(src).searchParams.get("bbox").split(",").map(Number);
    const b = layer._tileCoordsToBounds(t.coords);
    const sw = L.CRS.EPSG3857.project(b.getSouthWest()), ne = L.CRS.EPSG3857.project(b.getNorthEast());
    out.push({ dx: Math.max(Math.abs(bbox[0] - sw.x), Math.abs(bbox[2] - ne.x)),
      dy: Math.max(Math.abs(bbox[1] - sw.y), Math.abs(bbox[3] - ne.y)), z: t.coords.z });
  }
  return out;
});
await esperar(async () => (await cajas()).length > 0, "teselas en el mapa");
let c = await cajas();
ok(c.every(t => t.dx < 0.01 && t.dy < 0.01), "la caja pedida coincide con la de Leaflet (< 1 cm): " + JSON.stringify(c.slice(0, 2)));
await page.evaluate(() => { map.setBearing(30); });
await page.evaluate(() => map.setView([40.4, -3.7], 7));
await esperar(async () => (await cajas()).length > 1, "teselas con el mapa girado");
c = await cajas();
ok(c.every(t => t.dx < 0.01 && t.dy < 0.01), "y girado 30° también (" + c.length + " teselas)");
ok(exports_().every(p => Math.abs(Number(p.bbox.split(",")[0])) <= 20037509), "ninguna tesela fuera del mundo, ni girado");
await page.evaluate(() => { map.setBearing(0); });

/* ---------- 4. Las casillas deciden el show, con UN redibujado ---------- */
peticiones.length = 0;
await marcar("CTR", true);
await marcar("FBZ", true);                     /* dos pulsaciones seguidas */
await esperar(() => exports_().some(p => showDe(p) === "0,10,23,6"), "el show con las dos nuevas");
await page.waitForTimeout(600);
ok(!exports_().some(p => showDe(p) === "10,23,6"), "no se llegó a pedir el estado intermedio (un solo redibujado)");
ok(exports_().every(p => showDe(p) === "0,10,23,6"), "todas las teselas posteriores llevan el show nuevo: " + [...new Set(exports_().map(showDe))]);
/* Un grupo marcado: pide sus hojas, nunca el id del grupo */
await marcar("Grupo", true);
await esperar(() => exports_().some(p => showDe(p).includes("41")), "el grupo pide sus hojas");
ok(exports_().filter(p => showDe(p).includes("41")).every(p => showDe(p) === "0,10,23,6,41,42"), "hojas del grupo y no el id 40");
await marcar("Grupo", false);

/* ---------- 5. Todo apagado: se va del mapa y no pide nada ---------- */
for (const n of ["FBZ", "TMA_CTA", "TMA_CTA_texto", "CTR"]) await marcar(n, false);
st = await estado();
ok(!st.marcada && !st.mixta && !st.enMapa, "sin ninguna capa marcada el servicio queda apagado y fuera del mapa: " + JSON.stringify([st.marcada, st.mixta, st.enMapa]));
peticiones.length = 0;
await page.evaluate(() => map.panBy([300, 0], { animate: false }));
await page.waitForTimeout(500);
ok(exports_().length === 0, "y ya no pide teselas");
/* Y al marcar el servicio entero, vuelven todas */
await page.evaluate(() => document.querySelector("#tree li.arcgis-service > .node-row > input[type=checkbox]").click());
await esperar(async () => (await estado()).enMapa, "el servicio vuelve al mapa");
st = await estado();
ok(st.filas.every(f => f.marcada), "marcar el servicio marca todas sus capas");
await esperar(() => exports_().some(p => showDe(p) === "0,10,23,6,41,42"), "y pide todas las hojas");
for (const n of ["FBZ", "CTR", "Hija A", "Hija B"]) await marcar(n, false);   /* vuelve a 10,23 */

/* ---------- 6. Propiedades: solo opacidad ---------- */
await page.evaluate(() => openStyleDialog(document.querySelector("#tree li.arcgis-service")));
ok(await page.evaluate(() => !document.getElementById("style-imageoverlay").hidden && document.getElementById("style-polygon").hidden),
  "el diálogo del servicio solo ofrece la opacidad");
await page.evaluate(() => { const r = document.getElementById("io-opacity"); r.value = "0.4"; r.dispatchEvent(new Event("input", { bubbles: true })); });
await esperar(() => page.evaluate(() => document.querySelector("#tree li.arcgis-service > .node-row > input")._layer.options.opacity === 0.4), "vista previa de la opacidad");
await page.click("#style-cancel");
ok(await page.evaluate(() => document.querySelector("#tree li.arcgis-service > .node-row > input")._layer.options.opacity === 1), "Cancelar la devuelve a 1");
await page.evaluate(() => openStyleDialog(document.querySelector("#tree li.arcgis-service")));
await page.evaluate(() => { const r = document.getElementById("io-opacity"); r.value = "0.4"; r.dispatchEvent(new Event("input", { bubbles: true })); });
await page.click("#style-accept");

/* ---------- 7. Las filas de las capas no se tocan ---------- */
await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li.arcgis-service li")].find(l => l._name === "CTR");
  moveCursorTo(li, false);
});
await page.keyboard.press("Delete");
await page.keyboard.press("F2");
st = await estado();
ok(st.filas.some(f => f.nombre === "CTR"), "Supr sobre una capa del servicio no la borra");
ok(await page.evaluate(() => !document.querySelector("#tree .rename-input")), "ni F2 la deja renombrar");
ok(await page.evaluate(() => /van con su servicio/.test(document.getElementById("nav-msg").textContent)), "y se explica por qué");

/* ---------- 8. Exportar: el servicio se nombra, no se abre ---------- */
const exp = await page.evaluate(() => {
  const li = document.querySelector("#tree li.arcgis-service");
  const recs = serializeNode(li);
  const kml = recordsToKml(recs), gj = recordsToGeoJson(recs);
  return { kml: kml.skipped.map(s => s.name), kmlCount: kml.count, gj: gj.skipped.map(s => s.name), gjCount: gj.count,
    json: recs[0].url, hijas: recs[0].children.length, nietas: recs[0].children.find(c => c.name === "Grupo").children.length };
});
ok(exp.kml.join() === "Servicio_5" && exp.gj.join() === "Servicio_5" && exp.kmlCount === 0 && exp.gjCount === 0,
  "KML y GeoJSON lo dejan fuera UNA vez y por su nombre: " + JSON.stringify(exp));
ok(exp.json === BASE && exp.hijas === 5 && exp.nietas === 2, "el .kite.json lo lleva entero, con el grupo y sus hijas: " + JSON.stringify(exp));

/* ---------- 9. Recargar: sin pedir el catálogo ---------- */
await page.waitForTimeout(900); /* el guardado va con retardo */
peticiones.length = 0;
await page.reload();
await waitAppReady(page);
await esperar(async () => !!(await estado()), "el servicio restaurado");
st = await estado();
ok(st.filas.length === 7 && st.filas.filter(f => f.marcada).map(f => f.id).join() === "10,23" && st.enMapa, "restaurado con sus capas y su estado: " + JSON.stringify(st.filas.filter(f => f.marcada).map(f => f.id)));
await esperar(() => exports_().length > 0, "vuelve a pedir teselas");
ok(catalogos() === 0, "sin volver a pedir el catálogo (" + catalogos() + " peticiones ?f=json)");
ok(exports_().every(p => showDe(p) === "10,23"), "con el show guardado");
ok(await page.evaluate(() => document.querySelector("#tree li.arcgis-service > .node-row > input")._layer.options.opacity === 0.4), "y la opacidad elegida");

/* ---------- 10. Borrar y deshacer ---------- */
await page.evaluate(() => document.querySelector("#tree li.arcgis-service > .node-row > .actions button.delete").click());
ok(await page.evaluate(() => arcgisLayersOnMap.size === 0 && !document.querySelector("#tree li.arcgis-service")), "borrar quita el servicio y su capa del mapa");
await page.keyboard.press("Control+z");
await esperar(async () => !!(await estado()), "deshacer lo devuelve");
st = await estado();
ok(st.enMapa && st.filas.length === 7 && st.filas.filter(f => f.marcada).length === 2, "con su estado");

/* ---------- 11. Lo ajeno llega apagado ---------- */
const sinConsultas = await page.evaluate(async () => {
  const li = document.querySelector("#tree li.arcgis-service");
  const doc = treeExportDoc(serializeNode(li));
  doc.nodes[0].name = "Ajeno";
  await importTreeExport(doc, "ajeno.kite.json");
  const copia = [...document.querySelectorAll("#tree li.arcgis-service")].find(l => l._name === "Ajeno");
  const chk = copia.querySelector(":scope > .node-row > input[type=checkbox]");
  return { apagada: !chk.checked && !map.hasLayer(chk._layer),
    hijasApagadas: [...copia.querySelectorAll("li")].every(l => !l.querySelector(":scope > .node-row > input").checked),
    aviso: document.getElementById("nav-msg").textContent };
});
ok(sinConsultas.apagada && sinConsultas.hijasApagadas, "un servicio de un archivo ajeno llega apagado, con todas sus capas");
ok(/llegan apagados/.test(sinConsultas.aviso) && /mi-servidor\.ejemplo\.org/.test(sinConsultas.aviso), "y se avisa nombrando el servidor: " + sinConsultas.aviso);
await page.evaluate(() => deleteNode([...document.querySelectorAll("#tree li.arcgis-service")].find(l => l._name === "Ajeno")));

/* Un registro manipulado no entra */
const manipulado = await page.evaluate(async () => {
  const li = document.querySelector("#tree li.arcgis-service");
  const doc = treeExportDoc(serializeNode(li));
  doc.nodes[0].url = "http://mi-servidor.ejemplo.org/rest/services/S/MapServer";
  const antes = document.querySelectorAll("#tree li.arcgis-service").length;
  await importTreeExport(doc, "malo.kite.json");
  return document.querySelectorAll("#tree li.arcgis-service").length - antes;
});
ok(manipulado === 0, "un servicio con dirección http no se construye");

/* ---------- 12. Un servicio que falla se ve ---------- */
modo = "error";
peticiones.length = 0;
await page.evaluate(() => map.setView([40.4, -3.7], 5));
await page.evaluate(() => map.setView([41.4, -3.7], 6));
await esperar(() => page.evaluate(() => /Capa de prueba rota/.test(document.getElementById("nav-msg").textContent)), "aviso con el texto del servidor");
const contarRojas = () => page.evaluate(() => document.querySelectorAll(".leaflet-tile.tile-error").length);
await esperar(async () => (await contarRojas()) > 0, "teselas con contorno rojo");
const rojas = await contarRojas();
ok(rojas > 0, "las teselas fallidas llevan el contorno rojo (" + rojas + ")");
await page.waitForTimeout(400);
const avisos = await page.evaluate(() => [...document.querySelectorAll("#nav-msg .nav-msg-line")].map(l => l.textContent).filter(t => /Capa de prueba rota/.test(t)));
ok(avisos.length === 1, "el motivo se avisa UNA vez: " + avisos.length);
modo = "ok";

/* ---------- 13. Un servicio dentro de una carpeta nunca desplegada ---------- */
peticiones.length = 0;
const pendiente = await page.evaluate(async () => {
  const svc = document.querySelector("#tree li.arcgis-service");
  const nodes = [{ t: "folder", name: "Carpeta oculta", checked: true, collapsed: true,
    children: serializeNode(svc).map(n => ({ ...n, name: "Servicio en carpeta" })) }];
  const recs = await buildRecordsFromStorage(nodes, null);
  await materializeRecords(recs, ensureRootUl());
  const folder = [...document.querySelectorAll("#tree > ul > li")].find(l => l._name === "Carpeta oculta");
  const rec = folder._pending[0];
  return { pendiente: !!folder._pending, sinFilas: !folder.querySelector("li"),
    igual: JSON.stringify(serializeNode(folder)[0].children) === JSON.stringify(nodes[0].children),
    enMapa: map.hasLayer(rec._layer) };
});
ok(pendiente.pendiente && pendiente.sinFilas, "la carpeta queda sin desplegar: sus hijos son registros pendientes");
ok(pendiente.igual, "y un servicio pendiente se serializa igual que uno con filas");
ok(pendiente.enMapa, "pero su capa está en el mapa, porque estaba marcado");
await esperar(() => exports_().length > 0, "el servicio pendiente pide teselas");
const cascada = async marcar => page.evaluate(async marcar => {
  const folder = [...document.querySelectorAll("#tree > ul > li")].find(l => l._name === "Carpeta oculta");
  const chk = folder.querySelector(":scope > .node-row > input[type=checkbox]");
  if (chk.checked !== marcar) chk.click();
  await new Promise(r => setTimeout(r, 300));
  return { enMapa: map.hasLayer(folder._pending[0]._layer), hijas: folder._pending[0].children.map(c => c.checked) };
}, marcar);
let cas = await cascada(false);
ok(!cas.enMapa && cas.hijas.every(h => h === false), "apagar la carpeta apaga la capa del servicio pendiente y todas sus hijas: " + JSON.stringify(cas));
peticiones.length = 0;
cas = await cascada(true);
ok(cas.enMapa && cas.hijas.every(h => h === true), "y encenderla la vuelve a poner en el mapa con todas las hijas: " + JSON.stringify(cas));
await esperar(() => exports_().some(p => showDe(p) === "0,10,23,6,41,42"), "y la capa pide el show de las hojas marcadas aunque no haya filas");
await page.evaluate(() => deleteNode([...document.querySelectorAll("#tree > ul > li")].find(l => l._name === "Carpeta oculta")));
ok(await page.evaluate(() => arcgisLayersOnMap.size === 1), "borrar la carpeta quita también la capa del servicio pendiente (queda solo el otro)");

/* ---------- 14. Un árbol v8 (anterior a los servicios) se lee tal cual ---------- */
const ctx2 = await browser.newContext({ serviceWorkers: "block", locale: "es-ES" });
const p2 = await ctx2.newPage();
await p2.goto(srv.url);
await waitAppReady(p2);
await p2.evaluate(() => new Promise((res, rej) => {
  const rq = indexedDB.open("visor-kml");
  rq.onsuccess = () => {
    const tx = rq.result.transaction("tree", "readwrite");
    tx.objectStore("tree").put({ v: 8, nodes: [{ t: "folder", name: "Viejo v8", checked: true, collapsed: true, children: [] }] }, "root");
    tx.oncomplete = () => { rq.result.close(); res(); };
    tx.onerror = () => rej(tx.error);
  };
}));
await p2.reload();
await p2.waitForFunction(() => typeof rootUl !== "undefined" && rootUl && rootUl.children.length > 0, null, { timeout: 15000 });
ok(await p2.evaluate(() => TREE_SCHEMA === 9 && [...rootUl.children].some(li => li._name === "Viejo v8")),
  "con TREE_SCHEMA 9, un árbol guardado en v8 se lee tal cual");
await ctx2.close();

/* ---------- 15. Traer una capa como datos ---------- */
const traer = nombre => page.evaluate(n => {
  const li = [...document.querySelectorAll("#tree li.arcgis-service li")].find(l => l._name === n);
  li.querySelector(".arcgis-data").click();
}, nombre);
const botonDatos = nombre => page.evaluate(n => {
  const b = [...document.querySelectorAll("#tree li.arcgis-service li")].find(l => l._name === n).querySelector(".arcgis-data");
  return b ? { modo: b.dataset.mode, glifo: b.textContent, titulo: b.title } : null;
}, nombre);
const nombrar = async clave => {
  await page.waitForFunction(() => !document.getElementById("geojson-name-picker").hidden);
  await page.click(`#gnp-list .gnp-row[data-key="${clave}"] input`);
  await page.click("#gnp-accept");
};
/* Los nombres de TODO el árbol, también de lo que no tiene fila: un GeoJSON llega colapsado */
const nombresArbol = () => page.evaluate(() => {
  const out = [];
  const walk = ns => ns.forEach(n => { out.push(n.name); if (n.children) walk(n.children); });
  walk(serializeTree());
  return out;
});
const consultas = id => peticiones.filter(p => p.ruta.endsWith(`/MapServer/${id}/query`) && !p.returnCountOnly);

ok(await page.evaluate(() => [...document.querySelectorAll("#tree li.arcgis-service li")]
  .filter(l => l._arcgisLayer.data).every(l => !!l.querySelector(".arcgis-data"))
  && ![...document.querySelectorAll("#tree li.arcgis-service li")].find(l => l._name === "Grupo").querySelector(":scope > .node-row .arcgis-data")),
  "solo las capas con datos llevan el botón ⤓ (el grupo no)");
let bd = await botonDatos("TMA_CTA");
ok(bd.modo === "fetch" && /Traer las entidades de esta capa/.test(bd.titulo), "con su título: " + JSON.stringify(bd));

/* A. Tres páginas, de 2 en 2 */
peticiones.length = 0;
await traer("TMA_CTA");
await page.waitForFunction(() => !document.getElementById("geojson-name-picker").hidden);
const ficha = peticiones.filter(p => p.ruta.endsWith("/MapServer/10") && p.f === "json");
const cuenta = peticiones.filter(p => p.returnCountOnly === "true");
const paginas = consultas(10);
ok(ficha.length === 1 && cuenta.length === 1, "pide la ficha de la capa y el recuento una vez cada uno");
ok(paginas.map(p => p.resultOffset).join() === "0,2,4" && paginas.every(p => p.resultRecordCount === "2"),
  "y los datos en tres páginas de 2: " + JSON.stringify(paginas.map(p => [p.resultOffset, p.resultRecordCount])));
ok(paginas.every(p => p.orderByFields === "OBJECTID" && p.outSR === "4326" && p.outFields === "*" && p.f === "geojson"
  && p.returnGeometry === "true" && p.where === "1=1" && !p.geometry),
  "con orden estable, WGS84, todos los atributos, GeoJSON y sin filtro espacial: " + JSON.stringify(paginas[0]));
await nombrar("NAME_TXT");
await esperar(async () => (await nombresArbol()).includes("Zona 10-5"), "las cinco entidades en el árbol");
let nombres = await nombresArbol();
ok(nombres.includes("Descargas") && nombres.includes("Descarga 1") && ["Zona 10-1", "Zona 10-2", "Zona 10-3", "Zona 10-4", "Zona 10-5"].every(n => nombres.includes(n)),
  "entran en «Descargas › Descarga 1» como una importación normal, con el nombre elegido");
ok(await page.evaluate(() => document.getElementById("progress").hidden), "la barra de progreso se oculta");
bd = await botonDatos("TMA_CTA");
ok(bd.modo === "fetch", "y el botón vuelve a su estado");
await page.keyboard.press("Control+z");
await esperar(async () => !(await nombresArbol()).includes("Zona 10-1"), "deshacer quita lo traído");
ok(!(await nombresArbol()).includes("Descarga 1"), "entero, con su carpeta «Descarga 1»");

/* B. Las etiquetas HTML de los atributos: la pregunta de siempre */
await traer("CTR");
await page.waitForFunction(() => !document.getElementById("kml-tags-picker").hidden);
ok(await page.evaluate(() => /propiedades/.test(document.getElementById("ktp-intro").textContent)), "una capa con etiquetas en sus atributos abre la pregunta de las etiquetas HTML");
await page.click("#ktp-accept");
await nombrar("NAME_TXT");
await esperar(async () => (await nombresArbol()).includes("Zona 6-1"), "las entidades de CTR");
ok(await page.evaluate(() => {
  let label = null;
  const walk = ns => ns.forEach(n => { if (n.name === "Zona 6-1" && n.geo) label = n.geo.features[0].properties.LABEL; if (n.children) walk(n.children); });
  walk(serializeTree());
  return typeof label === "string" && !/FNT/.test(label) && /FL195/.test(label);
}), "respondida «Eliminarlas», la etiqueta ya no está en el atributo y el texto sí");
ok(consultas(6).map(p => p.resultOffset).join() === "0,2,4", "el indicador de corte en lo alto de la respuesta también pagina");

/* C. Un {error} del servicio: una sola vez y sin carpeta nueva */
qmodo = "error";
peticiones.length = 0;
const antes = (await nombresArbol()).filter(n => /^Descarga \d+$/.test(n)).length;
await traer("TMA_CTA");
await esperar(() => page.evaluate(() => /Consulta rota/.test(document.getElementById("nav-msg").textContent)), "el aviso con el texto del servidor");
ok(consultas(10).length === 1, "un {error} no se reintenta: " + consultas(10).length + " consulta(s)");
ok((await nombresArbol()).filter(n => /^Descarga \d+$/.test(n)).length === antes, "y no deja ninguna carpeta");
ok((await botonDatos("TMA_CTA")).modo === "fetch" && await page.evaluate(() => document.getElementById("progress").hidden), "el botón y la barra vuelven a su estado");

/* D. Un 503 pasajero sí se reintenta */
qmodo = "503"; fallos503 = 0;
peticiones.length = 0;
await traer("TMA_CTA");
/* Con el nombre ya elegido en A para esta forma de atributos, el selector no vuelve a preguntar */
await esperar(async () => (await nombresArbol()).includes("Zona 10-1"), "lo traído tras el reintento");
ok(consultas(10).filter(p => p.resultOffset === "0").length === 2, "tras un 503 repite la primera página y sigue: " + JSON.stringify(consultas(10).map(p => p.resultOffset)));
ok(await page.evaluate(() => document.getElementById("geojson-name-picker").hidden),
  "y con la misma forma de atributos usa el nombre ya elegido, sin volver a preguntar");

/* E. Demasiadas entidades: se rechaza sin pedir ninguna */
qmodo = "big";
peticiones.length = 0;
await traer("TMA_CTA");
await esperar(() => page.evaluate(() => /100001 entidades/.test(document.getElementById("nav-msg").textContent)), "el aviso del tope");
ok(consultas(10).length === 0, "sin pedir ni una página");

/* F. Cancelar una descarga en vuelo */
qmodo = "hang";
peticiones.length = 0;
await traer("TMA_CTA");
await esperar(() => consultas(10).length === 1, "la consulta en vuelo");
bd = await botonDatos("TMA_CTA");
ok(bd.modo === "cancel" && /Cancelar/.test(bd.titulo), "mientras descarga el botón pasa a cancelar: " + JSON.stringify(bd));
await traer("TMA_CTA");
await esperar(() => page.evaluate(() => /cancelada/.test(document.getElementById("nav-msg").textContent)), "el aviso de cancelación");
bd = await botonDatos("TMA_CTA");
ok(bd.modo === "fetch" && await page.evaluate(() => document.getElementById("progress").hidden && document.getElementById("geojson-name-picker").hidden),
  "pulsarlo otra vez cancela en el acto, sin diálogo ni barra");

/* G. Un servidor sin paginación corta en su límite: se importa lo que hay y se dice */
qmodo = "ok";
peticiones.length = 0;
await traer("TMA_CTA_texto");
await esperar(async () => (await nombresArbol()).includes("Zona 23-2"), "las dos entidades que entregó");
ok(consultas(23).length === 1 && consultas(23)[0].resultOffset === undefined && consultas(23)[0].orderByFields === undefined,
  "sin paginación, UNA consulta sin desplazamiento ni orden");
ok(await page.evaluate(() => /entregó 2 de 5 entidades/.test(document.getElementById("nav-msg").textContent)), "y el aviso dice cuántas de cuántas");
ok(!(await nombresArbol()).includes("Zona 23-3"), "sin inventar las demás");

ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de CSP: " + JSON.stringify(await page.evaluate(() => window.__csp)));
ok(errors.filter(e => !/Failed to load resource/.test(e)).length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
