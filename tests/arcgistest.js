/* Servicios ArcGIS (MapServer) como nodo del árbol: las piezas puras de
   `66-arcgis.js`. Direcciones pegadas (la página del servicio, `?f=json`,
   una capa, una petición /export entera) y las que NO son un servicio,
   el catálogo real de ENAIRE (fixture), grupos/ciclos/huérfanas, el
   extent en 3857, la caja de una tesela, la URL de /export, los id de
   `layers=show:` y la validación de un registro ajeno.                  */
const fs = require("fs");
const path = require("path");
const { fn, between } = require("./_extract");
const consts = between("const ARCGIS_MAX_LAYERS", "/* Base address of a MapServer");
const src = consts + [
  fn("describeHttp"), fn("arcgisServiceBase"), fn("arcgisServiceName"), fn("arcgisErrorText"),
  fn("arcgisTileReason"), fn("arcgisExtent4326"), fn("parseArcgisCatalog"), fn("arcgisCatalogRecord"),
  fn("sanitizeArcgisRecord"), fn("arcgisShowIds"), fn("tileBbox3857"), fn("arcgisExportUrl")].join("\n");
const api = new Function(src + "\nreturn {arcgisServiceBase, arcgisServiceName, arcgisErrorText," +
  " arcgisTileReason, arcgisExtent4326, parseArcgisCatalog, arcgisCatalogRecord, sanitizeArcgisRecord," +
  " arcgisShowIds, tileBbox3857, arcgisExportUrl, ARCGIS_MAX_LAYERS, ARCGIS_MAX_DEPTH};")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const same = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " — " + JSON.stringify(a) + " ≠ " + JSON.stringify(b));

const BASE = "https://mi-servidor.ejemplo.org/insignias/rest/services/CARPETA/Servicio_5/MapServer";

/* ---------- Direcciones ---------- */
for (const pasted of [
  BASE, BASE + "/", "  " + BASE + "  ", BASE + "?f=json", BASE + "?f=pjson", BASE + "?f=json&token=SECRETO",
  BASE + "#ancla", BASE + "/10", BASE + "/10/", BASE + "/10?f=json", BASE + "/legend?f=json", BASE + "/layers?f=json",
  BASE + "/export?bbox=0,0,1,1&bboxSR=3857&size=512,512&layers=show:1,2&f=image", BASE + "/identify?geometry=1,2",
  BASE.replace("MapServer", "MAPSERVER"), BASE + "/EXPORT?f=image"]) {
  const r = api.arcgisServiceBase(pasted);
  ok(r && r.base, "se reconoce: " + pasted);
  ok(r && !/[?#]/.test(r.base) && !r.base.endsWith("/"), "base sin consulta ni ancla ni barra: " + pasted);
  ok(!r || !/SECRETO/.test(r.base), "un token pegado no se conserva");
}
same(api.arcgisServiceBase(BASE + "?f=json"), { base: BASE }, "la base es exactamente la del servicio");
same(api.arcgisServiceBase("https://x.example.org/arcgis/rest/services/S/MapServer/"), { base: "https://x.example.org/arcgis/rest/services/S/MapServer" },
  "un servicio sin carpeta");

/* Lo que NO es un servicio: sigue el camino normal de descarga (null) */
for (const other of [
  BASE + "/10/query?where=1%3D1&f=geojson", BASE + "/query?f=json",
  BASE.replace("MapServer", "FeatureServer"), BASE.replace("MapServer", "ImageServer"),
  BASE.replace("MapServer", "WMSServer"), "https://x.example.org/datos.geojson", "https://x.example.org/",
  "https://x.example.org/rest/services/S/MapServer/Otra/Cosa", BASE + "/10/identify",
  "https://x.example.org/otra/ruta/MapServer", "no es una url", "", "   "]) {
  same(api.arcgisServiceBase(other), null, "no es un servicio: " + other);
}
/* Es un servicio pero no se puede usar: se dice por qué */
same(api.arcgisServiceBase(BASE.replace("https", "http")), { error: "https" }, "http no vale");
same(api.arcgisServiceBase(BASE.replace("https://", "https://usuario:clave@")), { error: "credentials" }, "con credenciales no vale");

same(api.arcgisServiceName(BASE), "Servicio_5", "nombre del nodo: el tramo anterior a MapServer");
same(api.arcgisServiceName("https://x.example.org/rest/services/Mi%20Servicio/MapServer"), "Mi Servicio", "decodifica el nombre");

/* ---------- El catálogo REAL de ENAIRE ---------- */
const real = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "arcgis-mapserver.json"), "utf8"));
const cat = api.parseArcgisCatalog(real);
ok(!cat.error, "el catálogo real se lee: " + cat.error);
ok(cat.count === 28 && cat.layers.length === 28, "28 capas, todas en la raíz (sin grupos)");
same(cat.layers.slice(0, 7).map(l => l.id), [0, 1, 2, 3, 4, 24, 27], "orden de la tabla de contenidos, ids NO contiguos");
ok(!cat.layers.some(l => l.id === 19 || l.id === 20), "las tablas (19, 20) no son capas");
same(cat.layers.filter(l => l.checked).map(l => l.id), [10, 23, 26, 11], "marcadas: las de defaultVisibility");
ok(cat.hasQuery && cat.dataCount === 28 && cat.layers.every(l => l.data === true), "todas ofrecen datos (Query + Feature Layer)");
same(cat.tile, 512, "teselas de 512 con maxImageWidth 4096");
same(cat.attribution, "AIS", "copyrightText");
ok(cat.extent && cat.extent[1] < -39 && cat.extent[1] > -41 && cat.extent[3] > 11 && cat.extent[3] < 13, "fullExtent 102100 → grados: " + JSON.stringify(cat.extent));
ok(cat.extent[0] > -13 && cat.extent[0] < -11 && cat.extent[2] > 60 && cat.extent[2] < 62, "latitudes del extent: " + JSON.stringify(cat.extent));

const rec = api.arcgisCatalogRecord(cat, BASE);
same(rec.t, "arcgis", "tipo del nodo"); same(rec.url, BASE, "url del nodo"); same(rec.name, "Servicio_5", "nombre");
ok(rec.checked === true && rec.opacity === 1 && rec.children.length === 28, "registro completo");
same(api.arcgisShowIds(rec.children), [10, 23, 26, 11], "layers=show de lo marcado, en orden del catálogo");
const clean = api.sanitizeArcgisRecord(JSON.parse(JSON.stringify(rec)));
ok(clean && clean.children.length === 28, "un registro bueno pasa la validación");
same(JSON.stringify(clean), JSON.stringify(rec), "…y no cambia nada");

/* ---------- Grupos, ciclos, huérfanas, topes ---------- */
const L = (id, extra) => Object.assign({ id, name: "c" + id, parentLayerId: -1, defaultVisibility: true, type: "Feature Layer" }, extra);
const mk = (layers, extra) => Object.assign({ capabilities: "Map,Query,Data", layers }, extra);
const tree = api.parseArcgisCatalog(mk([
  L(5, { type: "Group Layer", subLayerIds: [6, 7] }), L(6, { parentLayerId: 5 }),
  L(7, { parentLayerId: 5, defaultVisibility: false }), L(8)]));
same(tree.layers.map(l => l.id), [5, 8], "los hijos de un grupo cuelgan de él");
same(tree.layers[0].children.map(c => c.id), [6, 7], "hijos en orden");
ok(tree.layers[0].checked === false, "un grupo con un hijo apagado no está entero");
ok(!tree.layers[0].data, "un grupo no ofrece datos");
same(api.arcgisShowIds(api.arcgisCatalogRecord(tree, BASE).children), [6, 8], "solo hojas: nunca el id de un grupo");

const hidden = api.parseArcgisCatalog(mk([L(1, { type: "Group Layer", defaultVisibility: false }), L(2, { parentLayerId: 1 })]));
ok(hidden.layers[0].children[0].checked === false, "una capa dentro de un grupo apagado empieza apagada");

const cycle = api.parseArcgisCatalog(mk([L(1, { parentLayerId: 2 }), L(2, { parentLayerId: 1 }), L(3, { parentLayerId: 3 })]));
ok(!cycle.error && cycle.layers.length === 3, "un ciclo (y una capa hija de sí misma) se corta: todas a la raíz");
const orphan = api.parseArcgisCatalog(mk([L(1, { parentLayerId: 99 })]));
same(orphan.layers.map(l => l.id), [1], "una huérfana va a la raíz");
const dup = api.parseArcgisCatalog(mk([L(1), L(1, { name: "otra" }), { id: "x" }, null, L(-3), L(1.5)]));
same(dup.layers.map(l => l.id), [1], "id repetidos, no enteros o negativos se ignoran");

let deep = [], parent = -1;
for (let i = 0; i < api.ARCGIS_MAX_DEPTH + 5; i++) { deep.push(L(i, { parentLayerId: parent })); parent = i; }
const deepCat = api.parseArcgisCatalog(mk(deep));
let depth = 0, node = deepCat.layers[0];
while (node) { depth++; node = node.children && node.children[0]; }
ok(depth === api.ARCGIS_MAX_DEPTH, "la profundidad se corta en " + api.ARCGIS_MAX_DEPTH + " (da " + depth + ")");

const many = Array.from({ length: api.ARCGIS_MAX_LAYERS + 1 }, (_, i) => L(i));
ok(api.parseArcgisCatalog(mk(many)).error, "más capas que el tope: error");
ok(!api.parseArcgisCatalog(mk(many.slice(1))).error, "justo el tope: vale");

ok(api.parseArcgisCatalog({ error: { code: 400, message: "Invalid URL", details: ["detalle"] } }).error === "Invalid URL: detalle (400)",
  "{error} del servicio");
ok(api.parseArcgisCatalog({ error: { code: 499, message: "Token Required" } }).error.includes("credencial"), "498/499: dice que hace falta un token");
for (const bad of [null, 5, "x", [], {}, { layers: "no" }, { layers: [] }, { layers: [null] }]) {
  ok(api.parseArcgisCatalog(bad).error, "no es un MapServer: " + JSON.stringify(bad));
}
ok(api.parseArcgisCatalog({ capabilities: "Query", layers: [L(1)] }).error, "sin capacidad Map: se rechaza");
const noQuery = api.parseArcgisCatalog({ capabilities: "Map", layers: [L(1)] });
ok(!noQuery.hasQuery && !noQuery.layers[0].data, "sin Query ninguna capa ofrece datos");
same(api.parseArcgisCatalog(mk([L(1)], { maxImageWidth: 256, maxImageHeight: 256 })).tile, 256, "servidor de imágenes pequeñas: teselas de 256");
same(api.parseArcgisCatalog(mk([L(1, { type: "Raster Layer" })])).layers[0].data, undefined, "solo una Feature Layer ofrece datos");

/* ---------- Extent ---------- */
const E = (o, wkid) => Object.assign({ spatialReference: { wkid } }, o);
const e1 = api.arcgisExtent4326(E({ xmin: -20037508.34, ymin: -20037508.34, xmax: 20037508.34, ymax: 20037508.34 }, 102100));
ok(Math.abs(e1[1] + 180) < 1e-6 && Math.abs(e1[3] - 180) < 1e-6 && Math.abs(e1[2] - 85.05112878) < 1e-6, "3857 del mundo entero: " + JSON.stringify(e1));
same(api.arcgisExtent4326(E({ xmin: -10, ymin: 35, xmax: 5, ymax: 45 }, 4326)), [35, -10, 45, 5], "4326 tal cual");
same(api.arcgisExtent4326(E({ xmin: -10, ymin: 35, xmax: 5, ymax: 45 }, 25830)), null, "un CRS que no sabemos convertir: sin extent");
same(api.arcgisExtent4326(E({ xmin: 5, ymin: 35, xmax: -10, ymax: 45 }, 4326)), null, "caja invertida");
same(api.arcgisExtent4326(E({ xmin: "a", ymin: 35, xmax: 5, ymax: 45 }, 4326)), null, "no numérico");
same(api.arcgisExtent4326(null), null, "sin extent");
same(api.arcgisExtent4326({ xmin: -400, ymin: -95, xmax: 400, ymax: 95, spatialReference: { latestWkid: 4326 } }), [-85.05112878, -180, 85.05112878, 180], "se recorta al mundo del visor");

/* ---------- Caja de una tesela y /export ---------- */
const w = Math.PI * 6378137;
const z0 = api.tileBbox3857(0, 0, 0, 256);
ok(Math.abs(z0[0] + w) < 1e-6 && Math.abs(z0[2] - w) < 1e-6 && Math.abs(z0[1] + w) < 1e-6 && Math.abs(z0[3] - w) < 1e-6, "z0 con teselas de 256: el mundo entero");
const z1 = api.tileBbox3857(0, 0, 1, 512);
ok(Math.abs(z1[0] + w) < 1e-6 && Math.abs(z1[2] - w) < 1e-6, "z1 con teselas de 512: el mundo entero (sin zoomOffset)");
const t = api.tileBbox3857(1, 1, 2, 512);
ok(Math.abs(t[0] - 0) < 1e-6 && Math.abs(t[3] - 0) < 1e-6 && Math.abs((t[2] - t[0]) - w) < 1e-6, "z2/512, tesela (1,1): cuadrante sureste del mundo… " + JSON.stringify(t));
ok(Math.abs((t[2] - t[0]) - (t[3] - t[1])) < 1e-6, "teselas cuadradas");

same(api.arcgisExportUrl(BASE, [-1100000, 4300000.12345, 500000, 5500000], 512, 96, [10, 23, 6]),
  BASE + "/export?bbox=-1100000,4300000.123,500000,5500000&bboxSR=3857&imageSR=3857&size=512,512&dpi=96"
  + "&format=png32&transparent=true&layers=show:10,23,6&f=image", "URL de /export exacta");
ok(api.arcgisExportUrl(BASE, [0, 0, 1, 1], 1024, 192, [1]).includes("size=1024,1024&dpi=192"), "HiDPI: más píxeles y más dpi");

/* ---------- Errores del servidor ---------- */
same(api.arcgisErrorText({ code: 400, message: "Unable to complete operation.", details: ["Invalid layers"] }),
  "Unable to complete operation.: Invalid layers (400)", "texto del error");
ok(api.arcgisErrorText({ message: "x".repeat(500) }).length <= 201, "el texto largo se corta");
ok(api.arcgisErrorText(null).includes("sin explicación"), "error vacío");
same(api.arcgisTileReason(200, "image/png", ""), null, "una imagen no es un fallo");
same(api.arcgisTileReason(200, "application/json", '{"error":{"code":400,"message":"Capa inexistente"}}'), "Capa inexistente (400)", "el error JSON viaja con HTTP 200");
ok(api.arcgisTileReason(404, "text/html", "<html>").includes("404"), "HTTP sin JSON: el estado");
ok(api.arcgisTileReason(200, "text/html; charset=utf-8", "<html>").includes("text/html"), "respuesta que no es imagen");

/* ---------- Un registro ajeno ---------- */
const good = () => JSON.parse(JSON.stringify(rec));
ok(api.sanitizeArcgisRecord(good()), "base");
const bad = f => { const r = good(); f(r); return api.sanitizeArcgisRecord(r); };
ok(bad(r => { r.url = BASE.replace("https", "http"); }) === null, "http: se descarta el servicio");
ok(bad(r => { r.url = BASE + "?token=SECRETO"; }) === null, "con consulta: se descarta (nunca se guarda un token)");
ok(bad(r => { r.url = BASE + "/"; }) === null, "la dirección debe ser exactamente la normalizada");
ok(bad(r => { r.url = 5; }) === null, "url no es texto");
ok(bad(r => { r.url = "https://u:p@x.example.org/rest/services/S/MapServer"; }) === null, "con credenciales");
ok(bad(r => { r.children = []; }) === null, "sin capas no hay servicio");
ok(bad(r => { r.children = "x"; }) === null, "hijos que no son lista");
ok(bad(r => { r.t = "folder"; }) === null, "otro tipo");
same(bad(r => { r.opacity = 7; }).opacity, 1, "opacidad fuera de rango → 1");
same(bad(r => { r.opacity = "a"; }).opacity, 1, "opacidad no numérica → 1");
same(bad(r => { r.extent = [1, 2, 3]; }).extent, null, "extent mal formado → null");
same(bad(r => { r.extent = [10, 0, 5, 1]; }).extent, null, "extent invertido → null");
same(bad(r => { r.extent = [-95, 0, 5, 1]; }).extent, null, "extent fuera del mundo → null");
same(bad(r => { r.tile = 100000; }).tile, 512, "tamaño de tesela desconocido → 512");
same(bad(r => { r.attribution = "x".repeat(900); }).attribution.length, 200, "atribución acotada");
same(bad(r => { r.attribution = { a: 1 }; }).attribution, "", "atribución que no es texto");
same(bad(r => { r.children[0].id = "7"; }).children.length, 27, "un hijo con id no entero se descarta");
same(bad(r => { r.children[0].id = -1; }).children.length, 27, "id negativo");
same(bad(r => { r.children[0].id = 2 ** 31; }).children.length, 27, "id fuera de 32 bits");
same(bad(r => { r.children[1].id = r.children[0].id; }).children.length, 27, "id repetido");
same(bad(r => { r.children[0].t = "layer"; }).children.length, 27, "un hijo de otro tipo");
same(bad(r => { r.children.push(null, 3, "x"); }).children.length, 28, "basura entre los hijos");
same(bad(r => { r.children[0].name = "n".repeat(900); }).children[0].name.length, 300, "nombre acotado");
const nest = good(); let cur = nest;
for (let i = 0; i < 30; i++) { const c = { t: "arcgisLayer", name: "n", checked: true, id: 1000 + i, children: [] }; cur.children.push(c); cur = c; }
const nested = api.sanitizeArcgisRecord(nest);
let nd = 0, nn = nested; while (nn && nn.children) { nd++; nn = nn.children.find(c => c.id >= 1000); }
ok(nd <= api.ARCGIS_MAX_DEPTH, "profundidad acotada al leer (" + nd + ")");
const huge = good(); huge.children = Array.from({ length: 10000 }, (_, i) => ({ t: "arcgisLayer", name: "c", checked: true, id: i }));
same(api.sanitizeArcgisRecord(huge).children.length, api.ARCGIS_MAX_LAYERS, "diez mil hijos se quedan en el tope");
const groupData = good(); groupData.children[0] = { t: "arcgisLayer", name: "g", checked: false, id: 900, data: true, children: [{ t: "arcgisLayer", name: "h", checked: true, id: 901 }] };
ok(!api.sanitizeArcgisRecord(groupData).children[0].data, "un grupo no lleva `data`");
same(api.arcgisShowIds(api.sanitizeArcgisRecord(groupData).children).includes(901), true, "el hijo del grupo sí cuenta");
same(api.arcgisShowIds(null), [], "sin hijos");

if (!process.exitCode) console.log("ARCGIS TESTS OK");
