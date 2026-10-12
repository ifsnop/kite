/* Nombre de los elementos de un GeoJSON, de punta a punta: el selector
   sale SIEMPRE que haya properties y no haya nada guardado (no se asume
   `name`), deja elegir varias claves cuyo ORDEN DE MARCADO es el de la
   combinación, una forma ya guardada se aplica sin preguntar dejando
   constancia en el registro, cancelar aborta la carga de ESE archivo, y
   el panel Propiedades permite cambiar lo guardado.

   Se prueba en el navegador y no en Node porque lo que importa es lo que
   se ve y se espera: el diálogo, sus números de orden, el botón Aceptar
   deshabilitado sin selección y la carga que no llega a producirse. La
   lógica pura (composeFeatureName…) la cubre tests/geojsonnametest.js. */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER GEOJSON NAME TESTS OK");

const feature = (props, lng) => ({ type: "Feature", properties: props,
  geometry: { type: "Point", coordinates: [lng, 40.4] } });
/* Trae `name`, a propósito: no debe asumirse como el nombre. */
const FORMA_A = props => JSON.stringify({ type: "FeatureCollection", features: [
  feature({ name: "NO", ref: "A-04", mun: "Madrid", vacio: "" , ...props }, -3.7)] });
const FORMA_C = JSON.stringify({ type: "FeatureCollection", features: [
  feature({ codigo: "Z9" }, -3.6)] });

const browser = await launch();
const srv = await serve(READABLE, 8858);
const { ctx, page, errors } = await openApp(browser, srv.url);

/* Lanza la importación SIN esperarla (se queda parada en el diálogo) */
const importar = (txt, nombre) => page.evaluate(([t, n]) => {
  window.__import = handleDroppedFiles([new File([t], n)]);
}, [txt, nombre]);
const pickerVisible = () => page.evaluate(() => !document.getElementById("geojson-name-picker").hidden);
const esperarPicker = () => page.waitForFunction(() => !document.getElementById("geojson-name-picker").hidden);
const primerNombre = nombre => page.evaluate(async n => {
  await window.__import;
  const file = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  if (!file) return null;
  await ensureMaterialized(file);
  return [...nodeUl(file).children].map(li => li._name);
}, nombre);
const enRegistro = re => page.evaluate(s => msgLog.some(e => new RegExp(s).test(e.text)), re.source);
const marcar = k => page.click(`#gnp-list .gnp-row[data-key="${k}"] input`);
const orden = () => page.evaluate(() =>
  [...document.querySelectorAll("#gnp-list .gnp-row")]
    .map(f => [f.dataset.key, f.querySelector(".gnp-order").textContent]).filter(([, n]) => n)
    .sort((a, b) => a[1] - b[1]));

/* ---------- 1. Pregunta aunque haya `name`; varias claves, en orden ---------- */
await importar(FORMA_A(), "a.geojson");
await esperarPicker();
ok(await page.evaluate(() => document.getElementById("gnp-accept").disabled),
  "Aceptar arranca deshabilitado: sin ninguna clave marcada no hay nombre");
ok(await page.evaluate(() => document.querySelectorAll("#gnp-list input[type=checkbox]").length === 4),
  "una casilla por propiedad, `name` incluida: no se asume");
await marcar("mun");
await marcar("ref");
ok(JSON.stringify(await orden()) === '[["mun","1"],["ref","2"]]',
  "cada casilla muestra su número según el orden de marcado: " + JSON.stringify(await orden()));
ok((await page.textContent("#gnp-result")).includes("Madrid / A-04"),
  "la vista previa muestra la combinación: " + await page.textContent("#gnp-result"));
await marcar("mun");
await marcar("mun");
ok(JSON.stringify(await orden()) === '[["ref","1"],["mun","2"]]',
  "desmarcar y volver a marcar renumera: pasa al final: " + JSON.stringify(await orden()));
await marcar("vacio");
ok((await page.textContent("#gnp-result")).includes("A-04 / Madrid»"),
  "una clave de valor vacío se omite, sin separador colgando: " + await page.textContent("#gnp-result"));
await marcar("vacio");
await page.click("#gnp-accept");
let nombres = await primerNombre("a.geojson");
ok(JSON.stringify(nombres) === '["A-04 / Madrid"]', "el elemento se llama como la combinación: " + JSON.stringify(nombres));

/* ---------- 2. Lo guardado se aplica sin preguntar, y queda en el registro ---------- */
await importar(FORMA_A({ ref: "B-07", mun: "Toledo" }), "b.geojson");
nombres = await primerNombre("b.geojson");
ok(!(await pickerVisible()), "misma forma de properties: el selector no sale");
ok(JSON.stringify(nombres) === '["B-07 / Toledo"]', "y se usa la selección guardada: " + JSON.stringify(nombres));
ok(await enRegistro(/selección guardada \(ref \/ mun\)/),
  "el registro dice que se aplicó una selección guardada");

/* ---------- 3. Cancelar aborta la carga de ese archivo ---------- */
await importar(FORMA_C, "c.geojson");
await esperarPicker();
await page.click("#gnp-cancel");
ok((await primerNombre("c.geojson")) === null, "cancelar: el archivo no entra en el árbol");
ok(await enRegistro(/Carga de «c\.geojson» cancelada/), "y se avisa de que la carga se canceló");
ok(!(await enRegistro(/No se pudo cargar «c\.geojson/)), "sin presentarlo como un fallo");
/* Escape es cancelar también, y nada se guardó: vuelve a preguntar */
await importar(FORMA_C, "c.geojson");
await esperarPicker();
await page.keyboard.press("Escape");
ok((await primerNombre("c.geojson")) === null, "Escape también cancela la carga");

/* ---------- 4. Cambiar lo guardado desde Propiedades ---------- */
await page.click("#gnp-editor-btn");
await page.click("#props-tab-btn-gnp");
ok((await page.textContent("#gnp-editor-list .gnp-editor-sel")) === "ref / mun",
  "el panel lista la selección guardada con su orden");
await page.click("#gnp-editor-list .gnp-editor-row button:has-text('Cambiar')");
await esperarPicker();
ok(JSON.stringify(await orden()) === '[["ref","1"],["mun","2"]]',
  "al cambiar, el diálogo llega con la selección guardada y su orden: " + JSON.stringify(await orden()));
ok(await page.evaluate(() => !document.querySelector("#gnp-list .gnp-val")),
  "sin valores de muestra: no hay ningún elemento del que sacarlos");
await marcar("ref");
await page.click("#gnp-accept");
ok((await page.textContent("#gnp-editor-list .gnp-editor-sel")) === "mun",
  "el panel refleja el cambio en su borrador");
/* Diferido: Cancelar del panel lo deja como estaba */
await page.click("#props-cancel");
await page.click("#gnp-editor-btn");
await page.click("#props-tab-btn-gnp");
ok((await page.textContent("#gnp-editor-list .gnp-editor-sel")) === "ref / mun",
  "Cancelar el panel descarta el cambio");
await page.click("#gnp-editor-list .gnp-editor-row button:has-text('Cambiar')");
await esperarPicker();
await marcar("ref");
await page.click("#gnp-accept");
await page.click("#props-accept");
await importar(FORMA_A({ ref: "D-01", mun: "Ávila" }), "d.geojson");
nombres = await primerNombre("d.geojson");
ok(JSON.stringify(nombres) === '["Ávila"]', "tras aceptar el panel, la siguiente importación usa lo nuevo: " + JSON.stringify(nombres));

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));
await ctx.close();
await browser.close();
srv.close();
done();
