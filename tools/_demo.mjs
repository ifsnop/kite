/* La aplicación lista para fotografiar, común a las herramientas que producen
   imágenes del README (tools/demo-gif.mjs y tools/social-image.mjs): la
   aplicación servida desde su archivo, un navegador limpio (inglés, tema claro,
   sin service worker) y las teselas de OpenStreetMap pedidas UNA vez cada una,
   con un User-Agent que dice quién las pide (su política de uso). Con
   `noBg`, una tesela lisa y sin red.

   Es el equivalente reducido de `openApp` de tools/capturas.mjs (que hace lo
   mismo en español y con los servicios simulados del manual).            */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { launch, READABLE } from "../tests/browser/_browser.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

/* Un PNG de 1×1 gris claro para `noBg` */
const BLANK_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/+L1fwAIfgN/f1c1QQAAAABJRU5ErkJggg==", "base64");

/* Abre la aplicación y devuelve { page, close, settle }. `tool` va en el User-Agent. */
export async function openDemoApp({ viewport, tool, noBg = false }) {
  const html = fs.readFileSync(READABLE);
  const server = http.createServer((q, s) => { s.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); s.end(html); });
  await new Promise(r => server.listen(0, "127.0.0.1", r));

  const tileCache = new Map();
  const tileRoute = async route => {
    try {
      if (noBg) return await route.fulfill({ status: 200, contentType: "image/png", body: BLANK_TILE });
      const url = route.request().url();
      if (!tileCache.has(url)) {
        const r = await route.fetch({ headers: { ...route.request().headers(),
          "user-agent": `KITE-Local-${tool}/${PKG.version} (+https://github.com/ifsnop/kite)` } });
        tileCache.set(url, { status: r.status(), headers: r.headers(), body: await r.body() });
      }
      const t = tileCache.get(url);
      return await route.fulfill({ status: t.status, headers: t.headers, body: t.body });
    } catch { /* contexto cerrado */ }
  };

  const browser = await launch();
  const ctx = await browser.newContext({ viewport, locale: "en-US", timezoneId: "Europe/Madrid", colorScheme: "light",
    serviceWorkers: "block", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.error("  pageerror:", e.message));
  /* Sin el aviso de falta de aceleración por hardware (esta máquina no tiene GPU) */
  await page.addInitScript(() => {
    const orig = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p) {
      return p === 0x9246 || p === 0x1F01 ? "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)" : orig.call(this, p);
    };
  });
  await page.route(/tile\.openstreetmap\.org/, tileRoute);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => typeof map === "object" && map && typeof map.getZoom === "function"
    && document.querySelector("#tree .empty") && document.querySelector("#tree .empty").textContent !== "Initializing…"
    && document.querySelector("#tree .empty").textContent !== "Inicializando…");

  /* Teselas del zoom actual llegadas y fundidas (Leaflet las funde en 200 ms) */
  const settle = async () => {
    await page.waitForFunction(() => {
      const t = [...document.querySelectorAll("#map img.leaflet-tile")].filter(i => i.src.includes(`/${Math.min(map.getZoom(), 19)}/`));
      return t.length > 0 && t.every(i => i.complete && i.naturalWidth > 0) && !document.querySelector("#map .leaflet-tile-loading");
    }, null, { timeout: 40000 });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.waitForTimeout(700);
  };
  const close = async () => { await ctx.close(); await browser.close(); server.close(); };
  return { page, ctx, settle, close };
}
