/* Dos comportamientos reportados sobre una medición ya creada:

   1. Arrastrar un extremo/waypoint con el diálogo de propiedades
      ABIERTO solo se veía reflejado en el mapa, nunca en las cifras
      del propio diálogo (distancia, rumbo, tramos de una ruta), hasta
      cerrarlo y volver a abrirlo. `updateMeasurement` avisa ahora al
      diálogo en cada recálculo (refreshOpenMeasureDialog), el mismo
      patrón que ya usa `applyVertexEditRings` para el perímetro/área
      de un polígono.
   2. El botón 🔍 (focusOnNode) sobre una medición usaba el zoom de
      trabajo fijo (FOCUS_ZOOM) en vez de encuadrarla entera con
      margen — una ruta de varios tramos puede ser mucho más larga que
      ancha, y un zoom fijo la dejaba cortada por los lados o perdida
      en un encuadre demasiado abierto. Ahora sigue la misma regla que
      ya tenía un polígono (fitBoundsFramed, 20% de margen).         */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER MEASURE DIALOG LIVE TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8853);
const { page, errors } = await openApp(browser, srv.url);

/* ---------- 1. El diálogo se actualiza en vivo al arrastrar ----------
   La única medición de dos puntos que queda es el círculo (una línea de
   dos puntos es ahora una ruta, probada en el bloque siguiente): radio
   y área, en vez de distancia y rumbo.                                */
const live = await page.evaluate(async () => {
  const m = buildMeasurement("circle", L.latLng(40, -3), L.latLng(40, -2));
  finalizeMeasurement(m);
  const li = m.treeLabel.closest("li");
  openStyleDialog(li);
  const before = { dist: document.getElementById("ms-dist").textContent,
                    area: document.getElementById("ms-area").textContent };

  /* Ctrl+arrastre del borde a otra posición, con eventos reales */
  const icon = m.mDest.getElement();
  const rect = icon.getBoundingClientRect();
  icon.dispatchEvent(new MouseEvent("mousedown",
    { bubbles: true, ctrlKey: true, clientX: rect.x + 6, clientY: rect.y + 6 }));
  const mapRect = map.getContainer().getBoundingClientRect();
  map.getContainer().dispatchEvent(new MouseEvent("mousemove",
    { bubbles: true, clientX: mapRect.left + 300, clientY: mapRect.top + 100 }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  const after = { dist: document.getElementById("ms-dist").textContent,
                  area: document.getElementById("ms-area").textContent };
  closeStyleDialog(true);
  return { before, after };
});
ok(live.before.dist && live.before.dist === live.before.dist, "el diálogo arranca con algún valor: " + live.before.dist);
ok(live.after.dist !== live.before.dist || live.after.area !== live.before.area,
  "arrastrar con el diálogo abierto cambia lo que muestra, SIN cerrarlo ni volver a abrirlo: "
  + JSON.stringify(live));

/* Lo mismo para una ruta: el desglose de tramos también se repinta */
const liveRoute = await page.evaluate(async () => {
  const m = buildRouteMeasurement([{ lat: 41, lng: -4 }, { lat: 41, lng: -3.9 }, { lat: 41.05, lng: -3.85 }]);
  finalizeRouteMeasurement(m);
  const li = m.treeLabel.closest("li");
  openStyleDialog(li);
  const before = document.getElementById("ms-legs").textContent;

  const h = m.handles[1]; /* waypoint intermedio */
  const icon = h.getElement();
  const rect = icon.getBoundingClientRect();
  icon.dispatchEvent(new MouseEvent("mousedown",
    { bubbles: true, ctrlKey: true, clientX: rect.x + 6, clientY: rect.y + 6 }));
  const mapRect = map.getContainer().getBoundingClientRect();
  map.getContainer().dispatchEvent(new MouseEvent("mousemove",
    { bubbles: true, clientX: mapRect.left + 500, clientY: mapRect.top + 300 }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  const after = document.getElementById("ms-legs").textContent;
  closeStyleDialog(true);
  return { before, after };
});
ok(liveRoute.before.length > 0, "la ruta arranca con su desglose de tramos: " + liveRoute.before);
ok(liveRoute.after !== liveRoute.before,
  "y también se repinta en vivo al mover un waypoint intermedio: " + JSON.stringify(liveRoute));

/* ---------- 2. 🔍 sobre una medición encuadra con margen, no zoom fijo ---------- */
const focus = await page.evaluate(async () => {
  document.getElementById("tree").innerHTML = ""; rootUl = null; rootGroup.clearLayers();
  const ul = ensureRootUl();
  /* Una "ruta" larga y estrecha: mucho más ancha que alta, el caso que
     peor encaja en un solo zoom fijo centrado.                       */
  const m = buildRouteMeasurement([{ lat: 40, lng: -9 }, { lat: 40.05, lng: -3 }, { lat: 40, lng: 3 }]);
  finalizeRouteMeasurement(m);
  const li = m.treeLabel.closest("li");
  ul.appendChild(li);
  map.setView([0, 0], 2); /* vista de partida bien lejos, para notar el cambio */
  focusOnNode(li);
  const b = subtreeBounds(li);
  const mapBounds = map.getBounds();
  return {
    zoomIsFocusZoom: map.getZoom() === FOCUS_ZOOM,
    mapContainsMeasure: mapBounds.contains(b),
    /* Con margen del 20%, el encuadre del mapa debe ser visiblemente
       más ancho que la propia medición, no pegado a sus bordes.      */
    mapWiderThanBounds: (mapBounds.getEast() - mapBounds.getWest()) > (b.getEast() - b.getWest()) * 1.1
  };
});
ok(focus.zoomIsFocusZoom === false, "una medición ya NO usa el zoom de trabajo fijo");
ok(focus.mapContainsMeasure, "la vista resultante cubre toda la medición: " + JSON.stringify(focus));
ok(focus.mapWiderThanBounds, "con margen alrededor, no ajustada a sus bordes: " + JSON.stringify(focus));

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
