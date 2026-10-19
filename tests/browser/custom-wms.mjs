/* Mapas base propios del usuario: «Custom Tile Map Service» (renombrada) y
   «Custom Web Map Service», de punta a punta.

   Va en navegador porque lo que se prueba es el encadenado: que la fila
   salga bloqueada sin dirección, que la tuerca abra el diálogo, que al
   aceptar se pida el GetCapabilities (y solo ese, con los parámetros de
   OGC puestos por la aplicación aunque el usuario pegue la petición
   entera), que el <select> ofrezca las capas que publica el servidor, que
   encender la capa pida teselas de la elegida, que cambiarla las cambie,
   y que dirección, capa y estado sobrevivan a una recarga. El servidor es
   simulado con `page.route` sobre un dominio https de mentira: la CSP
   deja `connect-src`/`img-src` abiertas a https, así que es la misma ruta
   que seguiría un servidor real.                                      */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER CUSTOM WMS TESTS OK");

/* PNG de 1×1 píxel */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const CAPS = `<?xml version="1.0" encoding="UTF-8"?>
<WMT_MS_Capabilities version="1.1.1">
  <Service><Name>OGC:WMS</Name><Title>Servidor de prueba</Title></Service>
  <Capability><Layer><Title>Servidor de prueba</Title>
    <Layer><Name>costa</Name><Title>Línea de costa</Title></Layer>
    <Layer><Title>Hidrografía</Title>
      <Layer><Name>rios</Name><Title>Ríos</Title></Layer>
    </Layer>
  </Layer></Capability></WMT_MS_Capabilities>`;
const CORS = { "Access-Control-Allow-Origin": "*" };

const srv = await serve(READABLE, 8861);
const browser = await launch();
const { ctx, page, errors } = await openApp(browser, srv.url);

/* Lo que ve el servidor simulado */
const peticiones = [];
let modo = "ok";   /* "ok" | "excepcion" | "jpeg" */
await ctx.route("https://wms.example.test/**", route => {
  const u = new URL(route.request().url());
  const q = Object.fromEntries([...u.searchParams].map(([k, v]) => [k.toLowerCase(), v]));
  peticiones.push({ ruta: u.pathname, ...q });
  if (q.request === "GetCapabilities") {
    if (modo === "excepcion") {
      return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "text/xml" },
        body: '<ServiceExceptionReport version="1.3.0"><ServiceException code="X">Servidor en mantenimiento</ServiceException></ServiceExceptionReport>' });
    }
    /* Un servidor que solo sirve JPEG: lo declara en <GetMap> */
    const body = modo === "jpeg"
      ? CAPS.replace("<Capability>", "<Capability><Request><GetMap><Format>image/jpeg</Format></GetMap></Request>")
      : CAPS;
    return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "text/xml" }, body });
  }
  /* Un servidor cuyos GetMap responden con una excepción OGC y HTTP 200,
     como el GeoServer que dio pie a esto */
  if (u.pathname === "/falla") {
    return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "text/xml" },
      body: '<ServiceExceptionReport version="1.3.0"><ServiceException>Creating maps using image/png is not allowed</ServiceException></ServiceExceptionReport>' });
  }
  return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "image/png" }, body: PNG });
});

const abrirPanel = () => page.evaluate(() => {
  const list = document.querySelector(".base-list");
  if (list.hidden) document.querySelector(".base-toggle").click();
});
const fila = id => page.evaluate(id => {
  const chk = document.getElementById("base-" + id);
  if (!chk) return null;
  const row = chk.closest(".base-row");
  const sel = row.querySelector("select");
  return { etiqueta: row.querySelector("label").textContent, marcada: chk.checked,
    tuerca: !!row.querySelector(".base-gear"),
    select: sel ? { desactivado: sel.disabled, valor: sel.value,
      opciones: [...sel.querySelectorAll("option")].map(o => o.textContent),
      grupos: [...sel.querySelectorAll("optgroup")].map(g => g.label) } : null };
}, id);
const dialogo = () => page.evaluate(() => ({
  abierto: !document.getElementById("custom-wms-creds").hidden,
  error: document.getElementById("custom-wms-error").hidden ? null
    : document.getElementById("custom-wms-error").textContent,
  valor: document.getElementById("custom-wms-input").value }));
const esperar = async (cond, msg) => {
  for (let i = 0; i < 100; i++) { if (await cond()) return true; await page.waitForTimeout(50); }
  ok(false, "tiempo agotado: " + msg); return false;
};

/* ---------- 1. Nombres y estado de partida ---------- */
await abrirPanel();
let tms = await fila("custom");
ok(tms && tms.etiqueta === "Custom Tile Map Service",
  "la capa de teselas se llama «Custom Tile Map Service»: " + JSON.stringify(tms));
ok(tms.tuerca && tms.select === null, "y sigue sin selector de capas, solo con su tuerca");
let wms = await fila("custom-wms");
ok(wms && wms.etiqueta === "Custom Web Map Service", "existe «Custom Web Map Service»: " + JSON.stringify(wms));
ok(wms.tuerca && !wms.marcada, "con tuerca y apagada");
ok(wms.select && wms.select.desactivado && wms.select.opciones[0] === "Requiere URL",
  "y sin dirección su selector está bloqueado: " + JSON.stringify(wms.select));
ok(peticiones.length === 0, "sin dirección no se pide nada al servidor");

/* ---------- 2. El diálogo: validación ---------- */
await page.click("#base-custom-wms >> xpath=ancestor::div[contains(@class,'base-row')] >> .base-gear");
let d = await dialogo();
ok(d.abierto && d.valor === "", "la tuerca abre el diálogo, vacío: " + JSON.stringify(d));
await page.fill("#custom-wms-input", "http://wms.example.test/wms");
await page.click("#custom-wms-accept");
d = await dialogo();
ok(d.abierto && /https/.test(d.error || ""), "una dirección http no se acepta y el diálogo sigue abierto: " + JSON.stringify(d));
ok(peticiones.length === 0, "y no sale ninguna petición");

/* ---------- 3. Aceptar: GetCapabilities y catálogo ---------- */
/* Se pega una petición GetCapabilities ENTERA, con su versión 1.3.0 y un
   parámetro propio del servidor que debe conservarse */
await page.fill("#custom-wms-input",
  "https://wms.example.test/wms?map=%2Fdatos.map&SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0");
await page.click("#custom-wms-accept");
ok(!(await dialogo()).abierto, "una dirección válida cierra el diálogo");
await esperar(async () => (await fila("custom-wms")).select.opciones.includes("Ríos"), "catálogo en el selector");
wms = await fila("custom-wms");
ok(wms.select.opciones.join("|") === "Línea de costa|Ríos",
  "el selector ofrece las capas del servidor: " + JSON.stringify(wms.select.opciones));
ok(wms.select.grupos.join("|") === "Capas del servidor|Hidrografía",
  "agrupadas como las publica: " + JSON.stringify(wms.select.grupos));
const caps = peticiones.filter(p => p.request === "GetCapabilities");
ok(caps.length === 1 && caps[0].ruta === "/wms" && caps[0].service === "WMS" && caps[0].version === "1.3.0"
   && caps[0].map === "/datos.map",
  "una sola petición GetCapabilities, con los parámetros de OGC una vez y el propio del servidor: " + JSON.stringify(caps));
ok(!wms.marcada, "y la capa sigue apagada: elegir dirección no enciende nada");

/* ---------- 4. Encender, cambiar de capa, apagar ---------- */
const teselas = () => peticiones.filter(p => p.request === "GetMap");
await page.check("#base-custom-wms");
await esperar(async () => teselas().length > 0, "primera tesela");
let t = teselas()[teselas().length - 1];
ok(t.layers === "costa", "al encender pide la primera capa: " + JSON.stringify(t));
ok(t.version === "1.1.1" && t.srs === "EPSG:3857" && t.format === "image/png",
  "con la versión que anunció el servidor (1.1.1 → srs) y en Web Mercator: " + JSON.stringify(t));
ok(await page.evaluate(() => map.hasLayer(baseState.get("custom-wms").layer)), "y la capa está en el mapa");
const antes = teselas().length;
await page.selectOption("#base-custom-wms >> xpath=ancestor::div[contains(@class,'base-row')] >> select", "rios");
/* esperar() falla la suite si no llegan: cambiar en el selector pide las
   teselas de la otra capa */
await esperar(async () => teselas().slice(antes).some(p => p.layers === "rios"), "teselas de la capa nueva");
await page.waitForTimeout(500); /* deja pasar el guardado con retardo */

/* Con un servidor que sí entrega, ninguna tesela se marca */
ok(await page.evaluate(() => document.querySelectorAll(".tile-error").length) === 0,
  "con teselas que llegan bien no hay contornos rojos");

/* ---------- 5. Recargar: se recuerda todo ---------- */
await page.reload();
await waitAppReady(page);
await abrirPanel();
await esperar(async () => (await fila("custom-wms")).select.opciones.includes("Ríos"), "catálogo tras recargar");
wms = await fila("custom-wms");
ok(wms.marcada && wms.select.valor === "rios",
  "tras recargar sigue encendida y con su capa: " + JSON.stringify(wms));
ok(await page.evaluate(() => baseState.get("custom-wms").layer.options.version === "1.1.1"),
  "y con la versión que anunció el servidor, ya rehecha tras recibir su catálogo");
await page.click("#base-custom-wms >> xpath=ancestor::div[contains(@class,'base-row')] >> .base-gear");
d = await dialogo();
ok(d.valor === "https://wms.example.test/wms?map=%2Fdatos.map",
  "el diálogo enseña la dirección guardada, ya sin los parámetros de OGC: " + d.valor);

/* ---------- 6. Borrar ---------- */
await page.click("#custom-wms-clear");
await page.click("#custom-wms-cancel");
wms = await fila("custom-wms");
ok(!wms.marcada && wms.select.desactivado && wms.select.opciones[0] === "Requiere URL",
  "Borrar apaga la capa y la deja bloqueada otra vez: " + JSON.stringify(wms));
ok(await page.evaluate(() => baseState.get("custom-wms").layer === null), "sin capa en el mapa");

/* ---------- 7. Un servidor que contesta con una excepción OGC ---------- */
modo = "excepcion";
await page.click("#base-custom-wms >> xpath=ancestor::div[contains(@class,'base-row')] >> .base-gear");
await page.fill("#custom-wms-input", "https://wms.example.test/otro");
await page.click("#custom-wms-accept");
await esperar(async () => /No disponible/.test(((await fila("custom-wms")).select.opciones[0]) || ""), "mensaje de error");
wms = await fila("custom-wms");
ok(/Servidor en mantenimiento/.test(wms.select.opciones[0]),
  "se muestra el error del propio servidor, no un código HTTP: " + wms.select.opciones[0]);

/* ---------- 7b. Un servidor que solo sirve JPEG ---------- */
modo = "jpeg";
await page.click("#base-custom-wms >> xpath=ancestor::div[contains(@class,'base-row')] >> .base-gear");
await page.fill("#custom-wms-input", "https://wms.example.test/solo-jpeg");
await page.click("#custom-wms-accept");
await esperar(async () => (await fila("custom-wms")).select.opciones.includes("Ríos"), "catálogo del servidor JPEG");
await page.check("#base-custom-wms");
await esperar(async () => teselas().some(p => p.ruta === "/solo-jpeg"), "tesela del servidor JPEG");
t = teselas().filter(p => p.ruta === "/solo-jpeg").pop();
ok(t.format === "image/jpeg", "si el servidor solo anuncia JPEG, se piden las teselas en JPEG: " + JSON.stringify(t));
ok(t.transparent === "false", "y sin transparent (JPEG no tiene canal alfa): " + JSON.stringify(t));
await page.uncheck("#base-custom-wms");

/* ---------- 7c. Un servidor cuyas teselas vienen con un error ---------- */
modo = "ok";
await page.click("#base-custom-wms >> xpath=ancestor::div[contains(@class,'base-row')] >> .base-gear");
await page.fill("#custom-wms-input", "https://wms.example.test/falla");
await page.click("#custom-wms-accept");
await esperar(async () => (await fila("custom-wms")).select.opciones.includes("Ríos"), "catálogo del servidor que falla");
await page.check("#base-custom-wms");
const marcadas = () => page.evaluate(() => {
  const l = baseState.get("custom-wms").layer;
  return { total: Object.keys(l._tiles).length,
    rojas: [...document.querySelectorAll(".leaflet-tile.tile-error")].map(el => {
      const cs = getComputedStyle(el);
      return { color: cs.outlineColor, ancho: cs.outlineWidth, estilo: cs.outlineStyle, visible: cs.visibility };
    }) };
});
await esperar(async () => { const m = await marcadas(); return m.total > 0 && m.rojas.length === m.total; }, "todas las teselas marcadas");
let m = await marcadas();
ok(m.rojas.every(r => r.color === "rgb(211, 47, 47)" && r.ancho === "2px" && r.estilo === "solid"),
  "cada tesela fallida lleva un contorno rojo de 2 px: " + JSON.stringify(m.rojas[0]));
ok(m.rojas.every(r => r.visible === "visible"), "y se ve (Leaflet oculta por defecto las que no cargaron)");
await esperar(() => page.evaluate(() => /Creating maps using image\/png is not allowed/.test(document.getElementById("nav-msg").textContent)),
  "aviso con el texto del servidor");
const avisos = await page.evaluate(() => [...document.querySelectorAll("#nav-msg .nav-msg-line")].map(l => l.textContent));
ok(avisos.some(a => /Custom Web Map Service/.test(a) && /contorno rojo/.test(a)),
  "el aviso nombra la capa y el contorno: " + JSON.stringify(avisos));
/* La explicación sale UNA vez por capa: de todas las peticiones de teselas,
   solo una se repite (la del diagnóstico) */
await page.waitForTimeout(500);
const fallidas = peticiones.filter(p => p.ruta === "/falla" && p.request === "GetMap");
const repetidas = fallidas.length - new Set(fallidas.map(p => p.bbox)).size;
ok(repetidas === 1, "solo se vuelve a pedir UNA tesela para diagnosticar (repetidas: " + repetidas + ")");
await page.uncheck("#base-custom-wms");

/* ---------- 8. Escape cierra el diálogo ---------- */
await page.click("#base-custom-wms >> xpath=ancestor::div[contains(@class,'base-row')] >> .base-gear");
ok((await dialogo()).abierto, "se vuelve a abrir");
await page.keyboard.press("Escape");
ok(!(await dialogo()).abierto, "y Escape lo cierra sin guardar");

ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de CSP: " + JSON.stringify(await page.evaluate(() => window.__csp)));
ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
