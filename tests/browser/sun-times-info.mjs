/* Horas del sol y crepúsculos en la ficha de un marcador, con la
   iluminación real activa: de punta a punta.

   Se prueba en el navegador y no solo en Node (tests/daynight.js cubre
   la matemática) porque lo que importa es lo que se VE y CUÁNDO: que el
   ℹ de un marcador sin descripción aparezca al activar la iluminación
   y desaparezca al apagarla, que la ficha lleve la sección, que pasar
   el ratón por encima NO abra una ventana por cada marcador, y que un
   marcador con su propia ficha la conserve y reciba la sección detrás. */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER SUN TIMES INFO TESTS OK");

const browser = await launch();
const srv = await serve(READABLE, 8859);
const { ctx, page, errors } = await openApp(browser, srv.url);

/* Un KML con un marcador con descripción, otro sin nada y una capa con
   DOS marcadores (sin un único punto no hay horas que dar).           */
const KML = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Doc</name>
<Placemark><name>Con ficha</name><description>Torre vieja</description><Point><coordinates>-3.7038,40.4168,0</coordinates></Point></Placemark>
<Placemark><name>Sin nada</name><Point><coordinates>-3.6,40.5,0</coordinates></Point></Placemark>
<Placemark><name>Dos puntos</name><MultiGeometry><Point><coordinates>-3.5,40.3,0</coordinates></Point><Point><coordinates>-3.4,40.2,0</coordinates></Point></MultiGeometry></Placemark>
</Document></kml>`;
/* El KML entra como una carpeta colapsada con sus filas por construir:
   se despliega para que existan las filas (y sus botones ℹ) que se miran. */
const importar = async (txt, nombre, carpeta) => {
  await page.evaluate(([t, n]) => handleDroppedFiles([new File([t], n)]), [txt, nombre]);
  await page.evaluate(async c => {
    const f = [...document.querySelectorAll("#tree li")].find(x => x._name === c);
    await ensureMaterialized(f);
  }, carpeta);
};
await importar(KML, "m.kml", "Doc");

const info = nombre => page.evaluate(n => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  const b = li.querySelector(":scope > .node-row .info-btn");
  return { hay: !!b, visible: !!b && !b.hidden, html: infoHtmlFor(li) };
}, nombre);

/* ---------- Iluminación apagada: todo como siempre ---------- */
let a = await info("Sin nada");
ok(a.html === null && (!a.hay || !a.visible), "sin iluminación, un marcador sin nada no tiene ficha ni ℹ visible");
a = await info("Con ficha");
ok(a.visible && a.html.includes("Torre vieja") && !a.html.includes("Sol y crep"), "con ficha propia, sin sección del sol");

/* ---------- Iluminación activa ---------- */
await page.evaluate(() => { document.querySelector(".dn-toggle").click(); });
await page.waitForTimeout(300);
const activa = await page.evaluate(() => dayNightOn);
ok(activa, "la iluminación se activa (WebGL disponible en el navegador de pruebas)");

a = await info("Sin nada");
ok(a.visible, "con la iluminación, el ℹ de un marcador sin nada aparece");
ok(a.html && a.html.includes("Sol y crepúsculos") && a.html.includes("Salida del sol")
  && a.html.includes("Puesta del sol") && a.html.includes("Crepúsculo civil (inicio)")
  && a.html.includes("Crepúsculo náutico (fin)") && a.html.includes("Crepúsculo astronómico (inicio)"),
  "y la ficha trae salida, puesta y los tres crepúsculos");
ok(/UTC[+−]\d/.test(a.html), "con el desfase horario del navegador a la vista");
a = await info("Con ficha");
ok(a.html.startsWith("Torre vieja") && a.html.includes("Sol y crep"), "con ficha propia: primero la suya, la sección del sol detrás");
a = await info("Dos puntos");
ok(a.html === null && !a.visible, "varios marcadores en una capa: no hay un único punto, no hay sección");

/* Abrir de verdad desde el botón */
await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Sin nada");
  li.querySelector(":scope > .node-row .info-btn").click();
});
const ficha = await page.evaluate(() => ({
  abierta: !document.getElementById("desc-dialog").hidden,
  filas: document.querySelectorAll("#desc-body .sun-table tr").length,
  titulo: document.getElementById("desc-title").textContent
}));
ok(ficha.abierta && ficha.titulo === "Sin nada" && ficha.filas === 9, "el ℹ abre la ficha con 9 filas de horas: " + JSON.stringify(ficha));

/* Hover: solo abre lo que ya tenía ficha propia */
await page.evaluate(() => { document.getElementById("desc-dialog").hidden = true; layerInfoDismissed = false; });
const hover = await page.evaluate(() => {
  const res = {};
  for (const n of ["Sin nada", "Con ficha"]) {
    document.getElementById("desc-dialog").hidden = true;
    const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
    showLayerInfo(li, { focus: false });
    res[n] = !document.getElementById("desc-dialog").hidden;
  }
  return res;
});
ok(hover["Sin nada"] === false, "pasar el ratón por un marcador sin ficha propia NO abre la ventana");
ok(hover["Con ficha"] === true, "y por uno con ficha propia, sí, como siempre");

/* Menú contextual: «Mostrar atributos» sigue a la ficha */
const menu = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Sin nada");
  return layerCtxItems(li).some(i => i.label === "Mostrar atributos");
});
ok(menu, "«Mostrar atributos» aparece en el menú contextual del marcador");

/* ---------- Apagar: vuelve a como estaba ---------- */
await page.evaluate(() => { document.getElementById("desc-dialog").hidden = true; document.querySelector(".dn-toggle").click(); });
a = await info("Sin nada");
ok(!(await page.evaluate(() => dayNightOn)) && a.html === null && !a.visible, "al apagar la iluminación, el ℹ se va y no hay ficha");
a = await info("Con ficha");
ok(a.visible && !a.html.includes("Sol y crep"), "y el marcador con ficha propia conserva la suya, sin la sección");

/* Un marcador que se construye DESPUÉS de activar la iluminación también la trae */
await page.evaluate(() => document.querySelector(".dn-toggle").click());
await page.waitForTimeout(200);
await importar(KML.replace(/Sin nada/, "Nuevo").replace(/Con ficha/, "Otro").replace(/Dos puntos/, "Otros dos").replace("<name>Doc</name>", "<name>Doc2</name>"),
  "n.kml", "Doc2");
a = await info("Nuevo");
ok(a.visible && a.html.includes("Sol y crep"), "un marcador importado con la iluminación ya activa nace con su ℹ");

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));
await ctx.close();
await browser.close();
srv.close();
done();
