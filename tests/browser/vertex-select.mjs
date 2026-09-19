/* Selección de vértice, Mayús+clic para insertar y Supr para borrar —
   en rutas Y en polígonos, sin que haga falta abrir ningún diálogo.

   Reportado: no se podían borrar vértices de una medición si no estaba
   abierto el panel de propiedades. La petición completa, confirmada con
   el usuario: un clic (sin Ctrl) sobre un vértice lo SELECCIONA; Supr
   borra el seleccionado, con prioridad sobre el borrado de nodos del
   árbol; Mayús+clic en cualquier otro punto del mapa inserta uno nuevo
   justo después del seleccionado, o al final si no hay ninguno; y todo
   esto aplica igual a un polígono, activado por tenerlo como ÚNICA
   selección del árbol —ya no por el diálogo de estilos, que antes era
   el único camino—.

   No se simulan eventos de ratón reales para las mediciones/dibujo en
   sí (eso ya lo prueba measure.js y vertexedit.js a nivel de función);
   aquí lo que hace falta comprobar es la integración completa entre
   tres archivos —30-tree-walk.js (selección), 43-points-editor.js
   (vertexOwner) y 52-measure.js (rutas)— con eventos de ratón y
   teclado DE VERDAD, porque un `.on("click", …)` de Leaflet solo se
   dispara de verdad al recibir el evento nativo del navegador.        */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER VERTEX SELECT TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8872);
const { page, errors } = await openApp(browser, srv.url);

/* ---------- Polígono: seleccionar, insertar, borrar — sin diálogo ---------- */
const poly = await page.evaluate(async () => {
  const ul = ensureRootUl();
  const pol = L.polygon([[40, -3], [40.1, -3], [40.1, -2.9]]).addTo(rootGroup);
  const li = makeNode({ name: "Triángulo", layer: pol, style: normalizePathStyle({}) });
  ul.appendChild(li);

  const out = {};
  /* Seleccionar el nodo en el árbol activa la edición interactiva SIN
     abrir ningún diálogo de estilos.                                  */
  selectNode(li, true);
  out.ownerKind = vertexOwner && vertexOwner.kind;
  out.vertexCount0 = vertexEdit.handleRings[0].length;

  /* Clic (sin Ctrl) sobre el primer manejador: lo selecciona. */
  const h0 = vertexEdit.handleRings[0][0];
  const el0 = h0.getElement();
  const r0 = el0.getBoundingClientRect();
  el0.dispatchEvent(new MouseEvent("click",
    { bubbles: true, clientX: r0.x + 6, clientY: r0.y + 6 }));
  out.selectedAfterClick = vertexSelHandle === h0;
  out.selectedClass = el0.classList.contains("vertex-selected");

  /* Mayús pulsado: el mapa debe pedir cursor de "insertar". El listener
     real está en `document` (una pulsación de verdad burbujea hasta
     ahí desde lo que tenga el foco); despachar en `window` no llega —
     `window` no es un ascendiente de `document` en el árbol de
     eventos, es al revés.                                             */
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
  out.cursorWhileShift = map.getContainer().classList.contains("vertex-insert-cursor");
  document.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
  out.cursorAfterShift = map.getContainer().classList.contains("vertex-insert-cursor");

  /* Mayús+clic en un punto vacío del mapa: inserta justo después del
     vértice seleccionado (el primero), no al final.                   */
  const mapRect = map.getContainer().getBoundingClientRect();
  map.getContainer().dispatchEvent(new MouseEvent("click", {
    bubbles: true, shiftKey: true,
    clientX: mapRect.left + mapRect.width / 2, clientY: mapRect.top + mapRect.height / 2
  }));
  out.vertexCount1 = vertexEdit.handleRings[0].length;
  out.insertedAfterFirst = vertexEdit.handleRings[0][1] === vertexSelHandle;

  /* Supr: borra el vértice SELECCIONADO (el recién insertado), no el
     nodo del árbol — el nodo sigue en el árbol después.                */
  const beforeCount = vertexEdit.handleRings[0].length;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  out.vertexCount2 = vertexEdit.handleRings[0].length;
  out.deletedOneVertex = out.vertexCount2 === beforeCount - 1;
  out.nodeStillThere = li.isConnected;
  out.selectionStillOne = selection.size === 1 && selection.has(li);

  /* Sin ningún vértice seleccionado, Supr vuelve a borrar el NODO
     (comportamiento de siempre del árbol) — la prioridad es solo
     mientras hay un vértice elegido. clearVertexSelection no se expone
     aparte: deseleccionar y reseleccionar el mismo nodo reconstruye
     vertexOwner con vertexSelHandle en null.                          */
  clearSelection();
  selectNode(li, true);
  out.noVertexSelectedNow = !vertexSelHandle;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  out.nodeDeletedWithoutVertexSelected = !li.isConnected;

  return out;
});
ok(poly.ownerKind === "polygon", "seleccionar el nodo en el árbol activa vertexOwner=polygon, sin diálogo: " + poly.ownerKind);
ok(poly.vertexCount0 === 3, "un manejador por vértice: " + poly.vertexCount0);
ok(poly.selectedAfterClick, "un clic sin Ctrl sobre un manejador lo selecciona");
ok(poly.selectedClass, "y le añade la clase visual vertex-selected");
ok(poly.cursorWhileShift, "con Mayús pulsado y un owner activo, el mapa pide cursor de insertar");
ok(!poly.cursorAfterShift, "y lo suelta al soltar Mayús");
ok(poly.vertexCount1 === 4, "Mayús+clic añade un vértice: " + poly.vertexCount1);
ok(poly.insertedAfterFirst, "y cae justo después del seleccionado, seleccionándose él mismo");
ok(poly.deletedOneVertex, "Supr borra el vértice seleccionado: " + poly.vertexCount2);
ok(poly.nodeStillThere, "sin tocar el nodo del árbol");
ok(poly.selectionStillOne, "que sigue seleccionado en el árbol");
ok(poly.noVertexSelectedNow, "reseleccionar el nodo deja vertexSelHandle en null");
ok(poly.nodeDeletedWithoutVertexSelected,
  "y entonces Supr vuelve a borrar el NODO, como siempre (la prioridad es solo con un vértice elegido)");

/* ---------- Ruta: clic en un waypoint selecciona su nodo Y el vértice ---------- */
const route = await page.evaluate(async () => {
  const out = {};
  /* Una segunda capa de por medio, para que el waypoint NO empiece
     siendo ya la selección del árbol — así se prueba que el clic la
     selecciona por su cuenta (mismo camino que exigió el bug).        */
  const otherPol = L.polygon([[41, -4], [41.1, -4], [41.1, -3.9]]).addTo(rootGroup);
  const otherLi = makeNode({ name: "Otro", layer: otherPol, style: normalizePathStyle({}) });
  ensureRootUl().appendChild(otherLi);
  selectNode(otherLi, true);

  const m = buildRouteMeasurement([{ lat: 42, lng: -5 }, { lat: 42.05, lng: -4.9 }, { lat: 42, lng: -4.8 }]);
  finalizeRouteMeasurement(m);
  const li = m.treeLabel.closest("li");

  out.ownerBeforeClick = vertexOwner && vertexOwner.li === otherLi;
  const h1 = m.handles[1]; /* waypoint intermedio */
  const el1 = h1.getElement();
  const r1 = el1.getBoundingClientRect();
  el1.dispatchEvent(new MouseEvent("click",
    { bubbles: true, clientX: r1.x + 6, clientY: r1.y + 6 }));

  out.treeSelectionMovedToRoute = selection.size === 1 && selection.has(li);
  out.ownerIsThisRoute = vertexOwner && vertexOwner.kind === "route" && vertexOwner.li === li;
  out.vertexSelectedIsH1 = vertexSelHandle === h1;

  /* Supr: borra el waypoint seleccionado, la ruta se queda con 2 */
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  out.handlesAfterDelete = m.handles.length;
  out.h1Gone = !m.handles.includes(h1);
  out.routeNodeStillThere = li.isConnected;

  return out;
});
ok(route.ownerBeforeClick, "antes de tocar la ruta, el owner activo es la otra capa seleccionada");
ok(route.treeSelectionMovedToRoute, "clic en un waypoint selecciona su nodo en el árbol");
ok(route.ownerIsThisRoute, "y la convierte en el owner activo de vértices");
ok(route.vertexSelectedIsH1, "seleccionando ese waypoint en concreto");
ok(route.handlesAfterDelete === 2, "Supr borra el waypoint seleccionado: " + route.handlesAfterDelete);
ok(route.h1Gone, "justo ese, no otro");
ok(route.routeNodeStillThere, "sin tocar el nodo de la ruta en el árbol");

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
