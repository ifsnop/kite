/* Enlaces a la vista, de punta a punta: abrir `#map=…` (manda sobre la
   vista y los mapas guardados y se quita del historial), copiar el
   enlace desde «Copiar ▸ Enlace a esta vista» con el portapapeles real,
   abrirlo en otra pestaña, pegarlo en la misma (hashchange) y que una
   dirección manipulada no haga nada.                                    */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER VIEW LINK TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8950);
const { ctx, page, errors } = await openApp(browser, srv.url + "#map=9/40.5/-3.5/30&base=osm,pnoa",
  { permissions: ["clipboard-read", "clipboard-write"] });

const state = p => p.evaluate(() => ({
  lat: map.getCenter().lat, lng: map.getCenter().lng, zoom: map.getZoom(), bearing: map.getBearing(),
  on: [...baseState].filter(([, s]) => s.on).map(([id]) => id), hash: location.hash, href: location.href
}));
const near = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol;

/* ---- abrir un enlace ---- */
let s = await state(page);
ok(near(s.lat, 40.5) && near(s.lng, -3.5) && s.zoom === 9 && near(s.bearing, 30, 1e-6), "el enlace fija centro, zoom y giro: " + JSON.stringify(s));
ok(s.on.join() === "osm,pnoa", "y deja encendidos exactamente esos mapas: " + s.on);
ok(s.hash === "" && s.href === srv.url, "el ancla se quita de la dirección (recargar no lo repite): " + s.href);

/* ---- lo aplicado se guarda como vista y mapas del usuario ---- */
await page.waitForTimeout(1500); /* el guardado de la vista va con retardo (VIEW_SAVE_MS) */
await page.reload();
await waitAppReady(page);
s = await state(page);
ok(near(s.lat, 40.5) && s.zoom === 9 && s.on.join() === "osm,pnoa", "recargando sin ancla sigue donde se abrió: " + JSON.stringify(s));
ok(near(s.bearing, 0), "el giro NO se guarda: cada arranque sin enlace empieza con el norte arriba: " + s.bearing);

/* ---- copiar el enlace ---- */
await page.evaluate(() => { map.setView([41.1, -2.2], 7, { animate: false }); map.setBearing(75); });
const at = await page.evaluate(() => { const r = map.getContainer().getBoundingClientRect(); return { x: r.left + 600, y: r.top + 300 }; });
async function copyLink() {
  await page.mouse.click(at.x, at.y, { button: "right" });
  await page.evaluate(() => [...document.querySelectorAll("#map-ctxmenu .ctx-menu-item")].find(b => b.textContent === "Copiar ▸").click());
  await page.waitForSelector(".ctx-menu:not(#map-ctxmenu)");
  const leaves = await page.evaluate(() => [...document.querySelectorAll(".ctx-menu:not(#map-ctxmenu) .ctx-menu-item")].map(b => b.textContent));
  await page.evaluate(() => [...document.querySelectorAll(".ctx-menu:not(#map-ctxmenu) .ctx-menu-item")].find(b => b.textContent === "Enlace a esta vista").click());
  await page.waitForFunction(() => /Enlace a la vista copiado/.test(document.getElementById("nav-msg").textContent));
  return { leaves, link: await page.evaluate(() => navigator.clipboard.readText()), msg: await page.textContent("#nav-msg") };
}
const c1 = await copyLink();
ok(c1.leaves.join() === "Coordenadas,Enlace a esta vista", "«Copiar» ofrece coordenadas y enlace: " + c1.leaves);
ok(c1.link === srv.url + "#map=7/41.1/-2.2/75&base=osm,pnoa", "el enlace lleva la vista ENTERA (no el punto pulsado): " + c1.link);
ok(/portapapeles/.test(c1.msg), "y se avisa: " + c1.msg.slice(0, 80));

/* un mapa con dirección propia encendido no viaja, y se dice */
await page.evaluate(() => { baseState.get("custom").on = true; });
const c2 = await copyLink();
ok(!/custom/.test(c2.link) && c2.link === c1.link, "un mapa propio (Custom) no va en el enlace: " + c2.link);
ok(/no viajan/.test(c2.msg), "y el aviso lo explica: " + c2.msg.slice(0, 120));
await page.evaluate(() => { baseState.get("custom").on = false; });

/* ---- abrirlo en otra pestaña: manda sobre lo guardado ---- */
await page.waitForTimeout(1500); /* se guarda la vista actual (41.1, -2.2) */
const page2 = await ctx.newPage();
const errors2 = [];
page2.on("pageerror", e => errors2.push(e.message));
await page2.goto(c1.link.replace("/75&", "/120&").replace("&base=osm,pnoa", "&base=terrain"));
await waitAppReady(page2);
const s2 = await state(page2);
ok(near(s2.lat, 41.1) && near(s2.lng, -2.2) && s2.zoom === 7 && near(s2.bearing, 120, 1e-6), "en otra pestaña, centro, zoom y giro del enlace: " + JSON.stringify(s2));
ok(s2.on.join() === "terrain", "y SUS mapas, no los guardados (osm, pnoa): " + s2.on);
ok(s2.hash === "", "y también se quita el ancla");
await page2.close();

/* ---- pegar un enlace con la aplicación abierta (hashchange) ---- */
await page.evaluate(() => { location.hash = "#map=5/10/20&base=terrain"; });
await page.waitForFunction(() => Math.abs(map.getCenter().lat - 10) < 1e-3);
s = await state(page);
ok(near(s.lng, 20) && s.zoom === 5 && near(s.bearing, 0, 1e-6), "pegado en la misma pestaña: centro, zoom y norte arriba: " + JSON.stringify(s));
ok(s.on.join() === "terrain" && s.hash === "", "mapas del enlace y ancla quitada: " + JSON.stringify(s.on) + " " + s.hash);
/* sin `base`, los mapas se quedan como estaban */
await page.evaluate(() => { location.hash = "#map=6/12/22"; });
await page.waitForFunction(() => Math.abs(map.getCenter().lat - 12) < 1e-3);
ok((await state(page)).on.join() === "terrain", "un enlace sin `base` no toca los mapas encendidos");

/* ---- direcciones manipuladas ---- */
for (const malo of ["#map=abc", "#map=99/10/20", "#map=5/95/20", "#map=5/10/20/1e3", "#map=5/10"]) {
  const before = await state(page);
  await page.evaluate(h => { location.hash = h; }, malo);
  await page.waitForFunction(() => location.hash === "");
  const now = await state(page);
  ok(near(now.lat, before.lat) && near(now.lng, before.lng) && now.zoom === before.zoom && now.on.join() === before.on.join(), `«${malo}» no cambia nada: ` + JSON.stringify(now));
}
/* Un enlace válido con ids de mapa inventados o con marcado: se aplica y los ids se descartan, sin inyectar nada */
await page.evaluate(() => { location.hash = "#map=4/30/-20&base=terrain,<img src=x onerror=alert(1)>,custom"; });
await page.waitForFunction(() => Math.abs(map.getCenter().lat - 30) < 1e-3);
s = await state(page);
ok(s.on.join() === "terrain", "ids con marcado o propios se descartan y el resto se aplica: " + s.on);
ok(await page.evaluate(() => !document.querySelector("img[src=x]") && !document.querySelector("#tree script, #nav-msg img")), "y no se inyecta nada en la página");
/* un ancla que no es nuestra se deja como está */
await page.evaluate(() => { location.hash = "#otra"; });
await page.waitForTimeout(200);
ok(await page.evaluate(() => location.hash) === "#otra", "un ancla ajena no se toca");

ok(errors.length === 0 && errors2.length === 0, "sin errores de página: " + errors.concat(errors2).join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");
await ctx.close(); await browser.close();
srv.close();
done();
