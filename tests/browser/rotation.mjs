/* Rotación del mapa (experimento, leaflet-rotate), con ratón y teclado
   DE VERDAD sobre la aplicación entera.

   1) La brújula está ENCIMA del panel de mapas base; arrastrarla gira el
      mapa en el sentido del arrastre, libre, y la aguja apunta al norte
      de la pantalla. Un clic sin arrastre y la tecla R (con el foco en el
      visor) vuelven a poner el norte arriba. Mide lo mismo que el botón
      de capas. Con el botón central se gira alrededor del punto pulsado,
      con el cursor de rosa de los vientos; el izquierdo sigue arrastrando.
   2) Las etiquetas (tooltip de un polígono, de una medición) siguen
      horizontales con el mapa girado.
   3) La detección de capas bajo el cursor (`layersAtPoint`) encuentra un
      polígono estrecho y diagonal a 45° — el caso que la criba de dos
      esquinas dejaba fuera.
   4) El modo alturas no se puede activar con el mapa rotado, y girar el
      mapa lo apaga.
   5) El PNG se genera con el mapa rotado, y la brújula sale en la
      captura solo cuando está girado.
   6) «Una sola Tierra»: a zoom mínimo y 45° no asoma fondo por las
      esquinas, ningún mapa base pide teselas fuera del mundo (antes:
      400 y aviso falso de «no responde»), y arrastrar contra el borde
      no hace saltar la vista.
   7) La iluminación día/noche sombrea según la posición del sol
      también con el mapa girado (lectura de píxeles del lienzo WebGL). */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER ROTATION TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8930);
const { page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });
const badTiles = [];
page.on("response", r => { if (r.status() === 400) badTiles.push(r.url()); });

const bearing = () => page.evaluate(() => map.getBearing());
const center = sel => page.evaluate(s => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, sel);

/* ---------- 1. Brújula: posición, arrastre, clic y R ---------- */
const corner = await page.evaluate(() =>
  [...document.querySelector(".leaflet-top.leaflet-right").children].map(c => c.className.split(" ")[0]));
ok(corner[0] === "compass-box" && corner[1] === "base-box",
  "la brújula va encima del panel de mapas base: " + JSON.stringify(corner));
ok(await bearing() === 0, "arranca con el norte arriba");

const cc = await center(".compass-btn");
await page.mouse.move(cc.x, cc.y - 20);
await page.mouse.down();
for (let k = 1; k <= 10; k++) {
  const a = k * 6 * Math.PI / 180; /* 60° en sentido horario, en pasos de 6° */
  await page.mouse.move(cc.x + 20 * Math.sin(a), cc.y - 20 * Math.cos(a));
  await page.waitForTimeout(30);
}
await page.mouse.up();
const afterDrag = await page.evaluate(() => {
  const c = map.getCenter();
  const n = map.latLngToContainerPoint([c.lat + 0.5, c.lng]), o = map.latLngToContainerPoint(c);
  return {
    bearing: map.getBearing(),
    northOnScreen: (Math.atan2(n.x - o.x, o.y - n.y) * 180 / Math.PI + 360) % 360,
    needle: document.querySelector(".compass-needle").getAttribute("transform"),
    rotatedClass: document.querySelector(".compass-box").classList.contains("rotated")
  };
});
ok(Math.abs(afterDrag.bearing - 60) < 2, "arrastrar la brújula 60° en sentido horario gira el mapa 60°: " + afterDrag.bearing);
ok(Math.abs(afterDrag.northOnScreen - afterDrag.bearing) < 1,
  "el norte queda en pantalla en la dirección del giro: " + afterDrag.northOnScreen);
ok(afterDrag.needle === `rotate(${afterDrag.bearing} 20 20)`, "y la aguja lo señala: " + afterDrag.needle);
ok(afterDrag.rotatedClass, "la brújula se resalta con el mapa girado");
ok(await page.evaluate(() => !document.querySelector(".leaflet-control-rotate")),
  "sin el control propio del plugin");

/* Clic sin arrastre: norte arriba */
await page.click(".compass-btn");
ok(await bearing() === 0, "un clic en la brújula pone el norte arriba");
ok(await page.evaluate(() => !document.querySelector(".compass-box").classList.contains("rotated")),
  "y la brújula vuelve a su aspecto atenuado");

/* R con el foco en el visor */
await page.evaluate(() => map.setBearing(33));
await page.mouse.click(900, 600);
await page.keyboard.press("r");
ok(await bearing() === 0, "R con el foco en el visor pone el norte arriba");
/* …pero escribir una r en un campo de texto no toca el mapa */
await page.evaluate(() => map.setBearing(33));
await page.click("#search-box");
await page.keyboard.type("r");
ok(await bearing() === 33, "una r escrita en el buscador no gira nada");
await page.evaluate(() => { document.getElementById("search-box").value = ""; });

/* Brújula y botón de capas, del mismo tamaño; la brújula sin la «N»
   (apenas se veía y confundía) */
const sizes = await page.evaluate(() => [".compass-box", ".base-box"].map(s => {
  const r = document.querySelector(s).getBoundingClientRect();
  return [r.width, r.height];
}));
ok(JSON.stringify(sizes[0]) === JSON.stringify(sizes[1]),
  "la brújula y el botón de capas miden lo mismo: " + JSON.stringify(sizes));
ok(await page.evaluate(() => !document.querySelector(".compass-btn text")), "la brújula no lleva texto");

/* ---------- 1b. Botón central: gira alrededor del punto pulsado ---------- */
await page.evaluate(() => { map.setBearing(0); map.setView([40, -3], 6, { animate: false }); });
const mapBox = await page.evaluate(() => {
  const r = map.getContainer().getBoundingClientRect();
  return { x: r.left, y: r.top };
});
const PIV = { x: 300, y: 250 }; /* en el contenedor, lejos del centro */
const pivLL = await page.evaluate(p => map.containerPointToLatLng([p.x, p.y]), PIV);
await page.mouse.move(mapBox.x + PIV.x, mapBox.y + PIV.y);
await page.mouse.down({ button: "middle" });
let midCursor = null;
for (let k = 1; k <= 6; k++) {
  await page.mouse.move(mapBox.x + PIV.x + k * 20, mapBox.y + PIV.y + k * 4);
  await page.waitForTimeout(60);
  if (k === 3) midCursor = await page.evaluate(() => getComputedStyle(document.querySelector(".leaflet-tile-loaded, .leaflet-container")).cursor);
}
await page.mouse.up({ button: "middle" });
const mid = await page.evaluate(ll => ({
  bearing: map.getBearing(), pt: map.latLngToContainerPoint(ll),
  rotating: map.getContainer().classList.contains("map-rotating")
}), pivLL);
ok(Math.abs(mid.bearing - 60) < 1e-6,
  "120 px a la derecha con el botón central giran 60° en sentido horario (no arrastran el mapa): " + mid.bearing);
ok(Math.hypot(mid.pt.x - PIV.x, mid.pt.y - PIV.y) < 1.5,
  "el punto pulsado se queda bajo el cursor (centro del giro): " + JSON.stringify(mid.pt));
ok(/^url\("data:image\/svg\+xml/.test(midCursor || ""),
  "mientras se gira, el cursor es la rosa de los vientos: " + (midCursor || "").slice(0, 40));
ok(!mid.rotating, "al soltar se quita el cursor de giro");
const beforeClick = await page.evaluate(() => [map.getBearing(), map.getCenter()]);
await page.mouse.down({ button: "middle" });
await page.mouse.up({ button: "middle" });
ok(JSON.stringify(beforeClick) === JSON.stringify(await page.evaluate(() => [map.getBearing(), map.getCenter()])),
  "un clic central sin mover ni gira ni desplaza");
/* El izquierdo sigue arrastrando sin girar */
await page.mouse.move(mapBox.x + 500, mapBox.y + 400);
await page.mouse.down();
await page.mouse.move(mapBox.x + 560, mapBox.y + 400, { steps: 4 });
await page.mouse.up();
ok(Math.abs(await bearing() - 60) < 1e-6, "el botón izquierdo arrastra y no gira");
await page.evaluate(() => map.setBearing(0));

/* ---------- 2 y 3. Etiquetas horizontales y detección de capas ---------- */
const setup = await page.evaluate(() => {
  map.setBearing(0);
  map.setView([40.42, -3.70], 13, { animate: false });
  const ul = ensureRootUl();
  /* Estrecho y diagonal: a 45° su caja geográfica en pantalla es un
     rombo cuyos extremos NO son las esquinas noroeste/sureste.        */
  const pol = L.polygon([[40.40, -3.73], [40.401, -3.731], [40.44, -3.67], [40.439, -3.669]]).addTo(rootGroup);
  const li = makeNode({ name: "Diagonal", layer: pol, style: normalizePathStyle({}) });
  ul.appendChild(li);
  li._style.textAlways = true;
  applyPolygonStyle(li);
  const c = buildMeasurement("circle", L.latLng(40.41, -3.71), L.latLng(40.41, -3.70));
  finalizeMeasurement(c);
  map.setBearing(45);
  return true;
});
await page.waitForTimeout(300);
const tips = await page.evaluate(() => [...document.querySelectorAll(".leaflet-tooltip")]
  .map(t => getComputedStyle(t).transform));
ok(tips.length >= 2 && tips.every(t => {
  if (t === "none") return true;
  const m = t.match(/matrix\(([^)]+)\)/);
  if (!m) return false;
  const [a, b] = m[1].split(",").map(Number);
  return Math.abs(b) < 1e-6 && a > 0;
}), "con el mapa a 45° las etiquetas siguen horizontales: " + JSON.stringify(tips));

const hit = await page.evaluate(() => {
  /* Un punto del polígono, cerca de un extremo: el que la criba con solo
     noroeste/sureste dejaba fuera de la caja en pantalla.             */
  const ll = L.latLng(40.4385, -3.6695);
  return layersAtPoint(ll, map.latLngToContainerPoint(ll)).map(li => li._name);
});
ok(hit.includes("Diagonal"), "a 45°, un clic sobre el polígono diagonal lo encuentra: " + JSON.stringify(hit));

/* ---------- 4. Modo alturas ---------- */
const alt = await page.evaluate(async () => {
  await setAltitudeMode(true);
  const tried = demOn;
  const disabled = demButton.classList.contains("disabled") && demButton.getAttribute("aria-disabled") === "true";
  map.setBearing(0);
  await setAltitudeMode(true);
  const onNorthUp = demOn;
  map.setBearing(20); /* girar con el modo activo lo apaga */
  return { tried, disabled, onNorthUp, afterRotate: demOn };
});
ok(!alt.tried, "con el mapa rotado, el modo alturas no se activa");
ok(alt.disabled, "y su botón se ve deshabilitado");
ok(alt.onNorthUp, "con el norte arriba sí se activa");
ok(!alt.afterRotate, "y girar el mapa lo apaga");
const ctxDisabled = await page.evaluate(() => {
  openCtxMenu(map.getCenter(), 600, 400, []);
  const b = [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")].find(x => /Modo elevación/.test(x.textContent));
  const r = { disabled: b.disabled, title: b.title };
  closeCtxMenu();
  return r;
});
ok(ctxDisabled.disabled && /rotado/.test(ctxDisabled.title),
  "y en el menú contextual aparece deshabilitado, con el motivo: " + JSON.stringify(ctxDisabled));

/* ---------- 5. PNG: la brújula sale solo con el mapa girado ---------- */
const png = await page.evaluate(async () => {
  const seen = [];
  const real = window.html2canvas;
  window.html2canvas = async (el, opts) => {
    seen.push(getComputedStyle(document.querySelector(".compass-box")).display !== "none");
    return real(el, opts);
  };
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (!this.download) realClick.call(this); };
  await exportMapPng();
  map.setBearing(0);
  await exportMapPng();
  window.html2canvas = real;
  HTMLAnchorElement.prototype.click = realClick;
  return seen;
});
ok(png[0] === true, "con el mapa girado, la brújula entra en el PNG");
ok(png[1] === false, "con el norte arriba, no");

/* ---------- 6. Bordes del mundo ---------- */
badTiles.length = 0;
const world = await page.evaluate(async () => {
  map.setView([20, 0], map.getMinZoom(), { animate: false });
  const minNorthUp = map.getMinZoom();
  map.setBearing(45);
  await new Promise(r => setTimeout(r, 1500));
  const s = map.getSize();
  let outside = 0;
  for (const [x, y] of [[0, 0], [s.x, 0], [s.x, s.y], [0, s.y]]) {
    const ll = map.containerPointToLatLng([x, y]);
    if (Math.abs(ll.lng) > 180.5 || Math.abs(ll.lat) > 85.6) outside++;
  }
  return { minNorthUp, min45: map.getMinZoom(), zoom: map.getZoom(), outside };
});
ok(world.min45 > world.minNorthUp, "a 45° el suelo de zoom sube (la vista girada necesita más mundo): "
  + JSON.stringify(world));
ok(world.outside === 0, "y ninguna esquina de la vista cae fuera del mundo: " + JSON.stringify(world));
ok(badTiles.length === 0, "ningún mapa base pide teselas fuera del mundo: " + badTiles.slice(0, 3).join(" "));

await page.evaluate(() => map.setView([75, 170], 5, { animate: false }));
const before = await page.evaluate(() => map.getCenter());
const rad = 45 * Math.PI / 180;
await page.mouse.move(900, 450);
await page.mouse.down();
for (let k = 1; k <= 25; k++) {
  await page.mouse.move(900 - Math.cos(rad) * k * 25, 450 - Math.sin(rad) * k * 25);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(800);
const after = await page.evaluate(() => map.getCenter());
ok(Math.abs(after.lat - before.lat) < 5 && Math.abs(after.lng - before.lng) < 15,
  "arrastrar contra el borde del mundo con el mapa girado no hace saltar la vista: "
  + JSON.stringify({ before, after }));

/* ---------- 7. Día/noche con el mapa girado ---------- */
const dn = await page.evaluate(async () => {
  map.setBearing(0);
  map.setView([20, 0], 3, { animate: false });
  map.setBearing(70);
  toggleDayNight();
  await new Promise(r => setTimeout(r, 500));
  dnRender();
  const sub = subsolarPoint();
  const s = map.getSize();
  const dpr = window.devicePixelRatio || 1;
  const gl = dnGl;
  /* Un punto de día claro y otro de noche cerrada, buscados en una
     rejilla de la propia vista con la posición REAL del sol.          */
  let day = null, night = null;
  for (let x = 40; x < s.x; x += 40) for (let y = 40; y < s.y; y += 40) {
    const ll = map.containerPointToLatLng([x, y]);
    const el = solarElevationDeg(ll.lat, ll.lng, sub.lat, sub.lng);
    if (!day && el > 20) day = [x, y];
    if (!night && el < -30) night = [x, y];
  }
  const alpha = ([x, y]) => {
    const px = new Uint8Array(4);
    gl.readPixels(Math.round(x * dpr), Math.round((s.y - y) * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px[3];
  };
  const r = { day: day && alpha(day), night: night && alpha(night), found: !!(day && night) };
  toggleDayNight();
  return r;
});
ok(dn.found, "hay un punto de día y otro de noche en la vista: " + JSON.stringify(dn));
ok(dn.found && dn.day < 20 && dn.night > 150,
  "a 70°, el sombreado cae donde es de noche de verdad, no donde lo estaría sin girar: " + JSON.stringify(dn));

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
