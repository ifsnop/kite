/* ---------- Validación de GeoJSON ----------
   L.geoJSON is forgiving and will happily build layers from malformed
   geometries; the damage shows up later as layers in absurd places or as
   exceptions deep in Leaflet. Everything is therefore checked up front:
   known type, coordinates present, numeric, finite and in range.      */
const GEOJSON_TYPES = new Set(["Point", "MultiPoint", "LineString", "MultiLineString",
  "Polygon", "MultiPolygon", "GeometryCollection"]);

function validGeometry(geom, depth = 0) {
  if (!geom || typeof geom !== "object" || depth > 4) return false;
  if (!GEOJSON_TYPES.has(geom.type)) return false;
  if (geom.type === "GeometryCollection") {
    return Array.isArray(geom.geometries) && geom.geometries.length > 0 &&
           geom.geometries.every(g => validGeometry(g, depth + 1));
  }
  const c = geom.coordinates;
  if (!Array.isArray(c) || !c.length) return false;
  /* A position is [lon, lat, alt?]; anything deeper is a list of them */
  /* Además de comprobar, AJUSTA la posición sobre el propio objeto: así
     lo que se guarda y se dibuja ya está dentro de rango y no hace
     falta recorrer la geometría por segunda vez.                    */
  const checkPos = pos => {
    if (!Array.isArray(pos) || pos.length < 2) return false;
    const pair = clampLatLng(Number(pos[1]), Number(pos[0]));
    if (!pair) return false;
    pos[0] = pair[1];
    pos[1] = pair[0];
    return true;
  };
  const walk = (node, level) => level === 0
    ? checkPos(node)
    : Array.isArray(node) && node.length > 0 && node.every(n => walk(n, level - 1));
  const depths = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2,
                   Polygon: 2, MultiPolygon: 3 };
  if (!walk(c, depths[geom.type])) return false;
  /* A ring needs at least four positions (closed triangle) */
  if (geom.type === "Polygon") return c.every(r => r.length >= 4);
  if (geom.type === "MultiPolygon") return c.every(p => p.every(r => r.length >= 4));
  if (geom.type === "LineString") return c.length >= 2;
  if (geom.type === "MultiLineString") return c.every(l => l.length >= 2);
  return true;
}

/* Convierte una topología TopoJSON a un FeatureCollection GeoJSON normal
   (une los objetos con nombre en una sola lista de features), para que a
   partir de aquí siga el proceso habitual de importar un JSON.        */
function topologyToGeoJson(topology) {
  if (typeof topojson === "undefined") throw new Error("no se pudo cargar el soporte de TopoJSON");
  const features = [];
  for (const name of Object.keys(topology.objects || {})) {
    const fc = topojson.feature(topology, topology.objects[name]);
    features.push(...(fc.type === "FeatureCollection" ? fc.features : [fc]));
  }
  return { type: "FeatureCollection", features };
}

/* Extrae el array de Features de cualquier forma de entrada aceptada
   (FeatureCollection, Feature suelto o geometría suelta); factoriza la
   detección de tipo que antes vivía inline al principio de
   buildGeoJsonRecords, y la reutiliza addFileNode para mirar el primer
   Feature antes de construir nada (elegir la propiedad-nombre).      */
function geojsonFeatures(gj) {
  if (!gj || typeof gj !== "object") throw new Error("no parece un GeoJSON");
  if (gj.type === "FeatureCollection") return Array.isArray(gj.features) ? gj.features : [];
  if (gj.type === "Feature") return [gj];
  if (GEOJSON_TYPES.has(gj.type)) return [{ type: "Feature", geometry: gj, properties: {} }];
  throw new Error("no parece un GeoJSON");
}

/* Un archivo es ambiguo cuando trae properties pero ninguna clave con la
   que ya sabemos nombrar (name/title): solo entonces hace falta
   preguntar qué propiedad usar.                                     */
function needsNamePicker(props) {
  return !!(props && typeof props === "object" && Object.keys(props).length
    && !props.name && !props.title);
}

/* Huella de la FORMA de properties (su conjunto de claves, no sus
   valores ni su orden original): sirve para indexar la asociación
   guardada, y como es el JSON de las propias claves, se puede
   recuperar la lista de claves de una huella con JSON.parse.        */
function propsFingerprint(props) {
  return JSON.stringify(Object.keys(props || {}).sort());
}

/* nameProp es la clave elegida por el usuario (o recordada); si esa
   capa concreta no la tiene, se cae en la cadena de siempre.        */
function resolveFeatureName(props, index, nameProp) {
  return String((nameProp && props[nameProp]) || props.name || props.title || `Elemento ${index + 1}`);
}

async function buildGeoJsonRecords(gj, prog, report, nameProp = null) {
  const features = geojsonFeatures(gj);
  const out = [];

  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    const props = (feature && typeof feature.properties === "object" && feature.properties) || {};
    const name = resolveFeatureName(props, i, nameProp);
    try {
      if (!feature || !validGeometry(feature.geometry)) {
        if (report) {
          report.warn(feature && feature.geometry
            ? `geometr\u00EDa no v\u00E1lida o fuera de rango (${feature.geometry.type || "sin tipo"})`
            : "elemento sin geometr\u00EDa");
        }
        continue;
      }
      const style = geojsonStyle(props);
      const layer = L.geoJSON(feature, { style });
      clearFillOnOpenPaths(layer); /* una línea no se rellena, ver esa función */
      layer.bindPopup(escapeHtml(name), COMPACT_POPUP);
      layer.addTo(rootGroup); /* GeoJSON no define visibilidad: todo activo */
      const rec = { t: "layer", name, checked: true, style, _layer: layer };
      wirePendingLayerEvents(rec);
      out.push(rec);
      if (report) { report.loaded++; report.kinds.add(feature.geometry.type); }
    } catch (err) {
      if (report) report.warn(`\u00AB${name}\u00BB: ${err.message}`);
    }
    if (prog && ++prog.done % PROGRESS_BATCH === 0) {
      prog.update(prog.done);
      await yieldFrame();
    }
  }
  return out;
}

/* ================= Persistencia: árbol completo en IndexedDB =================
   Se guarda el árbol de navegación tal cual está: carpetas creadas, orden,
   renombrados, capas movidas, estados de visibilidad y colapso y mediciones.
   La geometría de cada capa se serializa a GeoJSON, de modo que el archivo
   original deja de ser necesario tras la importación. Cualquier cambio en el
   panel reprograma un guardado (con un pequeño debounce).                    */

const DB_NAME = "visor-kml";
const DB_VERSION = 3;  /* esquema de la base: un único almacén "tree".
                          Subir solo cuando cambie la estructura de almacenes;
                          la migración es simplemente borrar lo anterior.     */
const TREE_SCHEMA = 6; /* formato del árbol serializado. Subir solo cuando
                          cambie el formato; un árbol guardado con otra
                          versión se descarta al leer.
                          v2: los nodos de capa admiten `mstyle` (estilo de
                          marcador: icono MDI, colores, tamaños y texto).
                          v3: nuevo tipo de nodo "elevGrid" (celdas de
                          elevación acumuladas en una sesión de modo altura).
                          v4: nuevo tipo de nodo "imageOverlay" (ortofotos
                          georeferenciadas de KMZ, con cambio de nivel de
                          detalle por zoom).
                          v5: imageOverlay ya no guarda minLod/maxLod (se
                          retira el cambio de nivel de detalle por zoom;
                          las ortofotos se cargan y muestran todas).
                          v6: los nodos "measure" guardan su `style`
                          (color, grosor y relleno del círculo), ahora
                          editable desde el diálogo de propiedades. */
const DB_TREE = "tree";

/* One connection, reused. Opening the database on every save wastes
   handles and, worse, a stale connection blocks the upgrade of another
   tab: `onversionchange` closes ours so the other tab can proceed, and
   the cached promise is dropped so the next call reopens.            */
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, DB_VERSION);
    rq.onupgradeneeded = () => {
      /* Sin compatibilidad hacia atrás: se vacía cualquier esquema previo */
      const db = rq.result;
      for (const s of [...db.objectStoreNames]) db.deleteObjectStore(s);
      db.createObjectStore(DB_TREE);
    };
    rq.onsuccess = () => {
      const db = rq.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; }; /* cierre inesperado */
      resolve(db);
    };
    rq.onerror = () => { dbPromise = null; reject(rq.error); };
    rq.onblocked = () => navMessage("Otra pesta\u00F1a est\u00E1 usando el almacenamiento; ci\u00E9rrela para continuar.");
  }).catch(err => { dbPromise = null; throw err; });
  return dbPromise;
}
async function dbSaveTree(nodes) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: TREE_SCHEMA, nodes }, "root");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
/* ================= Ficha del elemento =================
   La <description> de un KML es HTML de un archivo AJENO: insertarlo tal
   cual sería ejecutar código de terceros en la página. Se sanea con
   lista blanca: se descartan los elementos peligrosos, todos los
   atributos `on*` y cualquier URL que no sea http(s).                */
const DESC_TAGS = new Set(["B","I","U","EM","STRONG","SMALL","BR","P","DIV","SPAN","HR",
  "UL","OL","LI","TABLE","THEAD","TBODY","TFOOT","TR","TD","TH","CAPTION",
  "H1","H2","H3","H4","H5","H6","A","IMG","PRE","CODE","FONT","CENTER"]);
const DESC_ATTRS = new Set(["href", "src", "alt", "title", "colspan", "rowspan"]);
/* Estos se tiran ENTEROS. Al resto de elementos no permitidos se les
   quita la etiqueta pero se conserva su texto, que suele ser el dato;
   con un <script> eso dejaba su código a la vista como texto suelto. */
const DESC_DROP = new Set(["SCRIPT","STYLE","IFRAME","OBJECT","EMBED","NOSCRIPT",
  "TEMPLATE","LINK","META","TITLE","HEAD","FORM","INPUT","BUTTON","SELECT","TEXTAREA"]);

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  const walk = node => {
    for (const el of [...node.children]) {
      if (DESC_DROP.has(el.tagName)) { el.remove(); continue; }
      if (!DESC_TAGS.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
      for (const att of [...el.attributes]) {
        const name = att.name.toLowerCase();
        const bad = !DESC_ATTRS.has(name)
          || (/^(href|src)$/.test(name) && !/^https?:/i.test(att.value.trim()));
        if (bad) el.removeAttribute(att.name);
      }
      if (el.tagName === "A") { el.target = "_blank"; el.rel = "noopener noreferrer"; }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/* El usuario cerró el panel explícitamente (Cerrar o Escape): el hover
   no debe reabrirlo hasta la próxima apertura explícita (botón ℹ o
   «Mostrar propiedades» del menú contextual), o el cierre nunca "se
   queda cerrado" mientras el ratón siga pasando por capas.           */
let layerInfoDismissed = false;

/* Deferred close on mouseout: if no mouseover on some layer cancels it
   within LAYER_INFO_HIDE_DELAY, the hover-opened panel closes. Without
   this there was no path at all for "the mouse is no longer over
   anything" — only explicit closes existed (Cerrar, Escape, opening the
   style dialog, entering polygon mode), so the panel could stay open
   indefinitely once the mouse left every layer. The short delay avoids
   a flicker when crossing the gap between two neighbouring layers:
   moving between layers must only update the content, never close the
   panel in between (see showLayerInfo below). Skipped while the panel
   holds keyboard focus (an explicit open via the ℹ button or the
   context menu): that close stays the user's call, same as today.    */
const LAYER_INFO_HIDE_DELAY = 200; /* ms */
let layerInfoHideTimer = null;
function cancelLayerInfoHide() {
  if (layerInfoHideTimer) { clearTimeout(layerInfoHideTimer); layerInfoHideTimer = null; }
}
function scheduleLayerInfoHide() {
  if (descDialog.hidden || descBox.contains(document.activeElement)) return;
  cancelLayerInfoHide();
  layerInfoHideTimer = setTimeout(() => { descDialog.hidden = true; layerInfoHideTimer = null; }, LAYER_INFO_HIDE_DELAY);
}

/* One-shot guard set when LEAVING a drawing tool (see setTool): the
   double click / mouseup that finishes a polygon or a line/circle
   measurement lands exactly where the cursor is, usually on top of
   some layer, and the mousemove right after fires a genuine mouseover
   there. Consumed by the very next hover, real or not, and also
   expires on its own after TOOL_EXIT_HOVER_GUARD_MS in case no hover
   follows soon — unlike layerInfoDismissed (which stays closed until
   an EXPLICIT reopen), this must not silently turn hover off for the
   rest of the session just because the user drew something once.     */
const TOOL_EXIT_HOVER_GUARD_MS = 300; /* ms */
let suppressNextHover = false;

/* Layer info panel: a KML placemark's description or a GeoJSON
   feature's properties, opened by the row's ℹ button, by hovering the
   layer in the viewer (focus:false, so it never steals the user's
   focus on every hover), or from the context menu. Non-modal
   (.dlg-float): the map stays interactive underneath, and with the
   dialog already open, moving to another layer only updates its
   content, without repositioning or closing the box.                 */
function showLayerInfo(li, { focus = true } = {}) {
  cancelLayerInfoHide(); /* a real hover cancels any pending deferred close */
  if (!focus && suppressNextHover) { suppressNextHover = false; return; } /* residual hover right after leaving a drawing tool */
  /* While the edit dialog (style/name) is open, hovering must not reopen
     this panel on top of or under it: that would recreate the same
     overlap openStyleDialog already avoids on opening. Same while
     drawing a polygon: the floating panel could sit exactly where the
     user needs to click to fix a vertex inside another polygon, and
     the hover would block it.                                        */
  if (!focus && (layerInfoDismissed || !styleDialog.hidden || activeTool === "polygon")) return;
  if (focus) layerInfoDismissed = false; /* explicit open: re-arms the hover */
  const html = infoHtmlFor(li);
  if (html == null) return;
  descTitle.textContent = li._name;
  descBody.innerHTML = html;
  const wasHidden = descDialog.hidden;
  descDialog.hidden = false;
  if (wasHidden) {
    clampToViewport(descBox);
    if (focus) focusDialog(descBox);
  }
}

/* ================= Deshacer =================
   Instantáneas del árbol completo. Es viable porque serializar cuesta
   poco desde que la geometría se cachea (~5 ms con 8.000 capas) y porque
   las instantáneas COMPARTEN esa geometría en vez de clonarla: lo que
   ocupa es la estructura, no las coordenadas.                        */
const UNDO_MAX = 20;
const undoStack = [];
const redoStack = [];

function pushUndo(label) {
  undoStack.push({ label, nodes: serializeTree() });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  /* Una acción nueva invalida lo rehacible: la historia se bifurca */
  redoStack.length = 0;
}

/* Reconstruye el árbol desde una instantánea */
async function applySnapshot(nodes) {
  clearSelection();
  rootGroup.clearLayers();
  showEmptyMessage();
  if (nodes.length) await restoreTree(nodes);
  scheduleSave();
}
function withUndo(label, fn) {
  pushUndo(label);
  return fn();
}

async function undoLast() {
  const state = undoStack.pop();
  if (!state) { navMessage("No hay nada que deshacer."); return; }
  /* Antes de retroceder se guarda el presente, que es lo que habrá que
     recuperar al rehacer                                             */
  redoStack.push({ label: state.label, nodes: serializeTree() });
  await applySnapshot(state.nodes);
  navMessage(`Deshecho: ${state.label}.`, { tone: "info" });
}

async function redoLast() {
  const state = redoStack.pop();
  if (!state) { navMessage("No hay nada que rehacer."); return; }
  undoStack.push({ label: state.label, nodes: serializeTree() });
  await applySnapshot(state.nodes);
  navMessage(`Rehecho: ${state.label}.`, { tone: "info" });
}

/* ---------- Vista guardada (centro y zoom) ----------
   Comparte almacén con el árbol: es otra clave, no otro almacén, así que
   no hace falta subir DB_VERSION. Lleva su propia versión de formato
   porque su contenido no tiene nada que ver con el del árbol.        */
const VIEW_KEY = "view";
const VIEW_SCHEMA = 1;
const BASE_KEY = "bases";
const BASE_SCHEMA = 1;

async function dbSaveBases(rec) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: BASE_SCHEMA, ...rec }, BASE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadBases() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(BASE_KEY);
    rq.onsuccess = () => {
      const rec = rq.result;
      resolve(rec && rec.v === BASE_SCHEMA && rec.bases ? rec : null);
    };
    rq.onerror = () => reject(rq.error);
  });
}

/* ---------- Credencial de Sentinel Hub ----------
   Otra clave del mismo almacén. Es del usuario y solo vive en su
   navegador: nunca se serializa con el árbol ni viaja en un .kite.json
   exportado, que se comparte.                                         */
const SH_KEY = "shCreds";
const SH_SCHEMA = 1;

async function dbSaveSh(rec) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: SH_SCHEMA, ...rec }, SH_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
/* Borrar la credencial RETIRA la clave, no guarda un registro vacío:
   una credencial retirada no debe dejar rastro en el almacén.        */
async function dbDeleteSh() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).delete(SH_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadSh() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(SH_KEY);
    rq.onsuccess = () => {
      const rec = rq.result;
      resolve(rec && rec.v === SH_SCHEMA && typeof rec.instanceId === "string" ? rec : null);
    };
    rq.onerror = () => reject(rq.error);
  });
}

/* ---------- Nombres de GeoJSON recordados por forma de properties ----------
   Otra clave del mismo almacén: huella (JSON de las claves de properties,
   ordenadas) → nombre de la propiedad elegida por el usuario para esa
   forma. Así un archivo futuro con la misma forma de properties (esta
   sesión u otra) no vuelve a preguntar.                              */
const GNP_KEY = "geojsonNameProps";
const GNP_SCHEMA = 1;

async function dbSaveGnp(map) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: GNP_SCHEMA, map }, GNP_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadGnp() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(GNP_KEY);
    rq.onsuccess = () => {
      const rec = rq.result;
      resolve(rec && rec.v === GNP_SCHEMA && rec.map && typeof rec.map === "object" ? rec.map : {});
    };
    rq.onerror = () => reject(rq.error);
  });
}

async function dbSaveView(rec) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: VIEW_SCHEMA, ...rec }, VIEW_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function dbLoadView() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(VIEW_KEY);
    rq.onsuccess = () => resolve(validView(rq.result));
    rq.onerror = () => reject(rq.error);
  });
}

/* Lo guardado puede venir de otra versión, de otra pantalla o
   directamente corrupto: se comprueba antes de mover la vista, porque un
   valor absurdo dejaría el mapa en un sitio del que no se sale.      */
function validView(rec) {
  if (!rec || rec.v !== VIEW_SCHEMA) return null;
  const { lat, lng, zoom } = rec;
  /* `Number.isFinite` no convierte: un "12" guardado por error se
     rechaza en vez de colarse como número                          */
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) return null;
  if (Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  if (zoom < 0 || zoom > 25) return null;
  return { lat, lng, zoom };
}

async function dbLoadTree() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    const st = tx.objectStore(DB_TREE);
    const rq = st.get("root");
    rq.onsuccess = () => {
      const rec = rq.result;
      if (rec && rec.v === TREE_SCHEMA) { resolve(rec.nodes); return; }
      /* Versión distinta: se descarta el árbol, pero solo el árbol; la
         vista guardada es independiente y sigue siendo válida. El
         usuario pierde lo que tuviera cargado, así que el aviso es
         sticky (exige "Aceptar"), igual que un resumen de importación
         con elementos omitidos.                                     */
      if (rec) {
        st.delete("root");
        navMessage("El árbol guardado en este navegador es de una versión "
          + "anterior, incompatible con esta, y se ha eliminado.",
          { sticky: true });
      }
      resolve(null);
    };
    rq.onerror = () => reject(rq.error);
  });
}

/* ---------- Serialización del árbol de navegación ----------
   Serializing one node is its own function because the same records feed
   two consumers: the automatic save of the whole tree and the export of a
   single folder to a file.                                             */
function serializeNode(li) {
  if (li._name === undefined) return []; /* mensajes tipo "Sin geometrías" */
  const chk = li.querySelector(":scope > .node-row > input[type=checkbox]");
  const base = { name: li._name, checked: chk ? chk.checked : true };
  if (li._measure) {
    const a = li._measure.mOrigin.getLatLng(), b = li._measure.mDest.getLatLng();
    return [{ ...base, t: "measure", mtype: li._measure.type, style: li._style,
              a: { lat: a.lat, lng: a.lng }, b: { lat: b.lat, lng: b.lng } }];
  }
  if (li._elevGrid) {
    return [{ ...base, t: "elevGrid", cells: li._elevGrid.cells }];
  }
  if (li._imageOverlay) {
    const o = li._imageOverlay;
    return [{ ...base, t: "imageOverlay", box: o.box, dataUrl: o.dataUrl, opacity: o.opacity }];
  }
  /* li._isContainer evita este querySelector en toda capa hoja (la
     inmensa mayoría de los nodos de un árbol grande): solo carpetas y
     archivos pueden tener un <ul class="node-list"> de verdad.       */
  const ul = li._isContainer ? nodeUl(li) : null;
  if (ul) {
    /* Una carpeta nunca desplegada no tiene hijos reales que recorrer
       (ul está vacío a propósito, ver materializeRecords/li._pending):
       se serializa directamente desde los registros, sin construir ni
       una sola fila — coste casi nulo para lo que nadie ha llegado a
       abrir.                                                          */
    const children = li._pending ? serializePendingRecords(li._pending) : serializeNodes(ul);
    return [{ ...base, t: li.classList.contains("file") ? "file" : "folder",
              collapsed: li.classList.contains("collapsed"), children }];
  }
  /* `toGeoJSON()` clona TODAS las coordenadas de la capa. Hacerlo en cada
     guardado (y se guarda tras cualquier cambio del panel) suponía
     rehacer el archivo entero por renombrar un nodo. La geometría solo
     cambia al mover un marcador, así que se calcula una vez y se
     invalida ahí: ver `invalidateGeo`.                                */
  if (!li._geo) li._geo = chk._layer.toGeoJSON();
  const rec = { ...base, t: "layer", style: li._style, geo: li._geo };
  if (li._mstyle) rec.mstyle = li._mstyle; /* marker style, if customized */
  if (li._desc) rec.desc = li._desc;       /* ficha original del archivo   */
  return [rec];
}
const serializeNodes = ul => [...ul.children].flatMap(serializeNode);

/* Gemela de serializeNode/serializeNodes, pero sobre registros pendientes
   (li._pending) en vez de filas del DOM: misma forma de salida exacta,
   así que un árbol restaurado nunca se distingue de uno recién
   importado por cómo quedó serializado (test diferencial en
   tests/lazytree.js). geo se calcula perezosamente y se cachea EN EL
   REGISTRO (rec.geo ||= …), la misma disciplina que li._geo, para que
   una carpeta nunca desplegada solo pague ese coste una vez, la
   primera vez que de verdad hace falta guardarla.                     */
function serializePendingRecords(records) {
  return records.map(rec => {
    if (rec.t === "folder" || rec.t === "file") {
      return { name: rec.name, checked: rec.checked, t: rec.t,
                collapsed: rec.collapsed, children: serializePendingRecords(rec.children) };
    }
    if (rec.t === "layer") {
      if (!rec.geo) rec.geo = rec._layer.toGeoJSON();
      const out = { name: rec.name, checked: rec.checked, t: "layer", style: rec.style, geo: rec.geo };
      if (rec.mstyle) out.mstyle = rec.mstyle;
      if (rec.desc) out.desc = rec.desc;
      return out;
    }
    if (rec.t === "measure") {
      /* Posición siempre en vivo: los manejadores son arrastrables con
         Ctrl+arrastre sobre el mapa aunque la fila siga pendiente (ver
         buildMeasureRecord), así que cachear a/b se quedaría obsoleto. */
      const a = rec._m.mOrigin.getLatLng(), b = rec._m.mDest.getLatLng();
      return { name: rec.name, checked: rec.checked, t: "measure", mtype: rec.mtype,
                style: rec.style, a: { lat: a.lat, lng: a.lng }, b: { lat: b.lat, lng: b.lng } };
    }
    if (rec.t === "elevGrid") {
      return { name: rec.name, checked: rec.checked, t: "elevGrid", cells: rec.cells };
    }
    /* rec.t === "imageOverlay" */
    return { name: rec.name, checked: rec.checked, t: "imageOverlay",
              box: rec.box, dataUrl: rec.dataUrl, opacity: rec.opacity };
  });
}
function serializeTree() {
  if (!rootUl || !rootUl.isConnected) return [];
  return serializeNodes(rootUl);
}

/* ---------- Exportar e importar carpetas ----------
   The exported file is the very same record format the tree is saved
   with, wrapped in a small envelope that states which versions produced
   it. Importing therefore costs nothing beyond `buildRecordsFromStorage`
   + `materializeRecords`, and a
   file written by another format version can be rejected outright
   instead of migrated (see the no-backwards-compatibility principle).  */
const EXPORT_KIND = "kite-local/tree";
const EXPORT_EXT = ".kite.json";
/* Versión del FORMATO DE ARCHIVO, independiente de TREE_SCHEMA (que
   versiona los registros) y de DB_VERSION (que versiona los almacenes).
   Se sube cuando cambia el envoltorio; al importar, un archivo con una
   versión distinta se rechaza en vez de intentar adivinar su contenido. */
const EXPORT_FORMAT = 1;

const safeFileName = name =>
  String(name).replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80) || "carpeta";

function exportNode(li) {
  const nodes = serializeNode(li);
  if (!nodes.length) { navMessage("No hay nada que descargar en este nodo."); return; }
  const doc = {
    app: EXPORT_KIND,
    format: EXPORT_FORMAT,
    db: DB_VERSION,
    schema: TREE_SCHEMA,
    generator: `KITE Local ${BUILD}`,
    exported: new Date().toISOString(),
    nodes
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(doc)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFileName(li._name) + EXPORT_EXT;
  a.click();
  /* Algunos navegadores leen el blob después de volver de click():
     revocarlo en el acto cancela la descarga. Se libera más tarde.  */
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  navMessage(`Descargado \u00AB${a.download}\u00BB.`, { tone: "info" }); /* confirma lo pedido: notificación, no alerta */
}

/* Recognizes an exported tree among the dropped .json files; anything
   else falls through to the GeoJSON reader                            */
function parseTreeExport(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return null; }
  return doc && doc.app === EXPORT_KIND && Array.isArray(doc.nodes) ? doc : null;
}

const countRecords = nodes => nodes.reduce((n, r) =>
  n + (r.children ? countRecords(r.children) : 1), 0);

/* Imported folders are always added: nothing is replaced or merged, so
   it is the user who decides which copy to keep                       */
async function importTreeExport(doc, fileName, insertBefore, dropTargetUl = null) {
  /* Dos comprobaciones distintas: el envoltorio y los registros */
  const format = doc.format === undefined ? 0 : doc.format;
  if (format !== EXPORT_FORMAT) {
    throw new Error(`archivo de formato v${format}, incompatible con el actual v${EXPORT_FORMAT}`);
  }
  if (doc.schema !== TREE_SCHEMA) {
    throw new Error(`formato de \u00E1rbol v${doc.schema}, incompatible con el actual v${TREE_SCHEMA}`);
  }
  if (!doc.nodes.length) throw new Error("el archivo no contiene ning\u00FAn nodo");
  const ul = dropTargetUl || ensureRootUl();
  const before = new Set(ul.children);
  const total = countRecords(doc.nodes);
  const prog = total > PROGRESS_BATCH ? {
    done: 0,
    update: d => progress.set(100 * d / total, `Construyendo ${fileName}\u2026 (${d}/${total})`)
  } : null;
  try {
    const records = await buildRecordsFromStorage(doc.nodes, prog);
    await materializeRecords(records, ul);
  } finally {
    if (prog) progress.hide();
  }
  /* Honour the drop position: move whatever was just appended */
  if (insertBefore && insertBefore.parentElement === ul) {
    for (const li of [...ul.children]) {
      if (!before.has(li)) ul.insertBefore(li, insertBefore);
    }
  }
}

let saveTimer = null;
let saveChain = Promise.resolve(); /* cola: los guardados nunca se solapan */
let savePending = false;
let saveCost = 0; /* lo que tardó el último guardado, en ms */

const SAVE_MIN_MS = 400, SAVE_MAX_MS = 3000;

/* El retardo se ajusta solo: en un árbol pequeño guarda casi al instante,
   y en uno de miles de nodos espera más para no repetir un trabajo caro
   mientras el usuario sigue navegando o escribiendo.                   */
function scheduleSave() {
  scheduleReorder(); /* toda mutación del árbol también puede haber cambiado el orden de pintado */
  clearTimeout(saveTimer);
  const wait = Math.min(SAVE_MAX_MS, Math.max(SAVE_MIN_MS, saveCost * 4));
  saveTimer = setTimeout(saveTree, wait);
}

/* Serializing the writes matters because IndexedDB transactions can
   complete out of order: two overlapping saves could leave the older
   snapshot on disk. The tree is serialized when its turn comes, so the
   state written is always the most recent one.                       */
/* navigator.storage.estimate() reports the whole origin's usage; this app
   only writes to IndexedDB, so in practice it reflects what is saved
   here. Refreshed after each save instead of on a timer: saves already
   carry their own debounce, so this rides along for free.             */
async function refreshStorageUsage() {
  const el = document.getElementById("storage-usage");
  if (!el) return;
  if (!navigator.storage || !navigator.storage.estimate) {
    el.textContent = "Almacenamiento usado: no disponible en este navegador.";
    return;
  }
  try {
    const { usage } = await navigator.storage.estimate();
    el.textContent = `Almacenamiento usado: ${fmtBytes(usage || 0)}`;
  } catch {
    el.textContent = "Almacenamiento usado: no disponible.";
  }
}

/* Memoria de la pestaña, al lado de lo que ocupa en disco: son las dos
   cotas con las que se topa un árbol grande, y hasta ahora solo se veía
   una.

   `performance.memory` es una extensión de Chromium: no está en ninguna
   norma y en el resto de navegadores no existe, así que ahí se dice «no
   disponible» en vez de inventar un número. La alternativa normalizada,
   `measureUserAgentSpecificMemory()`, exige aislamiento de origen
   cruzado (COOP/COEP): ni una página abierta con doble clic ni GitHub
   Pages pueden dar esas cabeceras, así que no es una opción.

   SOBRE file:// EL VALOR SE QUEDA CONGELADO, y por eso ahí no se
   muestra: un número fijo con aspecto de medida en vivo engaña más que
   no poner nada. Medido con Chromium 129: reservando 600.000 objetos,
   `usedJSHeapSize` no se movió de 9,54 MB ni a los 35 s con el archivo
   abierto por file://, mientras que la MISMA página servida por http
   pasó de 4,38 a 54,33 MB al instante. O sea que el indicador sirve
   en el demo y en cualquier despliegue servido, que es donde el
   consumo importa de verdad.

   A diferencia del almacenamiento, que se refresca tras cada guardado
   porque ya viaja con su propio retardo, la memoria cambia sin que el
   árbol se toque —navegar el mapa, abrir diálogos—, así que lleva su
   propio temporizador. Leer `performance.memory` es un captador, no una
   consulta al disco como `navigator.storage.estimate()`, y por eso este
   temporizador puede permitirse ser periódico y aquel no: medido, 0,005
   ms por lectura.                                                     */
const MEMORY_REFRESH_MS = 5000;
function refreshMemoryUsage() {
  const el = document.getElementById("memory-usage");
  if (!el) return;
  const m = performance.memory;
  if (!m || !isFinite(m.usedJSHeapSize)) {
    el.textContent = "Memoria de la pestaña: no disponible en este navegador.";
    return;
  }
  if (location.protocol === "file:") {
    el.textContent = "Memoria de la pestaña: no se mide al abrir el archivo directamente.";
    return;
  }
  el.textContent = `Memoria de la pestaña: ${fmtBytes(m.usedJSHeapSize)}`
    + ` de ${fmtBytes(m.jsHeapSizeLimit)}`;
}

function saveTree() {
  saveChain = saveChain
    .then(() => {
      const t0 = performance.now();
      const nodes = serializeTree();
      saveCost = performance.now() - t0;
      return dbSaveTree(nodes);
    })
    .then(refreshStorageUsage)
    .catch(err => {
      /* Un solo aviso por racha de fallos, para no inundar el panel */
      if (!savePending) {
        savePending = true;
        navMessage(`No se pudo guardar el estado en el navegador: ${err && err.message ? err.message : "error de almacenamiento"}.`);
        setTimeout(() => { savePending = false; }, 5000);
      }
    });
  return saveChain;
}

/* ---------- Reconstrucción del árbol desde el almacenamiento ---------- */
function countLayers(nodes) {
  let n = 0;
  for (const x of nodes) {
    if (x.t === "layer" || x.t === "measure" || x.t === "elevGrid" || x.t === "imageOverlay") n++;
    else n += countLayers(x.children || []);
  }
  return n;
}
async function restoreTree(nodes) {
  const total = countLayers(nodes);
  const prog = total > 500 ? {
    done: 0,
    update: d => progress.set(100 * d / total, `Restaurando capas\u2026 (${d}/${total})`)
  } : null;
  const records = await buildRecordsFromStorage(nodes, prog);
  if (prog) progress.hide();
  await materializeRecords(records, ensureRootUl());
}

/* Reconstruye la geometría/capas Leaflet de un árbol guardado
   (restaurar, deshacer/rehacer, pegar, importar un .kite.json), como
   REGISTROS — nunca filas del panel. Igual que buildKmlRecords: la
   visibilidad de cada capa (alta en rootGroup) es independiente de si
   su fila llega a materializarse, así que esto SIEMPRE recorre el
   árbol entero sin mirar `collapsed` — es materializeRecords quien
   decide cuánto DOM construir a partir de estos registros.        */
async function buildRecordsFromStorage(nodes, prog) {
  const out = [];
  for (const n of nodes) {
    if (n.t === "measure") {
      out.push(buildMeasureRecord(n));
    } else if (n.t === "elevGrid") {
      out.push(buildElevGridRecord(n));
    } else if (n.t === "imageOverlay") {
      out.push(buildImageOverlayRecord(n));
    } else if (n.t === "layer") {
      const layer = L.geoJSON(n.geo, n.style ? { style: n.style } : undefined);
      clearFillOnOpenPaths(layer); /* una línea no se rellena, ver esa función */
      layer.bindPopup(n.name);
      if (n.checked) layer.addTo(rootGroup);
      const rec = { t: "layer", name: n.name, checked: !!n.checked, style: n.style || null,
                    geo: n.geo, mstyle: n.mstyle, desc: n.desc || null, _layer: layer };
      /* geo ya es el toGeoJSON() que serializeNode recalcularía: se
         reutiliza en vez de perder la caché (ver materializeRecords) */
      wirePendingLayerEvents(rec);
      out.push(rec);
    } else {
      const children = await buildRecordsFromStorage(n.children || [], prog);
      out.push({ t: n.t, name: n.name, checked: !!n.checked, collapsed: !!n.collapsed, children });
    }
    if (prog && (n.t === "layer" || n.t === "measure" || n.t === "elevGrid" || n.t === "imageOverlay") && ++prog.done % PROGRESS_BATCH === 0) {
      prog.update(prog.done);
      await yieldFrame();
    }
  }
  return out;
}

/* Convierte REGISTROS (de buildKmlRecords/buildGeoJsonRecords/
   buildRecordsFromStorage, o de li._pending) en filas reales del panel,
   por lotes con yieldFrame — usada para la materialización inicial
   de una importación/restauración Y para materializar una
   carpeta al desplegarla por primera vez (ensureMaterialized): es el
   mismo trabajo ("construir estas filas aquí dentro"), la fuente de
   los registros es lo único que cambia. Una carpeta que empieza
   colapsada solo recibe su PROPIA fila: sus hijos se quedan en
   `li._pending` sin tocar el DOM, en vez de recursar — así que
   desplegar una carpeta grande nunca materializa más que ella y la
   cadena de subcarpetas ya abiertas, nunca el subárbol entero. No
   lleva parámetro de progreso: el trabajo caro (parsear geometría,
   construir capas Leaflet) ya pasó en la fase de registros, que sí
   lo muestra; esto solo cede el hilo para no bloquear.                 */
async function materializeRecords(records, parentUl) {
  let n = 0;
  for (const rec of records) {
    if (rec.t === "folder" || rec.t === "file") {
      const li = makeNode({
        name: rec.name, isFolder: rec.t === "folder", isFile: rec.t === "file", checked: !!rec.checked
      });
      rec._li = li; /* referencia inversa: la usa resolveMatch para llegar aquí desde una búsqueda pendiente */
      if (rec.collapsed) li.classList.add("collapsed");
      syncExpanded(li);
      parentUl.appendChild(li);
      /* la sección que contiene mediciones recupera su papel, mire o no
         esta llamada dentro de sus hijos: rec.children ya existe       */
      if (rec.t === "file" && rec.children.some(c => c.t === "measure")) measureLi = li;
      if (rec.collapsed) {
        li._pending = rec.children;
      } else {
        await materializeRecords(rec.children, nodeUl(li));
      }
    } else if (rec.t === "layer") {
      const li = makeNode({
        name: rec.name, layer: rec._layer, style: rec.style || null, checked: !!rec.checked,
        desc: rec.desc || null
      });
      rec._li = li;
      /* makeNode already wired the definitive click/hover listeners (see
         "back-reference" there): the waiting ones from
         wirePendingLayerEvents are no longer needed and must be
         removed, or the layer would keep two and a click would
         highlight the node twice.                                     */
      if (rec._pendingHandlers) {
        rec._layer.off("click", rec._pendingHandlers.onClick);
        rec._layer.off("mouseover", rec._pendingHandlers.onHover);
        rec._layer.off("mouseout", rec._pendingHandlers.onLeave);
        rec._pendingHandlers = null;
      }
      if (rec.geo) li._geo = rec.geo;
      parentUl.appendChild(li);
      if (rec.mstyle) {
        li._mstyle = rec.mstyle;
        applyMarkerStyle(li); /* síncrona: los iconos van empotrados */
      } else {
        ensureMarkerDefaults(li);
      }
    } else if (rec.t === "measure") {
      const li = makeMeasureLi(rec._m);
      rec._li = li;
      parentUl.appendChild(li);
      if (!rec.checked) li.querySelector(":scope > .node-row > input").checked = false;
      updateMeasurement(rec._m);
    } else if (rec.t === "elevGrid") {
      const li = makeNode({
        name: rec.name, layer: rec._layer, styleable: false, checked: !!rec.checked,
        onDelete: () => {
          const i = elevGridGroups.indexOf(rec._layer);
          if (i >= 0) elevGridGroups.splice(i, 1);
        }
      });
      rec._li = li;
      li._elevGrid = { cells: rec.cells };
      parentUl.appendChild(li);
    } else if (rec.t === "imageOverlay") {
      const li = makeNode({ name: rec.name, layer: rec._layer, styleable: true, checked: !!rec.checked });
      rec._li = li;
      li._imageOverlay = { box: rec.box, dataUrl: rec.dataUrl, opacity: rec.opacity };
      parentUl.appendChild(li);
    }
    if (++n % PROGRESS_BATCH === 0) await yieldFrame();
  }
}

/* ---------- Indicador de progreso (tres fases) ----------
   Solo se muestra para archivos que superen el umbral; los pequeños
   cargan al instante y la barra sería ruido.                        */
const SIZE_THRESHOLD = 2.5 * 1024 * 1024; /* ~2.5 MB */
const progress = {
  el: document.getElementById("progress"),
  label: document.getElementById("progress-label"),
  fill: document.getElementById("progress-fill"),
  /* barra determinada 0–100 */
  set(pct, txt) {
    this.el.hidden = false;
    this.fill.classList.remove("indet");
    this.fill.style.width = pct.toFixed(1) + "%";
    this.label.textContent = txt;
  },
  /* fase de duración desconocida (rayas animadas) */
  indet(txt) {
    this.el.hidden = false;
    this.fill.classList.add("indet");
    this.label.textContent = txt;
  },
  hide() {
    this.el.hidden = true;
    this.fill.classList.remove("indet");
    this.fill.style.width = "0";
  }
};

