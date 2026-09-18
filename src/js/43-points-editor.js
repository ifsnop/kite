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

/* ---------- Edición interactiva de vértices (arrastrar y borrar) ----------
   Complementa al editor de texto («Ver y editar…», sigue existiendo
   para listas grandes o ediciones masivas): mientras el diálogo de
   estilos edita UN polígono, sus vértices se pueden arrastrar
   (Ctrl+arrastre, el mismo gesto reservado que ya usan las mediciones)
   y borrar (clic derecho), directamente sobre el mapa. Mismo patrón que
   la posición de un marcador (posMarker/onMarkerDragged): en vivo sobre
   la capa REAL, pero diferido de verdad — «Cancelar» restaura los
   vértices originales, «Aceptar» los deja como estén.

   Por debajo de VERTEX_EDIT_MAX vértices se construyen manejadores; por
   encima, ninguno — demasiados manejadores son otros tantos nodos del
   DOM (los marcadores de Leaflet siempre lo son, nunca van por canvas,
   como ya advierte ELEV_ACCUM_MAX_CELLS) y el editor de texto ya cubre
   ese caso sin problema. Medido en el navegador (Chromium, construir
   los manejadores de un anillo sintético, sin la caché de geometría de
   por medio): 500 vértices, 12-30 ms según la ejecución; 2000, ~85 ms;
   4000, ~213 ms — el coste crece con N, y 500 se queda cómodamente por
   debajo del umbral de "se siente instantáneo" (~100 ms) incluso con
   margen para un equipo más lento que esta VM de desarrollo.         */
const VERTEX_EDIT_MAX = 500;

let vertexEdit = null; /* { li, layer, rings, handleRings, nested, closed, group, originalLatLngs } o null */

/* Copia independiente de una estructura de anillos (array de L.LatLng, o
   array de arrays): ni `rings` ni `originalLatLngs` deben compartir los
   objetos que Leaflet tiene en su _latlngs interno, o "cancelar" no
   tendría a qué volver.                                                */
function cloneLatLngRings(rings) {
  return rings.map(r => r.map(p => L.latLng(p.lat, p.lng)));
}

function beginVertexEdit(li) {
  const layer = solePath(li);
  if (!layer) return;
  const { rings: liveRings, nested } = pathRings(layer);
  const total = liveRings.reduce((n, r) => n + r.length, 0);
  if (!total || total > VERTEX_EDIT_MAX) return;
  const rings = cloneLatLngRings(liveRings);
  const originalLatLngs = cloneLatLngRings(liveRings);
  const group = L.featureGroup().addTo(rootGroup);
  const handleRings = rings.map(ring => ring.map(pos => {
    const h = makeHandle(pos);
    wireVertexEditHandle(h);
    group.addLayer(h);
    return h;
  }));
  vertexEdit = { li, layer, rings, handleRings, nested,
                 closed: layer instanceof L.Polygon, group, originalLatLngs };
}

/* Vuelca vertexEdit.rings a la capa real y recalcula lo que enseña el
   diálogo (perímetro/área): las mismas dos funciones que ya usa el
   editor de texto al aceptar, aquí en cada arrastre/borrado.          */
function applyVertexEditRings() {
  const { layer, rings, nested } = vertexEdit;
  layer.setLatLngs(nested || rings.length > 1 ? rings : rings[0]);
  invalidateGeo(vertexEdit.li);
  polyMeasures = polygonMeasures(vertexEdit.li);
  renderPolyMeasures();
}

/* Busca en qué anillo/posición vive un manejador AHORA MISMO: no se
   captura el índice al crearlo porque borrar uno de en medio desplaza
   los que le siguen (mismo motivo que ya explica addPolyVertex).      */
function findVertexEditPos(handle) {
  for (let ri = 0; ri < vertexEdit.handleRings.length; ri++) {
    const pi = vertexEdit.handleRings[ri].indexOf(handle);
    if (pi !== -1) return [ri, pi];
  }
  return null;
}

function wireVertexEditHandle(handle) {
  attachVertexDrag(handle, true, latlng => {
    const pos = findVertexEditPos(handle);
    if (!pos) return;
    vertexEdit.rings[pos[0]][pos[1]] = latlng;
    applyVertexEditRings();
  }, null);
  handle.on("contextmenu", ev => {
    L.DomEvent.stop(ev.originalEvent);
    removeVertexEditPoint(handle);
  });
}

/* Mismo mínimo que ya exige el editor de texto y el dibujo a mano: 3
   vértices por anillo cerrado, 2 en una forma abierta.                */
function removeVertexEditPoint(handle) {
  const pos = findVertexEditPos(handle);
  if (!pos) return;
  const [ri, pi] = pos;
  const min = vertexEdit.closed ? 3 : 2;
  if (vertexEdit.rings[ri].length <= min) {
    navMessage(vertexEdit.closed
      ? "Faltan vértices para seguir siendo un polígono (mínimo 3 por anillo)."
      : "Faltan vértices para seguir siendo una línea (mínimo 2).");
    return;
  }
  vertexEdit.rings[ri].splice(pi, 1);
  vertexEdit.handleRings[ri].splice(pi, 1);
  vertexEdit.group.removeLayer(handle);
  applyVertexEditRings();
}

/* Cierra la edición interactiva: `commit` false restaura los vértices
   originales (edición diferida, igual que la posición de un marcador);
   en los dos casos se retiran los manejadores temporales.             */
function endVertexEdit(commit) {
  if (!vertexEdit) return;
  if (!commit) {
    const { layer, originalLatLngs, nested } = vertexEdit;
    layer.setLatLngs(nested || originalLatLngs.length > 1 ? originalLatLngs : originalLatLngs[0]);
    invalidateGeo(vertexEdit.li);
  }
  rootGroup.removeLayer(vertexEdit.group);
  vertexEdit = null;
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

/* ---------- Colour picker (popover, one gesture, fully ours) ----------
   Used to be a full second modal window (its own Cancelar/Aceptar),
   stacked as a centred .dlg-overlay regardless of where the style
   dialog was — reported bug: it landed on top of the style dialog,
   nearly covering its own buttons. Fixed by turning it into a popover.

   That popover still used a native <input type="color"> for the full
   spectrum, and THAT was its own unfixable version of the same
   complaint: clicking it opens the browser's OWN colour panel, which
   lives outside our DOM entirely — no script can close it, reposition
   it, or make pressing "the big button" again dismiss it, because that
   panel was never ours to begin with. "One integrated dialog" cannot
   be true while part of it is a browser-native popup we don't control.
   So the spectrum is now two <canvas> elements (saturation/value, and
   hue) that we draw and handle ourselves, plus a text field — nothing
   here ever leaves our own DOM, so every close gesture (repeat the
   opening button, click outside, Escape) works on it exactly like on
   the rest of the popover.

   Reported bug (round 2): the popover had NO Cancelar/Aceptar of its
   own, so every gesture — a drag release, a swatch click, Enter in the
   text field — committed AND closed in one step. That contradicts the
   project's own deferred-editing rule: a change must never be final
   without the user choosing to make it so. Now dragging the spectrum,
   clicking a swatch or typing a value only PREVIEWS live on the actual
   edited element (`colorOnPreview`: the button's swatch, and for a
   marker's colour, its icon preview too) — nothing is saved. Saving
   only happens in `acceptColorPicker` (`colorOnCommit`), and every other
   way of leaving the popover (Cancelar, a click outside, repeating the
   opening button, Escape) is a discard: `cancelColorPicker` restores
   `colorOriginal`, the hex the target had when the popover opened.
   `openColorPicker`'s second argument lets a caller outside the style
   dialog (the base-map background colour, see 11-base-panel.js) supply
   its own preview/commit behaviour instead of touching styleDraft.    */
const COLOR_PRESETS = [
  "#000000", "#4d4d4d", "#8c8c8c", "#ffffff", "#1b5e97", "#3388ff", "#00a3c4", "#00897b",
  "#2e7d32", "#8bc34a", "#f9a825", "#ef6c00", "#b04a3a", "#d32f2f", "#8e24aa", "#5e35b1"
];
/* The four numeric notations the value fields can show, cycled with the
   ‹ › arrows — same idea as the ⇅ button that toggles a marker's
   coordinates between "dec" and "dms", generalised to more than two
   states. Purely a display/input preference: it does not change what
   gets picked, only how the current colour is split into fields.
   Each mode lists its channels: `label` (shown above the field and used
   in its `aria-label`) plus `min`/`max` for a numeric spinner, or
   `text: true` for Hex, which isn't a channel value. ONE INPUT PER
   CHANNEL on purpose — no separator ("255, 0, 0") to parse, so there is
   no parsing logic to keep in sync with what the fields can contain,
   and the browser's own number spinner (arrows, wheel, drag) works on
   each channel for free.                                              */
const COLOR_MODES = ["hex", "rgb", "cmyk", "hsv"];
const COLOR_MODE_LABELS = { hex: "HEX", rgb: "RGB", cmyk: "CMYK", hsv: "HSV" };
const COLOR_MODE_FIELDS = {
  hex: [{ label: "Hex", text: true }],
  rgb: [{ label: "R", min: 0, max: 255 }, { label: "G", min: 0, max: 255 }, { label: "B", min: 0, max: 255 }],
  cmyk: [{ label: "C", min: 0, max: 100 }, { label: "M", min: 0, max: 100 },
         { label: "Y", min: 0, max: 100 }, { label: "K", min: 0, max: 100 }],
  hsv: [{ label: "H", min: 0, max: 360 }, { label: "S", min: 0, max: 100 }, { label: "V", min: 0, max: 100 }]
};
const colorPicker = document.getElementById("color-picker");
const svCanvas = document.getElementById("color-sv");
const hueCanvas = document.getElementById("color-hue");
const svCtx = svCanvas.getContext("2d");
const hueCtx = hueCanvas.getContext("2d");
const colorPreview = document.getElementById("color-preview");
const colorModeLabel = document.getElementById("color-mode-label");
const colorFieldWraps = [0, 1, 2, 3].map(i => document.getElementById(`color-field-${i}`));
const colorFieldLabels = colorFieldWraps.map(w => w.querySelector(".color-field-label"));
const colorFieldEls = colorFieldWraps.map(w => w.querySelector("input"));
let colorTarget = null;    /* colour button being edited */
let colorOriginal = null;  /* its hex when the popover opened: what Cancelar restores */
let colorOnPreview = null; /* (btn, hex) => void — live, never persisted */
let colorOnCommit = null;  /* (btn, hex) => void — the actual save, only on Aceptar */
let colorMode = "hex";     /* current notation of the value fields; not persisted, like posFormat */
let pickH = 210, pickS = 1, pickV = 1; /* current spectrum position, HSV */

function setColorButton(btn, hex) {
  btn.dataset.color = hex;
  btn.style.background = hex;
}
const colorOf = btn => btn.dataset.color || "#000000";

/* Default preview, for the six style-dialog buttons: only the button's
   swatch (and, for a marker's colour, its icon preview) changes — never
   styleDraft and never the live layer, which still waits for the outer
   dialog's own "Aceptar".                                             */
function defaultColorPreview(btn, hex) {
  setColorButton(btn, hex);
  if (btn.id === "mk-color" && styleDraft) {
    document.getElementById("icon-preview").src = iconUrl(styleDraft.icon, hex, 20);
  }
}
/* Default commit: the visual value is already there (defaultColorPreview
   put it there), so this only makes it part of the draft for real — the
   same touchControl()+readStyleControls() the old immediate commit did,
   just gated behind Aceptar instead of behind any single gesture.      */
function defaultColorCommit(btn) {
  touchControl(btn);
  if (styleDraft) readStyleControls();
}

function buildColorSwatches(current) {
  const box = document.getElementById("color-swatches");
  box.innerHTML = "";
  for (const hex of COLOR_PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.title = hex;
    b.style.background = hex;
    if (hex.toLowerCase() === current.toLowerCase()) b.classList.add("chosen");
    b.addEventListener("click", () => pickHex(hex));
    box.appendChild(b);
  }
}

/* ---- HSV <-> RGB <-> hex, just enough for the two canvases ---- */
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(n => n.toString(16).padStart(2, "0")).join("");
}
function hexToRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [1, 2, 3].map(i => parseInt(m[i], 16)) : [0, 0, 0];
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return [h < 0 ? h + 360 : h, max ? d / max : 0, max];
}
/* CMYK, the fourth notation offered in the text field: subtractive, and
   only meaningful for print — nothing downstream of the picker uses it,
   it exists purely as an input/reading convenience. The 0-100 range
   (not 0-1) matches how it is always quoted (e.g. "0, 100, 100, 0").  */
function rgbToCmyk(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k]
    .map(v => Math.round(v * 100));
}
function cmykToRgb(c, m, y, k) {
  c /= 100; m /= 100; y /= 100; k /= 100;
  return [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)]
    .map(v => Math.round(v));
}
const clamp01 = n => Math.min(1, Math.max(0, n));

function drawHue() {
  const w = hueCanvas.width, h = hueCanvas.height;
  const grad = hueCtx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${i * 60}, 100%, 50%)`);
  hueCtx.fillStyle = grad;
  hueCtx.fillRect(0, 0, w, h);
  const x = (pickH / 360) * w;
  hueCtx.strokeStyle = "#fff"; hueCtx.lineWidth = 2; hueCtx.strokeRect(x - 2, 0, 4, h);
  hueCtx.strokeStyle = "rgba(0,0,0,.4)"; hueCtx.lineWidth = 1; hueCtx.strokeRect(x - 2.5, 0.5, 5, h - 1);
}
/* The square's own base colour is the pure hue at full saturation/value;
   a white-to-transparent wash left-to-right gives saturation, a
   transparent-to-black wash top-to-bottom gives value — the standard
   construction for this widget, done with two overlaid gradients.    */
function drawSv() {
  const w = svCanvas.width, h = svCanvas.height;
  const [r, g, b] = hsvToRgb(pickH, 1, 1);
  svCtx.fillStyle = `rgb(${r},${g},${b})`;
  svCtx.fillRect(0, 0, w, h);
  let grad = svCtx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#fff"); grad.addColorStop(1, "rgba(255,255,255,0)");
  svCtx.fillStyle = grad; svCtx.fillRect(0, 0, w, h);
  grad = svCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(1, "#000");
  svCtx.fillStyle = grad; svCtx.fillRect(0, 0, w, h);
  const mx = pickS * w, my = (1 - pickV) * h;
  svCtx.beginPath(); svCtx.arc(mx, my, 5, 0, Math.PI * 2);
  svCtx.strokeStyle = "#fff"; svCtx.lineWidth = 2; svCtx.stroke();
  svCtx.strokeStyle = "rgba(0,0,0,.4)"; svCtx.lineWidth = 1; svCtx.stroke();
}
function currentHex() { return rgbToHex(...hsvToRgb(pickH, pickS, pickV)); }
/* Writes the current HSV position into whichever fields the active mode
   uses. Kept apart from the fields' OWN `input` handler (below) because
   an external pick (a swatch, a spectrum drag, switching mode) is the
   only time the fields should be overwritten wholesale — doing it on
   every keystroke while the user is typing INTO one of them would fight
   the caret (see the comment on `colorFieldEls` `input` below).       */
function writeFieldsToMode() {
  const [r, g, b] = hsvToRgb(pickH, pickS, pickV);
  const values = colorMode === "hex" ? [rgbToHex(r, g, b)]
    : colorMode === "rgb" ? [r, g, b]
    : colorMode === "cmyk" ? rgbToCmyk(r, g, b)
    : [Math.round(pickH), Math.round(pickS * 100), Math.round(pickV * 100)]; /* hsv */
  values.forEach((v, i) => { colorFieldEls[i].value = v; });
}
function refreshPreview() {
  const hex = currentHex();
  colorPreview.style.background = hex;
  writeFieldsToMode();
  return hex;
}
function setFromHex(hex) {
  [pickH, pickS, pickV] = rgbToHsv(...hexToRgb(hex));
  drawHue(); drawSv(); refreshPreview();
}
/* ‹ › cycle through COLOR_MODES; wraps both ways. Switching notation
   never changes the colour, only how many fields show and what they
   mean — same "preference, not state" role as posFormat. Fields the
   mode doesn't use are hidden, not removed: `COLOR_MODE_FIELDS` always
   describes the first N of the four, so the rest just stay `hidden`.  */
function setColorMode(mode) {
  colorMode = mode;
  colorModeLabel.textContent = COLOR_MODE_LABELS[mode];
  const fields = COLOR_MODE_FIELDS[mode];
  colorFieldWraps.forEach((wrap, i) => {
    const f = fields[i];
    wrap.hidden = !f;
    if (!f) return;
    colorFieldLabels[i].textContent = f.label;
    const el = colorFieldEls[i];
    el.setAttribute("aria-label", `${f.label} (${COLOR_MODE_LABELS[mode]})`);
    if (f.text) { el.type = "text"; el.removeAttribute("min"); el.removeAttribute("max"); el.maxLength = 7; }
    else { el.type = "number"; el.min = f.min; el.max = f.max; el.step = 1; el.removeAttribute("maxlength"); }
  });
  writeFieldsToMode();
}
function cycleColorMode(delta) {
  const i = COLOR_MODES.indexOf(colorMode);
  setColorMode(COLOR_MODES[(i + delta + COLOR_MODES.length) % COLOR_MODES.length]);
}
document.getElementById("color-mode-prev").addEventListener("click", () => cycleColorMode(-1));
document.getElementById("color-mode-next").addEventListener("click", () => cycleColorMode(1));

/* Picking a colour (a swatch, a spectrum drag, a confirmed field value)
   only moves the spectrum position and PREVIEWS on the actual target —
   see the comment atop this section. It never closes the popover and
   never calls `colorOnCommit`: that only happens in `acceptColorPicker`. */
function pickHex(hex) {
  setFromHex(hex);
  if (colorTarget && colorOnPreview) colorOnPreview(colorTarget, hex);
}

/* Drag on either canvas: pointer capture so the gesture keeps tracking
   even if the cursor leaves the small canvas mid-drag (same technique
   as makeDialogMovable's title-bar drag). Every move previews live —
   there is no separate "commit on release" step any more, since NO
   gesture on the spectrum commits: only Aceptar does.                */
function wireSpectrumDrag(canvas, onMove) {
  let dragging = false;
  const step = e => {
    const r = canvas.getBoundingClientRect();
    onMove(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
  };
  canvas.addEventListener("pointerdown", e => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    step(e);
  });
  canvas.addEventListener("pointermove", e => { if (dragging) step(e); });
  const stop = () => { dragging = false; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
}
function livePreview() {
  const hex = refreshPreview();
  if (colorTarget && colorOnPreview) colorOnPreview(colorTarget, hex);
  return hex;
}
wireSpectrumDrag(svCanvas, (x, y) => { pickS = x; pickV = 1 - y; drawSv(); livePreview(); });
wireSpectrumDrag(hueCanvas, x => { pickH = x * 360; drawHue(); drawSv(); livePreview(); });

/* Reads the CURRENTLY VISIBLE fields for the active mode straight into a
   hex colour — no separator to split, each channel comes from its own
   `<input>.value`. `null` means "incomplete or out of range", which is
   the normal state of a field mid-edit (e.g. empty right after
   Ctrl+A+Delete) and is not an error to report, just "not ready yet". */
function readFieldsToHex() {
  const fields = COLOR_MODE_FIELDS[colorMode];
  if (colorMode === "hex") {
    const v = colorFieldEls[0].value.trim().toLowerCase();
    return /^#?[0-9a-f]{6}$/.test(v) ? (v[0] === "#" ? v : "#" + v) : null;
  }
  const nums = fields.map((f, i) => {
    const n = Number(colorFieldEls[i].value);
    return colorFieldEls[i].value !== "" && isFinite(n) && n >= f.min && n <= f.max ? n : null;
  });
  if (nums.some(n => n === null)) return null;
  if (colorMode === "rgb") return rgbToHex(...nums);
  if (colorMode === "cmyk") return rgbToHex(...cmykToRgb(...nums));
  return rgbToHex(...hsvToRgb(nums[0], nums[1] / 100, nums[2] / 100)); /* hsv */
}
/* Fires on every keystroke, arrow-key nudge and wheel/drag tick of a
   number field's native spinner: previews the SPECTRUM AND SWATCH from
   whatever is currently typed, but deliberately does NOT call
   `writeFieldsToMode()` (unlike every other pick above) — that would
   overwrite the very field the user is mid-typing with a "cleaned up"
   value on each keystroke, which resets the caret to the end and makes
   typing a multi-digit number fight the input. The fields only get
   rewritten wholesale by an EXTERNAL pick (swatch, drag, mode switch).  */
function onFieldInput() {
  const hex = readFieldsToHex();
  if (!hex) return;
  [pickH, pickS, pickV] = rgbToHsv(...hexToRgb(hex));
  drawHue(); drawSv();
  colorPreview.style.background = hex;
  if (colorTarget && colorOnPreview) colorOnPreview(colorTarget, hex);
}
/* Enter (or leaving the field) normalises what's shown — e.g. filling in
   a leading "#", or snapping an out-of-range/incomplete value back to
   the last good one — same role `commitColorHex` used to play for the
   single text field. Nothing here closes the popover: only Aceptar does,
   so there is no `.blur()`-triggered reentrancy to worry about either. */
function commitFields() {
  const hex = readFieldsToHex();
  if (hex) pickHex(hex); else writeFieldsToMode();
}
colorFieldEls.forEach(el => {
  el.addEventListener("input", onFieldInput);
  el.addEventListener("change", commitFields);
  el.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    commitFields();
  });
});

/* Anchored to the button that opened it, not centred on the viewport:
   below it by default, flipped above when there is no room below, and
   clamped so it never runs off either edge. Measuring offsetWidth/Height
   needs the element laid out first, so `hidden` comes off before this
   runs — same tick, so nothing visibly flashes at the wrong spot.
   Gaining its own Cancelar/Aceptar (and the notation row) made the
   popover tall enough to reach down past the WINDOW edge check and
   into the host dialog's own sticky Aceptar/Cancelar bar — the exact
   overlap this popover exists to avoid (see the original centred-modal
   bug in CLAUDE.md). So "room below" is capped not just by the window
   but by that bar's top too, when the button lives inside one.       */
function positionColorPicker(btn) {
  const r = btn.getBoundingClientRect();
  const w = colorPicker.offsetWidth, h = colorPicker.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - w - 8);
  left = Math.max(left, 8);
  const hostBox = btn.closest(".dlg-box");
  const hostActions = hostBox && hostBox.querySelector(".dlg-actions");
  const limit = Math.min(window.innerHeight - 8,
    hostActions ? hostActions.getBoundingClientRect().top - 6 : Infinity);
  let top = r.bottom + 6;
  if (top + h > limit) top = r.top - h - 6;
  top = Math.max(top, 8);
  colorPicker.style.left = `${left}px`;
  colorPicker.style.top = `${top}px`;
}

function openColorPicker(btn, { onPreview = defaultColorPreview, onCommit = defaultColorCommit } = {}) {
  colorTarget = btn;
  colorOriginal = colorOf(btn);
  colorOnPreview = onPreview;
  colorOnCommit = onCommit;
  setFromHex(colorOriginal);
  buildColorSwatches(colorOriginal);
  setColorMode(colorMode); /* re-format the field for whatever notation was left selected */
  colorPicker.hidden = false;
  positionColorPicker(btn);
  focusDialog(colorPicker);
}
/* Pure cleanup: hides the popover and drops its state. Never decides by
   itself whether the pending colour is kept or discarded — that is
   `acceptColorPicker`'s or `cancelColorPicker`'s job, always called
   first.                                                              */
function closeColorPicker() {
  colorPicker.hidden = true;
  colorTarget = null;
  colorOnPreview = null;
  colorOnCommit = null;
  releaseFocus();
}
/* The only gesture that makes a colour final. */
function acceptColorPicker() {
  if (colorTarget && colorOnCommit) colorOnCommit(colorTarget, currentHex());
  closeColorPicker();
}
/* Every other way of leaving the popover is a discard: restore the hex
   the target had when it opened (`colorOnPreview`, the same function
   that applied every live preview, undoes them the same way) and close
   without ever calling `colorOnCommit`.                               */
function cancelColorPicker() {
  if (colorTarget && colorOnPreview) colorOnPreview(colorTarget, colorOriginal);
  closeColorPicker();
}
document.getElementById("color-accept").addEventListener("click", acceptColorPicker);
document.getElementById("color-cancel").addEventListener("click", cancelColorPicker);
/* The button itself is a close gesture too: pulsing the same swatch
   that opened the popover closes it again — as a CANCEL, same as
   Escape or a click outside, not as an accept. "Click outside" (below)
   is a convenience on top of this, not a replacement for it.          */
function toggleColorPicker(btn, opts) {
  if (!colorPicker.hidden && colorTarget === btn) { cancelColorPicker(); return; }
  openColorPicker(btn, opts);
}
/* Closing without accepting: click outside the popover and outside the
   button that opened it (so re-clicking that same button hits the
   toggle branch above instead of closing-then-reopening).
   "click", not "mousedown": a control marked with
   L.DomEvent.disableClickPropagation (the base-maps panel, the
   measure/view toolbars…) stops mousedown/dblclick/contextmenu from
   reaching the map — but NOT plain click, which Leaflet leaves alone
   (see clickOnControl's comment in 52-measure.js for the same trap hit
   before). The colour button of the map-background row lives inside
   exactly such a panel, so a mousedown listener here never saw a click
   anywhere in that panel — reported bug: opening the popover from that
   button and then clicking elsewhere in the SAME panel couldn't close
   it with the mouse at all, only Escape did.                          */
document.addEventListener("click", e => {
  if (colorPicker.hidden) return;
  if (colorPicker.contains(e.target)) return;
  if (colorTarget && colorTarget.contains(e.target)) return;
  cancelColorPicker();
});
for (const id of ["mk-color", "mk-text-color", "pg-color", "pg-fill-color",
                  "ms-color", "ms-fill-color"]) {
  document.getElementById(id).addEventListener("click", e => {
    e.preventDefault();
    toggleColorPicker(e.currentTarget);
  });
}

/* ---------- Confirmar la limpieza de etiquetas HTML en nombres KML ----------
   Mismo patrón que el selector de nombre de GeoJSON justo debajo: una
   Promise que addFileNode espera antes de seguir. "Dejarlas" resuelve
   con false (nombres tal cual); "Eliminarlas" con true.                */
const ktpDialog = document.getElementById("kml-tags-picker");
const ktpBox = ktpDialog.querySelector(".dlg-box");
const ktpIntro = document.getElementById("ktp-intro");
const ktpTitle = document.getElementById("ktp-title");
let ktpResolve = null;
function closeKtpPicker(result) {
  ktpDialog.hidden = true;
  const resolve = ktpResolve;
  ktpResolve = null;
  releaseFocus();
  if (resolve) resolve(result);
}
/* `kind` distingue los dos llamantes: los <name> de un KML y las
   `properties` de un GeoJSON. El diálogo es el mismo —mismo problema,
   misma decisión del usuario— y solo cambia de qué habla.            */
const KTP_WORDING = {
  names: { titulo: "Etiquetas en los nombres", donde: "nombres", origen: "el KML" },
  properties: { titulo: "Etiquetas en las propiedades", donde: "propiedades", origen: "el archivo" }
};
function confirmStripHtmlTags(fileName, kind = "names") {
  const w = KTP_WORDING[kind] || KTP_WORDING.names;
  ktpTitle.textContent = w.titulo;
  ktpIntro.textContent = `«${fileName}» tiene ${w.donde} con etiquetas de tipo HTML `
    + `(texto entre «<» y «>»), probablemente restos de la herramienta que generó `
    + `${w.origen}. ¿Eliminarlas al importar?`;
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
  /* "s", no "es": el plural se pega a «nombre» y a «repetido», no a
     «marcador(es)». Decía «2 nombrees repetidoes».                    */
  const plural = groups.length === 1 ? "" : "s";
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
/* No colorBox: the colour popover (#color-picker) IS its own box now,
   not a wrapper around a nested .dlg-box — see openColorPicker.      */
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

