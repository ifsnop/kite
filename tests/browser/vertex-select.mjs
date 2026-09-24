/* Selección de vértice, Mayús+clic para insertar y Supr para borrar —
   en rutas, polígonos Y círculos, y SOLO con el diálogo de propiedades
   abierto para ese nodo exacto.

   Reportado: se podía mover, insertar o borrar un vértice de un
   polígono o de una ruta —y mover el centro/borde de un círculo— SIN
   tener el diálogo de propiedades abierto: bastaba con la selección
   del árbol (polígono) o, para una ruta y un círculo, ni eso hacía
   falta, sus manejadores llevaban editándose siempre. La corrección:
   una única puerta, `styleDialogShows(li)` (44-dialogs.js) — ¿el
   diálogo de estilos muestra EXACTAMENTE este nodo, sin selección
   múltiple? — de la que depende todo lo demás (`vertexOwner`, para
   ruta/polígono; directamente, para el círculo). La mecánica de cada
   gesto NO cambia: clic (sin Ctrl) sobre un manejador lo selecciona;
   Ctrl+arrastre lo mueve; clic derecho lo borra directamente, sin
   seleccionarlo antes; con un vértice seleccionado, Supr lo borra, con
   prioridad sobre el nodo del árbol; Mayús+clic en cualquier otro
   punto del mapa inserta uno nuevo tras el seleccionado, o al final si
   no hay ninguno, con el cursor cambiando mientras se mantiene Mayús.

   Dos comprobaciones de coherencia pedidas después, sobre el mismo
   mecanismo: 1) el editor de texto de un polígono («Ver y editar…») y
   la edición interactiva sobre el mapa muestran la MISMA geometría por
   dos caminos, así que con el editor de texto abierto la interactiva
   se inhibe (si no, arrastrar un vértice dejaría el texto ya escrito
   desactualizado sin aviso) y se restaura sola al cerrarlo, si el
   diálogo de estilos sigue abierto; 2) el tope de vértices editables
   (antes una constante) es una preferencia configurable desde el
   editor 🏷️, con aviso explicando el motivo y dónde subirlo cuando un
   polígono lo supera.

   Cuatro bugs más, encontrados y corregidos después:
   3) un manejador PERMANENTE (waypoint de ruta, centro/borde de un
   círculo) se veía y se comportaba como editable —círculo grande,
   cursor "move"— aunque su diálogo estuviera cerrado y ningún gesto
   fuera a hacer nada; ahora es un círculo blanco pequeño sin cursor
   propio (hereda la mano de `.leaflet-interactive`) hasta que su
   diálogo se abre (`vertex-editable`, ver `setMeasureHandlesEditable`,
   52-measure.js).
   4) insertar un waypoint de ruta no conectaba la línea ni ponía la
   etiqueta de distancia/rumbo del tramo nuevo hasta mover algún
   vértice: `insertRouteWaypoint` añadía el tooltip al mapa ANTES de
   `updateMeasurement`, que es quien le da posición — un tooltip recién
   creado sin `_latlng` hacía saltar una excepción ahí mismo, antes de
   llegar a `updateMeasurement`. Corregido invirtiendo el orden.
   5) durante la edición de un polígono, Mayús+clic sobre el PRIMER
   vértice con el ÚLTIMO seleccionado cierra un trazo abierto (sin
   añadir ningún vértice duplicado), y borrar el vértice que dejaría un
   anillo cerrado por debajo de 3 lo ABRE en vez de bloquear el borrado
   — restringido a un único anillo simple (`setPathLayerClosed`,
   `convertVertexEditShape`, 43-points-editor.js): Leaflet no puede
   cambiar la clase de un L.Path en vivo, así que la capa se reconstruye
   entera y se re-cablea (`wireLayerEvents`, 31-tree-node.js).
   6) Cancelar el diálogo ahora SÍ revierte mover/insertar/borrar un
   vértice (o Ctrl+arrastrar el centro/borde de un círculo) hecho
   mientras estuvo abierto — invierte el diseño anterior ("se guarda al
   momento, sin Cancelar que lo difiera"), con el mismo patrón que ya
   usa el arrastre del marcador (`posMarker`/`posOriginal`,
   `captureVertexSnapshot`/`restoreVertexSnapshot`, 43-points-editor.js).

   No se simulan eventos de ratón reales para las mediciones/dibujo en
   sí (eso ya lo prueba measure.js y vertexedit.js a nivel de función);
   aquí lo que hace falta comprobar es la integración completa entre
   varios archivos —44-dialogs.js (el diálogo, la puerta única),
   43-points-editor.js (vertexOwner, el editor de texto, el tope
   configurable) y 52-measure.js (ruta y círculo)— con eventos de ratón
   y teclado DE VERDAD, porque un `.on("click", …)` de Leaflet solo se
   dispara de verdad al recibir el evento nativo del navegador.        */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER VERTEX SELECT TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8872);
const { page, errors } = await openApp(browser, srv.url);

/* ---------- Polígono: nada sin diálogo, todo con el diálogo abierto ---------- */
const poly = await page.evaluate(async () => {
  const ul = ensureRootUl();
  const pol = L.polygon([[40, -3], [40.1, -3], [40.1, -2.9]]).addTo(rootGroup);
  const li = makeNode({ name: "Triángulo", layer: pol, style: normalizePathStyle({}) });
  ul.appendChild(li);

  const out = {};
  /* BUG reportado: seleccionar el nodo en el árbol, sin más, ya NO
     activa nada — ni siquiera se construyen los manejadores.         */
  selectNode(li, true);
  out.noOwnerWithoutDialog = !vertexOwner;
  out.noHandlesWithoutDialog = !vertexEdit;

  openStyleDialog(li);
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

  /* Cerrar el diálogo retira los manejadores; a partir de ahí, Supr
     vuelve a ser "borrar el nodo", como siempre (ya no hay ningún
     vértice que pueda tener prioridad).                               */
  closeStyleDialog(true);
  out.tornDownOnClose = !vertexOwner && !vertexEdit;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  out.nodeDeletedAfterDialogClosed = !li.isConnected;

  return out;
});
ok(poly.noOwnerWithoutDialog, "seleccionar el nodo en el árbol, sin más, ya NO activa nada: " + poly.noOwnerWithoutDialog);
ok(poly.noHandlesWithoutDialog, "ni construye los manejadores");
ok(poly.ownerKind === "polygon", "abrir su diálogo sí activa vertexOwner=polygon: " + poly.ownerKind);
ok(poly.vertexCount0 === 3, "un manejador por vértice: " + poly.vertexCount0);
ok(poly.selectedAfterClick, "un clic sin Ctrl sobre un manejador lo selecciona");
ok(poly.selectedClass, "y le añade la clase visual vertex-selected");
ok(poly.cursorWhileShift, "con Mayús pulsado y un owner activo, el mapa pide cursor de insertar");
ok(!poly.cursorAfterShift, "y lo suelta al soltar Mayús");
ok(poly.vertexCount1 === 4, "Mayús+clic añade un vértice: " + poly.vertexCount1);
ok(poly.insertedAfterFirst, "y cae justo después del seleccionado, seleccionándose él mismo");
ok(poly.deletedOneVertex, "Supr borra el vértice seleccionado: " + poly.vertexCount2);
ok(poly.nodeStillThere, "sin tocar el nodo del árbol");
ok(poly.tornDownOnClose, "cerrar el diálogo retira el owner y los manejadores");
ok(poly.nodeDeletedAfterDialogClosed,
  "y entonces Supr vuelve a borrar el NODO, como siempre (ya no queda ningún vértice con prioridad)");

/* ---------- Ruta: sus manejadores son PERMANENTES, así que necesitan
   su propio guardia — sin diálogo abierto, ni clic ni Ctrl+arrastre ni
   clic derecho hacen nada, aunque el waypoint siga siendo clicable en
   el DOM (a diferencia de un polígono, cuyos manejadores ni existen). */
const route = await page.evaluate(async () => {
  const out = {};
  const m = buildRouteMeasurement([{ lat: 42, lng: -5 }, { lat: 42.05, lng: -4.9 }, { lat: 42, lng: -4.8 }]);
  finalizeRouteMeasurement(m);
  const li = m.treeLabel.closest("li");
  const h1 = m.handles[1]; /* waypoint intermedio */
  const el1 = h1.getElement();
  const r1 = el1.getBoundingClientRect();

  el1.dispatchEvent(new MouseEvent("click",
    { bubbles: true, clientX: r1.x + 6, clientY: r1.y + 6 }));
  out.noSelectionWithoutDialog = !vertexSelHandle;

  const countBeforeDialog = m.handles.length;
  el1.dispatchEvent(new MouseEvent("contextmenu",
    { bubbles: true, clientX: r1.x + 6, clientY: r1.y + 6 }));
  out.noDeleteWithoutDialog = m.handles.length === countBeforeDialog;

  openStyleDialog(li);
  out.ownerIsThisRoute = vertexOwner && vertexOwner.kind === "route" && vertexOwner.m === m;

  el1.dispatchEvent(new MouseEvent("click",
    { bubbles: true, clientX: r1.x + 6, clientY: r1.y + 6 }));
  out.vertexSelectedIsH1 = vertexSelHandle === h1;

  /* Supr: borra el waypoint seleccionado, la ruta se queda con 2 */
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  out.handlesAfterDelete = m.handles.length;
  out.h1Gone = !m.handles.includes(h1);
  out.routeNodeStillThere = li.isConnected;

  closeStyleDialog(true);
  out.ownerGoneAfterClose = !vertexOwner;

  /* Cerrado el diálogo, clic derecho sobre OTRO waypoint ya no borra. */
  const h2 = m.handles[0];
  const el2 = h2.getElement();
  const r2 = el2.getBoundingClientRect();
  const countAfterClose = m.handles.length;
  el2.dispatchEvent(new MouseEvent("contextmenu",
    { bubbles: true, clientX: r2.x + 6, clientY: r2.y + 6 }));
  out.noDeleteAfterDialogClosed = m.handles.length === countAfterClose;

  return out;
});
ok(route.noSelectionWithoutDialog, "sin abrir el diálogo de la ruta, clicar un waypoint no selecciona nada");
ok(route.noDeleteWithoutDialog, "ni el clic derecho lo borra");
ok(route.ownerIsThisRoute, "abrir su diálogo activa vertexOwner=route para ESTA medición");
ok(route.vertexSelectedIsH1, "ahora sí, un clic selecciona el waypoint");
ok(route.handlesAfterDelete === 2, "Supr borra el waypoint seleccionado: " + route.handlesAfterDelete);
ok(route.h1Gone, "justo ese, no otro");
ok(route.routeNodeStillThere, "sin tocar el nodo de la ruta en el árbol");
ok(route.ownerGoneAfterClose, "cerrar el diálogo retira el owner");
ok(route.noDeleteAfterDialogClosed, "y clic derecho sobre otro waypoint ya no borra nada");

/* ---------- Círculo: mismo gateo por diálogo, sin concepto de "vértice" ---------- */
const circle = await page.evaluate(async () => {
  const out = {};
  const m = buildMeasurement("circle", L.latLng(45, -8), L.latLng(45.01, -8));
  finalizeMeasurement(m);
  const li = m.treeLabel.closest("li");
  const handle = m.mDest;
  const el = handle.getElement();
  const rect = el.getBoundingClientRect();
  const before = handle.getLatLng();
  const mapRect = map.getContainer().getBoundingClientRect();

  /* Sin diálogo: arrastrar no mueve nada, con o sin Ctrl — el mismo
     gesto que llevaba funcionando siempre, la puerta más antigua de
     todas. Ctrl ya NO hace falta para arrastrar (ver el bloque de más
     abajo), pero seguir manteniéndolo pulsado no debe cambiar nada.  */
  el.dispatchEvent(new MouseEvent("mousedown",
    { bubbles: true, ctrlKey: true, clientX: rect.x + 6, clientY: rect.y + 6 }));
  map.getContainer().dispatchEvent(new MouseEvent("mousemove",
    { bubbles: true, clientX: mapRect.left + 300, clientY: mapRect.top + 100 }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  const afterNoDialog = handle.getLatLng();
  out.unchangedWithoutDialog = afterNoDialog.lat === before.lat && afterNoDialog.lng === before.lng;

  /* Con el diálogo abierto, el mismo gesto (con Ctrl) SÍ mueve, como
     siempre.                                                         */
  openStyleDialog(li);
  el.dispatchEvent(new MouseEvent("mousedown",
    { bubbles: true, ctrlKey: true, clientX: rect.x + 6, clientY: rect.y + 6 }));
  map.getContainer().dispatchEvent(new MouseEvent("mousemove",
    { bubbles: true, clientX: mapRect.left + 300, clientY: mapRect.top + 100 }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  const afterDialog = handle.getLatLng();
  out.movedWithDialog = afterDialog.lat !== before.lat || afterDialog.lng !== before.lng;
  closeStyleDialog(true);

  return out;
});
ok(circle.unchangedWithoutDialog, "círculo: arrastre no mueve nada sin diálogo abierto (con o sin Ctrl)");
ok(circle.movedWithDialog, "y sí lo mueve con el diálogo abierto, como siempre");

/* ---------- Círculo: arrastrar YA NO exige Ctrl, por uniformidad con
   ruta/polígono ----------
   La vista del mapa se guarda y se restaura alrededor de este bloque:
   más abajo hay pruebas que calculan su punto de doble click como una
   FRACCIÓN de la vista actual (`noCtrlAndDblclick`/`routeNoCtrl`, ya
   existentes), así que un doble click real aquí en medio —aunque no
   cambie el NIVEL de zoom, que es lo que se comprueba— puede desplazar
   el centro lo bastante como para dejar esas coordenadas fijas fuera
   de la vista más adelante. Restaurar la vista exacta evita ese efecto
   dominó sin tener que tocar ninguna prueba ya existente.             */
const viewBeforeCircleNoCtrl = await page.evaluate(() => ({ center: map.getCenter(), zoom: map.getZoom() }));
const circleNoCtrl = await page.evaluate(async () => {
  const out = {};
  const m = buildMeasurement("circle", L.latLng(45.1, -8), L.latLng(45.11, -8));
  finalizeMeasurement(m);
  const li = m.treeLabel.closest("li");
  const origin = m.mOrigin, dest = m.mDest;
  const originEl = origin.getElement();
  const rect = originEl.getBoundingClientRect();
  const beforeOrigin = origin.getLatLng();
  const mapRect = map.getContainer().getBoundingClientRect();

  /* Sin Ctrl, sin diálogo: sigue sin mover nada. */
  originEl.dispatchEvent(new MouseEvent("mousedown",
    { bubbles: true, clientX: rect.x + 6, clientY: rect.y + 6 }));
  map.getContainer().dispatchEvent(new MouseEvent("mousemove",
    { bubbles: true, clientX: mapRect.left + 250, clientY: mapRect.top + 150 }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  out.unchangedNoCtrlNoDialog = origin.getLatLng().lat === beforeOrigin.lat;

  /* Con el diálogo abierto, arrastrar SIN Ctrl mueve el centro. */
  openStyleDialog(li);
  const dblX = mapRect.left + 60, dblY = mapRect.top + 60;
  const zoomBefore = map.getZoom();
  originEl.dispatchEvent(new MouseEvent("mousedown",
    { bubbles: true, clientX: rect.x + 6, clientY: rect.y + 6 }));
  map.getContainer().dispatchEvent(new MouseEvent("mousemove",
    { bubbles: true, clientX: mapRect.left + 250, clientY: mapRect.top + 150 }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  out.movedNoCtrlWithDialog = origin.getLatLng().lat !== beforeOrigin.lat;
  out.dragStillEnabled = map.dragging.enabled();

  /* Y el borde (radio), también sin Ctrl. */
  const beforeDest = dest.getLatLng();
  const destEl = dest.getElement();
  const destRect = destEl.getBoundingClientRect();
  destEl.dispatchEvent(new MouseEvent("mousedown",
    { bubbles: true, clientX: destRect.x + 6, clientY: destRect.y + 6 }));
  map.getContainer().dispatchEvent(new MouseEvent("mousemove",
    { bubbles: true, clientX: mapRect.left + 400, clientY: mapRect.top + 150 }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  out.destMovedNoCtrl = dest.getLatLng().lat !== beforeDest.lat || dest.getLatLng().lng !== beforeDest.lng;

  out.zoomBefore = zoomBefore;
  closeStyleDialog(true);
  return out;
});
ok(circleNoCtrl.unchangedNoCtrlNoDialog, "círculo: arrastrar el centro sin Ctrl y sin diálogo sigue sin mover nada");
ok(circleNoCtrl.movedNoCtrlWithDialog, "con el diálogo abierto, arrastrar el centro SIN Ctrl lo mueve");
ok(circleNoCtrl.dragStillEnabled, "y map.dragging queda reactivado al soltar");
ok(circleNoCtrl.destMovedNoCtrl, "arrastrar el borde (radio) sin Ctrl también lo mueve");

/* Doble click justo después de un arrastre sin Ctrl no debe hacer zoom
   (misma trampa ya resuelta para ruta/polígono al quitarles Ctrl: sin
   desacoplar map.dragging de la tecla, el mapa competiría por el mismo
   gesto y se perdería el siguiente "dblclick").                       */
const circleDblclick = await page.evaluate(async () => {
  const m = buildMeasurement("circle", L.latLng(45.2, -8), L.latLng(45.21, -8));
  finalizeMeasurement(m);
  const li = m.treeLabel.closest("li");
  openStyleDialog(li);
  const el = m.mOrigin.getElement();
  const rect = el.getBoundingClientRect();
  const mapRect = map.getContainer().getBoundingClientRect();
  const zoomBefore = map.getZoom();
  el.dispatchEvent(new MouseEvent("mousedown",
    { bubbles: true, clientX: rect.x + 6, clientY: rect.y + 6 }));
  map.getContainer().dispatchEvent(new MouseEvent("mousemove",
    { bubbles: true, clientX: mapRect.left + 200, clientY: mapRect.top + 200 }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  /* Punto alejado de cualquier control superpuesto (barra de medición,
     zoom +/-, diálogo de estilos): los tres viven cerca de las
     esquinas superiores. */
  return { dblX: mapRect.left + mapRect.width * 0.5, dblY: mapRect.top + mapRect.height * 0.8, zoomBefore };
});
await page.mouse.dblclick(circleDblclick.dblX, circleDblclick.dblY);
await page.waitForTimeout(300);
const zoomAfterCircleDrag = await page.evaluate(() => map.getZoom());
ok(zoomAfterCircleDrag === circleDblclick.zoomBefore,
  `doble click NO hace zoom justo tras arrastrar un círculo sin Ctrl: ${circleDblclick.zoomBefore} → ${zoomAfterCircleDrag}`);
await page.evaluate(() => closeStyleDialog(true));
/* Vista restaurada: ver el comentario largo al principio de este bloque. */
await page.evaluate(v => map.setView(v.center, v.zoom, { animate: false }), viewBeforeCircleNoCtrl);

/* ---------- El editor de texto inhibe la edición interactiva del MISMO nodo ---------- */
const pointsInhibit = await page.evaluate(async () => {
  const ul = ensureRootUl();
  const pol = L.polygon([[43, -6], [43.1, -6], [43.1, -5.9]]).addTo(rootGroup);
  const li = makeNode({ name: "Cuadro", layer: pol, style: normalizePathStyle({}) });
  ul.appendChild(li);

  const out = {};
  openStyleDialog(li);
  out.activeBeforeOpen = vertexOwner && vertexOwner.kind === "polygon" && vertexOwner.li === li;

  openPointsDialog(li);
  out.tornDownOnOpen = !vertexEdit;
  out.ownerNullWhileOpen = !vertexOwner;

  closePointsDialog();
  out.activeAfterClose = vertexOwner && vertexOwner.kind === "polygon" && vertexOwner.li === li;

  closeStyleDialog(true);
  return out;
});
ok(pointsInhibit.activeBeforeOpen, "la edición interactiva está activa antes de abrir el editor de texto");
ok(pointsInhibit.tornDownOnOpen, "abrir «Ver y editar…» retira los manejadores del mapa");
ok(pointsInhibit.ownerNullWhileOpen, "y no queda owner de vértice mientras tanto");
ok(pointsInhibit.activeAfterClose,
  "cerrar el editor de texto la restaura, porque el diálogo de estilos sigue mostrando el mismo nodo");

/* ---------- El tope de vértices es CONFIGURABLE, desde el panel Propiedades ----------
   El panel sigue ahora la edición diferida del resto de la aplicación: el
   campo previsualiza EN VIVO (igual que antes) pero solo "Aceptar" lo
   persiste en IndexedDB — así que el test pulsa ese botón, no un simple
   toggle de cierre (que ahora sería un Cancelar y revertiría el cambio). */
const maxCfg = await page.evaluate(async () => {
  const out = {};
  const pol = L.polygon([[44, -7], [44.05, -7], [44.05, -6.95], [44, -6.95]]).addTo(rootGroup); /* 4 vértices */
  const li = makeNode({ name: "Cuatro vértices", layer: pol, style: normalizePathStyle({}) });
  ensureRootUl().appendChild(li);
  openStyleDialog(li);
  out.activeAtDefault = !!vertexOwner;

  await togglePropsDialog();
  const input = document.getElementById("gnp-vertex-max");
  out.inputShowsCurrent = Number(input.value) === vertexEditMax;
  input.value = "3";
  input.dispatchEvent(new Event("change", { bubbles: true }));
  out.maxUpdated = vertexEditMax === 3;
  /* Bajar el tope mientras este polígono ya era el owner activo debe
     desactivarla AL MOMENTO, sin cerrar y reabrir el diálogo.         */
  out.inhibitedAfterLowering = !vertexOwner;
  out.messageMentionsLayer = [...document.querySelectorAll(".nav-msg-text")]
    .some(el => el.textContent.includes("Cuatro vértices") && el.textContent.includes("(3)"));
  document.getElementById("props-accept").click();
  out.savedToDb = await dbLoadVertexEditMax();

  await togglePropsDialog();
  document.getElementById("gnp-vertex-max").value = "500";
  document.getElementById("gnp-vertex-max").dispatchEvent(new Event("change", { bubbles: true }));
  document.getElementById("props-accept").click();
  out.activeAfterRaising = !!vertexOwner;

  closeStyleDialog(true);
  return out;
});
ok(maxCfg.activeAtDefault, "con el tope por defecto, un polígono de 4 vértices se edita sin más");
ok(maxCfg.inputShowsCurrent, "el editor 🏷️ arranca mostrando el tope vigente");
ok(maxCfg.maxUpdated, "cambiar el campo actualiza vertexEditMax: " + maxCfg.maxUpdated);
ok(maxCfg.savedToDb === 3, "y lo persiste en IndexedDB: " + maxCfg.savedToDb);
ok(maxCfg.inhibitedAfterLowering, "con el tope bajado a 3, ese mismo polígono deja de editarse EN EL ACTO");
ok(maxCfg.messageMentionsLayer, "avisando qué capa y con qué tope, con el diálogo ya abierto");
ok(maxCfg.activeAfterRaising, "subirlo de nuevo la reactiva también EN EL ACTO");

/* ---------- Regresión: insertar un waypoint de ruta conecta la línea y
   etiqueta el tramo nuevo AL MOMENTO, sin exception ni mover nada ---------- */
const routeInsert = await page.evaluate(async () => {
  const out = {};
  const m = buildRouteMeasurement([{ lat: 10, lng: 10 }, { lat: 10.05, lng: 10.1 }, { lat: 10, lng: 10.2 }]);
  finalizeRouteMeasurement(m);
  const li = m.treeLabel.closest("li");
  openStyleDialog(li);
  selectVertex(m.handles[0]);
  const mapRect = map.getContainer().getBoundingClientRect();
  insertVertexAfterSelected(map.containerPointToLatLng([mapRect.width / 2, mapRect.height / 2]));
  out.geomPts = m.geom.getLatLngs().length;
  out.legLabelCount = m.legLabels.length;
  out.legLabelHasContent = m.legLabels.every(l => /NM|km|m|ft/.test(l.getContent()));
  out.legLabelHasLatLng = m.legLabels.every(l => { try { return !!l.getLatLng(); } catch { return false; } });
  closeStyleDialog(true);
  return out;
});
ok(routeInsert.geomPts === 4, "insertar un waypoint conecta la línea al momento: " + routeInsert.geomPts);
ok(routeInsert.legLabelCount === 3, "y añade su tooltip de tramo: " + routeInsert.legLabelCount);
ok(routeInsert.legLabelHasContent, "con distancia y rumbo ya escritos, sin mover nada más");
ok(routeInsert.legLabelHasLatLng, "y con posición ya puesta (antes lanzaba una excepción aquí)");

/* ---------- Aspecto/cursor: pasivo sin diálogo, "editable" con él ----------
   Reportado como bug: el TAMAÑO visible nunca cambiaba entre los dos
   modos, aunque la clase `vertex-editable` sí se aplicaba/retiraba
   correctamente (lo que ya comprobaba este mismo bloque, y por lo que
   el bug pasó desapercibido). Causa real: el `transform: scale()` que
   decidía el tamaño vivía en el MISMO `<div>` que Leaflet posiciona
   con un `transform` en línea (que siempre gana a cualquier regla de
   hoja de estilos) — se movió a un `<span class="measure-dot">`
   interior, que Leaflet no toca; aquí se mide su `getBoundingClientRect()`
   real, no solo la clase, para que una regresión futura de este tipo sí
   se detecte.                                                          */
const passiveHandles = await page.evaluate(async () => {
  const out = {};
  const dotSize = h => {
    const r = h.getElement().querySelector(".measure-dot").getBoundingClientRect();
    return { w: r.width, h: r.height };
  };
  const m = buildRouteMeasurement([{ lat: 12, lng: 12 }, { lat: 12.05, lng: 12.1 }]);
  finalizeRouteMeasurement(m);
  const li = m.treeLabel.closest("li");
  const el = m.handles[0].getElement();
  out.notEditableBefore = !el.classList.contains("vertex-editable");
  out.cursorBefore = getComputedStyle(el).cursor;
  out.dotSizeBefore = dotSize(m.handles[0]);
  openStyleDialog(li);
  out.editableWhileOpen = el.classList.contains("vertex-editable");
  out.cursorWhileOpen = getComputedStyle(el).cursor;
  out.dotSizeWhileOpen = dotSize(m.handles[0]);
  closeStyleDialog(true);
  out.notEditableAfterClose = !el.classList.contains("vertex-editable");
  out.dotSizeAfterClose = dotSize(m.handles[0]);

  const c = buildMeasurement("circle", L.latLng(13, 12), L.latLng(13.01, 12));
  finalizeMeasurement(c);
  const li2 = c.treeLabel.closest("li");
  const elc = c.mDest.getElement();
  out.circleNotEditableBefore = !elc.classList.contains("vertex-editable");
  out.circleDotSizeBefore = dotSize(c.mDest);
  openStyleDialog(li2);
  out.circleEditableWhileOpen = elc.classList.contains("vertex-editable");
  out.circleDotSizeWhileOpen = dotSize(c.mDest);
  closeStyleDialog(true);
  out.circleNotEditableAfterClose = !elc.classList.contains("vertex-editable");
  out.circleDotSizeAfterClose = dotSize(c.mDest);
  return out;
});
ok(passiveHandles.notEditableBefore, "un waypoint sin diálogo abierto no lleva vertex-editable");
ok(passiveHandles.cursorBefore === "pointer", "y su cursor es la mano de siempre: " + passiveHandles.cursorBefore);
ok(passiveHandles.editableWhileOpen, "con el diálogo abierto, sí la lleva");
ok(passiveHandles.cursorWhileOpen === "move", "y el cursor pasa a move: " + passiveHandles.cursorWhileOpen);
ok(passiveHandles.notEditableAfterClose, "cerrar el diálogo la retira");
ok(passiveHandles.dotSizeBefore.w < passiveHandles.dotSizeWhileOpen.w,
  `el punto visible es más pequeño en presentación que en edición: ${JSON.stringify(passiveHandles.dotSizeBefore)} < ${JSON.stringify(passiveHandles.dotSizeWhileOpen)}`);
ok(passiveHandles.dotSizeAfterClose.w === passiveHandles.dotSizeBefore.w,
  "y vuelve a encoger al cerrar el diálogo");
ok(passiveHandles.circleNotEditableBefore, "mismo aspecto pasivo para un círculo sin diálogo abierto");
ok(passiveHandles.circleEditableWhileOpen, "y editable con el diálogo abierto");
ok(passiveHandles.circleNotEditableAfterClose, "vuelve a pasivo al cerrarlo");
ok(passiveHandles.circleDotSizeBefore.w < passiveHandles.circleDotSizeWhileOpen.w,
  "lo mismo para un círculo: más pequeño en presentación que en edición");
ok(passiveHandles.circleDotSizeAfterClose.w === passiveHandles.circleDotSizeBefore.w,
  "y también encoge de vuelta al cerrar");

/* ---------- Cerrar un trazo abierto: Mayús+clic en el primer vértice,
   con el último seleccionado ---------- */
const closeShape = await page.evaluate(async () => {
  const out = {};
  const ul = ensureRootUl();
  const line = L.polyline([[20, 20], [20.1, 20], [20.1, 20.1], [20, 20.1]]).addTo(rootGroup);
  const li = makeNode({ name: "Línea a cerrar", layer: line, style: normalizePathStyle({}) });
  ul.appendChild(li);
  openStyleDialog(li);
  const ring = vertexEdit.handleRings[0];

  /* Sin el último seleccionado, Mayús+clic en el primero NO cierra: es
     un clic normal (selecciona el primero, nada más).                 */
  const elFirst = ring[0].getElement();
  const rFirst = elFirst.getBoundingClientRect();
  elFirst.dispatchEvent(new MouseEvent("click",
    { bubbles: true, shiftKey: true, clientX: rFirst.x + 6, clientY: rFirst.y + 6 }));
  out.notClosedWithoutLastSelected = !vertexEdit.closed;
  out.selectedInsteadOfClosing = vertexSelHandle === ring[0];

  /* Con el último seleccionado, Mayús+clic en el primero SÍ cierra. */
  selectVertex(ring[ring.length - 1]);
  elFirst.dispatchEvent(new MouseEvent("click",
    { bubbles: true, shiftKey: true, clientX: rFirst.x + 6, clientY: rFirst.y + 6 }));
  out.closedNow = vertexEdit.closed;
  out.layerIsPolygon = vertexEdit.layer instanceof L.Polygon;
  out.vertexCountUnchanged = vertexEdit.rings[0].length === 4;

  /* Sigue editándose igual que cualquier polígono tras el cambio */
  const h = vertexEdit.handleRings[0][0];
  h.setLatLng(L.latLng(21, 20));
  const pos = findVertexEditPos(h);
  vertexEdit.rings[pos[0]][pos[1]] = L.latLng(21, 20);
  applyVertexEditRings();
  out.stillEditableAfterClose = vertexEdit.layer.getLatLngs()[0][0].lat === 21;

  closeStyleDialog(true);
  out.persistsAsPolygon = nodeLayer(li) instanceof L.Polygon;
  return out;
});
ok(closeShape.notClosedWithoutLastSelected, "Mayús+clic en el primer vértice sin el último seleccionado no cierra");
ok(closeShape.selectedInsteadOfClosing, "se comporta como un clic normal: selecciona el primero");
ok(closeShape.closedNow, "con el último seleccionado, Mayús+clic en el primero SÍ cierra");
ok(closeShape.layerIsPolygon, "la capa pasa a L.Polygon");
ok(closeShape.vertexCountUnchanged, "sin añadir ningún vértice duplicado: " + closeShape.vertexCountUnchanged);
ok(closeShape.stillEditableAfterClose, "sigue pudiéndose editar igual que cualquier polígono");
ok(closeShape.persistsAsPolygon, "y se queda como polígono tras Aceptar");

/* ---------- Abrir un polígono cerrado al borrar por debajo del mínimo ---------- */
const openShape = await page.evaluate(async () => {
  const out = {};
  const ul = ensureRootUl();
  const tri = L.polygon([[25, 25], [25.1, 25], [25.1, 25.1]]).addTo(rootGroup);
  const li = makeNode({ name: "Triángulo a abrir", layer: tri, style: normalizePathStyle({}) });
  ul.appendChild(li);
  openStyleDialog(li);
  removeVertexEditPoint(vertexEdit.handleRings[0][0]);
  out.openedNow = !vertexEdit.closed;
  out.layerIsPolyline = !(vertexEdit.layer instanceof L.Polygon);
  out.vertsLeft = vertexEdit.rings[0].length;
  out.messageMentionsLayer = [...document.querySelectorAll(".nav-msg-text")]
    .some(el => el.textContent.includes("Triángulo a abrir") && el.textContent.includes("abierto"));
  closeStyleDialog(true);
  out.persistsAsPolyline = !(nodeLayer(li) instanceof L.Polygon);
  return out;
});
ok(openShape.openedNow, "borrar por debajo de 3 en un polígono cerrado lo abre en vez de bloquear");
ok(openShape.layerIsPolyline, "la capa pasa a L.Polyline");
ok(openShape.vertsLeft === 2, "y el borrado se completa: " + openShape.vertsLeft);
ok(openShape.messageMentionsLayer, "avisando qué capa se ha abierto y por qué");
ok(openShape.persistsAsPolyline, "y se queda como línea tras Aceptar");

/* ---------- Cancelar revierte TODO cambio de vértice: polígono, ruta y
   círculo ---------- */
const cancelReverts = await page.evaluate(async () => {
  const out = {};
  const ul = ensureRootUl();

  const pol = L.polygon([[30, 30], [30.1, 30], [30.1, 29.9]]).addTo(rootGroup);
  const li = makeNode({ name: "Polígono cancelado", layer: pol, style: normalizePathStyle({}) });
  ul.appendChild(li);
  const before = JSON.stringify(pol.getLatLngs());
  openStyleDialog(li);
  const h0 = vertexEdit.handleRings[0][0];
  h0.setLatLng(L.latLng(31, 30));
  vertexEdit.rings[0][0] = L.latLng(31, 30);
  applyVertexEditRings();
  insertVertexEditPoint(vertexEdit.handleRings[0][1], L.latLng(30.05, 29.95));
  removeVertexEditPoint(vertexEdit.handleRings[0][2]);
  closeStyleDialog(false); /* Cancelar */
  out.polygonReverted = JSON.stringify(nodeLayer(li).getLatLngs()) === before;

  const m = buildRouteMeasurement([{ lat: 32, lng: 30 }, { lat: 32.05, lng: 30.1 }, { lat: 32, lng: 30.2 }]);
  finalizeRouteMeasurement(m);
  const li2 = m.treeLabel.closest("li");
  const beforeWaypoints = JSON.stringify(m.handles.map(h => h.getLatLng()));
  openStyleDialog(li2);
  m.handles[0].setLatLng(L.latLng(33, 30));
  updateMeasurement(m);
  insertRouteWaypoint(m, m.handles[1], L.latLng(32.02, 30.05));
  removeRouteWaypoint(m, m.handles[2]);
  closeStyleDialog(false); /* Cancelar */
  out.routeReverted = JSON.stringify(m.handles.map(h => h.getLatLng())) === beforeWaypoints;

  const c = buildMeasurement("circle", L.latLng(35, 35), L.latLng(35.01, 35));
  finalizeMeasurement(c);
  const li3 = c.treeLabel.closest("li");
  const beforeOrigin = c.mOrigin.getLatLng().lat, beforeDest = c.mDest.getLatLng().lat;
  openStyleDialog(li3);
  c.mDest.setLatLng(L.latLng(35.02, 35));
  updateMeasurement(c);
  closeStyleDialog(false); /* Cancelar */
  out.circleReverted = c.mOrigin.getLatLng().lat === beforeOrigin && c.mDest.getLatLng().lat === beforeDest;

  return out;
});
ok(cancelReverts.polygonReverted, "Cancelar revierte mover+insertar+borrar en un polígono");
ok(cancelReverts.routeReverted, "y en una ruta");
ok(cancelReverts.circleReverted, "y el Ctrl+arrastre de un círculo");

/* ---------- Mover un vértice ya NO exige Ctrl (polígono y ruta) ----------
   Reportado (sesión anterior): con Ctrl obligatorio, el mapa se quedaba
   SIN gestionar dragging durante la edición (solo se gestionaba cuando
   Ctrl era obligatorio) — quitarle esa condición sin más habría dejado
   el mapa compitiendo por el mismo gesto que un arrastre de vértice sin
   Ctrl. attachVertexDrag gestiona ahora map.dragging él solo mientras
   dura CADA arrastre, fuera de herramienta activa (ver su comentario).
   El doble click, EN SÍ, ya NO debe hacer zoom mientras se edita —
   reportado después: insertar dos vértices seguidos con Mayús+clic
   (dos clics rápidos, indistinguibles de un intento de doble click)
   podía disparar un zoom no pedido. `anyEditModeActive`/
   `refreshDoubleClickZoom` (52-measure.js) apagan `doubleClickZoom`
   mientras haya un polígono/ruta/círculo en edición, igual que ya
   hacía `setTool` durante el DIBUJO; se comprueba también que vuelve a
   funcionar en cuanto se cierra el diálogo.                           */
const viewBeforeNoCtrl = await page.evaluate(() => ({ center: map.getCenter(), zoom: map.getZoom() }));
const noCtrlAndDblclick = await page.evaluate(async () => {
  /* Vista fija sobre el propio polígono: sin esto, la posición en pantalla
     de sus vértices depende de dónde dejaron el mapa los escenarios
     anteriores (paneos/zooms de las mediciones previas) y del ancho del
     panel de navegación — puede coincidir con el hueco fijo arriba-derecha
     del diálogo de estilos (.dlg-float) y "tapar" el propio vértice bajo
     su caja, haciendo fallar el arrastre sin que sea un fallo real.
     Restaurada justo después (viewBeforeNoCtrl): los escenarios que
     siguen (routeNoCtrl y otros) reutilizan las mismas coordenadas
     cercanas a Madrid asumiendo la vista que ya hubiera en ese momento. */
  map.setView([40.325, -3.875], 10, { animate: false });
  const ul = ensureRootUl();
  const pol = L.polygon([[40.3, -3.9], [40.35, -3.9], [40.35, -3.85]]).addTo(rootGroup);
  const li = makeNode({ name: "Sin Ctrl", layer: pol, style: normalizePathStyle({}) });
  ul.appendChild(li);
  openStyleDialog(li);
  const h = vertexEdit.handleRings[0][0];
  const before = h.getLatLng();
  const el = h.getElement();
  const r = el.getBoundingClientRect();
  const mapRect = map.getContainer().getBoundingClientRect();
  window.__vertexBefore = { lat: before.lat, lng: before.lng };
  return {
    hx: r.x + r.width / 2, hy: r.y + r.height / 2,
    dropX: mapRect.left + mapRect.width * 0.7, dropY: mapRect.top + mapRect.height * 0.3,
    dblX: mapRect.left + mapRect.width * 0.2, dblY: mapRect.top + mapRect.height * 0.2,
    zoomBefore: map.getZoom()
  };
});
await page.mouse.move(noCtrlAndDblclick.hx, noCtrlAndDblclick.hy);
await page.mouse.down();
await page.mouse.move(noCtrlAndDblclick.dropX, noCtrlAndDblclick.dropY, { steps: 8 });
await page.mouse.up();
const afterDrag = await page.evaluate(() => {
  const ll = vertexEdit.handleRings[0][0].getLatLng();
  return { lat: ll.lat, lng: ll.lng, dragStillEnabled: map.dragging.enabled() };
});
ok(afterDrag.lat !== undefined && (afterDrag.lat !== 40.3 || afterDrag.lng !== -3.9),
  "arrastrar un vértice de polígono SIN mantener Ctrl lo mueve: " + JSON.stringify(afterDrag));
ok(afterDrag.dragStillEnabled, "y map.dragging queda reactivado al soltar");

await page.mouse.move(noCtrlAndDblclick.dblX, noCtrlAndDblclick.dblY);
await page.mouse.dblclick(noCtrlAndDblclick.dblX, noCtrlAndDblclick.dblY);
await page.waitForTimeout(300);
const zoomWhileEditing = await page.evaluate(() => map.getZoom());
ok(zoomWhileEditing === noCtrlAndDblclick.zoomBefore,
  `doble click NO hace zoom mientras se edita un polígono: ${noCtrlAndDblclick.zoomBefore} → ${zoomWhileEditing}`);
await page.evaluate(() => closeStyleDialog(true));

/* Cerrado el diálogo, el doble click vuelve a hacer zoom con normalidad */
await page.mouse.dblclick(noCtrlAndDblclick.dblX, noCtrlAndDblclick.dblY);
await page.waitForTimeout(300);
const zoomAfterClose = await page.evaluate(() => map.getZoom());
ok(zoomAfterClose > zoomWhileEditing,
  `y vuelve a hacer zoom al cerrar el diálogo: ${zoomWhileEditing} → ${zoomAfterClose}`);
await page.evaluate(v => map.setView(v.center, v.zoom, { animate: false }), viewBeforeNoCtrl);

/* Mismo cambio para una ruta: arrastrar un waypoint SIN Ctrl lo mueve */
const viewBeforeRouteNoCtrl = await page.evaluate(() => ({ center: map.getCenter(), zoom: map.getZoom() }));
const routeNoCtrl = await page.evaluate(async () => {
  /* Misma razón que en el polígono de más arriba: vista propia para que
     el waypoint no acabe bajo el diálogo de estilos flotante.          */
  map.setView([40.225, -3.875], 10, { animate: false });
  const m = buildRouteMeasurement([{ lat: 40.2, lng: -3.9 }, { lat: 40.25, lng: -3.85 }]);
  finalizeRouteMeasurement(m);
  const li = m.treeLabel.closest("li");
  openStyleDialog(li);
  const el = m.handles[0].getElement();
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(routeNoCtrl.x, routeNoCtrl.y);
await page.mouse.down();
await page.mouse.move(routeNoCtrl.x + 60, routeNoCtrl.y + 40, { steps: 5 });
await page.mouse.up();
const routeMoved = await page.evaluate(() => {
  const ll = vertexOwner.m.handles[0].getLatLng();
  return ll.lat !== 40.2 || ll.lng !== -3.9;
});
ok(routeMoved, "arrastrar un waypoint de ruta SIN mantener Ctrl también lo mueve");
await page.evaluate(v => map.setView(v.center, v.zoom, { animate: false }), viewBeforeRouteNoCtrl);
await page.evaluate(() => closeStyleDialog(true));

/* ---------- Tecla Insertar: en la posición del RATÓN, no del vértice ----------
   Reportado como bug: insertaba en la posición del propio vértice base
   (un duplicado justo encima), en vez de en la del ratón — a diferencia
   de Mayús+clic, que siempre insertó en la posición del click. Ahora usa
   `coordsPending` (`70-view-controls.js`), la última posición conocida
   del ratón sobre el mapa, la misma que ya usa PageUp/PageDown para el
   zoom al cursor — se fija con un "mousemove" sintético antes de cada
   pulsación, para no depender de dónde quedara el ratón real de pruebas
   anteriores en este mismo archivo.                                    */
const insertKey = await page.evaluate(async () => {
  const out = {};
  const ul = ensureRootUl();
  const pol = L.polygon([[41, -3.9], [41.1, -3.9], [41.1, -3.8]]).addTo(rootGroup);
  const li = makeNode({ name: "Insertar", layer: pol, style: normalizePathStyle({}) });
  ul.appendChild(li);
  openStyleDialog(li);

  /* El zoom por defecto (6) redondea al pixel: convertir un latlng a
     punto de contenedor y de vuelta puede alterarlo en varias
     milésimas de grado, así que la comprobación usa `coordsPending`
     —la MISMA lectura que consume la tecla Insertar— en vez de
     comparar contra el latlng original pedido.                       */
  const mapRect = map.getContainer().getBoundingClientRect();
  const moveMouseTo = latlng => {
    const p = map.latLngToContainerPoint(latlng);
    map.getContainer().dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true, clientX: mapRect.left + p.x, clientY: mapRect.top + p.y
    }));
    return coordsPending;
  };

  /* Con un vértice seleccionado: inserta justo detrás, en la posición
     del ratón — NO en la del vértice base.                            */
  const h0 = vertexEdit.handleRings[0][0];
  selectVertex(h0);
  const mouse1 = moveMouseTo(L.latLng(41.05, -3.85));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Insert", bubbles: true }));
  out.countAfterSelected = vertexEdit.rings[0].length;
  const inserted1 = vertexEdit.rings[0][1];
  out.insertedAtMouse = inserted1.lat === mouse1.lat && inserted1.lng === mouse1.lng;
  out.notAtBaseVertex = inserted1.lat !== h0.getLatLng().lat || inserted1.lng !== h0.getLatLng().lng;
  out.newOneSelected = vertexSelHandle === vertexEdit.handleRings[0][1];

  /* Sin selección: inserta al final, en la posición del ratón (otro
     punto distinto, para no confundirlo con el anterior).             */
  clearVertexSelection();
  const mouse2 = moveMouseTo(L.latLng(41.02, -3.82));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Insert", bubbles: true }));
  out.countAfterEnd = vertexEdit.rings[0].length;
  const lastAfter = vertexEdit.rings[0][vertexEdit.rings[0].length - 1];
  out.insertedAtEnd = lastAfter.lat === mouse2.lat && lastAfter.lng === mouse2.lng;

  closeStyleDialog(true);
  return out;
});
ok(insertKey.countAfterSelected === 4, "Insertar con un vértice seleccionado añade uno: " + insertKey.countAfterSelected);
ok(insertKey.insertedAtMouse, "en la posición del ratón");
ok(insertKey.notAtBaseVertex, "no en la del vértice base");
ok(insertKey.newOneSelected, "y el nuevo vértice queda seleccionado");
ok(insertKey.countAfterEnd === 5, "Insertar sin selección añade uno más al final: " + insertKey.countAfterEnd);
ok(insertKey.insertedAtEnd, "también en la posición del ratón");

/* ---------- Abrir/cerrar: casos negativos, para blindar la regla ----------
   Un polígono cerrado NUNCA se abre borrando vértices salvo el caso
   exacto de quedar en 3 y borrar uno más. Un polígono abierto SÍ se
   puede cerrar (ya probado arriba); por debajo de 3 no cierra.        */
const shapeMatrix = await page.evaluate(async () => {
  const out = {};
  const ul = ensureRootUl();

  /* Cerrado de 5: borrar CUALQUIER vértice nunca lo abre */
  const p5 = L.polygon([[42, -3.9], [42.1, -3.9], [42.15, -3.85], [42.1, -3.8], [42, -3.8]]).addTo(rootGroup);
  const li5 = makeNode({ name: "Cinco", layer: p5, style: normalizePathStyle({}) });
  ul.appendChild(li5);
  openStyleDialog(li5);
  removeVertexEditPoint(vertexEdit.handleRings[0][2]);
  out.fiveStaysClosedAfterOne = vertexEdit.closed && vertexEdit.rings[0].length === 4;
  removeVertexEditPoint(vertexEdit.handleRings[0][0]);
  out.fourStaysClosedAfterOne = vertexEdit.closed && vertexEdit.rings[0].length === 3;
  closeStyleDialog(true);

  /* Cerrado de exactamente 3: borrar CUALQUIERA de los tres abre (no
     solo el índice 0, para confirmar que no depende de CUÁL se borra) */
  const p3 = L.polygon([[43, -3.9], [43.1, -3.9], [43.1, -3.8]]).addTo(rootGroup);
  const li3 = makeNode({ name: "Tres", layer: p3, style: normalizePathStyle({}) });
  ul.appendChild(li3);
  openStyleDialog(li3);
  removeVertexEditPoint(vertexEdit.handleRings[0][1]); /* el del medio, no el 0 */
  out.threeOpensRegardlessOfWhich = !vertexEdit.closed && vertexEdit.rings[0].length === 2;
  closeStyleDialog(true);

  /* Con un agujero: aunque el exterior o el agujero lleguen a 3, NUNCA
     se abre nada — el guardia de un único anillo simple lo impide.    */
  const outer = [[44, -3.9], [44.2, -3.9], [44.2, -3.7], [44, -3.7]];
  const hole = [[44.05, -3.85], [44.05, -3.8], [44.1, -3.8]]; /* triángulo: ya en 3 */
  const pHole = L.polygon([outer, hole]).addTo(rootGroup);
  const liHole = makeNode({ name: "Con agujero", layer: pHole, style: normalizePathStyle({}) });
  ul.appendChild(liHole);
  openStyleDialog(liHole);
  out.holeBlocksInsteadOfOpening = vertexEdit.closed; /* sigue cerrado: no se ha tocado nada aún */
  removeVertexEditPoint(vertexEdit.handleRings[1][0]); /* borrar en el agujero, ya en 3 */
  out.holeStillClosedAfterBlock = vertexEdit.closed && vertexEdit.rings[1].length === 3
    && vertexEdit.rings[0].length === 4;
  closeStyleDialog(true);

  /* Línea abierta con menos de 3 vértices: Mayús+clic en el primero no
     cierra nada (no hay bastante para un polígono válido).            */
  const line2 = L.polyline([[45, -3.9], [45.1, -3.8]]).addTo(rootGroup);
  const liLine2 = makeNode({ name: "Línea corta", layer: line2, style: normalizePathStyle({}) });
  ul.appendChild(liLine2);
  openStyleDialog(liLine2);
  const ring2 = vertexEdit.handleRings[0];
  selectVertex(ring2[ring2.length - 1]);
  const elF = ring2[0].getElement();
  const rF = elF.getBoundingClientRect();
  elF.dispatchEvent(new MouseEvent("click",
    { bubbles: true, shiftKey: true, clientX: rF.x + 6, clientY: rF.y + 6 }));
  out.tooFewDoesNotClose = !vertexEdit.closed && vertexEdit.rings[0].length === 2;
  out.tooFewWarns = [...document.querySelectorAll(".nav-msg-text")]
    .some(el => el.textContent.includes("Faltan vértices para cerrar"));
  closeStyleDialog(true);

  /* Abrir y seguir editando con normalidad como línea */
  const p3b = L.polygon([[46, -3.9], [46.1, -3.9], [46.1, -3.8]]).addTo(rootGroup);
  const li3b = makeNode({ name: "Tres-b", layer: p3b, style: normalizePathStyle({}) });
  ul.appendChild(li3b);
  openStyleDialog(li3b);
  removeVertexEditPoint(vertexEdit.handleRings[0][0]); /* abre: queda en 2 */
  insertVertexEditPoint(vertexEdit.handleRings[0][0], L.latLng(46.05, -3.75));
  out.editsFineAfterOpening = vertexEdit.rings[0].length === 3 && !vertexEdit.closed;
  closeStyleDialog(true);

  return out;
});
ok(shapeMatrix.fiveStaysClosedAfterOne, "cerrado de 5: borrar uno se queda cerrado con 4");
ok(shapeMatrix.fourStaysClosedAfterOne, "y borrar otro más se queda cerrado con 3 (todavía no es el caso límite)");
ok(shapeMatrix.threeOpensRegardlessOfWhich, "cerrado de exactamente 3: abre borrando cualquiera de los tres, no solo el primero");
ok(shapeMatrix.holeBlocksInsteadOfOpening, "polígono con agujero: sigue cerrado al abrir su diálogo");
ok(shapeMatrix.holeStillClosedAfterBlock, "y borrar en el agujero (ya en 3) NUNCA lo abre: solo bloquea, exterior intacto");
ok(shapeMatrix.tooFewDoesNotClose, "línea de 2 vértices: Mayús+clic en el primero no cierra (no llega a 3)");
ok(shapeMatrix.tooFewWarns, "y avisa por qué: " + shapeMatrix.tooFewWarns);
ok(shapeMatrix.editsFineAfterOpening, "tras abrirse, se sigue editando con normalidad como línea");

/* ---------- Menú contextual en un manejador: solo en modo presentación ----------
   Reportado: clic derecho en CUALQUIER manejador no abría nunca el
   menú, ni con diálogo abierto ni cerrado — Leaflet no deja llegar el
   "contextmenu" nativo de un marcador interactivo hasta el contenedor
   del mapa, así que el map.on("contextmenu", …) que lo abre nunca lo
   recibía, hiciera lo que hiciera nuestro propio listener del
   manejador. Resuelto: en modo presentación (sin diálogo abierto) el
   clic derecho abre el menú normal (openCtxMenuFromMouseEvent, llamado
   a mano desde el propio manejador); en modo edición sigue borrando al
   instante, sin menú, como siempre — confirmado con el usuario.       */
const ctxOnHandle = await page.evaluate(async () => {
  const m = buildRouteMeasurement([{ lat: 40.6, lng: -3.9 }, { lat: 40.65, lng: -3.85 }, { lat: 40.6, lng: -3.8 }]);
  finalizeRouteMeasurement(m);
  const el = m.handles[1].getElement();
  const r = el.getBoundingClientRect();
  const mapRect = map.getContainer().getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, mapX: mapRect.left, mapY: mapRect.top };
});
await page.mouse.click(ctxOnHandle.x, ctxOnHandle.y, { button: "right" });
await page.waitForTimeout(100);
const menuNoDialog = await page.evaluate(() => ({
  hidden: document.getElementById("map-ctxmenu").hidden,
  items: [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")].map(b => b.textContent)
}));
ok(!menuNoDialog.hidden, "clic derecho en un waypoint de ruta SIN diálogo abierto: abre el menú contextual");
ok(menuNoDialog.items.includes("Editar propiedades"), "con acceso a Editar propiedades: " + JSON.stringify(menuNoDialog.items));
await page.evaluate(() => closeCtxMenu());

const viewBeforeCtxEditing = await page.evaluate(() => ({ center: map.getCenter(), zoom: map.getZoom() }));
const ctxOnHandleEditing = await page.evaluate(async () => {
  /* Misma razón que los casos anteriores: vista propia para que el
     waypoint no acabe bajo el diálogo de estilos flotante.             */
  map.setView([40.725, -3.85], 10, { animate: false });
  const m = buildRouteMeasurement([{ lat: 40.7, lng: -3.9 }, { lat: 40.75, lng: -3.85 }, { lat: 40.7, lng: -3.8 }]);
  finalizeRouteMeasurement(m);
  const li = m.treeLabel.closest("li");
  openStyleDialog(li);
  const el = m.handles[1].getElement();
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, before: m.handles.length };
});
await page.mouse.click(ctxOnHandleEditing.x, ctxOnHandleEditing.y, { button: "right" });
await page.waitForTimeout(100);
const editingResult = await page.evaluate(() => ({
  menuHidden: document.getElementById("map-ctxmenu").hidden
}));
const afterCount = await page.evaluate(() => vertexOwner.m.handles.length);
ok(editingResult.menuHidden, "con el diálogo abierto, clic derecho NO abre el menú");
ok(afterCount === ctxOnHandleEditing.before - 1, "sigue borrando el waypoint al instante: " + afterCount);
await page.evaluate(() => closeStyleDialog(true));
await page.evaluate(v => map.setView(v.center, v.zoom, { animate: false }), viewBeforeCtxEditing);

/* Círculo: nunca borra con clic derecho, así que siempre va al menú */
const viewBeforeCtxCircle = await page.evaluate(() => ({ center: map.getCenter(), zoom: map.getZoom() }));
const ctxOnCircle = await page.evaluate(async () => {
  /* Misma razón que los casos anteriores: vista propia para que el
     manejador no acabe bajo el diálogo de estilos flotante.            */
  map.setView([40.805, -3.9], 10, { animate: false });
  const c = buildMeasurement("circle", L.latLng(40.8, -3.9), L.latLng(40.81, -3.9));
  finalizeMeasurement(c);
  const li = c.treeLabel.closest("li");
  openStyleDialog(li);
  const el = c.mDest.getElement();
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(ctxOnCircle.x, ctxOnCircle.y, { button: "right" });
await page.waitForTimeout(100);
const circleMenu = await page.evaluate(() => document.getElementById("map-ctxmenu").hidden);
ok(!circleMenu, "clic derecho en el borde de un círculo abre el menú, con o sin diálogo abierto");
await page.evaluate(() => { closeCtxMenu(); closeStyleDialog(true); });
await page.evaluate(v => map.setView(v.center, v.zoom, { animate: false }), viewBeforeCtxCircle);

/* ---------- Supr selecciona el VECINO tras borrar, para poder encadenar ----------
   Reportado como bug: tras borrar el vértice seleccionado no quedaba
   nada seleccionado, así que borrar varios vértices consecutivos
   exigía volver a hacer clic entre uno y otro. Ahora el vecino —el
   siguiente, o el anterior si era el último— queda seleccionado solo,
   así que Supr repetido va comiéndose vértices seguidos.              */
const chainDelete = await page.evaluate(async () => {
  const out = {};
  const ul = ensureRootUl();

  /* Polígono de 5 vértices: seleccionar el del medio y borrar dos
     veces seguidas sin volver a hacer clic.                          */
  const pol = L.polygon([[50, 0], [50.1, 0], [50.15, 0.05], [50.1, 0.1], [50, 0.1]]).addTo(rootGroup);
  const li = makeNode({ name: "Cadena", layer: pol, style: normalizePathStyle({}) });
  ul.appendChild(li);
  openStyleDialog(li);
  const ring = vertexEdit.handleRings[0];
  const middle = ring[2]; /* el del medio */
  const wasNeighbor = ring[3]; /* el siguiente: es el que debe quedar seleccionado */
  selectVertex(middle);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  out.countAfterFirst = vertexEdit.rings[0].length;
  out.selectedIsNeighbor = vertexSelHandle === wasNeighbor;
  /* Segundo Supr, SIN volver a seleccionar nada a mano */
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  out.countAfterSecond = vertexEdit.rings[0].length;
  out.stillSomethingSelected = !!vertexSelHandle;
  closeStyleDialog(true);

  /* Con un agujero: el vecino elegido debe ser del MISMO anillo. */
  const outer = [[51, 0], [51.2, 0], [51.2, 0.2], [51, 0.2]];
  const hole = [[51.05, 0.05], [51.05, 0.1], [51.1, 0.1], [51.1, 0.05]];
  const pHole = L.polygon([outer, hole]).addTo(rootGroup);
  const liHole = makeNode({ name: "Agujero", layer: pHole, style: normalizePathStyle({}) });
  ul.appendChild(liHole);
  openStyleDialog(liHole);
  const holeRing = vertexEdit.handleRings[1];
  selectVertex(holeRing[1]);
  const holeNeighbor = holeRing[2];
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  out.holeNeighborSelected = vertexSelHandle === holeNeighbor;
  out.holeNeighborInSameRing = vertexEdit.handleRings[1].includes(vertexSelHandle);
  closeStyleDialog(true);

  /* Ruta de 4 waypoints: mismo encadenado. */
  const m = buildRouteMeasurement([
    { lat: 52, lng: 0 }, { lat: 52.05, lng: 0 }, { lat: 52.1, lng: 0 }, { lat: 52.15, lng: 0 }
  ]);
  finalizeRouteMeasurement(m);
  const rli = m.treeLabel.closest("li");
  openStyleDialog(rli);
  const h1 = m.handles[1];
  const routeNeighbor = m.handles[2];
  selectVertex(h1);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  out.routeHandlesAfterFirst = m.handles.length;
  out.routeSelectedIsNeighbor = vertexSelHandle === routeNeighbor;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  out.routeHandlesAfterSecond = m.handles.length;
  out.routeStillSomethingSelected = !!vertexSelHandle;
  closeStyleDialog(true);

  return out;
});
ok(chainDelete.countAfterFirst === 4, "primer Supr borra el vértice del medio: " + chainDelete.countAfterFirst);
ok(chainDelete.selectedIsNeighbor, "y deja seleccionado el que era su vecino siguiente");
ok(chainDelete.countAfterSecond === 3, "segundo Supr, sin reseleccionar, borra otro: " + chainDelete.countAfterSecond);
ok(chainDelete.stillSomethingSelected, "y sigue quedando algo seleccionado");
ok(chainDelete.holeNeighborSelected, "con un agujero, el vecino elegido es el correcto");
ok(chainDelete.holeNeighborInSameRing, "y pertenece al MISMO anillo que el borrado");
ok(chainDelete.routeHandlesAfterFirst === 3, "en una ruta: primer Supr borra uno: " + chainDelete.routeHandlesAfterFirst);
ok(chainDelete.routeSelectedIsNeighbor, "y deja seleccionado el siguiente waypoint");
ok(chainDelete.routeHandlesAfterSecond === 2, "segundo Supr encadenado borra otro: " + chainDelete.routeHandlesAfterSecond);
ok(chainDelete.routeStillSomethingSelected, "hasta llegar al mínimo, sigue quedando selección");

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
