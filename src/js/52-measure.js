/* ================= Herramientas de medición ================= */

const MEASURE_COLORS = { line: "#d97706", circle: "#7c3aed", route: "#0ea5e9" };
let measureLi = null;
let activeTool = null; /* null | "line" | "circle" | "polygon" | "route" */
let drawing = null;    /* medición en curso durante el arrastre de creación */
let polyDraft = null;  /* polígono en curso: { vertices, handles, poly, group } | null */
/* Los dos últimos clicks del dibujo: ¿añadieron vértice? El dblclick lee
   `prevClickAdded` (el primero de su par) para decidir si termina
   cerrada o abierta. Ver el manejador de "dblclick".                  */
let prevClickAdded = false, lastClickAdded = false;
let toolButtons = {};

/* YYYYMMDD-HHMMSS del reloj local del navegador, en el momento de generar
   el PNG — no BUILD, que es fijo por versión del código, no por momento
   de exportación.                                                     */
function pngTimestamp(d = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    + `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* Exporta el contenido del visor (mapa base incluido) como PNG. html2canvas
   es opcional (solo hace falta para esto): se comprueba aquí, no con un
   guardián que bloquee toda la página, igual que JSZip en kmzToKml.
   `useCORS: true` es lo que permite que las teselas de mapa base entren en
   el PNG: todos los proveedores usados (OSM, Esri, IGN, PNOA) envían
   `Access-Control-Allow-Origin: *` (comprobado contra los servicios
   reales), así que html2canvas puede leer sus píxeles sin dejar el canvas
   final "tainted". Si algún proveedor no lo enviara, esa tesela concreta
   sale en blanco (html2canvas aísla el fallo por imagen) en vez de romper
   la exportación entera.                                              */
/* Los controles superpuestos (zoom, barras de herramientas, selector de
   mapas base) son hijos del propio #map, así que html2canvas los
   capturaría también: no aportan información y ocupan espacio en la
   imagen. Se ocultan justo antes de capturar y se restauran siempre,
   incluso si la captura falla. El cuadro de coordenadas y la
   atribución NO se ocultan: el primero sí muestra información del
   punto bajo el cursor, y la segunda es la atribución CC BY que exige
   la licencia del PNOA/IGN.                                          */
const HIDE_FOR_PNG = ".leaflet-control-zoom, .measure-bar, .base-box";

async function exportMapPng() {
  if (typeof html2canvas === "undefined") {
    navMessage("No se pudo cargar el soporte para exportar PNG.");
    return;
  }
  let canvas;
  const hidden = [...document.querySelectorAll(HIDE_FOR_PNG)];
  const prevDisplay = hidden.map(el => el.style.display);
  hidden.forEach(el => { el.style.display = "none"; });
  try {
    canvas = await html2canvas(document.getElementById("map"), { useCORS: true });
  } catch (err) {
    navMessage(`No se pudo generar la imagen: ${err.message}`);
    return;
  } finally {
    hidden.forEach((el, i) => { el.style.display = prevDisplay[i]; });
  }
  canvas.toBlob(blob => {
    if (!blob) { navMessage("No se pudo generar la imagen."); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kite-local-${pngTimestamp()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    /* Una descarga que ha ido bien es una NOTIFICACIÓN, no una alerta:
       solo confirma lo que el usuario acaba de pedir.                 */
    navMessage(`Descargado «${a.download}».`, { tone: "info" });
  }, "image/png");
}

const MeasureControl = L.Control.extend({
  options: { position: "topleft" },
  onAdd() {
    const bar = L.DomUtil.create("div", "leaflet-bar measure-bar");
    toolButtons.line = makeToolButton(bar, "\u2571", "Medir l\u00EDnea: arrastra del origen al destino", "line");
    toolButtons.circle = makeToolButton(bar, "\u25EF", "Medir c\u00EDrculo: arrastra del centro al borde", "circle");
    toolButtons.polygon = makeToolButton(bar, "\u2B20",
      "Dibujar: click para cada v\u00E9rtice; doble click sobre el \u00FAltimo v\u00E9rtice cierra el "
      + "pol\u00EDgono, doble click fuera termina la l\u00EDnea sin cerrarla", "polygon");
    toolButtons.route = makeToolButton(bar, "\u2933",
      "Medir ruta: click para cada waypoint, doble click para terminar", "route");

    /* Not a drag tool like the other two: it acts on click, so it does not
       go through setTool and never disables panning                      */
    const pin = L.DomUtil.create("a", "", bar);
    pin.href = "#";
    pin.textContent = "\uD83D\uDCCD";
    pin.title = "Crear un marcador en el centro de la vista";
    pin.addEventListener("click", e => { e.preventDefault(); createPin(); });

    const png = L.DomUtil.create("a", "", bar);
    png.href = "#";
    png.textContent = "\uD83D\uDCF7";
    png.title = "Exportar el visor como imagen PNG";
    png.addEventListener("click", e => { e.preventDefault(); exportMapPng(); });

    L.DomEvent.disableClickPropagation(bar);
    return bar;
  }
});
function makeToolButton(bar, glyph, title, tool) {
  const a = L.DomUtil.create("a", "", bar);
  a.href = "#";
  a.textContent = glyph;
  a.title = title;
  a.addEventListener("click", e => { e.preventDefault(); setTool(activeTool === tool ? null : tool); });
  return a;
}
map.addControl(new MeasureControl());

function setTool(tool) {
  if (drawing) { rootGroup.removeLayer(drawing.group); drawing = null; }
  if (polyDraft) { rootGroup.removeLayer(polyDraft.group); polyDraft = null; }
  prevClickAdded = lastClickAdded = false; /* el historial es de un solo dibujo */
  /* An info panel already open (from a hover right before activating the
     tool) could sit exactly where the user needs to click to fix a
     vertex inside another polygon                                     */
  if ((tool === "polygon" || tool === "route") && !descDialog.hidden) {
    descDialog.hidden = true; layerInfoDismissed = true; releaseFocus();
  }
  /* Leaving any drawing tool (polygon, line, or circle): the double
     click / mouseup that ends it lands right where the cursor is,
     almost always on top of some layer. See suppressNextHover above
     for why this doesn't reuse layerInfoDismissed.                   */
  if (activeTool && !tool) {
    suppressNextHover = true;
    setTimeout(() => { suppressNextHover = false; }, TOOL_EXIT_HOVER_GUARD_MS);
  }
  activeTool = tool;
  for (const [t, btn] of Object.entries(toolButtons)) btn.classList.toggle("active", t === tool);
  /* Clase de Leaflet, no estilo en línea: un estilo en línea en el
     contenedor pierde contra el "cursor: pointer" que Leaflet pone en
     cada capa interactiva bajo el ratón (.leaflet-interactive vive en
     el propio elemento de la capa —canvas, icono de marcador…—, un
     descendiente, así que su valor gana a la herencia del contenedor
     sea cual sea su origen). .leaflet-crosshair es la clase que ya trae
     leaflet.css con la regla ".leaflet-crosshair .leaflet-interactive"
     pensada justo para esto: forzar el cursor de una herramienta de
     dibujo también sobre lo que hay debajo.                           */
  map.getContainer().classList.toggle("leaflet-crosshair", !!tool);
  /* Con la herramienta activa, el arrastre dibuja en vez de hacer pan, y
     el doble click de "cerrar polígono" no debe además hacer zoom      */
  if (tool) { map.dragging.disable(); map.doubleClickZoom.disable(); }
  else { map.dragging.enable(); map.doubleClickZoom.enable(); }
}
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  /* Escape closes open dialogs first; otherwise cancels tool/selection */
  if (!ctxMenuEl.hidden) { closeCtxMenu(); return; }
  if (!shortcutsDialog.hidden) { toggleShortcuts(); return; }
  if (!logDialog.hidden) { toggleLog(); return; }
  if (!urlDialog.hidden) { closeUrlDialog(); return; }
  if (!descDialog.hidden) { descDialog.hidden = true; layerInfoDismissed = true; releaseFocus(); return; }
  if (!colorPicker.hidden) { cancelColorPicker(); return; }
  if (!iconPicker.hidden) { iconPicker.hidden = true; pendingIcon = null; releaseFocus(); return; }
  if (!ktpDialog.hidden) { closeKtpPicker(false); return; }
  if (!kdpDialog.hidden) { closeKdpPicker(false); return; }
  if (!gnpDialog.hidden) { closeGnpPicker(null); return; }
  if (!gnpEditorDialog.hidden) { gnpEditorDialog.hidden = true; releaseFocus(); return; }
  if (!shDialog.hidden) { closeShCredsDialog(); return; }
  if (!pointsDialog.hidden) { closePointsDialog(); return; }
  if (!styleDialog.hidden) { closeStyleDialog(false); return; }
  setTool(null);
  clearSelection();
  /* Un corte sin pegar se cancela: nada se ha movido todavía */
  if (clipboard && clipboard.move) {
    for (const li of clipboard.cut) if (li.isConnected) nodeRow(li).classList.remove("cut");
    clipboard = null;
  }
});

/* Creación con un solo arrastre: mousedown fija el origen y al soltar
   queda fijado el destino, viendo la medición en vivo                  */
map.on("mousedown", e => {
  if (drawing || (activeTool !== "line" && activeTool !== "circle")) return;
  L.DomEvent.preventDefault(e.originalEvent);
  drawing = buildMeasurement(activeTool, e.latlng, e.latlng);
});
map.on("zoomend", () => coordsControl.updateZoom());
map.on("mousemove", e => {
  if (!drawing) return;
  drawing.mDest.setLatLng(e.latlng);
  updateMeasurement(drawing);
});
L.DomEvent.on(document, "mouseup", () => {
  if (!drawing) return;
  const m = drawing;
  drawing = null;
  setTool(null);
  if (map.distance(m.mOrigin.getLatLng(), m.mDest.getLatLng()) < 1) {
    rootGroup.removeLayer(m.group); /* arrastre de <1 m: click accidental */
    return;
  }
  finalizeMeasurement(m);
});

/* Manejador de origen/destino: la edición requiere Ctrl para no
   interferir con el pan del mapa                                       */
function makeHandle(latlng) {
  return L.marker(latlng, {
    icon: L.divIcon({ className: "measure-handle", iconSize: [12, 12] })
  });
}

/* Estilo de partida de una medición nueva. Una línea nunca se rellena
   (no encierra ninguna superficie); un círculo sí, muy translúcido para
   no tapar el mapa. A partir de aquí es un estilo de trazo normal y
   corriente, editable desde el diálogo de propiedades como el de
   cualquier polígono, y por eso se guarda con el nodo.               */
/* 0,10 y no 0,08: el control del diálogo va de 0 a 1 a pasos de 0,05, y
   un valor fuera de esa rejilla lo redondea el propio navegador al
   asignarlo, así que abrir el diálogo y aceptar sin tocar nada cambiaba
   la opacidad por su cuenta. La diferencia no se ve; el cambio
   silencioso sí molestaba.                                            */
const defaultMeasureStyle = type => type === "circle"
  ? { color: MEASURE_COLORS.circle, weight: 2, fillOpacity: 0.1 }
  : { color: type === "route" ? MEASURE_COLORS.route : MEASURE_COLORS.line, weight: 3, fill: false };

/* El guion de la línea de medición no es estilo editable: es lo que la
   distingue de una línea dibujada a mano. setStyle no lo toca (Leaflet
   fusiona opciones), así que sobrevive a cualquier cambio del diálogo.
   Una ruta lo lleva también, por el mismo motivo.                    */
const MEASURE_DASH = "6 4";

/* Waypoints de CUALQUIER medición, en la forma en que se guardan
   (array de {lat,lng}): línea y círculo siempre tienen dos —origen y
   destino/borde, el mismo significado que los antiguos a/b—, una ruta
   tiene los que tenga. Se lee en vivo de los manejadores, nunca se
   cachea, por lo mismo que ya explica serializeNode: son arrastrables
   con Ctrl+arrastre aunque la fila no exista todavía.                */
function measureWaypoints(m) {
  const handles = m.type === "route" ? m.handles : [m.mOrigin, m.mDest];
  return handles.map(h => { const p = h.getLatLng(); return { lat: p.lat, lng: p.lng }; });
}

/* ---------- Vértices editables (arrastrar + borrar) ----------
   Mecánica compartida por el borrador de dibujo/ruta (polyDraft) y por
   la edición de una medición o un polígono YA creados. Sin estado
   propio: cada llamador decide qué significa "moverse" (onMove) y qué
   hacer al soltar (onDrop).
   - Durante el dibujo, `requireCtrl` es false: el mapa ya tiene
     dragging.disable() mientras una herramienta está activa (setTool),
     así que un arrastre normal sobre un manejador no compite con hacer
     pan y no hace falta ningún modificador.
   - Tras terminar, `requireCtrl` es true: el mapa SÍ es interactivo, así
     que hace falta el mismo gesto reservado que ya usan línea/círculo
     (Ctrl+arrastre = editar mediciones, ver «Gestos del visor»), aquí
     extendido a vértices de una ruta o un polígono.                   */
function attachVertexDrag(handle, requireCtrl, onMove, onDrop) {
  handle.on("mousedown", ev => {
    const oe = ev.originalEvent;
    if (requireCtrl && !oe.ctrlKey && !oe.metaKey) return; /* sin Ctrl, el mapa hace pan */
    L.DomEvent.stop(oe);
    if (requireCtrl) map.dragging.disable();
    const move = e => { handle.setLatLng(e.latlng); onMove(e.latlng); };
    const up = () => {
      map.off("mousemove", move);
      L.DomEvent.off(document, "mouseup", up);
      if (requireCtrl) map.dragging.enable();
      if (onDrop) onDrop();
    };
    map.on("mousemove", move);
    L.DomEvent.on(document, "mouseup", up);
  });
}

function buildMeasurement(type, a, b, style = null) {
  const s = normalizePathStyle(style || defaultMeasureStyle(type));
  const mOrigin = makeHandle(a);
  const mDest = makeHandle(b);
  const geom = type === "line"
    ? L.polyline([a, b], { ...s, dashArray: MEASURE_DASH })
    : L.circle(a, { ...s, radius: Math.max(map.distance(a, b), 0.1) });
  const label = L.tooltip({ permanent: true, direction: "top", className: "measure-label" });

  const m = { type, geom, label, mOrigin, mDest, style: s, treeLabel: null, treeName: null };
  /* La etiqueta debe tener posición y contenido ANTES de ir al mapa */
  updateMeasurement(m);
  m.group = L.featureGroup([geom, label, mOrigin, mDest]).addTo(rootGroup);
  return m;
}

function finalizeMeasurement(m) {
  attachCtrlDrag(m, m.mOrigin, true);
  attachCtrlDrag(m, m.mDest, false);
  addMeasureNode(m);
}

/* Edición con Ctrl + arrastre sobre un manejador (Cmd en Mac).
   Se usa Ctrl y no Shift porque Shift + arrastre ya es el box-zoom.
   - línea: mueve ese extremo
   - círculo: el borde cambia el radio; el centro traslada el círculo
     completo conservando radio y rumbo                                 */
function attachCtrlDrag(m, handle, isOrigin) {
  handle.on("mousedown", ev => {
    const oe = ev.originalEvent;
    if (!oe.ctrlKey && !oe.metaKey) return; /* sin Ctrl, el mapa hace pan */
    L.DomEvent.stop(oe);
    map.dragging.disable();

    const translateCircle = isOrigin && m.type === "circle";
    const saved = translateCircle ? {
      brg: bearingDeg(m.mOrigin.getLatLng(), m.mDest.getLatLng()),
      dist: map.distance(m.mOrigin.getLatLng(), m.mDest.getLatLng())
    } : null;

    const onMove = e => {
      handle.setLatLng(e.latlng);
      if (translateCircle) m.mDest.setLatLng(destPoint(e.latlng, saved.brg, saved.dist));
      updateMeasurement(m);
    };
    const onUp = () => {
      map.off("mousemove", onMove);
      L.DomEvent.off(document, "mouseup", onUp);
      map.dragging.enable();
      scheduleSave();
    };
    map.on("mousemove", onMove);
    L.DomEvent.on(document, "mouseup", onUp);
  });
}

/* Recalcula geometría y etiqueta (distancia geodésica + rumbo). Único
   punto de paso de todo recálculo de una medición (línea/círculo aquí,
   ruta vía updateRouteMeasurement), así que es también el sitio
   correcto para refrescar su diálogo de propiedades si está abierto
   mostrando ESTA medición — ver refreshOpenMeasureDialog más abajo:
   sin esto, arrastrar un extremo con el diálogo abierto solo se veía
   reflejado en el mapa, no en las cifras del propio diálogo, hasta
   cerrarlo y volver a abrirlo.                                        */
function updateMeasurement(m) {
  if (m.type === "route") { updateRouteMeasurement(m); refreshOpenMeasureDialog(m); return; }
  const a = m.mOrigin.getLatLng(), b = m.mDest.getLatLng();
  const dist = map.distance(a, b); /* haversine sobre la esfera terrestre */
  const brg = bearingDeg(a, b);
  /* En la unidad que el usuario tenga elegida en el diálogo de
     propiedades (measureUnit), no en métrico Y náutico a la vez: la
     etiqueta del visor y la fila del árbol dicen lo mismo que el
     diálogo. El rumbo va siempre en grados.                          */
  const txt = `${fmtUnitDist(dist, measureUnit)} \u00B7 ${brg.toFixed(1)}\u00B0`;

  if (m.type === "line") {
    m.geom.setLatLngs([a, b]);
    m.label.setLatLng(midPoint(a, b)); /* geodésico: correcto en arcos largos */
  } else {
    m.geom.setLatLng(a);
    m.geom.setRadius(Math.max(dist, 0.1));
    m.label.setLatLng(a);
  }
  m.label.setContent(txt);
  if (m.treeLabel) m.treeLabel.textContent = `${m.treeName} \u2014 ${txt}`;
  refreshOpenMeasureDialog(m);
}

/* Ruta: una l\u00ednea de N waypoints, con distancia y rumbo por TRAMO \u2014no
   solo el total\u2014 y una etiqueta por tramo, exactamente igual que la de
   una l\u00ednea de dos puntos, en el punto medio geod\u00e9sico de ESE tramo. */
function updateRouteMeasurement(m) {
  const pts = m.handles.map(h => h.getLatLng());
  m.geom.setLatLngs(pts);
  let total = 0;
  m.legs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dist = map.distance(pts[i], pts[i + 1]);
    const brg = bearingDeg(pts[i], pts[i + 1]);
    total += dist;
    m.legs.push({ dist, brg });
    m.legLabels[i].setLatLng(midPoint(pts[i], pts[i + 1]));
    m.legLabels[i].setContent(`${fmtUnitDist(dist, measureUnit)} \u00b7 ${brg.toFixed(1)}\u00b0`);
  }
  m.totalDist = total;
  if (m.treeLabel) {
    m.treeLabel.textContent = `${m.treeName} \u2014 ${fmtUnitDist(total, measureUnit)} total, `
      + `${m.legs.length} tramo${m.legs.length === 1 ? "" : "s"}`;
  }
}

/* Repinta la etiqueta de TODAS las mediciones tras cambiar la unidad en
   el diálogo de propiedades. Alcanza también los registros pendientes
   (li._pending) de las carpetas nunca desplegadas: su capa está en el
   mapa con su etiqueta aunque no tenga fila —la visibilidad no depende
   del panel—, así que sin esto quedarían escritas en la unidad anterior
   hasta que alguien las desplegara. Mismo barrido que nextNumberedName,
   y por el mismo motivo.                                              */
function refreshMeasureLabels() {
  const walkRecords = recs => {
    for (const r of recs) {
      if (r.children) walkRecords(r.children);
      else if (r.t === "measure") updateMeasurement(r._m);
    }
  };
  for (const li of treeEl.querySelectorAll("li")) {
    if (li._measure) updateMeasurement(li._measure);
    if (li._pending) walkRecords(li._pending);
  }
}

/* Sección "Mediciones" y nodo de cada medición en la navegación */
function ensureMeasureSection() {
  if (measureLi && measureLi.isConnected) return nodeUl(measureLi);
  measureLi = makeNode({ name: "Mediciones", isFile: true });
  ensureRootUl().appendChild(measureLi);
  return nodeUl(measureLi);
}

function makeMeasureLi(m) {
  const li = makeNode({
    name: m.treeName,
    layer: m.group,
    /* Sí tiene diálogo de propiedades: color, grosor, relleno del
       círculo y la lectura de sus medidas (ver openStyleDialog). El
       estilo va al nodo, que es quien lo serializa.                  */
    style: m.style,
    onRename: v => { m.treeName = v; updateMeasurement(m); },
    onDelete: () => {
      if (measureLi && !nodeUl(measureLi).children.length) deleteNode(measureLi);
    }
  });
  li._measure = m; /* para serializar la medición (tipo + origen + destino) */
  m.treeLabel = li.querySelector(":scope > .node-row > label");
  return li;
}

const MEASURE_NAMES = { line: "L\u00EDnea", circle: "C\u00EDrculo", route: "Ruta" };

function addMeasureNode(m) {
  const ul = ensureMeasureSection();
  m.treeName = nextNumberedName(MEASURE_NAMES[m.type]);
  const mli = makeMeasureLi(m);
  ul.appendChild(mli);
  refreshAncestorChecks(mli);
  updateMeasurement(m); /* rellena el texto del árbol */
  scheduleSave();
}

/* Reconstruye una medición guardada (usado al restaurar el árbol), como
   registro pendiente: construye la geometría Leaflet y decide su alta en
   rootGroup (independiente del panel), pero no toca el DOM todavía —
   ver materializeRecords, que hace `makeMeasureLi(rec._m)` cuando la
   fila llega a existir de verdad.                                      */
function buildMeasureRecord(n) {
  let m;
  if (n.mtype === "route") {
    m = buildRouteMeasurement(n.waypoints, n.style);
    for (const h of m.handles) wireRouteHandle(m, h);
  } else {
    m = buildMeasurement(n.mtype, L.latLng(n.waypoints[0].lat, n.waypoints[0].lng),
      L.latLng(n.waypoints[1].lat, n.waypoints[1].lng), n.style);
    attachCtrlDrag(m, m.mOrigin, true);
    attachCtrlDrag(m, m.mDest, false);
  }
  m.treeName = n.name;
  if (!n.checked) rootGroup.removeLayer(m.group); /* buildMeasurement/buildRouteMeasurement la añaden siempre */
  /* Sin waypoints propios en el registro: los manejadores son
     arrastrables con Ctrl+arrastre directamente sobre el mapa aunque la
     fila siga pendiente (no hace falta el diálogo de estilos ni
     ninguna fila para editar una medición), así que la posición se lee
     siempre en vivo de _m (ver serializePendingRecords) en vez de
     cachearse aquí y arriesgarse a quedar obsoleta.                   */
  return { t: "measure", name: n.name, checked: !!n.checked, mtype: n.mtype,
           style: m.style, _m: m, _layer: m.group };
}

/* Lo que el diálogo de propiedades enseña de una medición. Una línea
   tiene distancia y rumbo; un círculo, radio y área; una ruta, el total
   y el desglose por tramo (m.legs, ya recalculado por
   updateRouteMeasurement). Se lee en vivo de los manejadores, que son
   arrastrables con Ctrl mientras el diálogo está abierto.              */
function measurementValues(m) {
  if (m.type === "route") {
    return { circle: false, route: true, dist: m.totalDist, area: null, brg: null, legs: m.legs };
  }
  const a = m.mOrigin.getLatLng(), b = m.mDest.getLatLng();
  const dist = map.distance(a, b);
  return m.type === "circle"
    ? { circle: true, dist, area: capArea(dist), brg: null }
    : { circle: false, dist, area: null, brg: bearingDeg(a, b) };
}

/* ================= Dibujo de polígono a mano =================
   Click añade cada vértice, doble click lo cierra. El navegador compone
   un doble click como dos "click" seguidos de un "dblclick": el segundo
   click de ese par también dispara el listener de "click" de más abajo,
   pero como su objetivo es (casi siempre) el propio manejador recién
   creado por el primer click —o uno ya existente, si se cierra haciendo
   doble click sobre el último vértice—, el guardia ".measure-handle" de
   ese listener ya lo descarta sin añadir nada: no hace falta (ni se debe)
   quitar ningún vértice al recibir "dblclick". Quitar el último a ciegas
   fue justo el bug reportado: si las dos pulsaciones del doble click
   caían sobre un manejador ya existente, ninguna añadía vértice nuevo, y
   aun así se borraba el último real, el que se quería conservar al
   cerrar. A diferencia de las mediciones, no es un nuevo tipo de
   registro serializado: al cerrar se convierte en un L.polygon normal
   con estilo propio, así que reutiliza el camino genérico t:"layer"
   (geo + style) sin cambios en la persistencia.                       */
/* Preview as a POLYLINE, not a polygon: the shape is only closed if the
   user finishes on a vertex, so a filled preview drawing the closing
   edge would promise a closed ring the gesture may never produce.     */
const POLY_PREVIEW_STYLE = { color: "#16a34a", weight: 2, dashArray: "6 4" };
const POLYGONS_SECTION = "Polígonos";

function addPolyVertex(latlng) {
  if (!polyDraft) {
    /* La vista previa de una ruta lleva el guion de medición, para que
       se lea como tal desde el primer trazo, en vez del verde
       discontinuo del dibujo libre.                                  */
    const previewStyle = activeTool === "route"
      ? { color: MEASURE_COLORS.route, weight: 2, dashArray: MEASURE_DASH }
      : POLY_PREVIEW_STYLE;
    const poly = L.polyline([latlng], previewStyle);
    polyDraft = { vertices: [latlng], handles: [], poly, group: L.featureGroup([poly]).addTo(rootGroup) };
  } else {
    polyDraft.vertices.push(latlng);
  }
  const h = makeHandle(latlng);
  h.on("contextmenu", ev => { L.DomEvent.stop(ev.originalEvent); removePolyVertex(h); });
  /* Mover un vértice ANTES de cerrar: sin Ctrl, porque mientras se
     dibuja el mapa ya tiene dragging.disable() (ver setTool) y un
     arrastre normal sobre el manejador no compite con hacer pan. El
     índice se busca en el momento del arrastre, no se captura aquí:
     borrar un vértice de en medio desplaza los que le siguen.        */
  attachVertexDrag(h, false, ll => {
    const i = polyDraft.handles.indexOf(h);
    if (i === -1) return;
    polyDraft.vertices[i] = ll;
    polyDraft.poly.setLatLngs(polyDraft.vertices);
  }, null);
  polyDraft.handles.push(h);
  polyDraft.group.addLayer(h);
  polyDraft.poly.setLatLngs(polyDraft.vertices);
}

/* Click derecho sobre un vértice (o Supr, ver el keydown más abajo) lo
   quita del borrador en curso.                                        */
function removePolyVertex(handle) {
  if (!polyDraft) return;
  const i = polyDraft.handles.indexOf(handle);
  if (i === -1) return;
  polyDraft.handles.splice(i, 1);
  polyDraft.vertices.splice(i, 1);
  polyDraft.group.removeLayer(handle);
  if (!polyDraft.vertices.length) { rootGroup.removeLayer(polyDraft.group); polyDraft = null; return; }
  polyDraft.poly.setLatLngs(polyDraft.vertices);
}

/* `closed` decides the shape: finishing ON a vertex closes the ring
   (L.polygon), finishing on empty map leaves it open (L.polyline). An
   open shape needs only two vertices, the same threshold an imported
   <LineString> uses; a ring still needs three.
   Una ruta (medición) nunca se cierra en anillo en esta primera
   versión: `closed` se ignora y siempre termina abierta, sea cual sea
   el punto donde caiga el doble click.                                */
function finishPolygon(closed) {
  if (activeTool === "route") { finishRoute(); return; }
  const min = closed ? 3 : 2;
  if (polyDraft.vertices.length < min) {
    navMessage(closed
      ? "Faltan vértices para cerrar el polígono (mínimo 3)."
      : "Faltan vértices para terminar la línea (mínimo 2).");
    return; /* sigue dibujando: no se descarta lo ya puesto */
  }
  /* Solo contorno, sin relleno: se ve el mapa debajo nada más cerrarlo;
     el relleno es cosa del diálogo de estilos si hace falta.          */
  const style = normalizePathStyle({ fill: false });
  /* Sin punto de cierre duplicado: L.Polygon lo quitaría de todos modos
     al construirse (Leaflet nunca lo conserva). Una forma cerrada aquí
     lo está por construcción; una abierta NO, y por eso polygonMeasures
     distingue ahora ambos casos en vez de darlo por cerrado.          */
  const layer = (closed ? L.polygon : L.polyline)(polyDraft.vertices, style).addTo(rootGroup);
  const li = makeNode({ name: nextNumberedName(closed ? "Polígono" : "Línea"), layer, style });
  ensureNamedSection(POLYGONS_SECTION).appendChild(li);
  refreshAncestorChecks(li);
  rootGroup.removeLayer(polyDraft.group);
  polyDraft = null;
  setTool(null);
  scheduleSave();
  highlightNode(li); /* deja el foco de la navegación en el nodo recién creado */
}

/* Ruta: construye la medición a partir de los waypoints del borrador
   (mismo umbral que una línea abierta, 2) y la cuelga de «Mediciones»,
   no de «Polígonos» — es una medición, no una forma dibujada.        */
function finishRoute() {
  if (polyDraft.vertices.length < 2) {
    navMessage("Faltan waypoints para terminar la ruta (mínimo 2).");
    return; /* sigue dibujando: no se descarta lo ya puesto */
  }
  const waypoints = polyDraft.vertices.map(v => ({ lat: v.lat, lng: v.lng }));
  const m = buildRouteMeasurement(waypoints);
  rootGroup.removeLayer(polyDraft.group);
  polyDraft = null;
  setTool(null);
  finalizeRouteMeasurement(m);
}

/* Construye una ruta a partir de sus waypoints: un manejador por punto
   y UN TOOLTIP POR TRAMO (no uno solo), cada uno etiquetado igual que
   una línea de dos puntos, en su propio punto medio geodésico.       */
function buildRouteMeasurement(waypoints, style = null) {
  const s = normalizePathStyle(style || defaultMeasureStyle("route"));
  const pts = waypoints.map(w => L.latLng(w.lat, w.lng));
  const handles = pts.map(makeHandle);
  const geom = L.polyline(pts, { ...s, dashArray: MEASURE_DASH });
  const legLabels = pts.slice(1).map(() =>
    L.tooltip({ permanent: true, direction: "top", className: "measure-label" }));
  const m = { type: "route", geom, handles, legLabels, style: s,
              legs: [], totalDist: 0, treeLabel: null, treeName: null };
  updateMeasurement(m); /* posiciona y rellena las etiquetas ANTES de ir al mapa */
  m.group = L.featureGroup([geom, ...legLabels, ...handles]).addTo(rootGroup);
  return m;
}

/* Cablea cada waypoint (mover con Ctrl+arrastre, en vivo — igual que
   línea/círculo; borrar con clic derecho) y cuelga el nodo del árbol. */
function finalizeRouteMeasurement(m) {
  for (const h of m.handles) wireRouteHandle(m, h);
  addMeasureNode(m);
}

function wireRouteHandle(m, handle) {
  attachVertexDrag(handle, true, () => updateMeasurement(m), scheduleSave);
  handle.on("contextmenu", ev => { L.DomEvent.stop(ev.originalEvent); removeRouteWaypoint(m, handle); });
}

/* Borrar un waypoint YA CREADO: mismo gesto (clic derecho) y mismo
   mínimo (2) que durante el dibujo, pero en vivo —con scheduleSave—,
   no diferido a ningún diálogo, igual que arrastrar un extremo de
   línea/círculo.                                                     */
function removeRouteWaypoint(m, handle) {
  const i = m.handles.indexOf(handle);
  if (i === -1) return;
  if (m.handles.length <= 2) {
    navMessage("Faltan waypoints para seguir siendo una ruta (mínimo 2).");
    return;
  }
  m.handles.splice(i, 1);
  m.group.removeLayer(handle);
  m.group.removeLayer(m.legLabels.pop()); /* el conteo de tramos baja en uno; da igual cuál se retire */
  updateMeasurement(m);
  scheduleSave();
}

/* Un control (el propio botón ⬠, cualquier otro botón de la barra, el
   selector de mapas base…) marca sus elementos con
   L.DomEvent.disableClickPropagation, que en Leaflet 1.9.4 SOLO detiene
   mousedown/dblclick/contextmenu (ver su código fuente): el "click"
   simple sigue subiendo por el DOM tal cual, y un listener puesto a mano
   en el contenedor —como los de aquí abajo— lo recibe igual. Sin este
   filtro, pulsar el propio botón de la herramienta (que activa el modo
   en su propio "click", ANTES de que el evento llegue al contenedor)
   creaba el primer vértice justo encima del botón. Se replica el mismo
   criterio que usa el propio Leaflet internamente (_isClickDisabled):
   subir desde el objetivo del click marcando cualquier ascendiente con
   _leaflet_disable_click, hasta el contenedor del mapa.               */
function clickOnControl(el) {
  const container = map.getContainer();
  for (; el && el !== container; el = el.parentNode) {
    if (el._leaflet_disable_click) return true;
  }
  return false;
}

/* Escuchados en el CONTENEDOR del mapa, no con map.on(...): un click
   dentro de un polígono importado ya tiene su propio manejador ("click"
   → resaltar su nodo en el árbol, ver makeNode), y el despacho interno
   de Leaflet no deja llegar el evento sintético del mapa cuando el
   punto cae sobre una capa con su propio "click" — así que aquí no se
   pierde pase lo que pase con ese despacho. mouseEventToLatLng es la
   misma conversión pública que usa Leaflet internamente.              */
map.getContainer().addEventListener("click", e => {
  if ((activeTool !== "polygon" && activeTool !== "route") || clickOnControl(e.target)) return;
  /* Un click sobre un manejador de vértice (propio o de una medición ya
     terminada) no añade un vértice ahí encima                        */
  const onHandle = !!(e.target.closest && e.target.closest(".measure-handle"));
  /* Historial de los dos últimos clicks: el "dblclick" que sigue
     necesita saber si el PRIMERO de su par añadió un vértice.        */
  prevClickAdded = lastClickAdded;
  lastClickAdded = !onHandle;
  if (onHandle) return;
  addPolyVertex(map.mouseEventToLatLng(e));
});
map.getContainer().addEventListener("dblclick", e => {
  if ((activeTool !== "polygon" && activeTool !== "route") || !polyDraft) return;
  /* No se quita ningún vértice aquí: el último debe conservarse tanto si
     lo creó el propio doble click (sobre mapa vacío: el guardia
     ".measure-handle" del listener de "click" ya evita que el segundo
     click añada un duplicado) como si el doble click cayó sobre un
     vértice ya existente (ninguno de los dos clicks añade nada nuevo,
     y el vértice sobre el que se hizo doble click sigue siendo el
     último; no hay nada que descartar en ese caso tampoco).           */
  /* Abierta o cerrada según DÓNDE cayó el doble click, mirando si su
     PRIMER click añadió vértice. No vale mirar `e.target`: comprobado
     en Chrome, el dblclick se despacha sobre el objetivo del segundo
     click, y en el caso "mapa vacío" ese segundo click cae sobre el
     manejador que acaba de crear el primero, así que `e.target` es un
     `.measure-handle` en los DOS casos y no los distingue.            */
  finishPolygon(!prevClickAdded);
});
/* Supr borra el último vértice mientras se dibuja un polígono. El
   listener de Supr que borra la selección del árbol (más abajo) se
   guarda de actuar también en este caso, ver esa sección.             */
document.addEventListener("keydown", e => {
  if (e.key !== "Delete" || (activeTool !== "polygon" && activeTool !== "route") || !polyDraft) return;
  removePolyVertex(polyDraft.handles[polyDraft.handles.length - 1]);
});

/* Clicking inside an existing named layer while a drawing tool is active
   fires Leaflet's own bound-popup-on-click for that layer (see the click
   listener above: Leaflet's internal dispatch swallows the map-level
   click when it lands on a layer with its own "click" handler, but that
   layer's own click handling — including auto-opening its bound popup —
   still runs, independently of our layer.on("click", ...) above, which
   already no-ops in this case). Leaflet registers its own popup-opening
   "click" listener at bindPopup time (import time), before ours, and
   listeners for the same event on the same layer always all run in
   registration order — stopping propagation inside a later listener
   cannot undo an earlier one that already ran. Reacting to popupopen and
   closing it right away is simpler and more robust than unbinding/
   rebinding every layer's popup while a tool is active.                */
map.on("popupopen", e => { if (activeTool) e.popup.close(); });

/* ================= Modo altura (MDT y MDS del IGN) =================
   Los dos modelos se consultan por el MISMO camino: WCS 2.0, rejilla
   ASCII, la misma ventana y el mismo recorte. Antes el terreno venía de
   teselas Terrain-RGB y la superficie de un WCS, y comparar sus valores
   —o restarlos para saber qué hay construido— no era fiable: distinto
   muestreo, distinta interpolación y distinto redondeo.

   Cada consulta es una petición entera, así que se lanzan solo cuando el
   cursor se para y se cachean por celdas.                             */
const ELEV_WINDOW = 20;      /* m: media ventana pedida alrededor del punto.
                                Más ancha que las celdas del modelo (5 m),
                                para que una consulta cubra varias celdas y
                                el ratón pueda recorrerlas sin volver a pedir */
const ELEV_CELL = 25;        /* m: tamaño de la celda cacheada              */
const ELEV_SETTLE_MS = 700;  /* el cursor debe pararse antes de pedir       */
const ELEV_CACHE_MAX = 200;
const ELEV_TIMEOUT = 12000;
const ELEV_MAX_RPS = 4;      /* peticiones por segundo, entre las dos fuentes */
const ELEV_STATUS_QUIET = 20000;
const ELEV_ATTRIB = 'MDT05/MDS PNOA \u00A9 <a href="https://www.ign.es">IGN</a> (CC BY 4.0)';
/* Tope de celdas acumuladas en una sesión de modo altura: cada respuesta
   aporta ~100-120 celdas (una tesela de 40 m sobre la malla nativa de
   5 m), así que el tope permite explorar varias decenas de teselas antes
   de avisar. Los marcadores de Leaflet son siempre nodos del DOM (no
   pasan por canvas como el resto del visor), así que este tope es
   también un tope de nodos del DOM, no solo de memoria.               */
const ELEV_ACCUM_MAX_CELLS = 4000;

let demOn = false;
let demButton = null;
const demTimes = [];
const demStatusAt = { ok: 0, error: 0 };

/* Tope de peticiones por segundo, compartido: son el mismo servidor */
function demRateOk() {
  const now = Date.now();
  while (demTimes.length && now - demTimes[0] > 1000) demTimes.shift();
  if (demTimes.length >= ELEV_MAX_RPS) return false;
  demTimes.push(now);
  return true;
}

/* Un aviso por racha: moviendo el ratón se piden muchos puntos */
function demStatus(kind, detail) {
  const now = Date.now();
  if (now - demStatusAt[kind] < ELEV_STATUS_QUIET) return;
  demStatusAt[kind] = now;
  if (kind === "ok") navMessage("Altitud: datos recibidos del IGN.", { tone: "info" });
  else navMessage(`Altitud: ${detail}.`);
}

/* ---------- Lectura de las respuestas del servicio ---------- */

/* Pedir en latitud/longitud evita convertir coordenadas por nuestra
   cuenta y, con ello, toda una clase de errores. Solo se usa si el
   servicio declara admitir un CRS geográfico.                        */
const ELEV_GEO_CRS = [/EPSG\/0\/4326$/, /EPSG\/0\/4258$/];
const pickGeoCrs = list =>
  ELEV_GEO_CRS.reduce((found, re) => found || (list || []).find(c => re.test(c)), null) || null;

/* Web Mercator, la misma proyección en la que se dibuja el visor. Se
   prefiere a las geográficas: así lo que se consulta está en el mismo
   sistema que lo que se ve. La conversión la hace Leaflet con su propia
   proyección (`map.options.crs.project`), sin cálculos nuestros.     */
const pickWebMercator = list => (list || []).find(c => /EPSG\/0\/3857$/.test(c)) || null;

/* Metros Web Mercator de una posición, exactamente como los calcula el
   visor para colocar las teselas                                      */
function toWebMercator(lat, lon) {
  const p = map.options.crs.project(L.latLng(lat, lon));
  return { x: p.x, y: p.y };
}

/* Media ventana en metros Web Mercator equivalente a `metros` reales.
   La proyección estira la escala con la latitud: sin corregirlo, la
   ventana sería demasiado pequeña en el norte.                       */
const webMercatorHalf = (lat, metros) => metros / Math.max(0.05, Math.cos(toRad(lat)));

/* Media ventana en grados equivalente a ELEV_WINDOW metros. Antes vivía
   dentro de makeElevationSource; sube a ámbito de módulo porque la
   retícula fija de peticiones (más abajo) también la necesita.       */
const degHalf = lat => ({
  lat: ELEV_WINDOW / 111320,
  lon: ELEV_WINDOW / (111320 * Math.max(0.05, Math.cos(toRad(lat))))
});

