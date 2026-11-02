/* Tema de la interfaz: «Automático» sigue a prefers-color-scheme EN VIVO
   (solo CSS, sin JS), «Claro»/«Oscuro» lo fuerzan contra el sistema, y
   el selector de Propiedades → Preferencias sigue la edición diferida
   del panel (previsualiza, Cancelar revierte, Aceptar persiste y
   sobrevive a recargar).

   Lo que NO cambia es tan importante como lo que sí: el contenido del
   mapa (su fondo, las teselas, las etiquetas) no se tematiza, o una
   ortofoto oscurecida falsearía lo que se mira.                      */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER THEME TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8897);
const { page, errors } = await openApp(browser, srv.url, { colorScheme: "light" });

/* Brillo 0-255 de un `rgb(...)`/`rgba(...)` computado */
const luma = css => {
  const m = css.match(/[\d.]+/g).map(Number);
  return 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2];
};
const chrome = () => page.evaluate(() => ({
  body: getComputedStyle(document.body).backgroundColor,
  panel: getComputedStyle(document.getElementById("nav-panel")).backgroundColor,
  text: getComputedStyle(document.body).color,
  map: getComputedStyle(document.getElementById("map")).backgroundColor,
  attr: document.documentElement.getAttribute("data-theme"),
  scheme: getComputedStyle(document.documentElement).colorScheme
}));

/* ---------- Automático: manda el sistema, y en vivo ---------- */
const light = await chrome();
ok(light.attr === null, "sin tema guardado no hay data-theme (automático)");
ok(luma(light.panel) > 200, "sistema claro → panel claro: " + light.panel);
ok(luma(light.text) < 100, "sistema claro → texto oscuro: " + light.text);

await page.emulateMedia({ colorScheme: "dark" });
const dark = await chrome();
ok(luma(dark.panel) < 80, "sistema oscuro → panel oscuro, sin recargar: " + dark.panel);
ok(luma(dark.text) > 150, "sistema oscuro → texto claro: " + dark.text);
ok(dark.map === light.map, `el fondo del mapa NO cambia con el tema (${light.map} → ${dark.map})`);

/* ---------- Un diálogo y los controles de Leaflet también ---------- */
await page.evaluate(() => document.getElementById("gnp-editor-btn").click());
await page.waitForFunction(() => !document.getElementById("props-dialog").hidden);
const dlgDark = await page.evaluate(() => {
  return {
    box: getComputedStyle(document.querySelector("#props-dialog .dlg-box")).backgroundColor,
    zoom: getComputedStyle(document.querySelector(".leaflet-control-zoom a")).backgroundColor,
    attr: getComputedStyle(document.querySelector(".leaflet-control-attribution")).backgroundColor
  };
});
ok(luma(dlgDark.box) < 80, "diálogo oscuro: " + dlgDark.box);
ok(luma(dlgDark.zoom) < 80, "botones de zoom de Leaflet oscuros: " + dlgDark.zoom);
ok(luma(dlgDark.attr) < 80, "atribución oscura: " + dlgDark.attr);

/* ---------- Forzar «Claro» contra un sistema oscuro, con previsualización ---------- */
const forced = await page.evaluate(() => {
  const sel = document.getElementById("props-theme");
  const opts = [...sel.options].map(o => o.value);
  const before = sel.value;
  sel.value = "light";
  sel.dispatchEvent(new Event("change"));
  return {
    opts, before, uiTheme,
    attr: document.documentElement.getAttribute("data-theme"),
    panel: getComputedStyle(document.getElementById("nav-panel")).backgroundColor
  };
});
ok(forced.opts.join() === "auto,light,dark", "el selector ofrece auto, light y dark: " + forced.opts);
ok(forced.before === "auto", "por defecto el selector dice «Automático»");
ok(forced.uiTheme === "light" && forced.attr === "light", "«Claro» se aplica al momento");
ok(luma(forced.panel) > 200, "«Claro» gana al sistema oscuro: " + forced.panel);

/* ---------- Cancelar revierte ---------- */
const cancelled = await page.evaluate(() => {
  document.getElementById("props-cancel").click();
  return {
    uiTheme, attr: document.documentElement.getAttribute("data-theme"),
    panel: getComputedStyle(document.getElementById("nav-panel")).backgroundColor,
    stored: null
  };
});
ok(cancelled.uiTheme === "auto" && cancelled.attr === null, "Cancelar vuelve a automático");
ok(luma(cancelled.panel) < 80, "y el panel vuelve a seguir al sistema oscuro: " + cancelled.panel);
ok(await page.evaluate(() => dbLoadUiTheme()) === null, "Cancelar no escribió nada en IndexedDB");

/* ---------- Aceptar persiste, y sobrevive a recargar ---------- */
await page.evaluate(() => {
  document.getElementById("gnp-editor-btn").click();
  const sel = document.getElementById("props-theme");
  sel.value = "dark";
  sel.dispatchEvent(new Event("change"));
  document.getElementById("props-accept").click();
});
ok(await page.evaluate(() => dbLoadUiTheme()) === "dark", "Aceptar guarda el tema en IndexedDB");

await page.emulateMedia({ colorScheme: "light" });
await page.reload();
await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
const reloaded = await chrome();
ok(reloaded.attr === "dark", "tras recargar sigue «Oscuro»");
ok(luma(reloaded.panel) < 80, "forzado oscuro contra un sistema claro: " + reloaded.panel);
ok(reloaded.scheme === "dark", "color-scheme dark oscurece los controles nativos: " + reloaded.scheme);
ok(reloaded.map === light.map, "tras recargar el mapa sigue sin tematizarse");

/* El selector refleja lo guardado al reabrir el panel */
/* togglePropsDialog es async (lee los nombres de GeoJSON): se espera a
   que el panel esté de verdad abierto antes de mirar el selector.    */
await page.evaluate(() => document.getElementById("gnp-editor-btn").click());
await page.waitForFunction(() => !document.getElementById("props-dialog").hidden);
ok(await page.evaluate(() => document.getElementById("props-theme").value) === "dark",
  "al reabrir Propiedades el selector dice «Oscuro»");

ok(errors.length === 0, "sin errores en consola: " + errors.join(" | "));
await browser.close();
srv.close();
done();
