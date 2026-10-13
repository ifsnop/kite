/* Shapefile: lo PURO de su importación.

   Un shapefile llega en varias piezas (.shp, .dbf, .prj, .cpg, .shx) y
   lo que se puede probar sin navegador es todo lo que decide qué hacer
   con ellas: agruparlas, leer la codificación, saber si sin .prj las
   coordenadas pueden ser grados, completar el datum ED50 y reproyectar
   una geometría en su sitio. La lectura de verdad (librería
   `shapefile`) y la proyección (proj4) van por CDN y se prueban en
   tests/browser/shp-import.mjs.                                      */
const { between } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const src = between("/* ================= Shapefile (SHP)", "/* Un trozo de shapefile");
const api = new Function(src + `\nreturn { splitShpName, groupShapefileParts, cpgEncoding,
  guessDbfEncoding, bboxLooksGeographic, prjDatumFix, reprojectGeometry, shpPropsToPlain };`)();
const { splitShpName, groupShapefileParts, cpgEncoding, guessDbfEncoding,
        bboxLooksGeographic, prjDatumFix, reprojectGeometry, shpPropsToPlain } = api;

/* ---------- Nombre y extensión ---------- */
ok(JSON.stringify(splitShpName("dir/Carreteras.SHP")) === '{"key":"dir/carreteras","ext":"shp"}',
  "la clave conserva la carpeta (dentro de un zip) y no distingue mayúsculas");
ok(splitShpName("vias.de.tren.dbf").key === "vias.de.tren", "solo cuenta el último punto");
ok(splitShpName("LEEME").ext === "", "sin extensión");

/* ---------- Agrupar lo soltado ---------- */
const F = name => ({ name });
const items = groupShapefileParts([
  F("rutas.kml"), F("Vias.dbf"), F("vias.SHP"), F("vias.prj"), F("vias.cpg"), F("vias.shx"),
  F("rios.shp"), F("huerfano.dbf"), F("huerfano.prj"), F("solo.shx")
]);
const shape = items.map(i => i.file ? "file:" + i.file.name
  : i.shp ? "shp:" + i.shp.name : "orphan:" + i.orphan.name);
ok(JSON.stringify(shape) === JSON.stringify([
  "file:rutas.kml", "shp:vias.SHP", "shp:rios.shp", "orphan:huerfano.dbf", "orphan:huerfano.prj"
]), "en orden de llegada, cada shapefile en el sitio de su .shp, un .shx suelto sin aviso: " + JSON.stringify(shape));
const vias = items.find(i => i.shp && i.shp.name === "vias.SHP").shp;
ok(vias.dbf.name === "Vias.dbf" && vias.prj.name === "vias.prj" && vias.cpg.name === "vias.cpg",
  "las piezas se juntan aunque cambien las mayúsculas");
const rios = items.find(i => i.shp && i.shp.name === "rios.shp").shp;
ok(rios.dbf === null && rios.prj === null && rios.cpg === null, "un .shp solo entra con lo demás a null");
const zipItems = groupShapefileParts([F("a/x.shp"), F("b/x.shp"), F("a/x.dbf")]);
ok(zipItems.length === 2 && zipItems[0].shp.dbf && !zipItems[1].shp.dbf,
  "dentro de un zip, la carpeta separa dos capas con el mismo nombre");
ok(zipItems[0].shp.name === "x.shp", "el nombre de la capa es el del archivo, sin la carpeta");

/* ---------- Codificación del .dbf ---------- */
ok(cpgEncoding("UTF-8\r\n") === "utf-8", "UTF-8, con su salto de línea");
ok(cpgEncoding("utf8") === "utf-8", "utf8 sin guion");
ok(cpgEncoding("1252") === "windows-1252", "1252 es Windows-1252");
ok(cpgEncoding("ANSI 1252") === "windows-1252", "ANSI 1252 (ArcGIS)");
ok(cpgEncoding("88591") === "iso-8859-1", "88591 es Latin-1");
ok(cpgEncoding("65001") === "utf-8", "65001 es UTF-8");
ok(cpgEncoding("ISO-8859-15") === "iso-8859-15", "una etiqueta que TextDecoder ya entiende");
ok(cpgEncoding("klingon") === null, "lo que no se reconoce da null (y se avisa)");
ok(cpgEncoding("") === null, "un .cpg vacío también");
ok(guessDbfEncoding(new TextEncoder().encode("Camión")) === "utf-8", "sin .cpg, bytes UTF-8 válidos: UTF-8");
ok(guessDbfEncoding(new Uint8Array([0x43, 0x61, 0x6D, 0x69, 0xF3, 0x6E])) === "windows-1252",
  "y si no lo son (una ó en Latin-1), Windows-1252");

/* ---------- Sin .prj ---------- */
ok(bboxLooksGeographic([-3.8, 40.3, -3.6, 40.5]), "una caja en grados");
ok(!bboxLooksGeographic([440000, 4473000, 441000, 4474000]), "una caja en metros UTM no");
ok(!bboxLooksGeographic([-200, 0, 0, 10]), "ni una longitud fuera de ±180");
ok(!bboxLooksGeographic([NaN, 0, 1, 1]) && !bboxLooksGeographic(null), "ni basura");

/* ---------- ED50 ---------- */
const ED50 = 'PROJCS["ED_1950_UTM_Zone_30N",GEOGCS["GCS_European_1950",DATUM["D_European_1950",'
  + 'SPHEROID["International_1924",6378388.0,297.0]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],'
  + 'PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],UNIT["Meter",1.0]]';
const fx = prjDatumFix(ED50);
ok(fx.ed50 && /SPHEROID\["International_1924",6378388.0,297.0\],TOWGS84\[-87,-98,-121,0,0,0,0\]\]/.test(fx.wkt),
  "a un ED50 sin parámetros se le ponen los estándar, dentro de su DATUM: " + fx.wkt.slice(60, 200));
const conTowgs = ED50.replace("297.0]]", "297.0],TOWGS84[-131,-100,-163,0,0,0,0]]");
ok(!prjDatumFix(conTowgs).ed50 && prjDatumFix(conTowgs).wkt === conTowgs, "un .prj con TOWGS84 propio se respeta");
const ETRS = 'PROJCS["ETRS_1989_UTM_Zone_30N",GEOGCS["GCS_ETRS_1989",DATUM["D_ETRS_1989",SPHEROID["GRS_1980",6378137.0,298.257222101]]]]';
ok(!prjDatumFix(ETRS).ed50 && prjDatumFix(ETRS).wkt === ETRS, "un ETRS89 no se toca");

/* ---------- Reproyectar en su sitio ---------- */
const shift = ([x, y]) => [x / 1000, y / 1000];
const poly = { type: "Polygon", coordinates: [[[0, 0], [1000, 0], [1000, 1000], [0, 0]], [[100, 100], [200, 100], [200, 200], [100, 100]]] };
reprojectGeometry(poly, shift);
ok(poly.coordinates[0][1][0] === 1 && poly.coordinates[1][2][1] === 0.2, "polígono con agujero, todos los anillos");
const pt = reprojectGeometry({ type: "Point", coordinates: [5000, 7000] }, shift);
ok(pt.coordinates[0] === 5 && pt.coordinates[1] === 7, "un punto");
const gc = reprojectGeometry({ type: "GeometryCollection", geometries: [
  { type: "Point", coordinates: [1000, 1000] }, { type: "LineString", coordinates: [[0, 0], [2000, 2000]] }] }, shift);
ok(gc.geometries[1].coordinates[1][0] === 2, "una colección, por dentro");
ok(reprojectGeometry(null, shift) === null, "sin geometría no hace nada");
const bad = reprojectGeometry({ type: "Point", coordinates: [1, 2] }, () => [NaN, NaN]);
ok(Number.isNaN(bad.coordinates[0]), "lo que no se proyecta queda NaN (y validGeometry lo rechaza)");

/* ---------- Atributos ---------- */
const props = shpPropsToPlain({ nombre: "A-6", alta: new Date(Date.UTC(2020, 4, 17)), malo: new Date(NaN), n: 3 });
ok(props.alta === "2020-05-17" && props.malo === "" && props.n === 3 && props.nombre === "A-6",
  "las fechas del .dbf pasan a texto AAAA-MM-DD; lo demás, tal cual: " + JSON.stringify(props));

if (!process.exitCode) console.log("SHP TESTS OK");
