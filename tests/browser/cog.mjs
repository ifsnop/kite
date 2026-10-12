/* Ortofotos COG, de punta a punta, con geotiff.js y proj4 de verdad.

   La suite fabrica sus propios GeoTIFF en mosaico byte a byte: 512 ×
   512 px a 1 m/px centrados en la Puerta del Sol, un color por
   cuadrante (NO rojo, NE verde, SO azul, SE amarillo) y una vista
   general de 256 × 256 con los MISMOS cuadrantes a media intensidad,
   para saber qué nivel se ha leído. Con eso se puede preguntar al
   lienzo de la tesela de qué color es el mapa en el centro de cada
   cuadrante y comprobar, a la vez, la georreferencia (ETRS89 UTM 30N y
   Web Mercator), la reproyección, la elección de nivel y el giro.
   Lo puro está en tests/cogtest.js.                                  */
import fs from "node:fs";
import http from "node:http";
import { launch, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER COG TESTS OK");

/* ---------- Un escritor mínimo de GeoTIFF en mosaico ---------- */
/* images: [{ w, h, rgb(x, y) → [r, g, b], subfile, bits, geo? }]
   geo: { model: 1 proyectado | 2 geográfico, epsg, ox, oy, px }     */
function writeTiff(images, T = 256) {
  const chunks = [];
  let off = 0;
  const put = buf => { const at = off; chunks.push(buf); off += buf.length; return at; };
  const header = Buffer.alloc(8);
  header.write("II", 0, "ascii"); header.writeUInt16LE(42, 2);
  put(header);
  const tiles = images.map(im => {
    const bps = im.bits / 8, offsets = [], counts = [];
    for (let r = 0; r < Math.ceil(im.h / T); r++) {
      for (let c = 0; c < Math.ceil(im.w / T); c++) {
        const b = Buffer.alloc(T * T * 3 * bps);
        for (let y = 0; y < T; y++) {
          for (let x = 0; x < T; x++) {
            const X = c * T + x, Y = r * T + y;
            if (X >= im.w || Y >= im.h) continue;
            const px = im.rgb(X, Y);
            for (let k = 0; k < 3; k++) {
              const o = ((y * T + x) * 3 + k) * bps;
              if (bps === 1) b[o] = px[k]; else b.writeUInt16LE(px[k] * 257, o);
            }
          }
        }
        offsets.push(put(b)); counts.push(b.length);
      }
    }
    return { offsets, counts };
  });
  let nextPtr = { buf: header, pos: 4 };
  images.forEach((im, i) => {
    const e = [];
    const S = (tag, vals) => e.push({ tag, type: 3, vals });
    const LG = (tag, vals) => e.push({ tag, type: 4, vals });
    const D = (tag, vals) => e.push({ tag, type: 12, vals });
    LG(254, [im.subfile || 0]); LG(256, [im.w]); LG(257, [im.h]);
    S(258, [im.bits, im.bits, im.bits]); S(259, [1]); S(262, [2]); S(277, [3]); S(284, [1]);
    S(322, [T]); S(323, [T]); LG(324, tiles[i].offsets); LG(325, tiles[i].counts); S(339, [1, 1, 1]);
    if (im.geo) {
      const g = im.geo;
      D(33550, [g.px, g.px, 0]);
      D(33922, [0, 0, 0, g.ox, g.oy, 0]);
      const keys = g.model === 1
        ? [[1024, 0, 1, 1], [1025, 0, 1, 1], [3072, 0, 1, g.epsg]]
        : [[1024, 0, 1, 2], [1025, 0, 1, 1], [2048, 0, 1, g.epsg]];
      S(34735, [1, 1, 0, keys.length, ...keys.flat()]);
    }
    const size = { 3: 2, 4: 4, 12: 8 };
    const ifdLen = 2 + 12 * e.length + 4;
    const ifdAt = off;
    const ifd = Buffer.alloc(ifdLen);
    ifd.writeUInt16LE(e.length, 0);
    const extra = [];
    let extraAt = ifdAt + ifdLen;
    e.forEach((en, k) => {
      const p = 2 + 12 * k;
      ifd.writeUInt16LE(en.tag, p); ifd.writeUInt16LE(en.type, p + 2); ifd.writeUInt32LE(en.vals.length, p + 4);
      const bytes = Buffer.alloc(size[en.type] * en.vals.length);
      en.vals.forEach((v, j) => {
        if (en.type === 3) bytes.writeUInt16LE(v, j * 2);
        else if (en.type === 4) bytes.writeUInt32LE(v, j * 4);
        else bytes.writeDoubleLE(v, j * 8);
      });
      if (bytes.length <= 4) bytes.copy(ifd, p + 8);
      else { ifd.writeUInt32LE(extraAt, p + 8); extra.push(bytes); extraAt += bytes.length; }
    });
    nextPtr.buf.writeUInt32LE(ifdAt, nextPtr.pos);
    put(ifd);
    for (const b of extra) put(b);
    nextPtr = { buf: ifd, pos: ifdLen - 4 };
  });
  return Buffer.concat(chunks);
}

const QUAD = { no: [220, 30, 30], ne: [30, 200, 30], so: [30, 30, 220], se: [230, 220, 30] };
const pick = (x, y, n) => (y < n / 2 ? (x < n / 2 ? QUAD.no : QUAD.ne) : (x < n / 2 ? QUAD.so : QUAD.se));
const half = c => c.map(v => v >> 1);
const cogOf = (geo, bits = 8) => writeTiff([
  { w: 512, h: 512, bits, geo, rgb: (x, y) => pick(x, y, 512) },
  { w: 256, h: 256, bits, subfile: 1, rgb: (x, y) => half(pick(x, y, 256)) }]);

/* ---------- Servidor: la aplicación, y una página en blanco del mismo origen ---------- */
const HTML = fs.readFileSync(READABLE);
const serveOn = port => new Promise(r => {
  const s = http.createServer((q, res) => {
    if (q.url.startsWith("/fix/blank")) { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>x</title>"); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(HTML);
  });
  s.listen(port, "127.0.0.1", () => r(s));
});
const srv = await serveOn(8955);
const srv2 = await serveOn(8956);
const base = "http://127.0.0.1:8955", base2 = "http://127.0.0.1:8956";

const browser = await launch();
const { page, errors } = await openApp(browser, base + "/");

/* La Puerta del Sol en UTM 30N y en Web Mercator, según la propia app */
const SOL = [40.416775, -3.703790];
const xy = await page.evaluate(([la, lo]) => ({
  utm: proj4(cogCrsDef(25830)).forward([lo, la]),
  merc: [map.options.crs.project(L.latLng(la, lo)).x, map.options.crs.project(L.latLng(la, lo)).y]
}), SOL);
const geoUtm = { model: 1, epsg: 25830, ox: xy.utm[0] - 256, oy: xy.utm[1] + 256, px: 1 };
const geoMerc = { model: 1, epsg: 3857, ox: xy.merc[0] - 256, oy: xy.merc[1] + 256, px: 1 };

/* ---------- Ayudantes ---------- */
const soltar = (nombre, buf) => page.evaluate(async ([n, b]) => {
  await handleDroppedFiles([new File([new Uint8Array(b)], n)]);
}, [nombre, [...buf]]);
const liDe = nombre => `[...document.querySelectorAll("#tree li")].find(x => x._name === ${JSON.stringify(nombre)})`;
const ultimo = () => page.evaluate(() => msgLog[msgLog.length - 1].text);
/* Vista en la Sol al zoom pedido y espera a que la capa haya pintado */
async function verEn(nombre, z) {
  await page.evaluate(([n, z, la, lo]) => {
    const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
    window.__cog = nodeLayer(li);
    map.setView([la, lo], z, { animate: false });
  }, [nombre, z, ...SOL]);
  await page.waitForFunction(() => window.__cog && window.__cog._map && !window.__cog.isLoading()
    && Object.keys(window.__cog._tiles).length > 0);
}
/* Color del mapa (de la capa COG) en un punto desplazado (dx, dy) del
   centro de la imagen, en las unidades de su sistema               */
const colorEn = (crs, dx, dy) => page.evaluate(([crs, dx, dy, c]) => {
  const [lon, lat] = crs === 25830
    ? proj4(cogCrsDef(25830), "WGS84").forward([c.utm[0] + dx, c.utm[1] + dy])
    : (ll => [ll.lng, ll.lat])(map.options.crs.unproject(L.point(c.merc[0] + dx, c.merc[1] + dy)));
  const layer = window.__cog, z = layer._tileZoom;
  const p = map.project(L.latLng(lat, lon), z);
  const t = layer._tiles[`${Math.floor(p.x / 256)}:${Math.floor(p.y / 256)}:${z}`];
  if (!t) return null;
  return [...t.el.getContext("2d").getImageData(Math.floor(p.x) % 256, Math.floor(p.y) % 256, 1, 1).data];
}, [crs, dx, dy, xy]);
const igual = (a, b) => a && a[3] === 255 && b.every((v, i) => Math.abs(a[i] - v) <= 1);
async function cuadrantes(crs, esperado, que) {
  const r = {
    no: await colorEn(crs, -128, 128), ne: await colorEn(crs, 128, 128),
    so: await colorEn(crs, -128, -128), se: await colorEn(crs, 128, -128)
  };
  const bien = Object.keys(QUAD).every(k => igual(r[k], esperado(QUAD[k])));
  ok(bien, `${que}: ${JSON.stringify(r)}`);
}
const keys = () => page.evaluate(() => dbRasterKeys());

/* ---------- 1. Soltar un COG en ETRS89 UTM 30N ---------- */
await soltar("sol.tif", cogOf(geoUtm));
ok(await page.evaluate(`!!(${liDe("sol.tif")})`), "soltar un .tif crea su nodo");
ok(/512 × 512 px \(EPSG:25830, 1 vista/.test(await ultimo()), "y el aviso dice qué ha entrado: " + await ultimo());
ok((await keys()).length === 1, "sus bytes están en el almacén «rasters»");
await verEn("sol.tif", 17);
await cuadrantes(25830, c => c, "a zoom 17 cada cuadrante cae en su sitio, leído del original");
await verEn("sol.tif", 14);
await cuadrantes(25830, half, "a zoom 14 se lee la vista general (los mismos cuadrantes, a media intensidad)");

/* La malla de 16×16 frente a proj4 punto a punto, en una tesela de z17 */
const err = await page.evaluate(async ([la, lo]) => {
  const cog = await cogById(nodeLayer(([...document.querySelectorAll("#tree li")].find(x => x._name === "sol.tif")))._rasterId);
  const z = 17, p = map.project(L.latLng(la, lo), z);
  const coords = L.point(Math.floor(p.x / 256), Math.floor(p.y / 256)); coords.z = z;
  const grid = tileSourceGrid(cog, coords);
  let max = 0;
  for (let v = 0; v < 256; v += 7) {
    for (let u = 0; u < 256; u += 7) {
      const [gx, gy] = cogGridPoint(grid, COG_GRID, COG_TILE, u, v);
      const ll = map.unproject(coords.scaleBy(L.point(256, 256)).add(L.point(u + 0.5, v + 0.5)), z);
      const [X, Y] = cog.toSrc([ll.lng, ll.lat]);
      max = Math.max(max, Math.hypot((X - cog.ox) / cog.rx - gx, (Y - cog.oy) / cog.ry - gy));
    }
  }
  return max;
}, SOL);
ok(err < 0.05, `la malla interpolada se separa de proj4 menos de 0,05 píxeles: ${err.toFixed(5)}`);

/* ---------- 2. Girado ---------- */
await page.evaluate(() => map.setBearing(30));
await verEn("sol.tif", 17);
await cuadrantes(25830, c => c, "con el mapa girado 30° sigue pintándose en su sitio");
await page.evaluate(() => map.setBearing(0));

/* ---------- 3. Opacidad, con el diálogo de propiedades ---------- */
await page.evaluate(`openStyleDialog(${liDe("sol.tif")})`);
ok(await page.evaluate(() => !document.getElementById("style-imageoverlay").hidden),
  "el diálogo enseña la opacidad, como a una ortofoto de KMZ");
await page.evaluate(() => {
  const r = document.getElementById("io-opacity");
  r.value = "0.4"; r.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.click("#style-accept");
ok(await page.evaluate(`nodeLayer(${liDe("sol.tif")}).options.opacity === 0.4 && ${liDe("sol.tif")}._cog.opacity === 0.4`),
  "Aceptar deja la opacidad en la capa y en el nodo");

/* ---------- 4. Web Mercator ---------- */
await soltar("merc.tif", cogOf(geoMerc));
await verEn("merc.tif", 17);
await cuadrantes(3857, c => c, "un COG en Web Mercator también cae en su sitio");

/* ---------- 5. Lo que no se puede dibujar no entra (ni gasta cuota) ---------- */
await soltar("raro.tif", cogOf({ ...geoUtm, epsg: 2062 }));
ok(/EPSG:2062 no admitido/.test(await ultimo()), "un sistema que no está en la tabla se rechaza nombrándolo: " + await ultimo());
await soltar("dem.tif", cogOf(geoUtm, 16));
ok(/8 bits por canal/.test(await ultimo()), "16 bits (un modelo de elevación) se rechaza: " + await ultimo());
ok((await keys()).length === 2 && await page.evaluate(`!(${liDe("raro.tif")}) && !(${liDe("dem.tif")})`),
  "ninguno de los dos deja nodo ni bytes en el almacén");

/* ---------- 6. Exportar: se queda fuera, y se dice ---------- */
await page.evaluate(`exportNode(${liDe("sol.tif")})`);
ok(await page.evaluate(() => msgLog.some(m => /no se exportan/.test(m.text) && /sol\.tif/.test(m.text))),
  "un .kite.json no lleva la ortofoto, y el aviso la nombra");

/* ---------- 7. Recargar: sigue ahí, desde IndexedDB ---------- */
await page.evaluate(() => saveTree()); /* sin esperar al retardo de scheduleSave */
await page.reload();
await page.waitForFunction(() => typeof map !== "undefined" && rootUl && rootUl.children.length >= 2);
ok(await page.evaluate(`!!(${liDe("sol.tif")}) && ${liDe("sol.tif")}._cog.opacity === 0.4`),
  "tras recargar, el nodo vuelve con su opacidad");
await verEn("sol.tif", 17);
await cuadrantes(25830, c => c, "y se pinta leyendo el blob guardado");

/* ---------- 8. Borrar, deshacer, y la limpieza al arrancar ---------- */
const idSol = await page.evaluate(`nodeLayer(${liDe("sol.tif")})._rasterId`);
await page.evaluate(`${liDe("sol.tif")}.querySelector(".node-row button.delete").click()`);
ok(await page.evaluate(`!(${liDe("sol.tif")})`), "borrar quita el nodo");
ok((await keys()).includes(idSol), "pero no los bytes: deshacer tiene que poder devolverlo");
await page.evaluate(() => undoLast());
await page.waitForFunction(new Function(`return !!(${liDe("sol.tif")})`));
await verEn("sol.tif", 17);
await cuadrantes(25830, c => c, "deshacer lo devuelve, y se vuelve a pintar");
await page.evaluate(`${liDe("sol.tif")}.querySelector(".node-row button.delete").click()`);
await page.evaluate(() => saveTree());
await page.reload();
await page.waitForFunction(async id => !(await dbRasterKeys()).includes(id), idSol);
ok((await keys()).length === 1, "al arrancar se borran los bytes que ya no nombra nadie (y solo esos)");

ok(!errors.length, "sin errores de página: " + errors.join(" | "));

/* ---------- 9. Una base v3 con un árbol v7 sobrevive a la subida ---------- */
const ctx2 = await browser.newContext();
const p2 = await ctx2.newPage();
await p2.goto(base2 + "/fix/blank");
await p2.evaluate(() => new Promise((res, rej) => {
  const rq = indexedDB.open("visor-kml", 3);
  rq.onupgradeneeded = () => rq.result.createObjectStore("tree");
  rq.onsuccess = () => {
    const tx = rq.result.transaction("tree", "readwrite");
    tx.objectStore("tree").put({ v: 7, nodes: [{ t: "folder", name: "Viejo", checked: true, collapsed: true, children: [] }] }, "root");
    tx.oncomplete = () => { rq.result.close(); res(); };
    tx.onerror = () => rej(tx.error);
  };
}));
await p2.goto(base2 + "/");
await p2.waitForFunction(() => typeof rootUl !== "undefined" && rootUl && rootUl.children.length > 0, null, { timeout: 15000 });
ok(await p2.evaluate(() => [...rootUl.children].some(li => li._name === "Viejo")),
  "abrir esta versión sobre una base v3 conserva el árbol (v7, leído tal cual)");
ok(await p2.evaluate(() => new Promise(r => {
  const rq = indexedDB.open("visor-kml");
  rq.onsuccess = () => { const ok = rq.result.version === 4 && rq.result.objectStoreNames.contains("rasters"); rq.result.close(); r(ok); };
})), "y la base queda en v4 con su almacén «rasters»");
await ctx2.close();

await browser.close();
srv.close(); srv2.close();
done();
