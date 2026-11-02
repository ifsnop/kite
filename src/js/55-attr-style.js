/* ================= Estilo por atributo =================
   Desde la tabla de atributos («Estilo por atributo…»): colorea las capas
   de una carpeta según el valor de uno de sus atributos —un color por cada
   valor distinto (categorías) o por tramo de una escala numérica
   (graduado: intervalos iguales o cuantiles)—. Es una clasificación
   HECHA UNA VEZ: lo que se guarda son estilos normales de cada capa
   (`style.color`/`fillColor`, o `mstyle.color` de un marcador), así que
   no hay regla que mantener ni cambio de esquema, y cada capa se puede
   retocar después como cualquier otra.

   Se aplica EN VIVO al mapa y Cancelar lo devuelve todo (patrón de
   style-dialogs-ui.md): la vista previa toca solo la capa de Leaflet, y
   Aceptar es lo que escribe el estilo en el nodo o en el registro
   pendiente (sin desplegar la carpeta).

   Lo puro va arriba (tests/attrstyle.js); sin DOM al cargar el archivo,
   como 53 y 54: el diálogo se enlaza al abrirlo.                       */

/* Colores. Categorías: Okabe-Ito (pensada para daltonismo) más cinco
   tonos que se distinguen de ellos; graduado: YlGnBu de ColorBrewer
   (secuencial, de claro a oscuro, legible sin color). Sin valor y «Otros»
   son grises, para que no parezcan una categoría más.                   */
const ATTRSTYLE_CATEGORICAL = ["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9",
  "#F0E442", "#7A4FA3", "#8C564B", "#2F4B7C", "#B8860B", "#1B9E77"];
const ATTRSTYLE_RAMP = ["#ffffcc", "#a1dab4", "#41b6c4", "#2c7fb8", "#253494"];
const ATTRSTYLE_NONE = "#9E9E9E";
const ATTRSTYLE_OTHER = "#6B6B6B";
const ATTRSTYLE_MAX_CATEGORIES = 12; /* con «Otros» y «sin valor» incluidos si hacen falta */
const ATTRSTYLE_MIN_CLASSES = 2;
const ATTRSTYLE_MAX_CLASSES = 9;
const ATTRSTYLE_DEFAULT_CLASSES = 5;
/* Un marcador con la gota de Leaflet (un PNG) no se puede colorear: pasa a
   este icono de MDI, del tamaño de un punto. Uno que ya tenía icono de
   MDI conserva el suyo y el tamaño, y solo cambia de color.             */
const ATTRSTYLE_POINT_ICON = "circle";
const ATTRSTYLE_POINT_SIZE = 26;

/* ---------- Lo puro ---------- */

const attrHexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const attrRgbHex = rgb => "#" + rgb.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");

/* t en [0, 1] → color de la rampa, interpolando entre sus paradas */
function rampColor(t, stops = ATTRSTYLE_RAMP) {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const a = attrHexRgb(stops[i]), b = attrHexRgb(stops[i + 1]);
  return attrRgbHex(a.map((v, k) => v + (b[k] - v) * f));
}

/* El valor numérico de una celda, o null: el mismo criterio que decide si
   una columna se ordena como números (attrIsNumeric).                   */
function attrNumber(v) {
  const s = String(v == null ? "" : v).trim();
  return /^-?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?$/.test(s) ? Number(s.replace(",", ".")) : null;
}

const quantileAt = (sorted, p) => {
  const x = p * (sorted.length - 1), i = Math.floor(x), f = x - i;
  return i + 1 < sorted.length ? sorted[i] + (sorted[i + 1] - sorted[i]) * f : sorted[i];
};

/* Los bordes de los tramos, de menor a mayor y sin repetir: `n` tramos
   como mucho. Intervalos iguales o cuantiles (mismo número de capas en
   cada uno; con muchos valores repetidos salen menos tramos).           */
function breakEdges(nums, n, method) {
  const s = [...nums].sort((a, b) => a - b);
  const lo = s[0], hi = s[s.length - 1];
  if (!(hi > lo)) return [lo, hi];
  const edges = [];
  for (let i = 0; i <= n; i++) edges.push(method === "quantile" ? quantileAt(s, i / n) : lo + (hi - lo) * i / n);
  edges[0] = lo;
  edges[n] = hi;
  return edges.filter((e, i) => i === 0 || e > edges[i - 1]);
}

/* El tramo de un valor: [borde i, borde i+1), y el último incluye su borde de arriba */
function edgeClass(v, edges) {
  const k = edges.length - 1;
  for (let i = 0; i < k; i++) if (v < edges[i + 1]) return i;
  return Math.max(0, k - 1);
}

const attrEdgeText = x => String(Number(x.toPrecision(4)));

/* Clasifica los valores de una columna (texto) y devuelve
   `{ classes: [{ kind, label, count, color }], rowClass: [índice por fila] }`.
   `kind`: "value" | "range" | "other" | "none"; `label` es null en
   «Otros» y «sin valor» (el texto lo pone la interfaz, que lo traduce).  */
function buildClassing(values, mode, n = ATTRSTYLE_DEFAULT_CLASSES, method = "equal") {
  const rowClass = Array.from(values, () => -1);
  const classes = [];
  const addNone = missing => {
    if (!missing.length) return;
    classes.push({ kind: "none", label: null, count: missing.length, color: ATTRSTYLE_NONE });
    for (const i of missing) rowClass[i] = classes.length - 1;
  };
  const missing = [];
  if (mode === "graduated") {
    const nums = values.map(attrNumber);
    const valid = nums.filter(x => x !== null);
    if (valid.length) {
      const edges = breakEdges(valid, Math.min(ATTRSTYLE_MAX_CLASSES, Math.max(ATTRSTYLE_MIN_CLASSES, n)), method);
      const k = Math.max(1, edges.length - 1);
      for (let i = 0; i < k; i++) {
        classes.push({ kind: "range", count: 0, color: rampColor(k === 1 ? 0.5 : i / (k - 1)),
          label: k === 1 ? attrEdgeText(edges[0]) : `${attrEdgeText(edges[i])} \u2013 ${attrEdgeText(edges[i + 1])}` });
      }
      nums.forEach((x, i) => { if (x === null) { missing.push(i); return; } const c = edgeClass(x, edges); classes[c].count++; rowClass[i] = c; });
    } else values.forEach((_, i) => missing.push(i));
    addNone(missing);
    return { classes, rowClass };
  }
  /* Categorías: las más frecuentes (empates por orden alfabético); si hay
     más de las que caben, el resto va junto en «Otros».                  */
  const counts = new Map();
  values.forEach((v, i) => {
    const s = String(v == null ? "" : v).trim();
    if (s === "") { missing.push(i); return; }
    counts.set(s, (counts.get(s) || 0) + 1);
  });
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], uiLang, { numeric: true }));
  const room = ATTRSTYLE_MAX_CATEGORIES - (missing.length ? 1 : 0);
  const keep = ranked.length > room ? ranked.slice(0, room - 1) : ranked;
  const index = new Map(keep.map(([v], i) => [v, i]));
  keep.forEach(([value, count], i) => classes.push({ kind: "value", label: value, count, color: ATTRSTYLE_CATEGORICAL[i % ATTRSTYLE_CATEGORICAL.length] }));
  const restCount = ranked.length > keep.length ? ranked.slice(keep.length).reduce((n, [, c]) => n + c, 0) : 0;
  if (restCount) classes.push({ kind: "other", label: null, count: restCount, color: ATTRSTYLE_OTHER });
  const otherIdx = restCount ? classes.length - 1 : -1;
  values.forEach((v, i) => {
    const s = String(v == null ? "" : v).trim();
    if (s !== "") rowClass[i] = index.has(s) ? index.get(s) : otherIdx;
  });
  addNone(missing);
  return { classes, rowClass };
}

/* El estilo de un marcador con ese color. Con la gota de Leaflet pasa al
   icono coloreable; con uno de MDI solo cambia el color.                */
function attrMarkerStyle(base, color) {
  const b = base || DEFAULT_MARKER_STYLE;
  return b.icon === LEAFLET_PIN
    ? { ...b, icon: ATTRSTYLE_POINT_ICON, size: ATTRSTYLE_POINT_SIZE, color }
    : { ...b, color };
}

/* ---------- El diálogo (se enlaza al abrirlo) ---------- */

let attrStyleUi = null;
const attrStyleState = { targets: [], keys: [], key: null, mode: "categories", n: ATTRSTYLE_DEFAULT_CLASSES, method: "equal",
  classing: null, frame: 0, iconCache: new Map() };
const isAttrStyleOpen = () => !!attrStyleUi && !attrStyleUi.dialog.hidden;

function attrStyleDialogUi() {
  if (attrStyleUi) return attrStyleUi;
  const el = id => document.getElementById(id);
  const dialog = el("attrstyle-dialog");
  attrStyleUi = {
    dialog, box: dialog.querySelector(".dlg-box"), attr: el("as-attr"), mode: el("as-mode"), n: el("as-n"), method: el("as-method"),
    gradFields: el("as-grad-fields"), classes: el("as-classes"), summary: el("as-summary"), accept: el("as-accept")
  };
  makeDialogMovable(attrStyleUi.box);
  setupDialog(attrStyleUi.box, { modal: true });
  const reclassify = () => { readAttrStyleControls(); rebuildAttrClassing(); };
  for (const c of [attrStyleUi.attr, attrStyleUi.mode, attrStyleUi.method]) c.addEventListener("change", reclassify);
  attrStyleUi.n.addEventListener("input", reclassify);
  el("as-cancel").addEventListener("click", cancelAttrStyleDialog);
  attrStyleUi.accept.addEventListener("click", acceptAttrStyleDialog);
  return attrStyleUi;
}

/* Lo que se puede colorear de cada fila de la instantánea de la tabla: su
   capa de Leaflet (de la fila o del registro pendiente), de qué tipo es y
   con qué estilo empezó (para devolverlo al cancelar).                    */
function attrStyleTargets(rows) {
  const out = [];
  for (const row of rows) {
    const layer = row.li ? nodeLayer(row.li) : (row.rec ? row.rec._layer : null);
    const kind = layerKind(layer);
    if (kind !== "polygon" && kind !== "marker") continue;
    out.push({ row, layer, kind, style: row.li ? row.li._style : row.rec.style, mstyle: row.li ? row.li._mstyle : row.rec.mstyle });
  }
  return out;
}

/* El icono de un marcador, uno por combinación icono/tamaño/color (los
   hay de miles y los colores son pocos: reutilizarlo es lo que permite
   repintarlos en vivo).                                                 */
function attrMarkerIcon(s) {
  const key = `${s.icon}|${s.size}|${s.color}`;
  let icon = attrStyleState.iconCache.get(key);
  if (!icon) {
    icon = buildMarkerIcon(s, s.icon === LEAFLET_PIN ? null : mdiSvg(s.icon)).icon;
    attrStyleState.iconCache.set(key, icon);
  }
  return icon;
}
function setAttrLayerIcon(layer, s) {
  const icon = attrMarkerIcon(s);
  const each = l => { if (l instanceof L.Marker) l.setIcon(icon); if (l.eachLayer) l.eachLayer(each); };
  each(layer);
}
const attrPathStyle = (t, color) => ({ ...normalizePathStyle(t.style), color, fillColor: color });

/* Pinta (o repone) las capas de Leaflet. `colors`: un color por objetivo, o null = el original */
function paintAttrStyle(colors) {
  attrStyleState.targets.forEach((t, i) => {
    const color = colors ? colors[i] : null;
    if (t.kind === "polygon") {
      t.layer.setStyle(color ? attrPathStyle(t, color) : normalizePathStyle(t.style));
      clearFillOnOpenPaths(t.layer);
    } else {
      setAttrLayerIcon(t.layer, color ? attrMarkerStyle(t.mstyle, color) : (t.mstyle || DEFAULT_MARKER_STYLE));
    }
  });
}

/* Un color por objetivo según la clasificación (con los colores que el usuario haya tocado) */
function attrStyleColors() {
  const { classing, targets } = attrStyleState;
  return targets.map((_, i) => (classing.classes[classing.rowClass[i]] || { color: ATTRSTYLE_NONE }).color);
}

const schedulePaintAttrStyle = () => {
  if (attrStyleState.frame) return;
  attrStyleState.frame = requestAnimationFrame(() => { attrStyleState.frame = 0; if (isAttrStyleOpen() && attrStyleState.classing) paintAttrStyle(attrStyleColors()); });
};

const attrClassLabel = c => c.kind === "none" ? tr("(sin valor)") : c.kind === "other" ? tr("Otros") : c.label;

function renderAttrClasses() {
  const ui = attrStyleDialogUi(), { classing } = attrStyleState;
  ui.classes.textContent = "";
  classing.classes.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "dlg-row as-class";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-btn";
    setColorButton(btn, c.color);
    btn.setAttribute("aria-label", tr("Color de {label}", { label: attrClassLabel(c) }));
    const set = (b, hex) => { setColorButton(b, hex); c.color = hex; schedulePaintAttrStyle(); };
    btn.addEventListener("click", () => toggleColorPicker(btn, { onPreview: set, onCommit: set }));
    const label = document.createElement("span");
    label.className = "as-label";
    label.textContent = attrClassLabel(c); /* un valor del archivo: SIEMPRE como texto */
    label.title = attrClassLabel(c);
    const count = document.createElement("span");
    count.className = "dlg-note";
    count.textContent = trn(c.count, "{n} capa", "{n} capas", { n: c.count });
    row.append(btn, label, count);
    ui.classes.appendChild(row);
  });
  const n = attrStyleState.targets.length;
  ui.summary.textContent = trn(n, "Se aplica a la capa de esta carpeta.", "Se aplica a las {n} capas de esta carpeta.", { n });
}

function readAttrStyleControls() {
  const ui = attrStyleDialogUi(), st = attrStyleState;
  st.key = ui.attr.value;
  st.mode = ui.mode.value;
  st.n = Math.min(ATTRSTYLE_MAX_CLASSES, Math.max(ATTRSTYLE_MIN_CLASSES, Math.round(Number(ui.n.value) || ATTRSTYLE_DEFAULT_CLASSES)));
  st.method = ui.method.value;
}

/* Reclasifica con los controles de ahora y repinta */
function rebuildAttrClassing() {
  const ui = attrStyleDialogUi(), st = attrStyleState;
  /* Graduado solo con una columna numérica: si no, se vuelve a categorías */
  const numeric = attrIsNumeric(attrState.rows, st.key);
  ui.mode.querySelector('option[value="graduated"]').disabled = !numeric;
  if (!numeric && st.mode === "graduated") { ui.mode.value = st.mode = "categories"; }
  ui.gradFields.hidden = st.mode !== "graduated";
  const values = st.targets.map(t => attrCell(t.row, st.key));
  const c = buildClassing(values, st.mode, st.n, st.method);
  st.classing = c;
  ui.accept.disabled = !c.classes.length;
  renderAttrClasses();
  paintAttrStyle(attrStyleColors());
}

function openAttrStyleDialog() {
  const st = attrStyleState;
  const keys = attrState.cols.slice(1).map(c => c.key);
  if (!keys.length) { navMessage(tr("Ninguna de estas capas trae atributos con los que colorear.")); return; }
  const targets = attrStyleTargets(attrState.rows);
  if (!targets.length) { navMessage(tr("Esta carpeta no tiene capas que se puedan colorear.")); return; }
  const ui = attrStyleDialogUi();
  Object.assign(st, { targets, keys, key: keys[0], mode: "categories", n: ATTRSTYLE_DEFAULT_CLASSES, method: "equal", classing: null });
  st.iconCache.clear();
  ui.attr.textContent = "";
  for (const k of keys) { const o = document.createElement("option"); o.value = k; o.textContent = k; ui.attr.appendChild(o); }
  ui.attr.value = st.key;
  ui.mode.value = "categories";
  ui.n.value = String(st.n);
  ui.method.value = "equal";
  ui.dialog.hidden = false;
  clampToViewport(ui.box);
  focusDialog(ui.box);
  rebuildAttrClassing();
}

/* Cancelar y Escape: cada capa vuelve al estilo con el que se abrió */
function closeAttrStyleDialog(commit) {
  const st = attrStyleState;
  cancelAnimationFrame(st.frame);
  st.frame = 0;
  if (!commit) paintAttrStyle(null);
  attrStyleUi.dialog.hidden = true;
  Object.assign(st, { targets: [], classing: null });
  st.iconCache.clear();
  releaseFocus();
}
const cancelAttrStyleDialog = () => closeAttrStyleDialog(false);

/* Aceptar: el estilo pasa al nodo (con fila) o al registro (pendiente); la
   vista previa ya lo tiene en el mapa. Una operación para deshacer.      */
function acceptAttrStyleDialog() {
  const st = attrStyleState;
  if (!st.classing) return;
  const colors = attrStyleColors();
  pushUndo(tr("estilo por atributo"));
  st.targets.forEach((t, i) => {
    const li = t.row.li, rec = t.row.rec;
    if (t.kind === "polygon") {
      const style = attrPathStyle(t, colors[i]);
      if (li && li.isConnected) { li._style = style; applyPolygonStyle(li); } else if (rec) rec.style = style;
    } else {
      const ms = attrMarkerStyle(t.mstyle, colors[i]);
      if (li && li.isConnected) { li._mstyle = ms; applyMarkerStyle(li); } else if (rec) rec.mstyle = ms;
    }
  });
  scheduleSave();
  closeAttrStyleDialog(true);
}
