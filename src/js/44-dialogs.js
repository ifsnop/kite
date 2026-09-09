/* ---------- Registro de avisos ----------
   Ventana al `msgLog` de la sesión (ver navMessage). Existe porque un
   aviso transitorio se va a los MSG_TIMEOUT y antes no quedaba rastro
   de él.                                                              */
const logDialog = document.getElementById("log-dialog");
const logBox = logDialog.querySelector(".dlg-box");

/* Se busca el botón por id en cada llamada, no con una constante de
   módulo: navMessage llama aquí y hay un aviso a nivel de módulo en un
   archivo ANTERIOR (el de aceleración por hardware), cuando una `const`
   de este archivo estaría todavía en su zona muerta temporal.        */
function refreshLogButton() {
  const btn = document.getElementById("log-btn");
  if (!btn) return;
  btn.classList.toggle("unseen", msgLogUnseen > 0);
  btn.title = msgLogUnseen
    ? `Registro de avisos (${msgLogUnseen} sin ver)`
    : "Registro de avisos";
}

function renderLog() {
  const list = document.getElementById("log-list");
  list.textContent = "";
  if (!msgLog.length) {
    const p = document.createElement("p");
    p.className = "log-empty";
    p.textContent = "No hay avisos en esta sesión.";
    list.appendChild(p);
    return;
  }
  /* Orden cronológico, lo más reciente al final: se lee como un fichero
     de log, y como el propio panel, donde los avisos nuevos se añaden
     debajo de los anteriores.                                         */
  for (const e of msgLog) {
    const row = document.createElement("div");
    row.className = `log-row ${e.tone}`;
    const time = document.createElement("time");
    time.className = "log-time";
    time.textContent = msgStamp(e.first);
    const mark = document.createElement("span");
    mark.className = "log-mark";
    if (e.sticky) { mark.textContent = "!"; mark.title = "Exigía confirmación"; }
    const text = document.createElement("span");
    text.className = "log-text";
    text.textContent = e.text;
    if (e.count > 1) {
      const rep = document.createElement("span");
      rep.className = "log-rep";
      rep.textContent = ` ×${e.count}, última ${msgStamp(e.last)}`;
      text.appendChild(rep);
    }
    row.append(time, mark, text);
    list.appendChild(row);
  }
}

function toggleLog() {
  if (!logDialog.hidden) { logDialog.hidden = true; releaseFocus(); return; }
  renderLog();
  msgLogUnseen = 0;
  refreshLogButton();
  logDialog.hidden = false;
  clampToViewport(logBox);
  focusDialog(logBox);
  /* Con lo más reciente abajo, hay que bajar el scroll o habría que
     desplazarse a mano justo a lo que se viene a consultar.          */
  const list = document.getElementById("log-list");
  list.scrollTop = list.scrollHeight;
}
document.getElementById("log-btn").addEventListener("click", toggleLog);
document.getElementById("log-close").addEventListener("click", toggleLog);
document.getElementById("log-clear").addEventListener("click", () => {
  msgLog.length = 0;
  msgLogUnseen = 0;
  refreshLogButton();
  renderLog();
});
document.getElementById("log-copy").addEventListener("click", () => {
  const txt = logText();
  if (!txt) { navMessage("El registro está vacío.", { tone: "info" }); return; }
  navigator.clipboard.writeText(txt)
    .then(() => navMessage("Registro copiado al portapapeles.", { tone: "info" }))
    .catch(() => navMessage("No se pudo copiar al portapapeles."));
});

/* ---------- Diálogo de la credencial de Copernicus ----------
   Edición diferida como el resto: se escribe en la caja y solo
   «Aceptar» la guarda y rearma la capa.                              */
const shDialog = document.getElementById("sh-creds");
const shBox = shDialog.querySelector(".dlg-box");
const shInput = document.getElementById("sh-instance");
const shErrorEl = document.getElementById("sh-error");

function closeShCredsDialog() {
  shDialog.hidden = true;
  releaseFocus();
}
function openShCredsDialog() {
  shInput.value = shInstanceId || "";
  shErrorEl.hidden = true;
  shDialog.hidden = false;
  clampToViewport(shBox);
  focusDialog(shBox);
  shInput.focus();
  shInput.select();
}
document.getElementById("sh-cancel").addEventListener("click", closeShCredsDialog);
document.getElementById("sh-clear").addEventListener("click", () => {
  /* Borrar actúa sobre el campo, no sobre el diálogo: cerrarlo obligaría
     a reabrirlo para escribir otra credencial, que es justo lo que se
     suele querer hacer después.                                        */
  setInstanceId(null);
  shInput.value = "";
  shErrorEl.hidden = true;
  shInput.focus();
  navMessage("Credencial de Copernicus borrada.", { tone: "info" });
});
document.getElementById("sh-accept").addEventListener("click", () => {
  const txt = shInput.value.trim();
  if (!validInstanceId(txt)) {
    /* No cerrar con un valor inválido: mismo criterio que las
       coordenadas del diálogo de estilos.                            */
    shErrorEl.textContent = "El instance ID debe ser un UUID como "
      + "12345678-90ab-cdef-1234-567890abcdef.";
    shErrorEl.hidden = false;
    shInput.focus();
    return;
  }
  setInstanceId(txt);
  closeShCredsDialog();
});

const descDialog = document.getElementById("desc-dialog");
const descBox = descDialog.querySelector(".dlg-box");
const descTitle = document.getElementById("desc-title");
const descBody = document.getElementById("desc-body");
document.getElementById("desc-close").addEventListener("click", () => {
  descDialog.hidden = true;
  layerInfoDismissed = true;
  releaseFocus();
});
for (const box of [styleBox, iconBox, colorBox, descBox, shortcutsBox, ktpBox, kdpBox, gnpBox, gnpEditorBox, shBox, pointsBox, logBox]) makeDialogMovable(box);
setupDialog(styleBox, { modal: false }); /* flotante: el mapa sigue vivo */
setupDialog(iconBox, { modal: true });
setupDialog(colorBox, { modal: true });
setupDialog(descBox, { modal: false });
setupDialog(shortcutsBox, { modal: true });
setupDialog(ktpBox, { modal: true });
setupDialog(kdpBox, { modal: true });
setupDialog(gnpBox, { modal: true });
setupDialog(gnpEditorBox, { modal: true });
setupDialog(shBox, { modal: true });
setupDialog(pointsBox, { modal: true });
setupDialog(logBox, { modal: true });
window.addEventListener("resize", () => {
  /* a moved dialog must not fall off-screen */
  for (const box of [styleBox, iconBox, colorBox, descBox, shortcutsBox, ktpBox, kdpBox, gnpBox, gnpEditorBox, shBox, pointsBox, logBox]) clampToViewport(box);
});
let styleTargets = [];    /* nodes being edited */
let styleKindOpen = null; /* "marker" | "polygon" */
let styleDraft = null;    /* working copy shown by the controls */
let pendingIcon = null;   /* icon highlighted in the picker, not yet accepted */
let posFormat = "dms";    /* coordinate notation, toggled with the ⇅ button */
let posMarker = null;     /* sole marker whose position is being edited */
let posOriginal = null;   /* its position when the dialog opened */
let styleIsNew = false;   /* pin just created: cancelling removes it again */

function openStyleDialog(li, { isNew = false } = {}) {
  /* The dialog is not modal, so another row's button may be pressed while
     it is open: that cancels the edit in progress before retargeting    */
  if (!styleDialog.hidden) closeStyleDialog(false);
  /* El panel de información (hover) es igual de flotante y puede quedar
     justo en el mismo sitio, tapando este diálogo sin ningún aviso de
     que hay algo debajo: se cierra antes de mostrar el de edición.    */
  if (!descDialog.hidden) descDialog.hidden = true;
  const kind = styleKind(li);
  if (kind !== "marker" && kind !== "polygon" && kind !== "measure" && kind !== "imageOverlay") {
    navMessage("Esta capa no tiene estilos editables.");
    return;
  }
  /* Como borrar o arrastrar: actuar sobre un nodo seleccionado actúa
     sobre toda la selección. Ya se puede seleccionar de todo, así que
     aquí es donde se comprueba que la mezcla sea editable en bloque. */
  const inSelection = selection.has(li) && selection.size > 1;
  styleTargets = inSelection ? topLevelSelection().filter(n => !nodeUl(n)) : [li];
  const kinds = new Set(styleTargets.map(styleKind));
  if (kinds.size > 1) {
    const names = [...kinds].map(k => KIND_LABEL[k] || k).join(" y ");
    navMessage(`La selecci\u00F3n mezcla ${names}: los nodos de distinto tipo no se`
      + " pueden editar de forma conjunta. Deje seleccionados solo los del mismo tipo.",
      { sticky: true });
    styleTargets = [];
    return;
  }
  styleKindOpen = kind;
  styleIsNew = isNew;
  $id("style-title").textContent = styleTargets.length > 1
    ? `Estilo de ${styleTargets.length} capas` : `Estilo: ${li._name}`;
  $id("style-marker").hidden = kind !== "marker";
  $id("style-polygon").hidden = kind !== "polygon";
  $id("style-measure").hidden = kind !== "measure";
  $id("style-imageoverlay").hidden = kind !== "imageOverlay";
  /* El nombre solo tiene sentido con un único nodo: es propio de cada uno */
  const single = styleTargets.length === 1;
  $id("name-row").hidden = !single;
  if (single) $id("mk-name").value = styleTargets[0]._name;

  /* The draft starts from the first target: with a multi-selection its
     style is the one offered as the common starting point             */
  if (kind === "marker") {
    styleDraft = { ...DEFAULT_MARKER_STYLE, ...(styleTargets[0]._mstyle || {}) };
    setColorButton($id("mk-color"), styleDraft.color);
    $id("mk-size").value = styleDraft.size;
    $id("mk-text-size").value = styleDraft.textSize;
    setColorButton($id("mk-text-color"), styleDraft.textColor);
    $id("mk-text-always").checked = styleDraft.textAlways;
    $id("icon-preview").src = iconUrl(styleDraft.icon, styleDraft.color, 20);

    /* Text and position only apply to a single marker, so those rows stay
       hidden for multi-selections and for layers with several markers    */
    /* Con varios nodos no hay nombre ni posición que editar: son propios
       de cada uno. Lo demás (color, tamaños, texto) sí va en bloque.  */
    posMarker = styleTargets.length === 1 ? soleMarker(styleTargets[0]) : null;
    $id("mk-single").hidden = !posMarker;
    if (posMarker) {
      posOriginal = posMarker.getLatLng();
      styleDraft.lat = posOriginal.lat;
      styleDraft.lng = posOriginal.lng;
      renderCoords();
      /* Dragging is live by nature: it moves the marker right away and
         feeds the inputs. "Cancelar" puts it back where it was.        */
      setMarkerDraggable(posMarker, true);
      posMarker.on("drag", onMarkerDragged);
      /* A hidden layer has no icon on the map, so there is nothing to drag */
      $id("mk-drag-hint").hidden = !posMarker._map;
    }
  } else if (kind === "polygon") {
    styleDraft = normalizePathStyle(styleTargets[0]._style);
    /* Una forma abierta solo puede tener contorno. Las opciones con
       relleno y los controles del relleno se DESHABILITAN, no se
       esconden: en gris se ve que existen y que aquí no aplican, que es
       más explicativo que hacerlas desaparecer. El modo queda además
       fijado en "stroke" para que readPolygonControls no pueda devolver
       fill:true aunque algo se saltara la interfaz.                   */
    const openOnly = styleTargets.every(isOpenOnly);
    for (const opt of $id("pg-mode").options) {
      if (opt.value !== "stroke") opt.disabled = openOnly;
    }
    $id("pg-fill-color").disabled = openOnly;
    $id("pg-fill-opacity").disabled = openOnly;
    $id("pg-fill-color-row").classList.toggle("dim", openOnly);
    $id("pg-fill-opacity-row").classList.toggle("dim", openOnly);
    $id("pg-mode").value = openOnly ? "stroke" : polygonModeOf(styleDraft);
    $id("pg-weight").value = styleDraft.weight;
    setColorButton($id("pg-color"), styleDraft.color);
    setColorButton($id("pg-fill-color"), styleDraft.fillColor);
    $id("pg-fill-opacity").value = styleDraft.fillOpacity;

    /* Solo con un único nodo (geometría propia de cada uno, igual que la
       posición de un marcador) y solo si hay de verdad un polígono cerrado */
    polyMeasures = single ? polygonMeasures(styleTargets[0]) : null;
    $id("pg-measures").hidden = !polyMeasures;
    if (polyMeasures) { $id("pg-unit").value = measureUnit; renderPolyMeasures(); }
    /* La lista de puntos es la geometría de UN nodo, como la posición de
       un marcador: no tiene sentido en bloque.                        */
    $id("pg-points-row").hidden = !(single && solePath(styleTargets[0]));
  } else if (kind === "measure") {
    styleDraft = normalizePathStyle(styleTargets[0]._style);
    /* Solo un círculo encierra superficie: para una línea el relleno no
       existe. Se DESHABILITA, no se esconde, igual que en las formas
       abiertas del diálogo de polígonos. Con una selección mixta manda
       el caso restrictivo: basta una línea para que no haya relleno que
       editar en bloque.                                               */
    const noFill = !styleTargets.every(t => t._measure && t._measure.type === "circle");
    $id("ms-fill-color").disabled = noFill;
    $id("ms-fill-opacity").disabled = noFill;
    $id("ms-fill-color-row").classList.toggle("dim", noFill);
    $id("ms-fill-opacity-row").classList.toggle("dim", noFill);
    $id("ms-weight").value = styleDraft.weight;
    setColorButton($id("ms-color"), styleDraft.color);
    setColorButton($id("ms-fill-color"), styleDraft.fillColor);
    $id("ms-fill-opacity").value = styleDraft.fillOpacity;
    /* Las medidas son de UNA medición, como la posición de un marcador */
    msMeasures = single ? measurementValues(styleTargets[0]._measure) : null;
    $id("ms-values").hidden = !msMeasures;
    if (msMeasures) { $id("ms-unit").value = measureUnit; renderMeasureValues(); }
  } else {
    styleDraft = { opacity: styleTargets[0]._imageOverlay.opacity };
    $id("io-opacity").value = styleDraft.opacity;
  }
  styleDialog.hidden = false;
  clampToViewport(styleBox);
  focusDialog(styleBox);
}

/* `commit` false = cancel: the dragged position goes back and a pin that
   was created just to open this dialog is removed again.               */
function closeStyleDialog(commit = false) {
  if (dragFrame) { cancelAnimationFrame(dragFrame); dragFrame = null; }
  if (posMarker) {
    posMarker.off("drag", onMarkerDragged);
    setMarkerDraggable(posMarker, false);
    if (!commit && posOriginal) { posMarker.setLatLng(posOriginal); invalidateGeo(styleTargets[0]); }
  }
  if (!commit && styleIsNew && styleTargets.length) deleteNode(styleTargets[0]);
  const wasOpen = !styleDialog.hidden;
  styleDialog.hidden = true;
  iconPicker.hidden = true;
  colorPicker.hidden = true;
  colorTarget = null;
  if (wasOpen) { focusReturn = focusReturn.slice(0, -1); releaseFocus(); }
  styleTargets = [];
  styleKindOpen = null;
  styleDraft = null;
  pendingIcon = null;
  posMarker = null;
  posOriginal = null;
  styleIsNew = false;
  polyMeasures = null;
  msMeasures = null;
}

/* ---------- Position controls ---------- */
const POS_FORMAT_LABEL = { dms: "g\u00B0 m' s\"", dec: "grados decimales" };
function renderCoords() {
  $id("pos-format-label").textContent = POS_FORMAT_LABEL[posFormat];
  $id("mk-lat").value = formatCoord(styleDraft.lat, true, posFormat);
  $id("mk-lon").value = formatCoord(styleDraft.lng, false, posFormat);
  markCoordValidity();
}
/* Flags out-of-range or unreadable text without blocking typing */
function markCoordValidity() {
  const lat = parseCoord($id("mk-lat").value, true);
  const lon = parseCoord($id("mk-lon").value, false);
  $id("mk-lat").classList.toggle("bad", !isFinite(lat));
  $id("mk-lon").classList.toggle("bad", !isFinite(lon));
  return { lat, lon };
}
/* El evento "drag" de Leaflet se dispara a la misma cadencia que
   mousemove; formatear y escribir en el DOM en cada evento repite el
   problema que ya se evitó en el cuadro de coordenadas del mapa. Mismo
   patrón aquí: una sola pintura por fotograma. invalidateGeo es una
   simple asignación y se queda fuera del rAF, sin esperar al frame.  */
let dragFrame = null;
function onMarkerDragged() {
  invalidateGeo(styleTargets[0]); /* la posición forma parte de la geometría */
  if (dragFrame) return;
  dragFrame = requestAnimationFrame(() => {
    dragFrame = null;
    if (!posMarker || !styleDraft) return; /* el diálogo pudo cerrarse antes de que llegara el frame */
    const p = posMarker.getLatLng();
    styleDraft.lat = p.lat;
    styleDraft.lng = p.lng;
    renderCoords();
  });
}
/* Same idea as the notation switch of the native colour picker: one small
   ⇅ button cycles through the notations, keeping whatever is typed in and
   just re-expressing it                                                 */
$id("pos-format").addEventListener("click", () => {
  if (!styleDraft || !posMarker) return;
  const { lat, lon } = markCoordValidity();
  if (isFinite(lat)) styleDraft.lat = lat;
  if (isFinite(lon)) styleDraft.lng = lon;
  posFormat = posFormat === "dms" ? "dec" : "dms";
  renderCoords();
});
for (const id of ["mk-lat", "mk-lon"]) {
  $id(id).addEventListener("input", () => { if (styleDraft && posMarker) markCoordValidity(); });
}

/* Controls only touch the draft; the preview reflects it immediately */
function readMarkerControls() {
  Object.assign(styleDraft, {
    color: colorOf($id("mk-color")),
    size: Number($id("mk-size").value) || DEFAULT_MARKER_STYLE.size,
    textSize: Number($id("mk-text-size").value) || DEFAULT_MARKER_STYLE.textSize,
    textColor: colorOf($id("mk-text-color")),
    textAlways: $id("mk-text-always").checked
  });
  $id("icon-preview").src = iconUrl(styleDraft.icon, styleDraft.color, 20);
}
function readPolygonControls() {
  const mode = $id("pg-mode").value;
  Object.assign(styleDraft, {
    weight: Number($id("pg-weight").value) || 1,
    color: colorOf($id("pg-color")),
    opacity: 1, /* outlines are always fully opaque */
    stroke: mode !== "fill",
    fill: mode !== "stroke",
    fillColor: colorOf($id("pg-fill-color")),
    fillOpacity: Number($id("pg-fill-opacity").value)
  });
}
function readMeasureControls() {
  /* `fill` no se lee de ningún control: no hay selector de modo. Sale
     del estilo de la medición (un círculo se rellena, una línea no) y
     se vuelve a decidir POR CAPA al aceptar, porque la selección puede
     mezclar líneas y círculos.                                        */
  Object.assign(styleDraft, {
    weight: Number($id("ms-weight").value) || 1,
    color: colorOf($id("ms-color")),
    opacity: 1, /* el contorno siempre opaco, como en los polígonos */
    fillColor: colorOf($id("ms-fill-color")),
    fillOpacity: Number($id("ms-fill-opacity").value)
  });
}
/* Un único punto de reparto de "vuelca los controles en el borrador":
   el selector de color y el botón Aceptar tenían cada uno el suyo, y
   añadir un tipo de nodo obligaba a acordarse de tocar los dos.      */
function readStyleControls() {
  if (styleKindOpen === "marker") readMarkerControls();
  else if (styleKindOpen === "polygon") readPolygonControls();
  else if (styleKindOpen === "measure") readMeasureControls();
  else readImageOverlayControls();
}
for (const id of ["mk-size", "mk-text-size", "mk-text-always"]) { /* colours: openColorPicker */
  $id(id).addEventListener("input", () => { if (styleDraft) readMarkerControls(); });
}
for (const id of ["pg-weight", "pg-fill-opacity"]) { /* colours: openColorPicker */
  $id(id).addEventListener("input", () => { if (styleDraft) readPolygonControls(); });
}
for (const id of ["ms-weight", "ms-fill-opacity"]) { /* colours: openColorPicker */
  $id(id).addEventListener("input", () => { if (styleDraft) readMeasureControls(); });
}
$id("pg-mode").addEventListener("change", () => { if (styleDraft) readPolygonControls(); });

/* ---------- Perímetro y área (solo lectura) ---------- */
/* Unidad de TODA medida de distancia y área: el perímetro y el área de
   un polígono, las medidas de una medición y —desde que el usuario lo
   pidió— las etiquetas que la medición pinta en el visor y en su fila
   del árbol. Arranca en millas náuticas, que es la unidad de trabajo en
   navegación aérea y marítima; se recuerda entre aperturas del diálogo,
   como posFormat, y no persiste entre sesiones, como elevUnit.
   Es UNA sola preferencia a propósito: hay dos <select> (uno por bloque
   del diálogo) pero una única pregunta, "¿en qué unidad quiero leer
   esto?", y dos respuestas distintas a la vez solo sorprenderían.    */
let measureUnit = "nm";
let polyMeasures = null;   /* {area, perim} en m/m² del polígono abierto, o null */
function renderPolyMeasures() {
  if (!polyMeasures) return;
  /* Una línea tiene LONGITUD; solo un contorno cerrado tiene perímetro */
  $id("pg-perim-label").textContent = polyMeasures.open ? "Longitud" : "Perímetro";
  $id("pg-perimeter").textContent = fmtUnitDist(polyMeasures.perim, measureUnit);
  /* area === null: anillo sin cerrar (algunos JSON), no hay área que mostrar */
  $id("pg-area-row").hidden = polyMeasures.area === null;
  if (polyMeasures.area !== null) {
    $id("pg-area").textContent = fmtUnitArea(polyMeasures.area, measureUnit);
  }
}
/* Cambiar la unidad en CUALQUIERA de los dos bloques repinta también las
   etiquetas de las mediciones del visor: la preferencia es única, así
   que dejar el mapa con la unidad anterior lo pondría en desacuerdo con
   la ventana que se acaba de tocar.                                   */
function setMeasureUnit(unit) {
  measureUnit = unit;
  $id("pg-unit").value = unit;
  $id("ms-unit").value = unit;
  renderPolyMeasures();
  renderMeasureValues();
  refreshMeasureLabels();
}
$id("pg-unit").addEventListener("change", () => setMeasureUnit($id("pg-unit").value));

/* ---------- Medidas de una medición (solo lectura) ---------- */
let msMeasures = null; /* {circle, dist, area, brg} de la medición abierta, o null */
function renderMeasureValues() {
  if (!msMeasures) return;
  /* Un círculo se describe por su RADIO; una línea, por su distancia */
  $id("ms-dist-label").textContent = msMeasures.circle ? "Radio" : "Distancia";
  $id("ms-dist").textContent = fmtUnitDist(msMeasures.dist, measureUnit);
  $id("ms-area-row").hidden = msMeasures.area === null;
  if (msMeasures.area !== null) {
    $id("ms-area").textContent = fmtUnitArea(msMeasures.area, measureUnit);
  }
  /* El rumbo va SIEMPRE en grados: no es una distancia y la unidad
     elegida no le afecta.                                            */
  $id("ms-bearing-row").hidden = msMeasures.brg === null;
  if (msMeasures.brg !== null) $id("ms-bearing").textContent = `${msMeasures.brg.toFixed(1)}°`;
}
$id("ms-unit").addEventListener("change", () => setMeasureUnit($id("ms-unit").value));

function readImageOverlayControls() {
  styleDraft.opacity = Number($id("io-opacity").value);
}
$id("io-opacity").addEventListener("input", () => { if (styleDraft) readImageOverlayControls(); });

$id("style-cancel").addEventListener("click", () => closeStyleDialog(false));
$id("style-accept").addEventListener("click", () => {
  if (!styleDraft) return;
  /* El nombre se aplica sea cual sea el tipo del nodo */
  if (!$id("name-row").hidden && styleTargets.length === 1) {
    setNodeName(styleTargets[0], $id("mk-name").value || styleTargets[0]._name);
  }
  if (styleKindOpen === "marker") {
    readMarkerControls();
    if (posMarker) {
      const { lat, lon } = markCoordValidity();
      if (!isFinite(lat) || !isFinite(lon)) {
        navMessage("Coordenadas no v\u00E1lidas: revise la latitud y la longitud.");
        return; /* keep the dialog open so the value can be fixed */
      }
      styleDraft.lat = lat;
      styleDraft.lng = lon;
      posMarker.setLatLng([lat, lon]);
      invalidateGeo(styleTargets[0]);
    }
    /* lat/lng live in the draft for the dialog only; they are a property
       of the geometry, not of the style, so they never reach _mstyle    */
    for (const t of styleTargets) {
      const { lat, lng, ...mstyle } = styleDraft;
      t._mstyle = mstyle;
      applyMarkerStyle(t);
    }
  } else if (styleKindOpen === "polygon") {
    readPolygonControls();
    for (const t of styleTargets) {
      t._style = { ...styleDraft };
      applyPolygonStyle(t);
    }
  } else if (styleKindOpen === "measure") {
    readMeasureControls();
    for (const t of styleTargets) {
      /* El relleno se decide por capa, no en el diálogo: una selección
         puede mezclar líneas y círculos, y un trazo abierto relleno
         obliga a Leaflet a cerrarlo por su cuenta (misma regla que
         clearFillOnOpenPaths aplica en la propia capa).              */
      t._style = { ...styleDraft, fill: t._measure.type === "circle" && styleDraft.fill !== false };
      applyPolygonStyle(t); /* una medición es un trazo más: mismo camino */
      t._measure.style = t._style; /* el registro pendiente lo serializa desde aquí */
    }
  } else {
    readImageOverlayControls();
    for (const t of styleTargets) {
      t._imageOverlay.opacity = styleDraft.opacity;
      const layer = nodeLayer(t);
      if (layer) layer.setOpacity(styleDraft.opacity);
    }
  }
  scheduleSave();
  closeStyleDialog(true);
});

/* ---------- Icon picker (Google Earth-like palette) ----------
   Rebuilt on each open so the previews use the colour currently in the
   dialog; MDI previews are coloured SVGs from the Iconify REST API and
   the Leaflet pin is its own PNG. Clicking only highlights an icon: it
   reaches the draft on "Aceptar" and the map on accepting the style.  */
function buildIconGrid(color) {
  const grid = $id("icon-grid");
  grid.innerHTML = "";
  for (const [group, names] of MDI_ICONS) {
    const h = document.createElement("h3");
    h.textContent = group;
    grid.appendChild(h);
    const box = document.createElement("div");
    box.className = "icons";
    for (const name of names) {
      const b = document.createElement("button");
      b.className = "icon-opt" + (name === pendingIcon ? " chosen" : "");
      b.title = name;
      const img = document.createElement("img");
      img.src = iconUrl(name, color, 24);
      img.height = 24;
      if (name !== LEAFLET_PIN) img.width = 24; /* the pin keeps its 25:41 */
      img.alt = name;
      b.appendChild(img);
      b.addEventListener("click", () => {
        pendingIcon = name;
        for (const other of grid.querySelectorAll(".icon-opt")) {
          other.classList.toggle("chosen", other === b);
        }
      });
      box.appendChild(b);
    }
    grid.appendChild(box);
  }
}
$id("icon-preview-btn").addEventListener("click", () => {
  if (!styleDraft) return;
  pendingIcon = styleDraft.icon;
  buildIconGrid(colorOf($id("mk-color")));
  iconPicker.hidden = false;
  clampToViewport(iconBox);
  focusDialog(iconBox);
});
$id("icon-cancel").addEventListener("click", () => {
  iconPicker.hidden = true;
  pendingIcon = null;
  releaseFocus();
});
$id("icon-accept").addEventListener("click", () => {
  if (styleDraft && pendingIcon) {
    styleDraft.icon = pendingIcon;
    $id("icon-preview").src = iconUrl(pendingIcon, colorOf($id("mk-color")), 20);
  }
  iconPicker.hidden = true;
  pendingIcon = null;
});

