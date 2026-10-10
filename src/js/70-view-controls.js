/* ================= Controles de vista del visor ================= */

let gratButton = null;
let elevUnitButton = null;

const DEM_BUTTON_TITLE = "Modo altura: consulta el MDT (terreno) y el MDS"
  + " (superficie) del IGN bajo el cursor (Espa\u00F1a; requiere conexi\u00F3n)";

/* Named so both the toolbar buttons and the viewer's context menu can
   trigger the same action without duplicating logic.                  */
function fitToContent() {
  const b = rootGroup.getBounds();
  if (b.isValid()) map.fitBounds(b, { padding: [30, 30] });
}
function centerIberia() {
  map.fitBounds([[35.9, -9.4], [43.95, 4.5]]); /* península y Baleares */
}
function centerCanaries() {
  map.fitBounds([[27.5, -18.3], [29.5, -13.3]]); /* archipiélago canario */
}
function toggleGraticule() {
  graticuleOn = !graticuleOn;
  if (gratButton) gratButton.classList.toggle("active", graticuleOn);
  redrawGraticule();
}

const ViewControl = L.Control.extend({
  options: { position: "topleft" },
  onAdd() {
    const bar = L.DomUtil.create("div", "leaflet-bar measure-bar");

    const fit = L.DomUtil.create("a", "", bar);
    fit.href = "#";
    fit.textContent = "\u2922";
    fit.title = "Autoescalar: ajustar el zoom a lo cargado";
    fit.addEventListener("click", e => { e.preventDefault(); fitToContent(); });

    const ib = L.DomUtil.create("a", "", bar);
    ib.href = "#";
    ib.textContent = "IB";
    ib.style.fontSize = "11px";
    ib.style.fontWeight = "600";
    ib.title = "Centrar la vista en la pen\u00EDnsula y Baleares";
    ib.addEventListener("click", e => { e.preventDefault(); centerIberia(); });

    const gc = L.DomUtil.create("a", "", bar);
    gc.href = "#";
    gc.textContent = "GC";
    gc.style.fontSize = "11px";
    gc.style.fontWeight = "600";
    gc.title = "Centrar la vista en las islas Canarias";
    gc.addEventListener("click", e => { e.preventDefault(); centerCanaries(); });

    demButton = L.DomUtil.create("a", "", bar);
    demButton.href = "#";
    demButton.textContent = "\u26F0";
    demButton.title = DEM_BUTTON_TITLE;
    demButton.addEventListener("click", e => {
      e.preventDefault();
      setAltitudeMode(!demOn);
    });

    elevUnitButton = L.DomUtil.create("a", "", bar);
    elevUnitButton.href = "#";
    elevUnitButton.textContent = elevUnit;
    elevUnitButton.style.fontSize = "11px";
    elevUnitButton.style.fontWeight = "600";
    elevUnitButton.hidden = !demOn; /* solo tiene sentido con el modo altura activo */
    elevUnitButton.title = "Unidad de la cuadrícula de elevaciones: metros / pies";
    elevUnitButton.addEventListener("click", e => {
      e.preventDefault();
      elevUnit = elevUnit === "m" ? "ft" : "m";
      elevUnitButton.textContent = elevUnit;
      refreshElevCells();
    });

    gratButton = L.DomUtil.create("a", "", bar);
    gratButton.href = "#";
    gratButton.textContent = "#";
    gratButton.title = "Mostrar / ocultar paralelos y meridianos";
    gratButton.addEventListener("click", e => { e.preventDefault(); toggleGraticule(); });

    dnButton = L.DomUtil.create("a", "dn-toggle", bar);
    dnButton.href = "#";
    dnButton.textContent = "☀";
    dnButton.title = "Iluminación real: sombrea el mapa según la posición del sol ahora mismo (efecto visual)";
    dnButton.addEventListener("click", e => { e.preventDefault(); toggleDayNight(); });

    L.DomEvent.disableClickPropagation(bar);
    return bar;
  }
});
map.addControl(new ViewControl());

/* ---------- Retícula de paralelos y meridianos ---------- */
let graticuleOn = false;
const graticuleLayer = L.layerGroup().addTo(map);

function gratStep(z) {
  if (z >= 13) return 0.1;
  if (z >= 11) return 0.25;
  if (z >= 9) return 0.5;
  if (z >= 8) return 1;
  if (z >= 6) return 2;
  if (z >= 5) return 5;
  if (z >= 3) return 10;
  return 30;
}
function gratLabel(latlng, txt) {
  return L.marker(latlng, {
    interactive: false,
    icon: L.divIcon({ className: "grat-label", html: txt, iconSize: null })
  });
}
const GRAT_MAX_LINES = 400; /* tope duro de líneas por eje */

/* Near the poles a Mercator viewport spans a huge range of longitudes
   and the parallels bunch together, so the naive loops can emit tens of
   thousands of lines and freeze the browser. The range is clamped to the
   Mercator limit, the step is enlarged until the count fits, and both
   loops keep a hard ceiling.                                          */
function redrawGraticule() {
  graticuleLayer.clearLayers();
  if (!graticuleOn) return;

  const view = map.getBounds();
  const b = view.pad(0.1);
  const south = Math.max(-85, b.getSouth()), north = Math.min(85, b.getNorth());
  /* Fuera de la franja Mercator no hay nada que dibujar */
  if (north <= south) return;
  const west = Math.max(-180, b.getWest()), east = Math.min(180, b.getEast());

  let step = gratStep(map.getZoom());
  while ((north - south) / step > GRAT_MAX_LINES || (east - west) / step > GRAT_MAX_LINES) {
    step *= 2;
  }
  const dec = (String(step).split(".")[1] || "").length;
  const style = { color: "#446", weight: 1, opacity: 0.45, dashArray: "2 4", interactive: false };
  const size = map.getSize();
  const rotated = Math.abs(map.getBearing()) > 0.05;

  let n = 0;
  for (let i = Math.ceil(south / step); i * step <= north && n < GRAT_MAX_LINES; i++, n++) {
    const lat = i * step;
    graticuleLayer.addLayer(L.polyline([[lat, west], [lat, east]], style));
    const at = gratLabelPoint([lat, west], [lat, east], size, rotated);
    if (at) graticuleLayer.addLayer(gratLabel(at, `\u00A0${lat.toFixed(dec)}\u00B0`));
  }
  n = 0;
  for (let i = Math.ceil(west / step); i * step <= east && n < GRAT_MAX_LINES; i++, n++) {
    const lng = i * step;
    graticuleLayer.addLayer(L.polyline([[south, lng], [north, lng]], style));
    const at = gratLabelPoint([north, lng], [south, lng], size, rotated);
    if (at) graticuleLayer.addLayer(gratLabel(at, `${lng.toFixed(dec)}\u00B0`));
  }
}

/* Recorta el segmento p0→p1 (píxeles de contenedor) al rectángulo
   [0,w]×[0,h] (Liang–Barsky). Devuelve los dos extremos visibles, o
   null si el segmento no pasa por la vista.                          */
function clipSegmentToRect(p0, p1, w, h) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, p0.x], [dx, w - p0.x], [-dy, p0.y], [dy, h - p0.y]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [{ x: p0.x + t0 * dx, y: p0.y + t0 * dy }, { x: p0.x + t1 * dx, y: p0.y + t1 * dy }];
}
/* Etiqueta de una línea de la retícula: donde ENTRA en la vista desde
   su extremo `a` — el oeste para un paralelo, el norte para un
   meridiano. Con el norte arriba es exactamente el borde izquierdo/
   superior de siempre. Con el mapa rotado ese borde ya no es el de la
   pantalla (de ahí recortar en píxeles), y separar paralelos y
   meridianos por su extremo geográfico, y no por el borde de pantalla
   más cercano, es lo que evita que se amontonen todas en el mismo
   borde. Si cae en el borde derecho o inferior, la etiqueta se mete un
   poco hacia dentro para que no quede cortada.                        */
const GRAT_LABEL_W = 44, GRAT_LABEL_H = 14;
function gratLabelPoint(a, b, size, rotated) {
  const seg = clipSegmentToRect(map.latLngToContainerPoint(a), map.latLngToContainerPoint(b), size.x, size.y);
  if (!seg) return null;
  let p = seg[0];
  if (rotated) {
    p = { x: Math.min(p.x, size.x - GRAT_LABEL_W), y: Math.min(p.y, size.y - GRAT_LABEL_H) };
  }
  return map.containerPointToLatLng([p.x, p.y]);
}
map.on("moveend zoomend", redrawGraticule);
/* Girar la brújula dispara "rotate" decenas de veces por segundo: un
   redibujado por fotograma basta.                                     */
let gratFrame = null;
map.on("rotate", () => {
  if (!graticuleOn || gratFrame) return;
  gratFrame = requestAnimationFrame(() => { gratFrame = null; redrawGraticule(); });
});

/* ---------- Brújula: rotación del mapa (08-map-rotation.js) ----------
   Arrastrar alrededor de la brújula gira el mapa, de forma LIBRE (sin
   pasos); un clic sin arrastrar —o la tecla R con el foco en el visor—
   vuelve a poner el norte arriba. La orientación no se guarda: cada
   arranque empieza con el norte arriba. Va en la esquina superior
   derecha, ENCIMA del panel de mapas base: los dos son controles de
   "topright" y Leaflet los apila por orden de alta, así que se mueve a
   mano a la cabeza de esa esquina.
   `map.getBearing()` = grados que el contenido del mapa está girado en
   sentido HORARIO; el norte queda en pantalla en esa misma dirección,
   así que la aguja gira lo mismo.                                     */
const BEARING_EPS = 0.05; /* por debajo, se considera norte arriba */
const COMPASS_DRAG_PX = 3; /* menos es un clic con temblor, no un arrastre */
const isMapRotated = () => Math.abs(map.getBearing()) > BEARING_EPS
  && Math.abs(map.getBearing() - 360) > BEARING_EPS;

/* Ángulo del puntero (x, y) visto desde el centro (cx, cy), en grados,
   0 = arriba, sentido horario (el mismo convenio que un rumbo).       */
function pointerAngleDeg(cx, cy, x, y) {
  return (Math.atan2(x - cx, cy - y) * 180 / Math.PI + 360) % 360;
}
/* Rumbo del mapa durante un arrastre: el de partida más lo que ha
   girado el puntero desde que empezó (no el ángulo absoluto del
   puntero: así el mapa no salta al primer movimiento).               */
function dragBearing(startBearing, startAngle, angle) {
  return ((startBearing + angle - startAngle) % 360 + 360) % 360;
}

function resetNorth() { if (isMapRotated()) map.setBearing(0); }

const COMPASS_SVG = '<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">'
  + '<g class="compass-needle">'
  + '<polygon points="20,4 25,20 15,20" class="compass-n"/>'
  + '<polygon points="20,36 25,20 15,20" class="compass-s"/>'
  + '</g></svg>';

let compassEl = null;
const CompassControl = L.Control.extend({
  options: { position: "topright" },
  onAdd() {
    const box = L.DomUtil.create("div", "compass-box leaflet-bar");
    const a = L.DomUtil.create("a", "compass-btn", box);
    a.href = "#";
    a.title = "Brújula: arrastra para girar el mapa; clic (o R sobre el visor) vuelve a poner el norte arriba";
    a.setAttribute("aria-label", "Brújula: clic para poner el norte arriba");
    a.innerHTML = COMPASS_SVG;
    compassEl = box;
    let drag = null, dragged = false;
    a.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const r = a.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      drag = { cx, cy, x: e.clientX, y: e.clientY, bearing: map.getBearing(),
               angle: pointerAngleDeg(cx, cy, e.clientX, e.clientY), moved: false };
      a.setPointerCapture(e.pointerId);
    });
    a.addEventListener("pointermove", e => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < COMPASS_DRAG_PX) return;
      drag.moved = true;
      box.classList.add("dragging");
      map.setBearing(dragBearing(drag.bearing, drag.angle, pointerAngleDeg(drag.cx, drag.cy, e.clientX, e.clientY)));
    });
    const end = () => {
      if (!drag) return;
      dragged = drag.moved;
      drag = null;
      box.classList.remove("dragging");
      /* Girar no mueve el centro, pero la vista girada puede asomar ya
         fuera del mundo junto a un borde: se recoloca al soltar (no en
         cada paso del giro, que haría temblar el mapa).               */
      if (dragged) map.panInsideBounds(map.options.maxBounds, { animate: false });
    };
    a.addEventListener("pointerup", end);
    a.addEventListener("pointercancel", end);
    /* El clic (ratón o Intro/espacio desde teclado) pone el norte arriba,
       salvo si cierra un arrastre: ese gesto ya hizo lo que tenía que hacer. */
    a.addEventListener("click", e => {
      e.preventDefault();
      if (dragged) { dragged = false; return; }
      resetNorth();
    });
    L.DomEvent.disableClickPropagation(box);
    return box;
  }
});
map.addControl(new CompassControl());
{
  /* A la cabeza de la esquina topright: encima del panel de mapas base */
  const corner = compassEl.parentNode;
  corner.insertBefore(compassEl, corner.firstChild);
}
function syncCompass() {
  const needle = compassEl.querySelector(".compass-needle");
  needle.setAttribute("transform", `rotate(${map.getBearing()} 20 20)`);
  compassEl.classList.toggle("rotated", isMapRotated());
}
map.on("rotate", syncCompass);
syncCompass();

/* R con el foco en el visor: norte arriba. Mismo patrón que AvPág/RePág
   (más abajo): escuchado en el contenedor del mapa, así que escribir una
   "r" en cualquier campo de texto no lo dispara.                      */
map.getContainer().addEventListener("keydown", e => {
  if ((e.key !== "r" && e.key !== "R") || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  resetNorth();
});

/* ---------- Girar con el botón central del ratón ----------
   Mantener pulsado el botón central (la rueda) y arrastrar gira el mapa
   alrededor del punto donde se pulsó, que se queda quieto bajo el
   cursor; el giro es el desplazamiento HORIZONTAL desde ese punto
   (derecha = sentido horario). No el ángulo del puntero alrededor del
   pivote: al empezar el puntero está encima de él y ese ángulo salta.
   Antes el botón central arrastraba el mapa como el izquierdo: el
   Draggable de Leaflet 1.9 acepta `button === 1` (resto de
   compatibilidad con IE, donde 1 era el izquierdo), así que el gesto se
   intercepta en fase de CAPTURA en el contenedor, antes que Leaflet. El
   `preventDefault` del pointerdown suprime además el `mousedown` de
   compatibilidad (y con él el autodesplazamiento del navegador).
   Durante el gesto el cursor es una rosa de los vientos con su norte
   donde apunta el norte del mapa.                                     */
const ROTATE_DEG_PER_PX = 0.5;

/* Rumbo tras desplazar el puntero `dx` píxeles en horizontal */
function pivotDragBearing(startBearing, dx) {
  return dragBearing(startBearing, 0, dx * ROTATE_DEG_PER_PX);
}

function roseCursor(bearing) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
    + `<g transform="rotate(${bearing.toFixed(1)} 16 16)" stroke="#fff" stroke-width="1.5"`
    + ' stroke-linejoin="round" paint-order="stroke">'
    + '<polygon points="16,7 17.4,14.6 25,16 17.4,17.4 16,25 14.6,17.4 7,16 14.6,14.6" fill="#666" transform="rotate(45 16 16)"/>'
    + '<polygon points="16,1 18.3,13.7 31,16 18.3,18.3 16,31 13.7,18.3 1,16 13.7,13.7" fill="#333"/>'
    + '<polygon points="16,1.6 18.1,13.9 16,16 13.9,13.9" fill="#d62828" stroke="none"/>'
    + '</g></svg>';
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, move`;
}

{
  const el = map.getContainer();
  let rot = null;
  const setCursor = () => el.style.setProperty("--rotate-cursor", roseCursor(map.getBearing()));
  el.addEventListener("pointerdown", e => {
    if (e.button !== 1 || e.pointerType !== "mouse" || rot) return;
    if (e.target.closest(".leaflet-control-container")) return;
    e.preventDefault();
    e.stopPropagation();
    el.focus({ preventScroll: true });
    const r = el.getBoundingClientRect();
    const pivot = L.point(e.clientX - r.left, e.clientY - r.top);
    rot = { id: e.pointerId, x: e.clientX, pivot, latlng: map.containerPointToLatLng(pivot),
            bearing: map.getBearing(), moved: false };
    el.setPointerCapture(e.pointerId);
    setCursor();
    el.classList.add("map-rotating");
  }, true);
  /* Por si el navegador entrega aún el mousedown: que Leaflet no lo vea */
  el.addEventListener("mousedown", e => { if (e.button === 1 && rot) { e.preventDefault(); e.stopPropagation(); } }, true);
  el.addEventListener("pointermove", e => {
    if (!rot || e.pointerId !== rot.id) return;
    e.stopPropagation();
    if (!rot.moved) { rot.moved = true; map.fire("movestart"); }
    map.setBearing(pivotDragBearing(rot.bearing, e.clientX - rot.x));
    /* El giro del plugin es alrededor del centro de la vista: se
       devuelve el punto pulsado a su sitio. Siempre contra el MISMO
       punto geográfico, así el redondeo a píxel no se acumula.       */
    const off = map.latLngToContainerPoint(rot.latlng).subtract(rot.pivot).round();
    if (off.x || off.y) map._rawPanBy(off);
    map.fire("move");
    setCursor();
  }, true);
  const end = e => {
    if (!rot || e.pointerId !== rot.id) return;
    const moved = rot.moved;
    rot = null;
    el.classList.remove("map-rotating");
    if (!moved) return;
    map.fire("moveend");
    /* Como al soltar la brújula: la vista girada puede asomar fuera
       del mundo junto a un borde, se recoloca al terminar.           */
    map.panInsideBounds(map.options.maxBounds, { animate: false });
  };
  el.addEventListener("pointerup", end, true);
  el.addEventListener("pointercancel", end, true);
  /* Sin el pegado de la selección primaria (X11) ni otros usos del
     clic central sobre el visor */
  el.addEventListener("auxclick", e => { if (e.button === 1) e.preventDefault(); });
}

/* ---------- Coordenadas del puntero (inferior izquierda) ---------- */
/* Tres lecturas de la misma posición: grados decimales, grados/minutos/
   segundos y UTM con su huso. Se reutiliza `formatCoord`, el mismo
   formateo que edita las coordenadas de un marcador, para que lo que se
   lee en el visor y lo que se escribe en el diálogo coincidan.        */
const CoordsControl = L.Control.extend({
  options: { position: "bottomleft" },
  onAdd() {
    this._div = L.DomUtil.create("div", "coords-box");
    this._rows = ["zoom", "dec", "dms", "utm", "alt", "sup"].map(cls => {
      const d = L.DomUtil.create("div", `coords-${cls}`, this._div);
      d.textContent = "\u2014";
      return d;
    });
    this._rows[4].hidden = this._rows[5].hidden = true; /* solo en modo altura */
    this.updateZoom();
    return this._div;
  },
  showElevation(on) {
    for (const i of [4, 5]) {
      this._rows[i].hidden = !on;
      if (!on) this._rows[i].textContent = "\u2014";
    }
    this._terrain = this._surface = null;
  },
  /* Cada fila lleva el nombre del modelo que la produce: son fuentes
     distintas y conviene saber cuál dice qué. La diferencia solo se
     muestra cuando los DOS valores son números de verdad.           */
  setElevation(which, txt, meters) {
    const i = which === "terrain" ? 4 : 5;
    const tag = which === "terrain" ? "MDT (terreno)" : "MDS (superficie)";
    this[which === "terrain" ? "_terrain" : "_surface"] = meters;
    let line = `${tag}: ${txt}`;
    if (which === "surface" && typeof meters === "number" && typeof this._terrain === "number") {
      const d = meters - this._terrain;
      line += ` \u00B7 sobre el suelo ${d >= 0 ? "+" : ""}${d.toFixed(1)} m`;
    }
    this._rows[i].textContent = line;
  },
  /* El zoom no depende del cursor, así que se refresca aparte */
  updateZoom() {
    this._rows[0].textContent = `zoom ${map.getZoom()} de ${map.getMaxZoom()}`;
  },
  update(latlng) {
    const { lat, lng } = latlng;
    this._rows[1].textContent =
      `${formatCoord(lat, true, "dec")}\u00B0 ${formatCoord(lng, false, "dec")}\u00B0`;
    this._rows[2].innerHTML =
      `${formatCoordCompactHtml(lat, true)} ${formatCoordCompactHtml(lng, false)}`;
    this._rows[3].textContent = fmtUtm(lat, lng);
  }
});
const coordsControl = new CoordsControl();
map.addControl(coordsControl);
map.on("zoomend", () => coordsControl.updateZoom());

/* El ratón dispara decenas de eventos por segundo y cada lectura implica
   proyectar a UTM y reescribir varias filas: se hace una vez por
   fotograma, que es cuanto puede verse.                               */
let coordsPending = null, coordsFrame = null;
map.on("mousemove", e => {
  coordsPending = e.latlng;
  if (demOn) elevRequest(e.latlng);
  if (coordsFrame) return;
  coordsFrame = requestAnimationFrame(() => {
    coordsFrame = null;
    coordsControl.update(coordsPending);
  });
});

/* ---------- Teclado del visor: desplazar (flechas) y zoom (Re/Av Pág) ----------
   Lo que cuenta es el tiempo que la tecla está PULSADA (keydown→keyup),
   no los keydown de autorrepetición del sistema: con ellos el mapa daba
   un paso, se quedaba quieto el retardo de repetición (~250–600 ms) y
   luego avanzaba a saltos — molesto sobre todo dibujando una ruta. Un
   toque hace lo de siempre (80 px; ±1 nivel); al mantener, el
   movimiento arranca ya en el keydown y es continuo hasta soltar.
   Solo con el foco en el visor: los listeners van en su contenedor, así
   que una flecha en el buscador o en el árbol no toca el mapa. Las
   flechas se cogen en CAPTURA y no se propagan: el `Keyboard` de
   Leaflet escucha en `document` y, si las viera, desplazaría dos veces
   (sus `+`/`-`/Escape siguen siendo suyos).                           */
const KEY_PAN_STEP = 80;           /* px de un toque: el keyboardPanDelta de Leaflet */
const KEY_PAN_SPEED = 400;         /* px/s al empezar a mantener */
const KEY_PAN_MAX_SPEED = 1600;    /* px/s, tras la rampa */
const KEY_PAN_ACCEL_MS = 500;      /* mantenida más que esto, acelera… */
const KEY_PAN_RAMP_MS = 1000;      /* …hasta el tope en este tiempo */
const KEY_PAN_SHIFT = 3;           /* Mayús: más rápido, como en Leaflet */
const KEY_ZOOM_RATE = 3;           /* niveles/s mientras se mantiene */
const KEY_PAN_DIRS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/* Velocidad (px/s) de una flecha mantenida `heldMs` */
function keyPanSpeed(heldMs) {
  if (heldMs <= KEY_PAN_ACCEL_MS) return KEY_PAN_SPEED;
  const k = Math.min(1, (heldMs - KEY_PAN_ACCEL_MS) / KEY_PAN_RAMP_MS);
  return KEY_PAN_SPEED + (KEY_PAN_MAX_SPEED - KEY_PAN_SPEED) * k;
}
/* Velocidad combinada en pantalla de las flechas vivas, `keys` =
   [[tecla, px/s], …]: dos a la vez dan diagonal, opuestas se anulan. */
function keyPanVector(keys, shift) {
  const f = shift ? KEY_PAN_SHIFT : 1;
  let x = 0, y = 0;
  for (const [key, v] of keys) {
    const d = KEY_PAN_DIRS[key];
    if (d) { x += d[0] * v * f; y += d[1] * v * f; }
  }
  return { x, y };
}
/* Nivel ENTERO en que termina un zoom continuo que empezó en z0 y va
   por z: el siguiente en la dirección del zoom y al menos uno más que
   el de partida (un toque es ±1, como antes), dentro de [min, max].  */
function keyZoomTarget(z0, z, dir, min, max) {
  const eps = 1e-6;
  const t = dir > 0 ? Math.max(Math.ceil(z - eps), Math.floor(z0 + eps) + 1)
                    : Math.min(Math.floor(z + eps), Math.ceil(z0 - eps) - 1);
  return Math.min(max, Math.max(min, t));
}

/* ---------- Rueda del ratón: el mismo zoom continuo ----------
   Leaflet daba un salto animado de nivel en nivel, con una espera de
   40 ms para juntar eventos. Aquí cada evento mueve un OBJETIVO
   fraccionario y la vista lo alcanza con frenada (WHEEL_EASE_MS) por el
   mismo camino del pellizco que Re/Av Pág; parada la rueda, se asienta
   en el nivel entero siguiente en la dirección del último giro.     */
const WHEEL_PX_PER_LEVEL = 100;    /* px de rueda por nivel: una muesca (100–120 px) da uno */
const WHEEL_EASE_MS = 200;         /* tiempo para alcanzar el objetivo de cada evento */
const WHEEL_SETTLE_MS = 150;       /* del objetivo fraccionario al nivel entero */
const WHEEL_IDLE_MS = 150;         /* sin rueda este rato, el gesto ha terminado */

/* Niveles que pide un evento `wheel` (hacia arriba acerca). Una muesca
   llega en un evento de 100–120 px (Chrome) o en varios pequeños
   (Firefox, panel táctil): como mucho un nivel por evento, para que
   una rueda de líneas o páginas no salte varios de golpe.          */
function wheelLevels(deltaY, deltaMode) {
  const px = deltaMode === 1 ? deltaY * 40 : deltaMode === 2 ? deltaY * 800 : deltaY;
  return Math.max(-1, Math.min(1, -px / WHEEL_PX_PER_LEVEL));
}
/* Nivel ENTERO en que se asienta un zoom de rueda que va por z: el
   siguiente en la dirección `dir` (z ya entero se queda), en [min, max] */
function wheelZoomTarget(z, dir, min, max) {
  const eps = 1e-6;
  const t = dir > 0 ? Math.ceil(z - eps) : Math.floor(z + eps);
  return Math.min(max, Math.max(min, t));
}
const easeOutCubic = k => 1 - Math.pow(1 - k, 3);

{
  const el = map.getContainer();
  /* Última posición del puntero sobre el visor (contenedor), para el
     mousemove sintético: al mover el mapa sin mover el ratón, las
     coordenadas, la vista previa del arco o un vértice arrastrado
     seguían en el punto geográfico viejo. Se olvida al salir.         */
  let pointer = null;
  map.on("mousemove", e => { if (!e.synthetic) pointer = e.containerPoint; });
  map.on("mouseout", () => { pointer = null; });
  const syncPointer = () => {
    if (!pointer) return;
    map.fire("mousemove", { synthetic: true, containerPoint: pointer,
      layerPoint: map.containerPointToLayerPoint(pointer),
      latlng: map.containerPointToLatLng(pointer), originalEvent: null });
  };

  let shift = false, frame = null, last = 0;
  const pan = new Map();   /* tecla → { t0, down, traveled } */
  let panAcc = { x: 0, y: 0 }, panning = false;
  let zoom = null;         /* sesión de zoom, ver startZoom */

  const tick = now => {
    frame = null;
    /* La marca de un fotograma es la de su INICIO: el primero tras el
       keydown puede llevar una anterior a él (dt negativo, medido: un
       paso de -5 px hacia atrás). Tope de 0,1 s tras una pausa.      */
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    if (zoom) stepZoom(now); else if (pan.size) stepPan(now, dt);
    syncPointer();
    if (zoom || pan.size) frame = requestAnimationFrame(tick);
  };
  const run = () => {
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };

  function stepPan(now, dt) {
    const keys = [];
    for (const [key, k] of pan) {
      /* Soltada: si no llegó al paso de un toque, lo completa sin
         pasarse; si ya lo pasó, se para en seco.                     */
      const v = k.down ? keyPanSpeed(now - k.t0)
        : Math.max(0, Math.min(KEY_PAN_SPEED, (KEY_PAN_STEP - k.traveled) / dt));
      k.traveled += v * dt;
      keys.push([key, v]);
      if (!k.down && k.traveled >= KEY_PAN_STEP - 0.01) pan.delete(key);
    }
    const v = keyPanVector(keys, shift);
    panAcc.x += v.x * dt; panAcc.y += v.y * dt;
    const want = L.point(Math.round(panAcc.x), Math.round(panAcc.y));
    if (!want.x && !want.y) { if (!pan.size) endPan(); return; }
    const off = limitScreenPan(want);
    panAcc.x = off.x === want.x ? panAcc.x - want.x : 0;
    panAcc.y = off.y === want.y ? panAcc.y - want.y : 0;
    if (off.x || off.y) {
      if (!panning) { panning = true; map._stop(); map.fire("movestart"); }
      map._rawPanBy(off);
      map.fire("move");
    }
    if (!pan.size) endPan();
  }
  /* Contra el borde del mundo, en cada fotograma (al final rebotaría).
     El desplazamiento es en PANTALLA (con el mapa girado, ↑ sigue
     siendo hacia arriba) y se pasa a píxeles del mapa sin girar con el
     giro inverso. Se calcula ahí y no ida y vuelta por
     containerPointToLatLng/latLngToContainerPoint: con el mapa girable
     esa ida y vuelta se desvía ~1 px, y medido daba pasos de 8 px en
     vez de 7 (un toque recorría 98 px, no 80). _limitCenter devuelve el
     MISMO objeto si no hay que limitar (ya sabe del giro,
     08-map-rotation.js): entonces vale el desplazamiento pedido
     tal cual.                                                        */
  function limitScreenPan(want) {
    const z = map.getZoom(), b = map.getBearing() * Math.PI / 180;
    const cos = Math.cos(b), sin = Math.sin(b);
    const m = L.point(want.x * cos + want.y * sin, -want.x * sin + want.y * cos);
    const c = map.project(map.getCenter(), z);
    const to = map.unproject(c.add(m), z);
    const lim = map._limitCenter(to, z, map.options.maxBounds);
    if (lim === to) return want;
    const d = map.project(lim, z).subtract(c);
    return L.point(d.x * cos - d.y * sin, d.x * sin + d.y * cos).round();
  }
  function endPan() {
    pan.clear();
    panAcc = { x: 0, y: 0 };
    if (panning) { panning = false; map.fire("moveend"); }
  }

  /* Zoom continuo por el camino del PELLIZCO táctil de Leaflet
     (`_moveStart` + `_move(…, {pinch})`): solo transforma por CSS
     teselas y lienzo de vectores, sin redibujar en cada fotograma; el
     redibujo llega con el zoom final. Niveles fraccionarios mientras
     dura, pero `zoomSnap` sigue en 1: al soltar se anima hasta el nivel
     entero siguiente (teselas nítidas en reposo; rueda, doble clic y
     encuadres como siempre). El centro sale del ANCLA, no del fotograma
     anterior (no acumula error): guarda su desfase respecto al centro
     en píxeles del mapa sin girar, `d`, que con el giro no cambia.
     Teclas (`kind` "key"): z crece con el tiempo pulsada, ancla fija.
     Rueda ("wheel"): z persigue un objetivo `goal` con frenada, y cada
     evento vuelve a anclar en el cursor (puede moverse entre muescas). */
  const clampZoom = z => Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), z));
  function startZoom(kind, dir, anchor) {
    endPan();
    /* Una muesca o un toque durante la animación final del anterior: se
       da por terminada (ya está casi en su nivel) y se sigue desde ahí;
       si no, su final llegaría después y pisaría este zoom.          */
    if (map._animatingZoom) map._onZoomTransitionEnd();
    const z0 = map.getZoom(), center = map.getCenter(), now = performance.now();
    map._stop();
    map._moveStart(true, false);
    zoom = { kind, dir, t0: now, z0, z: z0, center, anchor, d: null,
             goal: z0, from: z0, dur: 0, last: now };
    anchorZoom(zoom, anchor);
    run();
  }
  function anchorZoom(zm, anchor) {
    zm.anchor = anchor;
    zm.d = map.project(anchor, zm.z).subtract(map.project(zm.center, zm.z));
  }
  const zoomCenter = (zm, z) => map._limitCenter(
    map.unproject(map.project(zm.anchor, z).subtract(zm.d), z), z, map.options.maxBounds);
  function easeZoom(zm, goal, now, dur) {
    zm.from = zm.z; zm.goal = goal; zm.t0 = now; zm.dur = dur;
  }
  function stepZoom(now) {
    const zm = zoom;
    const k = zm.dur ? Math.min(1, Math.max(0, now - zm.t0) / zm.dur) : 1;
    const z = zm.kind === "key"
      ? clampZoom(zm.z0 + zm.dir * KEY_ZOOM_RATE * Math.max(0, now - zm.t0) / 1000)
      : k === 1 ? zm.goal : zm.from + (zm.goal - zm.from) * easeOutCubic(k);
    if (z !== zm.z) {
      zm.z = z;
      zm.center = zoomCenter(zm, z);
      map._move(zm.center, z, { pinch: true, round: false });
    }
    /* Rueda: alcanzado el objetivo y parada la rueda, al nivel entero;
       ya en él, el final.                                            */
    if (zm.kind === "wheel" && k === 1 && now - zm.last >= WHEEL_IDLE_MS) {
      const t = wheelZoomTarget(zm.goal, zm.dir, map.getMinZoom(), map.getMaxZoom());
      if (t === zm.z) endZoom();
      else easeZoom(zm, t, now, WHEEL_SETTLE_MS);
    }
  }
  /* Final como el del pellizco (TouchZoom._onTouchEnd), no con
     setZoomAround: ese abriría otro zoomstart sobre el que ya está en
     curso. */
  function endZoom() {
    const zm = zoom;
    zoom = null;
    const min = map.getMinZoom(), max = map.getMaxZoom();
    const target = zm.kind === "key" ? keyZoomTarget(zm.z0, zm.z, zm.dir, min, max)
                                     : wheelZoomTarget(zm.goal, zm.dir, min, max);
    const c = zoomCenter(zm, target);
    if (map.options.zoomAnimation && map._zoomAnimated) map._animateZoom(c, target, true, map.options.zoomSnap);
    else map._resetView(c, target);
  }

  const stopAll = () => {
    endPan();
    if (zoom) endZoom();
  };
  el.addEventListener("keydown", e => {
    shift = e.shiftKey;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const isPan = e.key in KEY_PAN_DIRS, isZoom = e.key === "PageUp" || e.key === "PageDown";
    if (!isPan && !isZoom) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (isZoom) {
      if (zoom) return;
      startZoom("key", e.key === "PageUp" ? 1 : -1, coordsPending || map.getCenter());
    } else if (!zoom) {
      pan.set(e.key, { t0: performance.now(), down: true, traveled: 0 });
      run();
    }
  }, true);
  document.addEventListener("keyup", e => {
    shift = e.shiftKey;
    const k = pan.get(e.key);
    if (k) k.down = false;
    if (zoom && zoom.kind === "key" && (e.key === "PageUp" || e.key === "PageDown")) endZoom();
  });
  /* En el contenedor y en burbuja: los controles (panel de mapas base,
     coordenadas…) cortan la propagación de la rueda con
     disableScrollPropagation, así que sobre ellos no hay zoom. */
  el.addEventListener("wheel", e => {
    /* Siempre: sin él la página se desplazaría, y con Ctrl (pellizco
       del panel táctil) el navegador ampliaría la página entera.    */
    e.preventDefault();
    if ((zoom && zoom.kind === "key") || map.dragging.moving()) return;
    const lv = wheelLevels(e.deltaY, e.deltaMode);
    if (!lv) return;
    const now = performance.now(), dir = Math.sign(lv);
    pointer = map.mouseEventToContainerPoint(e);
    const anchor = map.containerPointToLatLng(pointer);
    if (!zoom) startZoom("wheel", dir, anchor);
    else anchorZoom(zoom, anchor);
    zoom.dir = dir;
    zoom.last = now;
    easeZoom(zoom, clampZoom(zoom.goal + lv), now, WHEEL_EASE_MS);
  }, { passive: false });
  /* El foco se queda en el VISOR al pulsar una capa, o estas teclas
     (y R, y +/- de Leaflet) dejan de llegar. Un marcador (icono con
     tabindex: `keyboard` de Leaflet) se quedaba el foco al clicarlo, y
     el siguiente guardado del árbol se lo quitaba: reorderPaintOrder
     reengancha los iconos (L.DomUtil.toFront es un appendChild) y un
     elemento enfocado que se mueve en el DOM suelta el foco al <body>,
     donde Re/Av Pág y las flechas son del ÁRBOL (su listener está en
     `document`). Se anula la acción por defecto del mousedown, que es
     lo que enfoca; con Tab un marcador sigue siendo alcanzable.      */
  el.addEventListener("mousedown", e => {
    if (!e.target.closest(".leaflet-marker-icon")) return;
    e.preventDefault();
    el.focus({ preventScroll: true });
  }, true);
  /* Sin keyup no hay final: perder el foco o la pestaña lo para todo */
  el.addEventListener("blur", stopAll);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopAll(); });
}

/* ---------- Menú contextual del visor (botón derecho) ---------- */
/* Extensible a propósito: cada entrada es {label, action(latlng)} y
   nuevas opciones solo necesitan sumarse a este array. Un `checked()`
   opcional la convierte en un interruptor (se pinta con ✓ y
   role="menuitemcheckbox"), como ya hacen los botones equivalentes de
   la barra de herramientas.                                          */
const CTX_MENU_ITEMS = [
  {
    label: "Copiar coordenadas",
    action(latlng) {
      const txt = `${formatCoord(latlng.lat, true, "dec")}, ${formatCoord(latlng.lng, false, "dec")}`;
      navigator.clipboard.writeText(txt)
        .then(() => navMessage("Coordenadas copiadas al portapapeles.", { tone: "info" }))
        .catch(() => navMessage("No se pudieron copiar las coordenadas."));
    }
  },
  { label: "Modo elevación", checked: () => demOn, action: () => setAltitudeMode(!demOn),
    disabled: () => isMapRotated() && ALT_ROTATED_WHY },
  /* Las tres mediciones agrupadas en un submenú: son la misma familia y
     tres entradas sueltas desbordaban el menú.                        */
  {
    label: "Medir",
    items: [
      { label: "Ruta", action: () => setTool(activeTool === "route" ? null : "route") },
      { label: "Círculo", action: () => setTool(activeTool === "circle" ? null : "circle") },
      { label: "Arco", action: () => setTool(activeTool === "arc" ? null : "arc") }
    ]
  },
  { label: "Dibujar polígono o línea", action: () => setTool(activeTool === "polygon" ? null : "polygon") },
  { separator: true },
  { label: "Crear un pin", action: () => createPin() },
  { separator: true },
  { label: "Exportar PNG", action: () => exportMapPng() },
  { separator: true },
  { label: "Centrar en el contenido", action: () => fitToContent() },
  { label: "Centrar en la península y Baleares", action: () => centerIberia() },
  { label: "Centrar en las islas Canarias", action: () => centerCanaries() },
  { label: "Paralelos y meridianos", checked: () => graticuleOn, action: () => toggleGraticule() }
];
const ctxMenuEl = document.createElement("div");
ctxMenuEl.id = "map-ctxmenu";
ctxMenuEl.className = "ctx-menu";
ctxMenuEl.setAttribute("role", "menu");
ctxMenuEl.setAttribute("aria-label", "Menú contextual del visor");
ctxMenuEl.hidden = true;
document.body.appendChild(ctxMenuEl);
let ctxSubmenuEl = null; /* como mucho un submenú abierto a la vez */
let ctxSubmenuTrigger = null; /* qué botón abrió el submenú actual, para no reabrirlo en vano */

function closeCtxSubmenu() {
  if (ctxSubmenuEl) { ctxSubmenuEl.remove(); ctxSubmenuEl = null; }
  ctxSubmenuTrigger = null;
}

function closeCtxMenu() {
  ctxMenuEl.hidden = true;
  closeCtxSubmenu();
}

/* Parpadeo de identificación: oculta y muestra la capa dos veces, para
   que "Ir al nodo en el panel" también señale cuál es en el mapa (con
   varias capas superpuestas, no siempre es obvio cuál se eligió). Basta
   con alternar su alta en rootGroup, igual que applyVisibility -- sirve
   igual para un marcador (DOM) que para un polígono (canvas), sin
   depender de tener un elemento DOM propio que animar. `li._blinkTimer`
   corta cualquier parpadeo anterior sobre la misma fila si se repite el
   gesto antes de que termine, y al final se deja la capa en el estado
   que de verdad le corresponde (el de su checkbox), por si se
   desactivó mientras tanto.                                            */
const BLINK_STEPS = 4; /* oculta, muestra, oculta, muestra */
const BLINK_INTERVAL_MS = 150;
function blinkLayer(li) {
  const layer = nodeLayer(li);
  if (!layer) return;
  clearTimeout(li._blinkTimer);
  let step = 0, shown = null; /* shown: lo último que de verdad se aplicó */
  const tick = () => {
    if (step >= BLINK_STEPS) {
      li._blinkTimer = null;
      const chk = li.querySelector(":scope > .node-row > input[type=checkbox]");
      const want = chk ? chk.checked : true;
      /* Solo reconciliar si el checkbox cambió DURANTE el parpadeo: el
         último paso normal ya deja la capa en el estado correcto en el
         caso normal, y repetir la misma llamada aquí sería redundante
         en CADA parpadeo, no solo en ese caso raro.                   */
      if (want !== shown) setLayerVisible(layer, want);
      return;
    }
    shown = step % 2 === 1;
    setLayerVisible(layer, shown);
    step++;
    li._blinkTimer = setTimeout(tick, BLINK_INTERVAL_MS);
  };
  /* El primer paso también va detrás de un temporizador, nunca síncrono:
     así un segundo parpadeo disparado antes de que corra el primero
     (mismo turno del bucle de eventos) lo cancela limpiamente con el
     clearTimeout de arriba, en vez de dejar un "oculta" suelto ya
     aplicado de verdad antes de reiniciar la cuenta desde cero.       */
  li._blinkTimer = setTimeout(tick, 0);
}
function goToNodeAndBlink(li) { highlightNode(li); blinkLayer(li); }
/* Y lo mismo al abrir la ficha: con varias capas superpuestas, elegir
   una en el submenú abre una ficha con un nombre y unos datos que no
   dicen CUÁL de las que hay bajo el cursor es. El parpadeo es lo que lo
   dice, igual que en "Ir al nodo en el panel".
   Va aquí y no dentro de showLayerInfo porque la ficha se abre también
   al pasar el ratón por encima: parpadear ahí sería un mapa
   temblando todo el rato.                                            */
function showLayerInfoAndBlink(li) { showLayerInfo(li); blinkLayer(li); }
/* Mismo patrón que las dos de arriba, para el diálogo de PROPIEDADES
   (el que abren el botón 🎨 o Alt+Intro, con pestañas Estilos y
   Atributos) — distinto de "Mostrar atributos", que es el panel de
   solo lectura de la ficha KML/properties (showLayerInfo). Acceso directo desde el menú contextual,
   sin tener que ir al árbol primero.                                  */
function editPropertiesAndBlink(li) { openStyleDialog(li); blinkLayer(li); }
/* Mismo criterio que usa openStyleDialog para rechazar una capa sin
   estilos editables (carpetas, cuadrículas de elevación…).            */
const STYLE_EDITABLE_KINDS = new Set(["marker", "polygon", "measure", "imageOverlay"]);

/* Ítems de UNA capa: ir al nodo, mostrar propiedades si tiene algo que
   enseñar (igual criterio que el botón ℹ de la fila), y editar
   propiedades si el diálogo de estilos aplica a su tipo.              */
function layerCtxItems(li) {
  const items = [{ label: "Ir al nodo en el panel", action: () => goToNodeAndBlink(li) }];
  if (infoHtmlFor(li) != null) items.push({ label: "Mostrar atributos", action: () => showLayerInfoAndBlink(li) });
  if (STYLE_EDITABLE_KINDS.has(styleKind(li))) items.push({ label: "Editar propiedades", action: () => editPropertiesAndBlink(li) });
  return items;
}

/* Con varias capas bajo el cursor, "Ir al nodo…", "Mostrar
   propiedades" y "Editar propiedades" se convierten en disparadores de
   submenú (`.items`) con una entrada por capa, en vez de actuar
   directamente.                                                       */
function ctxItemsFor(hits) {
  if (!hits.length) return CTX_MENU_ITEMS;
  if (hits.length === 1) return [...layerCtxItems(hits[0]), { separator: true }, ...CTX_MENU_ITEMS];
  const withInfo = hits.filter(li => infoHtmlFor(li) != null);
  const editable = hits.filter(li => STYLE_EDITABLE_KINDS.has(styleKind(li)));
  const items = [{
    label: "Ir al nodo en el panel",
    items: hits.map(li => ({ label: li._name, action: () => goToNodeAndBlink(li) }))
  }];
  if (withInfo.length) {
    items.push({
      label: "Mostrar atributos",
      items: withInfo.map(li => ({ label: li._name, action: () => showLayerInfoAndBlink(li) }))
    });
  }
  if (editable.length) {
    items.push({
      label: "Editar propiedades",
      items: editable.map(li => ({ label: li._name, action: () => editPropertiesAndBlink(li) }))
    });
  }
  return [...items, { separator: true }, ...CTX_MENU_ITEMS];
}

/* Construye las filas de un menú (principal o submenú) dentro de
   `container`: separadores, ítems normales/checkbox, y disparadores de
   submenú (`.items`, con "▸" al final y aria-haspopup). Un disparador
   despliega su submenú con solo pasar el ratón por encima, como un menú
   contextual de escritorio; el clic se conserva porque es el único
   camino para abrirlo con teclado (Tab + Enter/Espacio llega como
   "click", nunca como "mouseenter"). No se cierra al salir del propio
   disparador (mouseleave): el submenú es un elemento flotante aparte al
   que hay que llegar cruzando por fuera del botón, y cerrarlo ahí
   rompería el gesto de entrar en él. Se cierra al pasar a un ítem
   hermano SIN submenú propio, pero SOLO dentro del menú PRINCIPAL
   (`isTopLevel`): esta misma función también renderiza el submenú, cuyos
   ítems son siempre hojas, así que sin distinguir el nivel, el
   mouseenter de un ítem del propio submenú lo cerraría en el instante
   en que el ratón entrara en él.                                       */
function renderCtxItems(container, items, latlng) {
  container.innerHTML = "";
  /* "Cerrar al pasar a un hermano sin submenú" solo vale en el menú
     PRINCIPAL: esta misma función también renderiza el submenú, cuyos
     ítems son siempre hojas (sin item.items) — sin esta distinción, el
     mouseenter de un ítem del propio submenú cerraba el submenú en el
     instante en que el ratón entraba en él (el bug reportado).        */
  const isTopLevel = container === ctxMenuEl;
  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "ctx-menu-sep";
      sep.setAttribute("role", "separator");
      container.appendChild(sep);
      continue;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ctx-menu-item";
    if (item.items) {
      btn.setAttribute("role", "menuitem");
      btn.setAttribute("aria-haspopup", "true");
      btn.textContent = item.label + " ▸";
      const open = () => {
        if (ctxSubmenuTrigger === btn) return; /* ya abierto: no parpadear */
        openCtxSubmenu(btn, item.items, latlng);
      };
      btn.addEventListener("mouseenter", open);
      btn.addEventListener("click", e => { e.stopPropagation(); open(); });
    } else {
      const isToggle = typeof item.checked === "function";
      const on = isToggle && item.checked();
      btn.setAttribute("role", isToggle ? "menuitemcheckbox" : "menuitem");
      if (isToggle) btn.setAttribute("aria-checked", String(on));
      btn.textContent = (on ? "✓ " : "") + item.label;
      /* `disabled()` opcional: devuelve el MOTIVO (texto) o algo falso.
         Deshabilitado, no escondido: se ve que existe y por qué no va. */
      const why = typeof item.disabled === "function" && item.disabled();
      if (why) { btn.disabled = true; btn.title = why; }
      if (isTopLevel) btn.addEventListener("mouseenter", closeCtxSubmenu);
      /* Focus goes back to the VIEWER before the action runs: hiding the
         menu drops it on <body> (where the tree's document-level keys
         take over), and focusDialog records document.activeElement as
         the place to return to when a dialog opened by the action
         closes — so it must already be the viewer by then.           */
      btn.addEventListener("click", () => {
        closeCtxMenu();
        map.getContainer().focus({ preventScroll: true });
        item.action(latlng);
      });
    }
    container.appendChild(btn);
  }
}

function openCtxSubmenu(triggerBtn, items, latlng) {
  closeCtxSubmenu();
  ctxSubmenuTrigger = triggerBtn;
  ctxSubmenuEl = document.createElement("div");
  ctxSubmenuEl.className = "ctx-menu";
  ctxSubmenuEl.setAttribute("role", "menu");
  document.body.appendChild(ctxSubmenuEl);
  renderCtxItems(ctxSubmenuEl, items, latlng);
  const r = triggerBtn.getBoundingClientRect();
  const sr = ctxSubmenuEl.getBoundingClientRect();
  /* Se abre a la derecha del disparador; a la izquierda si no cabe */
  let left = r.right - 2;
  if (left + sr.width > window.innerWidth - 4) left = r.left - sr.width + 2;
  ctxSubmenuEl.style.left = `${Math.max(0, left)}px`;
  ctxSubmenuEl.style.top = `${Math.max(0, Math.min(r.top, window.innerHeight - sr.height - 4))}px`;
}

function openCtxMenu(latlng, x, y, hits = []) {
  closeCtxSubmenu();
  renderCtxItems(ctxMenuEl, ctxItemsFor(hits), latlng);
  ctxMenuEl.hidden = false;
  /* Clamp to viewport so a click near an edge doesn't open off-screen */
  const r = ctxMenuEl.getBoundingClientRect();
  ctxMenuEl.style.left = `${Math.max(0, Math.min(x, window.innerWidth - r.width - 4))}px`;
  ctxMenuEl.style.top = `${Math.max(0, Math.min(y, window.innerHeight - r.height - 4))}px`;
  /* No autofocus on open: the menu is mouse-first (it opens from a right
     click), and pre-focusing the first row left a lingering keyboard
     highlight fighting the mouse's hover highlight for a different row. */
}
/* Extraída para poder reutilizarla desde el propio manejador de un
   vértice/waypoint/círculo (52-measure.js, 43-points-editor.js):
   Leaflet nunca deja llegar el "contextmenu" nativo de un marcador
   interactivo hasta el contenedor del mapa —lo consume internamente
   en cuanto tiene AL MENOS un listener de ese tipo, haga lo que haga
   ese listener—, así que depender de que burbujee hasta aquí no
   funciona nunca para un manejador. La solución es no depender de la
   propagación: el propio manejador llama a esta misma función a mano
   cuando le toca abrir el menú en vez de actuar (ver "Selección de
   vértice" en CLAUDE.md). Un evento "contextmenu" de un L.Marker trae
   igual de bien `latlng`/`containerPoint`/`originalEvent`, así que
   sirve para las dos llamadas sin cambios.                            */
function openCtxMenuFromMouseEvent(e) {
  L.DomEvent.preventDefault(e.originalEvent);
  const hits = layersAtPoint(e.latlng, e.containerPoint);
  openCtxMenu(e.latlng, e.originalEvent.clientX, e.originalEvent.clientY, hits);
}
map.on("contextmenu", openCtxMenuFromMouseEvent);
map.on("movestart zoomstart", closeCtxMenu);
/* Closing a label (popup) with its × leaves focus on <body>, where the
   tree's document-level keys take over: keep it in the viewer. Only
   when focus was actually lost — never steal it from a field.        */
map.on("popupclose", () => {
  /* The event fires while the × may still be focused (it is on its way
     out of the DOM) or already gone, hence both cases.                 */
  const a = document.activeElement;
  if (!a || a === document.body || a.closest(".leaflet-popup")) map.getContainer().focus({ preventScroll: true });
});
document.addEventListener("mousedown", e => {
  if (!ctxMenuEl.hidden && !ctxMenuEl.contains(e.target) && !(ctxSubmenuEl && ctxSubmenuEl.contains(e.target))) {
    closeCtxMenu();
  }
});

/* ---------- Memoria de los mapas base ---------- */
let baseTimer = null;
function scheduleBaseSave() {
  clearTimeout(baseTimer);
  baseTimer = setTimeout(() => {
    const bases = {};
    for (const [id, st] of baseState) {
      bases[id] = { on: st.on, opacity: st.opacity };
      if (st.wmsLayer) bases[id].wmsLayer = st.wmsLayer;
    }
    dbSaveBases({ bases, order: [...baseState.keys()] }).catch(() => {});
  }, 500);
}

/* Solo se aceptan capas que sigan existiendo y valores con sentido: la
   lista puede haber cambiado entre versiones                         */
function applySavedBases(saved) {
  if (!saved) return;
  /* Orden guardado, ignorando identificadores que ya no existan y
     añadiendo al final los que sean nuevos en esta versión         */
  if (Array.isArray(saved.order)) {
    const known = [...baseState.keys()];
    const ids = saved.order.filter(id => baseState.has(id));
    for (const id of known) if (!ids.includes(id)) ids.push(id);
    const entries = ids.map(k => [k, baseState.get(k)]);
    baseState.clear();
    entries.forEach(([k, st], n) => { st.zIndex = n + 1; baseState.set(k, st); });
  }
  for (const [id, st] of baseState) {
    const rec = saved.bases[id];
    if (!rec) continue;
    if (typeof rec.on === "boolean") st.on = rec.on;
    if (Number.isFinite(rec.opacity)) st.opacity = Math.min(1, Math.max(0, rec.opacity));
    /* Se valida contra el catálogo real en cuanto se conoce (ver
       ensurePnoaHistCatalog/buildDynamicLayerSelect): un año guardado
       puede haber dejado de publicarse.                              */
    if (typeof rec.wmsLayer === "string" && rec.wmsLayer) st.wmsLayer = rec.wmsLayer;
  }
}

/* La vista se guarda al terminar de moverla, no durante: `moveend` ya
   llega una vez por gesto, y el retardo agrupa los encadenados.      */
const VIEW_SAVE_MS = 800;
let viewTimer = null;
let viewRestoring = true; /* no guardar la vista inicial antes de restaurarla */

function scheduleViewSave() {
  if (viewRestoring) return;
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    const c = map.getCenter();
    dbSaveView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })
      .catch(() => {}); /* perder la vista no merece molestar al usuario */
  }, VIEW_SAVE_MS);
}
map.on("moveend zoomend", scheduleViewSave);

/* ================= Aviso de nueva versión en el servidor =================
   Sondeo ligero: una petición HEAD al propio archivo cada
   VERSION_CHECK_MS, comparando ETag (o Last-Modified si el servidor no
   manda ETag) contra el visto la primera vez. HEAD no transfiere cuerpo
   y nginx lo resuelve con un stat() del archivo, así que el coste por
   sondeo es mínimo. cache: "no-store" evita que el propio navegador
   conteste desde caché sin llegar a preguntarle al servidor. */
const VERSION_CHECK_MS = 60000;
let serverVersionTag = null;
let updateNoticeShown = false;

async function checkServerVersion() {
  if (updateNoticeShown) return;
  let res;
  try {
    res = await fetch(location.href, { method: "HEAD", cache: "no-store" });
  } catch { return; } /* sin red: se reintenta en el siguiente sondeo */
  if (!res.ok) return;
  const tag = res.headers.get("etag") || res.headers.get("last-modified");
  if (!tag) return; /* el servidor no expone ninguno de los dos: nada que comparar */
  if (serverVersionTag === null) {
    serverVersionTag = tag;
    return;
  }
  if (tag !== serverVersionTag) {
    updateNoticeShown = true;
    navMessage(
      "Hay una versión nueva de KITE Local en el servidor. Recarga la página cuando puedas (F5) para actualizar.",
      { sticky: true } /* tono por defecto ("error", en rojo): igual que los avisos de carga fallida, para que destaque */
    );
  }
}
setInterval(checkServerVersion, VERSION_CHECK_MS);

