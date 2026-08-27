const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const fs = require("fs");
const script = fs.readFileSync(HTML_PATH, "utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];

/* Same isolated-function extraction as lazytree.js — parenthesis-depth
   matching skips past the parameter list BEFORE brace-matching the
   body: showLayerInfo(li, { focus = true } = {}) has its own {}-pairs
   in the signature (a destructured default), and naively brace-matching
   from the first "{" after the name matches the destructure's own
   closing brace, truncating the extraction before the real body.      */
function fn(name) {
  let i = script.indexOf(`function ${name}(`);
  if (i < 0) throw new Error("no encontrada: " + name);
  if (script.slice(Math.max(0, i - 6), i) === "async ") i -= 6;
  let pd = 0, p = script.indexOf("(", i);
  for (; p < script.length; p++) {
    if (script[p] === "(") pd++;
    else if (script[p] === ")" && --pd === 0) break;
  }
  let depth = 0, j = script.indexOf("{", p);
  for (let k = j; k < script.length; k++) {
    if (script[k] === "{") depth++;
    else if (script[k] === "}" && --depth === 0) return script.slice(i, k + 1);
  }
}

const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* Fresh, isolated instance of showLayerInfo/setTool/the hide-timer pair,
   with tiny real delays (ms) so the tests stay fast while still
   exercising genuine setTimeout scheduling — not fake timers. */
function buildApi({ hideDelay = 5, guardMs = 5 } = {}) {
  const src = `
    const document = { activeElement: null };
    let drawing = null, polyDraft = null, activeTool = null, layerInfoDismissed = false;
    let layerInfoHideTimer = null;
    let suppressNextHover = false;
  ` + [fn("cancelLayerInfoHide"), fn("scheduleLayerInfoHide"), fn("showLayerInfo"), fn("setTool")].join("\n");

  const focusState = { insideDesc: false };
  const descDialog = { hidden: true };
  const styleDialog = { hidden: true };
  const descBox = { contains: () => focusState.insideDesc };
  const descTitle = { textContent: "" };
  const descBody = { innerHTML: "" };
  const toolButtons = {};
  const rootGroup = { removeLayer() {} };
  const mapContainer = { classList: { toggle() {} } };
  const map = {
    getContainer: () => mapContainer,
    dragging: { enable() {}, disable() {} },
    doubleClickZoom: { enable() {}, disable() {} },
  };
  const releaseFocusCalls = [];
  const releaseFocus = () => releaseFocusCalls.push(true);
  const clampToViewportCalls = [];
  const clampToViewport = () => clampToViewportCalls.push(true);
  const focusDialogCalls = [];
  const focusDialog = () => focusDialogCalls.push(true);
  const infoState = { html: "<p>info</p>" };
  const infoHtmlFor = () => infoState.html;

  const api = new Function(
    "LAYER_INFO_HIDE_DELAY", "TOOL_EXIT_HOVER_GUARD_MS", "descDialog", "styleDialog", "descBox",
    "descTitle", "descBody", "toolButtons", "rootGroup", "map", "clampToViewport", "focusDialog",
    "infoHtmlFor", "releaseFocus",
    src + `
      return {
        showLayerInfo, setTool, scheduleLayerInfoHide, cancelLayerInfoHide,
        activeToolNow: () => activeTool, dialogHidden: () => descDialog.hidden,
      };
    `
  )(hideDelay, guardMs, descDialog, styleDialog, descBox, descTitle, descBody, toolButtons,
    rootGroup, map, clampToViewport, focusDialog, infoHtmlFor, releaseFocus);

  return { api, focusState, descDialog, styleDialog, descTitle, descBody, infoState, releaseFocusCalls };
}

const li = { _name: "capa A" };
const otherLi = { _name: "capa B" };

// 1. Apertura por hover
{
  const { api, descTitle } = buildApi();
  api.showLayerInfo(li, { focus: false });
  ok(api.dialogHidden() === false, "el hover abre el panel");
  ok(descTitle.textContent === "capa A", "con el título de la capa: " + descTitle.textContent);
}

// 2. Guardas existentes intactas (no las tocó el arreglo)
{
  const { api, styleDialog } = buildApi();
  styleDialog.hidden = false;
  api.showLayerInfo(li, { focus: false });
  ok(api.dialogHidden() === true, "con el diálogo de estilos abierto, el hover no abre el panel");
}
{
  const { api } = buildApi();
  api.setTool("polygon");
  api.showLayerInfo(li, { focus: false });
  ok(api.dialogHidden() === true, "dibujando un polígono, el hover no abre el panel");
}

// 3. Salir de polígono suprime exactamente el siguiente hover, no más
{
  const { api } = buildApi();
  api.setTool("polygon");
  api.setTool(null);
  api.showLayerInfo(li, { focus: false });
  ok(api.dialogHidden() === true, "el primer hover justo tras salir de polígono se traga (residual)");
  api.showLayerInfo(li, { focus: false });
  ok(api.dialogHidden() === false, "el siguiente hover ya abre con normalidad (no es pegajoso)");
}

// 4. Arreglo general: línea y círculo tienen el mismo bug y el mismo arreglo
for (const tool of ["line", "circle"]) {
  const { api } = buildApi();
  api.setTool(tool);
  api.setTool(null);
  api.showLayerInfo(li, { focus: false });
  ok(api.dialogHidden() === true, `salir de "${tool}" también suprime el hover residual`);
  api.showLayerInfo(li, { focus: false });
  ok(api.dialogHidden() === false, `y el siguiente hover tras "${tool}" abre con normalidad`);
}

// 5. Autoexpiración: sin ningún hover de por medio, la guarda no debe
//    seguir viva para siempre
(async () => {
  const { api } = buildApi({ guardMs: 5 });
  api.setTool("polygon");
  api.setTool(null);
  await wait(20);
  api.showLayerInfo(li, { focus: false });
  ok(api.dialogHidden() === false, "pasado el plazo sin hover, la guarda ya no bloquea uno posterior");

  // 6. Cierre diferido
  const b6 = buildApi({ hideDelay: 5 });
  b6.api.showLayerInfo(li, { focus: false });
  ok(b6.api.dialogHidden() === false, "abierto antes de programar el cierre");
  b6.api.scheduleLayerInfoHide();
  await wait(20);
  ok(b6.api.dialogHidden() === true, "y cerrado tras el retardo");

  // 7. El siguiente hover cancela el cierre diferido (pasar de una capa
  //    a otra no debe parpadear ni cerrarse)
  const b7 = buildApi({ hideDelay: 5 });
  b7.api.showLayerInfo(li, { focus: false });
  b7.api.scheduleLayerInfoHide();
  b7.api.showLayerInfo(otherLi, { focus: false });
  await wait(20);
  ok(b7.api.dialogHidden() === false, "sigue abierto: el hover en otra capa cancela el cierre programado");
  ok(b7.descTitle.textContent === "capa B", "y muestra ya el contenido de la nueva capa: " + b7.descTitle.textContent);

  // 8. No-op si ya está cerrado
  const b8 = buildApi();
  b8.api.scheduleLayerInfoHide();
  await wait(10);
  ok(b8.api.dialogHidden() === true, "programar el cierre con el panel ya cerrado no lanza ni reabre nada");

  // 9. Un panel con foco explícito no se autocierra
  const b9 = buildApi({ hideDelay: 5 });
  b9.focusState.insideDesc = true;
  b9.api.showLayerInfo(li, { focus: true });
  b9.api.scheduleLayerInfoHide();
  await wait(20);
  ok(b9.api.dialogHidden() === false, "con el foco de teclado dentro del panel, el cierre diferido no actúa");

  if (!process.exitCode) console.log("TOOLS TESTS OK");
})();
