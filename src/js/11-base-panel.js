/* ---------- Panel de mapas base ---------- */
const BaseControl = L.Control.extend({
  options: { position: "topright" },
  onAdd() {
    const box = L.DomUtil.create("div", "base-box leaflet-bar");
    /* Icono de capas dibujado en SVG: el emoji anterior salía diminuto y
       dependía de la fuente del sistema. Coordenadas Y desplazadas
       -0.45 respecto del dibujo original para centrar el bounding box
       vertical real (antes [2, 22.9], centro 12.45) en el centro del
       viewBox de 24 (12) — el eje X ya estaba centrado.               */
    box.innerHTML =
      `<button class="base-toggle" title="${tr("Mapas base")}" aria-label="${tr("Mapas base")}">`
      + '<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">'
      + '<path fill="currentColor" d="M12 1.55 1.5 7.55 12 13.55l10.5-6L12 1.55Z"/>'
      + '<path fill="currentColor" opacity=".65" d="M12 15.75 3.7 10.95 1.5 12.25 12 18.25l10.5-6-2.2-1.3L12 15.75Z"/>'
      + '<path fill="currentColor" opacity=".4" d="M12 19.95 3.7 15.15 1.5 16.45 12 22.45l10.5-6-2.2-1.3L12 19.95Z"/>'
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

/* La lista de mapas base ocupa buena parte del visor y tapa otros diálogos:
   se cierra al actuar en cualquier otro sitio (un clic o una tecla fuera de
   ella). Se mira en CAPTURA y en `document`, no con los eventos de Leaflet:
   los controles detienen mousedown/click (disableClickPropagation) y el
   mapa nunca los vería. Lo que NO cuenta como «fuera»: la propia caja
   (casillas, deslizadores, flechas, tuerca) y el selector de color, que
   cuelga del <body> pero nace del botón de color de su primera fila. Escape
   no pasa por aquí: lo atiende la cadena de Escape (52-measure.js), que
   cierra antes lo que tenga encima. Pulsar de nuevo el botón de capas la
   sigue cerrando, como siempre.                                           */
function closeBasePanel() { baseControl._list.hidden = true; }
const BASE_KEYS_IGNORED = new Set(["Escape", "Tab", "Shift", "Control", "Alt", "Meta", "CapsLock"]);
function closeBasePanelOutside(e) {
  if (baseControl._list.hidden) return;
  const t = e.target;
  if (t instanceof Node && (baseControl.getContainer().contains(t)
      || document.getElementById("color-picker").contains(t))) return;
  closeBasePanel();
}
document.addEventListener("pointerdown", closeBasePanelOutside, true);
document.addEventListener("keydown", e => { if (!BASE_KEYS_IGNORED.has(e.key)) closeBasePanelOutside(e); }, true);

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
  list.appendChild(buildMapBackgroundRow());
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
    label.textContent = st.def.name + (st.failed ? " " + tr("(sin respuesta)") : "");
    /* a user's name can be long: the row cuts it and the tooltip has it whole */
    if (st.def.user) label.title = st.def.name;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = 0; slider.max = 1; slider.step = 0.05;
    slider.value = st.opacity;
    slider.title = tr("Opacidad");
    slider.disabled = !st.on;
    /* Se crea aqu\u00ED, antes del listener del checkbox, para que ese
       listener pueda deshabilitarlo/habilitarlo igual que al slider
       (si no, se queda con el `disabled` de la primera pintada y no
       reacciona a encender/apagar la capa).                          */
    const sel = st.def.dynamic ? buildDynamicLayerSelect(id, st) : null;
    /* The gear depends on having a CONFIGURABLE source (`configure`),
       not on being "dynamic": a user tile layer has a gear (an address to
       change) but no catalog nor <select> to choose from, unlike
       Copernicus or a user WMS, which have both. The gear is not disabled
       with the layer off on purpose: see buildDynamicConfigButton.     */
    const src = dynSource(st.def);
    const gear = src && src.configure ? buildDynamicConfigButton(st) : null;
    /* Un selector bloqueado (sin credencial) no se rehabilita al
       encender la capa: no hay nada que elegir todavía.               */
    const selLocked = !!(st.def.dynamic && src && src.blocked && src.blocked());

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
    for (const [glyph, delta, title] of [["\u25B2", -1, tr("Bajar en el apilado")],
                                         ["\u25BC", 1, tr("Subir en el apilado")]]) {
      const b = document.createElement("button");
      b.textContent = glyph;
      b.title = title;
      b.disabled = (delta < 0 && ids[0] === id) || (delta > 0 && ids[ids.length - 1] === id);
      b.addEventListener("click", () => moveBaseLayer(id, delta));
      moves.appendChild(b);
    }
    /* Gear and delete go left of the arrows, in the same cell */
    const tools = document.createElement("span");
    tools.className = "base-tools";
    if (gear) tools.appendChild(gear);
    if (st.def.user) tools.appendChild(buildUserBaseDeleteButton(st));
    tools.appendChild(moves);
    row.append(chk, label, tools, slider);
    if (sel) row.append(sel);
    list.appendChild(row);
  }
  list.appendChild(buildAddUserBaseButton());
}

/* Primera fila del panel, antes de cualquier capa: el color que se ve
   DETRÁS de las teselas (huecos sin cobertura, o el borde del mundo —
   no hay desplazamiento infinito, ver «Una sola Tierra»), no una capa
   de mapa en sí. No lleva casilla propia porque no es algo que se
   "encienda o apague"; comparte el mismo `toggleColorPicker` popover que
   los colores del diálogo de estilos, con sus propios `onPreview`/
   `onCommit`: no hay ningún diálogo exterior con Cancelar/Aceptar que
   lo diferido, así que aquí ES el propio selector de color quien lo
   hace — `onPreview` aplica el fondo al mapa EN VIVO mientras se elige
   (sin guardarlo: es lo que se deshace si se cancela) y `onCommit`,
   que solo se llama al pulsar «Aceptar» del selector, lo persiste.   */
function buildMapBackgroundRow() {
  const row = document.createElement("div");
  row.className = "base-row base-row-bg";
  row.appendChild(document.createElement("span")); /* alinea con la columna de las casillas */
  const label = document.createElement("label");
  label.textContent = tr("Color de fondo");
  const tools = document.createElement("span");
  tools.className = "base-tools";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "color-btn";
  btn.title = tr("Color de fondo del mapa");
  btn.setAttribute("aria-label", tr("Color de fondo del mapa"));
  setColorButton(btn, mapBgColor);
  btn.addEventListener("click", e => {
    e.preventDefault();
    toggleColorPicker(btn, {
      onPreview: (target, hex) => { setColorButton(target, hex); setMapBackground(hex); },
      onCommit: (target, hex) => { dbSaveMapBackground(hex).catch(() => {}); }
    });
  });
  tools.appendChild(btn);
  row.append(label, tools);
  return row;
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
    opt.textContent = tr("No disponible: {error}", { error });
    sel.appendChild(opt);
  } else if (!catalog) {
    const opt = document.createElement("option");
    opt.disabled = true; opt.selected = true;
    opt.textContent = tr("Cargando cat\u00E1logo\u2026");
    sel.appendChild(opt);
  } else {
    if (!st.wmsLayer || !catalog.some(e => e.name === st.wmsLayer)) {
      const hadSaved = !!st.wmsLayer;
      st.wmsLayer = src.pickDefault(catalog);
      if (hadSaved) {
        navMessage(tr("La capa guardada para \u00AB{name}\u00BB ya no est\u00E1 disponible; se usa {wmsLayer}.", { name: st.def.name, wmsLayer: st.wmsLayer }),
          { tone: "info" });
      }
      if (st.on) applyBaseLayer(id);
      scheduleBaseSave();
    }
    for (const group of src.groups(catalog)) {
      const og = document.createElement("optgroup");
      og.label = tr(group.group);
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
  const label = blocked ? blocked.hint : src.configureLabel || tr("Cambiar o borrar la configuración");
  const gear = document.createElement("button");
  gear.className = "base-gear";
  gear.textContent = "⚙";
  gear.title = label;
  gear.setAttribute("aria-label", label);
  gear.addEventListener("click", src.configure);
  return gear;
}

/* ---------- User base layers: tile and WMS servers the user adds ----------
   Besides the fixed list (BASE_LAYERS, 10-map.js) the user can add, edit
   and delete their own base layers from the panel: the «＋» button at the
   bottom of the list opens a dialog (44-dialogs.js) where they choose the
   type, give a name and paste the address. Two types, the two ways a map
   server is reached:
   - "tiles": a tile server (XYZ or TMS). Either a base address, to which
     `{z}/{x}/{y}.png` is appended (a cache in front of OpenStreetMap), or
     a whole template with its own placeholders, which covers the other
     orders and formats of the fixed layers (Esri's `{z}/{y}/{x}`, `.jpg`,
     a WMTS in KVP form like the IGN's). `tms` counts rows from the bottom.
   - "wms": a WMS server WITH a catalog: its layers come from its own
     GetCapabilities, like PNOA histórico's, so the row gets the <select>.
   Each layer carries its own source (`def.src`, read by `dynSource`): the
   catalog, the version and image format the server announced and the
   query in flight belong to that layer, not to a module global, so there
   can be several of each type. A user layer always has a valid address:
   there is no "blocked" state. They are kept in this browser only
   (`userBases`, 32-geojson.js), never in a .kite.json nor in a view link
   (LINK_BASE_IDS only lists BASE_LAYERS).                               */
const USER_BASES_MAX = 20;
const USER_BASE_NAME_MAX = 80;
const USER_BASE_TYPES = ["tiles", "wms"];
const USER_BASE_ID = /^u[0-9a-f]{12}$/;
/* Placeholders a tile template may carry: the ones Leaflet's L.tileLayer
   fills in by itself. Any other would make it throw on every tile.     */
const USER_TILE_VARS = new Set(["z", "x", "y", "-y", "s"]);
const TEMPLATE_VAR = /\{([^{}]*)\}/g;

/* Drops any trailing slash: `userTilesTemplate` adds its own, and two
   slashes in a row ("...//{z}/...") are a different path on many servers. */
function normalizeCustomTilesBase(url) {
  return url.trim().replace(/\/+$/, "");
}

const templateVars = url => [...url.matchAll(TEMPLATE_VAR)].map(m => m[1]);

/* What L.tileLayer receives: the template as written, or the base address
   with the XYZ scheme appended. Only called when the layer is built.    */
function userTilesTemplate(url) {
  return templateVars(url).length ? url.trim() : `${normalizeCustomTilesBase(url)}/{z}/{x}/{y}.png`;
}

/* Why an address cannot be used, in one line, or null if it can. Only
   https (as connect-src: the user picks the origin, so no closed list is
   possible) and no user or password (fetch rejects such a URL with a
   cryptic error; for tiles it would only leak them in every request).   */
function userBaseUrlProblem(type, txt) {
  const s = (txt || "").trim();
  let probe = s;
  if (type === "tiles") {
    const vars = templateVars(s);
    const unknown = vars.find(v => !USER_TILE_VARS.has(v));
    if (unknown !== undefined) {
      return tr("Una plantilla solo admite {z}, {x}, {y}, {-y} y {s}; no se reconoce «{var}».", { var: `{${unknown}}` });
    }
    if (vars.length && !(vars.includes("z") && vars.includes("x") && (vars.includes("y") || vars.includes("-y")))) {
      return tr("Una plantilla tiene que llevar {z}, {x} e {y} (o {-y}).");
    }
    probe = s.replace(TEMPLATE_VAR, "0");
  }
  let u;
  try { u = new URL(probe); } catch { u = null; }
  if (!u || u.protocol !== "https:") return tr("Debe ser una dirección https:// válida.");
  if (u.username || u.password) return tr("La dirección no puede llevar usuario ni contraseña.");
  return null;
}

/* Stored form of an address: a WMS loses its OGC parameters, a tile
   address is kept as written (its template is built when the layer is). */
function normalizeUserBaseUrl(type, url) {
  return type === "wms" ? normalizeCustomWmsBase(url) : url.trim();
}

/* Name for a layer whose name was left empty: its server's host.       */
function userBaseDefaultName(url) {
  try { return new URL(url.trim().replace(TEMPLATE_VAR, "0")).hostname || url.trim(); } catch { return url.trim(); }
}

/* Builds a stored record from what the dialog or IndexedDB gives, or
   returns null if it is not valid. Pure: the dialog and the reading of
   what was saved (foreign input: another version, a tampered database)
   go through the same checks.                                          */
function userBaseRecord(id, input) {
  if (!input || typeof input !== "object" || typeof id !== "string" || !USER_BASE_ID.test(id)) return null;
  const type = input.type;
  if (!USER_BASE_TYPES.includes(type) || typeof input.url !== "string") return null;
  if (userBaseUrlProblem(type, input.url)) return null;
  const url = normalizeUserBaseUrl(type, input.url);
  const typed = typeof input.name === "string" ? input.name.trim().slice(0, USER_BASE_NAME_MAX) : "";
  const rec = { id, type, name: typed || userBaseDefaultName(url).slice(0, USER_BASE_NAME_MAX), url };
  if (type === "tiles" && input.tms === true) rec.tms = true;
  return rec;
}

/* What was saved: bad entries and repeated ids are dropped, and no more
   than USER_BASES_MAX survive.                                         */
function validUserBases(list) {
  if (!Array.isArray(list)) return [];
  const out = [], seen = new Set();
  for (const item of list) {
    if (out.length >= USER_BASES_MAX) break;
    const rec = item && userBaseRecord(item.id, item);
    if (!rec || seen.has(rec.id)) continue;
    seen.add(rec.id);
    out.push(rec);
  }
  return out;
}

/* A user server may nest its layers in groups (the group titles already
   label their children); those hanging straight from the root go here. */
const CUSTOM_WMS_OPTS = { exclude: new Set(), rootGroup: N_("Capas del servidor") };
/* OGC parameters that the code (or `L.tileLayer.wms`) sets and that must
   leave the address the user pastes, which is often a whole GetCapabilities
   or GetMap request. The rest (e.g. MapServer's `map=/path.map`) are part
   of the address and are kept.                                          */
const CUSTOM_WMS_RESERVED = ["service", "request", "version", "wmtver", "layers", "styles", "crs", "srs",
  "format", "transparent", "width", "height", "bbox"];
const CUSTOM_WMS_VERSIONS = ["1.1.0", "1.1.1", "1.3.0"];
/* Image formats we know how to request, by preference: PNG (transparency,
   what an overlay wants) and JPEG (some servers serve only that,
   typically orthophotos).                                               */
const CUSTOM_WMS_FORMATS = ["image/png", "image/jpeg", "image/jpg"];

/* Same rule as userBaseUrlProblem for a WMS, as a yes/no. */
function validCustomWmsUrl(txt) {
  return userBaseUrlProblem("wms", txt) === null;
}

/* Leaves the address as a base: without the OGC parameters (often pasted
   with a whole GetCapabilities) and without an anchor.                 */
function normalizeCustomWmsBase(url) {
  const u = new URL(url.trim());
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (CUSTOM_WMS_RESERVED.includes(key.toLowerCase())) u.searchParams.delete(key);
  }
  return u.toString();
}

/* `searchParams.set` keeps the address's own parameters (`?map=...`)
   instead of appending a second `?`.                                    */
function customWmsCapabilitiesUrl(base) {
  const u = new URL(base);
  u.searchParams.set("service", "WMS");
  u.searchParams.set("request", "GetCapabilities");
  u.searchParams.set("version", "1.3.0");
  return u.toString();
}

/* A server that only speaks 1.1.1 answers a 1.3.0 request with its own
   version; tiles are then requested in that one (Leaflet switches
   `crs`/`srs` with the version). Anything unknown stays at 1.3.0.       */
function wmsCapabilitiesVersion(xmlText) {
  const m = /<(?:[\w.-]+:)?WM(?:S|T_MS)_Capabilities\b[^>]*?\sversion\s*=\s*["']([^"']+)["']/.exec(xmlText);
  return m && CUSTOM_WMS_VERSIONS.includes(m[1]) ? m[1] : "1.3.0";
}

/* Image format for GetMap: the first of CUSTOM_WMS_FORMATS the server
   declares in its <GetMap>. Parameters are ignored when comparing
   ("image/png; mode=8bit") and the bare type is requested. If it declares
   none we know, or the document cannot be read, PNG: if the server does
   not serve it either, the tiles fail in sight (BASE_FAIL_TILES) instead
   of choosing blindly.                                                  */
function wmsGetMapFormat(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (parserErrorText(doc)) return "image/png";
  const getMap = firstByTag(doc, "GetMap");
  if (!getMap) return "image/png";
  const offered = childrenByTag(getMap, "Format").map(f => f.textContent.split(";")[0].trim().toLowerCase());
  return CUSTOM_WMS_FORMATS.find(f => offered.includes(f)) || "image/png";
}

/* Groups for the <select> in the order the server publishes them */
function groupWmsEntries(entries) {
  const byGroup = new Map();
  for (const e of entries) {
    if (!byGroup.has(e.group)) byGroup.set(e.group, []);
    byGroup.get(e.group).push(e);
  }
  return [...byGroup].map(([group, items]) => ({ group, items }));
}

/* The source of a user WMS: the shape of a DYNAMIC_SOURCES entry
   (12-copernicus.js), with its state inside. `err` and not `error`: the
   latter is the method the panel calls.                                 */
function makeUserWmsSource(def) {
  const src = {
    selectTitle: tr("Capa del servidor WMS"),
    configureLabel: tr("Modificar esta capa base"),
    get: () => src.catalog,
    error: () => src.err,
    ensure: () => ensureUserWmsCatalog(def),
    pickDefault: entries => entries[0] && entries[0].name,
    groups: groupWmsEntries,
    configure: () => openUserBaseDialog(def.id)
  };
  resetUserWmsSource(src);
  return src;
}
function resetUserWmsSource(src) {
  src.catalog = null;      /* [{name, title, group}] once resolved */
  src.err = null;
  src.discovering = null;
  src.version = "1.3.0";   /* the one its GetCapabilities announced */
  src.format = "image/png"; /* the one `wmsGetMapFormat` chose */
}

/* The definition a user layer gets in `baseState`: the same fields as a
   BASE_LAYERS entry (the panel and applyBaseLayer do not tell them
   apart) plus `user`, its stored record. `layer()` reads the address,
   version and format at the moment it builds, never before.            */
function makeUserBaseDef(rec) {
  const def = { id: rec.id, name: rec.name, user: rec, diagnoseTiles: true };
  if (rec.type === "wms") {
    def.dynamic = true;
    def.src = makeUserWmsSource(def);
    /* JPEG has no alpha channel: `transparent` only with PNG */
    def.layer = wmsLayer => L.tileLayer.wms(def.user.url, {
      layers: wmsLayer, format: def.src.format, version: def.src.version,
      transparent: def.src.format === "image/png",
      maxZoom: MAX_ZOOM, attribution: CUSTOM_WMS_CREDIT });
  } else {
    /* No catalog and no <select>: the source only brings the gear */
    def.src = { configureLabel: tr("Modificar esta capa base"), configure: () => openUserBaseDialog(def.id) };
    def.layer = () => L.tileLayer(userTilesTemplate(def.user.url), {
      tms: !!def.user.tms, maxNativeZoom: 19, maxZoom: MAX_ZOOM, attribution: CUSTOM_TILES_CREDIT });
  }
  return def;
}

async function fetchUserWmsCatalog(def) {
  const src = def.src;
  if (src.catalog) return src.catalog;
  if (src.discovering) return src.discovering;
  const base = def.user.url;
  /* An address changed, or the layer deleted, while the query was in
     flight: what the old one answers must not overwrite anything.       */
  const stale = () => base !== def.user.url || !baseState.has(def.id);
  src.err = null;
  const discovering = (async () => {
    const r = await fetch(customWmsCapabilitiesUrl(base),
      { signal: AbortSignal.timeout(CFG.CUSTOM_WMS_TIMEOUT) });
    const txt = await r.text();
    /* The OGC error may travel in the body even with HTTP 200 */
    const ex = parseWmsServiceException(txt);
    if (ex) throw new Error(ex.msg);
    if (!r.ok) throw new Error(describeHttp(r.status));
    const entries = parseWmsCapabilities(txt, CUSTOM_WMS_OPTS);
    if (!entries) throw new Error(tr("la respuesta no es un GetCapabilities de WMS con capas"));
    if (!stale()) {
      src.catalog = entries;
      /* A layer already built (one saved as on, raised without waiting
         for the catalog) carries the assumed version and format: if the
         server speaks something else, it is rebuilt.                    */
      const version = wmsCapabilitiesVersion(txt), format = wmsGetMapFormat(txt);
      if (version !== src.version || format !== src.format) {
        src.version = version;
        src.format = format;
        dropBaseLayer(baseState.get(def.id));
      }
    }
    return entries;
  })().catch(err => {
    if (src.discovering === discovering) src.discovering = null; /* allows a retry */
    if (!stale()) {
      src.err = err.name === "TimeoutError" ? tr("el servidor no responde")
        : err.message === "Failed to fetch" ? netFailText(tr("no se pudo conectar con el servidor WMS (¿CORS?)"))
        : err.message;
    }
    throw err;
  });
  src.discovering = discovering;
  return discovering;
}

function ensureUserWmsCatalog(def) {
  if (def.src.catalog || !baseState.has(def.id)) return;
  fetchUserWmsCatalog(def).then(onDynamicCatalogReady).catch(() => renderBasePanel());
}

/* Takes the built layer off the map so that `applyBaseLayer` builds it
   again with what holds now (address, version, format).                */
function dropBaseLayer(st) {
  if (!st) return;
  if (st.layer && map.hasLayer(st.layer)) map.removeLayer(st.layer);
  st.layer = null;
  st.failed = false;
  st.tileNoticed.clear();
}

const userBaseStates = () => [...baseState.values()].filter(st => st.def.user);

/* Puts a user layer in `baseState`, on top of the stack (the end of the
   Map), without saving anything: the boot calls it for what was saved. */
function addUserBaseLayer(rec) {
  const st = baseStateFor(makeUserBaseDef(rec), baseState.size + 1);
  baseState.set(rec.id, st);
  return st;
}

function saveUserBases() {
  dbSaveUserBases(userBaseStates().map(st => st.def.user)).catch(() => {});
}

/* «Añadir»: the new layer goes on top and ON. The user asked for it, so
   they get to see it; turning it off is one click.                     */
function createUserBase(input) {
  if (userBaseStates().length >= USER_BASES_MAX) return null;
  const rec = userBaseRecord("u" + newStoreId().slice(0, 12), input);
  if (!rec) return null;
  const st = addUserBaseLayer(rec);
  st.on = true;
  saveUserBases();
  scheduleBaseSave();
  if (st.def.dynamic) ensureUserWmsCatalog(st.def);
  renderBasePanel();
  applyBaseLayer(rec.id);
  return rec.id;
}

/* The gear: name, address and (tiles) row order. The type does not
   change: that is another layer. Renaming touches nothing else; a new
   address or row order drops the built layer, whose template carries the
   old one, and for a WMS the catalog and the chosen layer too.          */
function updateUserBase(id, input) {
  const st = baseState.get(id);
  if (!st || !st.def.user) return false;
  const old = st.def.user;
  const rec = userBaseRecord(id, { ...input, type: old.type });
  if (!rec) return false;
  st.def.user = rec;
  st.def.name = rec.name;
  const moved = rec.url !== old.url || !!rec.tms !== !!old.tms;
  if (moved) {
    dropBaseLayer(st);
    if (st.def.dynamic) {
      resetUserWmsSource(st.def.src);
      st.wmsLayer = null;
      ensureUserWmsCatalog(st.def);
    }
  }
  saveUserBases();
  scheduleBaseSave();
  renderBasePanel();
  if (moved && st.on) applyBaseLayer(id);
  return true;
}

/* Delete (after the confirmation, 44-dialogs.js): off the map, out of the
   list, and the rest of the stack keeps its order with contiguous z.    */
function removeUserBase(id) {
  const st = baseState.get(id);
  if (!st || !st.def.user) return;
  dropBaseLayer(st);
  baseState.delete(id);
  let z = 0;
  for (const other of baseState.values()) {
    other.zIndex = ++z;
    if (other.layer) other.layer.setZIndex(other.zIndex);
  }
  saveUserBases();
  scheduleBaseSave();
  renderBasePanel();
}

/* Row buttons and the «＋» at the bottom of the list */
function buildUserBaseDeleteButton(st) {
  const label = tr("Eliminar esta capa base");
  const b = document.createElement("button");
  b.className = "base-gear base-del";
  b.textContent = "×";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.addEventListener("click", () => openUserBaseDeleteConfirm(st.def.id));
  return b;
}
function buildAddUserBaseButton() {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn base-add";
  b.textContent = tr("+ Añadir capa…");
  const full = userBaseStates().length >= USER_BASES_MAX;
  b.disabled = full;
  b.title = full ? tr("Ya hay {n} capas propias, el máximo. Elimina alguna para añadir otra.", { n: USER_BASES_MAX })
    : tr("Añadir un servidor de teselas o WMS propio como capa base");
  b.addEventListener("click", () => openUserBaseDialog(null));
  return b;
}

/* ---------- Tiles a user's server does not deliver ----------
   A server that answers with an error (a WMS does it with HTTP 200 and an
   XML <ServiceException>) shows nothing: the tile is an <img> that cannot
   decode that answer, Leaflet hides it and what lies below shows through,
   with no hint that something is missing. Two things, only for the
   servers the user adds (`diagnoseTiles`, set by makeUserBaseDef: with the
   known services tiles outside their coverage are normal and painting
   them red would be noise):
   - the tile gets a red outline (`.tile-error`, styles.css);
   - the FIRST one of each layer is requested again with `fetch` to read
     what the server said, and a notice gives that text. Once per layer:
     with a server failing across the map it would be dozens of repeated
     requests to a service that is already failing.                      */
const TILE_DIAG_TIMEOUT = 10000;
const TILE_REASON_MAX = 200;

/* Qué dijo el servidor en lugar de la imagen, en una línea; null si lo
   que llegó SÍ es una imagen. Función pura (tests/tilediag.js).        */
function tileFailureReason(status, contentType, body) {
  if (status >= 200 && status < 300 && /^image\//i.test(contentType)) return null;
  const ex = parseWmsServiceException(body);
  let reason;
  if (ex) reason = ex.msg || tr("excepci\u00F3n del servicio sin mensaje");
  else if (status < 200 || status >= 300) reason = describeHttp(status);
  else reason = tr("respuesta {type} en vez de una imagen", { type: contentType.split(";")[0].trim() || tr("sin tipo") });
  return reason.length > TILE_REASON_MAX ? reason.slice(0, TILE_REASON_MAX) + "\u2026" : reason;
}

/* `reasonOf` es quien interpreta lo que contestó el servidor (WMS por
   defecto; un servicio ArcGIS trae el suyo): la misma comprobación, otro
   formato de error.                                                    */
async function diagnoseTile(name, url, reasonOf = tileFailureReason) {
  let reason;       /* undefined = no se pudo averiguar */
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TILE_DIAG_TIMEOUT) });
    const type = r.headers.get("content-type") || "";
    /* Las imágenes no se leen como texto: solo interesa saber que llegaron */
    const body = /^image\//i.test(type) ? "" : (await r.text()).slice(0, 20000);
    reason = reasonOf(r.status, type, body);
  } catch { /* red, CORS o tiempo: se avisa sin motivo */ }
  name = `\u00AB${name}\u00BB`;
  if (reason === undefined) {
    navMessage(tr("{name}: una tesela no se pudo cargar (contorno rojo) y no se pudo averiguar el motivo: {why}.",
      { name, why: netFailText(tr("el servidor no responde o no admite consultas desde el navegador (CORS)")) }));
  } else if (reason === null) {
    navMessage(tr("{name}: una tesela fall\u00F3 y al pedirla de nuevo el servidor respondi\u00F3 bien (\u00BFlento o saturado?).", { name }));
  } else {
    navMessage(tr("{name}: el servidor devolvi\u00F3 un error en una tesela (contorno rojo): {reason}", { name, reason }));
  }
}

function flagTileError(st, e) {
  e.tile.classList.add("tile-error");
  const key = st.wmsLayer || "";
  if (st.tileNoticed.has(key)) return;
  st.tileNoticed.add(key);
  diagnoseTile(st.def.name, e.tile.src);
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
const PNOA_HIST_WMS_OPTS = { exclude: PNOA_HIST_EXCLUDE, rootGroup: N_("Vuelos históricos") };

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
  const topLevel = childrenByTag(rootLayerEl, "Layer");
  topLevel.forEach(child => walk(child, rootGroup));
  /* Un servidor con una sola capa suele publicarla como la propia raíz,
     sin hijos: no es un grupo, es la capa. (Con hijos, la raíz solo los
     agrupa.)                                                           */
  const rootName = directChildText(rootLayerEl, "Name");
  if (!topLevel.length && rootName && !exclude.has(rootName)) {
    out.push({ name: rootName, title: directChildText(rootLayerEl, "Title") || rootName, group: rootGroup });
  }
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
  const annual = byGroup.get(N_("PNOA anual"));
  if (annual) {
    annual.sort((a, b) =>
      (Number((/^PNOA(\d{4})$/.exec(b.name) || [])[1]) || 0)
      - (Number((/^PNOA(\d{4})$/.exec(a.name) || [])[1]) || 0));
  }
  const groups = [];
  for (const name of [N_("PNOA anual"), N_("Vuelos históricos")]) {
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
    if (!entries) throw new Error(tr("el servicio no declara capas"));
    pnoaHistCatalog = entries;
    return entries;
  })().catch(err => {
    pnoaHistDiscovering = null; /* permite reintentar en la próxima llamada */
    pnoaHistError = err.name === "TimeoutError" ? tr("el servicio no responde")
      : err.message === "Failed to fetch" ? netFailText(tr("el servicio no admite consultas desde el navegador (CORS)"))
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

