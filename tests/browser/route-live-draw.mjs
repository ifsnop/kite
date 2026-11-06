/* Crear una ruta se comporta como EDITARLA: desde el 2º waypoint, la
   medición ya es real (no una vista previa), cuelga del árbol y su
   diálogo de propiedades está abierto con las cifras (distancia y
   rumbo por tramo) EN VIVO, sin esperar a terminar el dibujo con doble
   click — antes, `polyDraft` era solo una vista previa hasta ese
   momento, y `refreshOpenMeasureDialog` no tenía nada que refrescar
   mientras se dibujaba. Reutiliza al máximo lo que ya existe para una
   ruta ya creada (`insertRouteWaypoint`, `openStyleDialog(li,
   {isNew:true})`, el mismo patrón que un pin recién creado): por eso
   `vertexOwner` queda apuntando a esta misma ruta mientras se dibuja,
   igual que si se estuviera editando una ya terminada.

   Casos de prueba, con clics de ratón DE VERDAD (el listener que añade
   vértices está en el CONTENEDOR del mapa, no en un objeto de mentira):
   1) el primer punto es solo una vista previa (routeDraft), sin nodo ni
      diálogo; 2) el segundo crea la medición real, la cuelga del árbol
      y abre su diálogo (isNew), con un tramo ya calculado; 3) un tercer
      punto actualiza el diálogo sin cerrarlo; 4) Escape a medio dibujar
      borra el nodo (como cancelar un pin recién creado) y sale de la
      herramienta; 5) terminar con doble click se comporta como pulsar
      "Aceptar": guarda el nodo y CIERRA el diálogo, dando señal visual
      de que la edición terminó; 6) quitar el 2.º punto (o el último, con
      Supr) de una ruta en curso con solo 2 vuelve a la vista previa de un
      punto, igual que el polígono en curso; una ruta ya terminada
      conserva su mínimo de 2. */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER ROUTE LIVE DRAW TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8894);
const { page, errors } = await openApp(browser, srv.url);

function pt(lat, lng) {
  return page.evaluate(([la, ln]) => {
    const p = map.latLngToContainerPoint([la, ln]);
    const r = map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lat, lng]);
}

/* El zoom por defecto (6) deja grados enteros a pocos píxeles uno de
   otro: dos "vértices" a 0.05° de distancia caen sobre el MISMO
   manejador y el segundo click no añade nada. Un zoom de ciudad separa
   con margen de sobra los puntos usados aquí (decenas de metros).      */
await page.evaluate(() => map.setView([40.5, -3.9], 15));
await page.evaluate(() => setTool("route"));

/* ---------- 1er punto: solo vista previa, nada real todavía ---------- */
const p1 = await pt(40.5, -3.9);
await page.mouse.click(p1.x, p1.y);
const afterFirst = await page.evaluate(() => ({
  hasDraft: !!routeDraft, hasMeasurement: !!routeMeasurement, dialogHidden: styleDialog.hidden
}));
ok(afterFirst.hasDraft, "el primer punto crea solo una vista previa (routeDraft)");
ok(!afterFirst.hasMeasurement, "sin medición real todavía");
ok(afterFirst.dialogHidden, "y sin diálogo de propiedades");

/* ---------- 2º punto: medición real, en el árbol, diálogo abierto ---------- */
const p2 = await pt(40.503, -3.9);
await page.mouse.click(p2.x, p2.y);
const afterSecond = await page.evaluate(() => {
  const legs = document.getElementById("ms-legs");
  return {
    hasDraft: !!routeDraft,
    handles: routeMeasurement ? routeMeasurement.handles.length : 0,
    dialogHidden: styleDialog.hidden,
    isNew: styleIsNew,
    inTree: !!(routeMeasurement && routeMeasurement.treeLabel.closest("li").isConnected),
    legCount: legs.children.length,
    legText: legs.children[0] && legs.children[0].textContent,
    ownerIsThisRoute: !!(vertexOwner && vertexOwner.kind === "route" && vertexOwner.m === routeMeasurement)
  };
});
ok(!afterSecond.hasDraft, "la vista previa desaparece al crear la medición real");
ok(afterSecond.handles === 2, "la medición real tiene ya 2 waypoints: " + afterSecond.handles);
ok(!afterSecond.dialogHidden, "su diálogo de propiedades se abre solo, sin terminar el dibujo");
ok(afterSecond.isNew, "como un pin recién creado: Cancelar debe poder borrarla");
ok(afterSecond.inTree, "y ya cuelga del árbol");
ok(afterSecond.legCount === 1, "un tramo ya calculado: " + afterSecond.legCount);
ok(afterSecond.legText && afterSecond.legText.startsWith("Tramo 1:"),
  "con su cifra en el propio diálogo: " + afterSecond.legText);
ok(afterSecond.ownerIsThisRoute, "y se edita como cualquier ruta ya creada (vertexOwner)");

/* ---------- 3er punto: el diálogo se actualiza EN VIVO, sin cerrarse ---------- */
const p3 = await pt(40.5, -3.905);
await page.mouse.click(p3.x, p3.y);
const afterThird = await page.evaluate(() => ({
  handles: routeMeasurement.handles.length,
  dialogHidden: styleDialog.hidden,
  legCount: document.getElementById("ms-legs").children.length
}));
ok(afterThird.handles === 3, "un tercer punto añade un waypoint más: " + afterThird.handles);
ok(!afterThird.dialogHidden, "sin cerrar el diálogo");
ok(afterThird.legCount === 2, "con un segundo tramo ya en la lista: " + afterThird.legCount);

/* ---------- Escape a medio dibujar: cancela como un pin recién creado ---------- */
await page.evaluate(() => { window.__routeLi = routeMeasurement.treeLabel.closest("li"); });
await page.keyboard.press("Escape");
const afterEscape = await page.evaluate(() => ({
  routeMeasurement: !!routeMeasurement, activeTool, dialogHidden: styleDialog.hidden,
  liGone: !window.__routeLi.isConnected
}));
ok(!afterEscape.routeMeasurement, "Escape limpia el estado de dibujo de ruta");
ok(afterEscape.activeTool === null, "y sale de la herramienta");
ok(afterEscape.dialogHidden, "el diálogo se cierra");
ok(afterEscape.liGone, "y el nodo recién creado se borra, como cancelar un pin");

/* ---------- Terminar con doble click GUARDA y CIERRA, como "Aceptar" ---------- */
await page.evaluate(() => setTool("route"));
const p4 = await pt(40.506, -3.91);
await page.mouse.click(p4.x, p4.y);
const p5 = await pt(40.509, -3.91);
await page.mouse.click(p5.x, p5.y);
await page.evaluate(() => { window.__routeLi2 = routeMeasurement.treeLabel.closest("li"); });
const p6 = await pt(40.506, -3.905);
await page.mouse.dblclick(p6.x, p6.y);
await page.waitForTimeout(100);
const afterFinish = await page.evaluate(() => ({
  routeMeasurement: !!routeMeasurement, activeTool, dialogHidden: styleDialog.hidden,
  liConnected: window.__routeLi2.isConnected,
  handles: window.__routeLi2._measure.handles.length
}));
ok(!afterFinish.routeMeasurement, "terminar deja de seguir añadiendo waypoints");
ok(afterFinish.activeTool === null, "y sale de la herramienta de dibujo");
ok(afterFinish.dialogHidden, "terminar con doble click cierra el diálogo, como pulsar Aceptar");
ok(afterFinish.liConnected, "y el nodo se GUARDA, no se borra");
ok(afterFinish.handles === 3, "con el waypoint del propio doble click incluido: " + afterFinish.handles);

/* ---------- Cerrar con los BOTONES del diálogo también sale del modo dibujo ----------
   Reportado como bug: antes solo Escape limpiaba routeMeasurement/salía
   de la herramienta; cerrar con «Cancelar» o «Aceptar» —los caminos
   normales— dejaba el estado de dibujo colgando, así que el siguiente
   click seguía intentando añadir waypoints a una medición ya borrada o
   ya terminada.                                                        */
await page.evaluate(() => setTool("route"));
const p7 = await pt(40.497, -3.9);
await page.mouse.click(p7.x, p7.y);
const p8 = await pt(40.494, -3.9);
await page.mouse.click(p8.x, p8.y);
await page.evaluate(() => { window.__routeLi3 = routeMeasurement.treeLabel.closest("li"); });
await page.click("#style-cancel");
const afterCancelBtn = await page.evaluate(() => ({
  routeMeasurement: !!routeMeasurement, activeTool, dialogHidden: styleDialog.hidden,
  liGone: !window.__routeLi3.isConnected
}));
ok(!afterCancelBtn.routeMeasurement, "«Cancelar» limpia el estado de dibujo de ruta");
ok(afterCancelBtn.activeTool === null, "y sale de la herramienta");
ok(afterCancelBtn.dialogHidden, "el diálogo se cierra");
ok(afterCancelBtn.liGone, "y el nodo recién creado se borra, igual que con Escape");

/* Y «Aceptar» GUARDA la ruta —no la borra— y también sale del modo dibujo. */
await page.evaluate(() => setTool("route"));
const p9 = await pt(40.494, -3.895);
await page.mouse.click(p9.x, p9.y);
const p10 = await pt(40.491, -3.895);
await page.mouse.click(p10.x, p10.y);
await page.evaluate(() => { window.__routeLi4 = routeMeasurement.treeLabel.closest("li"); });
await page.click("#style-accept");
const afterAcceptBtn = await page.evaluate(() => ({
  routeMeasurement: !!routeMeasurement, activeTool, dialogHidden: styleDialog.hidden,
  liConnected: window.__routeLi4.isConnected,
  handles: window.__routeLi4._measure.handles.length
}));
ok(!afterAcceptBtn.routeMeasurement, "«Aceptar» también limpia el estado de dibujo de ruta");
ok(afterAcceptBtn.activeTool === null, "y sale de la herramienta");
ok(afterAcceptBtn.dialogHidden, "el diálogo se cierra");
ok(afterAcceptBtn.liConnected, "pero el nodo se GUARDA, no se borra");
ok(afterAcceptBtn.handles === 2, "con sus waypoints intactos: " + afterAcceptBtn.handles);

/* ---------- Borrar el 2.º punto de una ruta que se está CREANDO ---------- */
/* Una ruta en curso es ya una medición REAL (con su diálogo) y una medición no puede
   tener menos de 2 waypoints, así que quitar uno de los dos se rechazaba con un aviso
   y no había forma de rectificar el punto. Ahora vuelve a la vista previa de UN punto
   (como el polígono en curso, que no tiene mínimo) y se puede seguir. */
const routeNodes = () => page.evaluate(() => [...document.querySelectorAll("#tree li")].filter(x => x._measure && x._measure.type === "route").length);
const draftState = () => page.evaluate(() => ({ tool: activeTool, draft: !!routeDraft, measurement: routeMeasurement ? routeMeasurement.handles.length : 0,
  dialogHidden: styleDialog.hidden, pan: map.dragging.enabled() }));
const routesBefore = await routeNodes();
await page.evaluate(() => { setTool(null); setTool("route"); });
const q1 = await pt(40.5, -3.915), q2 = await pt(40.503, -3.915), q3 = await pt(40.506, -3.915);
await page.mouse.click(q1.x, q1.y);
await page.mouse.click(q2.x, q2.y);
ok((await draftState()).measurement === 2, "con dos puntos, la ruta ya es real");

/* Clic derecho sobre el 2.º: vuelve al punto de partida */
await page.mouse.click(q2.x, q2.y, { button: "right" });
let st = await draftState();
ok(st.draft && st.measurement === 0 && st.tool === "route" && st.dialogHidden, "quitar el 2.º con 2 puntos vuelve a la vista previa de un punto, sigue en la herramienta y sin diálogo: " + JSON.stringify(st));
ok((await routeNodes()) === routesBefore, "y no deja ninguna ruta en el árbol");
const kept = await page.evaluate(() => { const l = routeDraft.first; return { lat: l.lat, lng: l.lng }; });
ok(Math.abs(kept.lat - 40.5) < 1e-4 && Math.abs(kept.lng + 3.915) < 1e-4, "el punto que queda es el 1.º: " + JSON.stringify(kept));
ok(st.pan, "con el pan activo");

/* Se puede seguir: el clic siguiente crea de nuevo la ruta */
await page.mouse.click(q3.x, q3.y);
st = await draftState();
ok(st.measurement === 2 && !st.draft && !st.dialogHidden, "el clic siguiente vuelve a crear la ruta con su diálogo: " + JSON.stringify(st));

/* Con 3 puntos se quita sin más (3 → 2) */
const q4 = await pt(40.509, -3.915);
await page.mouse.click(q4.x, q4.y);
ok((await draftState()).measurement === 3, "tercer waypoint");
await page.mouse.click(q3.x, q3.y, { button: "right" });
st = await draftState();
ok(st.measurement === 2 && !st.draft, "con tres puntos, quitar uno deja la ruta de dos: " + JSON.stringify(st));

/* Supr hace lo mismo con el último: de 2 vuelve a un punto */
await page.keyboard.press("Delete");
st = await draftState();
ok(st.draft && st.measurement === 0 && st.tool === "route", "Supr con dos puntos también vuelve a la vista previa: " + JSON.stringify(st));
ok((await routeNodes()) === routesBefore, "(sin ruta en el árbol)");
/* Supr otra vez borra el único punto de la vista previa, como siempre */
await page.keyboard.press("Delete");
ok(!(await draftState()).draft, "y otro Supr quita el punto de la vista previa");

/* Una ruta YA TERMINADA conserva su mínimo de 2 y el aviso */
await page.evaluate(() => { setTool(null); setTool("route"); });
await page.mouse.click(q1.x, q1.y);
await page.mouse.click(q2.x, q2.y);
await page.click("#style-accept");
const doneLi = await page.evaluate(() => { const li = [...document.querySelectorAll("#tree li")].filter(x => x._measure && x._measure.type === "route").pop(); window.__done = li; return li._measure.handles.length; });
ok(doneLi === 2, "ruta terminada con 2 waypoints");
await page.evaluate(() => { document.getElementById("nav-msg").textContent = ""; removeRouteWaypoint(window.__done._measure, window.__done._measure.handles[1]); });
const kept2 = await page.evaluate(() => ({ n: window.__done._measure.handles.length, connected: window.__done.isConnected, msg: document.getElementById("nav-msg").textContent }));
ok(kept2.n === 2 && kept2.connected && /mínimo 2/.test(kept2.msg), "en una ruta ya terminada, con 2 puntos no se puede quitar y se avisa: " + JSON.stringify(kept2));

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
