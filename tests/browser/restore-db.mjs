/* Propiedades › Restaurar borra TODA la base de IndexedDB, y se pide una
   segunda confirmación para que no se pulse por error. Aquí, con el ratón
   y el teclado de verdad:
   - la pestaña nueva existe y su botón NO borra: solo abre la confirmación;
   - Cancelar, la × y Escape cierran la confirmación sin tocar nada (y
     Escape no cierra además Propiedades, que queda debajo);
   - «Borrar todo» recarga la página y la base vuelve vacía: sin árbol y
     sin ajustes guardados, pero el idioma (localStorage) sigue;
   - mientras se borra, ningún guardado puede recrear la base (dbWiped).  */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER RESTORE DB TESTS OK");

const browser = await launch();
const srv = await serve(READABLE, 8954);
const { ctx, page, errors } = await openApp(browser, srv.url);

/* Contenido y un ajuste guardados de verdad */
await page.evaluate(async () => {
  const geo = { type: "FeatureCollection", features: [
    { type: "Feature", properties: null, geometry: { type: "Point", coordinates: [-3.7, 40.4] } } ] };
  await handleDroppedFiles([new File([JSON.stringify(geo)], "uno.geojson")]);
  saveUiLangPref("es");
  await dbSaveMeasureUnit("km");
  await saveTree();
});
const estado = () => page.evaluate(async () => ({
  unit: await dbLoadMeasureUnit(),
  nodos: ((await dbLoadTree()) || []).length,
  lang: localStorage.getItem("kite.uiLang")
}));
const antes = await estado();
ok(antes.unit === "km" && antes.nodos > 0, "hay árbol y ajuste guardados: " + JSON.stringify(antes));

const visible = sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.hidden; }, sel);

/* ---- la pestaña y su botón ---- */
await page.click("#gnp-editor-btn");
/* togglePropsDialog es asíncrona (lee los índices antes de mostrarse) */
await page.waitForSelector("#props-dialog:not([hidden])");
ok(await visible("#props-dialog"), "Propiedades se abre");
ok(!(await visible("#props-tab-restore")), "la pestaña Restaurar no es la de apertura");
await page.click("#props-tab-btn-restore");
ok(await visible("#props-tab-restore"), "la pestaña «Restaurar» se muestra");
ok((await page.textContent("#props-tab-btn-restore")) === "Restaurar", "la pestaña se llama «Restaurar»");
ok(!(await visible("#restore-confirm")), "la confirmación no está abierta de entrada");

await page.click("#props-restore-btn");
ok(await visible("#restore-confirm"), "el botón de la pestaña abre la segunda confirmación");
ok(await visible("#props-dialog"), "Propiedades queda debajo, abierta");
ok(JSON.stringify(await estado()) === JSON.stringify(antes), "y todavía no se ha borrado nada");

/* ---- Cancelar, × y Escape: nada se borra ---- */
await page.click("#restore-cancel");
ok(!(await visible("#restore-confirm")) && await visible("#props-dialog"), "Cancelar cierra solo la confirmación");

await page.click("#props-restore-btn");
await page.click("#restore-confirm .dlg-close");
ok(!(await visible("#restore-confirm")) && await visible("#props-dialog"), "la × cierra solo la confirmación");

await page.click("#props-restore-btn");
await page.keyboard.press("Escape");
ok(!(await visible("#restore-confirm")), "Escape cierra la confirmación");
ok(await visible("#props-dialog"), "y ese Escape no cierra además Propiedades");
ok(JSON.stringify(await estado()) === JSON.stringify(antes), "tras cancelar de las tres maneras, sigue todo guardado");

/* Orden de botones: Cancelar a la izquierda, Borrar todo (lo que compromete) a la derecha */
await page.click("#props-restore-btn");
const orden = await page.evaluate(() => {
  const c = document.getElementById("restore-cancel").getBoundingClientRect();
  const a = document.getElementById("restore-accept").getBoundingClientRect();
  return c.left < a.left;
});
ok(orden, "Cancelar a la izquierda y «Borrar todo» a la derecha");

/* ---- la guardia: con la base en borrado nada la recrea ---- */
const guardia = await page.evaluate(async () => {
  dbWiped = true;
  let abre = "abrió";
  try { await openDb(); } catch (e) { abre = e.message; }
  const t = saveTimer;
  scheduleSave();
  const intacto = saveTimer === t;
  dbWiped = false;
  return { abre, intacto };
});
ok(guardia.abre === "restoring", "con el borrado en curso openDb se niega: " + guardia.abre);
ok(guardia.intacto, "y scheduleSave no programa ningún guardado");

/* ---- Borrar todo: recarga y la base vuelve vacía ---- */
const recarga = page.waitForEvent("load");
await page.click("#restore-accept");
await recarga;
await waitAppReady(page);
const despues = await estado();
ok(despues.unit === null, "el ajuste guardado ya no está: " + JSON.stringify(despues.unit));
ok(despues.nodos === 0, "el árbol guardado ya no está: " + despues.nodos);
ok(despues.lang === "es", "el idioma (localStorage) se conserva: " + despues.lang);
ok((await page.textContent("#tree .empty")) === "No hay capas cargadas.", "el panel arranca vacío");
ok(!(await visible("#restore-confirm")) && !(await visible("#props-dialog")), "ningún diálogo queda abierto");

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");

await ctx.close(); await browser.close();
srv.close();
done();
