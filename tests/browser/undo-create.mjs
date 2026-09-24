/* Crear un marcador, una medición (ruta o círculo) o un polígono/línea
   es una mutación del árbol como cualquier otra, y por tanto debe
   poder deshacerse con Ctrl+Z (`undoLast`) y rehacerse con Ctrl+Y
   (`redoLast`) — reportado como bug: ninguno de los cuatro caminos de
   creación llamaba a `pushUndo`, así que crear algo y luego deshacer
   no lo quitaba (Ctrl+Z pasaba a la operación anterior, o no había
   nada que deshacer). Arreglado añadiendo `pushUndo` justo ANTES de
   cada mutación (mismo patrón que ya usan borrar/mover/pegar), no
   dentro de "Aceptar"/"Cancelar" del diálogo de estilos: la creación
   ya es una acción completa y guardada (`scheduleSave()`) desde el
   momento en que aparece en el árbol, independientemente de lo que se
   decida después sobre su estilo.

   Un marcador y una ruta abren su diálogo de propiedades nada más
   crearse (`isNew: true`); se cierra con Aceptar ANTES de deshacer en
   cada caso, para no mezclar esto con si deshacer debe además cerrar
   un diálogo abierto sobre el nodo que desaparece — cuestión aparte,
   no la que se prueba aquí.                                          */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER UNDO CREATE TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8902);
const { page, errors } = await openApp(browser, srv.url);

function pt(lat, lng) {
  return page.evaluate(([la, ln]) => {
    const p = map.latLngToContainerPoint([la, ln]);
    const r = map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lat, lng]);
}
function leafNames() {
  return page.evaluate(() =>
    [...document.querySelectorAll("#tree li")].filter(el => !el._isContainer).map(el => el._name));
}

/* ---------- Marcador (📍 crear un pin) ---------- */
await page.evaluate(() => map.setView([40.5, -3.9], 10, { animate: false }));
await page.evaluate(() => {
  createPin();
  closeStyleDialog(true); /* Aceptar: lo deja tal cual, sin tocar su estilo */
});
const namesAfterPin = await leafNames();
ok(namesAfterPin.includes("Marcador 1"), "crear un marcador lo cuelga del árbol: " + JSON.stringify(namesAfterPin));
await page.evaluate(() => undoLast());
const namesAfterPinUndo = await leafNames();
ok(!namesAfterPinUndo.includes("Marcador 1"), "Ctrl+Z deshace la creación del marcador: " + JSON.stringify(namesAfterPinUndo));
await page.evaluate(() => redoLast());
const namesAfterPinRedo = await leafNames();
ok(namesAfterPinRedo.includes("Marcador 1"), "Ctrl+Y la rehace: " + JSON.stringify(namesAfterPinRedo));

/* ---------- Polígono (herramienta ⬠, doble click sobre el primer vértice cierra) ----------
   Zoom 13 con vértices separados ~0.02°: a ese zoom caen a >100 px unos
   de otros (sin esto, un zoom pensado para otra escala deja las tres
   "esquinas" a miles de píxeles del centro, fuera del viewport, y
   ningún click llega siquiera a crear un vértice).                    */
await page.evaluate(() => map.setView([41.01, -3.89], 13, { animate: false }));
await page.evaluate(() => setTool("polygon"));
const p1 = await pt(41, -3.9), p2 = await pt(41.02, -3.9), p3 = await pt(41.02, -3.88);
await page.mouse.click(p1.x, p1.y);
await page.mouse.click(p2.x, p2.y);
await page.mouse.click(p3.x, p3.y);
await page.mouse.dblclick(p1.x, p1.y);
const namesAfterPoly = await leafNames();
ok(namesAfterPoly.includes("Polígono 1"), "cerrar un polígono con doble click lo cuelga del árbol: " + JSON.stringify(namesAfterPoly));
await page.evaluate(() => undoLast());
const namesAfterPolyUndo = await leafNames();
ok(!namesAfterPolyUndo.includes("Polígono 1"), "Ctrl+Z deshace también la creación de un polígono");
await page.evaluate(() => redoLast());
const namesAfterPolyRedo = await leafNames();
ok(namesAfterPolyRedo.includes("Polígono 1"), "Ctrl+Y lo rehace");

/* ---------- Ruta de medición (⤳, doble click termina y guarda) ---------- */
await page.evaluate(() => map.setView([42.01, -3.89], 13, { animate: false }));
await page.evaluate(() => setTool("route"));
const r1 = await pt(42, -3.9), r2 = await pt(42.02, -3.9);
await page.mouse.click(r1.x, r1.y);
await page.mouse.click(r2.x, r2.y); /* 2º punto: ya es una medición real, con diálogo abierto */
await page.mouse.dblclick(r2.x, r2.y); /* termina de añadir waypoints */
await page.waitForTimeout(50);
const namesAfterRoute = await leafNames();
ok(namesAfterRoute.includes("Ruta 1"), "terminar una ruta con doble click la cuelga del árbol: " + JSON.stringify(namesAfterRoute));
/* Cierra el diálogo de propiedades (abierto desde el 2º waypoint) antes
   de deshacer, para no mezclar esto con si deshacer debe además cerrar
   un diálogo abierto sobre el nodo que desaparece — cuestión aparte.  */
await page.evaluate(() => { if (!styleDialog.hidden) closeStyleDialog(true); });
await page.evaluate(() => undoLast());
const namesAfterRouteUndo = await leafNames();
ok(!namesAfterRouteUndo.includes("Ruta 1"), "Ctrl+Z deshace también la creación de una ruta de medición");
await page.evaluate(() => redoLast());
const namesAfterRouteRedo = await leafNames();
ok(namesAfterRouteRedo.includes("Ruta 1"), "Ctrl+Y la rehace");

/* ---------- Círculo de medición (◯, arrastrar del centro al borde) ---------- */
await page.evaluate(() => map.setView([43.01, -3.89], 13, { animate: false }));
await page.evaluate(() => setTool("circle"));
const c1 = await pt(43, -3.9), c2 = await pt(43.01, -3.9);
await page.mouse.move(c1.x, c1.y);
await page.mouse.down();
await page.mouse.move(c2.x, c2.y, { steps: 5 });
await page.mouse.up();
const namesAfterCircle = await leafNames();
ok(namesAfterCircle.includes("Círculo 1"), "soltar tras arrastrar crea el círculo y lo cuelga del árbol: " + JSON.stringify(namesAfterCircle));
await page.evaluate(() => undoLast());
const namesAfterCircleUndo = await leafNames();
ok(!namesAfterCircleUndo.includes("Círculo 1"), "Ctrl+Z deshace también la creación de un círculo");
await page.evaluate(() => redoLast());
const namesAfterCircleRedo = await leafNames();
ok(namesAfterCircleRedo.includes("Círculo 1"), "Ctrl+Y lo rehace");

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
