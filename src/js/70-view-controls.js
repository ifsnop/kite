/* ================= Controles de vista del visor ================= */

let gratButton = null;
let elevUnitButton = null;

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
    demButton.title = "Modo altura: consulta el MDT (terreno) y el MDS"
      + " (superficie) del IGN bajo el cursor (Espa\u00F1a; requiere conexi\u00F3n)";
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
  const labelLng = Math.max(view.getWest(), west);
  const labelLat = Math.min(view.getNorth(), north);

  let n = 0;
  for (let i = Math.ceil(south / step); i * step <= north && n < GRAT_MAX_LINES; i++, n++) {
    const lat = i * step;
    graticuleLayer.addLayer(L.polyline([[lat, west], [lat, east]], style));
    graticuleLayer.addLayer(gratLabel([lat, labelLng], `\u00A0${lat.toFixed(dec)}\u00B0`));
  }
  n = 0;
  for (let i = Math.ceil(west / step); i * step <= east && n < GRAT_MAX_LINES; i++, n++) {
    const lng = i * step;
    graticuleLayer.addLayer(L.polyline([[south, lng], [north, lng]], style));
    graticuleLayer.addLayer(gratLabel([labelLat, lng], `${lng.toFixed(dec)}\u00B0`));
  }
}
map.on("moveend zoomend", redrawGraticule);

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

/* PageUp/PageDown zoom the map while it has focus. Listening directly on
   the map container (like the polygon-drawing click/dblclick above)
   means this only fires with focus inside #map. preventDefault stops
   the browser's native whole-page scroll; Leaflet's own keyboard
   handler doesn't act on these two keys, so today they do nothing.
   Anchored on coordsPending (the last known cursor position) so the zoom
   behaves like the mouse wheel's, which zooms toward the cursor instead
   of the view center; without a prior mousemove (focus reached via Tab)
   there's no known position and it falls back to zooming on the center. */
map.getContainer().addEventListener("keydown", e => {
  if (e.key !== "PageUp" && e.key !== "PageDown") return;
  e.preventDefault();
  const target = map.getZoom() + (e.key === "PageUp" ? 1 : -1);
  if (coordsPending) map.setZoomAround(coordsPending, target);
  else map.setZoom(target);
});

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
  { label: "Modo elevación", checked: () => demOn, action: () => setAltitudeMode(!demOn) },
  { label: "Medir línea", action: () => setTool(activeTool === "line" ? null : "line") },
  { label: "Medir círculo", action: () => setTool(activeTool === "circle" ? null : "circle") },
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
const goToNodeAndBlink = li => { highlightNode(li); blinkLayer(li); };

/* Ítems de UNA capa: ir al nodo, y mostrar propiedades si tiene algo
   que enseñar (igual criterio que el botón ℹ de la fila).             */
function layerCtxItems(li) {
  const items = [{ label: "Ir al nodo en el panel", action: () => goToNodeAndBlink(li) }];
  if (infoHtmlFor(li) != null) items.push({ label: "Mostrar propiedades", action: () => showLayerInfo(li) });
  return items;
}

/* Con varias capas bajo el cursor, "Ir al nodo…" y "Mostrar
   propiedades" se convierten en disparadores de submenú (`.items`) con
   una entrada por capa, en vez de actuar directamente.                */
function ctxItemsFor(hits) {
  if (!hits.length) return CTX_MENU_ITEMS;
  if (hits.length === 1) return [...layerCtxItems(hits[0]), { separator: true }, ...CTX_MENU_ITEMS];
  const withInfo = hits.filter(li => infoHtmlFor(li) != null);
  const items = [{
    label: "Ir al nodo en el panel",
    items: hits.map(li => ({ label: li._name, action: () => goToNodeAndBlink(li) }))
  }];
  if (withInfo.length) {
    items.push({
      label: "Mostrar propiedades",
      items: withInfo.map(li => ({ label: li._name, action: () => showLayerInfo(li) }))
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
      if (isTopLevel) btn.addEventListener("mouseenter", closeCtxSubmenu);
      btn.addEventListener("click", () => { closeCtxMenu(); item.action(latlng); });
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
map.on("contextmenu", e => {
  L.DomEvent.preventDefault(e.originalEvent);
  const hits = layersAtPoint(e.latlng, e.containerPoint);
  openCtxMenu(e.latlng, e.originalEvent.clientX, e.originalEvent.clientY, hits);
});
map.on("movestart zoomstart", closeCtxMenu);
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

