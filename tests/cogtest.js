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

const src = constDecl("ED50_TOWGS84") + "\n" + constDecl("elevValue") + "\n" + fn("withoutCogNodes") + "\n" + fn("cogGridPoint") + "\n"
  + between("/* ================= Ortofotos COG", "/* ---------- Almacén \"rasters\"");
const api = new Function(src + `\nreturn { cogCrsDef, cogEpsg, pickOverview, tileWindow, warpTile,
  cogGridPoint, orphanRasterIds, validCogRecord, withoutCogNodes, COG_GRID, COG_TILE,
  demColor, demHillshade, demRange, warpDemTile, DEM_RAMP };`)();
const { cogCrsDef, cogEpsg, pickOverview, tileWindow, warpTile, cogGridPoint,
        orphanRasterIds, validCogRecord, withoutCogNodes,
        demColor, demHillshade, demRange, warpDemTile, DEM_RAMP } = api;

/* ---------- Sistemas admitidos ---------- */
ok(/\+zone=30 .*GRS80/.test(cogCrsDef(25830)), "ETRS89 UTM 30N: " + cogCrsDef(25830));
ok(/\+zone=28 /.test(cogCrsDef(4083)), "REGCAN95 UTM 28N (Canarias): " + cogCrsDef(4083));
ok(/\+zone=31 .*towgs84=-87,-98,-121/.test(cogCrsDef(23031)), "ED50 con los parámetros peninsulares");
ok(cogCrsDef(3857) === "EPSG:3857" && /longlat/.test(cogCrsDef(4326)), "Web Mercator y WGS84");
ok(/\+zone=36 \+datum=WGS84 \+units=m/.test(cogCrsDef(32636)) && !/south/.test(cogCrsDef(32636)),
  "WGS84 UTM 36N (Sentinel-2 sobre Oriente Próximo): " + cogCrsDef(32636));
ok(/\+zone=36 .*\+south/.test(cogCrsDef(32736)), "y el hemisferio sur lleva +south: " + cogCrsDef(32736));
ok(/\+zone=1 /.test(cogCrsDef(32601)) && /\+zone=60 /.test(cogCrsDef(32660)) && /\+zone=60 .*south/.test(cogCrsDef(32760)),
  "los extremos de las dos familias WGS84 (1–60)");
ok(/\+zone=32 .*GRS80/.test(cogCrsDef(25832)) && /\+zone=38 /.test(cogCrsDef(25838)), "ETRS89 UTM 32–38 (Europa central y oriental)");
ok(/\+zone=31 .*GRS80/.test(cogCrsDef(3043)) && cogCrsDef(3043) === cogCrsDef(25831),
  "EPSG:3043 (ETRS89 / UTM 31N, ejes N-E) es la misma proyección que 25831: " + cogCrsDef(3043));
ok([3040, 3041, 3042, 3044, 3045, 3046, 3047, 3048, 3049, 3050].every(e => cogCrsDef(e) === cogCrsDef(e - 3040 + 25828)),
  "y toda la familia 3040–3050 casa con 25828–25838 (huso = código − 3012)");
ok(cogCrsDef(3039) === null && cogCrsDef(3051) === null, "fuera de los husos 28–38 no hay sistema");
ok(cogCrsDef(32600) === null && cogCrsDef(32661) === null && cogCrsDef(32700) === null && cogCrsDef(32761) === null
  && cogCrsDef(25839) === null && cogCrsDef(25827) === null, "fuera de los husos 1–60 y 28–38 no hay sistema");
ok(cogCrsDef(23032) === null, "ED50 fuera de los husos peninsulares no se admite: sus parámetros solo valen en España");
ok(cogCrsDef(2062) === null, "lo que no está en la tabla da null (y se rechaza nombrándolo)");

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

/* ---------- Modelos de elevación ---------- */
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
ok(demColor(0).join() === DEM_RAMP[0][1].join() && demColor(1).join() === DEM_RAMP[DEM_RAMP.length - 1][1].join(),
  "la rampa empieza y acaba en sus extremos");
ok(demColor(0.5).join() === "225,215,130", "y pasa por su parada central: " + demColor(0.5));
ok(demColor(-3).join() === demColor(0).join() && demColor(9).join() === demColor(1).join() && demColor(NaN).join() === demColor(0).join(),
  "fuera de [0, 1] y NaN se recortan");
ok(near(demColor(0.125)[0], (56 + 160) / 2) && near(demColor(0.125)[1], (128 + 190) / 2), "entre dos paradas interpola linealmente");

const flat = demHillshade(100, 100, 100, 100, 5, 5);
ok(near(flat, Math.sin(45 * Math.PI / 180)), "terreno llano: sin(altitud de la luz) = " + flat);
/* La luz viene del noroeste: una ladera que mira al noroeste (sube hacia el este y el sur) se ilumina; la contraria, no */
ok(demHillshade(100, 110, 100, 110, 5, 5) > flat, "ladera al noroeste, más clara que el llano");
ok(demHillshade(110, 100, 110, 100, 5, 5) < flat, "ladera al sureste, más oscura");
ok(demHillshade(0, 1000, 0, 1000, 5, 5) >= 0 && demHillshade(1000, 0, 1000, 0, 5, 5) >= 0, "nunca por debajo de 0");
ok(Math.abs(demHillshade(100, 110, 100, 110, 50, 50) - flat) < Math.abs(demHillshade(100, 110, 100, 110, 5, 5) - flat),
  "la misma diferencia de altura en celdas diez veces mayores es menos pendiente");

const r1 = demRange(new Float32Array([-9999, 10, 250.5, NaN, 12000, -600, 3]), -9999);
ok(r1 && r1.min === 3 && r1.max === 250.5, "el rango ignora nodata, NaN y valores fuera de [-500, 9000]: " + JSON.stringify(r1));
ok(demRange(new Float32Array([-9999, NaN, 99999]), -9999) === null, "sin ninguna altitud válida, null");
ok(demRange([5, 7], null).max === 7, "sin nodata declarado también");

/* Una ventana de 4 × 4 con una malla identidad (G = 1, size = 4): cada píxel de la tesela es su celda */
{
  const grid = new Float64Array([0, 0, 4, 0, 0, 4, 4, 4]);
  const win = new Float32Array(16).fill(100);
  win[5] = -9999;                         /* (1, 1) sin dato */
  const mask = new Uint8Array(16).fill(1); mask[10] = 0;   /* (2, 2) fuera de la máscara */
  const out = new Uint8ClampedArray(4 * 4 * 4);
  warpDemTile(win, 4, 4, mask, -9999, grid, 1, 4, out, { min: 0, max: 200, cx: 5, cy: 5 });
  const px = (u, v) => [...out.slice((v * 4 + u) * 4, (v * 4 + u) * 4 + 4)];
  const k = 0.35 + 0.65 * Math.sin(45 * Math.PI / 180);
  const c = demColor(0.5).map(x => Math.round(x * k));
  ok(px(0, 0)[3] === 255 && px(0, 0).slice(0, 3).every((v, i) => Math.abs(v - c[i]) <= 1),
    "una celda llana lleva el color de su altitud sombreado como el llano: " + px(0, 0) + " frente a " + c);
  ok(px(1, 1)[3] === 0, "una celda nodata queda transparente");
  ok(px(2, 2)[3] === 0, "una celda fuera de la máscara también");
  ok(px(1, 0)[3] === 255 && px(0, 1)[3] === 255, "y una vecina de un nodata sigue pintada (su vecino se sustituye por ella)");
}
