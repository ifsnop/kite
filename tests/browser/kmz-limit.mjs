/* El tamaño máximo de un KMZ (o .zip) descomprimido es una preferencia de
   Propiedades → Preferencias, en MB, de partida 500.

   1) De partida: 500 MB y el campo lo enseña, con sus cotas.
   2) Con un tope de 1 MB, un KMZ de ~3 MB descomprimidos se rechaza con un
      aviso que dice el tamaño, el límite y dónde cambiarlo, y no deja nada
      en el árbol.
   3) Subido a 10 MB por la interfaz real (campo + Aceptar), el mismo KMZ entra.
   4) Un valor fuera de rango se ajusta al límite y se avisa; uno ilegible
      vuelve al vigente.
   5) Cancelar deja el que había; Aceptar lo guarda y sobrevive a recargar.
   6) `validKmzMax` descarta lo que no sea un entero en rango, de la versión.
   El KMZ se fabrica en la página con relleno aleatorio (incompresible) para no
   topar con la cota de razón de compresión, que es otra.                      */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER KMZ LIMIT TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8965);
const { ctx, page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

const state = () => page.evaluate(() => ({ mb: kmzMaxUncompressedMB, field: document.getElementById("props-kmz-max").value,
  min: document.getElementById("props-kmz-max").min, max: document.getElementById("props-kmz-max").max }));
const openProps = async () => { await page.click("#gnp-editor-btn"); await page.waitForSelector("#props-dialog:not([hidden])"); };
const setLimit = async text => { await page.fill("#props-kmz-max", text); await page.dispatchEvent("#props-kmz-max", "change"); };
const accept = async () => { await page.click("#props-accept"); await page.waitForSelector("#props-dialog", { state: "hidden" }); };
const lastMsgs = () => page.evaluate(() => msgLog.map(m => m.text));
const nodeCount = () => page.evaluate(() => document.querySelectorAll("#tree li").length);

/* ---------- 1. De partida ---------- */
let s = await state();
ok(s.mb === 500, "de partida, 500 MB: " + s.mb);
await openProps();
s = await state();
ok(s.field === "500" && s.min === "1" && s.max === "4096", "el campo lo enseña, con sus cotas: " + JSON.stringify(s));

/* ---------- el KMZ de prueba: ~3 MB descomprimidos, incompresibles ---------- */
const drop = () => page.evaluate(async () => {
  const noise = new Uint8Array(2300 * 1024);
  for (let i = 0; i < noise.length; i += 65536) crypto.getRandomValues(noise.subarray(i, Math.min(i + 65536, noise.length)));
  let b64 = ""; for (let i = 0; i < noise.length; i += 32768) b64 += btoa(String.fromCharCode(...noise.subarray(i, i + 32768)));
  const kml = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
    + '<Placemark><name>Punto límite</name><Point><coordinates>-3.7,40.4,0</coordinates></Point></Placemark>'
    + '<!-- ' + b64 + ' --></Document></kml>';
  const z = new JSZip(); z.file("doc.kml", kml);
  const bytes = await z.generateAsync({ type: "uint8array" });
  await handleDroppedFiles([new File([bytes], "grande.kmz")]);
  return { kml: kml.length, kmz: bytes.length };
});

/* ---------- 2. Con 1 MB, se rechaza ---------- */
await setLimit("1");
await accept();
ok((await state()).mb === 1, "aceptado, el tope vigente es 1 MB");
const before = await nodeCount();
const sizes = await drop();
const msgs = await lastMsgs();
const rej = msgs.find(m => /demasiado descomprimido/.test(m));
ok(sizes.kml > 2.5e6 && sizes.kmz / sizes.kml > 0.5, "el KMZ de prueba pesa lo previsto y no se comprime: " + JSON.stringify(sizes));
ok(!!rej, "con 1 MB de tope el KMZ se rechaza: " + msgs.slice(-3).join(" | "));
ok(rej && /MB/.test(rej) && /Propiedades/.test(rej), "y el aviso dice tamaño, límite y dónde cambiarlo: " + rej);
ok(await nodeCount() === before, "sin dejar nada en el árbol");

/* ---------- 3. Con 10 MB, entra ---------- */
await openProps();
await setLimit("10");
await accept();
await drop();
await page.waitForFunction(() => [...document.querySelectorAll("#tree li")].some(x => x._name === "Punto límite"));
ok(true, "con 10 MB de tope el mismo KMZ se carga");

/* ---------- 4. Fuera de rango e ilegible ---------- */
await openProps();
await setLimit("0");
s = await state();
ok(s.mb === 1 && s.field === "1", "0 se ajusta al mínimo (1 MB): " + JSON.stringify(s));
ok((await lastMsgs()).some(m => /va de 1 a 4.096 MB/.test(m) || /va de 1 a 4,096 MB/.test(m) || /from 1 to 4,096/.test(m) || /va de 1 a 4096/.test(m)),
  "y se avisa del rango");
await setLimit("99999");
s = await state();
ok(s.mb === 4096 && s.field === "4096", "99999 se ajusta al máximo (4096 MB): " + JSON.stringify(s));
await setLimit("");
s = await state();
ok(s.mb === 4096 && s.field === "4096", "un campo vacío vuelve al vigente: " + JSON.stringify(s));
await setLimit("12.6");
ok((await state()).mb === 13, "los decimales se redondean a MB enteros: " + (await state()).mb);

/* ---------- 5. Cancelar y recargar ---------- */
await page.click("#props-cancel");
await page.waitForSelector("#props-dialog", { state: "hidden" });
ok((await state()).mb === 10, "Cancelar deja el que había (10 MB): " + (await state()).mb);
await openProps();
await setLimit("700");
await accept();
await page.waitForTimeout(500);
await page.reload();
await waitAppReady(page);
ok((await state()).mb === 700, "Aceptar lo guarda y sobrevive a recargar: " + (await state()).mb);

/* ---------- 6. Lo guardado se valida al leer ---------- */
const v = await page.evaluate(() => [
  validKmzMax({ v: 1, mb: 500 }), validKmzMax({ v: 1, mb: 0 }), validKmzMax({ v: 1, mb: 4097 }), validKmzMax({ v: 1, mb: 1.5 }),
  validKmzMax({ v: 1, mb: "500" }), validKmzMax({ v: 2, mb: 500 }), validKmzMax(null), validKmzMax({ v: 1, mb: 4096 }), validKmzMax({ v: 1, mb: 1 })]);
ok(JSON.stringify(v) === JSON.stringify([500, null, null, null, null, null, null, 4096, 1]), "validKmzMax acepta enteros en [1, 4096] de su versión y nada más: " + JSON.stringify(v));

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");
await ctx.close(); await browser.close(); srv.close();
done();
