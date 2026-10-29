/* «Parcela catastral» del menú contextual, de punta a punta en el
   navegador. Los dos servicios del Catastro se sirven FALSOS con
   page.route, con las respuestas REALES capturadas en tests/fixtures
   (octubre de 2026), así que la prueba no depende de la red y cada
   petición queda contada.

   1) Clic derecho → «Parcela catastral»: crea «Catastro» › «Parcela
      0443112VK4704C» con su polígono en el mapa, sin mover la vista, y
      la ficha lleva referencia, dirección, superficie y fecha.
   2) Las dos peticiones: Consulta_RCCOOR con X = longitud e Y = latitud,
      y GetParcel con la referencia y EPSG::4326; sin cabeceras propias.
   3) Repetir la misma parcela no pide el polígono otra vez: la señala.
   4) Un punto sin parcela avisa y no deja nada en el árbol.
   5) Una excepción OGC del WFS (HTTP 200) llega como aviso con el texto
      del servicio y NO se reintenta.
   6) Un fallo pasajero (503) se reintenta, con el cursor de espera
      mientras dura, y acaba creando la capa sin aviso de error.
   7) Deshacer la quita; la entrada del menú sigue habilitada con el mapa
      girado; sobrevive a recargar con su ficha.
   8) La atribución del Catastro aparece una vez.                       */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER CADASTRE TESTS OK");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = n => fs.readFileSync(path.join(HERE, "..", "fixtures", n));
const RCCOOR_MADRID = fx("catastro-rccoor-madrid.xml");
const RCCOOR_NONE = fx("catastro-rccoor-none.xml");
const PARCEL_MADRID = fx("catastro-parcela-madrid.xml");
const PARCEL_ERROR = fx("catastro-parcela-error.xml");

const browser = await launch();
const srv = await serve(READABLE, 8946);
const { page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

/* ---------- Servicio falso ---------- */
const seen = []; /* { kind: "rccoor"|"wfs", params, headers } */
let rccoorFailures = 0; /* 503 a demanda (paso 6) */
const POINTS = {
  madrid: { lat: 40.4153, lng: -3.7038 },      /* una finca: CL Paz 11 */
  street: { lat: 40.41678, lng: -3.70379 },     /* la calle: sin parcela */
  broken: { lat: 40.4300, lng: -3.7000 }        /* el WFS contesta una excepción */
};
await page.route(/ovc\.catastro\.meh\.es/, route => {
  const req = route.request();
  const u = new URL(req.url());
  const xml = (body, status = 200) => route.fulfill({ status, contentType: "text/xml; charset=utf-8", body,
    headers: { "access-control-allow-origin": "*" } });
  if (/OVCCoordenadas/.test(u.pathname)) {
    seen.push({ kind: "rccoor", params: u.searchParams, headers: req.headers() });
    if (rccoorFailures > 0) { rccoorFailures--; return xml("<h1>Service Unavailable</h1>", 503); }
    const y = Number(u.searchParams.get("Coordenada_Y"));
    if (Math.abs(y - POINTS.madrid.lat) < 1e-4) return xml(RCCOOR_MADRID);
    if (Math.abs(y - POINTS.broken.lat) < 1e-4) {
      return xml(RCCOOR_MADRID.toString().replace("0443112", "0147103").replace("VK4704C", "VK4704F"));
    }
    return xml(RCCOOR_NONE);
  }
  seen.push({ kind: "wfs", params: u.searchParams, headers: req.headers() });
  return u.searchParams.get("refcat") === "0443112VK4704C" ? xml(PARCEL_MADRID) : xml(PARCEL_ERROR);
});
const count = kind => seen.filter(s => s.kind === kind).length;

/* Elige «Parcela catastral» en el menú contextual de un punto y espera a
   que la consulta termine: capa nueva o aviso nuevo. Devuelve lo ocurrido. */
async function queryViaMenu(ll, { watchBusy = false } = {}) {
  return page.evaluate(async ({ lat, lng, watchBusy }) => {
    const countsBefore = msgLog.map(e => e.count);
    const fresh = () => msgLog.filter((e, i) => i >= countsBefore.length || e.count > countsBefore[i]).map(e => e.text);
    /* Se cuentan FILAS, no capas del mapa: el parpadeo de una parcela ya
       existente (blinkLayer) la quita y la pone durante 600 ms.        */
    const layersBefore = () => [...document.querySelectorAll("#tree li")].filter(x => /^Parcela /.test(x._name)).length;
    const before = layersBefore();
    const latlng = L.latLng(lat, lng);
    openCtxMenu(latlng, 600, 400, []);
    const item = [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")]
      .find(x => x.textContent === "Parcela catastral");
    if (!item || item.disabled) return { item: !!item, disabled: item && item.disabled };
    const view = { c: map.getCenter(), z: map.getZoom() };
    item.click();
    let sawBusy = false;
    const t0 = performance.now();
    while (performance.now() - t0 < 15000) {
      await new Promise(r => setTimeout(r, 30));
      if (watchBusy && map.getContainer().classList.contains("cadastre-busy")) sawBusy = true;
      if (layersBefore() > before || fresh().length) break;
    }
    /* La consulta sigue «en vuelo» hasta su finally: se espera a que el cursor vuelva */
    while (map.getContainer().classList.contains("cadastre-busy") && performance.now() - t0 < 15000) {
      await new Promise(r => setTimeout(r, 30));
    }
    return { added: layersBefore() - before, log: fresh(), sawBusy,
             busyAfter: map.getContainer().classList.contains("cadastre-busy"),
             viewMoved: !map.getCenter().equals(view.c) || map.getZoom() !== view.z };
  }, { ...ll, watchBusy });
}
/* Espera a que acabe el parpadeo de cualquier fila: borrar una fila a
   mitad de su parpadeo deja que el último paso vuelva a poner su capa
   en el mapa (latente en blinkLayer, ajeno a esta función).         */
const settled = () => page.waitForFunction(() => ![...document.querySelectorAll("#tree li")].some(x => x._blinkTimer));
const treeShape = () => page.evaluate(() => {
  const sec = [...document.querySelectorAll("#tree li")].find(li => li._name === "Catastro");
  if (!sec) return null;
  return { name: sec._name, children: [...nodeUl(sec).children].map(c => c._name) };
});

/* Antes de tocar nada: la vista en la finca, para ver el polígono */
await page.evaluate(({ lat, lng }) => map.setView([lat, lng], 19, { animate: false }), POINTS.madrid);

/* ---------- 1 y 2. Una finca ---------- */
const q1 = await queryViaMenu(POINTS.madrid);
ok(q1.added === 1, "la consulta añade una capa al mapa: " + JSON.stringify(q1));
ok(!q1.viewMoved, "la vista del usuario no se mueve");
ok(!q1.log.length, "sin avisos de «consultando» ni de éxito: " + JSON.stringify(q1.log));
let shape = await treeShape();
ok(shape && shape.children.join() === "Parcela 0443112VK4704C", "«Catastro» › «Parcela 0443112VK4704C»: " + JSON.stringify(shape));
ok(count("rccoor") === 1 && count("wfs") === 1, "una petición a cada servicio: " + count("rccoor") + "/" + count("wfs"));
const r1 = seen[0], w1 = seen[1];
ok(r1.params.get("SRS") === "EPSG:4326" && Math.abs(Number(r1.params.get("Coordenada_X")) - POINTS.madrid.lng) < 1e-6
  && Math.abs(Number(r1.params.get("Coordenada_Y")) - POINTS.madrid.lat) < 1e-6,
  "RCCOOR: X es la longitud e Y la latitud: " + r1.params);
ok(w1.params.get("STOREDQUERIE_ID") === "GetParcel" && w1.params.get("refcat") === "0443112VK4704C"
  && w1.params.get("srsname") === "EPSG::4326", "GetParcel con la referencia y EPSG::4326: " + w1.params);
ok(!Object.keys(r1.headers).some(h => /^(authorization|x-|content-type)/.test(h)) && !r1.headers.cookie && !w1.headers.cookie,
  "petición simple, sin cabeceras propias ni cookies: " + Object.keys(r1.headers));

const info = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Parcela 0443112VK4704C");
  const layer = nodeLayer(li);
  const b = layer.getBounds();
  return {
    html: infoHtmlFor(li),
    contains: b.contains([40.4153, -3.7038]),
    inGroup: rootGroup.hasLayer(layer),
    kind: styleKind(li),
    checked: li.querySelector("input[type=checkbox]").checked
  };
});
ok(info.contains && info.inGroup && info.checked, "el polígono está en el mapa, activo, y contiene el punto pulsado: " + JSON.stringify({ ...info, html: "…" }));
ok(info.kind === "polygon", "es un polígono editable como cualquier otro: " + info.kind);
ok(/Referencia catastral/.test(info.html) && /0443112VK4704C/.test(info.html), "ficha: referencia");
ok(/CL PAZ 11 MADRID \(MADRID\)/.test(info.html), "ficha: dirección");
ok(/Superficie catastral/.test(info.html) && />1377</.test(info.html), "ficha: superficie 1377");
ok(/2002-01-22/.test(info.html), "ficha: fecha de alta");

/* ---------- 3. Repetir ---------- */
const q3 = await queryViaMenu(POINTS.madrid);
ok(q3.added === 0 && q3.log.some(t => /ya está en el árbol: «Parcela 0443112VK4704C»/.test(t)), "repetir la parcela la señala: " + JSON.stringify(q3));
ok(count("rccoor") === 2 && count("wfs") === 1, "repetida: se pregunta la referencia pero no se pide el polígono otra vez: " + count("rccoor") + "/" + count("wfs"));

/* ---------- 4. Sin parcela ---------- */
const q4 = await queryViaMenu(POINTS.street);
ok(q4.added === 0 && q4.log.some(t => /no tiene ninguna parcela en ese punto/.test(t)), "punto sin parcela: aviso: " + JSON.stringify(q4));
ok(count("wfs") === 1, "y no se pide ningún polígono");
shape = await treeShape();
ok(shape.children.length === 1, "y nada nuevo en el árbol");

/* ---------- 5. Excepción OGC: aviso con el texto del servicio, sin reintentos ---------- */
const nWfs = count("wfs");
const q5 = await queryViaMenu(POINTS.broken);
ok(q5.added === 0 && q5.log.some(t => /Error al consultar el Catastro: No se ha encontrado la parcela/.test(t)),
  "excepción OGC con HTTP 200: aviso con el texto del servicio: " + JSON.stringify(q5));
ok(count("wfs") - nWfs === 1, "una excepción es una respuesta, no un fallo: no se reintenta (" + (count("wfs") - nWfs) + " peticiones)");

/* ---------- 6. Fallo pasajero: se reintenta ---------- */
/* Borrada la fila, la referencia recordada ya no vale: se vuelve a poder pedir */
await settled();
await page.evaluate(() => { for (const li of [...document.querySelectorAll("#tree li")]) if (li._name === "Parcela 0443112VK4704C") deleteNode(li); });
rccoorFailures = 1;
const nR = count("rccoor");
const q6 = await queryViaMenu(POINTS.madrid, { watchBusy: true });
ok(q6.added === 1 && rccoorFailures === 0, "un 503 y la consulta acaba creando la capa: " + JSON.stringify(q6));
ok(count("rccoor") - nR === 2, "al segundo intento: " + (count("rccoor") - nR));
ok(!q6.log.length, "sin aviso de error: el fallo pasajero no llega al usuario: " + JSON.stringify(q6.log));
ok(q6.sawBusy && !q6.busyAfter, "cursor de espera mientras dura, y se quita al terminar: " + JSON.stringify(q6));

/* ---------- 7. Girado, deshacer, recargar ---------- */
const rotated = await page.evaluate(() => {
  map.setBearing(30);
  openCtxMenu(map.getCenter(), 600, 400, []);
  const b = [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")].find(x => x.textContent === "Parcela catastral");
  const r = { found: !!b, disabled: b && b.disabled };
  closeCtxMenu();
  map.setBearing(0);
  return r;
});
ok(rotated.found && !rotated.disabled, "con el mapa girado la entrada sigue habilitada (consultar un punto no depende del giro): " + JSON.stringify(rotated));

await settled();
await page.evaluate(() => undoLast());
shape = await treeShape();
ok(!shape || shape.children.length === 0, "deshacer quita la parcela: " + JSON.stringify(shape));
const q7 = await queryViaMenu(POINTS.madrid);
ok(q7.added === 1, "y tras deshacer se puede volver a pedir: " + JSON.stringify(q7));

await page.evaluate(() => new Promise(r => setTimeout(r, 700))); /* guardado del árbol (debounce) */
await page.reload();
await waitAppReady(page);
const back = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Parcela 0443112VK4704C");
  return li ? { html: infoHtmlFor(li), has: true } : { has: false };
});
ok(back.has, "la parcela sobrevive a la recarga");
ok(back.has && /0443112VK4704C/.test(back.html) && />1377</.test(back.html) && /CL PAZ 11/.test(back.html), "y conserva su ficha");

/* ---------- 8. Atribución ---------- */
const attrib = await page.evaluate(() => document.querySelector(".leaflet-control-attribution").textContent);
/* Tras recargar no hay consulta: sin atribución hasta que se pida otra */
ok(!/Catastro/.test(attrib), "tras recargar y sin consultar, la atribución no está: " + attrib);
await page.evaluate(({ lat, lng }) => { map.setView([lat, lng], 19, { animate: false }); }, POINTS.madrid);
await settled();
await page.evaluate(() => { for (const li of [...document.querySelectorAll("#tree li")]) if (li._name === "Parcela 0443112VK4704C") deleteNode(li); });
await queryViaMenu(POINTS.madrid);
await queryViaMenu(POINTS.madrid);
const attrib2 = await page.evaluate(() => document.querySelector(".leaflet-control-attribution").textContent);
ok((attrib2.match(/Dirección General del Catastro/g) || []).length === 1, "la atribución del Catastro aparece una sola vez: " + attrib2);

const csp = await page.evaluate(() => window.__csp);
ok(csp.length === 0, "la CSP no bloquea nada: " + csp.join(" | "));
/* El único 503 es el simulado en el paso 6 */
const realErrors = errors.filter(e => !/status of 503/.test(e));
ok(realErrors.length === 0, "sin errores en la consola: " + realErrors.join(" | "));
await browser.close();
srv.close();
done();
