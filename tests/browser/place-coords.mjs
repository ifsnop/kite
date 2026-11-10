/* Unas coordenadas escritas en el buscador de lugares (40-panel-actions.js,
   runPlaceSearch + parsePlaceCoordinates de 43-points-editor.js): si el
   formato se reconoce, se crea un marcador en «Lugares» (llamado como lo
   escrito), el mapa va allí, centrado en él, a zoom 17, SIN preguntar a
   Nominatim (ni una petición) y sin dejar la lista de resultados; si no, se
   busca como un lugar, igual que siempre. Con el teclado y con el botón; con
   una búsqueda de lugar a medias, la respuesta tardía no repinta.             */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER PLACE COORDINATES TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8962);
const { ctx, page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

/* Nominatim falso: cuenta las peticiones y deja una pendiente a voluntad */
const asked = [];
let gate = null;
await page.route("https://nominatim.openstreetmap.org/**", async route => {
  const q = new URL(route.request().url()).searchParams.get("q");
  asked.push(q);
  if (gate) await gate;
  await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify([{ display_name: "Madrid, España", name: "Madrid", lat: "40.4168", lon: "-3.7038", boundingbox: ["40.3", "40.6", "-3.9", "-3.5"] }]) });
});

const view = () => page.evaluate(() => ({ z: map.getZoom(), lat: map.getCenter().lat, lng: map.getCenter().lng,
  results: !document.getElementById("place-results").hidden, list: document.querySelectorAll("#place-list li").length,
  markers: [...document.querySelectorAll("#tree li")].filter(x => x._name !== undefined && !x._isContainer).length,
  box: document.getElementById("place-box").value }));
/* Los hijos de la sección «Lugares»: nombre y posición del marcador */
const places = () => page.evaluate(() => {
  const sec = [...document.querySelectorAll("#tree li")].find(x => x._isContainer && x._name === tr("Lugares"));
  return sec ? [...sec.querySelector(":scope > ul").children].map(x => { const ll = x.querySelector("input[type=checkbox]")._layer.getLatLng(); return { name: x._name, lat: ll.lat, lng: ll.lng }; }) : [];
});
const search = async (text, how = "enter") => {
  await page.fill("#place-box", text);
  if (how === "enter") await page.press("#place-box", "Enter"); else await page.click("#place-btn");
  await page.waitForTimeout(250); /* lo que dura el zoom animado */
};
const settled = async () => { for (let i = 0; i < 30; i++) { const z = await page.evaluate(() => map._animatingZoom || map._panAnim && map._panAnim._inProgress); if (!z) break; await page.waitForTimeout(100); } };

await page.evaluate(() => map.setView([30, 10], 4, { animate: false }));

/* ---- Decimales, con Intro ---- */
await search("40.4168, -3.7038");
await settled();
let v = await view();
ok(v.z === 17 && Math.abs(v.lat - 40.4168) < 1e-3 && Math.abs(v.lng + 3.7038) < 1e-3, "40.4168, -3.7038 lleva el mapa allí, a zoom 17: " + JSON.stringify(v));
ok(asked.length === 0, "sin ninguna petición a Nominatim: " + JSON.stringify(asked));
ok(!v.results && v.list === 0 && v.markers === 1, "sin lista de resultados y con UN marcador: " + JSON.stringify(v));
let pl = await places();
ok(pl.length === 1 && pl[0].name === "40.4168, -3.7038" && Math.abs(pl[0].lat - 40.4168) < 1e-6 && Math.abs(pl[0].lng + 3.7038) < 1e-6,
  "el marcador está en «Lugares», se llama como lo escrito y en su punto exacto: " + JSON.stringify(pl));
ok(Math.abs(v.lat - pl[0].lat) < 1e-4 && Math.abs(v.lng - pl[0].lng) < 1e-4, "la vista está centrada en el marcador");
ok(v.box === "", "la caja se vacía, como al elegir un resultado");

/* ---- GMS con letras, con el botón; desde otra vista ---- */
await page.evaluate(() => map.setView([0, 0], 3, { animate: false }));
await search("40°25'0.5\"N 3°42'13\"W", "button");
await settled();
v = await view();
ok(v.z === 17 && Math.abs(v.lat - 40.41681) < 1e-3 && Math.abs(v.lng + 3.70361) < 1e-3, "GMS con N y W, con el botón: " + JSON.stringify(v));
ok(asked.length === 0, "tampoco pide nada");
pl = await places();
ok(pl.length === 2 && pl[1].name === "40°25'0.5\"N 3°42'13\"W" && Math.abs(pl[1].lat - 40.41681) < 1e-3, "y suma un segundo marcador: " + JSON.stringify(pl[1]));

/* ---- Coma decimal y longitud primero con letras ---- */
await search("40,4168; -3,7038");
await settled();
ok(Math.abs((await view()).lat - 40.4168) < 1e-3, "coma decimal con punto y coma");
await page.evaluate(() => map.setView([0, 0], 3, { animate: false }));
await search("3.7038 W 40.4168 N");
await settled();
v = await view();
ok(Math.abs(v.lat - 40.4168) < 1e-3 && Math.abs(v.lng + 3.7038) < 1e-3, "con letras manda la letra: la longitud primero: " + JSON.stringify(v));

/* ---- Un lugar sigue yendo a Nominatim ---- */
await page.evaluate(() => map.setView([0, 0], 3, { animate: false }));
await search("Madrid");
v = await view();
ok(asked.length === 1 && asked[0] === "Madrid", "«Madrid» se busca como siempre: " + JSON.stringify(asked));
ok(v.results && v.list === 1 && v.z === 3, "con su lista de resultados y sin mover la vista: " + JSON.stringify(v));
ok((await places()).length === 4, "y sin crear ningún marcador hasta elegir uno (las 4 búsquedas con coordenadas dejaron 4)");
/* Lo que parece coordenadas pero no lo es (fuera de rango) también */
await search("120, 3");
ok(asked.length === 2 && asked[1] === "120, 3", "«120, 3» (latitud imposible) va a Nominatim: " + JSON.stringify(asked));

/* ---- Una búsqueda de lugar a medias y luego unas coordenadas ---- */
let release;
gate = new Promise(r => { release = r; });
await page.fill("#place-box", "Valencia");
await page.press("#place-box", "Enter");
await page.waitForTimeout(150);
ok((await view()).results, "la búsqueda de «Valencia» está en curso (lista abierta con «Buscando…»)");
await page.evaluate(() => map.setView([0, 0], 3, { animate: false }));
await search("39.47, -0.38");
await settled();
v = await view();
ok(!v.results && v.z === 17 && Math.abs(v.lat - 39.47) < 1e-3, "las coordenadas ganan: cierran la lista y van allí: " + JSON.stringify(v));
release(); gate = null;
await page.waitForTimeout(400);
v = await view();
ok(!v.results && v.list === 0, "y la respuesta tardía de «Valencia» no vuelve a pintar la lista: " + JSON.stringify(v));

/* ---- Vacío ---- */
await page.evaluate(() => { document.getElementById("nav-msg").textContent = ""; });
await page.fill("#place-box", "   ");
await page.press("#place-box", "Enter");
ok(/Escriba un lugar o unas coordenadas/.test(await page.evaluate(() => document.getElementById("nav-msg").textContent)), "caja vacía: el aviso lo dice");

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");
await ctx.close(); await browser.close();
srv.close();
done();
