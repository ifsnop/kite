/* Teclado y rueda del visor con eventos DE VERDAD: flechas (desplazar),
   Re/Av Pág y rueda (zoom continuo), según el tiempo que la tecla está
   pulsada y no según la autorrepetición del sistema; y el foco, que
   tiene que quedarse en el visor para que esas teclas lleguen.

   Playwright no autorrepite: un `keyboard.down` es UN keydown, como el
   primero de una pulsación real antes del retardo de repetición. Con el
   comportamiento anterior (un paso por keydown), mantener una tecla un
   segundo daba un único paso de 80 px o un único nivel de zoom: los
   casos de «mantener» de esta suite FALLAN sin el cambio.

   1) Flechas: un toque recorre 80 px; manteniendo, el mapa ya se mueve
      a los 100 ms y en un segundo pasa de 500 px; dos flechas dan una
      diagonal; Mayús va más rápido; contra el borde del mundo se para y
      no rebota al soltar; con el mapa a 90°, ↑ sigue siendo hacia
      arriba de la pantalla.
   2) Lo que señala el cursor (coordenadas) sigue al cursor aunque el
      ratón no se mueva.
   3) Re/Av Pág: un toque es ±1 nivel exacto; manteniendo, el zoom es
      continuo (fraccionario a medias), al soltar queda en un nivel
      entero, y el punto bajo el cursor no se mueve. En el zoom mínimo,
      Av Pág no baja de él.
   4) Con el foco en el buscador, ni flechas ni Re/Av Pág tocan el mapa.
   5) La chuleta ya no pide Ctrl para mover un círculo de medición.
   6) Rueda: una muesca pasa por niveles fraccionarios y se asienta un
      nivel exacto más arriba con el punto del cursor quieto; tres
      muescas, tres niveles; deltas de panel táctil, al entero
      siguiente; Ctrl+rueda no amplía la página; sobre un control, nada.
   7) Foco: clicar un marcador o crear una ruta (su diálogo se abre al
      segundo punto) lo deja en el visor; un guardado del árbol no se
      lo quita a un marcador enfocado con Tab.                         */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER KEYBOARD NAV TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8940);
const { page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

const box = await page.evaluate(() => {
  const r = map.getContainer().getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
const P = { x: 300, y: 250 }; /* cursor, en el contenedor del mapa */
const view = (lat, lng, z) => page.evaluate(([a, b, c]) => {
  map.setBearing(0);
  map.setView([a, b], c, { animate: false });
}, [lat, lng, z]);
/* Dónde cae en pantalla el punto que estaba en el centro: el
   desplazamiento del CONTENIDO (el contrario al de la vista).       */
const markRef = () => page.evaluate(() => { window.REF = map.getCenter(); });
const refShift = () => page.evaluate(() => {
  const p = map.latLngToContainerPoint(REF), h = map.getSize().divideBy(2);
  return { x: p.x - h.x, y: p.y - h.y };
});
const hold = async (key, ms) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};

/* Foco en el visor con el ratón en P (un clic en el mapa vacío) */
await view(40, -3, 6);
await page.mouse.click(box.x + P.x, box.y + P.y);

/* ---------- 1. Flechas ---------- */
await markRef();
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(400);
let s = await refShift();
ok(Math.abs(s.x + 80) <= 2 && Math.abs(s.y) <= 1, "un toque de → desplaza 80 px: " + JSON.stringify(s));

await markRef();
await page.keyboard.down("ArrowRight");
await page.waitForTimeout(100);
s = await refShift();
ok(s.x < -20, "manteniendo, a los 100 ms ya se ha movido (sin esperar a la repetición): " + JSON.stringify(s));
await page.waitForTimeout(900);
await page.keyboard.up("ArrowRight");
await page.waitForTimeout(100);
s = await refShift();
ok(s.x < -500, "mantener → un segundo pasa de 500 px (antes: un paso de 80): " + JSON.stringify(s));
const settled = await refShift();
await page.waitForTimeout(300);
const later = await refShift();
ok(Math.abs(later.x - settled.x) <= 1, "al soltar se para, sin seguir ni rebotar: " + JSON.stringify([settled, later]));

await markRef();
await page.keyboard.down("ArrowRight");
await page.keyboard.down("ArrowDown");
await page.waitForTimeout(300);
await page.keyboard.up("ArrowRight");
await page.keyboard.up("ArrowDown");
await page.waitForTimeout(100);
s = await refShift();
ok(s.x < -60 && s.y < -60 && Math.abs(s.x - s.y) <= 12, "→ y ↓ a la vez: diagonal: " + JSON.stringify(s));

await markRef();
await hold("ArrowLeft", 300);
await page.waitForTimeout(100);
const plain = (await refShift()).x;
await markRef();
await page.keyboard.down("Shift");
await hold("ArrowLeft", 300);
await page.keyboard.up("Shift");
await page.waitForTimeout(100);
const fast = (await refShift()).x;
ok(fast > plain * 2.2, "con Mayús, más rápido: " + JSON.stringify({ plain, fast }));

/* Contra el borde norte del mundo: se para y no rebota al soltar */
await view(80, 0, 5);
await page.mouse.move(box.x + P.x, box.y + P.y);
await hold("ArrowUp", 800);
await page.waitForTimeout(100);
const top = () => page.evaluate(() => map.containerPointToLatLng([map.getSize().x / 2, 0]).lat);
const t1 = await top();
await page.waitForTimeout(300);
const t2 = await top();
ok(t1 <= 85.06 && Math.abs(t1 - t2) < 1e-6, "contra el borde norte la vista se queda dentro del mundo y quieta: " + JSON.stringify([t1, t2]));

/* Girado 90°: ↑ mueve la vista hacia arriba de la PANTALLA (el
   contenido baja), no hacia el norte */
await view(40, -3, 6);
await page.evaluate(() => map.setBearing(90));
await markRef();
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(400);
s = await refShift();
ok(Math.abs(s.y - 80) <= 2 && Math.abs(s.x) <= 2, "a 90°, ↑ desplaza 80 px hacia arriba de la pantalla: " + JSON.stringify(s));
await page.evaluate(() => map.setBearing(0));

/* ---------- 2. Lo señalado por el cursor sigue al cursor ---------- */
await view(40, -3, 6);
await page.mouse.move(box.x + P.x, box.y + P.y);
await hold("ArrowDown", 400);
await page.waitForTimeout(100);
const under = await page.evaluate(() => map.latLngToContainerPoint(coordsPending));
ok(Math.hypot(under.x - P.x, under.y - P.y) <= 2,
  "tras desplazar sin mover el ratón, las coordenadas son las del punto bajo el cursor: " + JSON.stringify(under));

/* ---------- 3. Zoom con Re/Av Pág ---------- */
await view(40, -3, 6);
await page.mouse.move(box.x + P.x, box.y + P.y);
await page.keyboard.press("PageUp");
await page.waitForTimeout(600);
ok(await page.evaluate(() => map.getZoom()) === 7, "un toque de Re Pág acerca exactamente un nivel");
await page.keyboard.press("PageDown");
await page.waitForTimeout(600);
ok(await page.evaluate(() => map.getZoom()) === 6, "y uno de Av Pág aleja uno");

const anchor = await page.evaluate(p => map.containerPointToLatLng([p.x, p.y]), P);
await page.keyboard.down("PageUp");
await page.waitForTimeout(350);
const zMid = await page.evaluate(() => map.getZoom());
ok(zMid > 6.3 && zMid !== Math.round(zMid), "manteniendo, el zoom sube de forma continua (fraccionario a medias): " + zMid);
await page.waitForTimeout(650);
await page.keyboard.up("PageUp");
await page.waitForTimeout(600);
const zEnd = await page.evaluate(() => map.getZoom());
ok(zEnd >= 8 && Number.isInteger(zEnd), "un segundo pulsada sube más de dos niveles y al soltar queda en uno entero: " + zEnd);
const ap = await page.evaluate(a => map.latLngToContainerPoint(a), anchor);
ok(Math.hypot(ap.x - P.x, ap.y - P.y) <= 3, "el punto bajo el cursor no se mueve: " + JSON.stringify(ap));

const zMin = await page.evaluate(() => { map.setZoom(map.getMinZoom(), { animate: false }); return map.getMinZoom(); });
await page.waitForTimeout(100);
await hold("PageDown", 300);
await page.waitForTimeout(600);
ok(await page.evaluate(() => map.getZoom()) === zMin, "en el zoom mínimo, Av Pág no baja de él");

/* ---------- 4. Con el foco en el buscador no se toca el mapa ---------- */
await view(40, -3, 6);
await markRef();
await page.click("#search-box");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("PageUp");
await page.waitForTimeout(400);
s = await refShift();
ok(Math.abs(s.x) < 1 && Math.abs(s.y) < 1 && await page.evaluate(() => map.getZoom()) === 6,
  "flechas y Re Pág en el buscador no mueven el mapa: " + JSON.stringify(s));

/* ---------- 5. Chuleta: mover un círculo ya no pide Ctrl ---------- */
const rows = await page.evaluate(() => [...document.querySelectorAll("#sh-tab-view td:first-child")].map(td => td.textContent));
ok(!rows.some(r => /Ctrl \+ arrastrar/.test(r) && /c[ií]rculo/.test(r)), "ninguna fila pide Ctrl + arrastrar un círculo");
ok(rows.some(r => /círculo de medición/.test(r) && /diálogo de propiedades abierto/.test(r)),
  "y la fila del círculo dice que basta con su diálogo abierto");

/* ---------- 6. Rueda: el mismo zoom continuo ---------- */
await view(40, -3, 6);
await page.mouse.move(box.x + P.x, box.y + P.y);
const wAnchor = await page.evaluate(p => map.containerPointToLatLng([p.x, p.y]), P);
await page.mouse.wheel(0, -100);
await page.waitForTimeout(80);
const wMid = await page.evaluate(() => map.getZoom());
ok(wMid > 6 && wMid < 7, "una muesca: a los 80 ms el zoom va a medias, fraccionario (no salta): " + wMid);
await page.waitForTimeout(600);
ok(await page.evaluate(() => map.getZoom()) === 7, "y se asienta exactamente un nivel más arriba");
const wp = await page.evaluate(a => map.latLngToContainerPoint(a), wAnchor);
ok(Math.hypot(wp.x - P.x, wp.y - P.y) <= 2, "el punto bajo el cursor no se mueve: " + JSON.stringify(wp));

await view(40, -3, 6);
for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(50); }
await page.waitForTimeout(700);
ok(await page.evaluate(() => map.getZoom()) === 9, "tres muescas seguidas, tres niveles");

await view(40, -3, 6);
for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -10); await page.waitForTimeout(16); }
await page.waitForTimeout(800);
ok(await page.evaluate(() => map.getZoom()) === 7, "deltas pequeños (panel táctil) que suman medio nivel: al entero siguiente");

await view(40, -3, 6);
await page.mouse.wheel(0, 100);
await page.waitForTimeout(700);
ok(await page.evaluate(() => map.getZoom()) === 5, "hacia abajo aleja un nivel");

const prevented = await page.evaluate(p => {
  const r = map.getContainer().getBoundingClientRect();
  const ev = new WheelEvent("wheel", { deltaY: -4, ctrlKey: true, cancelable: true, bubbles: true,
                                       clientX: r.left + p.x, clientY: r.top + p.y });
  map.getContainer().dispatchEvent(ev);
  return ev.defaultPrevented;
}, P);
ok(prevented, "Ctrl+rueda (pellizco del panel táctil) se queda en el mapa: sin ampliar la página");
await page.waitForTimeout(600);

await view(40, -3, 6);
const bb = await page.evaluate(() => { const r = document.querySelector(".base-box").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.mouse.move(bb.x, bb.y);
await page.mouse.wheel(0, -100);
await page.waitForTimeout(600);
ok(await page.evaluate(() => map.getZoom()) === 6, "la rueda sobre un control no hace zoom");

/* ---------- 7. El foco se queda en el visor ----------
   Clicar un marcador le daba el foco a su icono (tabindex de Leaflet),
   y el siguiente guardado del árbol (reorderPaintOrder reengancha los
   iconos) lo tiraba al <body>: Re Pág movía el cursor del ÁRBOL y R no
   hacía nada. La ruta que se está creando abría su diálogo con el foco
   dentro al segundo clic. Las dos cosas FALLAN sin el arreglo.      */
await view(40, -3, 8);
const pins = await page.evaluate(() => {
  const ul = ensureRootUl();
  const out = [];
  for (const [n, ll] of [["Pin foco A", [40, -3]], ["Pin foco B", [40.2, -3.4]]]) {
    const mk = L.marker(ll).addTo(rootGroup);
    ul.appendChild(makeNode({ name: n, layer: mk, checked: true }));
    const p = map.latLngToContainerPoint(ll);
    out.push({ x: p.x, y: p.y - 20 });
  }
  return out;
});
await page.mouse.click(box.x + pins[0].x, box.y + pins[0].y);
await page.waitForTimeout(200);
ok(await page.evaluate(() => document.activeElement === map.getContainer()),
  "clicar un marcador deja el foco en el visor, no en su icono: " + await page.evaluate(() => document.activeElement.className));
ok(await page.evaluate(() => selCursor && selCursor._name) === "Pin foco A", "y aun así va a su nodo en el árbol");
await page.evaluate(() => { scheduleSave(); });
await page.waitForTimeout(150);
await page.keyboard.press("PageUp");
await page.waitForTimeout(600);
ok(await page.evaluate(() => map.getZoom()) === 9 && await page.evaluate(() => selCursor._name) === "Pin foco A",
  "tras un guardado del árbol, Re Pág sigue siendo zoom del visor (no mueve el cursor del árbol)");
await page.evaluate(() => map.setBearing(30));
await page.keyboard.press("r");
ok(await page.evaluate(() => map.getBearing()) === 0, "y R sigue poniendo el norte arriba");

await page.focus(".leaflet-marker-icon");
await page.evaluate(() => { reorderPaintOrder(); });
ok(await page.evaluate(() => document.activeElement.classList.contains("leaflet-marker-icon")),
  "un marcador enfocado con Tab conserva el foco cuando se reordena el pintado");

await view(40, -3, 8);
await page.evaluate(() => setTool("route"));
await page.mouse.click(box.x + 200, box.y + 300);
await page.waitForTimeout(300);
await page.mouse.click(box.x + 400, box.y + 320);
await page.waitForTimeout(300);
ok(await page.evaluate(() => !styleDialog.hidden), "al segundo punto la ruta abre su diálogo de propiedades");
ok(await page.evaluate(() => document.activeElement === map.getContainer()),
  "pero el foco sigue en el visor: " + await page.evaluate(() => document.activeElement.id || document.activeElement.className));
await page.keyboard.press("PageUp");
await page.waitForTimeout(600);
ok(await page.evaluate(() => map.getZoom()) === 9, "y Re Pág hace zoom a mitad de la ruta");
await page.keyboard.press("Escape");
await page.evaluate(() => { if (!styleDialog.hidden) closeStyleDialog(false); setTool(null); });

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
