/* ---------- Ctrl+A en dos pasos ----------
   Primero la carpeta actual; si ya estaba entera seleccionada, todo el
   árbol. Es lo que hace el explorador con contenedores anidados.    */
function selectAllStep(cur) {
  const sibs = siblingRows(cur || firstRow());
  const all = [];
  for (let n = firstRow(); n; n = nextRow(n)) all.push(n);
  const already = sibs.length && sibs.every(n => selection.has(n));
  const target = already ? all : sibs;
  if (!target.length) return;
  for (const li of [...selection]) setSelected(li, false);
  for (const li of target) setSelected(li, true);
  setSelCursor(target[target.length - 1]);
  selAnchor = target[0];
  navMessage(already
    ? `Seleccionado todo el \u00E1rbol (${target.length} nodos).`
    : `Seleccionada la carpeta actual (${target.length} nodos). Ctrl+A otra vez para todo.`,
    { tone: "info" });
}

/* Supr borra toda la selección de golpe (fuera de campos de texto) */
document.addEventListener("keydown", e => {
  if (e.key !== "Delete" || !selection.size) return;
  if (/INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (activeTool === "polygon" && polyDraft) return; /* Supr es "borrar vértice" mientras se dibuja */
  const items = topLevelSelection();
  const next = cursorAfterDelete(isRow(selCursor) ? selCursor : items[0], items);
  pushUndo(`borrar ${items.length} nodo(s)`);
  for (const s of items) deleteNode(s, { pruneSelection: false });
  clearSelection();
  if (next) selectNode(next, true);
});

/* ================= Estilos de capa (marcadores y polígonos) =================
   Each layer node may carry two style records:
   - li._style  : Leaflet path options for polygons/lines (already persisted).
   - li._mstyle : marker style { icon, color, size, textSize, textColor,
                  textAlways }, persisted as `mstyle` in the tree.
   The palette button on a row opens the style dialog. Editing is DEFERRED:
   the dialog works on a draft and nothing reaches the map until "Aceptar";
   "Cancelar" simply throws the draft away. When the row is part of a
   multi-selection the accepted changes apply to every selected layer (the
   selection rule guarantees they all share the same kind).               */

/* The Leaflet drop pin. It is a raster image, not an SVG, so `color` has no
   effect on it — it is offered as the neutral default because imported KML
   icons cannot be honoured (Google Earth pushpins have no exact equivalent
   here and <IconStyle> href images point at URLs we do not support).      */
const LEAFLET_PIN = "leaflet-pin";
const LEAFLET_PIN_URL = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png";
const LEAFLET_PIN_SHADOW = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png";
const LEAFLET_PIN_RATIO = 25 / 41; /* native size of the image: 25 × 41 px */

const DEFAULT_MARKER_STYLE = {
  icon: LEAFLET_PIN, color: "#1b5e97", size: 41, /* 41 px = native pin height */
  textSize: 13, textColor: "#2b2b28", textAlways: false
};

/* Icon catalogue offered by the picker (Google Earth-like pushpins).
   All names but LEAFLET_PIN are Material Design Icons served by Iconify. */
const MDI_ICONS = [
  ["Leaflet", [LEAFLET_PIN]],
  ["Banderas", ["flag", "flag-outline", "flag-checkered", "flag-variant",
    "flag-variant-outline", "flag-triangle"]],
  ["Estrellas", ["star", "star-outline", "star-four-points",
    "star-four-points-outline", "star-circle", "star-circle-outline", "star-face"]],
  ["C\u00EDrculos numerados", ["numeric-0-circle", "numeric-1-circle",
    "numeric-2-circle", "numeric-3-circle", "numeric-4-circle", "numeric-5-circle",
    "numeric-6-circle", "numeric-7-circle", "numeric-8-circle", "numeric-9-circle",
    "numeric-9-plus-circle"]],
  ["N\u00FAmeros en caja", ["numeric-0-box", "numeric-1-box", "numeric-2-box",
    "numeric-3-box", "numeric-4-box", "numeric-5-box", "numeric-6-box",
    "numeric-7-box", "numeric-8-box", "numeric-9-box"]],
  ["Aviaci\u00F3n", ["airplane", "airplane-takeoff", "airplane-landing",
    "airport", "helicopter", "radar", "parachute"]],
  ["Barco", ["ferry", "sail-boat", "anchor", "submarine", "ship-wheel",
    "lighthouse", "compass"]],
  ["Transporte", ["car", "car-side", "bus", "bus-stop", "train",
    "subway-variant", "tram", "truck", "motorbike", "bike", "taxi", "rocket"]],
  ["Figuras geom\u00E9tricas", ["circle", "circle-outline", "square",
    "square-outline", "triangle", "triangle-outline", "hexagon", "pentagon",
    "rhombus", "octagon"]],
  ["Se\u00F1ales", ["sign-caution", "sign-direction", "sign-pole", "sign-text",
    "traffic-light", "road-variant", "alert", "alert-octagon", "map-marker-alert"]]
];

/* Preview URL of an icon. MDI icons come coloured from the Iconify REST
   API ("#" must be URL-encoded as %23); the Leaflet pin is a fixed PNG. */
const iconUrl = (name, color, size) => name === LEAFLET_PIN
  ? LEAFLET_PIN_URL
  : `https://api.iconify.design/mdi/${name}.svg?color=${encodeURIComponent(color)}&height=${size}`;

/* Raw SVG sources (drawn with currentColor) cached per icon name, so the
   final markers embed the SVG inline and re-color instantly via CSS      */
const svgCache = new Map();
const ICON_TIMEOUT = 8000;
function fetchIconSvg(name) {
  if (!svgCache.has(name)) {
    const req = fetch(`https://api.iconify.design/mdi/${name}.svg`,
                      { signal: AbortSignal.timeout(ICON_TIMEOUT) })
      .then(r => {
        if (!r.ok) throw new Error(describeHttp(r.status));
        return r.text();
      })
      .then(svg => {
        if (!/^\s*<svg[\s>]/i.test(svg)) throw new Error("respuesta que no es un SVG");
        return svg;
      })
      .catch(err => {
        svgCache.delete(name); /* un fallo puntual no debe quedar cacheado */
        throw err;
      });
    svgCache.set(name, req);
  }
  return svgCache.get(name);
}

const escapeHtml = s => String(s).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Leaflet layer behind a tree node (null for folders and files) */
function nodeLayer(li) {
  const chk = li.querySelector(":scope > .node-row > input[type=checkbox]");
  return chk ? chk._layer : null;
}

/* properties de un GeoJSON importado, si las tiene: L.geoJSON(feature,...)
   deja `.feature.properties` en la subcapa, y ese properties sobrevive
   íntegro el ciclo guardar/restaurar (toGeoJSON / L.geoJSON de nuevo).
   Capas KML (marker/polyline directos, sin .feature) devuelven null:
   su información va por li._desc, no por aquí.                       */
function layerProperties(layer) {
  if (!layer || typeof layer.getLayers !== "function") return null;
  const sub = layer.getLayers()[0];
  const props = sub && sub.feature && sub.feature.properties;
  return (props && typeof props === "object" && Object.keys(props).length) ? props : null;
}

/* null/undefined se muestran vacíos; objetos/arrays anidados, como JSON;
   el resto, tal cual. A diferencia del picker de la Fase 1 (que trunca
   la vista previa), aquí se muestra el valor completo: es una ventana
   de consulta, no una lista compacta de opciones.                    */
function stringifyPropValue(v) {
  if (v == null) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function propertiesTableHtml(props) {
  const rows = Object.entries(props)
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(stringifyPropValue(v))}</td></tr>`)
    .join("");
  return `<table>${rows}</table>`;
}

/* HTML a mostrar en el panel de información de la capa: la ficha KML si
   la tiene, si no la tabla de properties de GeoJSON si las tiene, si no
   null (nada que mostrar).                                           */
function infoHtmlFor(li) {
  if (li._desc) return sanitizeHtml(li._desc);
  const props = layerProperties(nodeLayer(li));
  return props ? propertiesTableHtml(props) : null;
}

