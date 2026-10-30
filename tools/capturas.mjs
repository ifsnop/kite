/* Capturas del manual de usuario (docs/manual-usuario-kite-local.md).

   Uso:
     npm run capturas                    todas
     npm run capturas perfil-ruta ...    solo esas (con o sin «.png»)
     npm run capturas -- --lista         qué escenarios hay
     npm run capturas -- --sin-fondo     sin red: teselas de relleno liso

   Una captura = un escenario: arranca la aplicación limpia (contexto
   nuevo, IndexedDB vacía), prepara el estado con los datos de
   docs/ejemplos/ y los servicios simulados, y fotografía. Así cualquier
   cambio de interfaz se regenera con un comando y la figura nunca
   describe una interfaz que ya no existe. Funcionalidad nueva con algo
   que ver = escenario nuevo en el MISMO cambio (ver
   .claude/rules/docs-maintenance.md).

   Fijo para que dos ejecuciones den lo mismo: ventana de 1440×900, es-ES,
   tema claro, las horas visibles (ver `stamps`), y sin el aviso de falta de aceleración por
   hardware (esta máquina no tiene GPU; el manual no debe enseñar ese
   aviso). El fondo es OpenStreetMap real: hace falta red, salvo con
   --sin-fondo.

   Escribe docs/img/capturas.json (versión, build, fecha y sha256 de cada
   imagen) que vigila tests/docs.js: una captura tocada a mano, o sin
   regenerar al subir de versión, hace fallar las pruebas.            */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { launch, READABLE } from "../tests/browser/_browser.mjs";
import { ignFakes, IGN_ROUTE } from "../tests/browser/_fakes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const IMG = path.join(ROOT, "docs", "img");
const EJEMPLOS = path.join(ROOT, "docs", "ejemplos");
const FIXTURES = path.join(ROOT, "tests", "fixtures");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const MANIFEST = path.join(IMG, "capturas.json");
/* Imágenes que NO se regeneran (no caben en el repositorio) */
const EXTERNAL = { "ortofoto-cog.png": "Sentinel-2 de 362 MB: no se puede versionar ni regenerar" };

const args = process.argv.slice(2);
const NO_BG = args.includes("--sin-fondo");
const ONLY = args.filter(a => !a.startsWith("--")).map(a => a.replace(/\.png$/, ""));
const PORT = 8951;
/* 10:30 en Madrid (CET, UTC+1) */
const NOW = new Date("2026-10-29T09:30:00Z");
const VIEW = { width: 1440, height: 900 };
/* Madrid, el centro de la escena de ejemplo */
const CENTER = [40.405, -3.69];
const ZOOM = 14;

const ejemplo = n => fs.readFileSync(path.join(EJEMPLOS, n), "utf8");
const fixture = n => fs.readFileSync(path.join(FIXTURES, n));

/* ---------------- Servidores: la aplicación y el «remoto.kml» ---------------- */
/* Dos puertos son dos orígenes distintos: la segunda instancia hace de destino
   de «copiar y pegar entre instancias» (apartado 7.5).                    */
const html = fs.readFileSync(READABLE);
const servers = [PORT, PORT + 1].map(port => {
  const srv = http.createServer((q, s) => {
    if (q.url.startsWith("/remoto.kml")) {
      s.writeHead(200, { "Content-Type": "application/vnd.google-earth.kml+xml" });
      return s.end(ejemplo("remoto.kml"));
    }
    s.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    s.end(html);
  });
  return new Promise(r => srv.listen(port, "127.0.0.1", () => r(srv)));
});
const [server, server2] = await Promise.all(servers);
const APP = `http://127.0.0.1:${PORT}/`;
const APP2 = `http://127.0.0.1:${PORT + 1}/`;

/* Una teselita lisa (PNG 1×1 gris claro) para --sin-fondo */
const BLANK_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/+L1fwAIfgN/f1c1QQAAAABJRU5ErkJggg==", "base64");

/* Las teselas se piden UNA vez por ejecución, aunque cada escenario sea un
   contexto nuevo: son unas decenas y la política de uso de OpenStreetMap
   pide no repetirlas. Con un User-Agent que dice quién las pide.         */
const tileCache = new Map();
async function tileRoute(route) {
  /* Una tesela pedida cuando el escenario ya cerró su contexto (la vista
     inicial a zoom 6) lanza al servirla: no es un fallo de la captura.  */
  try {
    if (NO_BG) return await route.fulfill({ status: 200, contentType: "image/png", body: BLANK_TILE });
    const url = route.request().url();
    if (!tileCache.has(url)) {
      const r = await route.fetch({ headers: { ...route.request().headers(),
        "user-agent": `KITE-Local-capturas/${PKG.version} (+https://github.com/ifsnop/kite)` } });
      tileCache.set(url, { status: r.status(), headers: r.headers(), body: await r.body() });
    }
    const t = tileCache.get(url);
    return await route.fulfill({ status: t.status, headers: t.headers, body: t.body });
  } catch { /* contexto cerrado */ }
}

const browser = await launch();

/* ---------------- Utilidades ---------------- */

/* Abre la aplicación con el estado de partida fijo y devuelve la página.
   `opts`: viewport, colorScheme, locale, route(page) para simular servicios. */
async function openApp(opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || VIEW, locale: opts.locale || "es-ES", timezoneId: "Europe/Madrid",
    colorScheme: opts.colorScheme || "light", serviceWorkers: opts.serviceWorkers || "block",
    deviceScaleFactor: 1, hasTouch: !!opts.touch, isMobile: !!opts.touch,
    permissions: ["clipboard-read", "clipboard-write"]
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.error("  pageerror:", e.message));
  /* Sin el aviso de falta de aceleración por hardware (ver arriba) */
  await page.addInitScript(() => {
    const orig = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p) {
      return p === 0x9246 || p === 0x1F01 ? "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)" : orig.call(this, p);
    };
  });
  await page.route(/tile\.openstreetmap\.org|tms-pnoa|server\.arcgisonline|ows\.terrestris/, tileRoute);
  if (opts.route) await opts.route(page);
  await page.goto(opts.url || APP);
  await page.waitForFunction(() => typeof map === "object" && map && typeof map.getZoom === "function"
    && (document.querySelector("#tree ul.node-list") || (document.querySelector("#tree .empty")
      && document.querySelector("#tree .empty").textContent !== "Inicializando…")));
  return { ctx, page };
}

/* Espera a que las teselas del mapa hayan llegado y el dibujo se asiente */
async function settle(page, { ms = 250, tiles = true } = {}) {
  if (tiles) {
    /* Hay teselas del zoom actual y todas han llegado: sin lo primero se
       daba por buena la vista con las del zoom anterior, aún sin cambiar. */
    await page.waitForFunction(() => {
      /* OpenStreetMap no pasa del nivel 19: por encima, Leaflet amplía esas teselas */
      const z = Math.min(map.getZoom(), 19);
      const t = [...document.querySelectorAll("#map img.leaflet-tile")].filter(i => i.src.includes(`/${z}/`));
      return t.length > 0 && t.every(i => i.complete && i.naturalWidth > 0) && !document.querySelector("#map .leaflet-tile-loading");
    }, null, { timeout: 40000 });
  }
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(ms);
}

const view = (page, center = CENTER, zoom = ZOOM) =>
  page.evaluate(([c, z]) => map.setView(c, z, { animate: false }), [center, zoom]);

/* Las fechas y horas que enseña la interfaz (avisos, carpeta de la sesión de
   elevaciones) son las del reloj de quien ejecuta el script: se sustituyen
   por la fecha fija NOW justo antes de fotografiar, para que dos ejecuciones
   den la misma imagen. No se fija el reloj de la página: el fundido de las
   teselas de Leaflet lo mide con Date y se quedaría a medias.             */
const stamps = page => page.evaluate(([date, time]) => {
  const re = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?/g;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    if (re.test(n.nodeValue)) { re.lastIndex = 0; n.nodeValue = n.nodeValue.replace(re, (m, sec) => `${date} ${sec ? time : time.slice(0, 5)}`); }
    re.lastIndex = 0;
  }
}, [NOW.toISOString().slice(0, 10), "10:30:00"]);

/* Suelta un archivo como si se arrastrara del escritorio. Un GeoJSON abre
   «Elegir nombre»: se elige «name» y se acepta, salvo con `keepPicker`.  */
async function drop(page, name, text, { pick = ["name"], keepPicker = false } = {}) {
  await page.evaluate(([n, t]) => { window.__drop = handleDroppedFiles([new File([t], n)]); }, [name, text]);
  if (/\.geojson$/.test(name)) {
    await page.waitForFunction(() => !document.getElementById("geojson-name-picker").hidden);
    if (keepPicker) return;
    for (const k of pick) await page.click(`#gnp-list .gnp-row[data-key="${k}"] input`);
    await page.click("#gnp-accept");
  }
  await page.evaluate(() => window.__drop);
}

/* La escena de casi todas las figuras: «Operación Sierra» y los sensores.
   `sensores: false` deja fuera el GeoJSON; `expand` despliega su carpeta. */
async function sierra(page, { sensores = true, expandSensores = false, accept = false } = {}) {
  await drop(page, "operacion-sierra.kml", ejemplo("operacion-sierra.kml"));
  if (sensores) await drop(page, "sensores.geojson", ejemplo("sensores.geojson"));
  await view(page);
  if (sensores && expandSensores) await expandNode(page, "sensores.geojson");
  if (accept) await page.click(".nav-msg-ok").catch(() => {});
  await settle(page);
}

/* Fila del árbol por nombre (el nombre del nodo, no el texto de la fila) */
const rowRect = (page, name) => page.evaluate(n => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  const r = li.querySelector(":scope > .node-row").getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, name);
/* Despliega una carpeta sin pulsar su flecha (el clic dejaría la fila marcada como «actual») */
const expandNode = (page, name) => page.evaluate(async n => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  li.classList.remove("collapsed");
  syncExpanded(li);
  await ensureMaterialized(li);
  await new Promise(r => setTimeout(r, 150));
}, name);
/* Posición en la PÁGINA de un punto geográfico (para clics y el ratón) */
const pt = (page, lat, lng) => page.evaluate(([la, ln]) => {
  const p = map.latLngToContainerPoint([la, ln]);
  const b = map.getContainer().getBoundingClientRect();
  return { x: b.x + p.x, y: b.y + p.y };
}, [lat, lng]);
/* Ejecuta `fn(li, arg)` en la página sobre la fila con ese nombre */
const onRow = (page, name, fn, arg) => page.evaluate(([n, f, a]) => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  if (!li) throw new Error(`no hay fila «${n}»`);
  return new Function("li", "arg", "return (" + f + ")(li, arg)")(li, a);
}, [name, fn.toString(), arg]);
const clickRow = (page, name, opts = {}) => rowRect(page, name)
  .then(r => page.mouse.click(r.x + 90, r.y + r.height / 2, opts));

/* Captura una región, recortada a la ventana */
const clip = (x, y, width, height) => ({ x, y, width, height });
/* El árbol, de la primera fila a la última y a lo ancho del panel (sin el mapa) */
const treeShot = async (page, file) => {
  await page.evaluate(() => getSelection().removeAllRanges());
  await stamps(page);
  const b = await page.locator("#tree ul.node-list").first().boundingBox();
  const w = (await page.locator("#nav-panel").boundingBox()).width;
  return page.screenshot({ path: file, clip: clip(0, Math.max(0, b.y - 8), w, b.height + 16) });
};
const dialog = async (page, file, id) => { await stamps(page); return page.locator(`#${id} .dlg-box`).screenshot({ path: file }); };
const fullShot = async (page, file) => { await stamps(page); return page.screenshot({ path: file }); };

/* ---------------- Escenarios ---------------- */
const SCENARIOS = []; /* { file, section, run(out) } */
/* `extra`: las demás imágenes que escribe el mismo escenario */
const scenario = (file, section, run, extra = []) => SCENARIOS.push({ file, section, run, extra });

/* ===== 1. Idea general ===== */
scenario("vista-general.png", "1", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  await fullShot(page, out);
  await ctx.close();
});

/* ===== 2.1 Cabecera ===== */
scenario("cabecera-panel.png", "2.1", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  await stamps(page);
  const b = await page.locator("#nav-panel header").boundingBox();
  await page.screenshot({ path: out, clip: clip(0, 0, b.width, b.y + b.height) });
  await ctx.close();
});


/* vista general: con el ratón sobre el mapa, para que el cuadro de coordenadas tenga datos */
SCENARIOS.find(x => x.file === "vista-general.png").run = async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  const q = await pt(page, 40.4125, -3.7);
  await page.mouse.move(q.x, q.y);
  await page.waitForTimeout(200);
  await fullShot(page, out);
  await ctx.close();
};

/* ===== 2.1 Cabecera: buscador de lugares, registro, Propiedades, cálculos ===== */
scenario("buscador-lugares.png", "2.1", async out => {
  const { ctx, page } = await openApp({ route: p => p.route(/nominatim\.openstreetmap\.org/, r => r.fulfill({
    status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify([
      { lat: "39.8567775", lon: "-4.0244759", name: "Toledo", display_name: "Toledo, Castilla-La Mancha, España",
        boundingbox: ["39.8284", "39.8885", "-4.0733", "-3.9863"] },
      { lat: "39.8628316", lon: "-4.0273231", name: "Toledo", display_name: "Toledo, Comarca de Toledo, Castilla-La Mancha, España",
        boundingbox: ["39.6", "40.1", "-4.4", "-3.7"] }]) })) });
  await sierra(page);
  await page.fill("#place-box", "Toledo, España");
  await page.press("#place-box", "Enter");
  await page.waitForSelector("#place-list li");
  await stamps(page);
  const b = await page.locator("#place-results").boundingBox();
  await page.screenshot({ path: out, clip: clip(0, 0, 400, b.y + b.height + 70) });
  await ctx.close();
});

scenario("registro-avisos.png", "2.1", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  await page.click("#log-btn");
  await page.waitForSelector("#log-dialog:not([hidden])");
  await dialog(page, out, "log-dialog");
  await ctx.close();
});

scenario("propiedades-preferencias.png", "2.1", async out => {
  const { ctx, page } = await openApp({ viewport: { width: 1440, height: 1100 } });
  await page.click("#gnp-editor-btn");
  await page.waitForSelector("#props-dialog:not([hidden])");
  /* La caja se redimensiona (resize: both): más alta, para ver todas las filas */
  await page.evaluate(() => { document.querySelector("#props-dialog .dlg-box").style.height = "860px"; });
  await page.waitForTimeout(200);
  await dialog(page, out, "props-dialog");
  await ctx.close();
});

scenario("propiedades-fuentes.png", "2.1", async out => {
  const { ctx, page } = await openApp();
  await page.click("#gnp-editor-btn");
  await page.click("#props-tab-btn-sources");
  await dialog(page, out, "props-dialog");
  await ctx.close();
});

scenario("calculos-geodesicos.png", "2.1", async out => {
  const { ctx, page } = await openApp();
  await page.click("#geocalc-btn");
  await page.waitForSelector("#geocalc-dialog:not([hidden])");
  await page.selectOption("#geocalc-h1-unit", "m");
  await page.fill("#geocalc-h1", "24.21");
  await page.selectOption("#geocalc-h2-unit", "ft");
  await page.fill("#geocalc-h2", "45000");
  await page.selectOption("#geocalc-d-unit", "nm");
  await page.fill("#geocalc-d", "12.2");
  await page.waitForFunction(() => document.getElementById("geocalc-elev-result").textContent.trim().length > 0);
  await dialog(page, out, "geocalc-dialog");
  await ctx.close();
});

/* ===== 2.2-2.4 Pie del panel: zona de soltar, buscador del árbol y cifras ===== */
scenario("pie-panel.png", "2.2", async out => {
  const { ctx, page } = await openApp();
  await sierra(page, { expandSensores: true });
  await page.fill("#search-box", "zona");
  await page.waitForFunction(() => /\d/.test(document.getElementById("search-count").textContent));
  await stamps(page);
  const d = await page.locator("#dropzone").boundingBox();
  await page.screenshot({ path: out, clip: clip(0, d.y - 8, 400, VIEW.height - d.y + 8) });
  await ctx.close();
});

/* ===== 3. El árbol ===== */
scenario("arbol-estructura.png", "3", async out => {
  const { ctx, page } = await openApp();
  await sierra(page, { expandSensores: true });
  await treeShot(page, out);
  await ctx.close();
});

scenario("checkbox-indeterminado.png", "3.2", async out => {
  const { ctx, page } = await openApp();
  await sierra(page, { expandSensores: true });
  await onRow(page, "Zona B", li => li.querySelector(":scope > .node-row input[type=checkbox]").click());
  await page.waitForTimeout(300);
  await treeShot(page, out);
  await ctx.close();
});

scenario("fila-seleccionada.png", "3.3", async out => {
  const { ctx, page } = await openApp();
  await sierra(page, { expandSensores: true });
  await clickRow(page, "Zona A");
  const r = await rowRect(page, "Zona A");
  await page.mouse.move(r.x + r.width - 120, r.y + r.height / 2);
  await page.waitForTimeout(200);
  await treeShot(page, out);
  await ctx.close();
});

scenario("seleccion-multiple.png", "3.4", async out => {
  const { ctx, page } = await openApp();
  await sierra(page, { expandSensores: true });
  await clickRow(page, "Base");
  await page.keyboard.down("Shift");
  await clickRow(page, "Punto de control");
  await page.keyboard.up("Shift");
  await page.mouse.move(700, 700);
  await treeShot(page, out);
  await ctx.close();
});

/* ===== 4. El visor ===== */
scenario("mapas-base.png", "4.1", async out => {
  const { ctx, page } = await openApp({ viewport: { width: 1440, height: 1200 } });
  await sierra(page);
  await page.click(".base-toggle");
  await page.waitForSelector(".base-list:not([hidden])");
  await page.waitForTimeout(300);
  await stamps(page);
  const b = await page.locator(".base-box").boundingBox();
  await page.screenshot({ path: out, clip: clip(b.x - 330, b.y - 6, b.width + 336, b.height + 14) });
  await ctx.close();
});

scenario("custom-wms.png", "4.1", async out => {
  const { ctx, page } = await openApp();
  await page.click(".base-toggle");
  await page.click('.base-gear[title*="Web Map"]');
  await page.waitForSelector("#custom-wms-creds:not([hidden])");
  await page.fill("#custom-wms-input", "https://mi-servidor.ejemplo.org/wms");
  await dialog(page, out, "custom-wms-creds");
  await ctx.close();
});

scenario("barra-herramientas.png", "4.2", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  await stamps(page);
  await page.screenshot({ path: out, clip: clip(410, 4, 50, 436) });
  await ctx.close();
});

scenario("mapa-girado.png", "4.4", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  await page.evaluate(() => map.setBearing(32));
  await settle(page);
  await fullShot(page, out);
  await ctx.close();
});

/* ===== 5. Menú contextual ===== */
scenario("menu-contextual.png", "5", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  await page.mouse.move(1000, 100);
  await page.mouse.click(1000, 100, { button: "right" });
  await page.waitForSelector("#map-ctxmenu:not([hidden])");
  await fullShot(page, out);
  await ctx.close();
});

scenario("menu-consultas.png", "5", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  await page.mouse.move(1000, 100);
  await page.mouse.click(1000, 100, { button: "right" });
  await page.waitForSelector("#map-ctxmenu:not([hidden])");
  await page.locator("#map-ctxmenu .ctx-menu-item", { hasText: "Consultas" }).hover();
  await page.waitForTimeout(300);
  await fullShot(page, out);
  await ctx.close();
});

scenario("menu-contextual-submenu.png", "5", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  const q = await pt(page, 40.401, -3.708);
  await page.mouse.move(q.x, q.y);
  await page.mouse.click(q.x, q.y, { button: "right" });
  await page.waitForSelector("#map-ctxmenu:not([hidden])");
  await page.locator("#map-ctxmenu .ctx-menu-item", { hasText: "Ir al nodo en el panel" }).hover();
  await page.waitForTimeout(300);
  await fullShot(page, out);
  await ctx.close();
});

/* ===== 6. Estilos de capa ===== */
scenario("estilo-marcador.png", "6.1", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  await onRow(page, "Base", li => openStyleDialog(li));
  await page.waitForSelector("#style-dialog:not([hidden])");
  await dialog(page, out, "style-dialog");
  await ctx.close();
});

scenario("selector-iconos.png", "6.1", async out => {
  const { ctx, page } = await openApp({ viewport: { width: 1440, height: 1500 } });
  await sierra(page);
  await onRow(page, "Base", li => openStyleDialog(li));
  await page.click("#icon-preview-btn");
  await page.waitForSelector("#icon-picker:not([hidden])");
  await page.waitForTimeout(400);
  await dialog(page, out, "icon-picker");
  await ctx.close();
});

scenario("estilo-poligono.png", "6.2", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  await onRow(page, "Zona A", li => openStyleDialog(li));
  await page.waitForSelector("#style-dialog:not([hidden])");
  await dialog(page, out, "style-dialog");
  await ctx.close();
});

scenario("editor-puntos.png", "6.2", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  await onRow(page, "Zona A", li => openStyleDialog(li));
  await page.click("#pg-points");
  await page.waitForSelector("#points-dialog:not([hidden])");
  await dialog(page, out, "points-dialog");
  await ctx.close();
});

/* Una ruta de verdad, de la Base al Punto de control (1,92 NM a 108,2°) */
async function rutaBaseControl(page) {
  await page.evaluate(() => {
    setTool("route");
    addRouteVertex(L.latLng(40.415, -3.71));
    addRouteVertex(L.latLng(40.405, -3.67));
  });
  await page.waitForSelector("#style-dialog:not([hidden])");
  await page.evaluate(() => finishRoute());
  await page.waitForFunction(() => document.getElementById("style-dialog").hidden);
  await page.waitForTimeout(200);
}

scenario("estilo-medicion.png", "6.3", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  await rutaBaseControl(page);
  await onRow(page, "Ruta 1", li => openStyleDialog(li)).catch(async () => {
    /* el nombre de la fila lleva la medida: «Ruta 1 — 1.92 NM · 108.2°» */
    await page.evaluate(() => openStyleDialog([...document.querySelectorAll("#tree li")].find(x => /^Ruta 1/.test(x._name))));
  });
  await page.waitForSelector("#style-dialog:not([hidden])");
  await dialog(page, out, "style-dialog");
  await ctx.close();
});

scenario("editar-varios.png", "6.4", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  await clickRow(page, "Zona A");
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await clickRow(page, "Zona B");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await page.keyboard.press("Alt+Enter");
  await page.waitForSelector("#style-dialog:not([hidden])");
  await dialog(page, out, "style-dialog");
  await ctx.close();
});

scenario("ficha-propiedades.png", "6.5", async out => {
  const { ctx, page } = await openApp();
  await sierra(page, { expandSensores: true });
  await onRow(page, "Sensor 1", li => showLayerInfo(li));
  await page.waitForSelector("#desc-dialog:not([hidden])");
  await dialog(page, out, "desc-dialog");
  await ctx.close();
});

/* ===== 7. Tareas ===== */
scenario("elegir-nombre.png", "7.1", async out => {
  const { ctx, page } = await openApp();
  await drop(page, "sensores.geojson", ejemplo("sensores.geojson"), { keepPicker: true });
  await page.click('#gnp-list .gnp-row[data-key="name"] input');
  await page.click('#gnp-list .gnp-row[data-key="categoria"] input');
  await dialog(page, out, "geojson-name-picker");
  await ctx.close();
});

scenario("duplicados.png", "7.1", async out => {
  const { ctx, page } = await openApp();
  const pm = n => `<Placemark><name>${n}</name><Point><coordinates>-3.70,40.41,0</coordinates></Point></Placemark>`;
  await page.evaluate(t => { window.__drop = handleDroppedFiles([new File([t], "repetidos.kml")]); },
    `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Repetidos</name>${pm("Antena 1")}${pm("Antena 1")}${pm("Antena 2")}</Document></kml>`);
  await page.waitForSelector("#kml-dup-picker:not([hidden])");
  await dialog(page, out, "kml-dup-picker");
  await ctx.close();
});

scenario("etiquetas-html.png", "7.1", async out => {
  const { ctx, page } = await openApp();
  await page.evaluate(t => { window.__drop = handleDroppedFiles([new File([t], "etiquetas.kml")]); },
    `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Con etiquetas</name>` +
    `<Placemark><name>&lt;b&gt;Antena 1&lt;/b&gt;</name><Point><coordinates>-3.70,40.41,0</coordinates></Point></Placemark>` +
    `<Placemark><name>&lt;i&gt;Antena 2&lt;/i&gt;</name><Point><coordinates>-3.69,40.41,0</coordinates></Point></Placemark></Document></kml>`);
  await page.waitForSelector("#kml-tags-picker:not([hidden])");
  await dialog(page, out, "kml-tags-picker");
  await ctx.close();
});

scenario("anadir-url.png", "7.1", async out => {
  const { ctx, page } = await openApp();
  await page.click("#url-btn");
  await page.waitForSelector("#url-dialog:not([hidden])");
  await page.fill("#url-input", `${APP}remoto.kml`);
  await page.click("#url-fetch");
  await page.waitForFunction(() => !document.getElementById("url-add").disabled);
  await dialog(page, out, "url-dialog");
  await ctx.close();
});

scenario("medicion-mapa.png", "7.2", async out => {
  const { ctx, page } = await openApp();
  await sierra(page, { expandSensores: true });
  await rutaBaseControl(page);
  const q = await pt(page, 40.395, -3.665);
  await page.mouse.move(q.x, q.y);
  await fullShot(page, out);
  await ctx.close();
});

scenario("dibujar-poligono.png", "7.3", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  await page.evaluate(() => setTool("polygon"));
  const pts = [[40.4285, -3.700], [40.4300, -3.672], [40.4245, -3.652], [40.4185, -3.664]];
  for (const [la, ln] of pts) {
    const q = await pt(page, la, ln);
    await page.mouse.click(q.x, q.y);
  }
  const next = await pt(page, 40.4185, -3.690);
  await page.mouse.move(next.x, next.y, { steps: 4 });
  await page.waitForTimeout(250);
  await fullShot(page, out);
  await ctx.close();
});


scenario("copiar-origen.png", "7.5", async out => {
  /* Dos instancias en orígenes distintos (dos puertos) y el portapapeles del
     sistema: Ctrl+C en la primera, Ctrl+V en la segunda, como en la vida real. */
  const A = await openApp();
  await sierra(A.page);
  await clickRow(A.page, "Zonas");
  await A.page.evaluate(() => document.getElementById("tree").focus());
  await A.page.keyboard.press("Control+C");
  await A.page.waitForTimeout(400);
  await A.page.mouse.move(900, 700);
  await treeShot(A.page, out);
  const B = await openApp({ url: APP2 });
  await B.page.evaluate(() => document.getElementById("tree").focus());
  await B.page.keyboard.press("Control+V");
  await B.page.waitForFunction(() => [...document.querySelectorAll("#tree li")].some(li => li._name === "Zonas"));
  await B.page.waitForTimeout(500);
  await B.page.mouse.move(900, 700);
  await treeShot(B.page, path.join(path.dirname(out), "pegar-destino.png"));
  await A.ctx.close(); await B.ctx.close();
}, ["pegar-destino.png"]);

/* ===== 7.6 Guardar o exportar ===== */
scenario("menu-exportar.png", "7.6", async out => {
  const { ctx, page } = await openApp();
  await sierra(page, { expandSensores: true });
  const r = await rowRect(page, "Zona A");
  await page.mouse.move(r.x + r.width - 120, r.y + r.height / 2);
  await page.waitForTimeout(200);
  await onRow(page, "Zona A", li => li.querySelector(':scope > .node-row button[aria-label^="Guardar o exportar"]').click());
  await page.waitForSelector(".ctx-menu:not(#map-ctxmenu)");
  await stamps(page);
  const m = await page.locator(".ctx-menu:not(#map-ctxmenu)").boundingBox();
  const top = Math.max(0, r.y - 24);
  await page.screenshot({ path: out, clip: clip(0, top, m.x + m.width + 12, m.y + m.height + 16 - top) });
  await ctx.close();
});

/* ===== 7.8 Elevaciones ===== */
const ignRoute = fake => page => page.route(IGN_ROUTE, fake.handler);
const TERESA = [40.4153, -3.7038]; /* CL Paz 11, Madrid */

scenario("consulta-elevacion.png", "7.8", async out => {
  const fake = ignFakes();
  const { ctx, page } = await openApp({ route: ignRoute(fake) });
  await view(page, TERESA, 20);
  await settle(page);
  const q = await pt(page, ...TERESA);
  await page.mouse.click(q.x, q.y, { button: "right" });
  await page.locator("#map-ctxmenu .ctx-menu-item", { hasText: "Consultas" }).click();
  await page.locator(".ctx-menu:not(#map-ctxmenu) .ctx-menu-item", { hasText: "Elevación" }).click();
  await page.waitForFunction(() => elevGridGroups.length > 0, null, { timeout: 30000 });
  await settle(page, { ms: 500 });
  /* El ratón sobre una celda: el cuadro de coordenadas lee MDT, MDS y su diferencia */
  await page.mouse.move(q.x - 30, q.y + 14, { steps: 3 });
  await page.waitForTimeout(300);
  await fullShot(page, out);
  await page.mouse.move(q.x - 29, q.y + 14);
  await page.waitForTimeout(200);
  await stamps(page);
  const b = await page.locator(".coords-box").boundingBox();
  await page.screenshot({ path: path.join(path.dirname(out), "coordenadas-elevacion.png"),
    clip: clip(b.x - 4, b.y - 4, b.width + 8, b.height + 8) });
  await ctx.close();
}, ["coordenadas-elevacion.png"]);

/* La ruta de los dos ejemplos del perfil: una ruta de 40 km con cinco vértices */
const dest = ([lat, lng], bearing, meters) => {
  const R = 6371000, d = meters / R, b = bearing * Math.PI / 180, p1 = lat * Math.PI / 180, l1 = lng * Math.PI / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 * 180 / Math.PI, l2 * 180 / Math.PI];
};
const RUTA40 = (() => {
  const pts = [[40.30, -4.00]];
  for (const [b, m] of [[90, 9000], [82, 12500], [96, 11500], [88, 7000]]) pts.push(dest(pts.at(-1), b, m));
  return pts.map(([lat, lng]) => ({ lat, lng }));
})();

scenario("perfil-ruta.png", "7.9", async out => {
  /* Relieve de ejemplo (no de un servicio real) a lo largo de la ruta, de oeste a este */
  const fake = ignFakes();
  const X0 = 6378137 * (-4.0 * Math.PI / 180);
  fake.terrain = (x, mds) => {
    const d = (x - X0) * 0.7625, T = 2 * Math.PI;
    return 620 + 170 * Math.sin(T * d / 5200 + 0.6) + 110 * Math.sin(T * d / 2100 + 1.1) + 60 * Math.sin(T * d / 9500)
      + (mds ? 6 + 8 * Math.abs(Math.sin(d / 410)) : 0);
  };
  const { ctx, page } = await openApp({ route: ignRoute(fake) });
  await page.evaluate(wps => {
    setMeasureUnit("km"); setAltitudeUnit("m");
    profileMaxM = 100 * 1852;
    const m = buildRouteMeasurement(wps);
    finalizeRouteMeasurement(m);
    map.fitBounds(m.group.getBounds(), { animate: false, padding: [60, 60] });
  }, RUTA40);
  await settle(page);
  await page.evaluate(() => {
    const li = [...document.querySelectorAll("#tree li")].find(x => x._measure && x._measure.type === "route");
    demTimes.length = 0;
    openStyleDialog(li);
    document.getElementById("ms-profile").click();
    document.getElementById("style-cancel").click();
  });
  await page.waitForFunction(() => document.getElementById("profile-close").title === "Cerrar" && !profileChart.hidden,
    null, { timeout: 120000 });
  /* Línea inicio–fin, elipsoide de Fresnel y curvatura; torres de 25 y 40 m (la final, en el último vértice) */
  await page.evaluate(() => {
    const box = document.querySelector("#profile-dialog .dlg-box");
    box.style.width = "980px"; box.style.height = "600px";
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("change", { bubbles: true })); e.dispatchEvent(new Event("input", { bubbles: true })); };
    document.getElementById("pf-los").click();
    document.getElementById("pf-fresnel").click();
    set("pf-tower-a", "25");
    set("pf-tower-b", "40");
    const b = document.getElementById("pf-tower-b-at"); set("pf-tower-b-at", b.options[b.options.length - 1].value);
    set("pf-curve", "classic");
  });
  await page.waitForTimeout(600);
  /* El cursor sobre el vértice del medio: la lectura se llena */
  const at = await page.evaluate(() => {
    const r = document.querySelector("#profile-chart svg").getBoundingClientRect();
    return { x: r.x + profileLayout.xOf(profileData.vertices[2]), y: r.y + 180 };
  });
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await page.waitForTimeout(400);
  await dialog(page, out, "profile-dialog");
  await ctx.close();
});

scenario("menu-ruta-perfil.png", "7.9", async out => {
  const fake = ignFakes();
  const { ctx, page } = await openApp({ route: ignRoute(fake) });
  await sierra(page);
  await rutaBaseControl(page);
  const q = await pt(page, 40.41, -3.69);
  await page.mouse.move(q.x, q.y);
  await page.mouse.click(q.x, q.y, { button: "right" });
  await page.waitForSelector("#map-ctxmenu:not([hidden])");
  await fullShot(page, out);
  await ctx.close();
});

/* ===== 7.11 Sin conexión ===== */
scenario("sin-conexion.png", "7.11", async out => {
  const { ctx, page } = await openApp();
  await sierra(page);
  await ctx.setOffline(true);
  await page.waitForSelector("#offline-badge:not([hidden])");
  await page.waitForTimeout(300);
  await stamps(page);
  const b = await page.locator("#nav-panel header").boundingBox();
  await page.screenshot({ path: out, clip: clip(0, 0, 400, b.y + b.height) });
  await ctx.close();
});

/* ===== 7.12 Parcela catastral ===== */
const catastroRoute = page => page.route(/ovc\.catastro\.meh\.es/, route => {
  const u = new URL(route.request().url());
  const body = /OVCCoordenadas/.test(u.pathname) ? fixture("catastro-rccoor-madrid.xml") : fixture("catastro-parcela-madrid.xml");
  return route.fulfill({ status: 200, contentType: "text/xml; charset=utf-8", body, headers: { "access-control-allow-origin": "*" } });
});

scenario("parcela-catastral.png", "7.12", async out => {
  const { ctx, page } = await openApp({ route: catastroRoute });
  await view(page, [40.41538, -3.7038], 19);
  await settle(page);
  const q = await pt(page, 40.4153, -3.7038);
  await page.mouse.move(q.x, q.y);
  await page.mouse.click(q.x, q.y, { button: "right" });
  await page.locator("#map-ctxmenu .ctx-menu-item", { hasText: "Consultas" }).click();
  await page.locator(".ctx-menu:not(#map-ctxmenu) .ctx-menu-item", { hasText: "Parcela catastral" }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("#tree li")].some(li => /^Parcela /.test(li._name)));
  await settle(page, { ms: 900 });
  await page.mouse.move(VIEW.width - 300, 120);
  await fullShot(page, out);
  await page.evaluate(() => showLayerInfo([...document.querySelectorAll("#tree li")].find(li => /^Parcela /.test(li._name))));
  await page.waitForSelector("#desc-dialog:not([hidden])");
  await dialog(page, path.join(path.dirname(out), "parcela-ficha.png"), "desc-dialog");
  await ctx.close();
}, ["parcela-ficha.png"]);

/* ===== Tema oscuro y aviso de móvil ===== */
scenario("tema-oscuro.png", "2.1", async out => {
  /* «Según el sistema» con un sistema en oscuro: cambia el cromo, no el mapa */
  const { ctx, page } = await openApp({ colorScheme: "dark" });
  await sierra(page);
  const q = await pt(page, 40.4125, -3.7);
  await page.mouse.move(q.x, q.y);
  await page.waitForTimeout(200);
  await fullShot(page, out);
  await ctx.close();
});

scenario("aviso-movil.png", "4", async out => {
  const { ctx, page } = await openApp({ viewport: { width: 390, height: 780 }, touch: true });
  await page.waitForSelector("#mobile-notice:not([hidden])");
  await page.waitForTimeout(300);
  await fullShot(page, out);
  await ctx.close();
});

/* ===== 8. Chuleta ===== */
scenario("atajos.png", "8", async out => {
  const { ctx, page } = await openApp({ viewport: { width: 1440, height: 1000 } });
  await page.click("#help-btn");
  await page.waitForSelector("#shortcuts:not([hidden])");
  await page.waitForTimeout(300);
  await dialog(page, out, "shortcuts");
  await ctx.close();
});

/* ===== Lanzador ===== */
const wanted = SCENARIOS.filter(s => !ONLY.length || ONLY.includes(s.file.replace(/\.png$/, "")));
if (args.includes("--lista")) {
  for (const s of SCENARIOS) console.log(`${s.file.padEnd(34)} apartado ${s.section}${s.extra.length ? "  (+ " + s.extra.join(", ") + ")" : ""}`);
  await browser.close(); server.close(); server2.close(); process.exit(0);
}
if (ONLY.length && wanted.length !== ONLY.length) {
  const known = SCENARIOS.map(s => s.file.replace(/\.png$/, ""));
  console.error("Escenario desconocido: " + ONLY.filter(n => !known.includes(n)).join(", ") + "\nLos hay: " + known.join(", "));
  await browser.close(); server.close(); server2.close(); process.exit(1);
}

fs.mkdirSync(IMG, { recursive: true });
let failed = 0;
for (const s of wanted) {
  const t0 = Date.now();
  try {
    await s.run(path.join(IMG, s.file));
    console.log(`✓ ${s.file} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    failed++;
    console.error(`✗ ${s.file}: ${e.message.split("\n")[0]}`);
  }
}
await browser.close();
server.close();
server2.close();

/* ---------------- Manifiesto ---------------- */
/* Cada imagen lleva la versión y el build con que se generó: una pasada
   parcial (`npm run capturas perfil-ruta`) no puede dar por buenas las que
   no tocó.                                                              */
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const old = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : { images: {} };
const build = /const BUILD = "(\d+)"/.exec(fs.readFileSync(path.join(ROOT, "src", "js", "10-map.js"), "utf8"))?.[1] || null;
const regenerated = new Set(wanted.flatMap(s => [s.file, ...s.extra]));
const sectionOf = Object.fromEntries(SCENARIOS.flatMap(s => [s.file, ...s.extra].map(f => [f, s.section])));
const images = {};
for (const f of fs.readdirSync(IMG).filter(n => n.endsWith(".png")).sort()) {
  const prev = old.images?.[f] || {};
  const fresh = regenerated.has(f);
  images[f] = {
    sha256: sha(path.join(IMG, f)),
    section: sectionOf[f] || prev.section || null,
    version: fresh ? PKG.version : prev.version || null,
    build: fresh ? build : prev.build || null
  };
  if (EXTERNAL[f]) images[f].externa = EXTERNAL[f];
}
fs.writeFileSync(MANIFEST, JSON.stringify({
  generado: NOW.toISOString().slice(0, 10), fondo: NO_BG ? "liso (--sin-fondo)" : "OpenStreetMap", images
}, null, 2) + "\n");
console.log(failed ? `\n${failed} escenario(s) con error.` : `\n${wanted.length} captura(s) en docs/img/ y manifiesto al día.`);
process.exit(failed ? 1 : 0);
