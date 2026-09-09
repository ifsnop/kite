/* ---------- Lista de puntos editable de una capa de trazos ----------
   Formato de intercambio: una línea por punto, campos separados por
   TABULADOR, con fila de cabecera. Es lo que una hoja de cálculo pega y
   copia sin pedir nada, y un <textarea> lo aguanta con miles de líneas
   sin construir DOM por punto. Los anillos y las partes (agujeros de un
   polígono, tramos de una multigeometría) se separan con una LÍNEA EN
   BLANCO, conservando el orden original: exterior primero, agujeros
   después.                                                            */
const POINTS_HEADER = "Lat\tLon\tAlt";
const POINTS_DECIMALS = 6; /* ~0,1 m: más dígitos no dicen nada real */

/* Anillos de una capa como arrays de L.LatLng, en el orden en que hay
   que devolvérselos a setLatLngs. Devuelve también la forma para poder
   reconstruirla: `nested` indica si la capa esperaba un array de
   anillos o uno plano de puntos.                                      */
function pathRings(layer) {
  const latlngs = layer.getLatLngs();
  if (!latlngs.length) return { rings: [], nested: false };
  /* getLatLngs() de un polígono siempre anida (anillos); el de una
     polilínea solo anida si es multipart.                             */
  const nested = Array.isArray(latlngs[0]);
  if (!nested) return { rings: [latlngs], nested: false };
  const rings = [];
  const walk = arr => {
    if (!arr.length) return;
    if (Array.isArray(arr[0])) arr.forEach(walk); else rings.push(arr);
  };
  latlngs.forEach(walk);
  return { rings, nested: true };
}

function pointsToText(rings) {
  const num = v => Number(v).toFixed(POINTS_DECIMALS);
  return [POINTS_HEADER, ""].concat(
    rings.map(ring => ring.map(p =>
      /* Sin altitud se escribe 0: la columna existe siempre, y 0 es lo
         que vale un punto dibujado a mano sobre el mapa.              */
      `${num(p.lat)}\t${num(p.lng)}\t${num(p.alt === undefined ? 0 : p.alt)}`).join("\n"))
      .join("\n\n")).join("\n");
}

/* Texto → { rings, errors }. Tolera tabulador, coma o espacios como
   separador (se pega desde sitios muy distintos), se salta la cabecera
   y no cuenta como separador de anillo las líneas en blanco del
   principio ni del final. `errors` lleva el número de línea REAL para
   poder señalarlas.                                                   */
function textToPoints(text) {
  const rings = [], errors = [];
  let current = null;
  const lines = String(text).split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { if (current && current.length) { rings.push(current); current = null; } return; }
    /* La cabecera puede venir repetida al pegar varias veces */
    if (/^lat\b/i.test(line)) return;
    const f = line.split(/[\t,;]+|\s+/).filter(s => s !== "");
    if (f.length < 2) { errors.push({ line: i + 1, text: raw, why: "hacen falta al menos latitud y longitud" }); return; }
    /* Latitud y longitud PRIMERO: en una línea de texto basura los tres
       campos fallan, y decir "altitud no numérica" mandaría a mirar la
       columna equivocada.                                              */
    const lat = Number(f[0]), lng = Number(f[1]);
    if (!isFinite(lat) || !isFinite(lng)) {
      errors.push({ line: i + 1, text: raw, why: "latitud o longitud no numérica" });
      return;
    }
    const alt = f.length > 2 ? Number(f[2]) : undefined;
    if (f.length > 2 && !isFinite(alt)) { errors.push({ line: i + 1, text: raw, why: "altitud no numérica" }); return; }
    const pos = clampLatLng(lat, lng, alt);
    if (!pos) { errors.push({ line: i + 1, text: raw, why: "latitud o longitud fuera de rango" }); return; }
    if (!current) current = [];
    current.push(pos);
  });
  if (current && current.length) rings.push(current);
  return { rings, errors };
}

/* Perímetro y área de un nodo de tipo polígono, para el diálogo de
   propiedades. Un anillo DE POLÍGONO se da por cerrado salvo que su
   GeoJSON original (rawPolygonRings) diga lo contrario: un KML repite
   siempre el punto de cierre de su LinearRing, y un polígono dibujado a
   mano que se cerró sobre su último vértice lo está por construcción
   (ninguno de los dos tiene ese GeoJSON crudo con el que comprobar lo
   contrario). Un GeoJSON importado cuyo archivo no repetía el punto de
   cierre hace que el área salga null y no se muestre.
   Las formas ABIERTAS (una línea importada, o una dibujada terminando
   fuera de un vértice) no son L.Polygon: aportan longitud al perímetro
   y nunca área. Con solo líneas, el área es null y su fila se oculta;
   el perímetro sí se calcula siempre (ver ringPerimeter).             */
function polygonMeasures(li) {
  const layer = nodeLayer(li);
  if (!layer) return null;
  const polys = [], lines = [];
  /* L.Polygon extiende L.Polyline, así que el orden importa: lo que no
     es polígono pero sí polilínea es una forma ABIERTA (una línea
     importada, o una dibujada terminando fuera de un vértice) y tiene
     longitud aunque no tenga área.                                    */
  const scan = l => {
    if (l instanceof L.Polygon) polys.push(l);
    else if (l instanceof L.Polyline) lines.push(l);
    if (l.eachLayer) l.eachLayer(scan);
  };
  scan(layer);
  if (!polys.length && !lines.length) return null; /* nada que medir */
  let area = 0, perim = 0, allClosed = true;
  /* Una polilínea suma longitud pero NO toca `allClosed`: eso habla solo
     de si los anillos de los polígonos cierran. Un placemark KML puede
     traer un polígono y una línea juntos, y el área del polígono sigue
     siendo válida ahí.                                                */
  for (const line of lines) {
    const parts = line.getLatLngs();
    const rings = Array.isArray(parts[0]) ? parts : [parts];
    for (const ring of rings) perim += ringPerimeter(ring, false);
  }
  for (const poly of polys) {
    const rawParts = rawPolygonRings(poly.feature && poly.feature.geometry);
    polygonParts(poly.getLatLngs()).forEach((part, i) => {
      const rawRings = rawParts && rawParts[i]; /* anillos [lng,lat] del mismo polígono, en crudo */
      [part.outer, ...part.holes].forEach((ring, j) => {
        const raw = rawRings && rawRings[j];
        const closed = raw ? ringClosed(raw.map(([lng, lat]) => ({ lat, lng }))) : true;
        allClosed = allClosed && closed;
        perim += ringPerimeter(ring, closed);
      });
      /* El área se acumula siempre; se descarta al final si algún
         anillo no estaba cerrado, en vez de complicar el bucle con una
         salida anticipada.                                            */
      area += ringArea(part.outer) - part.holes.reduce((s, h) => s + ringArea(h), 0);
    });
  }
  /* Sin ningún polígono no hay área que dar: devolver 0 haría que la
     fila apareciera anunciando "0 m²" para una línea. `open` distingue
     "esto es una línea" de "esto es un polígono cuyo anillo no cierra":
     lo primero se mide en LONGITUD, no en perímetro.                  */
  return { area: polys.length && allClosed ? area : null, perim, open: !polys.length };
}

/* Una capa es "abierta" si tiene trazos y ninguno es un polígono
   cerrado. No puede tener área ni relleno: rellenar un trazo abierto
   obliga a Leaflet a cerrarlo por su cuenta para pintar la superficie,
   dibujando un lado que el usuario nunca trazó.                       */
function isOpenOnly(li) {
  const layer = nodeLayer(li);
  if (!layer) return false;
  let hasLine = false, hasPolygon = false;
  const scan = l => {
    if (l instanceof L.Polygon) hasPolygon = true;
    else if (l instanceof L.Polyline) hasLine = true;
    if (l.eachLayer) l.eachLayer(scan);
  };
  scan(layer);
  return hasLine && !hasPolygon;
}

/* ---------- Coordinate input formats ----------
   The dialog shows a position in one of two interchangeable notations:
   "dec" (decimal degrees) and "dms" (degrees, minutes and seconds with
   decimals). Parsing is deliberately permissive — it accepts either
   notation regardless of the selected one, with the sign given by a
   leading minus or by a hemisphere letter (N/S/E/W, plus the Spanish O
   for oeste) — so pasting a coordinate from anywhere just works.      */
function dmsParts(value, isLat) {
  const hemi = isLat ? (value < 0 ? "S" : "N") : (value < 0 ? "W" : "E");
  let rest = Math.round(Math.abs(value) * 360000) / 100; /* seconds, 2 dp */
  let d = Math.floor(rest / 3600); rest -= d * 3600;
  let m = Math.floor(rest / 60);
  let sec = Math.round((rest - m * 60) * 100) / 100;
  if (sec >= 60) { sec -= 60; m++; }        /* carries from the rounding */
  if (m >= 60) { m -= 60; d++; }
  return { d, m: String(m).padStart(2, "0"), sec: sec.toFixed(2).padStart(5, "0"), hemi };
}

function formatCoord(value, isLat, mode) {
  if (!isFinite(value)) return "";
  if (mode === "dms") {
    const { d, m, sec, hemi } = dmsParts(value, isLat);
    return `${d}\u00B0 ${m}' ${sec}" ${hemi}`;
  }
  return value.toFixed(6);
}

/* Compact GMS reading for the read-only coordinate readout (bottom-left
   box): no spaces between degrees/minutes/seconds/hemisphere, the way
   it's read on a nautical chart, with the degree figure in bold as the
   most-used field. HTML, not plain text \u2014 only for trusted, self-built
   content, never for `formatCoord`'s editable dialog fields.           */
function formatCoordCompactHtml(value, isLat) {
  if (!isFinite(value)) return "";
  const { d, m, sec, hemi } = dmsParts(value, isLat);
  return `<b>${d}\u00B0</b>${m}'${sec}"${hemi}`;
}

function parseCoord(txt, isLat) {
  const t = String(txt).trim().toUpperCase().replace(/,/g, ".");
  if (!t) return NaN;
  const nums = t.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length > 3) return NaN;
  const v = nums.map(Number);
  if (v.some(n => !isFinite(n))) return NaN;
  if (v.length > 1 && (v[1] < 0 || v[1] >= 60)) return NaN;   /* minutes  */
  if (v.length > 2 && (v[2] < 0 || v[2] >= 60)) return NaN;   /* seconds  */
  const hemi = (t.match(/[NSEWO]/) || [])[0];
  if (hemi && (isLat !== "NS".includes(hemi))) return NaN;    /* N/S vs E/W/O */
  let deg = Math.abs(v[0]) + (v[1] || 0) / 60 + (v[2] || 0) / 3600;
  if (v[0] < 0 || (hemi && "SWO".includes(hemi))) deg = -deg;
  return Math.abs(deg) <= (isLat ? 90 : 180) ? deg : NaN;
}

/* The single marker of a layer, or null when it has none or several:
   editing a position only makes sense for exactly one marker.        */
function soleMarker(li) {
  const layer = nodeLayer(li);
  if (!layer) return null;
  let found = null, count = 0;
  const scan = l => {
    if (l instanceof L.Marker) { found = l; count++; }
    if (l.eachLayer) l.eachLayer(scan);
  };
  scan(layer);
  return count === 1 ? found : null;
}

/* The single path (polygon or polyline) of a layer, or null when it has
   none or several: the point list edits one geometry, and with two
   shapes in the same layer there is no single list to show. Mirrors
   soleMarker, which does the same for the position of a marker.       */
function solePath(li) {
  const layer = nodeLayer(li);
  if (!layer) return null;
  let found = null, count = 0;
  const scan = l => {
    if (l instanceof L.Polyline) { found = l; count++; } /* cubre L.Polygon */
    if (l.eachLayer) l.eachLayer(scan);
  };
  scan(layer);
  return count === 1 ? found : null;
}

function setMarkerDraggable(mk, on) {
  mk.options.draggable = on;
  if (mk.dragging) { if (on) mk.dragging.enable(); else mk.dragging.disable(); }
}

/* ---------- Moving the dialogs ----------
   Both property dialogs can be dragged by their title so they stop
   covering the part of the map being worked on. On the first drag the box
   switches to fixed positioning (until then it is placed by its wrapper:
   pinned top-right for the styles, centred for the picker) and from there
   it keeps whatever position the user left it in. Pointer events cover
   mouse, pen and touch with a single code path.                        */
function clampToViewport(box) {
  if (!box.style.left) return; /* never moved: the wrapper still places it */
  const r = box.getBoundingClientRect();
  const left = Math.min(Math.max(parseFloat(box.style.left), 60 - r.width), window.innerWidth - 60);
  const top = Math.min(Math.max(parseFloat(box.style.top), 0), window.innerHeight - 34);
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}

/* ---------- Accesibilidad de los diálogos ----------
   Each dialog announces itself as such, keeps the keyboard inside while
   it is open (Tab cycles through its own controls) and hands focus back
   to whatever opened it when it closes. Escape already closes them.  */
function setupDialog(box, { modal }) {
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", String(modal));
  const title = box.querySelector("h2");
  if (title) {
    if (!title.id) title.id = `dlg-title-${Math.random().toString(36).slice(2, 8)}`;
    box.setAttribute("aria-labelledby", title.id);
  }
  box.addEventListener("keydown", e => {
    if (e.key !== "Tab") return;
    const focusables = [...box.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });
}

/* Focus goes to the dialog on open and back to the opener on close */
let focusReturn = [];
function focusDialog(box) {
  focusReturn.push(document.activeElement);
  const first = box.querySelector("button, input, select");
  if (first) first.focus();
}
function releaseFocus() {
  const back = focusReturn.pop();
  if (back && back.isConnected && back.focus) back.focus();
}

function makeDialogMovable(box) {
  const handle = box.querySelector("h2");
  let from = null;
  handle.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    const r = box.getBoundingClientRect();
    box.style.position = "fixed";
    box.style.margin = "0";
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    from = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener("pointermove", e => {
    if (!from) return;
    box.style.left = `${from.left + e.clientX - from.x}px`;
    box.style.top = `${from.top + e.clientY - from.y}px`;
    clampToViewport(box);
  });
  for (const ev of ["pointerup", "pointercancel"]) {
    handle.addEventListener(ev, () => { from = null; });
  }
}

/* ---------- Colour picker (with Cancelar / Aceptar) ----------
   The native <input type="color"> commits as soon as it changes, which
   clashes with the deferred editing of the dialogs. Each colour is
   therefore a button showing its value; pressing it opens this small
   dialog — full spectrum plus the palette used across the app — and the
   choice only reaches the draft when "Aceptar" is pressed.            */
const COLOR_PRESETS = [
  "#000000", "#4d4d4d", "#8c8c8c", "#ffffff", "#1b5e97", "#3388ff", "#00a3c4", "#00897b",
  "#2e7d32", "#8bc34a", "#f9a825", "#ef6c00", "#b04a3a", "#d32f2f", "#8e24aa", "#5e35b1"
];
const colorPicker = document.getElementById("color-picker");
const colorInput = document.getElementById("color-input");
let colorTarget = null; /* colour button being edited */

function setColorButton(btn, hex) {
  btn.dataset.color = hex;
  btn.style.background = hex;
}
const colorOf = btn => btn.dataset.color || "#000000";

function buildColorSwatches(current) {
  const box = document.getElementById("color-swatches");
  box.innerHTML = "";
  for (const hex of COLOR_PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.title = hex;
    b.style.background = hex;
    if (hex.toLowerCase() === current.toLowerCase()) b.classList.add("chosen");
    b.addEventListener("click", () => {
      colorInput.value = hex;
      for (const o of box.children) o.classList.toggle("chosen", o === b);
    });
    box.appendChild(b);
  }
}

function openColorPicker(btn) {
  colorTarget = btn;
  colorInput.value = colorOf(btn);
  buildColorSwatches(colorOf(btn));
  colorPicker.hidden = false;
  clampToViewport(colorBox);
  focusDialog(colorBox);
}
colorInput.addEventListener("input", () => buildColorSwatches(colorInput.value));
document.getElementById("color-cancel").addEventListener("click", () => {
  colorPicker.hidden = true;
  colorTarget = null;
  releaseFocus();
});
document.getElementById("color-accept").addEventListener("click", () => {
  if (colorTarget) {
    setColorButton(colorTarget, colorInput.value);
    /* feed the change into the draft of whichever dialog is open */
    if (styleDraft) readStyleControls();
  }
  colorPicker.hidden = true;
  colorTarget = null;
  releaseFocus();
});
for (const id of ["mk-color", "mk-text-color", "pg-color", "pg-fill-color",
                  "ms-color", "ms-fill-color"]) {
  document.getElementById(id).addEventListener("click", e => {
    e.preventDefault();
    openColorPicker(e.currentTarget);
  });
}

/* ---------- Confirmar la limpieza de etiquetas HTML en nombres KML ----------
   Mismo patrón que el selector de nombre de GeoJSON justo debajo: una
   Promise que addFileNode espera antes de seguir. "Dejarlas" resuelve
   con false (nombres tal cual); "Eliminarlas" con true.                */
const ktpDialog = document.getElementById("kml-tags-picker");
const ktpBox = ktpDialog.querySelector(".dlg-box");
const ktpIntro = document.getElementById("ktp-intro");
let ktpResolve = null;
function closeKtpPicker(result) {
  ktpDialog.hidden = true;
  const resolve = ktpResolve;
  ktpResolve = null;
  releaseFocus();
  if (resolve) resolve(result);
}
function confirmStripHtmlTags(fileName) {
  ktpIntro.textContent = `«${fileName}» tiene nombres con etiquetas de tipo HTML `
    + `(texto entre «<» y «>»), probablemente restos de la herramienta que generó `
    + `el KML. ¿Eliminarlas al importar?`;
  ktpDialog.hidden = false;
  clampToViewport(ktpBox);
  focusDialog(ktpBox);
  return new Promise(resolve => { ktpResolve = resolve; });
}
document.getElementById("ktp-cancel").addEventListener("click", () => closeKtpPicker(false));
document.getElementById("ktp-accept").addEventListener("click", () => closeKtpPicker(true));

/* ---------- Confirmar la fusión de placemarks duplicados ----------
   Mismo patrón que el diálogo anterior. "Mantener todos" resuelve con
   false; "Fusionar" con true.                                         */
const kdpDialog = document.getElementById("kml-dup-picker");
const kdpBox = kdpDialog.querySelector(".dlg-box");
const kdpIntro = document.getElementById("kdp-intro");
let kdpResolve = null;
function closeKdpPicker(result) {
  kdpDialog.hidden = true;
  const resolve = kdpResolve;
  kdpResolve = null;
  releaseFocus();
  if (resolve) resolve(result);
}
function confirmMergeDuplicates(fileName, groups) {
  const total = groups.reduce((n, g) => n + g.length - 1, 0);
  const plural = groups.length === 1 ? "" : "es";
  kdpIntro.textContent = `«${fileName}» tiene ${groups.length} nombre${plural} repetido${plural} `
    + `con la misma posición (${total} marcador(es) de más). ¿Fusionarlos y mantener solo uno de cada grupo?`;
  kdpDialog.hidden = false;
  clampToViewport(kdpBox);
  focusDialog(kdpBox);
  return new Promise(resolve => { kdpResolve = resolve; });
}
document.getElementById("kdp-cancel").addEventListener("click", () => closeKdpPicker(false));
document.getElementById("kdp-accept").addEventListener("click", () => closeKdpPicker(true));

/* ---------- Elegir la propiedad-nombre de un GeoJSON ambiguo ----------
   addFileNode es async y necesita ESPERAR la elección antes de seguir
   construyendo el árbol: mismo patrón que el diálogo anterior, una
   Promise en vez de eventos sueltos. Cancelar resuelve con null
   (nombrado automático de siempre, nada se guarda); Aceptar resuelve
   con la clave marcada.                                              */
const gnpDialog = document.getElementById("geojson-name-picker");
const gnpBox = gnpDialog.querySelector(".dlg-box");
const gnpList = document.getElementById("gnp-list");
const gnpIntro = document.getElementById("gnp-intro");
let gnpResolve = null;

function gnpPreview(v) {
  const s = stringifyPropValue(v);
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}

function closeGnpPicker(result) {
  gnpDialog.hidden = true;
  const resolve = gnpResolve;
  gnpResolve = null;
  releaseFocus();
  if (resolve) resolve(result);
}

function pickNameProperty(props, fileName, storedKey) {
  const keys = Object.keys(props);
  gnpIntro.textContent = storedKey
    ? `Para archivos con esta misma estructura de propiedades se guardó «${storedKey}» como nombre. Confirma o elige otra:`
    : `«${fileName}» no tiene una propiedad «name» ni «title». Elige cuál usar como nombre:`;
  gnpList.innerHTML = "";
  keys.forEach((k, i) => {
    const checked = storedKey ? k === storedKey : i === 0;
    const row = document.createElement("label");
    row.className = "gnp-row";
    row.innerHTML = `<input type="radio" name="gnp-key" value="${escapeHtml(k)}"${checked ? " checked" : ""}>`
      + `<span class="gnp-key">${escapeHtml(k)}</span>`
      + `<span class="gnp-val">${escapeHtml(gnpPreview(props[k]))}</span>`;
    gnpList.appendChild(row);
  });
  gnpDialog.hidden = false;
  clampToViewport(gnpBox);
  focusDialog(gnpBox);
  return new Promise(resolve => { gnpResolve = resolve; });
}
document.getElementById("gnp-cancel").addEventListener("click", () => closeGnpPicker(null));
document.getElementById("gnp-accept").addEventListener("click", () => {
  const checked = gnpList.querySelector("input[name=gnp-key]:checked");
  closeGnpPicker(checked ? checked.value : null);
});

/* ---------- Style dialog (single instance, deferred editing) ----------
   Nothing is applied to the map while the dialog is open: the controls
   write into `styleDraft`, and only "Aceptar" copies the draft into every
   target and repaints. "Cancelar" drops the draft, so the layers keep the
   style they had when the dialog was opened (including the icon).      */
const styleDialog = document.getElementById("style-dialog");
const iconPicker = document.getElementById("icon-picker");
const $id = id => document.getElementById(id);
const styleBox = styleDialog.querySelector(".dlg-box");
const iconBox = iconPicker.querySelector(".dlg-box");
const colorBox = document.querySelector("#color-picker .dlg-box");
const shortcutsDialog = document.getElementById("shortcuts");
const shortcutsBox = shortcutsDialog.querySelector(".dlg-box");
function toggleShortcuts() {
  shortcutsDialog.hidden = !shortcutsDialog.hidden;
  if (!shortcutsDialog.hidden) { clampToViewport(shortcutsBox); focusDialog(shortcutsBox); }
  else releaseFocus();
}
document.getElementById("shortcuts-close").addEventListener("click", toggleShortcuts);
document.getElementById("help-btn").addEventListener("click", toggleShortcuts);

/* ---------- Editor de asociaciones de nombre de GeoJSON recordadas ----------
   Aplicación inmediata (no hay Cancelar/Aceptar): es una lista de
   configuración, no una capa viva en el mapa, mismo patrón que el panel
   de mapas base (opacidades/orden se guardan al instante).           */
const gnpEditorDialog = document.getElementById("gnp-editor");
const gnpEditorBox = gnpEditorDialog.querySelector(".dlg-box");
const gnpEditorList = document.getElementById("gnp-editor-list");

function renderGnpEditor() {
  gnpEditorList.innerHTML = "";
  const entries = Object.entries(gnpStore || {});
  if (!entries.length) {
    const p = document.createElement("p");
    p.className = "dlg-hint";
    p.textContent = "Sin asociaciones guardadas todavía.";
    gnpEditorList.appendChild(p);
    return;
  }
  for (const [fp, value] of entries) {
    let keys;
    try { keys = JSON.parse(fp); } catch { keys = [fp]; }
    const row = document.createElement("div");
    row.className = "gnp-editor-row";
    const keysSpan = document.createElement("span");
    keysSpan.className = "gnp-editor-keys";
    keysSpan.textContent = keys.join(", ");
    keysSpan.title = keysSpan.textContent;
    const select = document.createElement("select");
    for (const k of keys) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k;
      if (k === value) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      gnpStore[fp] = select.value;
      dbSaveGnp(gnpStore);
    });
    const del = document.createElement("button");
    del.className = "btn";
    del.textContent = "Borrar";
    del.addEventListener("click", () => {
      delete gnpStore[fp];
      dbSaveGnp(gnpStore);
      renderGnpEditor();
    });
    row.append(keysSpan, select, del);
    gnpEditorList.appendChild(row);
  }
}

async function toggleGnpEditor() {
  if (!gnpEditorDialog.hidden) { gnpEditorDialog.hidden = true; releaseFocus(); return; }
  if (!gnpStore) gnpStore = await dbLoadGnp();
  renderGnpEditor();
  gnpEditorDialog.hidden = false;
  clampToViewport(gnpEditorBox);
  focusDialog(gnpEditorBox);
}
document.getElementById("gnp-editor-btn").addEventListener("click", toggleGnpEditor);
document.getElementById("gnp-editor-close").addEventListener("click", toggleGnpEditor);
document.getElementById("gnp-editor-clear").addEventListener("click", () => {
  gnpStore = {};
  dbSaveGnp(gnpStore);
  renderGnpEditor();
});

/* ---------- Diálogo de la lista de puntos ----------
   Edición diferida como el resto: se escribe en el área de texto y solo
   «Aceptar» toca la capa. El nodo se guarda al abrir porque el diálogo
   de estilos es flotante y el usuario podría cambiar de fila.         */
const pointsDialog = document.getElementById("points-dialog");
const pointsBox = pointsDialog.querySelector(".dlg-box");
const pointsText = document.getElementById("points-text");
const pointsError = document.getElementById("points-error");
let pointsTarget = null;  /* { li, path, nested } mientras está abierto */

function closePointsDialog() {
  pointsDialog.hidden = true;
  pointsTarget = null;
  releaseFocus();
}

function openPointsDialog(li) {
  const path = solePath(li);
  if (!path) return;
  const { rings, nested } = pathRings(path);
  pointsTarget = { li, path, nested };
  pointsText.value = pointsToText(rings);
  pointsText.classList.remove("bad");
  pointsError.hidden = true;
  const total = rings.reduce((n, r) => n + r.length, 0);
  $id("points-title").textContent = `Puntos de «${li._name}»`;
  $id("points-count").textContent = `${total} punto${total === 1 ? "" : "s"}`;
  /* Solo se explica la separación por anillos cuando de verdad hay más
     de uno: en el caso corriente sobra el detalle.                    */
  const ringsHint = $id("points-rings");
  ringsHint.hidden = rings.length < 2;
  ringsHint.textContent = rings.length < 2 ? ""
    : `Esta capa tiene ${rings.length} trazos (contorno exterior primero, luego los `
      + "agujeros). Van separados por una línea en blanco; mantén esa separación.";
  pointsDialog.hidden = false;
  clampToViewport(pointsBox);
  focusDialog(pointsBox);
}
$id("pg-points").addEventListener("click", () => {
  if (styleTargets.length === 1) openPointsDialog(styleTargets[0]);
});
$id("points-cancel").addEventListener("click", closePointsDialog);
$id("points-accept").addEventListener("click", () => {
  if (!pointsTarget) return closePointsDialog();
  const { li, path, nested } = pointsTarget;
  const { rings, errors } = textToPoints(pointsText.value);
  const closed = path instanceof L.Polygon;
  const min = closed ? 3 : 2;
  const bad = msg => {
    /* No se cierra con la lista rota: mismo criterio que las
       coordenadas del diálogo de estilos.                            */
    pointsError.textContent = msg;
    pointsError.hidden = false;
    pointsText.classList.add("bad");
    pointsText.focus();
  };
  if (errors.length) {
    const list = errors.slice(0, 3).map(e => `línea ${e.line} (${e.why})`).join("; ");
    return bad(`Hay ${errors.length} línea${errors.length === 1 ? "" : "s"} que no se entienden: `
      + list + (errors.length > 3 ? "…" : "") + ".");
  }
  if (!rings.length) return bad("No queda ningún punto.");
  const short = rings.find(r => r.length < min);
  if (short) {
    return bad(closed
      ? `Cada trazo de un polígono necesita al menos 3 puntos; hay uno con ${short.length}.`
      : `Una línea necesita al menos 2 puntos; hay un trazo con ${short.length}.`);
  }
  pushUndo("editar puntos");
  path.setLatLngs(nested || rings.length > 1 ? rings : rings[0]);
  invalidateGeo(li);   /* la geometría cambió: la caché serializada ya no vale */
  scheduleSave();
  closePointsDialog();
  /* El diálogo de estilos sigue abierto detrás y muestra medidas ya
     obsoletas: se recalculan con la geometría nueva.                 */
  if (!styleDialog.hidden && styleTargets[0] === li) {
    polyMeasures = polygonMeasures(li);
    $id("pg-measures").hidden = !polyMeasures;
    if (polyMeasures) renderPolyMeasures();
  }
});

