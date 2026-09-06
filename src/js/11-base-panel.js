/* ---------- Panel de mapas base ---------- */
const BaseControl = L.Control.extend({
  options: { position: "topright" },
  onAdd() {
    const box = L.DomUtil.create("div", "base-box leaflet-bar");
    /* Icono de capas dibujado en SVG: el emoji anterior salía diminuto y
       dependía de la fuente del sistema                              */
    box.innerHTML =
      '<button class="base-toggle" title="Mapas base" aria-label="Mapas base">'
      + '<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">'
      + '<path fill="currentColor" d="M12 2 1.5 8 12 14l10.5-6L12 2Z"/>'
      + '<path fill="currentColor" opacity=".65" d="M12 16.2 3.7 11.4 1.5 12.7 12 18.7l10.5-6-2.2-1.3L12 16.2Z"/>'
      + '<path fill="currentColor" opacity=".4" d="M12 20.4 3.7 15.6 1.5 16.9 12 22.9l10.5-6-2.2-1.3L12 20.4Z"/>'
      + '</svg></button>'
      + '<div class="base-list" hidden></div>';
    this._list = box.querySelector(".base-list");
    box.querySelector(".base-toggle").addEventListener("click", () => {
      this._list.hidden = !this._list.hidden;
      if (!this._list.hidden) ensureDynamicCatalogs();
    });
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    return box;
  }
});
const baseControl = new BaseControl();
map.addControl(baseControl);

/* El orden del Map es el de apilado; mover una capa es reconstruirlo */
function moveBaseLayer(id, delta) {
  const ids = [...baseState.keys()];
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  ids.splice(j, 0, ids.splice(i, 1)[0]);
  const entries = ids.map(k => [k, baseState.get(k)]);
  baseState.clear();
  entries.forEach(([k, st], n) => {
    st.zIndex = n + 1;
    if (st.layer) st.layer.setZIndex(st.zIndex);
    baseState.set(k, st);
  });
  renderBasePanel();
  scheduleBaseSave();
}

function renderBasePanel() {
  const list = baseControl._list;
  list.innerHTML = "";
  const ids = [...baseState.keys()];
  for (const [id, st] of baseState) {
    const row = document.createElement("div");
    row.className = "base-row" + (st.failed ? " failed" : "");
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = st.on;
    chk.id = `base-${id}`;
    const label = document.createElement("label");
    label.htmlFor = chk.id;
    label.textContent = st.def.name + (st.failed ? " (sin respuesta)" : "");
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = 0; slider.max = 1; slider.step = 0.05;
    slider.value = st.opacity;
    slider.title = "Opacidad";
    slider.disabled = !st.on;
    /* Se crea aqu\u00ED, antes del listener del checkbox, para que ese
       listener pueda deshabilitarlo/habilitarlo igual que al slider
       (si no, se queda con el `disabled` de la primera pintada y no
       reacciona a encender/apagar la capa).                          */
    const sel = st.def.dynamic ? buildDynamicLayerSelect(id, st) : null;
    /* La tuerca no se deshabilita con la capa apagada a propósito: ver
       buildDynamicConfigButton.                                       */
    const gear = st.def.dynamic ? buildDynamicConfigButton(st) : null;
    /* Un selector bloqueado (sin credencial) no se rehabilita al
       encender la capa: no hay nada que elegir todavía.               */
    const src = st.def.dynamic ? dynSource(st.def) : null;
    const selLocked = !!(src && src.blocked && src.blocked());

    chk.addEventListener("change", () => {
      st.on = chk.checked;
      slider.disabled = !st.on;
      if (sel) sel.disabled = !st.on || selLocked;
      applyBaseLayer(id);
      scheduleBaseSave();
    });
    slider.addEventListener("input", () => {
      st.opacity = Number(slider.value);
      if (st.layer) st.layer.setOpacity(st.opacity);
      scheduleBaseSave();
    });
    /* Subir y bajar en el apilado: la primera de la lista va al fondo */
    const moves = document.createElement("span");
    moves.className = "base-moves";
    for (const [glyph, delta, title] of [["\u25B2", -1, "Bajar en el apilado"],
                                         ["\u25BC", 1, "Subir en el apilado"]]) {
      const b = document.createElement("button");
      b.textContent = glyph;
      b.title = title;
      b.disabled = (delta < 0 && ids[0] === id) || (delta > 0 && ids[ids.length - 1] === id);
      b.addEventListener("click", () => moveBaseLayer(id, delta));
      moves.appendChild(b);
    }
    /* La tuerca va a la izquierda de las flechas, en la misma celda */
    const tools = document.createElement("span");
    tools.className = "base-tools";
    if (gear) tools.appendChild(gear);
    tools.appendChild(moves);
    row.append(chk, label, tools, slider);
    if (sel) row.append(sel);
    list.appendChild(row);
  }
}

/* Selector de capa para una capa base "dynamic". El mecanismo no sabe
   de PNOA ni de Copernicus: cada fuente se describe en DYNAMIC_SOURCES
   y aporta su cat\u00E1logo, su error, su valor por defecto y su
   agrupaci\u00F3n. Una fuente puede adem\u00E1s estar "bloqueada" (Copernicus
   sin instance ID todav\u00EDa), y entonces en lugar del <select> se
   ofrece el bot\u00F3n que abre su configuraci\u00F3n.                          */
function buildDynamicLayerSelect(id, st) {
  const src = dynSource(st.def);
  if (!src) return null;
  const blocked = src.blocked && src.blocked();
  if (blocked) {
    /* Sin credencial no hay catálogo que ofrecer, pero la fila debe
       decir por qué está vacía; configurarla es la tuerca de la
       cabecera de la fila (ver buildDynamicConfigButton).             */
    const sel = document.createElement("select");
    sel.title = blocked.hint;
    sel.disabled = true;
    const opt = document.createElement("option");
    opt.selected = true;
    opt.textContent = blocked.label;
    sel.appendChild(opt);
    return sel;
  }
  const catalog = src.get();
  const error = src.error();
  const sel = document.createElement("select");
  sel.title = src.selectTitle;
  sel.disabled = !st.on;
  if (error) {
    const opt = document.createElement("option");
    opt.disabled = true; opt.selected = true;
    opt.textContent = `No disponible: ${error}`;
    sel.appendChild(opt);
  } else if (!catalog) {
    const opt = document.createElement("option");
    opt.disabled = true; opt.selected = true;
    opt.textContent = "Cargando cat\u00E1logo\u2026";
    sel.appendChild(opt);
  } else {
    if (!st.wmsLayer || !catalog.some(e => e.name === st.wmsLayer)) {
      const hadSaved = !!st.wmsLayer;
      st.wmsLayer = src.pickDefault(catalog);
      if (hadSaved) {
        navMessage(`La capa guardada para \u00AB${st.def.name}\u00BB ya no est\u00E1 disponible; se usa ${st.wmsLayer}.`,
          { tone: "info" });
      }
      if (st.on) applyBaseLayer(id);
      scheduleBaseSave();
    }
    for (const group of src.groups(catalog)) {
      const og = document.createElement("optgroup");
      og.label = group.group;
      for (const entry of group.items) {
        const opt = document.createElement("option");
        opt.value = entry.name;
        opt.textContent = entry.title;
        opt.selected = entry.name === st.wmsLayer;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
  }
  sel.addEventListener("change", () => {
    st.wmsLayer = sel.value;
    applyBaseLayer(id);
    scheduleBaseSave();
  });
  return sel;
}

/* Tuerca de propiedades de una capa dinámica que se configura (hoy la
   credencial de Copernicus). Va SIEMPRE que la fuente tenga
   `configure`, con o sin credencial ya puesta: si solo apareciera
   cuando falta, no habría forma de cambiarla ni de retirarla; y si se
   deshabilitara con la capa apagada, habría que encender una capa que
   todavía no puede funcionar para poder configurarla.                 */
function buildDynamicConfigButton(st) {
  const src = dynSource(st.def);
  if (!src || !src.configure) return null;
  const blocked = src.blocked && src.blocked();
  const label = blocked ? blocked.hint : "Cambiar o borrar la credencial";
  const gear = document.createElement("button");
  gear.className = "base-gear";
  gear.textContent = "⚙";
  gear.title = label;
  gear.setAttribute("aria-label", label);
  gear.addEventListener("click", src.configure);
  return gear;
}

/* ---------- PNOA histórico (WMS del IGN) ----------
   Nada del servicio se da por sabido: el catálogo de años y vuelos
   disponibles sale de su GetCapabilities, siguiendo el mismo principio
   que el cliente WCS del MDT/MDS (makeElevationSource, más abajo).
   Verificado contra el servicio real: WMS 1.3.0, CORS abierto
   (access-control-allow-origin: *), y sirve cualquier capa reproyectada
   a EPSG:3857 (el CRS del visor) aunque esa capa solo declare
   EPSG:4258/CRS:84 en sus capacidades — no hace falta la negociación de
   CRS que sí exige el WCS.                                             */
const PNOA_HIST_URL = "https://www.ign.es/wms/pnoa-historico";
const PNOA_HIST_TIMEOUT = 10000;
/* infoVuelos es una capa de CONSULTA (GetFeatureInfo: fecha y
   resolución del vuelo bajo el cursor), no una ortofoto — no pinta
   imagen y no tiene sentido en un selector de años/vuelos.            */
const PNOA_HIST_EXCLUDE = new Set(["infoVuelos"]);
/* Los vuelos sueltos que cuelgan de la raíz sin grupo propio (SIGPAC,
   AMS_1956-1957…) necesitan un cajón con nombre; el servicio no lo da. */
const PNOA_HIST_WMS_OPTS = { exclude: PNOA_HIST_EXCLUDE, rootGroup: "Vuelos históricos" };

let pnoaHistCatalog = null;    /* [{name, title, group}] una vez resuelto */
let pnoaHistError = null;      /* mensaje legible si el descubrimiento falló */
let pnoaHistDiscovering = null;

/* WMS 1.3.0 informa sus errores como <ServiceExceptionReport>, un
   esquema distinto del <ExceptionReport> de OWS que ya cubre
   parseOwsException (usado por el WCS de elevaciones): no reutilizarlo,
   no reconocería este formato.                                        */
function parseWmsServiceException(txt) {
  if (!/ServiceExceptionReport/.test(txt)) return null;
  const doc = new DOMParser().parseFromString(txt, "text/xml");
  if (parserErrorText(doc)) return null;
  const el = firstByTag(doc, "ServiceException");
  return el ? { code: el.getAttribute("code") || "", msg: el.textContent.trim() } : null;
}

/* Recorre el árbol de <Layer> del GetCapabilities. Una capa con <Name>
   propio (hijo DIRECTO: hay un <Style><Name>default</Name></Style>
   anidado que no hay que confundir con el nombre de la capa) es una
   hoja seleccionable; una capa sin <Name> pero con hijos es un grupo
   cuyo <Title> etiqueta a esos hijos (p. ej. "PNOA anual"). Los hijos
   directos de la raíz que no cuelgan de ningún grupo propio (los
   vuelos sueltos: SIGPAC, AMS_1956-1957...) caen en un cajón editorial
   fijo, no en una lista de nombres de capa esperados de antemano.     */
/* `opts` NO se desestructura en la firma a propósito: los tests extraen
   cada función contando llaves desde la primera `{`, y un patrón de
   desestructuración ahí la truncaría (ver tests/pnoahisttest.js).     */
function collectWmsLayers(rootLayerEl, opts) {
  const exclude = opts.exclude, rootGroup = opts.rootGroup;
  const out = [];
  function walk(layerEl, groupTitle) {
    const name = directChildText(layerEl, "Name");
    const title = directChildText(layerEl, "Title") || name;
    const children = childrenByTag(layerEl, "Layer");
    if (name && !exclude.has(name)) out.push({ name, title, group: groupTitle });
    const nextGroup = (!name && children.length) ? title : groupTitle;
    children.forEach(child => walk(child, nextGroup));
  }
  childrenByTag(rootLayerEl, "Layer").forEach(child => walk(child, rootGroup));
  return out;
}

function parseWmsCapabilities(xmlText, opts) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (parserErrorText(doc)) return null;
  const root = firstByTag(doc, "Layer");
  if (!root) return null;
  const entries = collectWmsLayers(root, opts);
  return entries.length ? entries : null;
}

/* El año más reciente entre las capas "PNOAaaaa" es el valor por
   defecto más útil al activar la capa por primera vez.                */
function pnoaHistDefault(entries) {
  let best = null, bestYear = -Infinity;
  for (const e of entries) {
    const m = /^PNOA(\d{4})$/.exec(e.name);
    if (m && Number(m[1]) > bestYear) { bestYear = Number(m[1]); best = e.name; }
  }
  return best || (entries[0] && entries[0].name) || null;
}

/* Agrupa para el <select>: "PNOA anual" primero (año descendente) y
   "Vuelos históricos" segundo, que son los que pide el usuario;
   cualquier otro grupo que el servicio publique (hoy "PNOA10") va al
   final, en el orden en que se descubra — sin hardcodear su nombre.   */
function groupPnoaHistEntries(entries) {
  const byGroup = new Map();
  for (const e of entries) {
    if (!byGroup.has(e.group)) byGroup.set(e.group, []);
    byGroup.get(e.group).push(e);
  }
  const annual = byGroup.get("PNOA anual");
  if (annual) {
    annual.sort((a, b) =>
      (Number((/^PNOA(\d{4})$/.exec(b.name) || [])[1]) || 0)
      - (Number((/^PNOA(\d{4})$/.exec(a.name) || [])[1]) || 0));
  }
  const groups = [];
  for (const name of ["PNOA anual", "Vuelos históricos"]) {
    if (byGroup.has(name)) { groups.push({ group: name, items: byGroup.get(name) }); byGroup.delete(name); }
  }
  for (const [name, items] of byGroup) groups.push({ group: name, items });
  return groups;
}

async function fetchPnoaHistoricoCatalog() {
  if (pnoaHistCatalog) return pnoaHistCatalog;
  if (pnoaHistDiscovering) return pnoaHistDiscovering;
  pnoaHistError = null;
  pnoaHistDiscovering = (async () => {
    const r = await fetch(`${PNOA_HIST_URL}?service=WMS&request=GetCapabilities&version=1.3.0`,
      { signal: AbortSignal.timeout(PNOA_HIST_TIMEOUT) });
    const txt = await r.text();
    /* El error OGC puede viajar en el cuerpo aunque el HTTP sea 200 */
    const ex = parseWmsServiceException(txt);
    if (ex) throw new Error(ex.msg);
    if (!r.ok) throw new Error(describeHttp(r.status));
    const entries = parseWmsCapabilities(txt, PNOA_HIST_WMS_OPTS);
    if (!entries) throw new Error("el servicio no declara capas");
    pnoaHistCatalog = entries;
    return entries;
  })().catch(err => {
    pnoaHistDiscovering = null; /* permite reintentar en la próxima llamada */
    pnoaHistError = err.name === "TimeoutError" ? "el servicio no responde"
      : err.message === "Failed to fetch" ? "el servicio no admite consultas desde el navegador (CORS)"
      : err.message;
    throw err;
  });
  return pnoaHistDiscovering;
}

/* Punto de entrada único: se puede llamar todas las veces que haga
   falta (abrir el panel, encender la capa, arrancar con ella guardada
   como encendida) sin repetir una petición ya en vuelo ni relanzarla
   una vez resuelta con éxito.                                         */
function ensurePnoaHistCatalog() {
  if (pnoaHistCatalog) return;
  fetchPnoaHistoricoCatalog().then(onDynamicCatalogReady).catch(() => renderBasePanel());
}

/* Capas dinámicas encendidas que se diferieron por falta de catálogo
   (ver applyBaseLayer) ya pueden crearse.                             */
function onDynamicCatalogReady() {
  for (const [id, st] of baseState) if (st.def.dynamic && st.on) applyBaseLayer(id);
  renderBasePanel();
}

