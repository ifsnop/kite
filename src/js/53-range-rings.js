/* ================= Anillos de alcance y sectores =================
   Desde «Crear» del menú contextual: círculos concéntricos (con radiales
   opcionales) o un sector, alrededor de un punto. Lo que se crea son
   capas NORMALES del árbol —polígonos y líneas—, calculadas una vez con
   la geodesia de 51-geodesy.js: se editan, exportan y estilan como
   cualquier otra y no hay tipo de nodo nuevo ni subida de TREE_SCHEMA.
   El diálogo previsualiza en vivo sobre el mapa y Cancelar no deja nada
   (patrón de style-dialogs-ui.md). Las partes puras (lista de radios,
   formas) se prueban en Node, tests/rings.js.                          */

/* Radios por defecto de cada unidad: en la rejilla de lo que tenga
   sentido en esa escala (10 m de radio no es un alcance).             */
const RANGE_DEFAULT_RADII = {
  m: "1000, 2000, 3000", km: "10, 20, 30", ft: "5000, 10000, 15000", mi: "10, 20, 30", nm: "10, 20, 30"
};
const RANGE_DEFAULT_SECTOR_RADIUS = { m: 3000, km: 30, ft: 15000, mi: 30, nm: 30 };
const RANGE_SECTION_RINGS = tr("Anillos de alcance");
const RANGE_SECTION_SECTOR = tr("Sector");

/* «10, 20 30;40» → radios en metros, ordenados, sin repetidos. Los
   decimales llevan punto (la coma separa). Devuelve `{ values }` o
   `{ error }` con un código que la interfaz traduce a su texto.       */
function parseRadiusList(text, factor) {
  const parts = String(text).split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) return { error: "empty" };
  const values = new Set();
  for (const p of parts) {
    if (!/^\d+(\.\d+)?$/.test(p)) return { error: "bad" };
    const m = Number(p) * factor;
    if (!(m > 0)) return { error: "bad" };
    if (m > RANGE_MAX_M) return { error: "max" };
    values.add(Math.round(m * 1000) / 1000);
  }
  if (values.size > RANGE_MAX_RINGS) return { error: "count" };
  return { values: [...values].sort((a, b) => a - b) };
}

/* El texto de un radio, en la unidad vigente y sin ceros de relleno: «10 NM» */
const rangeRadiusLabel = (m, unit) => `${+(m / POLY_UNIT_FACTOR[unit]).toFixed(3)} ${POLY_UNIT_LABEL[unit]}`;

/* Las formas de una especificación (todo en metros y grados), sin nodos
   ni capas: lo comparten la vista previa y Aceptar.                    */
function rangeShapes(spec) {
  const c = spec.center;
  if (spec.mode === "sector") {
    return [{ kind: "sector", latlngs: sectorLatLngs(c, spec.az1, spec.az2, spec.rOut, spec.rIn) }];
  }
  const shapes = spec.radii.map(r => ({ kind: "ring", r, latlngs: ringLatLngs(c, r) }));
  if (spec.radialStep > 0) {
    shapes.push({ kind: "radials", latlngs: radialLatLngs(c, spec.radii[spec.radii.length - 1], spec.radialStep) });
  }
  return shapes;
}

/* ---------- Diálogo ----------
   Sin DOM al cargar el archivo: los elementos se buscan y los oyentes se
   enlazan la PRIMERA vez que se abre (`rangeUi`). Un archivo con
   `document.getElementById` a nivel superior rompe cualquier prueba de
   Node que extraiga un tramo del script que lo atraviese (le pasó a
   elevtest.js y a polyarea.js), y aquí no cuesta nada: el diálogo solo
   hace falta cuando el usuario lo pide.                                */
let rangeUi = null;           /* los elementos del diálogo, tras el primer uso */
let rangePreview = null;      /* featureGroup temporal sobre el mapa */
let rangePreviewFrame = 0;    /* un repintado por fotograma           */

const rangeEl = id => document.getElementById(id);
const isRangeDialogOpen = () => !!rangeUi && !rangeUi.dialog.hidden;

function rangeDialogUi() {
  if (rangeUi) return rangeUi;
  const dialog = rangeEl("range-dialog");
  const box = dialog.querySelector(".dlg-box");
  rangeUi = {
    dialog, box, mode: rangeEl("rg-mode"), status: rangeEl("rg-status"), accept: rangeEl("rg-accept"),
    ringsFields: rangeEl("rg-rings-fields"), sectorFields: rangeEl("rg-sector-fields"), title: rangeEl("rg-title")
  };
  makeDialogMovable(box);
  setupDialog(box, { modal: true });
  rangeUi.mode.addEventListener("change", () => { rangeSetMode(rangeUi.mode.value); scheduleRangePreview(); });
  for (const el of dialog.querySelectorAll("input")) el.addEventListener("input", scheduleRangePreview);
  rangeEl("rg-cancel").addEventListener("click", cancelRangeDialog);
  rangeUi.accept.addEventListener("click", acceptRangeDialog);
  /* Intro acepta desde un campo, como el resto de diálogos de un campo */
  dialog.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.tagName === "INPUT" && !rangeUi.accept.disabled) { e.preventDefault(); acceptRangeDialog(); }
  });
  return rangeUi;
}

const rangeSetMode = mode => {
  const ui = rangeDialogUi();
  ui.mode.value = mode;
  ui.ringsFields.hidden = mode !== "rings";
  ui.sectorFields.hidden = mode !== "sector";
  ui.title.textContent = mode === "rings" ? tr("Anillos de alcance") : tr("Sector");
};

/* Lee y valida el formulario. `{ spec }` o `{ why }` con el motivo ya redactado */
function readRangeSpec() {
  const lat = parseCoord(rangeEl("rg-lat").value, true), lng = parseCoord(rangeEl("rg-lng").value, false);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { why: tr("La posición del centro no es válida.") };
  const center = { lat, lng };
  const factor = POLY_UNIT_FACTOR[measureUnit];
  const mode = rangeDialogUi().mode.value;
  if (mode === "rings") {
    const r = parseRadiusList(rangeEl("rg-radii").value, factor);
    if (r.error === "empty") return { why: tr("Escriba al menos un radio.") };
    if (r.error === "bad") return { why: tr("Los radios son números positivos separados por comas o espacios, con punto decimal.") };
    if (r.error === "max") return { why: tr("El radio máximo es {max}.", { max: rangeRadiusLabel(RANGE_MAX_M, measureUnit) }) };
    if (r.error === "count") return { why: tr("Como mucho {n} anillos.", { n: RANGE_MAX_RINGS }) };
    const raw = rangeEl("rg-radials").value.trim();
    const step = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(step) || step < 0 || step > 180) return { why: tr("Las radiales van de 1° a 180° (0 = sin radiales).") };
    return { spec: { mode, center, radii: r.values, radialStep: step } };
  }
  const az1 = Number(rangeEl("rg-az1").value), az2 = Number(rangeEl("rg-az2").value);
  const rOut = Number(rangeEl("rg-rout").value) * factor;
  const rInText = rangeEl("rg-rin").value.trim();
  const rIn = (rInText === "" ? 0 : Number(rInText)) * factor;
  if (![az1, az2].every(a => Number.isFinite(a) && a >= 0 && a <= 360)) return { why: tr("Los azimuts van de 0° a 360°.") };
  if (sectorSweep(az1, az2) < RANGE_MIN_SWEEP_DEG) return { why: tr("El azimut final tiene que ser distinto del inicial.") };
  if (!(rOut > 0) || rOut > RANGE_MAX_M) return { why: tr("El radio exterior va de 0 a {max}.", { max: rangeRadiusLabel(RANGE_MAX_M, measureUnit) }) };
  if (!Number.isFinite(rIn) || rIn < 0 || rIn >= rOut) return { why: tr("El radio interior tiene que ser menor que el exterior.") };
  return { spec: { mode, center, az1, az2, rOut, rIn } };
}

const RANGE_PREVIEW_STYLE = { color: "#ff8800", weight: 2, dashArray: "6 4", fill: false, interactive: false };

function clearRangePreview() {
  cancelAnimationFrame(rangePreviewFrame);
  rangePreviewFrame = 0;
  if (rangePreview) { map.removeLayer(rangePreview); rangePreview = null; }
}

function updateRangePreview() {
  rangePreviewFrame = 0;
  const ui = rangeDialogUi();
  const { spec, why } = readRangeSpec();
  ui.status.textContent = why || "";
  ui.status.hidden = !why;
  ui.accept.disabled = !spec;
  if (rangePreview) { map.removeLayer(rangePreview); rangePreview = null; }
  if (!spec) return;
  rangePreview = L.featureGroup().addTo(map);
  for (const sh of rangeShapes(spec)) {
    if (sh.kind === "ring") L.polygon(sh.latlngs, RANGE_PREVIEW_STYLE).addTo(rangePreview);
    else if (sh.kind === "radials") L.polyline(sh.latlngs, { ...RANGE_PREVIEW_STYLE, weight: 1 }).addTo(rangePreview);
    else L.polygon(sh.latlngs, { ...RANGE_PREVIEW_STYLE, fill: true, fillOpacity: 0.12 }).addTo(rangePreview);
  }
}
const scheduleRangePreview = () => { if (!rangePreviewFrame) rangePreviewFrame = requestAnimationFrame(updateRangePreview); };

function fillRangeDefaults(latlng) {
  const lat = Math.max(-90, Math.min(90, latlng.lat)), lng = Math.max(-180, Math.min(180, latlng.lng));
  rangeEl("rg-lat").value = formatCoord(lat, true, coordFormat);
  rangeEl("rg-lng").value = formatCoord(lng, false, coordFormat);
  rangeEl("rg-radii").value = RANGE_DEFAULT_RADII[measureUnit];
  rangeEl("rg-radials").value = "0";
  rangeEl("rg-az1").value = "0";
  rangeEl("rg-az2").value = "90";
  rangeEl("rg-rout").value = String(RANGE_DEFAULT_SECTOR_RADIUS[measureUnit]);
  rangeEl("rg-rin").value = "0";
  for (const el of rangeDialogUi().dialog.querySelectorAll(".rg-unit")) el.textContent = POLY_UNIT_LABEL[measureUnit];
}

function openRangeDialog(mode, latlng) {
  const ui = rangeDialogUi();
  fillRangeDefaults(latlng);
  rangeSetMode(mode);
  ui.dialog.hidden = false;
  clampToViewport(ui.box);
  focusDialog(ui.box);
  updateRangePreview();
}

function closeRangeDialog() {
  clearRangePreview();
  rangeDialogUi().dialog.hidden = true;
  releaseFocus();
}
/* Cancelar y Escape: la vista previa se va y no queda nada */
const cancelRangeDialog = closeRangeDialog;

/* Crea las capas y los nodos. Todo el conjunto es UNA operación para
   deshacer. Los anillos van en una carpeta «Anillos de alcance N»; un
   sector, suelto, como cualquier polígono dibujado.                    */
function acceptRangeDialog() {
  const { spec } = readRangeSpec();
  if (!spec) return;
  closeRangeDialog();
  const sector = spec.mode === "sector";
  pushUndo(sector ? tr("crear sector") : tr("crear anillos de alcance"));
  const section = ensureNamedSection(POLYGONS_SECTION);
  const shapes = rangeShapes(spec);
  const mk = (name, layer, style) => makeNode({ name, layer, style });
  let top;
  if (sector) {
    const style = normalizePathStyle({ fillOpacity: 0.2 });
    const layer = L.polygon(shapes[0].latlngs, style).addTo(rootGroup);
    top = mk(nextNumberedName(RANGE_SECTION_SECTOR), layer, style);
    section.appendChild(top);
  } else {
    top = makeNode({ name: nextNumberedName(RANGE_SECTION_RINGS), isFolder: true });
    section.appendChild(top);
    const inner = nodeUl(top);
    for (const sh of shapes) {
      if (sh.kind === "ring") {
        const style = normalizePathStyle({ fill: false });
        inner.appendChild(mk(rangeRadiusLabel(sh.r, measureUnit), L.polygon(sh.latlngs, style).addTo(rootGroup), style));
      } else {
        const style = normalizePathStyle({ color: "#888888", weight: 1, fill: false });
        inner.appendChild(mk(tr("Radiales cada {step}°", { step: spec.radialStep }), L.polyline(sh.latlngs, style).addTo(rootGroup), style));
      }
    }
  }
  refreshAncestorChecks(top);
  scheduleSave();
  highlightNode(top);
}
