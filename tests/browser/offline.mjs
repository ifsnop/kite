/* Uso sin conexión, de punta a punta (sw.js + 06-offline.js).

   Lo que no se puede comprobar en Node es lo que importa al usuario: que
   una pestaña que el navegador descartó se pueda RECARGAR sin red y siga
   siendo KITE, con sus datos y con las librerías bajo demanda. Aquí:

   1. Con red, el worker se registra y la página le manda su lista: todas
      las librerías con SRI (las del HTML y las bajo demanda) y la propia
      página quedan guardadas.
   2. Sin red (el servidor corta la conexión y el navegador se declara
      sin conexión) se RECARGA: la aplicación arranca, el árbol guardado
      sigue ahí, el indicador «Sin conexión» se ve, geotiff.js, proj4 y
      html2canvas se cargan desde lo guardado y la CSP no protesta.
   3. Una red que NO RESPONDE (conexión aceptada y sin contestar) no deja
      la página colgada: pasado el tope sale la copia.
   4. Con red otra vez se ve la versión NUEVA (red primero, no caché
      primero), el indicador se retira y se avisa.

   Es la única suite con service workers permitidos: con uno controlando
   la página, `page.route` no ve lo que el worker contesta.             */
import { launch, serveSite, openApp, waitAppReady, reporter } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER OFFLINE TESTS OK");
const browser = await launch();
const site = await serveSite(8950);
const { ctx, page, errors } = await openApp(browser, site.url, { serviceWorkers: "allow" });

/* Sondeo desde Node: una lectura asíncrona dentro de waitForFunction
   no espera (ver browser-tests.md). */
async function until(fn, what, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("tiempo agotado esperando: " + what);
    await new Promise(r => setTimeout(r, 100));
  }
}

/* ---------- 1. Con red: registro y precarga ---------- */
const expected = await page.evaluate(() => precacheItems().map(i => i.url));
ok(expected.length >= 9, "la lista tiene las librerías del HTML, las tres bajo demanda y las imágenes: " + expected.length);
await until(() => page.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active)), "worker activo");
const cached = await until(async () => {
  const keys = await page.evaluate(async () => {
    const libs = await caches.open("kite-libs-1"), pages = await caches.open("kite-pages-1");
    return { libs: (await libs.keys()).map(r => r.url), pages: (await pages.keys()).map(r => r.url) };
  });
  return keys.libs.length >= expected.length && keys.pages.length ? keys : null;
}, "precarga completa");
ok(expected.every(u => cached.libs.includes(u)), "todas las librerías quedan guardadas, también las bajo demanda: faltan "
  + expected.filter(u => !cached.libs.includes(u)).join(", "));
ok(cached.pages.some(u => u === site.url), "y la página que registró el worker: " + cached.pages);
ok(!(await page.evaluate(() => typeof GeoTIFF !== "undefined" || typeof proj4 !== "undefined" || typeof html2canvas !== "undefined")),
  "guardarlas NO las ejecuta (siguen bajo demanda)");

/* Algo guardado en IndexedDB, para ver que sobrevive */
const KML = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Faros</name>'
  + "<Placemark><name>Faro</name><Point><coordinates>-3.7,40.4,0</coordinates></Point></Placemark></Document></kml>";
await page.evaluate(k => { window.__import = handleDroppedFiles([new File([k], "faro.kml")]); }, KML);
await until(() => page.evaluate(() => document.querySelectorAll("#tree .label, #tree li").length > 0), "el árbol con filas");
await until(() => page.evaluate(async () => { const n = await dbLoadTree(); return !!(n && n.length); }), "árbol guardado en IndexedDB");
const rowsBefore = await page.evaluate(() => document.querySelectorAll("#tree li").length);
ok(!(await page.evaluate(() => document.getElementById("offline-badge").hidden === false)), "con red no hay indicador");

/* ---------- 2. Sin red: recargar ---------- */
site.mode = "down";
await ctx.setOffline(true);
await until(() => page.evaluate(() => !document.getElementById("offline-badge").hidden), "indicador al perder la red", 5000);
ok(/Sin conexión/.test(await page.evaluate(() => document.getElementById("nav-msg").textContent)),
  "se avisa al perder la red");

await page.reload();
await waitAppReady(page);
ok(await page.evaluate(() => !!navigator.serviceWorker.controller), "la página recargada está controlada por el worker");
ok(await page.evaluate(() => document.querySelectorAll("#tree li").length) === rowsBefore, "el árbol guardado sigue ahí tras recargar sin red");
ok(await page.evaluate(() => !document.getElementById("offline-badge").hidden), "el indicador «Sin conexión» se ve");
ok(/Sin conexión/.test(await page.evaluate(() => document.getElementById("nav-msg").textContent)), "y el aviso del arranque lo explica");

const libs = await page.evaluate(async () => {
  const out = {};
  for (const n of ["geotiff", "proj4", "html2canvas"]) {
    try { out[n] = typeof (await ensureLib(n)); } catch (e) { out[n] = "ERROR " + e.message; }
  }
  return out;
});
ok(libs.geotiff !== undefined && Object.values(libs).every(v => v === "function" || v === "object"),
  "geotiff.js, proj4 y html2canvas se cargan sin red, con su SRI: " + JSON.stringify(libs));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP: " + JSON.stringify(await page.evaluate(() => window.__csp)));

/* Un fallo de red lo explica con «sin conexión» y no con CORS */
const msg = await page.evaluate(async () => {
  try { await fetch("https://nominatim.openstreetmap.org/search?q=x"); } catch (e) { return netFailText("genérico (CORS)"); }
});
ok(msg === "sin conexión a la red", "un fallo de red dice «sin conexión», no CORS: " + msg);

/* ---------- 3. Una red que no responde ---------- */
/* El navegador vuelve a creerse conectado: `setOffline` haría fallar la
   petición al instante y no se vería la espera. */
await ctx.setOffline(false);
site.mode = "hang";
const t0 = Date.now();
await page.reload();
await waitAppReady(page);
const waited = Date.now() - t0;
ok(waited < 15000, `con la red colgada sale la copia en unos segundos (${waited} ms), no se queda esperando`);
ok(waited >= 3000, `y espera el tope antes de rendirse (${waited} ms)`);
ok(await page.evaluate(() => document.querySelectorAll("#tree li").length) === rowsBefore, "con el árbol de siempre");

/* ---------- 4. Con red otra vez: gana la red ---------- */
site.mode = "up";
site.dropConnections();
site.transform = h => h.replace("<title>", '<meta name="kite-test" content="v2"><title>');
await page.reload();
await waitAppReady(page);
ok(await page.evaluate(() => !!document.querySelector('meta[name="kite-test"][content="v2"]')),
  "con red se ve la versión NUEVA del servidor (red primero, no caché primero)");
ok(await page.evaluate(() => document.getElementById("offline-badge").hidden), "el indicador desaparece");
ok(errors.filter(e => !/net::ERR|Failed to load resource/.test(e)).length === 0, "sin errores de página: " + JSON.stringify(errors));

await ctx.close();
await browser.close();
site.close();
done();
