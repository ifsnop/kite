/* Importar un GPX, de punta a punta, con el analizador de XML real del
   navegador (tests/gpxtest.js usa el de xmldom, que no tiene
   querySelector, y por tanto no pasa por `parseKmlDocument`).

   Lo que se mira es lo que ve el usuario: la carpeta con el nombre del
   archivo, un nodo por waypoint, ruta y track NOMBRADO por su <name>
   sin que aparezca el selector de propiedad-nombre, la altitud y los
   tiempos en lo guardado, la pregunta de las etiquetas tipo HTML (la
   <desc> del waypoint de ejemplo las trae) y el fallo limpio de lo que
   no es un GPX.                                                        */
import fs from "node:fs";
import path from "node:path";
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER GPX IMPORT TESTS OK");
const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "fixtures");
const GPX = fs.readFileSync(path.join(FIXTURES, "ruta-sierra.gpx"), "utf8");

const browser = await launch();
const srv = await serve(READABLE, 8948);
const { ctx, page, errors } = await openApp(browser, srv.url);

/* La importación se lanza SIN esperarla: se queda en la pregunta de las etiquetas HTML */
await page.evaluate(t => { window.__imp = handleDroppedFiles([new File([t], "ruta-sierra.gpx")]); }, GPX);
await page.waitForFunction(() => !document.getElementById("kml-tags-picker").hidden);
const intro = await page.evaluate(() => document.getElementById("ktp-intro").textContent);
ok(intro.includes("ruta-sierra.gpx"), "la pregunta de las etiquetas HTML nombra el archivo: " + intro.slice(0, 80));
await page.evaluate(() => document.getElementById("ktp-accept").click());
await page.evaluate(() => window.__imp);
ok(await page.evaluate(() => document.getElementById("geojson-name-picker").hidden),
  "no sale el selector de propiedad-nombre: el nombre de un GPX es su <name>");

const tree = await page.evaluate(async () => {
  const file = [...document.querySelectorAll("#tree li")].find(x => x._name === "ruta-sierra.gpx");
  if (!file) return null;
  await ensureMaterialized(file);
  const kids = [...nodeUl(file).children].filter(x => x._name !== undefined);
  const recs = serializeNode(file)[0].children;
  return {
    isFile: file.classList.contains("file"),
    names: kids.map(k => k._name),
    geoms: recs.map(r => r.geo.features[0].geometry.type),
    first: recs[0].geo.features[0],
    track: recs[3].geo.features[0],
    summary: document.getElementById("nav-msg").textContent
  };
});
ok(tree && tree.isFile, "el GPX entra como un archivo del árbol, con envoltorio");
ok(JSON.stringify(tree.names) === JSON.stringify(["Cumbre & mirador", "Refugio", "Variante por el collado", "Subida y bajada"]),
  "un nodo por elemento, con su <name>: " + JSON.stringify(tree.names));
ok(JSON.stringify(tree.geoms) === JSON.stringify(["Point", "Point", "LineString", "MultiLineString"]), "tipos de geometría: " + tree.geoms);
ok(tree.first.geometry.coordinates[2] === 1342.5, "la altitud (<ele>) se guarda como z: " + tree.first.geometry.coordinates);
ok(tree.first.properties.desc === "Vista completa del valle", "con «Eliminarlas» la descripción queda sin etiquetas: " + tree.first.properties.desc);
ok(tree.first.properties.time === "2026-09-12T08:15:00Z", "el tiempo del waypoint");
ok(Array.isArray(tree.track.properties.coordTimes) && tree.track.properties.coordTimes.length === 2, "los tiempos del track, uno por segmento");
ok(/4 elemento\(s\) cargado\(s\)/.test(tree.summary), "el resumen dice cuántos entraron: " + tree.summary);

/* No es un GPX: error claro y sin nodo a medias */
const before = await page.evaluate(() => document.querySelectorAll("#tree li").length);
await page.evaluate(() => handleDroppedFiles([new File(['<?xml version="1.0"?><otro/>'], "raro.gpx")]));
const msg = await page.evaluate(() => document.getElementById("nav-msg").textContent);
ok(/raro\.gpx/.test(msg) && /no es un archivo GPX/.test(msg), "un XML que no es GPX: aviso con el motivo: " + msg);
await page.evaluate(() => handleDroppedFiles([new File(["esto no es xml <<<"], "roto.gpx")]));
const msg2 = await page.evaluate(() => document.getElementById("nav-msg").textContent);
ok(/roto\.gpx/.test(msg2) && /XML no v/.test(msg2), "un archivo que ni es XML: aviso del analizador: " + msg2);
ok(await page.evaluate(() => document.querySelectorAll("#tree li").length) === before, "ninguno de los dos deja un nodo a medias");

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");
await ctx.close(); await browser.close();
srv.close();
done();
