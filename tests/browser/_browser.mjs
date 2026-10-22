/* Lo compartido por las pruebas de navegador.

   Por qué hay pruebas de navegador, si las 40 suites de Node ya
   comprueban el archivo entregado: porque hay cosas que Node no puede
   decir. Que la aplicación ARRANQUE de verdad, que los iconos
   empotrados se pinten, que el minificado se comporte igual que el
   legible, y que el portapapeles del sistema lleve un árbol de una
   instancia a otra. Todo eso se estuvo comprobando a mano, fuera del
   repositorio, y por tanto no se comprobaba casi nunca.

   Por qué Playwright y no puppeteer, medido antes de elegir:
   - Es el único que conduce el portapapeles de punta a punta. Con
     puppeteer y un Chromium 129, `writeText` respondía
     `NotAllowedError` incluso desde un clic auténtico con los permisos
     concedidos, y un Ctrl+V real no disparaba ningún `paste`. Con el
     Chromium de Playwright las tres cosas funcionan.
   - `npm install` NO se trae ningún navegador (puppeteer sí): son
     12 MB en node_modules, y el navegador (unos 300 MB) va aparte, a
     ~/.cache/ms-playwright, solo si alguien ejecuta
     `npx playwright install chromium`. Quien solo quiera las suites de
     Node no paga nada.

   VERSIÓN FIJA Y SIN `^`: 1.61.1 es la última que se ejecuta en Node 18,
   que es el que trae Ubuntu 24 LTS. La 1.62 se niega en seco («Playwright
   requires Node.js 20 or higher»), así que un salto de versión menor
   rompería la máquina de quien no pueda actualizar Node sin que nadie
   haya tocado nada. Comprobado ejecutándolas, no leyendo `engines`: ese
   campo dice `>=18` en versiones que luego se niegan.                 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const READABLE = path.join(ROOT, "kitelocal.html");
export const MINIFIED = path.join(ROOT, "kitelocal.min.html");

/* Cómo se consigue un navegador, en orden:
   1. KITE_BROWSER=/ruta/al/chrome — cualquier Chromium ya instalado,
      para entornos donde no se pueda descargar nada.
   2. El que haya descargado `npx playwright install chromium`.
   Si no hay ninguno, launch() lanza y quien llama decide: las suites se
   SALTAN, no fallan, salvo que KITE_REQUIRE_BROWSER lo exija.        */
export function launchOptions() {
  return process.env.KITE_BROWSER ? { executablePath: process.env.KITE_BROWSER } : {};
}
export const launch = () => chromium.launch(launchOptions());

/* La aplicación se sirve por http:// y no se abre por file://: es como
   se usa de verdad (GitHub Pages), IndexedDB necesita un origen real
   para persistir entre recargas, y dos PUERTOS distintos son dos
   ORÍGENES distintos, que es justo lo que hace falta para probar el
   copiar y pegar entre instancias.                                   */
export async function serve(file, port) {
  const body = fs.readFileSync(file);
  const srv = http.createServer((q, s) => {
    s.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    s.end(body);
  });
  await new Promise(r => srv.listen(port, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${port}/`, close: () => srv.close() };
}

/* Un sitio como el de Pages para probar el uso sin conexión: el HTML en
   `/` y en su nombre, y `sw.js` con su tipo de contenido (el navegador
   rechaza un worker servido como text/html). El estado del "servidor" se
   cambia en caliente: `up` responde, `down` corta la conexión al instante
   (como un equipo sin red) y `hang` acepta la petición y no contesta
   (una red que no responde). `transform` cambia el HTML servido, para ver
   si una recarga con red trae la versión nueva.                        */
export async function serveSite(port, { file = READABLE, transform = h => h } = {}) {
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"));
  const site = { mode: "up", transform, hits: [] };
  const sockets = new Set();
  const srv = http.createServer((q, s) => {
    const p = q.url.split("?")[0];
    site.hits.push(q.method + " " + p);
    if (site.mode === "down") { q.socket.destroy(); return; }
    if (site.mode === "hang") return;
    if (p === "/sw.js") {
      s.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
      return s.end(sw);
    }
    if (p === "/" || p === "/kitelocal.html" || p === "/kitelocal.min.html" || p === "/index.html") {
      s.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      return s.end(site.transform(fs.readFileSync(file, "utf8")));
    }
    s.writeHead(404); s.end();
  });
  srv.on("connection", sock => { sockets.add(sock); sock.on("close", () => sockets.delete(sock)); });
  await new Promise(r => srv.listen(port, "127.0.0.1", r));
  site.url = `http://127.0.0.1:${port}/`;
  /* Tras un `hang`, las conexiones con una petición sin contestar hay que
     cortarlas: el navegador las reutiliza y la siguiente petición, ya con
     el servidor sano, se quedaría detrás de la que nunca se contestó
     (en una red real eso lo resuelve el tiempo; aquí no pasa).         */
  site.dropConnections = () => { for (const s of sockets) s.destroy(); };
  site.close = () => { srv.closeAllConnections?.(); srv.close(); };
  return site;
}

/* Abre la aplicación y espera a que esté viva de verdad, no solo a que
   el HTML haya llegado: `map` construido y el árbol resuelto (o con
   filas, o ya con su aviso de vacío). Esperar por una condición y no
   por un tiempo fijo es lo que evita una prueba que falla una vez de
   cada veinte en una máquina cargada.                                */
export async function openApp(browser, url, opts = {}) {
  /* Sin service worker por defecto: con uno controlando la página,
     `page.route` ya no ve las peticiones que el worker contesta (lo
     usan las pruebas de librerías bajo demanda y de WCS). Solo
     offline.mjs lo quiere, y lo pide con `serviceWorkers: "allow"`.  */
  /* `locale: "es-ES"`: las suites comparan textos en español y «Automático»
     sigue al navegador (Playwright arranca en en-US); lo de los idiomas lo
     prueba browser/i18n.mjs, que pasa el suyo.                          */
  const ctx = await browser.newContext({ serviceWorkers: "block", locale: "es-ES", ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.evaluateOnNewDocument?.(() => {});
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation",
      e => window.__csp.push(e.violatedDirective + " ← " + e.blockedURI));
  });
  await page.goto(url);
  await waitAppReady(page);
  return { ctx, page, errors };
}

/* Espera a que la aplicación esté viva de verdad (también tras un
   `page.reload()`): ver el comentario de abajo. */
export async function waitAppReady(page) {
  /* El árbol pasa por DOS estados con la MISMA clase ("empty": primero
     "Inicializando…", luego, si de verdad no hay nada guardado, "No hay
     capas cargadas.") — `showTreePlaceholder`, 30-tree-walk.js. Esperar
     solo la clase capturaba a veces el intermedio: invisible mientras el
     arranque (99-boot.js) tuviera poco que leer de IndexedDB antes de
     resolver el árbol, hasta que una lectura más (la URL de "Custom
     Tile Map Service") alargó lo suficiente esa ventana como para que el sondeo la
     viera. Comprobar el TEXTO del placeholder, no solo su clase, espera
     el estado de verdad final en los dos casos (con árbol guardado, hay
     `ul.node-list`, directamente).                                     */
  await page.waitForFunction(() => {
    if (!(typeof map === "object" && map && typeof map.getZoom === "function")) return false;
    if (document.querySelector("#tree ul.node-list")) return true;
    const empty = document.querySelector("#tree .empty");
    return !!empty && empty.textContent !== "Inicializando…";
  });
}

/* Marcador de resultados, con el mismo estilo que las suites de Node
   para que la salida del runner se lea igual.                        */
export function reporter(name) {
  let failed = 0;
  const ok = (cond, msg) => { if (!cond) { console.error("FAIL: " + msg); failed++; } };
  const done = () => {
    if (failed) { console.error(`${failed} comprobación(es) fallidas`); process.exit(1); }
    console.log(name);
  };
  return { ok, done };
}
