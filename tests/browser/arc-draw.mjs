/* Herramienta «Medir arco»: centro → inicio (radio y orientación) → recorrer
   el perímetro → clic donde acaba. Al terminar, el arco se trocea en
   `arcSegments` tramos y se guarda como una RUTA normal: sin centro, radio
   ni apertura, y con las etiquetas de tramo apagadas (decenas de tooltips
   permanentes taparían el arco).

   Clics y movimientos de ratón DE VERDAD: los listeners del arco están en
   el mapa y en `document`, no en un objeto de mentira.

   Casos: 1) un clic sin arrastre deja el radio a medias, el siguiente lo
   fija; 2) recorrer el perímetro en sentido horario acaba en una ruta de
   N+1 waypoints sobre el círculo; 3) antihorario y de más de 180°;
   4) el número de segmentos sale de la preferencia; 5) Escape a medias no
   deja nada; 6) un barrido casi nulo no crea nada; 7) Ctrl+Z deshace;
   8) restaurar desde el guardado devuelve una ruta idéntica. */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER ARC DRAW TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8905);
const { page, errors } = await openApp(browser, srv.url);

function pt(lat, lng) {
  return page.evaluate(([la, ln]) => {
    const p = map.latLngToContainerPoint([la, ln]);
    const r = map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lat, lng]);
}
/* Punto a `dist` metros de `c` con rumbo `brg`, en píxeles de pantalla */
function ptAt(c, brg, dist) {
  return page.evaluate(([c, brg, dist]) => {
    const ll = destPoint(L.latLng(c[0], c[1]), brg, dist);
    const p = map.latLngToContainerPoint(ll);
    const r = map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [c, brg, dist]);
}
/* Chromium agrupa los mousemove que llegan dentro del mismo fotograma: sin
   esta espera, un movimiento puede leerse como el anterior.             */
async function move(p) {
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(60);
}
const arcNodes = () => page.evaluate(() =>
  [...document.querySelectorAll("#tree li")].filter(li => /^Arco \d+$/.test(li._name || "")).length);
const CENTER = [40.5, -3.9], R = 1000;

await page.evaluate(() => map.setView([40.5, -3.9], 14, { animate: false }));
await page.evaluate(() => setTool("arc"));

/* ---------- 1. Un clic sin arrastre deja el radio a medias ---------- */
const c0 = await pt(...CENTER);
await page.mouse.click(c0.x, c0.y);
let st = await page.evaluate(() => ({ draft: !!arcDraft, phase: arcDraft && arcDraft.phase }));
ok(st.draft && st.phase === "radius", "el primer clic fija el centro y espera el radio: " + JSON.stringify(st));

/* ---------- 2. Inicio al este, barrido horario hasta el sur (+90°) ---------- */
const s0 = await ptAt(CENTER, 90, R);
await move(s0);
await page.mouse.click(s0.x, s0.y);
st = await page.evaluate(() => ({ phase: arcDraft && arcDraft.phase }));
ok(st.phase === "sweep", "el segundo clic fija el inicio y pasa a recorrer el perímetro: " + JSON.stringify(st));

/* Se recorre el perímetro en pasos, como un ratón real (el barrido sigue
   el movimiento, no el rumbo absoluto)                                 */
for (const b of [100, 120, 140, 160, 180]) {
  const p = await ptAt(CENTER, b, R);
  await move(p);
}
const sw = await page.evaluate(() => arcDraft.sweep);
ok(Math.abs(sw - 90) < 2, "el barrido acumulado ronda +90°: " + sw);
const end = await ptAt(CENTER, 180, R);
await page.mouse.click(end.x, end.y);
await page.waitForTimeout(100);

const arc1 = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Arco 1");
  if (!li) return null;
  const m = li._measure;
  const wp = measureWaypoints(m);
  const c = L.latLng(40.5, -3.9);
  return {
    type: m.type, n: wp.length, draft: !!arcDraft, tool: activeTool,
    maxErr: Math.max(...wp.map(p => Math.abs(map.distance(c, L.latLng(p.lat, p.lng)) - 1000))),
    first: bearingDeg(c, L.latLng(wp[0].lat, wp[0].lng)),
    last: bearingDeg(c, L.latLng(wp[wp.length - 1].lat, wp[wp.length - 1].lng)),
    labels: m.style.showLabels, dialogHidden: styleDialog.hidden,
    rec: serializeNode(li)[0].mtype
  };
});
ok(arc1, "se crea el nodo «Arco 1» (autonumerado)");
ok(arc1.type === "route" && arc1.rec === "route", "y es una RUTA normal, sin tipo propio: " + arc1.type);
ok(arc1.n === 17, "16 segmentos por defecto → 17 waypoints: " + arc1.n);
ok(arc1.maxErr < 20, "todos los waypoints caen sobre el círculo de 1 km (error máx " + arc1.maxErr + " m)");
ok(Math.abs(arc1.first - 90) < 1.5, "empieza en la orientación del inicio (~90°): " + arc1.first);
ok(Math.abs(arc1.last - 180) < 1.5, "y acaba donde se hizo el último clic (~180°): " + arc1.last);
ok(arc1.labels === false, "con las etiquetas de tramo apagadas");
ok(arc1.dialogHidden, "sin abrir diálogo, como el círculo");
ok(!arc1.draft && arc1.tool === null, "la vista previa desaparece y se sale de la herramienta");

/* ---------- 3. Antihorario y de más de 180°, con otro número de segmentos ---------- */
await page.evaluate(() => { arcSegments = 12; map.setView([40.52, -3.9], 14, { animate: false }); setTool("arc"); });
const c1 = await pt(40.52, -3.9);
await move(c1);
await page.mouse.down();
const s1 = await ptAt([40.52, -3.9], 0, R);
await move(s1);
await page.mouse.up(); /* arrastrar del centro al inicio también vale */
ok(await page.evaluate(() => arcDraft && arcDraft.phase) === "sweep", "arrastrar centro → inicio pasa directo a la fase 2");
for (const b of [350, 320, 290, 260, 230, 200, 170]) { /* antihorario, 190° */
  const p = await ptAt([40.52, -3.9], b, R);
  await move(p);
}
const sw2 = await page.evaluate(() => arcDraft.sweep);
ok(sw2 < -180 && sw2 > -200, "el sentido lo da el ratón: -190° (antihorario, más de media vuelta): " + sw2);
const e1 = await ptAt([40.52, -3.9], 170, R);
await page.mouse.click(e1.x, e1.y);
await page.waitForTimeout(100);
const arc2 = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Arco 2");
  return li && measureWaypoints(li._measure).length;
});
ok(arc2 === 13, "la preferencia (12) fija el número de segmentos: " + arc2 + " waypoints");
ok(await page.evaluate(() => measureWaypoints(
  [...document.querySelectorAll("#tree li")].find(x => x._name === "Arco 1")._measure).length) === 17,
  "y no toca el arco anterior (17 waypoints)");

/* ---------- 4. Barrido casi nulo: no crea nada, sigue dibujando ---------- */
await page.evaluate(() => { map.setView([40.48, -3.9], 14, { animate: false }); setTool("arc"); });
const c2 = await pt(40.48, -3.9);
await page.mouse.click(c2.x, c2.y);
const s2 = await ptAt([40.48, -3.9], 90, R);
await move(s2);
await page.mouse.click(s2.x, s2.y);
await page.mouse.click(s2.x, s2.y); /* sin recorrer nada */
const before = await arcNodes();
ok(before === 2, "un clic sin barrido no crea arco: " + before);
ok(await page.evaluate(() => !!arcDraft), "y sigue dibujando");

/* ---------- 5. Escape a medias lo cancela sin dejar rastro ---------- */
await page.keyboard.press("Escape");
const esc = await page.evaluate(() => ({ draft: !!arcDraft, tool: activeTool }));
ok(!esc.draft && esc.tool === null, "Escape cancela la vista previa y sale de la herramienta: " + JSON.stringify(esc));
ok(await arcNodes() === 2, "sin nodos nuevos");

/* ---------- 6. Ctrl+Z deshace el último arco ---------- */
await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await page.waitForTimeout(300);
ok(await arcNodes() === 1, "Ctrl+Z deshace la creación del último arco: " + await arcNodes());

/* ---------- 6b. Etiquetas apagadas: ni al crear, ni al abrir, ni al Cancelar ----------
   Reportado: Cancelar el diálogo de un arco recién creado (restaura la
   foto de vértices) reaparecía las etiquetas de tramo con la casilla
   «Mostrar las etiquetas» desmarcada.                                   */
const labelsOnMap = () => page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Arco 1");
  return li._measure.legLabels.filter(t => map.hasLayer(t)).length;
});
await page.waitForTimeout(400); /* el tooltip se desmonta con fundido */
ok(await labelsOnMap() === 0, "un arco recién creado no muestra etiquetas");
await page.evaluate(() => openStyleDialog([...document.querySelectorAll("#tree li")].find(x => x._name === "Arco 1")));
ok(await page.evaluate(() => !document.getElementById("ms-show-labels").checked), "y su casilla está desmarcada");
ok(await labelsOnMap() === 0, "abrir el diálogo no las muestra");
await page.evaluate(() => { const m = styleTargets[0]._measure; m.handles[3].setLatLng([40.51, -3.89]); updateMeasurement(m); });
await page.evaluate(() => closeStyleDialog(false));
ok(await labelsOnMap() === 0, "Cancelar (que restaura los vértices) tampoco las muestra");
await page.evaluate(() => {
  openStyleDialog([...document.querySelectorAll("#tree li")].find(x => x._name === "Arco 1"));
  const c = document.getElementById("ms-show-labels");
  c.checked = true; c.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(100);
ok(await labelsOnMap() === 17 - 1, "marcar la casilla sí las muestra (una por tramo)");
await page.evaluate(() => closeStyleDialog(false));
ok(await labelsOnMap() === 0, "y Cancelar las vuelve a ocultar");

/* ---------- 7. Tras guardar y recargar, vuelve como la misma ruta ---------- */
await page.waitForTimeout(1500); /* el guardado va con retardo (scheduleSave) */
await page.reload();
await page.waitForFunction(() => [...document.querySelectorAll("#tree li")].some(x => x._name === "Mediciones"), null, { timeout: 8000 })
  .catch(() => {});
const restored = await page.evaluate(() => {
  const walk = (recs, out = []) => { for (const r of recs) { if (r.children) walk(r.children, out); else out.push(r); } return out; };
  const lis = [...document.querySelectorAll("#tree li")].filter(x => x._name === "Arco 1");
  const recs = [];
  for (const li of document.querySelectorAll("#tree li")) if (li._pending) walk(li._pending, recs);
  const li = lis[0];
  const m = li ? li._measure : (recs.find(r => r.name === "Arco 1") || {})._m;
  return m ? { type: m.type, n: measureWaypoints(m).length } : null;
});
ok(restored && restored.type === "route" && restored.n === 17,
  "recargado, «Arco 1» sigue siendo una ruta de 17 waypoints: " + JSON.stringify(restored));

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
