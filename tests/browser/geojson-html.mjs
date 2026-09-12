/* Etiquetas tipo HTML en las `properties` de un GeoJSON, de punta a
   punta: soltar el archivo, responder al diálogo y mirar lo que se ve.

   Se prueba aquí y no en Node porque lo que se reportó es lo que se VE:
   `<b>Madrid</b>` saliendo literal en la tabla del panel de información
   y en el nombre del árbol. Las funciones sueltas ya las cubre
   tests/htmltagstest.js; lo que ninguna suite de Node puede decir es que
   el diálogo aparezca, que la respuesta se respete y que el resultado
   llegue limpio a la tabla.

   El archivo se escribe con los `<` y `>` ESCAPADOS (`<`), como
   vienen en los archivos reales del reporte. No cambia nada —JSON.parse
   los normaliza— y precisamente por eso conviene que la prueba use esa
   forma: si alguien rompiera la detección creyendo que hay que tratar
   los escapes aparte, aquí se vería.                                  */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER GEOJSON HTML TESTS OK");

/* `nota` lleva un "<" de comparación SIN cierre: no es una etiqueta y no
   se puede tocar. `pob` es un número, que no debe romper el recorrido. */
const GEOJSON = '{"type":"FeatureCollection","features":[{"type":"Feature",'
  + '"properties":{"nombre":"\\u003cb\\u003eMadrid\\u003c/b\\u003e","nota":"3 < 5","pob":3200000},'
  + '"geometry":{"type":"Point","coordinates":[-3.7,40.4]}}]}';

const browser = await launch();
const srv = await serve(READABLE, 8843);

/* Las dos mitades: eliminar y dejar. La segunda es la que no se puede
   olvidar — «Dejarlas» tiene que seguir dejando el archivo intacto.  */
for (const [respuesta, botón] of [["Eliminarlas", "ktp-accept"], ["Dejarlas", "ktp-cancel"]]) {
  const { ctx, page, errors } = await openApp(browser, srv.url);
  const et = m => `[${respuesta}] ${m}`;

  /* La importación se lanza SIN esperarla: se queda parada en el
     diálogo, que es lo que hay que inspeccionar y responder.        */
  await page.evaluate(txt => { window.__import = handleDroppedFiles([new File([txt], "datos.geojson")]); }, GEOJSON);
  await page.waitForFunction(() => !document.getElementById("kml-tags-picker").hidden);

  const dlg = await page.evaluate(() => ({
    titulo: document.getElementById("ktp-title").textContent,
    texto: document.getElementById("ktp-intro").textContent
  }));
  ok(dlg.titulo === "Etiquetas en las propiedades",
    et("el diálogo habla de propiedades, no de nombres: " + dlg.titulo));
  ok(dlg.texto.includes("datos.geojson") && dlg.texto.includes("propiedades"),
    et("y nombra el archivo: " + dlg.texto.slice(0, 70)));

  /* Estas properties no traen `name` ni `title`, así que tras el primer
     diálogo aparece el selector de propiedad-nombre. Es justo lo que
     interesa mirar: su vista previa tiene que reflejar ya la respuesta
     anterior, porque la limpieza se hace ANTES de leer firstProps.  */
  await page.evaluate(id => document.getElementById(id).click(), botón);
  await page.waitForFunction(() => !document.getElementById("geojson-name-picker").hidden);
  const previa = await page.evaluate(() => {
    const fila = [...document.querySelectorAll("#gnp-list .gnp-row")]
      .find(f => f.querySelector(".gnp-key").textContent === "nombre");
    return fila ? fila.querySelector(".gnp-val").textContent : "(no está)";
  });
  ok(previa === (respuesta === "Eliminarlas" ? "Madrid" : "<b>Madrid</b>"),
    et("la vista previa del selector de nombre refleja la respuesta: " + JSON.stringify(previa)));

  const r = await page.evaluate(async () => {
    /* Se elige `nombre` como propiedad-nombre y se acepta */
    const radio = [...document.querySelectorAll("#gnp-list input[name=gnp-key]")]
      .find(i => i.value === "nombre");
    radio.checked = true;
    document.getElementById("gnp-accept").click();
    await window.__import;
    const file = [...document.querySelectorAll("#tree li")].find(x => x._name === "datos.geojson");
    await ensureMaterialized(file);
    const capa = [...nodeUl(file).children][0];
    showLayerInfo(capa);
    const filas = [...document.querySelectorAll("#desc-body tr")]
      .map(tr => [...tr.children].map(td => td.textContent));
    return {
      nombreEnElArbol: capa._name,
      filas,
      hayNegrita: !!document.querySelector("#desc-body b"),
      avisos: [...document.querySelectorAll(".nav-msg-line .nav-msg-text")]
        .map(e => e.textContent).filter(t => /etiquetas tipo HTML/.test(t))
    };
  });

  const valor = k => (r.filas.find(f => f[0] === k) || [])[1];

  if (respuesta === "Eliminarlas") {
    ok(r.nombreEnElArbol === "Madrid",
      et("el nombre del árbol queda limpio: " + JSON.stringify(r.nombreEnElArbol)));
    ok(valor("nombre") === "Madrid",
      et("y la tabla de properties también: " + JSON.stringify(valor("nombre"))));
    ok(r.avisos.length === 1 && /1 propiedad/.test(r.avisos[0]),
      et("el resumen dice cuántas se tocaron: " + JSON.stringify(r.avisos)));
  } else {
    ok(r.nombreEnElArbol === "<b>Madrid</b>",
      et("«Dejarlas» conserva el valor tal cual: " + JSON.stringify(r.nombreEnElArbol)));
    ok(valor("nombre") === "<b>Madrid</b>",
      et("y la tabla lo muestra literal: " + JSON.stringify(valor("nombre"))));
    ok(r.avisos.length === 0, et("sin anotar ninguna limpieza: " + JSON.stringify(r.avisos)));
  }

  /* En los DOS casos: nunca se interpreta como HTML. Es lo que ya hacía
     `escapeHtml` y lo que no puede perderse al tocar este camino.    */
  ok(r.hayNegrita === false, et("nada se renderiza en negrita: el valor se escapa"));
  /* Y lo que no es una etiqueta no se toca, responda lo que responda */
  ok(valor("nota") === "3 < 5", et("un '<' de comparación queda intacto: " + JSON.stringify(valor("nota"))));
  ok(valor("pob") === "3200000", et("y un número tampoco se estropea: " + JSON.stringify(valor("pob"))));
  ok(errors.length === 0, et("sin errores de página: " + JSON.stringify(errors)));

  await ctx.close();
}

await browser.close();
srv.close();
done();
