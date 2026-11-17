/* La lista de mapas base (el botón de capas, arriba a la derecha del visor)
   ocupa buena parte del mapa y tapaba otros diálogos: se cierra al actuar
   fuera de ella.

   1) Un clic en el mapa, en el árbol, en un botón de la cabecera, o una
      tecla fuera, la cierran.
   2) Lo de dentro NO: una casilla, un deslizador, el botón de color de la
      primera fila y el propio selector de color (que cuelga del <body>),
      ni una tecla pulsada con el foco dentro.
   3) Escape la cierra, pero antes cierra lo que tenga encima (el selector
      de color); Tab y las teclas de modificador no la cierran.
   4) El botón de capas sigue alternando.
   5) The windows opened from the list are part of it (requested: cancelling
      «+ Añadir capa…» closed the list): typing in «Nueva capa base», its
      Cancel, its ×, Escape and «Añadir» leave the list open; so do the
      delete confirmation of a user layer and its Cancel.                */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER BASE PANEL CLOSE TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8975);
const { page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

const listOpen = () => page.evaluate(() => !baseControl._list.hidden);
const openList = async () => {
  if (!(await listOpen())) await page.click(".base-toggle");
  await page.waitForFunction(() => !baseControl._list.hidden);
};
const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
/* Un punto del mapa que no cae bajo ningún control ni bajo la lista */
const emptyMapPoint = () => page.evaluate(() => {
  const r = document.getElementById("map").getBoundingClientRect();
  return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.8 };
});

/* ---------- El botón alterna ---------- */
await openList();
ok(await listOpen(), "el botón de capas abre la lista");
await page.click(".base-toggle");
ok(!(await listOpen()), "y volver a pulsarlo la cierra");

/* ---------- 1. Fuera: cierra ---------- */
await openList();
const p = await emptyMapPoint();
await page.mouse.click(p.x, p.y);
ok(!(await listOpen()), "un clic en el mapa la cierra");

await openList();
await page.click("#nav-panel header, #nav-panel");
ok(!(await listOpen()), "un clic en el panel de navegación la cierra");

await openList();
await page.click("#help-btn");
await page.waitForSelector("#shortcuts:not([hidden])");
ok(!(await listOpen()), "pulsar un botón de la cabecera (que abre un diálogo) la cierra");
await page.keyboard.press("Escape");
await page.waitForSelector("#shortcuts", { state: "hidden" });

await openList();
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press("a");
ok(!(await listOpen()), "una tecla pulsada fuera la cierra");

/* ---------- 2. Dentro: no cierra ---------- */
await openList();
const chk = await page.evaluate(() => { const c = document.querySelector(".base-row input[type=checkbox]"); return c ? c.id : null; });
ok(chk, "hay casillas de mapas base");
const wasOn = await page.evaluate(id => document.getElementById(id).checked, chk);
await page.click("#" + chk);
ok(await listOpen(), "pulsar una casilla de la lista no la cierra");
await page.click("#" + chk); /* se deja como estaba */
ok((await page.evaluate(id => document.getElementById(id).checked, chk)) === wasOn, "(y se restablece)");

const slider = page.locator(".base-row input[type=range]").first();
await slider.click();
ok(await listOpen(), "pulsar un deslizador de opacidad no la cierra");

await page.focus("#" + chk);
await page.keyboard.press("ArrowRight");
ok(await listOpen(), "una tecla con el foco dentro de la lista no la cierra");

/* El botón de color de la primera fila abre un selector que vive en el <body> */
await page.click(".base-row-bg .color-btn");
await page.waitForSelector("#color-picker:not([hidden])");
ok(await listOpen(), "abrir el selector de color de la primera fila no la cierra");
const sw = page.locator("#color-picker .color-swatch, #color-picker canvas").first();
await sw.click({ position: { x: 5, y: 5 } });
ok(await listOpen(), "pulsar dentro del selector de color (fuera de la caja, en el <body>) no la cierra");

/* ---------- 3. Escape: primero lo de encima ---------- */
await page.keyboard.press("Escape");
await page.waitForSelector("#color-picker", { state: "hidden" });
ok(await listOpen(), "Escape cierra el selector de color y la lista sigue abierta");
await page.keyboard.press("Escape");
ok(!(await listOpen()), "el siguiente Escape cierra la lista");

await openList();
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press("Tab");
await page.keyboard.press("Shift");
ok(await listOpen(), "Tab y Mayús no la cierran");
await page.keyboard.press("Escape");

/* Con un diálogo abierto, Escape cierra el diálogo y deja la lista (la lista no tapa nada a cambio) */
await openList();
await page.evaluate(() => document.getElementById("help-btn").click()); /* sin ratón: no es «actuar fuera» */
await page.waitForSelector("#shortcuts:not([hidden])");
await page.keyboard.press("Escape");
await page.waitForSelector("#shortcuts", { state: "hidden" });
await openList();
await page.keyboard.press("Escape");
ok(!(await listOpen()), "Escape con la lista sola, la cierra");

/* ---------- 5. The windows opened from the list ---------- */
const openAdd = async () => {
  await openList();
  await page.click(".base-add");
  await page.waitForSelector("#user-base:not([hidden])");
};
await openAdd();
ok(await listOpen(), "abrir «+ Añadir capa…» no la cierra");
await page.click("#user-base-url");
await page.keyboard.type("https://cache.ejemplo.org/tiles/");
ok(await listOpen(), "escribir en la ventana «Nueva capa base» no la cierra");
await page.click("#user-base-cancel");
await page.waitForSelector("#user-base", { state: "hidden" });
ok(await listOpen(), "Cancelar en «Nueva capa base» deja la lista abierta");
await openAdd();
await page.click("#user-base .dlg-close");
await page.waitForSelector("#user-base", { state: "hidden" });
ok(await listOpen(), "y su × también");
await openAdd();
await page.keyboard.press("Escape");
await page.waitForSelector("#user-base", { state: "hidden" });
ok(await listOpen(), "Escape cierra la ventana y deja la lista");
/* «Añadir» too, with a server faked so nothing leaves the machine */
await page.route(/ejemplo\.org/, route => route.fulfill({ status: 200, contentType: "image/png",
  body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") }));
await openAdd();
await page.fill("#user-base-url", "https://cache.ejemplo.org/tiles/");
await page.click("#user-base-accept");
await page.waitForSelector("#user-base", { state: "hidden" });
ok(await listOpen() && await page.evaluate(() => userBaseStates().length === 1), "«Añadir» crea la capa y la lista sigue abierta");
/* the delete confirmation of that layer */
await openList();
await page.click(".base-row .base-del");
await page.waitForSelector("#user-base-delete:not([hidden])");
await page.click("#user-base-delete-cancel");
await page.waitForSelector("#user-base-delete", { state: "hidden" });
ok(await listOpen(), "cancelar el borrado de una capa propia deja la lista abierta");
await page.mouse.click(p.x, p.y);
ok(!(await listOpen()), "con las ventanas cerradas, un clic en el mapa la sigue cerrando");

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
await browser.close();
srv.close();
done();
