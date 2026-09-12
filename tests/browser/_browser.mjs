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

/* Abre la aplicación y espera a que esté viva de verdad, no solo a que
   el HTML haya llegado: `map` construido y el árbol resuelto (o con
   filas, o ya con su aviso de vacío). Esperar por una condición y no
   por un tiempo fijo es lo que evita una prueba que falla una vez de
   cada veinte en una máquina cargada.                                */
export async function openApp(browser, url, opts = {}) {
  const ctx = await browser.newContext(opts);
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
  await page.waitForFunction(() =>
    typeof map === "object" && map && typeof map.getZoom === "function"
    && !!document.querySelector("#tree .empty, #tree ul.node-list"));
  return { ctx, page, errors };
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
