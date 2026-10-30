/* ---------- Servicios ArcGIS (MapServer) ----------
   A service the user pastes in the 🔗 dialog becomes ONE tree node with a
   child row per layer of the service. The node owns a single tile layer
   whose tiles are `/export` images of just the layers whose checkbox is
   on (`layers=show:…`), so the server draws symbols and labels itself.

   Why our own TileLayer and not esri-leaflet's DynamicMapLayer: that one
   asks for a single image of the whole view (map.getBounds/getSize),
   which does not know about the rotated map (08-map-rotation.js), the
   tile error handling of the base maps, or `bounds`; an `L.TileLayer`
   whose URL is a bbox in EPSG:3857 gets all of that for free, exactly as
   `L.tileLayer.wms` does.

   Everything above `ArcgisLayer` is pure and tested in Node
   (tests/arcgistest.js). Nothing here touches the DOM at load time.   */

const ARCGIS_MAX_LAYERS = 2000;   /* a hostile catalogue must not build a million rows */
const ARCGIS_MAX_DEPTH = 10;
const ARCGIS_MAX_ID = 2147483647;  /* layer ids are 32-bit signed integers on the server */
const ARCGIS_ATTRIBUTION_MAX = 200;
const ARCGIS_NAME_MAX = 300;
const ARCGIS_JSON_MAX = 5 * 1024 * 1024; /* the catalogue of a real service is ~10 KB */
const ARCGIS_REASON_MAX = 200;
const ARCGIS_MERCATOR_R = 6378137;
const ARCGIS_MAX_LAT = 85.05112878;       /* the same edge as WORLD_BOUNDS */
/* Spatial reference ids that mean Web Mercator (the old ESRI ones included) */
const ARCGIS_MERCATOR_WKIDS = new Set([3857, 102100, 900913, 102113]);
const ARCGIS_GEOGRAPHIC_WKIDS = new Set([4326, 4258]);
/* What may follow `/MapServer` in a pasted address and still be "the
   service": a layer number or one of its own operations. `query` is NOT
   here: someone pasting a /query?f=geojson address wants that file, which
   the normal download path handles.                                    */
const ARCGIS_SERVICE_TAILS = new Set(["export", "exportimage", "identify", "find", "legend", "layers"]);

/* Base address of a MapServer from whatever was pasted: the page of the
   service, its `?f=json`, a layer, an /export request… Query string and
   anchor are dropped on purpose: a `?token=` must never be stored or
   exported. Returns { base }, { error } (the address is a MapServer but
   cannot be used) or null (not a MapServer: the caller carries on with
   the normal download).                                                */
function arcgisServiceBase(text) {
  let u;
  try { u = new URL(String(text).trim()); } catch { return null; }
  const m = /^(\/.*?\/rest\/services\/.+?\/MapServer)(\/.*)?$/i.exec(u.pathname);
  if (!m) return null;
  const tail = (m[2] || "").split("/").filter(Boolean);
  if (tail.some(s => s.toLowerCase() === "query")) return null;
  if (tail.length > 1) return null;
  if (tail.length === 1 && !/^\d+$/.test(tail[0]) && !ARCGIS_SERVICE_TAILS.has(tail[0].toLowerCase())) return null;
  if (u.protocol !== "https:") return { error: "https" };
  if (u.username || u.password) return { error: "credentials" };
  return { base: u.origin + m[1] };
}

/* Name of the node: the last segment before /MapServer. `mapName` in the
   JSON is usually the generic "Layers".                                */
function arcgisServiceName(base) {
  const m = /\/([^/]+)\/MapServer$/i.exec(base);
  let name = m ? m[1] : "";
  try { name = decodeURIComponent(name); } catch { /* keep it as it came */ }
  return name || "MapServer";
}

/* `{ error: { code, message, details } }` is how ArcGIS reports a failure,
   usually with HTTP 200 — the same trap as an OGC exception in a 200.   */
function arcgisErrorText(err) {
  if (!err || typeof err !== "object") return tr("el servicio devolvió un error sin explicación");
  const code = Number(err.code);
  if (code === 498 || code === 499) return tr("el servicio exige una credencial (token), que KITE no admite");
  const parts = [];
  if (typeof err.message === "string" && err.message) parts.push(err.message);
  if (Array.isArray(err.details)) for (const d of err.details) if (typeof d === "string" && d) parts.push(d);
  let text = parts.join(": ") || tr("el servicio devolvió un error sin explicación");
  if (Number.isFinite(code)) text += " (" + code + ")";
  return text.length > ARCGIS_REASON_MAX ? text.slice(0, ARCGIS_REASON_MAX) + "…" : text;
}

/* Why a tile came back wrong, in one line; null when it is an image. Pure,
   fed with what `fetch` read. Like tileFailureReason but for ArcGIS.    */
function arcgisTileReason(status, contentType, body) {
  if (status >= 200 && status < 300 && /^image\//i.test(contentType)) return null;
  try {
    const j = JSON.parse(body);
    if (j && j.error) return arcgisErrorText(j.error);
  } catch { /* not JSON: HTTP status below */ }
  if (status < 200 || status >= 300) return describeHttp(status);
  return tr("respuesta {type} en vez de una imagen", { type: contentType.split(";")[0].trim() || tr("sin tipo") });
}

/* fullExtent → [south, west, north, east] in degrees, or null when the
   reference system is not one we can convert without a library.         */
function arcgisExtent4326(ext) {
  if (!ext || typeof ext !== "object") return null;
  const sr = ext.spatialReference || {};
  const wkid = Number(sr.latestWkid || sr.wkid);
  const x0 = Number(ext.xmin), y0 = Number(ext.ymin), x1 = Number(ext.xmax), y1 = Number(ext.ymax);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  let w, s, e, n;
  if (ARCGIS_MERCATOR_WKIDS.has(wkid)) {
    const lon = x => x / ARCGIS_MERCATOR_R * 180 / Math.PI;
    const lat = y => (2 * Math.atan(Math.exp(y / ARCGIS_MERCATOR_R)) - Math.PI / 2) * 180 / Math.PI;
    w = lon(x0); e = lon(x1); s = lat(y0); n = lat(y1);
  } else if (ARCGIS_GEOGRAPHIC_WKIDS.has(wkid)) {
    w = x0; e = x1; s = y0; n = y1;
  } else return null;
  const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));
  w = clamp(w, 180); e = clamp(e, 180); s = clamp(s, ARCGIS_MAX_LAT); n = clamp(n, ARCGIS_MAX_LAT);
  return s < n && w < e ? [s, w, n, e] : null;
}

/* The catalogue (`<service>?f=json`) → what the node needs. The layers
   keep the order the server publishes (it is the table of contents, and
   ids are NOT contiguous); `tables` are ignored. A layer is on at the
   start when it and every ancestor are `defaultVisibility`. Returns
   { error } or { layers, hasQuery, extent, tile, attribution, count, dataCount }. */
function parseArcgisCatalog(json) {
  if (!json || typeof json !== "object") return { error: tr("la respuesta no es la de un servicio de mapas ArcGIS") };
  if (json.error) return { error: arcgisErrorText(json.error) };
  if (!Array.isArray(json.layers)) return { error: tr("la respuesta no es la de un servicio de mapas ArcGIS") };
  if (typeof json.capabilities === "string" && !/\bMap\b/i.test(json.capabilities)) {
    return { error: tr("el servicio no dibuja mapas (solo admite: {caps})", { caps: json.capabilities.slice(0, 60) }) };
  }
  const hasQuery = typeof json.capabilities === "string" && /\bQuery\b/i.test(json.capabilities);
  const entries = new Map();
  for (const l of json.layers) {
    if (!l || typeof l !== "object" || !Number.isInteger(l.id) || l.id < 0 || l.id > ARCGIS_MAX_ID) continue;
    if (entries.has(l.id)) continue;
    entries.set(l.id, l);
  }
  if (!entries.size) return { error: tr("el servicio no publica ninguna capa") };
  if (entries.size > ARCGIS_MAX_LAYERS) {
    return { error: tr("el servicio publica demasiadas capas ({n}; el máximo es {max})", { n: entries.size, max: ARCGIS_MAX_LAYERS }) };
  }
  /* Parent of each layer, only when it exists and the chain up does not
     loop back (a cycle would otherwise hang the recursion below).      */
  const parentOf = new Map();
  for (const [id, l] of entries) {
    const p = l.parentLayerId;
    if (!Number.isInteger(p) || p === id || !entries.has(p)) continue;
    let up = p, hops = 0, loops = false;
    while (up !== undefined && hops++ <= entries.size) {
      if (up === id) { loops = true; break; }
      const next = entries.get(up).parentLayerId;
      up = Number.isInteger(next) && entries.has(next) ? next : undefined;
    }
    if (!loops && hops <= entries.size) parentOf.set(id, p);
  }
  const kids = new Map();
  for (const id of entries.keys()) {
    const p = parentOf.has(id) ? parentOf.get(id) : -1;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(id);
  }
  let dataCount = 0;
  const build = (id, depth, parentOn) => {
    const l = entries.get(id);
    const on = parentOn && l.defaultVisibility === true;
    const node = { id, name: String(l.name == null ? id : l.name).slice(0, ARCGIS_NAME_MAX), checked: on };
    const sub = depth < ARCGIS_MAX_DEPTH ? (kids.get(id) || []) : [];
    if (sub.length) {
      node.children = sub.map(k => build(k, depth + 1, on));
      node.checked = node.children.every(c => c.checked);
    } else if (hasQuery && l.type === "Feature Layer") {
      node.data = true;
      dataCount++;
    }
    return node;
  };
  const layers = (kids.get(-1) || []).map(id => build(id, 1, true));
  const w = Number(json.maxImageWidth), h = Number(json.maxImageHeight);
  const small = (Number.isFinite(w) && w > 0 && w < 512) || (Number.isFinite(h) && h > 0 && h < 512);
  const attribution = typeof json.copyrightText === "string" ? json.copyrightText.trim().slice(0, ARCGIS_ATTRIBUTION_MAX) : "";
  return { layers, hasQuery, extent: arcgisExtent4326(json.fullExtent), tile: small ? 256 : 512,
           attribution, count: entries.size, dataCount };
}

/* The tree record of a service just added (`base` from arcgisServiceBase) */
function arcgisCatalogRecord(cat, base) {
  const toRec = n => {
    const r = { t: "arcgisLayer", name: n.name, checked: n.checked, id: n.id };
    if (n.data) r.data = true;
    if (n.children) { r.children = n.children.map(toRec); r.collapsed = false; }
    return r;
  };
  return { t: "arcgis", name: arcgisServiceName(base), checked: true, collapsed: false, url: base,
           opacity: 1, tile: cat.tile, extent: cat.extent, attribution: cat.attribution,
           children: cat.layers.map(toRec) };
}

/* A saved or imported record is hostile input (principle 5): returns a
   clean copy or null. The address must be exactly what arcgisServiceBase
   would give for it (https, no credentials, no query: a stored token
   would travel in every .kite.json). A bad layer is dropped, a bad
   service is dropped whole, as buildCogRecord does.                   */
function sanitizeArcgisRecord(n) {
  if (!n || typeof n !== "object" || n.t !== "arcgis" || typeof n.url !== "string") return null;
  const parsed = arcgisServiceBase(n.url);
  if (!parsed || !parsed.base || parsed.base !== n.url) return null;
  const seen = new Set();
  let total = 0;
  const clean = (list, depth) => {
    const out = [];
    if (!Array.isArray(list) || depth > ARCGIS_MAX_DEPTH) return out;
    for (const c of list) {
      if (total >= ARCGIS_MAX_LAYERS) break;
      if (!c || typeof c !== "object" || c.t !== "arcgisLayer") continue;
      if (!Number.isInteger(c.id) || c.id < 0 || c.id > ARCGIS_MAX_ID || seen.has(c.id)) continue;
      seen.add(c.id);
      total++;
      const r = { t: "arcgisLayer", name: String(c.name == null ? c.id : c.name).slice(0, ARCGIS_NAME_MAX),
                  checked: !!c.checked, id: c.id };
      if (c.data === true) r.data = true;
      const sub = clean(c.children, depth + 1);
      if (sub.length) { r.children = sub; r.collapsed = !!c.collapsed; delete r.data; }
      out.push(r);
    }
    return out;
  };
  const children = clean(n.children, 1);
  if (!children.length) return null;
  const opacity = Number.isFinite(n.opacity) && n.opacity >= 0 && n.opacity <= 1 ? n.opacity : 1;
  const e = n.extent;
  const extent = Array.isArray(e) && e.length === 4 && e.every(Number.isFinite)
    && e[0] < e[2] && e[1] < e[3] && e[0] >= -90 && e[2] <= 90 && e[1] >= -180 && e[3] <= 180
    ? e.slice() : null;
  return { t: "arcgis", name: String(n.name == null ? arcgisServiceName(n.url) : n.name).slice(0, ARCGIS_NAME_MAX),
           checked: !!n.checked, collapsed: !!n.collapsed, url: n.url, opacity,
           tile: n.tile === 256 ? 256 : 512, extent,
           attribution: typeof n.attribution === "string" ? n.attribution.slice(0, ARCGIS_ATTRIBUTION_MAX) : "",
           children };
}

/* Ids for `layers=show:` — only the LEAVES that are on, in catalogue
   order. A group id is never sent: how `show:` treats groups differs
   between server versions, while the leaves are exact. Works on records
   (serialized rows or pending ones), so both ends feed it.            */
function arcgisShowIds(children) {
  const ids = [];
  const walk = list => {
    for (const c of list || []) {
      if (c.children && c.children.length) walk(c.children);
      else if (c.checked) ids.push(c.id);
    }
  };
  walk(children);
  return ids;
}

/* Box of tile (x, y) at zoom z in EPSG:3857 metres, for tiles of T CSS
   pixels. Leaflet's world is 256·2^z pixels wide at zoom z whatever the
   tile size, so a 512 px tile needs no zoomOffset: it just covers twice
   the ground of a 256 px one.                                           */
function tileBbox3857(x, y, z, T) {
  const half = Math.PI * ARCGIS_MERCATOR_R;
  const res = 2 * half / (256 * Math.pow(2, z));
  const xmin = -half + x * T * res, ymax = half - y * T * res;
  return [xmin, ymax - T * res, xmin + T * res, ymax];
}

/* `/export` of the visible layers. Fixed precision keeps the URL stable
   (the browser cache can answer a repeated tile).                      */
function arcgisExportUrl(base, bbox, px, dpi, ids) {
  const num = v => String(Number(v.toFixed(3)));
  return base + "/export?bbox=" + bbox.map(num).join(",") + "&bboxSR=3857&imageSR=3857&size=" + px + "," + px
    + "&dpi=" + dpi + "&format=png32&transparent=true&layers=show:" + ids.join(",") + "&f=image";
}

/* ---------- La capa de teselas ---------- */
const ARCGIS_REDRAW_MS = 300;
/* Una tesela vacía (GIF de 1×1 transparente) para cuando no hay ninguna
   capa activa: más barato que una petición al servidor.               */
const ARCGIS_BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

/* Los servicios que están en el mapa (para sincronizar sus `show:`) */
const arcgisLayersOnMap = new Set();

/* Ids de lo marcado AHORA. Con la fila construida se lee de ella (la
   casilla acaba de cambiar); sin fila (un servicio dentro de una carpeta
   nunca desplegada) de sus registros, que la cascada mantiene al día.  */
function arcgisLayerIds(layer) {
  const li = layer._li;
  const children = li && li.isConnected ? serializeNode(li)[0].children : layer._rec.children;
  return arcgisShowIds(children);
}

const ArcgisLayer = L.TileLayer.extend({
  initialize(rec) {
    /* HiDPI: más píxeles y más dpi en la misma tesela, para que los
       rótulos del servidor no salgan borrosos. Con tope de 2 (cuatro
       veces los píxeles) y sin pasar de lo que el servidor admite.    */
    this._scale = Math.max(1, Math.min(2, Math.round(window.devicePixelRatio || 1)));
    if (rec.tile * this._scale > 4096) this._scale = 1;
    this._base = rec.url;
    this._rec = rec;
    this._ids = [];
    this._errors = 0;
    this._extent = rec.extent ? L.latLngBounds([rec.extent[0], rec.extent[1]], [rec.extent[2], rec.extent[3]]) : null;
    /* Fuera de la caja del servicio no hay nada que pedir: ahorra
       peticiones y, sobre todo, las teselas que el mapa girado pide
       fuera del mundo (ver confineTilesToWorld). Un 10% de margen para
       que un rótulo que asoma por el borde no se corte.               */
    let bounds = WORLD_BOUNDS;
    if (rec.extent) {
      const dLat = (rec.extent[2] - rec.extent[0]) * 0.1, dLng = (rec.extent[3] - rec.extent[1]) * 0.1;
      bounds = L.latLngBounds(
        [Math.max(WORLD_BOUNDS.getSouth(), rec.extent[0] - dLat), Math.max(-180, rec.extent[1] - dLng)],
        [Math.min(WORLD_BOUNDS.getNorth(), rec.extent[2] + dLat), Math.min(180, rec.extent[3] + dLng)]);
    }
    /* El texto del servidor es entrada ajena y Leaflet pinta la atribución como HTML */
    L.TileLayer.prototype.initialize.call(this, "", {
      pane: COG_PANE, tileSize: rec.tile, opacity: rec.opacity, noWrap: true, keepBuffer: 1,
      updateWhenZooming: false, maxZoom: MAX_ZOOM, bounds, attribution: escapeHtml(rec.attribution || "")
    });
    this.on("tileerror", e => this._onTileError(e));
    this.on("tileload", () => this._onTileOk());
  },
  getTileUrl(coords) {
    if (!this._ids.length) return ARCGIS_BLANK;
    const T = this.options.tileSize;
    return arcgisExportUrl(this._base, tileBbox3857(coords.x, coords.y, coords.z, T),
      T * this._scale, 96 * this._scale, this._ids);
  },
  onAdd(m) {
    /* Los ids se fijan ANTES de que se pida ninguna tesela */
    this._ids = arcgisLayerIds(this);
    L.TileLayer.prototype.onAdd.call(this, m);
    arcgisLayersOnMap.add(this);
  },
  onRemove(m) {
    arcgisLayersOnMap.delete(this);
    clearTimeout(this._redrawTimer);
    L.TileLayer.prototype.onRemove.call(this, m);
  },
  /* Lo piden el encuadre de 🔍 y la caja de un rootGroup */
  getBounds() { return this._extent || L.latLngBounds([]); },
  /* Si lo marcado cambió, se redibuja — una sola vez aunque se pulsen
     varias casillas seguidas: cada redibujado son decenas de peticiones. */
  syncIds() {
    const ids = arcgisLayerIds(this);
    if (ids.join() === this._ids.join()) return;
    this._ids = ids;
    clearTimeout(this._redrawTimer);
    this._redrawTimer = setTimeout(() => { if (this._map) this.redraw(); }, ARCGIS_REDRAW_MS);
  },
  _name() { return this._li ? this._li._name : this._rec.name; },
  _markFailed(on) {
    this._failed = on;
    if (this._li && this._li._row) this._li._row.classList.toggle("service-failed", on);
  },
  /* Un servicio que no entrega teselas debe verse, no fallar en
     silencio: contorno rojo en la tesela, el motivo del servidor la
     primera vez, y la fila en rojo tras BASE_FAIL_TILES seguidas.     */
  _onTileError(e) {
    e.tile.classList.add("tile-error");
    if (!this._noticed) {
      this._noticed = true;
      diagnoseTile(this._name(), e.tile.src, arcgisTileReason);
    }
    if (++this._errors >= BASE_FAIL_TILES && !this._failed) {
      this._markFailed(true);
      navMessage(tr("El servicio «{name}» no responde; puede que haya cambiado.", { name: this._name() }));
    }
  },
  _onTileOk() {
    this._errors = 0;
    if (this._failed) this._markFailed(false);
  }
});

/* Leaflet no reintenta solo al volver la red: se redibujan los caídos */
window.addEventListener("online", () => {
  for (const layer of arcgisLayersOnMap) if (layer._failed && layer._map) layer.redraw();
});

/* scheduleSave() lo llama en cada mutación del árbol (como scheduleReorder):
   marcar o desmarcar una capa cambia el `show:` del servicio. Con ningún
   servicio en el mapa no cuesta nada.                                  */
let arcgisSyncFrame = 0;
function scheduleArcgisSync() {
  if (!arcgisLayersOnMap.size || arcgisSyncFrame) return;
  arcgisSyncFrame = requestAnimationFrame(() => {
    arcgisSyncFrame = 0;
    for (const layer of arcgisLayersOnMap) layer.syncIds();
  });
}

/* ---------- Registros y filas ---------- */

/* Registro de un nodo "arcgis" desde lo guardado, o null si no vale.
   `opts.foreign` (un archivo o una pestaña ajenos): el servicio y todas
   sus capas llegan APAGADOS. Abrir el archivo de otro no debe contactar
   un servidor que eligió él —cada tesela lleva la IP del usuario— hasta
   que el usuario lo encienda.                                         */
function buildArcgisRecord(n, opts = {}) {
  const rec = sanitizeArcgisRecord(n);
  if (!rec) return null;
  if (opts.foreign) {
    const off = list => { for (const c of list) { c.checked = false; if (c.children) off(c.children); } };
    rec.checked = false;
    off(rec.children);
    opts.foreign.hosts.add(new URL(rec.url).host);
  }
  const layer = new ArcgisLayer(rec);
  rec._layer = layer;
  if (rec.checked) layer.addTo(rootGroup);
  return rec;
}

function arcgisForeignNotice(foreign) {
  if (!foreign || !foreign.hosts.size) return;
  navMessage(tr("Los servicios de mapas llegan apagados: enciéndalos para consultar {hosts}.",
    { hosts: [...foreign.hosts].join(", ") }), { tone: "info" });
}

/* Fila de un servicio o de una de sus capas (lo llama materializeRecords) */
async function materializeArcgisRecord(rec, parentUl) {
  const isService = rec.t === "arcgis";
  const isGroup = !!rec.children;
  const li = isService
    ? makeNode({ name: rec.name, layer: rec._layer, isFolder: true, sortable: false,
                 styleable: true, focusable: true, checked: !!rec.checked })
    : makeNode({ name: rec.name, isFolder: isGroup, sortable: false, styleable: false,
                 focusable: false, fixed: true, checked: !!rec.checked });
  rec._li = li;
  /* Antes de nada más: styleKind guarda su resultado en la primera consulta */
  if (isService) {
    li._arcgis = { url: rec.url, extent: rec.extent, attribution: rec.attribution,
                   opacity: rec.opacity, tile: rec.tile };
    li.classList.add("arcgis-service");
  } else {
    li._arcgisLayer = { id: rec.id, data: !!rec.data };
  }
  if (isGroup) {
    if (rec.collapsed) li.classList.add("collapsed");
    syncExpanded(li);
  }
  parentUl.appendChild(li);
  if (!isGroup) return;
  if (rec.collapsed) {
    li._pending = rec.children;
    applyContainerState(li);
  } else {
    await materializeRecords(rec.children, nodeUl(li));
  }
}

/* El servicio recién leído del diálogo 🔗 pasa a ser un nodo del árbol,
   en la sección «Servicios de mapas». No toca la vista: para llegar
   está 🔍.                                                            */
async function addArcgisServiceNode(cat, base) {
  const rec = buildArcgisRecord(arcgisCatalogRecord(cat, base));
  if (!rec) throw new Error(tr("el servicio no tiene ninguna capa que se pueda mostrar"));
  pushUndo(tr("añadir servicio ArcGIS"));
  const ul = ensureNamedSection(tr("Servicios de mapas"));
  const section = ul.parentElement;
  await ensureMaterialized(section);
  section.classList.remove("collapsed");
  syncExpanded(section);
  await materializeRecords([rec], ul);
  refreshAncestorChecks(rec._li);
  scheduleSave();
  const shown = arcgisShowIds(rec.children).length;
  navMessage(tr("Servicio «{name}» añadido: {n} capa(s), {shown} visible(s). Marque las que quiera ver.",
    { name: rec.name, n: cat.count, shown }), { tone: "info" });
  return rec._li;
}
