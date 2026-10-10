/* El giro incorporado (08-map-rotation.js, derivado de leaflet-rotate),
   pieza a pieza, sobre el mapa real. tests/browser/rotation.mjs prueba
   los GESTOS (brújula, botón central, R) y lo que KITE hace encima;
   aquí se prueba lo que antes daba el plugin y ahora es código propio:

   1) Guardián: Leaflet es la versión para la que se escribió el código,
      y existen todos los métodos originales en los que delega.
   2) setBearing/getBearing y el evento "rotate".
   3) Conversiones pantalla <-> capa <-> latlng a varios ángulos.
   4) Marcador, etiqueta (tooltip) y popup siguen pegados a su
      coordenada, derechos, al girar.
   5) Arrastrar un marcador con el mapa girado deja la coordenada que
      hay bajo el puntero.
   6) Teselas y lienzo cubren las cuatro esquinas de la vista girada.
   7) getBounds, fitBounds y panInside con el mapa girado.
   8) Pellizco con dos dedos y el mapa girado: el punto entre los dedos
      se queda debajo de ellos.                                         */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER ROTATION CORE TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8935);
const { page, errors } = await openApp(browser, srv.url, { viewport: { width: 1200, height: 800 } });
const ANGLES = [0, 33.3, 45, 90, 180, 270];

/* ---------- 1. Guardián de versión ---------- */
const guard = await page.evaluate(() => ({
  version: L.version, patched: LEAFLET_PATCHED,
  missing: Object.entries(leaflet).filter(([, f]) => typeof f !== "function").map(([k]) => k)
}));
ok(guard.version === guard.patched, `Leaflet cargado (${guard.version}) = el que parchea el código (${guard.patched})`);
ok(guard.missing.length === 0, "existen todos los métodos de Leaflet en los que se delega: " + JSON.stringify(guard.missing));

/* ---------- 2. setBearing / getBearing / "rotate" ---------- */
const bear = await page.evaluate(() => {
  let fired = 0;
  const on = () => fired++;
  map.on("rotate", on);
  map.setBearing(370);
  const wrapped = map.getBearing();
  map.setBearing(-30);
  const negative = map.getBearing();
  map.setBearing(0);
  map.off("rotate", on);
  return { wrapped, negative, fired, pane: !!map.getPane("rotatePane") && !!map.getPane("norotatePane") };
});
ok(Math.abs(bear.wrapped - 10) < 1e-9, "370° se normaliza a 10°: " + bear.wrapped);
ok(Math.abs(bear.negative - 330) < 1e-9, "-30° se normaliza a 330°: " + bear.negative);
ok(bear.fired === 3, "cada setBearing dispara \"rotate\": " + bear.fired);
ok(bear.pane, "existen rotatePane y norotatePane");

/* ---------- 3. Conversiones a varios ángulos ---------- */
const conv = await page.evaluate(angles => angles.map(a => {
  map.setBearing(a);
  const size = map.getSize();
  let worstPx = 0, worstLayer = 0;
  for (const [x, y] of [[0, 0], [size.x, 0], [size.x / 2, size.y / 2], [123.4, 567.8], [size.x, size.y]]) {
    const ll = map.containerPointToLatLng([x, y]);
    const back = map.latLngToContainerPoint(ll);
    worstPx = Math.max(worstPx, Math.hypot(back.x - x, back.y - y));
    const lp = map.containerPointToLayerPoint([x, y]);
    const cp = map.layerPointToContainerPoint(lp);
    worstLayer = Math.max(worstLayer, Math.hypot(cp.x - x, cp.y - y));
  }
  /* El norte geográfico apunta en pantalla hacia el ángulo girado */
  const c = map.getCenter();
  const o = map.latLngToContainerPoint(c), n = map.latLngToContainerPoint([c.lat + 0.2, c.lng]);
  const north = (Math.atan2(n.x - o.x, o.y - n.y) * 180 / Math.PI + 360) % 360;
  return { a, worstPx, worstLayer, north };
}), ANGLES);
await page.evaluate(() => map.setBearing(0));
for (const r of conv) {
  ok(r.worstPx <= 1, `${r.a}°: latlng → pantalla → latlng con ≤ 1 px de error: ${r.worstPx.toFixed(3)}`);
  ok(r.worstLayer < 1e-6, `${r.a}°: capa ↔ pantalla es una inversa exacta: ${r.worstLayer}`);
  const d = Math.abs(((r.north - r.a) + 540) % 360 - 180);
  ok(d < 0.5, `${r.a}°: el norte queda en pantalla a ${r.north.toFixed(2)}° (giro horario)`);
}

/* ---------- 4. Marcador, etiqueta y popup, pegados a su sitio y derechos ---------- */
const overlays = await page.evaluate(angles => {
  const ll = map.containerPointToLatLng([700, 300]);
  const icon = L.divIcon({ className: "", html: "<div style='width:20px;height:20px'></div>",
                           iconSize: [20, 20], iconAnchor: [10, 10] });
  const mk = L.marker(ll, { icon, interactive: false }).addTo(map);
  const tip = L.tooltip({ permanent: true, direction: "center" }).setLatLng(ll).setContent("Etiqueta").addTo(map);
  const pop = L.popup({ autoPan: false, autoClose: false, closeOnClick: false }).setLatLng(ll).setContent("Popup");
  pop.openOn(map);
  const rect = el => el.getBoundingClientRect();
  const mr = map.getContainer().getBoundingClientRect();
  const rel = el => {
    const r = rect(el), p = map.latLngToContainerPoint(ll);
    return { dx: r.left - mr.left - p.x, dy: r.top - mr.top - p.y, w: r.width, h: r.height };
  };
  const out = angles.map(a => {
    map.setBearing(a);
    return { a, marker: rel(mk._icon), tip: rel(tip._container), pop: rel(pop._container),
             tipTransform: getComputedStyle(tip._container).transform };
  });
  map.setBearing(0);
  map.removeLayer(mk); map.removeLayer(tip); map.closePopup(pop);
  return out;
}, ANGLES);
const base = overlays[0];
for (const r of overlays.slice(1)) {
  for (const k of ["marker", "tip", "pop"]) {
    const d = Math.hypot(r[k].dx - base[k].dx, r[k].dy - base[k].dy);
    ok(d <= 1, `${r.a}°: ${k} sigue pegado a su coordenada (desvío ${d.toFixed(2)} px)`);
    ok(Math.abs(r[k].w - base[k].w) < 0.5 && Math.abs(r[k].h - base[k].h) < 0.5,
      `${r.a}°: ${k} sigue derecho (misma caja que con el norte arriba)`);
  }
}

/* El visor de las pruebas va sin animación de zoom (sin GPU, ver
   hwAccelerated); con GPU el popup se coloca por el otro camino
   (transform en vez de left/bottom). Un segundo mapa con la animación
   puesta prueba ese también.                                        */
const animated = await page.evaluate(() => {
  const div = document.createElement("div");
  div.style.cssText = "position:fixed;left:0;top:0;width:400px;height:300px;z-index:9999";
  document.body.appendChild(div);
  const m2 = L.map(div, { zoomAnimation: true, zoomControl: false, attributionControl: false }).setView([40, -3], 6);
  const ll = m2.containerPointToLatLng([250, 200]);
  const pop = L.popup({ autoPan: false }).setLatLng(ll).setContent("Popup").openOn(m2);
  const rel = () => {
    const r = pop._container.getBoundingClientRect(), mr = div.getBoundingClientRect(), p = m2.latLngToContainerPoint(ll);
    return { dx: r.left - mr.left - p.x, dy: r.top - mr.top - p.y };
  };
  const at0 = rel();
  m2.setBearing(50);
  const at50 = rel();
  const zoomAnimated = pop._zoomAnimated;
  m2.remove(); div.remove();
  return { zoomAnimated, d: Math.hypot(at50.dx - at0.dx, at50.dy - at0.dy) };
});
ok(animated.zoomAnimated, "el segundo mapa sí anima el zoom");
ok(animated.d <= 1, `con animación de zoom, el popup sigue pegado a su coordenada a 50° (desvío ${animated.d.toFixed(2)} px)`);

/* ---------- 5. Arrastrar un marcador con el mapa girado ---------- */
await page.evaluate(() => {
  map.setBearing(45);
  const icon = L.divIcon({ className: "drag-probe", html: "", iconSize: [24, 24], iconAnchor: [12, 12] });
  window.__drag = L.marker(map.containerPointToLatLng([500, 400]), { icon, draggable: true }).addTo(map);
});
const start = await page.evaluate(() => {
  const r = document.querySelector(".drag-probe").getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(start.x, start.y);
await page.mouse.down();
for (let k = 1; k <= 10; k++) {
  await page.mouse.move(start.x + 12 * k, start.y + 5 * k);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(50);
const drag = await page.evaluate(end => {
  const r = map.getContainer().getBoundingClientRect();
  const want = map.containerPointToLatLng([end.x - r.left, end.y - r.top]);
  const got = window.__drag.getLatLng();
  const a = map.latLngToContainerPoint(want), b = map.latLngToContainerPoint(got);
  map.removeLayer(window.__drag);
  map.setBearing(0);
  return Math.hypot(a.x - b.x, a.y - b.y);
}, { x: start.x + 120, y: start.y + 50 });
ok(drag <= 1.5, `a 45°, el marcador arrastrado queda en la coordenada bajo el puntero (desvío ${drag.toFixed(2)} px)`);

/* ---------- 6. Teselas y lienzo cubren la vista girada ---------- */
const cover = await page.evaluate(() => {
  const grid = L.gridLayer({ tileSize: 256 });
  grid.createTile = () => document.createElement("div");
  grid.addTo(map);
  const res = [0, 45, 135].map(a => {
    map.setBearing(a);
    const size = map.getSize();
    const corners = [[0, 0], [size.x, 0], [0, size.y], [size.x, size.y]];
    const tb = grid._getTiledPixelBounds(map.getCenter());
    const tilesOk = corners.every(c => {
      const p = map.project(map.containerPointToLatLng(c), grid._tileZoom);
      return p.x >= tb.min.x - 1 && p.x <= tb.max.x + 1 && p.y >= tb.min.y - 1 && p.y <= tb.max.y + 1;
    });
    const renderer = map.getRenderer(L.polyline([[0, 0], [1, 1]]));
    renderer._update();
    const canvasOk = corners.every(c => {
      const p = map.containerPointToLayerPoint(c);
      return p.x >= renderer._bounds.min.x - 1 && p.x <= renderer._bounds.max.x + 1
          && p.y >= renderer._bounds.min.y - 1 && p.y <= renderer._bounds.max.y + 1;
    });
    return { a, tilesOk, canvasOk };
  });
  map.removeLayer(grid);
  map.setBearing(0);
  return res;
});
for (const r of cover) {
  ok(r.tilesOk, `${r.a}°: las teselas pedidas cubren las cuatro esquinas de la vista`);
  ok(r.canvasOk, `${r.a}°: el lienzo cubre las cuatro esquinas de la vista`);
}

/* ---------- 7. getBounds, fitBounds y panInside, girados ---------- */
const view = await page.evaluate(() => {
  map.setView([40.4, -3.7], 6);
  map.setBearing(45);
  const size = map.getSize();
  const gb = map.getBounds();
  const boundsOk = [[0, 0], [size.x, 0], [0, size.y], [size.x, size.y]]
    .every(c => gb.contains(map.containerPointToLatLng(c)));
  /* fitBounds: las cuatro esquinas de la caja quedan dentro del visor */
  const box = L.latLngBounds([[36, -9], [44, 3]]);
  map.fitBounds(box, { animate: false });
  const inside = [box.getNorthWest(), box.getNorthEast(), box.getSouthWest(), box.getSouthEast()]
    .map(ll => map.latLngToContainerPoint(ll))
    .every(p => p.x >= -1 && p.y >= -1 && p.x <= size.x + 1 && p.y <= size.y + 1);
  const fitZoom = map.getZoom();
  /* panInside: un punto fuera de la vista pasa a estar dentro */
  const far = map.containerPointToLatLng([size.x + 300, size.y / 2]);
  map.panInside(far, { animate: false });
  const p = map.latLngToContainerPoint(far);
  const panned = p.x >= 0 && p.y >= 0 && p.x <= size.x && p.y <= size.y;
  map.setBearing(0);
  return { boundsOk, inside, fitZoom, panned, p };
});
ok(view.boundsOk, "a 45°, getBounds contiene las cuatro esquinas de la vista");
ok(view.inside, `a 45°, fitBounds deja la caja entera a la vista (zoom ${view.fitZoom})`);
ok(view.panned, "a 45°, panInside trae a la vista un punto que estaba fuera: " + JSON.stringify(view.p));

/* ---------- 8. Pellizco con dos dedos, girado ----------
   Se llama al manejador con eventos sintéticos (lo que ve con dos
   dedos de verdad): con el giro sin deshacer, el mapa se deslizaba de
   lado bajo los dedos.                                               */
const pinch = await page.evaluate(async () => {
  map.setView([40.4, -3.7], 6);
  map.setBearing(60);
  const r = map.getContainer().getBoundingClientRect();
  const touch = (x, y) => ({ clientX: r.left + x, clientY: r.top + y });
  const ev = touches => ({ touches, preventDefault() {}, stopPropagation() {} });
  const mid = { x: 300, y: 250 }; /* lejos del centro: ahí se nota el desplazamiento */
  const under = map.containerPointToLatLng([mid.x, mid.y]);
  const tz = map.touchZoom;
  tz._onTouchStart(ev([touch(mid.x - 40, mid.y), touch(mid.x + 40, mid.y)]));
  tz._onTouchMove(ev([touch(mid.x - 80, mid.y), touch(mid.x + 80, mid.y)])); /* el doble de separación */
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
  const p = map.latLngToContainerPoint(under);
  const zoom = map.getZoom();
  tz._onTouchEnd();
  await new Promise(res => setTimeout(res, 400));
  map.setBearing(0);
  return { d: Math.hypot(p.x - mid.x, p.y - mid.y), zoom };
});
ok(Math.abs(pinch.zoom - 7) < 0.01, "separar los dedos al doble acerca un nivel: " + pinch.zoom);
ok(pinch.d <= 1.5, `a 60°, el punto entre los dedos sigue debajo de ellos (desvío ${pinch.d.toFixed(2)} px)`);

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));
await browser.close();
srv.close();
done();
