/* Polígonos de solo relleno, uno junto a otro: sin costura y sin contorno.

   Canvas dibuja cada polígono con su propio antialiasing, así que dos que
   comparten un borde dejan una costura de fondo (Google Earth, que dibuja
   una malla en GPU, no la tiene). El primer arreglo —un contorno fino del
   color del relleno— la tapaba, pero con opacidad < 1 ese trazo se
   solapaba con el relleno y el del vecino y salía un CONTORNO más oscuro
   (0,7 sobre 0,7 = 0,91): lo contrario de «solo relleno». Ahora los
   polígonos consecutivos del mismo color y opacidad se dibujan opacos en
   un lienzo auxiliar y se componen UNA vez con la opacidad del relleno
   (src/js/09-canvas-seamless.js).

   Se prueba con un navegador porque lo que importa es el píxel: en el
   borde compartido el alfa debe ser el del relleno, ni menos (costura) ni
   más (contorno). El control es el mismo montaje partido en dos tandas
   de un solo polígono —una opacidad distinta en una millonésima—, que se
   pintan como siempre y dejan la costura. Si no saliera ahí, la prueba
   no probaría nada.
   Y lo guardado no cambia: el color, el ancho y la opacidad del contorno
   siguen en el estilo, para cuando se vuelva a pintar contorno.       */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER SEAM OUTLINE TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8873);
const { page, errors } = await openApp(browser, srv.url, { viewport: { width: 1000, height: 700 } });
const frame = () => page.waitForTimeout(150);

await page.evaluate(() => {
  const ul = ensureRootUl();
  /* Dos cuadriláteros que comparten un borde INCLINADO: en un borde
     inclinado el antialiasing de cada lado cubre una fracción distinta
     de cada píxel y el hueco es seguro (uno vertical puede caer justo
     en la rejilla y no dejar ninguno).                              */
  const quad = ring => ({ type: "Feature", properties: {}, geometry: { type: "Polygon",
    coordinates: [[...ring, ring[0]]] } });
  const left = quad([[-3.2, 40.0], [-3.0, 40.0], [-3.01, 40.2], [-3.2, 40.2]]);
  const right = quad([[-3.0, 40.0], [-2.8, 40.0], [-2.8, 40.2], [-3.01, 40.2]]);
  const mk = (name, feature, style) => {
    const layer = L.geoJSON(feature).addTo(rootGroup);
    const li = makeNode({ name, layer, style });
    ul.appendChild(li);
    applyPolygonStyle(li);
    return li;
  };
  const style = { color: "#0000ff", weight: 7, opacity: 0.5, fillColor: "#ee0000", fillOpacity: 0.7,
                  stroke: false, fill: true };
  window.__a = mk("A", left, { ...style });
  window.__b = mk("B", right, { ...style });
  window.__opt = li => nodeLayer(li).getLayers()[0].options;
  window.__tocar = (id, v) => {
    const el = document.getElementById(id);
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  /* El alfa del lienzo a lo largo del borde compartido: el mínimo de cada
     fila de una franja de 9 px en torno a él (costura) y el máximo
     (contorno). Un píxel de la franja puede ser de fuera del conjunto en
     los extremos, por eso se dejan 8 filas de margen.                  */
  window.__edge = () => {
    const cv = document.querySelector("#map canvas");
    const cr = cv.getBoundingClientRect(), mr = map.getContainer().getBoundingClientRect();
    const k = cv.width / cr.width, ox = cr.left - mr.left, oy = cr.top - mr.top;
    const top = map.latLngToContainerPoint([40.2, -3.01]), bot = map.latLngToContainerPoint([40.0, -3.0]);
    const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    let min = 255, max = 0, light = 0, rows = 0;
    for (let y = Math.ceil(top.y) + 8; y < bot.y - 8; y++) {
      const ex = top.x + (bot.x - top.x) * (y - top.y) / (bot.y - top.y);
      let lo = 255;
      for (let x = Math.round((ex - 4 - ox) * k); x <= Math.round((ex + 4 - ox) * k); x++) {
        const a = d[(Math.round((y - oy) * k) * cv.width + x) * 4 + 3];
        lo = Math.min(lo, a); max = Math.max(max, a);
      }
      min = Math.min(min, lo); rows++; if (lo < 0.95 * 0.7 * 255) light++;
    }
    return { min, max, light, rows, fill: Math.round(0.7 * 255) };
  };
  map.setView([40.1, -3.005], 11, { animate: false });
});
await frame();

/* ---------- Lo que se dibuja ---------- */
const edge = await page.evaluate(() => __edge());
ok(edge.light === 0, `sin costura: ninguna fila del borde baja del 95 % del relleno (filas claras: ${edge.light} de ${edge.rows}, mínimo ${edge.min} de ${edge.fill})`);
ok(edge.max <= edge.fill + 1, `sin contorno: nada pasa del relleno en el borde (máximo ${edge.max} de ${edge.fill})`);

/* ---------- El control: dos tandas = lo de antes ---------- */
await page.evaluate(() => nodeLayer(__b).getLayers()[0].setStyle({ fillOpacity: 0.7000001 }));
await frame();
const ctl = await page.evaluate(() => __edge());
ok(ctl.light > 0, `partido en dos tandas de un polígono SÍ sale costura (filas claras: ${ctl.light}); si no, la prueba no probaría nada`);
await page.evaluate(() => applyPolygonStyle(__b));
await frame();

/* ---------- Leaflet no recibe ningún contorno; lo guardado, tampoco cambia ---------- */
const op = await page.evaluate(() => ({ ...__opt(__a) }));
ok(op.stroke === false && op.fillOpacity === 0.7 && op.fillColor === "#ee0000",
  "Leaflet recibe «solo relleno» tal cual: " + JSON.stringify([op.stroke, op.fillColor, op.fillOpacity]));
const guardado = await page.evaluate(() => ({ ...__a._style }));
ok(guardado.stroke === false && guardado.color === "#0000ff" && guardado.weight === 7 && guardado.opacity === 0.5,
  "lo guardado conserva color, ancho y opacidad del contorno elegidos: " + JSON.stringify(guardado));
const serial = await page.evaluate(() => serializeNode(__a)[0].style);
ok(serial.stroke === false && serial.color === "#0000ff" && serial.opacity === 0.5,
  "y es lo que se serializa (sin subir TREE_SCHEMA: `opacity` es una clave más de `style`)");

/* ---------- El orden de pintado se conserva ---------- */
await page.evaluate(() => {
  /* Un polígono azul y otro rojo, distintos, solapados: el último pintado
     (rojo) manda en el solape, como siempre.                           */
  const sq = (w, s, e, n) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon",
    coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
  const mk = (name, f, color) => {
    const layer = L.geoJSON(f).addTo(rootGroup);
    const li = makeNode({ name, layer, style: { fillColor: color, fillOpacity: 1, stroke: false, color } });
    ensureRootUl().appendChild(li); applyPolygonStyle(li);
  };
  mk("azul", sq(-2.7, 40.0, -2.55, 40.15), "#0000ff");
  mk("rojo", sq(-2.62, 40.05, -2.45, 40.2), "#ff0000");
  map.setView([40.1, -2.58], 12, { animate: false });
});
await frame();
const px = await page.evaluate(() => {
  const cv = document.querySelector("#map canvas");
  const cr = cv.getBoundingClientRect(), mr = map.getContainer().getBoundingClientRect();
  const k = cv.width / cr.width;
  const at = (lat, lng) => {
    const p = map.latLngToContainerPoint([lat, lng]);
    return [...cv.getContext("2d").getImageData(Math.round((p.x - (cr.left - mr.left)) * k), Math.round((p.y - (cr.top - mr.top)) * k), 1, 1).data];
  };
  return { solo: at(40.02, -2.65), solape: at(40.1, -2.58) };
});
ok(px.solo[2] > 200 && px.solo[0] < 50, "la zona solo azul es azul: " + px.solo);
ok(px.solape[0] > 200 && px.solape[2] < 50, "en el solape manda el último pintado (rojo): " + px.solape);

/* ---------- El coste está acotado ---------- */
/* 100 parejas de polígonos, cada pareja de un color: 100 tandas posibles,
   y cada una cuesta ~1,7 ms de componer. El tope las deja en
   SEAMLESS_MAX_RUNS por redibujado; los demás, como siempre. Un polígono
   suelto (tanda de uno) no abre ninguna.                              */
const tandas = await page.evaluate(async () => {
  const g = L.featureGroup().addTo(map);
  map.setView([40.4, -3.7], 11, { animate: false });
  const b = map.getBounds();
  const dx = (b.getEast() - b.getWest()) / 110;
  for (let i = 0; i < 100; i++) {
    const c = "#" + (0x200000 + i * 0x010203).toString(16);
    for (let k = 0; k < 2; k++) {
      const w = b.getWest() + (i + 0.1) * dx, s = b.getSouth() + 0.02 + k * 0.03;
      g.addLayer(L.polygon([[s, w], [s + 0.02, w], [s + 0.02, w + dx * 0.8]], { stroke: false, fillColor: c, fillOpacity: 0.5 }));
    }
  }
  g.addLayer(L.polygon([[40.0, -3.9], [40.01, -3.9], [40.01, -3.88]], { stroke: false, fillColor: "#123456", fillOpacity: 0.5 }));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const R = map.getRenderer(g.getLayers()[0]);
  const orig = R._beginSeamlessRun;
  let n = 0;
  R._beginSeamlessRun = function (...a) { n++; return orig.apply(this, a); };
  R._redrawBounds = null; R._redraw();
  R._beginSeamlessRun = orig;
  g.remove();
  return { n, max: SEAMLESS_MAX_RUNS };
});
ok(tandas.n > 0 && tandas.n <= tandas.max, `con 100 tandas posibles se abren como mucho ${tandas.max}: ${tandas.n}`);

/* ---------- Contorno y relleno: el contorno se sigue pintando ---------- */
await page.evaluate(() => { map.setView([40.1, -3.005], 11, { animate: false }); __a._style = { ...__a._style, stroke: true }; applyPolygonStyle(__a); });
await frame();
const both = await page.evaluate(() => ({ ...__opt(__a) }));
ok(both.stroke === true && both.color === "#0000ff" && both.weight === 7 && both.opacity === 0.5,
  "contorno y relleno: Leaflet recibe el contorno elegido, con su ancho y opacidad: " + JSON.stringify([both.color, both.weight, both.opacity]));
const azul = await page.evaluate(() => {
  const cv = document.querySelector("#map canvas");
  const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 120 && d[i] < 60 && d[i + 3] > 60) n++;
  return n;
});
ok(azul > 500, "y se ve: hay píxeles del contorno azul en el lienzo (" + azul + ")");
await page.evaluate(() => { __a._style = { ...__a._style, stroke: false }; applyPolygonStyle(__a); });

/* ---------- El diálogo: control de opacidad del contorno ---------- */
await page.evaluate(() => openStyleDialog(__a));
ok(await page.evaluate(() => Number(document.getElementById("pg-opacity").value)) === 0.5,
  "el diálogo enseña la opacidad del contorno guardada");
await page.evaluate(() => { const m = document.getElementById("pg-mode"); m.value = "both"; m.dispatchEvent(new Event("change", { bubbles: true })); });
await page.evaluate(() => __tocar("pg-opacity", "0.25"));
await frame();
ok(await page.evaluate(() => __opt(__a).opacity) === 0.25 && await page.evaluate(() => __opt(__a).color) === "#0000ff",
  "en vivo: contorno y relleno con la opacidad elegida y el color del contorno");
await page.click("#style-cancel");
await frame();
const cancel = await page.evaluate(() => [__a._style.opacity, __a._style.stroke, __opt(__a).stroke]);
ok(cancel[0] === 0.5 && cancel[1] === false && cancel[2] === false,
  "Cancelar devuelve la opacidad y el modo «solo relleno»: " + JSON.stringify(cancel));

await page.evaluate(() => openStyleDialog(__a));
await page.evaluate(() => { const m = document.getElementById("pg-mode"); m.value = "both"; m.dispatchEvent(new Event("change", { bubbles: true })); });
await page.evaluate(() => __tocar("pg-opacity", "0.25"));
await page.click("#style-accept");
await frame();
const acepta = await page.evaluate(() => [serializeNode(__a)[0].style.opacity, serializeNode(__a)[0].style.stroke]);
ok(acepta[0] === 0.25 && acepta[1] === true, "Aceptar la deja en lo serializado: " + JSON.stringify(acepta));

/* Solo relleno desde el diálogo: el contorno elegido no se pierde */
await page.evaluate(() => openStyleDialog(__a));
await page.evaluate(() => { const m = document.getElementById("pg-mode"); m.value = "fill"; m.dispatchEvent(new Event("change", { bubbles: true })); });
await frame();
ok(await page.evaluate(() => __opt(__a).stroke) === false && await page.evaluate(() => Number(document.getElementById("pg-opacity").value)) === 0.25,
  "solo relleno desde el diálogo: sin contorno en el mapa, y el selector sigue con la opacidad del contorno");
await page.click("#style-accept");
const tras = await page.evaluate(() => ({ ...__a._style }));
ok(tras.color === "#0000ff" && tras.opacity === 0.25 && tras.weight === 7 && tras.stroke === false,
  "tras aceptar «solo relleno», color, ancho y opacidad del contorno siguen guardados: " + JSON.stringify(tras));

/* ---------- Recargar: el árbol guardado vuelve igual ---------- */
await page.evaluate(() => scheduleSave());
await page.waitForTimeout(1500);
await page.reload();
await waitAppReady(page);
const rec = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(l => l._name === "A");
  const o = nodeLayer(li).getLayers()[0].options;
  return { o: [o.stroke, o.fillOpacity], s: [li._style.color, li._style.opacity, li._style.stroke] };
});
ok(rec.o[0] === false && rec.o[1] === 0.7 && rec.s[0] === "#0000ff" && rec.s[1] === 0.25 && rec.s[2] === false,
  "al recargar: sigue «solo relleno» y se conserva el contorno del usuario: " + JSON.stringify(rec));

ok(errors.length === 0, "sin errores de consola: " + errors.join("; "));
await browser.close(); srv.close();
done();
