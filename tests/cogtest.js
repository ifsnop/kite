/* Ortofotos COG: lo PURO.

   Qué sistema de coordenadas se admite y cómo se lee de las GeoKeys,
   qué vista general se elige, qué ventana se pide, cómo se reparte una
   tesela entre los píxeles de origen (máscara, nodata, alfa), qué
   blobs del almacén ya no nombra nadie, qué registro "cog" leído de
   fuera es válido y qué se queda fuera de un .kite.json. La lectura
   real (geotiff.js), la proyección (proj4) y la precisión de la malla
   contra proj4 están en tests/browser/cog.mjs.                     */
const { between, constDecl, fn } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const src = constDecl("ED50_TOWGS84") + "\n" + fn("withoutCogNodes") + "\n" + fn("cogGridPoint") + "\n"
  + between("/* ================= Ortofotos COG", "/* ---------- Almacén \"rasters\"");
const api = new Function(src + `\nreturn { cogCrsDef, cogEpsg, pickOverview, tileWindow, warpTile,
  cogGridPoint, orphanRasterIds, validCogRecord, withoutCogNodes, COG_GRID, COG_TILE };`)();
const { cogCrsDef, cogEpsg, pickOverview, tileWindow, warpTile, cogGridPoint,
        orphanRasterIds, validCogRecord, withoutCogNodes } = api;

/* ---------- Sistemas admitidos ---------- */
ok(/\+zone=30 .*GRS80/.test(cogCrsDef(25830)), "ETRS89 UTM 30N: " + cogCrsDef(25830));
ok(/\+zone=28 /.test(cogCrsDef(4083)), "REGCAN95 UTM 28N (Canarias): " + cogCrsDef(4083));
ok(/\+zone=31 .*towgs84=-87,-98,-121/.test(cogCrsDef(23031)), "ED50 con los parámetros peninsulares");
ok(cogCrsDef(3857) === "EPSG:3857" && /longlat/.test(cogCrsDef(4326)), "Web Mercator y WGS84");
ok(cogCrsDef(2062) === null && cogCrsDef(25832) === null, "lo que no está en la tabla da null (y se rechaza nombrándolo)");

ok(cogEpsg({ GTModelTypeGeoKey: 1, ProjectedCSTypeGeoKey: 25830 }) === 25830, "el proyectado manda");
ok(cogEpsg({ GTModelTypeGeoKey: 2, GeographicTypeGeoKey: 4258 }) === 4258, "si no hay proyectado, el geográfico");
ok(cogEpsg({ GTModelTypeGeoKey: 1, ProjectedCSTypeGeoKey: 32767 }) === null,
  "32767 (definido por el usuario) no es un código que buscar");
ok(cogEpsg({ GTModelTypeGeoKey: 1, GeographicTypeGeoKey: 4258 }) === null,
  "un modelo proyectado sin su código no se toma por geográfico");
ok(cogEpsg(null) === null && cogEpsg({}) === null, "sin GeoKeys, nada");

/* ---------- Qué nivel leer ---------- */
const F = [1, 2, 4, 8];
ok(pickOverview(F, 0.5) === 0, "más cerca que el original: el original");
ok(pickOverview(F, 1) === 0, "a la par: el original");
ok(pickOverview(F, 3.9) === 1, "3,9 píxeles por uno: el de 1/2 (el de 1/4 ya emborronaría)");
ok(pickOverview(F, 4) === 2, "justo 4: el de 1/4");
ok(pickOverview(F, 1000) === 3, "muy lejos: el más basto que haya");
ok(pickOverview([1], 50) === 0, "sin vistas generales, siempre el original");

/* ---------- Ventana ---------- */
ok(JSON.stringify(tileWindow([10.2, 20.7, 30.5, 40.1], 100, 100)) === "[9,19,32,42]",
  "caja de la malla con un píxel de margen: " + JSON.stringify(tileWindow([10.2, 20.7, 30.5, 40.1], 100, 100)));
ok(JSON.stringify(tileWindow([-50, -50, 5, 5], 100, 100)) === "[0,0,6,6]", "recortada a la imagen");
ok(tileWindow([200, 200, 300, 300], 100, 100) === null, "fuera de la imagen: null");
ok(tileWindow([NaN, NaN, 5, 5, 6, 6], 100, 100) !== null, "un punto que no se proyecta no tumba la tesela");

/* ---------- Reparto de una tesela ---------- */
/* Origen 2×2 RGB y una malla que lleva la tesela de 4×4 a esos 2×2:
   cada cuadrante de la tesela es un píxel de origen.              */
const G = 2, size = 4;
const grid = new Float64Array([0, 0, 1, 0, 2, 0, 0, 1, 1, 1, 2, 1, 0, 2, 1, 2, 2, 2]);
const rgb = new Uint8Array([10, 0, 0, 20, 0, 0, 30, 0, 0, 40, 0, 0]);
const out = new Uint8ClampedArray(size * size * 4);
warpTile(rgb, 2, 2, 3, null, null, grid, G, size, out);
const red = (u, v) => out[(v * size + u) * 4];
ok(red(0, 0) === 10 && red(3, 0) === 20 && red(0, 3) === 30 && red(3, 3) === 40,
  "cada cuadrante toma su píxel de origen (vecino más próximo, sin mezclar)");
ok(out[3] === 255, "RGB sin alfa: opaco");
warpTile(rgb, 2, 2, 3, new Uint8Array([255, 0, 255, 255]), null, grid, G, size, out);
ok(out[(0 * size + 3) * 4 + 3] === 0 && out[3] === 255, "la máscara a 0 deja transparente su píxel");
warpTile(new Uint8Array([0, 0, 0, 7, 7, 7, 0, 0, 0, 9, 9, 9]), 2, 2, 3, null, 0, grid, G, size, out);
ok(out[3] === 0 && out[(0 * size + 3) * 4 + 3] === 255, "nodata en las tres bandas: transparente");
warpTile(new Uint8Array([1, 2, 3, 128, 1, 2, 3, 128, 1, 2, 3, 128, 1, 2, 3, 128]), 2, 2, 4, null, null, grid, G, size, out);
ok(out[3] === 128, "con alfa propio se respeta");
const lejos = new Float64Array(grid.map(x => x + 100));
warpTile(rgb, 2, 2, 3, null, null, lejos, G, size, out);
ok(out.every((x, i) => i % 4 !== 3 || x === 0), "fuera de la ventana: todo transparente");
/* cogGridPoint es la misma cuenta que warpTile hace en línea */
const [gx, gy] = cogGridPoint(grid, G, size, 3, 1);
ok(Math.abs(gx - 1.75) < 1e-12 && Math.abs(gy - 0.75) < 1e-12, `cogGridPoint interpola el centro del píxel: ${gx}, ${gy}`);

/* ---------- Blobs huérfanos ---------- */
const arbol = [{ t: "folder", children: [{ t: "cog", rasterId: "a" }, { t: "layer" }] }];
const deshacer = [{ t: "cog", rasterId: "b" }];
ok(JSON.stringify(orphanRasterIds([arbol, deshacer], ["a", "b", "c"])) === '["c"]',
  "solo es huérfano lo que no nombra ni el árbol ni una instantánea de deshacer");
ok(orphanRasterIds([[]], []).length === 0, "sin nada guardado, nada que borrar");

/* ---------- Registro leído de fuera ---------- */
const ID = "0123456789abcdef0123456789abcdef";
ok(validCogRecord({ rasterId: ID, box: [40.4, -3.71, 40.42, -3.69] }), "un registro bueno");
ok(!validCogRecord({ rasterId: "../../x", box: [40.4, -3.71, 40.42, -3.69] }), "un id que no es de los nuestros");
ok(!validCogRecord({ rasterId: ID, box: [40.42, -3.71, 40.4, -3.69] }), "una caja del revés");
ok(!validCogRecord({ rasterId: ID, box: [40, -3, 95, -2] }), "una latitud imposible");
ok(!validCogRecord({ rasterId: ID, box: [40, "x", 41, -2] }) && !validCogRecord(null), "basura");

/* ---------- Lo que no sale en un .kite.json ---------- */
const { nodes, left } = withoutCogNodes([
  { t: "cog", name: "Orto 1" },
  { t: "folder", name: "F", children: [{ t: "layer", name: "L" }, { t: "cog", name: "Orto 2" }] }]);
ok(JSON.stringify(left) === '["Orto 1","Orto 2"]', "se nombran las ortofotos que se quedan fuera, a cualquier profundidad");
ok(nodes.length === 1 && nodes[0].children.length === 1 && nodes[0].children[0].name === "L",
  "y el resto del árbol sale entero");

/* ---------- Una carpeta nunca desplegada serializa igual ---------- */
/* serializePendingRecords es la gemela de serializeNode para registros
   que nunca llegaron a ser filas: un COG dentro de una carpeta
   colapsada tiene que guardar exactamente lo mismo.                  */
const pend = new Function(fn("serializePendingRecords") + "\nreturn serializePendingRecords;")();
const guardado = pend([{ t: "folder", name: "F", checked: true, collapsed: true, children: [
  { t: "cog", name: "Orto", checked: false, rasterId: ID, box: [1, 2, 3, 4], opacity: 0.5, _layer: {} }] }]);
ok(JSON.stringify(guardado[0].children[0])
   === JSON.stringify({ name: "Orto", checked: false, t: "cog", rasterId: ID, box: [1, 2, 3, 4], opacity: 0.5 }),
  "un COG pendiente se guarda con su id, su caja y su opacidad, sin la capa: " + JSON.stringify(guardado[0].children[0]));

if (!process.exitCode) console.log("COG TESTS OK");
