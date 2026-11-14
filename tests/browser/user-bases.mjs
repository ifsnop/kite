/* User base layers (11-base-panel.js, 44-dialogs.js), end to end.

   In a browser because what is tested is the chain: the «+» at the bottom
   of the base map list opens the dialog, the type chosen decides the help
   shown, a bad address does not close it nor send anything, «Añadir»
   puts the layer ON top of the stack and its tiles are requested where
   the template says, the gear edits name and address (a rename does not
   rebuild the layer, a new address does), a WMS asks its GetCapabilities
   (only that one, with the OGC parameters set by the application even
   when the user pastes a whole request) and offers its layers, two WMS
   layers keep their own catalogs, everything survives a reload, deleting
   asks first, and a server that answers with errors is shown (the OGC
   text in the selector, red tile outlines, one diagnosis per layer). The
   servers are simulated with `ctx.route` on fake https domains: the CSP
   leaves `connect-src`/`img-src` open to https, so it is the same path a
   real server would follow.                                            */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER USER BASE LAYERS TESTS OK");

/* 1×1 PNG */
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
const CAPS2 = CAPS.replace("costa", "vias").replace("Línea de costa", "Vías");
const CORS = { "Access-Control-Allow-Origin": "*" };

const srv = await serve(READABLE, 8861);
const browser = await launch();
const { ctx, page, errors } = await openApp(browser, srv.url);

/* What the simulated servers see */
const peticiones = [];
const teselasXyz = [];
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
    /* A server that only serves JPEG declares it in <GetMap> */
    const caps = u.pathname === "/otro-wms" ? CAPS2 : CAPS;
    const body = modo === "jpeg"
      ? caps.replace("<Capability>", "<Capability><Request><GetMap><Format>image/jpeg</Format></GetMap></Request>")
      : caps;
    return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "text/xml" }, body });
  }
  /* A server whose GetMap answers with an OGC exception and HTTP 200 */
  if (u.pathname === "/falla") {
    return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "text/xml" },
      body: '<ServiceExceptionReport version="1.3.0"><ServiceException>Creating maps using image/png is not allowed</ServiceException></ServiceExceptionReport>' });
  }
  return route.fulfill({ status: 200, headers: { ...CORS, "Content-Type": "image/png" }, body: PNG });
});
await ctx.route("https://tiles.example.test/**", route => {
  teselasXyz.push(new URL(route.request().url()).pathname);
  return route.fulfill({ status: 200, headers: CORS, contentType: "image/png", body: PNG });
});

const abrirPanel = () => page.evaluate(() => {
  const list = document.querySelector(".base-list");
  if (list.hidden) document.querySelector(".base-toggle").click();
});
/* A user row, found by its name: the ids are random */
const fila = nombre => page.evaluate(nombre => {
  const row = [...document.querySelectorAll(".base-list .base-row")]
    .find(r => r.querySelector("label") && r.querySelector("label").textContent.startsWith(nombre));
  if (!row) return null;
  const chk = row.querySelector("input[type=checkbox]");
  const sel = row.querySelector("select");
  const rows = [...document.querySelectorAll(".base-list .base-row:not(.base-row-bg)")];
  return { id: chk.id.slice(5), etiqueta: row.querySelector("label").textContent, marcada: chk.checked,
    posicion: rows.indexOf(row), filas: rows.length,
    tuerca: !!row.querySelector(".base-gear:not(.base-del)"), borrar: !!row.querySelector(".base-del"),
    select: sel ? { desactivado: sel.disabled, valor: sel.value,
      opciones: [...sel.querySelectorAll("option")].map(o => o.textContent),
      grupos: [...sel.querySelectorAll("optgroup")].map(g => g.label) } : null };
}, nombre);
const pulsarEnFila = async (nombre, selector) => {
  await abrirPanel(); /* the list closes when acting outside it (a dialog, the map…) */
  const id = (await fila(nombre)).id;
  await page.click(`#base-${id} >> xpath=ancestor::div[contains(@class,'base-row')] >> ${selector}`);
};
const dialogo = () => page.evaluate(() => {
  const box = document.getElementById("user-base");
  const vis = sel => { const el = box.querySelector(sel); return !!el && !el.hidden; };
  return {
    abierto: !box.hidden,
    titulo: box.querySelector(".dlg-title").textContent,
    tipo: box.querySelector('input[name="user-base-type"]:checked').value,
    tipoFijo: [...box.querySelectorAll('input[name="user-base-type"]')].every(i => i.disabled),
    ayudaTeselas: vis('[data-i18n-html="html.ubase-tiles-help"]'),
    ayudaWms: vis('[data-i18n-html="html.ubase-wms-help"]'),
    tms: vis(".ub-check"),
    nombre: document.getElementById("user-base-name").value,
    url: document.getElementById("user-base-url").value,
    error: document.getElementById("user-base-error").hidden ? null : document.getElementById("user-base-error").textContent
  };
});
const anadir = async () => { await abrirPanel(); await page.click(".base-add"); };
const rellenar = async ({ tipo, nombre, url, tms }) => {
  if (tipo) await page.check(`#user-base input[name="user-base-type"][value="${tipo}"]`);
  if (nombre !== undefined) await page.fill("#user-base-name", nombre);
  if (url !== undefined) await page.fill("#user-base-url", url);
  if (tms !== undefined) await page.setChecked("#user-base-tms", tms);
  await page.click("#user-base-accept");
};
const esperar = async (cond, msg) => {
  for (let i = 0; i < 100; i++) { if (await cond()) return true; await page.waitForTimeout(50); }
  ok(false, "tiempo agotado: " + msg); return false;
};
const capa = id => page.evaluate(id => {
  const st = baseState.get(id);
  return st && { enMapa: !!st.layer && map.hasLayer(st.layer), url: st.layer && st.layer._url,
    tms: st.layer && st.layer.options.tms, z: st.zIndex, total: baseState.size };
}, id);

/* ---------- 1. Starting point: only the fixed layers, and the «+» ---------- */
await abrirPanel();
ok(await page.evaluate(() => !document.querySelector(".base-del")), "sin capas propias no hay ninguna fila que borrar");
ok(await page.evaluate(() => !!document.querySelector(".base-list .base-add:not(:disabled)")),
  "al pie de la lista está el botón de añadir");
ok(await page.evaluate(() => !document.getElementById("base-custom") && !document.getElementById("base-custom-wms")),
  "las dos capas «Custom» fijas ya no existen");

/* ---------- 2. The dialog: the type decides the help ---------- */
await anadir();
let d = await dialogo();
ok(d.abierto && d.titulo === "Nueva capa base" && d.tipo === "tiles" && !d.tipoFijo,
  "el + abre «Nueva capa base», en teselas y con el tipo a elegir: " + JSON.stringify(d));
ok(d.ayudaTeselas && !d.ayudaWms && d.tms, "con la ayuda de teselas y la casilla TMS: " + JSON.stringify(d));
await page.check('#user-base input[name="user-base-type"][value="wms"]');
d = await dialogo();
ok(!d.ayudaTeselas && d.ayudaWms && !d.tms, "al elegir WMS cambia la ayuda y desaparece TMS: " + JSON.stringify(d));
ok(await page.evaluate(() => document.getElementById("user-base-url").placeholder.endsWith("/wms")),
  "y el ejemplo de dirección es el de un WMS");

/* ---------- 3. Validation: it does not close nor send anything ---------- */
await rellenar({ tipo: "tiles", url: "http://tiles.example.test/" });
d = await dialogo();
ok(d.abierto && /https/.test(d.error || ""), "una dirección http no se acepta: " + JSON.stringify(d));
await rellenar({ url: "https://tiles.example.test/{z}/{x}/{y}.png?k={clave}" });
d = await dialogo();
ok(d.abierto && /\{clave\}/.test(d.error || ""), "una variable desconocida se nombra en el error: " + d.error);
await rellenar({ url: "https://tiles.example.test/{z}/{x}.png" });
ok(/\{y\}/.test((await dialogo()).error || ""), "una plantilla sin {y} no vale");
ok(teselasXyz.length === 0 && peticiones.length === 0, "y no sale ninguna petición");

/* ---------- 4. Adding a tile layer: on top and ON, where the template says ---------- */
await rellenar({ nombre: "Mi caché", url: "https://tiles.example.test/{z}/{y}/{x}.jpg" });
ok(!(await dialogo()).abierto, "una dirección válida cierra el diálogo");
await abrirPanel();
let t1 = await fila("Mi caché");
ok(t1 && t1.marcada && t1.posicion === t1.filas - 1 && t1.tuerca && t1.borrar,
  "la capa nueva sale encendida, la última de la lista (arriba del apilado), con tuerca y ×: " + JSON.stringify(t1));
let c = await capa(t1.id);
ok(c.enMapa && c.url === "https://tiles.example.test/{z}/{y}/{x}.jpg" && c.z === c.total,
  "y en el mapa con la plantilla tal cual, la más alta del apilado: " + JSON.stringify(c));
await esperar(async () => teselasXyz.length > 0, "teselas del servidor de teselas");
ok(teselasXyz.every(p => /^\/\d+\/\d+\/\d+\.jpg$/.test(p)), "las teselas se piden con la forma de la plantilla: " + teselasXyz[0]);

/* ---------- 5. The gear: renaming does not rebuild, a new address does ---------- */
const capaAntes = await page.evaluate(id => { window.__capa = baseState.get(id).layer; return true; }, t1.id);
await pulsarEnFila("Mi caché", ".base-gear:not(.base-del)");
d = await dialogo();
ok(d.abierto && d.titulo === "Modificar capa base" && d.tipoFijo && d.nombre === "Mi caché"
   && d.url === "https://tiles.example.test/{z}/{y}/{x}.jpg",
  "la tuerca abre «Modificar capa base» con nombre y dirección, y el tipo fijo: " + JSON.stringify(d));
await rellenar({ nombre: "Caché del trabajo" });
await abrirPanel();
ok(await fila("Caché del trabajo") && !(await fila("Mi caché")), "el nombre cambia en la fila");
ok(capaAntes && await page.evaluate(id => baseState.get(id).layer === window.__capa, t1.id),
  "y cambiar solo el nombre no rehace la capa");
await pulsarEnFila("Caché del trabajo", ".base-gear:not(.base-del)");
await rellenar({ url: "https://tiles.example.test/base///", tms: true });
c = await capa(t1.id);
ok(c.enMapa && c.url === "https://tiles.example.test/base/{z}/{x}/{y}.png" && c.tms === true,
  "una dirección base recibe {z}/{x}/{y}.png y TMS cuenta las filas desde abajo: " + JSON.stringify(c));

/* ---------- 6. Adding a WMS: GetCapabilities and its catalog ---------- */
await anadir();
await rellenar({ tipo: "wms", nombre: "",
  url: "https://wms.example.test/wms?map=%2Fdatos.map&SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0" });
await abrirPanel();
await esperar(async () => { const f = await fila("wms.example.test"); return f && f.select.opciones.includes("Ríos"); }, "catálogo en el selector");
let w1 = await fila("wms.example.test");
ok(w1.etiqueta === "wms.example.test", "sin nombre, la capa toma el del servidor: " + w1.etiqueta);
ok(w1.select.opciones.join("|") === "Línea de costa|Ríos" && w1.select.grupos.join("|") === "Capas del servidor|Hidrografía",
  "el selector ofrece las capas del servidor, agrupadas como las publica: " + JSON.stringify(w1.select));
const caps = peticiones.filter(p => p.request === "GetCapabilities");
ok(caps.length === 1 && caps[0].ruta === "/wms" && caps[0].service === "WMS" && caps[0].version === "1.3.0"
   && caps[0].map === "/datos.map",
  "una sola petición GetCapabilities, con los parámetros de OGC una vez y el propio del servidor: " + JSON.stringify(caps));
const teselas = () => peticiones.filter(p => p.request === "GetMap");
await esperar(async () => teselas().length > 0, "primera tesela WMS");
let t = teselas()[teselas().length - 1];
ok(t.layers === "costa" && t.version === "1.1.1" && t.srs === "EPSG:3857" && t.format === "image/png",
  "encendida, pide la primera capa con la versión del servidor (1.1.1 → srs) en Web Mercator: " + JSON.stringify(t));
const antes = teselas().length;
await abrirPanel();
await page.selectOption(`#base-${w1.id} >> xpath=ancestor::div[contains(@class,'base-row')] >> select`, "rios");
await esperar(async () => teselas().slice(antes).some(p => p.layers === "rios"), "teselas de la capa nueva");

/* ---------- 7. A second WMS keeps its own catalog ---------- */
await anadir();
await rellenar({ tipo: "wms", nombre: "Otro WMS", url: "https://wms.example.test/otro-wms" });
await abrirPanel();
await esperar(async () => { const f = await fila("Otro WMS"); return f && f.select.opciones.includes("Vías"); }, "catálogo del segundo WMS");
w1 = await fila("wms.example.test");
ok(w1.select.opciones.includes("Línea de costa") && !w1.select.opciones.includes("Vías") && w1.select.valor === "rios",
  "el primero conserva su catálogo y su capa: " + JSON.stringify(w1.select));
await abrirPanel();
const w2id = (await fila("Otro WMS")).id;
await page.uncheck(`#base-${w2id}`);
await page.waitForTimeout(700); /* lets the delayed base-map save run */

/* ---------- 8. Reload: everything is remembered, the retired keys are gone ---------- */
await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open("visor-kml");
  rq.onsuccess = () => {
    const tx = rq.result.transaction("tree", "readwrite");
    tx.objectStore("tree").put({ v: 1, url: "https://viejo.example.test/" }, "customTilesUrl");
    tx.oncomplete = () => { rq.result.close(); res(); };
  };
}));
await page.reload();
await waitAppReady(page);
await abrirPanel();
await esperar(async () => { const f = await fila("wms.example.test"); return f && f.select.opciones.includes("Ríos"); }, "catálogo tras recargar");
t1 = await fila("Caché del trabajo"); w1 = await fila("wms.example.test"); const w2 = await fila("Otro WMS");
ok(t1 && t1.marcada && w1 && w1.marcada && w1.select.valor === "rios" && w2 && !w2.marcada,
  "tras recargar siguen las tres, con su estado y la capa elegida: " + JSON.stringify([t1, w1, w2].map(f => f && [f.etiqueta, f.marcada])));
ok(t1.posicion < w1.posicion && w1.posicion < w2.posicion, "y en el mismo orden de apilado");
ok(await page.evaluate(id => baseState.get(id).layer.options.version === "1.1.1", w1.id),
  "el WMS rehecho con la versión que anunció el servidor tras recibir su catálogo");
ok((await capa(t1.id)).tms === true, "y la de teselas con su TMS");
const retirada = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open("visor-kml");
  rq.onsuccess = () => {
    const g = rq.result.transaction("tree").objectStore("tree").get("customTilesUrl");
    g.onsuccess = () => { rq.result.close(); res(g.result === undefined); };
  };
}));
ok(retirada, "la clave de la antigua capa «Custom» se borra al arrancar, sin migrarla");

/* ---------- 9. Deleting asks first ---------- */
const confirmacion = () => page.evaluate(() => ({ abierta: !document.getElementById("user-base-delete").hidden,
  texto: document.getElementById("user-base-delete-text").textContent }));
await pulsarEnFila("Otro WMS", ".base-del");
let k = await confirmacion();
ok(k.abierta && /«Otro WMS»/.test(k.texto) && /No se puede deshacer/.test(k.texto),
  "el × pide confirmación nombrando la capa: " + JSON.stringify(k));
await page.click("#user-base-delete-cancel");
ok(!(await confirmacion()).abierta && await fila("Otro WMS"), "Cancelar no borra nada");
await pulsarEnFila("Otro WMS", ".base-del");
await page.keyboard.press("Escape");
ok(!(await confirmacion()).abierta && await fila("Otro WMS"), "Escape tampoco");
await pulsarEnFila("Otro WMS", ".base-del");
await page.click("#user-base-delete-accept");
await abrirPanel();
ok(!(await fila("Otro WMS")) && !(await page.evaluate(id => baseState.has(id), w2id)), "Eliminar la quita de la lista");
const zs = await page.evaluate(() => [...baseState.values()].map(st => st.zIndex));
ok(zs.every((z, i) => z === i + 1), "y el apilado queda contiguo: " + zs);

/* ---------- 10. A WMS that answers with an OGC exception ---------- */
modo = "excepcion";
await pulsarEnFila("wms.example.test", ".base-gear:not(.base-del)");
await rellenar({ nombre: "Mi WMS", url: "https://wms.example.test/otro" });
await abrirPanel();
await esperar(async () => /No disponible/.test(((await fila("Mi WMS")).select.opciones[0]) || ""), "mensaje de error");
ok(/Servidor en mantenimiento/.test((await fila("Mi WMS")).select.opciones[0]),
  "se muestra el error del propio servidor, no un código HTTP");

/* ---------- 10b. A WMS that only serves JPEG ---------- */
modo = "jpeg";
await pulsarEnFila("Mi WMS", ".base-gear:not(.base-del)");
await rellenar({ url: "https://wms.example.test/solo-jpeg" });
await esperar(async () => teselas().some(p => p.ruta === "/solo-jpeg"), "tesela del servidor JPEG");
t = teselas().filter(p => p.ruta === "/solo-jpeg").pop();
ok(t.format === "image/jpeg" && t.transparent === "false",
  "si el servidor solo anuncia JPEG, se pide en JPEG y sin transparent: " + JSON.stringify(t));

/* ---------- 10c. A WMS whose tiles come back with an error ---------- */
modo = "ok";
await pulsarEnFila("Mi WMS", ".base-gear:not(.base-del)");
await rellenar({ url: "https://wms.example.test/falla" });
const wid = (await fila("Mi WMS")).id;
const marcadas = () => page.evaluate(id => {
  const l = baseState.get(id).layer;
  return { total: l ? Object.keys(l._tiles).length : 0,
    rojas: [...document.querySelectorAll(".leaflet-tile.tile-error")].map(el => {
      const cs = getComputedStyle(el);
      return { color: cs.outlineColor, ancho: cs.outlineWidth, estilo: cs.outlineStyle, visible: cs.visibility };
    }) };
}, wid);
/* the tile layer below also has tiles: only the WMS ones are marked */
await page.evaluate(id => { baseState.get(id).on = false; applyBaseLayer(id); }, t1.id);
await esperar(async () => { const m = await marcadas(); return m.total > 0 && m.rojas.length === m.total; }, "todas las teselas marcadas");
const m = await marcadas();
ok(m.rojas.every(r => r.color === "rgb(211, 47, 47)" && r.ancho === "2px" && r.estilo === "solid" && r.visible === "visible"),
  "cada tesela fallida lleva un contorno rojo de 2 px, visible: " + JSON.stringify(m.rojas[0]));
await esperar(() => page.evaluate(() => /Creating maps using image\/png is not allowed/.test(document.getElementById("nav-msg").textContent)),
  "aviso con el texto del servidor");
const avisos = await page.evaluate(() => [...document.querySelectorAll("#nav-msg .nav-msg-line")].map(l => l.textContent));
ok(avisos.some(a => /«Mi WMS»/.test(a) && /contorno rojo/.test(a)), "el aviso nombra la capa y el contorno: " + JSON.stringify(avisos));
await page.waitForTimeout(500);
const fallidas = peticiones.filter(p => p.ruta === "/falla" && p.request === "GetMap");
const repetidas = fallidas.length - new Set(fallidas.map(p => p.bbox)).size;
ok(repetidas === 1, "solo se vuelve a pedir UNA tesela para diagnosticar (repetidas: " + repetidas + ")");

/* ---------- 11. Escape closes the dialog without saving ---------- */
await anadir();
await page.fill("#user-base-url", "https://tiles.example.test/no-se-guarda/");
await page.keyboard.press("Escape");
ok(!(await dialogo()).abierto, "Escape cierra el diálogo");
ok(await page.evaluate(() => userBaseStates().length) === 2, "sin añadir nada");

/* ---------- 12. The cap ---------- */
await page.evaluate(() => {
  for (let i = 0; userBaseStates().length < USER_BASES_MAX; i++) {
    createUserBase({ type: "tiles", name: "Capa " + i, url: `https://tiles.example.test/c${i}/` });
    baseState.get([...baseState.keys()].pop()).on = false;
  }
  renderBasePanel();
});
await abrirPanel();
const tope = await page.evaluate(() => { const b = document.querySelector(".base-add"); return { off: b.disabled, title: b.title }; });
ok(tope.off && /máximo/.test(tope.title), "con USER_BASES_MAX capas el + se deshabilita y dice por qué: " + JSON.stringify(tope));
ok(await page.evaluate(() => createUserBase({ type: "tiles", name: "x", url: "https://tiles.example.test/x/" })) === null,
  "y no se puede pasar del tope");

ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de CSP: " + JSON.stringify(await page.evaluate(() => window.__csp)));
ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
