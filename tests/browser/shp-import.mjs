/* Shapefiles, de punta a punta: piezas sueltas, .zip y 🔗.

   Va en navegador porque la lectura (librería `shapefile`) y la
   proyección (proj4) llegan por CDN y lo que importa es el resultado en
   el mapa: que un shapefile en ETRS89 UTM 30N (EPSG:25830, lo habitual
   en España) caiga donde debe. La prueba fabrica sus propios .shp y
   .dbf byte a byte, así que sabe exactamente qué coordenadas lleva: la
   UTM de un punto conocido calculada con latLngToUtm de la propia
   aplicación (WGS84; ETRS89 coincide a efectos de esta prueba). Lo
   puro (agrupar, .cpg, ED50…) está en tests/shptest.js.              */
import fs from "node:fs";
import http from "node:http";
import { launch, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER SHP IMPORT TESTS OK");

/* ---------- Un escritor mínimo de shapefile ---------- */
const PRJ_25830 = 'PROJCS["ETRS_1989_UTM_Zone_30N",GEOGCS["GCS_ETRS_1989",DATUM["D_ETRS_1989",'
  + 'SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],'
  + 'PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],'
  + 'PARAMETER["Central_Meridian",-3.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],'
  + 'UNIT["Meter",1.0]]';

/* shapes: [{ type: 1, xy: [x, y] }] o [{ type: 3|5, parts: [[[x,y]…]…] }] */
function writeShp(type, shapes) {
  const recs = shapes.map((s, i) => {
    let body;
    if (type === 1) {
      body = Buffer.alloc(20);
      body.writeInt32LE(1, 0); body.writeDoubleLE(s.xy[0], 4); body.writeDoubleLE(s.xy[1], 12);
    } else {
      const pts = s.parts.flat();
      body = Buffer.alloc(44 + 4 * s.parts.length + 16 * pts.length);
      body.writeInt32LE(type, 0);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
        .forEach((v, k) => body.writeDoubleLE(v, 4 + 8 * k));
      body.writeInt32LE(s.parts.length, 36); body.writeInt32LE(pts.length, 40);
      let o = 44, start = 0;
      for (const part of s.parts) { body.writeInt32LE(start, o); o += 4; start += part.length; }
      for (const [x, y] of pts) { body.writeDoubleLE(x, o); body.writeDoubleLE(y, o + 8); o += 16; }
    }
    const head = Buffer.alloc(8);
    head.writeInt32BE(i + 1, 0); head.writeInt32BE(body.length / 2, 4);
    return Buffer.concat([head, body]);
  });
  const all = shapes.flatMap(s => s.xy ? [s.xy] : s.parts.flat());
  const h = Buffer.alloc(100);
  h.writeInt32BE(9994, 0);
  h.writeInt32BE((100 + recs.reduce((n, r) => n + r.length, 0)) / 2, 24);
  h.writeInt32LE(1000, 28); h.writeInt32LE(type, 32);
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    .forEach((v, k) => h.writeDoubleLE(v, 36 + 8 * k));
  return Buffer.concat([h, ...recs]);
}

/* Un .dbf de campos de texto. `encode` decide los bytes (UTF-8 o Latin-1) */
function writeDbf(fields, rows, encode = s => Buffer.from(s, "utf8")) {
  const len = 30;
  const header = Buffer.alloc(32 + 32 * fields.length + 1);
  header[0] = 0x03;
  header.writeUInt32LE(rows.length, 4);
  header.writeUInt16LE(header.length, 8);
  header.writeUInt16LE(1 + len * fields.length, 10);
  fields.forEach((f, i) => {
    header.write(f, 32 + 32 * i, "ascii");
    header[32 + 32 * i + 11] = 0x43; /* C: texto */
    header[32 + 32 * i + 16] = len;
  });
  header[header.length - 1] = 0x0D;
  const recs = rows.map(r => {
    const b = Buffer.alloc(1 + len * fields.length, 0x20);
    fields.forEach((f, i) => encode(String(r[f] ?? "")).copy(b, 1 + len * i));
    return b;
  });
  return Buffer.concat([header, ...recs, Buffer.from([0x1A])]);
}

/* ---------- Servidor: la aplicación y un zip para 🔗 (mismo origen, por la CSP) ---------- */
const HTML = fs.readFileSync(READABLE);
let zipBytes = null;
const srv = http.createServer((q, s) => {
  const ruta = q.url.split("?")[0];
  if (ruta === "/fix/capas.zip") { s.writeHead(200); s.end(zipBytes); return; }
  if (ruta.startsWith("/fix/")) { s.writeHead(404); s.end("no"); return; }
  s.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  s.end(HTML);
});
await new Promise(r => srv.listen(8950, "127.0.0.1", r));
const base = "http://127.0.0.1:8950";

const browser = await launch();
const { page, errors } = await openApp(browser, base + "/");

/* La Puerta del Sol y dos puntos más, en UTM 30N según la propia app */
const SOL = [40.416775, -3.703790];
const utm = await page.evaluate(([la, lo]) => {
  const u = (a, b) => { const r = latLngToUtm(a, b, 30); return [r.easting, r.northing]; };
  return { sol: u(la, lo), a: u(40.42, -3.71), b: u(40.43, -3.69) };
}, SOL);

const [e, n] = utm.sol;
const puntos = writeShp(1, [{ xy: utm.sol }, { xy: utm.a }]);
const puntosDbf = writeDbf(["NOMBRE", "TIPO"], [
  { NOMBRE: "Puerta del Sol", TIPO: "plaza" }, { NOMBRE: "Camión", TIPO: "parada" }]);
const via = writeShp(3, [{ parts: [[utm.sol, utm.a, utm.b]] }]);
/* Exterior en sentido horario y agujero en el contrario, como manda el formato */
const sq = (d, cw) => {
  const r = [[e - d, n - d], [e - d, n + d], [e + d, n + d], [e + d, n - d], [e - d, n - d]];
  return cw ? r : r.reverse();
};
const parcela = writeShp(5, [{ parts: [sq(100, true), sq(30, false)] }]);

/* Importa un lote de archivos y espera a que termine */
const soltar = archivos => page.evaluate(async lista => {
  await handleDroppedFiles(lista.map(([n, b]) => new File([new Uint8Array(b)], n)));
}, archivos.map(([n, b]) => [n, [...b]]));
/* Lo construido bajo un nodo del árbol por su nombre */
const contenido = nombre => page.evaluate(async nm => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === nm);
  if (!li) return null;
  const recs = li._pending || [];
  return recs.map(r => ({ name: r.name, gj: r._layer.toGeoJSON() }));
}, nombre);
const ultimoAviso = () => page.evaluate(() => msgLog[msgLog.length - 1].text);
const metros = ([lon, lat], [la, lo]) => {
  const k = Math.PI / 180;
  return 6371000 * Math.hypot((lon - lo) * k * Math.cos(la * k), (lat - la) * k);
};

/* El nombre lo elige el usuario: se deja guardada la elección para las
   dos formas de properties de la suite, así no sale el selector.    */
await page.evaluate(async () => {
  gnpStore = await dbLoadGnp();
  gnpStore[propsFingerprint({ NOMBRE: 1, TIPO: 1 })] = ["NOMBRE"];
  gnpStore[propsFingerprint({ NOMBRE: 1 })] = ["NOMBRE"];
});

/* ---------- 1. Piezas sueltas, en desorden y con mayúsculas ---------- */
await soltar([["PUNTOS.DBF", puntosDbf], ["puntos.prj", Buffer.from(PRJ_25830)],
              ["puntos.shp", puntos], ["puntos.cpg", Buffer.from("UTF-8")]]);
let c = await contenido("puntos.shp");
ok(c && c.length === 2, "un nodo por shapefile, con sus dos puntos: " + JSON.stringify(c && c.map(x => x.name)));
const sol = c && c.find(x => x.name === "Puerta del Sol");
const solPos = sol && sol.gj.features[0].geometry.coordinates;
ok(sol && metros(solPos, SOL) < 0.5,
  `EPSG:25830 → WGS84 cae en su sitio: ${solPos} a ${sol && metros(solPos, SOL).toFixed(3)} m`);
ok(c && c.some(x => x.name === "Camión"), "el .cpg UTF-8 se respeta (Camión con tilde)");

/* ---------- 2. Sin .cpg y en Latin-1: se adivina ---------- */
const latin = writeDbf(["NOMBRE"], [{ NOMBRE: "Camión" }, { NOMBRE: "León" }], s => Buffer.from(s, "latin1"));
await soltar([["latin.shp", puntos], ["latin.dbf", latin], ["latin.prj", Buffer.from(PRJ_25830)]]);
c = await contenido("latin.shp");
ok(c && c.map(x => x.name).join() === "Camión,León",
  "sin .cpg, un .dbf que no es UTF-8 se lee como Windows-1252: " + JSON.stringify(c && c.map(x => x.name)));

/* ---------- 3. Línea y polígono con agujero ---------- */
await soltar([["via.shp", via], ["via.prj", Buffer.from(PRJ_25830)],
              ["parcela.shp", parcela], ["parcela.prj", Buffer.from(PRJ_25830)]]);
c = await contenido("via.shp");
const linea = c && c[0].gj.features[0].geometry;
ok(linea && linea.type === "LineString" && linea.coordinates.length === 3 && metros(linea.coordinates[0], SOL) < 0.5,
  "una polilínea entra como LineString, en su sitio");
ok(await page.evaluate(() => /sin \.dbf/.test(msgLog.map(m => m.text).join("\n"))),
  "sin .dbf entra igual, y el resumen lo dice");
c = await contenido("parcela.shp");
const pol = c && c[0].gj.features[0].geometry;
ok(pol && pol.type === "Polygon" && pol.coordinates.length === 2,
  "el polígono conserva su agujero: " + (pol && pol.type + "/" + pol.coordinates.length));

/* ---------- 4. Huérfanos y sin .prj en metros ---------- */
await soltar([["suelto.dbf", puntosDbf], ["suelto.prj", Buffer.from(PRJ_25830)]]);
ok(/suelto\.(dbf|prj).*no ha llegado su \.shp/.test(await ultimoAviso()), "una pieza sin su .shp se avisa: " + await ultimoAviso());
await soltar([["metros.shp", puntos]]);
ok(/falta el \.prj y las coordenadas no son geogr/.test(await ultimoAviso()),
  "sin .prj y en metros no se inventa la posición: " + await ultimoAviso());
ok(!(await contenido("metros.shp")), "y no queda nada a medias en el árbol");

/* ---------- 5. ED50: se avisa y se transforma ---------- */
const PRJ_ED50 = PRJ_25830.replace("ETRS_1989_UTM_Zone_30N", "ED_1950_UTM_Zone_30N")
  .replace('GCS_ETRS_1989",DATUM["D_ETRS_1989",SPHEROID["GRS_1980",6378137.0,298.257222101]',
           'GCS_European_1950",DATUM["D_European_1950",SPHEROID["International_1924",6378388.0,297.0]');
await soltar([["ed50.shp", puntos], ["ed50.prj", Buffer.from(PRJ_ED50)]]);
c = await contenido("ed50.shp");
const edPos = c && c[0].gj.features[0].geometry.coordinates;
const desfase = edPos && metros(edPos, SOL);
ok(desfase > 80 && desfase < 250,
  `las mismas cifras leídas como ED50 se desplazan lo que toca (unos 100-200 m): ${desfase && desfase.toFixed(1)} m`);
ok(await page.evaluate(() => msgLog.some(m => /datum ED50/.test(m.text))), "y el resumen lo dice");

/* ---------- 6. Un .zip con dos capas, cada una en su carpeta ---------- */
const enZip = await page.evaluate(async files => {
  const z = new JSZip();
  for (const [n, b] of files) z.file(n, new Uint8Array(b));
  return [...await z.generateAsync({ type: "uint8array" })];
}, [["datos/puntos.shp", puntos], ["datos/puntos.dbf", puntosDbf], ["datos/puntos.prj", Buffer.from(PRJ_25830)],
    ["datos/via.shp", via], ["datos/via.prj", Buffer.from(PRJ_25830)], ["__MACOSX/datos/._via.shp", Buffer.from("x")]]
   .map(([n, b]) => [n, [...b]]));
zipBytes = Buffer.from(enZip);
const antes = await page.evaluate(() => rootUl ? rootUl.children.length : 0);
await soltar([["capas.zip", zipBytes]]);
ok(await page.evaluate(() => rootUl.children.length) === antes + 2,
  "un zip con dos shapefiles da dos nodos (y la basura de __MACOSX se ignora)");

/* ---------- 7. Por 🔗: el zip se reconoce como shapefile ---------- */
await page.click("#url-btn");
await page.fill("#url-input", base + "/fix/capas.zip");
await page.dispatchEvent("#url-input", "input");
await page.click("#url-fetch");
await page.waitForFunction(() => !document.getElementById("url-add").hidden && !document.getElementById("url-add").disabled);
ok(/shapefile comprimido/.test(await page.textContent("#url-status")),
  "el diálogo dice qué ha llegado: " + await page.textContent("#url-status"));
await page.click("#url-add");
await page.waitForFunction(() => [...document.querySelectorAll("#tree li")].some(x => x._name === "Descarga 1"));
const descarga = await page.evaluate(async () => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Descarga 1");
  await ensureMaterialized(li);
  for (let i = 0; i < 50 && nodeUl(li).children.length < 2; i++) await new Promise(r => setTimeout(r, 100));
  return [...nodeUl(li).children].map(x => x._name);
});
ok(descarga.join() === "puntos.shp,via.shp", "y entra en «Descargas › Descarga 1»: " + descarga.join());

ok(!errors.length, "sin errores de página: " + errors.join(" | "));
await browser.close();
srv.close();
done();
