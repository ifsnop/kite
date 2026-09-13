/* Una sola Tierra: ni copias del mundo en horizontal, ni arrastre ni
   zoom más allá de ella.

   Va en navegador porque no hay función pura que probar: lo que decide
   el resultado es Leaflet —qué teselas pide, hasta dónde deja arrastrar
   y qué zoom permite— y eso solo se puede mirar con un mapa de verdad
   montado y con su tamaño real.                                       */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER ONE WORLD TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8847);
const { page, errors } = await openApp(browser, srv.url);

const espera = () => page.waitForTimeout(350);

/* ---------- Las teselas no se repiten ---------- */
const teselas = await page.evaluate(async () => {
  const capa = baseState.get("osm").layer;
  const urls = [];
  capa.on("tileloadstart", e => urls.push(e.tile.src));
  map.setView([0, 0], 2);
  await new Promise(r => setTimeout(r, 700));
  /* La X de la tesela: fuera de [0, 2^z-1] es una copia del mundo */
  const xs = urls.map(u => (u.match(/\/(\d+)\/(-?\d+)\/(-?\d+)\.png$/) || [])[2])
    .filter(x => x !== undefined).map(Number);
  const max = 2 ** 2 - 1;
  return { noWrap: capa.options.noWrap, pedidas: xs.length,
    fuera: xs.filter(x => x < 0 || x > max).length, rango: [Math.min(...xs), Math.max(...xs)] };
});
ok(teselas.noWrap === true,
  "la capa base se crea con noWrap, sin repetirlo en cada definición: " + teselas.noWrap);
ok(teselas.pedidas > 0, "se piden teselas de verdad (si no, lo de abajo no probaría nada): " + teselas.pedidas);
ok(teselas.fuera === 0,
  `ninguna tesela fuera del mundo: ${teselas.fuera} de ${teselas.pedidas}, rango X ${teselas.rango}`);

/* ---------- El arrastre tiene tope ---------- */
const topes = await page.evaluate(() => {
  const r = {};
  r.bounds = map.options.maxBounds ? map.options.maxBounds.toBBoxString() : null;
  r.viscosidad = map.options.maxBoundsViscosity;
  map.setView([40, 900], 4);          /* muy al este, tres mundos más allá */
  r.este = map.getCenter().lng;
  map.setView([40, -900], 4);
  r.oeste = map.getCenter().lng;
  map.setView([85, 0], 3);            /* y por arriba, contra el borde Mercator */
  r.norte = map.getCenter().lat;
  return r;
});
ok(topes.bounds === "-180,-85.05112878,180,85.05112878",
  "el mundo se acota a la franja Mercator, no a ±90: " + topes.bounds);
ok(topes.viscosidad === 1, "y el borde no cede: viscosidad " + topes.viscosidad);
ok(topes.este <= 180 && topes.oeste >= -180,
  `pedir el centro tres mundos más allá queda dentro: ${topes.este} / ${topes.oeste}`);
ok(topes.norte < 85.05112878, "y por arriba tampoco se sale: " + topes.norte);

/* ---------- El zoom tiene suelo, y sigue al tamaño de la ventana ----------
   Los dos sentidos, no solo uno: `getBoundsZoom` acaba en
   `Math.max(this.getMinZoom(), …)`, así que preguntándole sin apartar
   el suelo anterior el número solo puede SUBIR, y tras agrandar la
   ventana y volver a encogerla el usuario se quedaba sin poder alejar.
   Es el fallo que tuvo esta función y por lo que se mide encogiendo
   DESPUÉS de agrandar.                                                */
const suelos = [];
for (const [w, h] of [[2400, 900], [600, 700], [1200, 800]]) {
  await page.setViewportSize({ width: w, height: h });
  await espera();
  suelos.push(await page.evaluate(() => ({
    /* El lado que MANDA es el mayor: el mundo es cuadrado y tiene que
       llenar la ventana por los dos. Con el panel del árbol quitando
       ancho, en una ventana estrecha manda el alto.                  */
    mapa: Math.max(map.getSize().x, map.getSize().y),
    tamano: [map.getSize().x, map.getSize().y],
    min: map.getMinZoom(),
    /* El mundo al zoom del suelo tiene que llenar la ventana, y al
       anterior no: eso ES la definición del suelo.                   */
    mundoAlSuelo: 256 * 2 ** map.getMinZoom(),
    mundoUnoMenos: 256 * 2 ** (map.getMinZoom() - 1)
  })));
}
for (const s of suelos) {
  ok(s.mundoAlSuelo >= s.mapa,
    `con el mapa a ${s.tamano} el mundo llena la vista en el zoom ${s.min} (${s.mundoAlSuelo} px)`);
  ok(s.mundoUnoMenos < s.mapa,
    `y no antes: en el ${s.min - 1} el mundo mediría ${s.mundoUnoMenos} px`);
}
ok(suelos[0].min > suelos[1].min,
  `el suelo BAJA al encoger la ventana, no solo sube: ${suelos[0].min} → ${suelos[1].min}`);

const alejar = await page.evaluate(() => {
  map.setZoom(0);   /* más lejos de lo permitido */
  return { pedido: 0, real: map.getZoom(), min: map.getMinZoom() };
});
ok(alejar.real === alejar.min,
  "pedir un zoom por debajo del suelo se queda en el suelo: " + JSON.stringify(alejar));

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
