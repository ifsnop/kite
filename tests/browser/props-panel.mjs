/* Panel "Propiedades" (antes "gnp-editor", solo nombres recordados de
   GeoJSON, con aplicación inmediata): ahora tiene DOS pestañas —nombres
   de GeoJSON y preferencias— y sigue, por primera vez en este diálogo,
   la edición diferida del resto de la aplicación. La unidad de medida y
   el formato de coordenadas dejan de ser ajustes sueltos, sin persistir
   entre sesiones (dos <select> redundantes en los diálogos de polígono/
   medición, ya retirados) y pasan a ser un ajuste GLOBAL, con un único
   control aquí, que persiste en IndexedDB.

   Comprobado con un círculo cuyo diálogo de propiedades está YA
   ABIERTO al abrir Propiedades: cambiar la unidad o el formato de
   coordenadas en Propiedades se ve REFLEJADO AL MOMENTO en ese diálogo
   (previsualización en vivo, igual que el resto de ajustes de la app),
   pero Cancelar lo devuelve todo a como estaba, y solo Aceptar lo deja
   escrito en IndexedDB. Lo mismo para el diálogo de un marcador, que
   antes tenía su PROPIO botón ⇅ para el formato de coordenadas (de
   sesión, sin persistir) y ahora sigue este mismo ajuste global —
   unificado a petición explícita.                                     */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER PROPS PANEL TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8895);
const { page, errors } = await openApp(browser, srv.url);

const setup = await page.evaluate(async () => {
  const c = buildMeasurement("circle", L.latLng(40.41, -3.70), L.latLng(40.42, -3.70));
  finalizeMeasurement(c);
  const li = c.treeLabel.closest("li");
  openStyleDialog(li);
  return {
    unitBefore: measureUnit, coordFormatBefore: coordFormat,
    distBefore: document.getElementById("ms-dist").textContent,
    centerBefore: document.getElementById("ms-center").textContent
  };
});
ok(setup.unitBefore === "nm", "unidad por defecto: millas náuticas — " + setup.unitBefore);
ok(setup.coordFormatBefore === "dec", "formato de coordenadas por defecto: decimal");

/* ---------- Cancelar no deja rastro, ni siquiera en un diálogo ya abierto ---------- */
const cancelled = await page.evaluate(async () => {
  await togglePropsDialog();
  const out = { tabsVisible: !document.getElementById("props-tab-prefs").hidden };
  document.getElementById("props-unit").value = "km";
  document.getElementById("props-unit").dispatchEvent(new Event("change", { bubbles: true }));
  document.getElementById("props-coord-format").value = "dms";
  document.getElementById("props-coord-format").dispatchEvent(new Event("change", { bubbles: true }));
  /* Previsualización en vivo: se ve YA en el diálogo del círculo, sin
     pulsar Aceptar todavía.                                           */
  out.unitWhileOpen = measureUnit;
  out.coordFormatWhileOpen = coordFormat;
  out.distWhileOpen = document.getElementById("ms-dist").textContent;
  out.centerWhileOpen = document.getElementById("ms-center").textContent;
  document.getElementById("props-cancel").click();
  out.dialogHiddenAfterCancel = document.getElementById("props-dialog").hidden;
  out.unitAfterCancel = measureUnit;
  out.coordFormatAfterCancel = coordFormat;
  out.distAfterCancel = document.getElementById("ms-dist").textContent;
  out.centerAfterCancel = document.getElementById("ms-center").textContent;
  return out;
});
ok(cancelled.tabsVisible, "el panel abre en la pestaña de Preferencias");
ok(cancelled.unitWhileOpen === "km", "cambiar la unidad se previsualiza al momento: " + cancelled.unitWhileOpen);
ok(cancelled.coordFormatWhileOpen === "dms", "y el formato de coordenadas también");
ok(cancelled.distWhileOpen !== setup.distBefore,
  "y se ve YA en el diálogo del círculo, abierto de antes: " + cancelled.distWhileOpen);
ok(cancelled.centerWhileOpen !== setup.centerBefore, "lo mismo para el centro en el nuevo formato");
ok(cancelled.dialogHiddenAfterCancel, "Cancelar cierra el panel");
ok(cancelled.unitAfterCancel === "nm", "y revierte la unidad: " + cancelled.unitAfterCancel);
ok(cancelled.coordFormatAfterCancel === "dec", "y el formato de coordenadas");
ok(cancelled.distAfterCancel === setup.distBefore, "el diálogo del círculo vuelve a como estaba");
ok(cancelled.centerAfterCancel === setup.centerBefore, "también su centro");

/* ---------- Aceptar persiste de verdad, en IndexedDB ---------- */
const accepted = await page.evaluate(async () => {
  await togglePropsDialog();
  document.getElementById("props-unit").value = "mi";
  document.getElementById("props-unit").dispatchEvent(new Event("change", { bubbles: true }));
  document.getElementById("props-coord-format").value = "dms";
  document.getElementById("props-coord-format").dispatchEvent(new Event("change", { bubbles: true }));
  document.getElementById("props-accept").click();
  return {
    dialogHidden: document.getElementById("props-dialog").hidden,
    unit: measureUnit, coordFormat,
    savedUnit: await dbLoadMeasureUnit(),
    savedCoordFormat: await dbLoadCoordFormat()
  };
});
ok(accepted.dialogHidden, "Aceptar también cierra el panel");
ok(accepted.unit === "mi", "la unidad elegida (millas) queda aplicada: " + accepted.unit);
ok(accepted.coordFormat === "dms", "y el formato de coordenadas (GMS)");
ok(accepted.savedUnit === "mi", "y persistida en IndexedDB: " + accepted.savedUnit);
ok(accepted.savedCoordFormat === "dms", "lo mismo para el formato de coordenadas: " + accepted.savedCoordFormat);
await page.evaluate(() => closeStyleDialog(true));

/* ---------- El diálogo de un marcador sigue el mismo coordFormat GLOBAL ----------
   Antes tenía su PROPIO botón ⇅ (`posFormat`), de sesión y sin
   persistir; unificado a petición explícita: ya no existe ese botón, y
   sus campos de latitud/longitud usan el mismo ajuste global que el
   centro de un círculo, con la misma previsualización en vivo /
   Cancelar / Aceptar.                                                  */
const markerFormat = await page.evaluate(async () => {
  coordFormat = "dec"; /* punto de partida conocido, sea cual sea el que dejó la prueba anterior */
  const mk = L.marker([40.5, -3.7]).addTo(rootGroup);
  const li = makeNode({ name: "Marcador de prueba", layer: mk, style: { color: "#1b5e97" } });
  ensureRootUl().appendChild(li);
  ensureMarkerDefaults(li);
  openStyleDialog(li);
  const out = { hasOldToggle: !!document.getElementById("pos-format") };
  out.decBefore = document.getElementById("mk-lat").value;

  await togglePropsDialog();
  document.getElementById("props-coord-format").value = "dms";
  document.getElementById("props-coord-format").dispatchEvent(new Event("change", { bubbles: true }));
  out.dmsWhileOpen = document.getElementById("mk-lat").value;
  document.getElementById("props-cancel").click();
  out.decAfterCancel = document.getElementById("mk-lat").value;

  await togglePropsDialog();
  document.getElementById("props-coord-format").value = "dms";
  document.getElementById("props-coord-format").dispatchEvent(new Event("change", { bubbles: true }));
  document.getElementById("props-accept").click();
  out.dmsAfterAccept = document.getElementById("mk-lat").value;
  closeStyleDialog(true);
  return out;
});
ok(!markerFormat.hasOldToggle, "el botón ⇅ propio del diálogo de un marcador ya no existe");
ok(!markerFormat.decBefore.includes("°"), "arranca en decimal, el formato global fijado: " + markerFormat.decBefore);
ok(markerFormat.dmsWhileOpen.includes("°"),
  "cambiar el formato en Propiedades se previsualiza AL MOMENTO en el marcador: " + markerFormat.dmsWhileOpen);
ok(markerFormat.decAfterCancel === markerFormat.decBefore, "Cancelar lo devuelve a como estaba: " + markerFormat.decAfterCancel);
ok(markerFormat.dmsAfterAccept.includes("°"), "y Aceptar lo deja aplicado: " + markerFormat.dmsAfterAccept);

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
