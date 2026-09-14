/* Desplegar y marcar una carpeta grande CASI A LA VEZ.

   Las dos pasadas van por lotes y cedían el hilo la una a la otra:
   `materializeRecords` construye las filas que faltan y
   `cascadeVisibility` enciende o apaga lo que hay. Cada una miraba su
   propia foto del árbol, así que se repartían los nodos sin saberlo y
   la carpeta se quedaba a medio encender.

   Medido con el archivo real que lo destapó (una carpeta de 466 capas):
   al pulsar el caret, materializeRecords construye su primer lote de
   150 filas DE FORMA SÍNCRONA y vacía `_pending` al arrancar, así que
   la cascada llegaba a fotografiar 150 filas y ningún registro
   pendiente: 150 encendidas, 316 apagadas y la carpeta en
   indeterminado. Y al revés (marcar y desplegar en el acto) pasaba lo
   mismo con los papeles cambiados.

   Se prueba en navegador porque el fallo ES el entrelazado: con
   llamadas secuenciales desde Node no existe.                        */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER LAZY CASCADE TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8848);
const { page, errors } = await openApp(browser, srv.url);

/* Una carpeta con MÁS capas que el lote de construcción (PROGRESS_BATCH,
   150): con menos, todo cabe en la pasada síncrona y no hay carrera que
   provocar. 400 deja tres lotes.                                      */
const CAPAS = 400;

await page.evaluate(n => {
  /* Registros como los que deja una importación, sin tocar disco: es
     exactamente lo que una carpeta colapsada guarda en `_pending`.  */
  window.__carpeta = nombre => {
    const ul = ensureRootUl();
    const li = makeNode({ name: nombre, isFolder: true, checked: false });
    ul.appendChild(li);
    li._pending = Array.from({ length: n }, (_, i) => {
      const capa = L.geoJSON({ type: "Feature", properties: {}, geometry: {
        type: "LineString", coordinates: [[-3.7 + i * 0.001, 40.4], [-3.6 + i * 0.001, 40.5]] } });
      return { t: "layer", name: `${nombre} ${i}`, checked: false, style: null, _layer: capa };
    });
    /* Colapsada, que es como llega una carpeta restaurada de IndexedDB
       y la única forma de que el caret MATERIALICE en vez de plegar. */
    li.classList.add("collapsed");
    syncExpanded(li);
    applyContainerState(li);
    return li;
  };
  window.__estado = li => {
    const ul = li.querySelector(":scope > ul.node-list");
    const filas = [...ul.children];
    const chk = li.querySelector(":scope > .node-row > input[type=checkbox]");
    return {
      filas: filas.length,
      pendientes: li._pending ? li._pending.length : 0,
      marcadas: filas.filter(f => f.querySelector(":scope > .node-row > input").checked).length,
      /* Lo que de verdad se ve: cada capa marcada tiene que estar en el
         mapa y cada una sin marcar, fuera.                           */
      incoherentes: filas.filter(f => {
        const c = f.querySelector(":scope > .node-row > input");
        return c._layer && c.checked !== rootGroup.hasLayer(c._layer);
      }).length,
      carpeta: chk.indeterminate ? "mixed" : chk.checked
    };
  };
  /* Esperar a que se pare todo: sin filas pendientes y sin que el
     número de capas del mapa siga cambiando.                        */
  window.__reposo = async () => {
    let antes = -1;
    for (let i = 0; i < 200; i++) {
      await new Promise(r => setTimeout(r, 50));
      const ahora = rootGroup.getLayers().length;
      if (ahora === antes) return true;
      antes = ahora;
    }
    return false;
  };
}, CAPAS);

/* ---------- Desplegar y marcar, en ese orden ---------- */
const a = await page.evaluate(async () => {
  document.getElementById("tree").innerHTML = ""; rootUl = null; rootGroup.clearLayers();
  const li = __carpeta("Aerovías");
  const fila = li.querySelector(":scope > .node-row");
  fila.querySelector(".caret").click();                 /* desplegar */
  const alVuelo = __estado(li);                         /* lo que ve la cascada al llegar */
  fila.querySelector("input[type=checkbox]").click();   /* y marcar, sin esperar */
  await __reposo();
  return { alVuelo, final: __estado(li), capas: rootGroup.getLayers().length };
});
ok(a.alVuelo.filas > 0 && a.alVuelo.filas < 400,
  "la carrera existe: al marcar solo hay parte de las filas construidas — "
  + `${a.alVuelo.filas} de 400, pendientes ${a.alVuelo.pendientes}`);
ok(a.final.filas === 400, "acaban construyéndose todas las filas: " + a.final.filas);
ok(a.final.marcadas === 400,
  "y TODAS quedan marcadas, no solo las que existían al pulsar: " + a.final.marcadas);
ok(a.capas === 400, "con sus 400 capas en el mapa: " + a.capas);
ok(a.final.carpeta === true,
  "y la carpeta queda entera, no a medias: " + a.final.carpeta);
ok(a.final.incoherentes === 0,
  "ninguna fila dice una cosa y el mapa otra: " + a.final.incoherentes);

/* ---------- Y al revés: marcar y desplegar en el acto ---------- */
const b = await page.evaluate(async () => {
  document.getElementById("tree").innerHTML = ""; rootUl = null; rootGroup.clearLayers();
  const li = __carpeta("Aerovías");
  const fila = li.querySelector(":scope > .node-row");
  fila.querySelector("input[type=checkbox]").click();   /* marcar estando colapsada */
  fila.querySelector(".caret").click();                 /* y desplegar en el acto */
  await __reposo();
  return { final: __estado(li), capas: rootGroup.getLayers().length };
});
ok(b.final.filas === 400 && b.final.marcadas === 400,
  "marcar y desplegar en el acto deja las 400 marcadas: "
  + `${b.final.marcadas} de ${b.final.filas}`);
ok(b.capas === 400, "y las 400 en el mapa: " + b.capas);
ok(b.final.carpeta === true, "carpeta entera: " + b.final.carpeta);
ok(b.final.incoherentes === 0, "sin incoherencias: " + b.final.incoherentes);

/* ---------- Apagar durante el despliegue apaga TODO ----------
   El mismo camino en el sentido contrario: lo que nazca después no
   puede quedarse encendido.                                         */
const c = await page.evaluate(async () => {
  document.getElementById("tree").innerHTML = ""; rootUl = null; rootGroup.clearLayers();
  const li = __carpeta("Aerovías");
  /* Se parte de todo encendido, que es de donde se apaga */
  for (const rec of li._pending) { rec.checked = true; rec._layer.addTo(rootGroup); }
  applyContainerState(li);
  const fila = li.querySelector(":scope > .node-row");
  fila.querySelector(".caret").click();
  const chk = fila.querySelector("input[type=checkbox]");
  chk.checked = false;
  chk.dispatchEvent(new Event("change", { bubbles: true }));
  await __reposo();
  return { final: __estado(li), capas: rootGroup.getLayers().length };
});
ok(c.final.marcadas === 0 && c.capas === 0,
  `apagar mientras se despliega apaga las 400: ${c.final.marcadas} marcadas, ${c.capas} capas`);
ok(c.final.carpeta === false, "y la carpeta queda apagada: " + c.final.carpeta);

/* ---------- La cascada no se queda dando vueltas ----------
   La repetición se corta sola: la cascada no materializa nada, así que
   en cuanto no queda trabajo en vuelo la última pasada sale. Si girara
   en vacío, esto no terminaría.                                      */
const d = await page.evaluate(async () => {
  const t0 = performance.now();
  const li = [...document.querySelectorAll("#tree > ul > li")][0];
  const chk = li.querySelector(":scope > .node-row > input[type=checkbox]");
  chk.click();
  await __reposo();
  return Math.round(performance.now() - t0);
});
ok(d < 5000, "una cascada sobre el árbol ya materializado termina en seguida: " + d + " ms");

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
