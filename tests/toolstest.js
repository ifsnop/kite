const { fn } = require("./_extract");

const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* Fresh, isolated instance of showLayerInfo/setTool/the hide-timer pair and
   the stack of recent cards, with tiny real delays (ms) so the tests stay
   fast while still exercising genuine setTimeout scheduling — not fake
   timers. `dwell` defaults to "never" so the older cases (which predate the
   stack) still see the card close when the pointer leaves. */
const STACK_FNS = ["cancelHoverIntent", "infoStackWith", "infoStackTrim", "infoStackPinned", "infoStackResumed", "infoStackAlive", "infoStackExpiring",
  "infoStackNextEvent", "scheduleInfoStackTick", "pauseInfoStack", "refreshInfoStack", "retireLiveInfo",
  "collapseLayerInfo", "toggleInfoPin", "pinLiveLayerInfo", "paintLayerInfo", "setLiveInfo"];
/* ttl = Infinity arms no expiry timer at all (a long real one would keep Node alive) */
function buildApi({ hideDelay = 5, guardMs = 5, intent = 2, dwell = Infinity, ttl = Infinity, warn = 1, max = 6, maxPinned = 6 } = {}) {
  const src = `
    const document = { activeElement: null };
    let drawing = null, polyDraft = null, activeTool = null, layerInfoDismissed = false;
    let routeDraft = null, routeMeasurement = null, arcDraft = null;
    /* Las herramientas de un clic (pin, anillos, sector) fijan un punto igual que el polígono */
    const PLACE_TOOLS = new Set(["pin", "rings", "sector"]);
    const clickPicksPoint = () => activeTool === "polygon" || PLACE_TOOLS.has(activeTool);
    let layerInfoHideTimer = null;
    let suppressNextHover = false;
    let hoverIntent = null, infoStack = [], liveInfo = null, infoPeek = null, infoStackTimer = null, infoStackPaused = false, infoHideHeld = false, infoQueueSeq = 0, infoPausedAt = 0;
    const infoStackClock = () => infoStackPaused ? infoPausedAt : Date.now();
    const focusReturn = [];
  ` + [fn("hideLayerInfo"), fn("cancelLayerInfoHide"), fn("scheduleLayerInfoHide"), fn("showLayerInfo"), fn("setTool"),
       ...STACK_FNS.map(n => fn(n))].join("\n");

  const focusState = { insideDesc: false, pointerOver: false, selection: false };
  const descDialog = { hidden: true };
  const styleDialog = { hidden: true };
  const descBox = { contains: () => focusState.insideDesc, matches: sel => sel === ":hover" && focusState.pointerOver };
  const descTitle = { textContent: "" };
  const descBody = { innerHTML: "", hidden: false };
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
  /* setTool ya no reactiva doubleClickZoom a ciegas al soltar una
     herramienta: se lo pregunta a refreshDoubleClickZoom
     (52-measure.js), que también mira si hay un polígono/ruta/círculo
     en edición al mismo tiempo. Ajena a lo que aquí se prueba (el
     propio setTool no comprueba vertexOwner), basta un stub.         */
  const refreshDoubleClickZoomCalls = [];
  const refreshDoubleClickZoom = () => refreshDoubleClickZoomCalls.push(true);
  const clampToViewportCalls = [];
  const clampToViewport = () => clampToViewportCalls.push(true);
  const focusDialogCalls = [];
  const focusDialog = () => focusDialogCalls.push(true);
  const infoState = { html: "<p>info</p>" };
  const infoHtmlFor = () => infoState.html;
  const baseInfoHtml = () => infoState.html; /* sin horas del sol: la ficha propia es la misma */
  /* showLayerInfo reaplica el reparto de columnas de la ficha al cambiar
     de capa. Aquí no es lo que se prueba —no hay tabla de properties—,
     así que basta con que exista.                                     */
  const applyPropsSplit = () => {};
  /* y el botón «Editar propiedades» de la ficha, que tampoco se prueba aquí */
  const descEditBtn = { hidden: true };
  const STYLE_EDITABLE_KINDS = new Set(["marker", "polygon", "measure", "imageOverlay"]);
  const styleKind = () => "marker";
  /* The DOM side of the stack (44-dialogs.js) is not what is tested here */
  const renderInfoStack = () => {};
  const clearInfoPeek = () => {};
  const setInfoHalo = () => {};
  const infoSelectionInCard = () => focusState.selection === true;
  const infoStackActive = () => true;
  const messages = [];
  const navMessage = t => messages.push(t);

  const api = new Function(
    "LAYER_INFO_HIDE_DELAY", "TOOL_EXIT_HOVER_GUARD_MS", "LAYER_INFO_HOVER_INTENT_MS", "INFO_STACK_DWELL_MS",
    "INFO_STACK_TTL_MS", "INFO_STACK_WARN_MS", "INFO_STACK_MAX", "INFO_STACK_MAX_PINNED", "descDialog", "styleDialog", "descBox",
    "descTitle", "descBody", "toolButtons", "rootGroup", "map", "clampToViewport", "focusDialog",
    "infoHtmlFor", "baseInfoHtml", "applyPropsSplit", "releaseFocus", "refreshDoubleClickZoom",
    "descEditBtn", "STYLE_EDITABLE_KINDS", "styleKind", "renderInfoStack", "clearInfoPeek", "setInfoHalo", "infoSelectionInCard", "infoStackActive", "navMessage",
    "let descLayer = null;\n" + src + `
      return {
        showLayerInfo, setTool, scheduleLayerInfoHide, cancelLayerInfoHide, hideLayerInfo,
        toggleInfoPin, pinLiveLayerInfo, pauseInfoStack, refreshInfoStack,
        infoStackWith, infoStackTrim, infoStackPinned, infoStackResumed, infoStackAlive, infoStackNextEvent, infoStackExpiring,
        stack: () => infoStack, live: () => liveInfo && liveInfo.li,
        activeToolNow: () => activeTool, dialogHidden: () => descDialog.hidden,
      };
    `
  )(hideDelay, guardMs, intent, dwell, ttl, warn, max, maxPinned, descDialog, styleDialog, descBox, descTitle, descBody, toolButtons,
    rootGroup, map, clampToViewport, focusDialog, infoHtmlFor, baseInfoHtml, applyPropsSplit, releaseFocus,
    refreshDoubleClickZoom, descEditBtn, STYLE_EDITABLE_KINDS, styleKind, renderInfoStack, clearInfoPeek, setInfoHalo, infoSelectionInCard, infoStackActive, navMessage);

  return { api, focusState, descDialog, styleDialog, descTitle, descBody, infoState, releaseFocusCalls, messages };
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

// 4. Arreglo general: ruta y círculo tienen el mismo bug y el mismo arreglo
for (const tool of ["route", "circle"]) {
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

  // 10. El puntero sobre la propia ficha la mantiene abierta (puede abrirse justo
  //     encima de la capa que se recorre, o el usuario va hacia su enlace)
  const b10 = buildApi({ hideDelay: 5 });
  b10.api.showLayerInfo(li, { focus: false });
  b10.focusState.pointerOver = true;
  b10.api.scheduleLayerInfoHide();
  await wait(20);
  ok(b10.api.dialogHidden() === false, "con el puntero sobre la ficha, el cierre diferido no la cierra");
  b10.focusState.pointerOver = false;
  b10.api.scheduleLayerInfoHide();
  await wait(20);
  ok(b10.api.dialogHidden() === true, "y al salir el puntero, se cierra como siempre");

  // 11. Hover intent: with the card showing a layer, merely crossing another
  //     one changes nothing; resting on it takes the card over
  const b11 = buildApi({ hideDelay: 5, intent: 30 });
  b11.api.showLayerInfo(li, { focus: false });
  b11.api.showLayerInfo(otherLi, { focus: false });
  b11.api.scheduleLayerInfoHide(); /* the pointer left B before the intent */
  await wait(15);
  ok(b11.descTitle.textContent === "capa A", "crossing B without resting on it does not rewrite the card: " + b11.descTitle.textContent);
  await wait(40);
  ok(b11.api.dialogHidden() === true && b11.descTitle.textContent === "capa A", "and B never shows, even after the intent delay");
  const b12 = buildApi({ intent: 10 });
  b12.api.showLayerInfo(li, { focus: false });
  b12.api.showLayerInfo(otherLi, { focus: false });
  ok(b12.descTitle.textContent === "capa A", "B does not take over at once");
  await wait(30);
  ok(b12.descTitle.textContent === "capa B" && b12.api.live() === otherLi, "resting on B takes the card over: " + b12.descTitle.textContent);

  // 12. The layer the pointer rested on joins the stack, and the card shrinks
  //     to it instead of closing
  const b13 = buildApi({ hideDelay: 5, dwell: 0 });
  b13.api.showLayerInfo(li, { focus: false });
  b13.api.scheduleLayerInfoHide();
  await wait(20);
  ok(b13.api.dialogHidden() === false, "with a row in the stack the card stays");
  ok(b13.api.stack().length === 1 && b13.api.stack()[0].li === li, "the rested-on layer is in the stack");
  ok(b13.descTitle.textContent === "Fichas recientes" && b13.descBody.hidden === true, "compact: the title names the stack and the body is hidden: " + b13.descTitle.textContent);
  b13.api.showLayerInfo(otherLi, { focus: false });
  ok(b13.api.live() === otherLi && b13.descTitle.textContent === "capa B", "a compact card opens a hovered layer at once, no intent wait");

  // 13. An explicit open always counts, whatever the dwell
  const b14 = buildApi();
  b14.api.showLayerInfo(li, { focus: true });
  b14.api.showLayerInfo(otherLi, { focus: true });
  ok(b14.api.stack().length === 1 && b14.api.stack()[0].li === li, "the ℹ-opened layer joins the stack when another takes over");

  // 14. Pin: F pins the live layer; closing keeps only the pinned rows; the
  //     edit button's close keeps everything
  const b15 = buildApi();
  ok(b15.api.pinLiveLayerInfo() === false, "F with no card does nothing");
  b15.api.showLayerInfo(li, { focus: true });
  ok(b15.api.pinLiveLayerInfo() === true && b15.api.stack()[0].pinned === true, "F pins the layer on the card");
  b15.api.showLayerInfo(otherLi, { focus: true });
  b15.api.showLayerInfo({ _name: "capa C" }, { focus: true });
  ok(b15.api.stack().length === 2, "A (pinned) and B in the stack: " + b15.api.stack().length);
  b15.api.hideLayerInfo({ dismiss: true, clear: false });
  ok(b15.api.stack().length === 3, "hiding to edit keeps every row (C joined too)");
  b15.api.showLayerInfo(li, { focus: true });
  b15.api.hideLayerInfo({ dismiss: true });
  ok(b15.api.stack().length === 1 && b15.api.stack()[0].li === li, "closing keeps only the pinned row");
  b15.api.toggleInfoPin(li);
  ok(b15.api.stack()[0].pinned === false, "the pin toggles");

  // 15. Unpinned rows expire and a card left with nothing closes; pinned ones stay
  const b16 = buildApi({ hideDelay: 5, dwell: 0, ttl: 40, warn: 10 });
  b16.api.showLayerInfo(li, { focus: false });
  b16.api.scheduleLayerInfoHide();
  await wait(20);
  ok(b16.api.dialogHidden() === false && b16.api.stack().length === 1, "compact with one row");
  await wait(60);
  ok(b16.api.stack().length === 0 && b16.api.dialogHidden() === true, "the row expired and the empty card closed");
  const b17 = buildApi({ hideDelay: 5, dwell: 0, ttl: 40, warn: 10 });
  b17.api.showLayerInfo(li, { focus: false });
  b17.api.pinLiveLayerInfo();
  b17.api.scheduleLayerInfoHide();
  await wait(80);
  ok(b17.api.stack().length === 1 && b17.api.dialogHidden() === false, "a pinned row does not expire");
  /* The clocks stop while the pointer is on the card and go on from where they
     were: a row ~95 ms into a 200 ms lease, paused 150 ms, still has ~105 ms
     left after the pause (not 0, which would drop it at once on leaving, nor
     a fresh 200 ms) */
  const b18 = buildApi({ hideDelay: 5, dwell: 0, ttl: 200, warn: 20 });
  b18.api.showLayerInfo(li, { focus: false });
  b18.api.scheduleLayerInfoHide();
  await wait(100);
  b18.api.pauseInfoStack(true); /* the pointer is on the card */
  await wait(150);
  ok(b18.api.stack().length === 1, "nothing expires while the pointer is on the card");
  b18.api.pauseInfoStack(false);
  await wait(10);
  ok(b18.api.stack().length === 1, "leaving the card does not drop rows whose time ran out while paused: their clock was stopped");
  await wait(150);
  ok(b18.api.stack().length === 0, "and the row expires when the time it had left runs out, not after a fresh lease");

  // 15b. Reported bug: after an explicit open (focus in the card) the last layer
  //      hovered stayed on screen for ever, its tabs expiring around it. The
  //      focus only holds the card while it shows the layer opened on purpose.
  const b21 = buildApi({ hideDelay: 5, intent: 2, dwell: 0 });
  b21.focusState.insideDesc = true;
  b21.api.showLayerInfo(li, { focus: true });          /* ℹ: explicit, focus in the card */
  b21.api.scheduleLayerInfoHide();
  await wait(20);
  ok(b21.descTitle.textContent === "capa A" && b21.api.dialogHidden() === false, "the explicitly opened card stays with the focus in it");
  b21.api.showLayerInfo(otherLi, { focus: false });    /* the pointer rests on another layer */
  await wait(15);
  ok(b21.descTitle.textContent === "capa B", "a hovered layer takes the card over");
  b21.api.scheduleLayerInfoHide();                     /* and the pointer leaves it */
  await wait(20);
  ok(b21.descTitle.textContent === "Fichas recientes", "once it is a hover card, leaving shrinks it even with the focus still inside: " + b21.descTitle.textContent);

  // 16. The pure helpers: rows never move, first in first out over the
  //     unpinned ones, pinned rows outside the cap, nothing leaves while paused
  {
    const { api } = buildApi();
    const L = n => ({ n });
    const A = L("A"), B = L("B"), C = L("C"), D = L("D");
    const names = rows => rows.map(r => r.li.n).join("");
    let rows = api.infoStackWith([], A, 1);
    rows = api.infoStackWith(rows, B, 2);
    ok(names(rows) === "BA", "newest on top");
    rows = api.infoStackWith(rows, A, 3);
    ok(names(rows) === "BA" && rows[1].t === 3 && rows[1].q === 1, "revisiting A leaves its row in place, renews its lease, keeps its place in the queue");
    let fifo = [];
    for (let i = 0; i < 8; i++) fifo = api.infoStackWith(fifo, L("R" + i), i, { max: 6 });
    ok(names(fifo) === "R7R6R5R4R3R2", "eight in, the two that entered first went out: " + names(fifo));
    const withPins = [{ li: A, pinned: true, t: 0, q: 0 }, { li: B, pinned: true, t: 0, q: 0 }];
    const plus = api.infoStackWith(withPins, C, 5, { max: 1 });
    ok(names(plus) === "CAB", "pinned rows do not count: a new unpinned row enters with the queue cap at 1");
    const plus2 = api.infoStackWith(plus, D, 6, { max: 1 });
    ok(names(plus2) === "DAB", "and the next one pushes the oldest unpinned out, never a pinned one");
    ok(api.infoStackWith(withPins, C, 5, { pinned: true, maxPinned: 2 }) === withPins, "pinning past the pinned cap: same array back");
    const unpinned = api.infoStackPinned([{ li: A, pinned: true, t: 0, q: 0 }, { li: B, pinned: false, t: 4, q: 4 }], A, false, 9, { max: 1 });
    ok(names(unpinned) === "A" && unpinned[0].q === 9 && unpinned[0].t === 9,
      "unpinning puts it back in the queue as its newest entry (fresh lease) and the cap drops the older one: " + JSON.stringify(unpinned.map(r => [r.li.n, r.q])));
    const pausedRows = api.infoStackPinned([{ li: A, pinned: true, t: 0, q: 0 }, { li: B, pinned: false, t: 4, q: 4 }], A, false, 9, { max: 1, paused: true });
    ok(names(pausedRows) === "AB", "while the pointer is on the card the cap waits");
    ok(names(api.infoStackTrim(pausedRows, 1)) === "A", "and is applied after: the earliest entry goes");
    ok(api.infoStackWith(fifo, L("X"), 9, { max: 6, paused: true }).length === 7, "a row added while paused does not push anything out");
    const resumed = api.infoStackResumed([{ li: A, pinned: false, t: 10 }, { li: B, pinned: true, t: 10 }], 50);
    ok(resumed[0].t === 60 && resumed[1].t === 10, "after a pause each unpinned row keeps the time it had left (its last use moves by the pause)");
    const alive = api.infoStackAlive([{ li: A, pinned: false, t: 0 }, { li: B, pinned: true, t: 0 },
      { li: { isConnected: false }, pinned: true, t: 100 }, { li: C, pinned: false, t: 90 }], 100, 50);
    ok(names(alive) === "BC", "expired unpinned rows and layers out of the tree go: " + names(alive));
    ok(names(api.infoStackAlive([{ li: A, pinned: false, t: 0 }, { li: { isConnected: false }, pinned: false, t: 0 }], 100, 50, true)) === "A",
      "while paused nothing expires (a layer out of the tree still goes)");
    ok(api.infoStackNextEvent([{ li: A, pinned: false, t: 0 }, { li: B, pinned: true, t: 0 }], 10, 100, 20) === 80, "next event: when the first row starts dimming");
    ok(api.infoStackNextEvent([{ li: A, pinned: false, t: 0 }], 85, 100, 20) === 100, "then when it expires");
    ok(api.infoStackNextEvent([{ li: B, pinned: true, t: 0 }], 10, 100, 20) === Infinity, "pinned rows schedule nothing");
    ok(api.infoStackExpiring({ pinned: false, t: 0 }, 85, 100, 20) && !api.infoStackExpiring({ pinned: true, t: 0 }, 85, 100, 20), "dimming only unpinned rows near their end");
  }

  // 17. Text selected in the card holds the deferred close
  const b19 = buildApi({ hideDelay: 5 });
  b19.api.showLayerInfo(li, { focus: false });
  b19.focusState.selection = true;
  b19.api.scheduleLayerInfoHide();
  await wait(20);
  ok(b19.api.dialogHidden() === false && b19.descTitle.textContent === "capa A", "with text selected in the card, it does not close or change under the selection");

  // 18. While paused, an unpinned row past the cap waits; leaving trims it
  const b20 = buildApi({ max: 1 });
  b20.api.showLayerInfo(li, { focus: true });
  b20.api.showLayerInfo(otherLi, { focus: true });   /* A in the stack */
  b20.api.toggleInfoPin(otherLi);                     /* B pinned (outside the cap) */
  b20.api.pauseInfoStack(true);
  b20.api.toggleInfoPin(otherLi);                     /* B back in the queue: two unpinned, cap 1 */
  ok(b20.api.stack().length === 2, "the pointer is on the card: nothing leaves");
  b20.api.pauseInfoStack(false);
  ok(b20.api.stack().length === 1 && b20.api.stack()[0].li === otherLi, "on leaving, first in first out: A (entered first) goes, B (re-entered on unpinning) stays");

  if (!process.exitCode) console.log("TOOLS TESTS OK");
})();
