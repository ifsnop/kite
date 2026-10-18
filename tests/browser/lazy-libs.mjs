/* Librerías bajo demanda (07-lazy-libs.js), en el navegador y contra los
   CDN de verdad. `tests/lazylibs.js` fija lo estático (origen, versión,
   SRI, que nadie use el global sin pedirlo); aquí se comprueba que
   funciona de punta a punta:

   1. ANTES/DESPUÉS, en bytes: al arrancar ya no se descargan html2canvas,
      geotiff.js ni proj4 (646 KB sin comprimir) y los globales no existen;
      llegan cuando se piden. El «antes» es la suma de las tres, medida de
      lo que de verdad responde el CDN, no un número escrito a mano.
   2. Una sola petición aunque se pida dos veces a la vez, con el SRI y
      `crossorigin` puestos en el <script> insertado.
   3. El SRI SIGUE protegiendo: un CDN que sirviera otro contenido (aquí,
      simulado) no se ejecuta; el fallo no se queda pegado y el siguiente
      intento, con el servicio bueno, funciona.
   4. La exportación a PNG, que es lo que usa html2canvas, funciona real
      y, si no se puede cargar, avisa SIN dejar los controles ocultos.    */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER LAZY LIBS TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8904);

const LAZY = { html2canvas: /html2canvas/, geotiff: /geotiff/, proj4: /proj4/ };
const isLazy = url => Object.values(LAZY).some(re => re.test(url));

/* Bytes de script de CDN que llegan, para el antes/después */
function trackScripts(page) {
  const got = [];
  page.on("response", async r => {
    if (r.request().resourceType() !== "script" || r.url().startsWith("http://127.0.0.1")) return;
    try { got.push({ url: r.url(), bytes: (await r.body()).length }); } catch { /* cancelada */ }
  });
  return got;
}
const sum = list => list.reduce((n, e) => n + e.bytes, 0);

/* ---------- 1. El arranque ya no las descarga ---------- */
{
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const got = trackScripts(page);
  await page.goto(srv.url);
  await page.waitForFunction(() => typeof map === "object" && map && typeof ensureLib === "function");
  await page.waitForLoadState("networkidle");

  const startup = await page.evaluate(() => ({
    html2canvas: typeof html2canvas, GeoTIFF: typeof GeoTIFF, proj4: typeof proj4,
    jszip: typeof JSZip, topojson: typeof topojson, shapefile: typeof shapefile, L: typeof L
  }));
  ok(startup.html2canvas === "undefined" && startup.GeoTIFF === "undefined" && startup.proj4 === "undefined",
    "al arrancar no existen html2canvas, GeoTIFF ni proj4: " + JSON.stringify(startup));
  ok(startup.jszip === "object" || startup.jszip === "function", "JSZip sí (los KMZ son el uso corriente)");
  ok(startup.L === "object" && startup.topojson === "object" && startup.shapefile === "object", "Leaflet, topojson y shapefile también");
  ok(!got.some(e => isLazy(e.url)), "ninguna de las tres se pidió al CDN: " + got.map(e => e.url.split("/").pop()).join(", "));
  const startupBytes = sum(got);

  /* ---------- 2. Una sola petición, con SRI ---------- */
  const requests = [];
  page.on("request", r => { if (/proj4/.test(r.url())) requests.push(r.url()); });
  const loaded = await page.evaluate(async () => {
    const [a, b] = await Promise.all([ensureLib("proj4"), ensureLib("proj4")]);
    const tag = [...document.scripts].find(s => /proj4/.test(s.src));
    return {
      same: a === b, kind: typeof a, global: typeof proj4,
      integrity: tag && tag.integrity, expected: LAZY_LIBS.proj4.integrity,
      cross: tag && tag.crossOrigin, count: [...document.scripts].filter(s => /proj4/.test(s.src)).length
    };
  });
  ok(loaded.same && loaded.kind === "function" && loaded.global === "function", "proj4 llega y es la misma para las dos peticiones");
  ok(requests.length === 1, "dos peticiones a la vez, UNA descarga: " + requests.length);
  ok(loaded.count === 1, "y un solo <script> en la página");
  ok(loaded.integrity && loaded.integrity === loaded.expected, "con el SRI de la tabla: " + loaded.integrity);
  ok(loaded.cross === "anonymous", "y crossorigin=anonymous");
  await page.evaluate(() => ensureLib("proj4"));
  ok(requests.length === 1, "pedirla otra vez, ya cargada, no descarga nada");

  /* Con las tres, el «antes»: lo que el arranque se ahorra */
  await page.evaluate(() => Promise.all([ensureLib("geotiff"), ensureLib("html2canvas")]));
  /* El tamaño de cada respuesta se lee de forma asíncrona: se espera a las tres */
  for (let i = 0; i < 100 && got.filter(e => isLazy(e.url)).length < 3; i++) await new Promise(r => setTimeout(r, 50));
  const lazyBytes = sum(got.filter(e => isLazy(e.url)));
  const gone = await page.evaluate(() => ({ g: typeof GeoTIFF, h: typeof html2canvas }));
  ok(gone.g === "object" && gone.h === "function", "geotiff.js y html2canvas llegan al pedirlos: " + JSON.stringify(gone));
  console.log(`  scripts de CDN al arrancar: ${(startupBytes / 1024).toFixed(0)} KB ` +
    `(antes ${((startupBytes + lazyBytes) / 1024).toFixed(0)} KB; las tres suman ${(lazyBytes / 1024).toFixed(0)} KB)`);
  ok(lazyBytes > 600 * 1024, `las tres pesan lo que se esperaba (${(lazyBytes / 1024).toFixed(0)} KB)`);
  ok(startupBytes < 300 * 1024, `el arranque descarga menos de 300 KB de scripts de CDN: ${(startupBytes / 1024).toFixed(0)} KB`);
  ok(startupBytes < (startupBytes + lazyBytes) * 0.4, "menos del 40 % de lo que descargaba antes");

  /* ---------- 4a. PNG real: carga html2canvas y deja los controles como estaban ---------- */
  const png = await page.evaluate(async () => {
    const zoom = document.querySelector(".leaflet-control-zoom");
    const before = zoom.style.display;
    const dl = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { dl.push(this.download); };
    await exportMapPng();
    await new Promise(r => setTimeout(r, 1500)); /* toBlob es asíncrono */
    HTMLAnchorElement.prototype.click = orig;
    return { before, after: zoom.style.display, downloads: dl, msg: document.getElementById("nav-msg").textContent };
  });
  ok(png.before === png.after, `los controles quedan como estaban (display «${png.after}»)`);
  ok(png.downloads.length === 1 && /\.png$/i.test(png.downloads[0]), "exportó un PNG: " + JSON.stringify(png.downloads));
  ok(!/No se pudo/.test(png.msg), "sin aviso de error: " + png.msg);
  ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
  await ctx.close();
}

/* ---------- 3. El SRI sigue protegiendo ---------- */
{
  const { page, errors, ctx } = await openApp(browser, srv.url);
  const URL_RE = /geotiff@2\.1\.3/;
  await page.route(URL_RE, route => route.fulfill({
    status: 200, contentType: "text/javascript",
    headers: { "access-control-allow-origin": "*" },
    body: "window.GeoTIFF = { evil: true };"
  }));
  const bad = await page.evaluate(async () => {
    let msg = null;
    try { await ensureLib("geotiff"); } catch (e) { msg = e.message; }
    return { msg, defined: typeof GeoTIFF, scripts: [...document.scripts].filter(s => /geotiff/.test(s.src)).length,
      remembered: lazyLibPromises.has("geotiff") };
  });
  ok(bad.msg === "no se pudo cargar el soporte de GeoTIFF", "contenido que no casa con el SRI: rechazado con el mensaje de siempre: " + bad.msg);
  ok(bad.defined === "undefined", "y NO se ejecutó (GeoTIFF sigue sin existir): " + bad.defined);
  ok(bad.scripts === 0 && bad.remembered === false, "sin <script> muerto ni fallo recordado");

  await page.unroute(URL_RE);
  const good = await page.evaluate(async () => {
    await ensureLib("geotiff");
    return typeof GeoTIFF.fromArrayBuffer;
  });
  ok(good === "function", "con el CDN bueno, el siguiente intento funciona");

  /* ---------- 4b. PNG sin poder cargar html2canvas ---------- */
  await page.route(/html2canvas/, route => route.abort());
  const fail = await page.evaluate(async () => {
    const zoom = document.querySelector(".leaflet-control-zoom");
    await exportMapPng();
    return { display: zoom.style.display, msg: document.getElementById("nav-msg").textContent };
  });
  ok(fail.display !== "none", "si no carga, los controles NO se quedan ocultos (display «" + fail.display + "»)");
  ok(/No se pudo cargar el soporte para exportar PNG/.test(fail.msg), "y avisa: " + fail.msg);
  /* Los únicos errores admitidos son los provocados a propósito: el bloqueo del
   SRI y la petición abortada.                                              */
ok(errors.filter(e => !/Failed to load resource|ERR_FAILED|net::|valid digest/.test(e)).length === 0, "sin más errores de página: " + errors.join(" | "));
  await ctx.close();
}

await browser.close();
srv.close();
done();
