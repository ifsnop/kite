/* ================= Acciones del panel de navegación ================= */

/* ---------- Búsqueda entre capas y carpetas ----------
   Parcial y sin distinguir mayúsculas. Las flechas recorren las
   ocurrencias; highlightNode despliega las carpetas necesarias.   */
const searchBox = document.getElementById("search-box");
const searchCount = document.getElementById("search-count");
let searchIdx = -1;

/* Recorre TODO el árbol -- filas ya materializadas MÁS registros dentro
   de carpetas pendientes (li._pending), sin materializar nada todavía --
   devolviendo lo que cumpla `matchLi`/`matchRec`. Cada coincidencia
   pendiente lleva su "chain", la secuencia de registros ancestros hasta
   llegar a ella, que resolveMatch recorre materializando un nivel cada
   vez, solo cuando de verdad hace falta alcanzarla. Generaliza lo que
   antes era solo el buscador del panel (por nombre): resolver desde qué
   fila real corresponde una capa concreta (por identidad) o encontrar
   una capa de un tipo dado que ya esté en rootGroup son el MISMO
   recorrido con un predicado distinto — ver resolveRecordLi y
   visibleElevGridLis.                                                 */
function findMatches(matchLi, matchRec) {
  const out = [];
  const scanRecords = (records, startLi, chain) => {
    for (const rec of records) {
      const nextChain = [...chain, rec];
      if (matchRec(rec)) out.push({ startLi, chain: nextChain });
      if (rec.children) scanRecords(rec.children, startLi, nextChain);
    }
  };
  const scanLi = li => {
    if (matchLi(li)) out.push({ li });
    if (li._pending) scanRecords(li._pending, li, []);
    const ul = nodeUl(li);
    if (ul) for (const child of ul.children) scanLi(child);
  };
  if (rootUl) for (const li of rootUl.children) scanLi(li);
  return out;
}
function searchMatches() {
  const term = searchBox.value.trim().toLowerCase();
  if (!term) return [];
  return findMatches(
    li => li._name !== undefined && li._name.toLowerCase().includes(term),
    rec => rec.name.toLowerCase().includes(term)
  );
}
/* Materializa la cadena de una coincidencia pendiente hasta obtener su
   <li> real. `startLi`, el ancestro real más cercano cuyo _pending
   contiene el primer eslabón, viaja aparte porque el propio chain solo
   tiene registros (sin referencia a él). ensureMaterialized en un nodo
   ya materializado es un no-op, así que recorrer el chain entero
   llamándolo en cada paso es seguro aunque varios eslabones ya
   estuvieran abiertos (se cascadearon solos en la misma pasada).      */
async function resolveMatch(match) {
  if (match.li) return match.li;
  let li = match.startLi;
  for (const rec of match.chain) {
    await ensureMaterialized(li);
    li = rec._li;
    if (!li) return null; /* defensivo: no debería ocurrir */
  }
  return li;
}

/* Resuelve un registro de capa concreto a su <li> real, materializando
   la cadena de carpetas ancestras si hace falta. Es lo que necesita
   clicar/pasar el ratón sobre una capa en el mapa cuando su fila
   todavía es pendiente: buscar por IDENTIDAD del registro en vez de por
   nombre es el mismo findMatches que ya usa searchMatches.             */
async function resolveRecordLi(rec) {
  if (rec._li) return rec._li; /* ya materializada: sin recorrer nada */
  const matches = findMatches(() => false, r => r === rec);
  return matches.length ? resolveMatch(matches[0]) : null; /* defensivo: no debería ocurrir */
}

/* Engancha clic/hover en el momento de construir una capa "layer"
   (buildKmlRecords/buildGeoJsonRecords/buildRecordsFromStorage), antes
   de que tenga fila real: resolveRecordLi materializa lo necesario la
   primera vez que se disparan. Los handlers de espera se guardan en
   rec._pendingHandlers para que materializeRecords los retire en
   cuanto engancha los definitivos (ver su rama "layer") — si no, la
   capa se quedaría con dos listeners para siempre y un clic resaltaría
   el nodo dos veces.                                                  */
function wirePendingLayerEvents(rec) {
  const onClick = async () => {
    if (activeTool === "polygon") return; /* that click fixes a vertex, it doesn't highlight the layer */
    const li = await resolveRecordLi(rec); if (li) highlightNode(li);
  };
  const onHover = async () => { const li = await resolveRecordLi(rec); if (li) showLayerInfo(li, { focus: false }); };
  const onLeave = scheduleLayerInfoHide; /* doesn't need resolveRecordLi: only hides whatever is already open */
  rec._layer.on("click", onClick).on("mouseover", onHover).on("mouseout", onLeave);
  rec._pendingHandlers = { onClick, onHover, onLeave };
}
function updateSearchCount(total) {
  searchCount.textContent = searchBox.value.trim()
    ? `${searchIdx + 1}/${total}` : "";
}
async function gotoMatch(dir) {
  const matches = searchMatches(); /* recalculado: el árbol puede cambiar */
  if (!matches.length) { searchIdx = -1; updateSearchCount(0); return; }
  /* con el índice sin estrenar, "anterior" debe caer en la última ocurrencia */
  if (searchIdx === -1 && dir === -1) searchIdx = 0;
  searchIdx = ((searchIdx + dir) % matches.length + matches.length) % matches.length;
  const li = await resolveMatch(matches[searchIdx]);
  if (li) highlightNode(li);
  updateSearchCount(matches.length);
}
/* Busca en vivo mientras se teclea: debounced (evita recorrer el árbol
   completo en cada tecla, ~8.000-10.000 nodos) y solo a partir de
   SEARCH_MIN_CHARS (evita saltar de resultado mientras el usuario
   todavía está afinando el término). gotoMatch (Enter, botones ◀▶) no
   lleva este mínimo: es una acción explícita, no debe quedarse callada
   por un término corto.                                              */
const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_MIN_CHARS = 3;
let searchTimer = null;

async function runLiveSearch() {
  if (searchBox.value.trim().length < SEARCH_MIN_CHARS) {
    searchIdx = -1;
    searchCount.textContent = "";
    return;
  }
  const matches = searchMatches();
  searchIdx = matches.length ? 0 : -1;
  if (matches.length) {
    const li = await resolveMatch(matches[0]);
    if (li) highlightNode(li);
  }
  updateSearchCount(matches.length);
}
searchBox.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runLiveSearch, SEARCH_DEBOUNCE_MS);
});
searchBox.addEventListener("keydown", e => {
  if (e.key === "Enter") gotoMatch(e.shiftKey ? -1 : 1);
});
document.getElementById("search-next").addEventListener("click", () => gotoMatch(1));
document.getElementById("search-prev").addEventListener("click", () => gotoMatch(-1));

/* ---------- Búsqueda de lugares (Nominatim) ----------
   Geocoding against the public Nominatim service. Its usage policy caps
   automated traffic at about one request per second, so the search only
   fires on Enter or on the button — never on every keystroke — and asks
   for at most five results. Picking one drops a marker with the default
   marker style at the returned coordinates.                            */
const PLACE_LIMIT = 5;
const PLACES_SECTION = "Lugares";
const placeBox = document.getElementById("place-box");
const placeResults = document.getElementById("place-results");
const placeStatus = document.getElementById("place-status");
const placeList = document.getElementById("place-list");
let placeSeq = 0; /* discards responses of superseded searches */

/* Top-level section holding user-created nodes (searched places, pins).
   Reused across restores: the tree comes back from storage as plain file
   nodes, so the section is located by name instead of by reference.    */
/* Siguiente nombre libre de una familia autonumerada ("Línea 3").
   Se deduce de los nombres que YA hay en el árbol, no de un contador en
   memoria: una línea o un polígono dibujados se restauran por el camino
   genérico t:"layer", que no sabe que los creó esta herramienta, así
   que un contador se reiniciaría en cada recarga y volvería a repetir
   "Línea 1" — justo lo que esto debe evitar. Las mediciones sí podían
   llevar contador porque tienen su propio tipo de registro y lo
   resincronizaban al restaurar; ahora comparten este mecanismo para que
   una medición y una línea dibujada tampoco puedan llamarse igual.
   Se barre el árbol entero, no solo la sección de destino, porque los
   nodos se pueden mover a cualquier carpeta. Cuesta lo que una búsqueda
   del panel y solo ocurre al crear una forma, nunca en un bucle.
   Cuenta también los registros PENDIENTES (li._pending) de las carpetas
   nunca desplegadas: esos nodos existen aunque no tengan fila.        */
function nextNumberedName(base) {
  const re = new RegExp(`^${base} (\\d+)$`);
  let max = 0;
  const consider = name => {
    const m = re.exec(name == null ? "" : String(name));
    if (m && Number(m[1]) > max) max = Number(m[1]);
  };
  const walkRecords = recs => {
    for (const r of recs) {
      consider(r.name);
      if (r.children) walkRecords(r.children);
    }
  };
  for (const li of treeEl.querySelectorAll("li")) {
    consider(li._name);
    if (li._pending) walkRecords(li._pending);
  }
  return `${base} ${max + 1}`;
}

function ensureNamedSection(name) {
  const ul = ensureRootUl();
  for (const li of ul.children) {
    if (li.classList.contains("file") && li._name === name) return nodeUl(li);
  }
  const li = makeNode({ name, isFile: true });
  ul.appendChild(li);
  return nodeUl(li);
}

function hidePlaceResults() {
  placeResults.hidden = true;
  placeList.innerHTML = "";
  placeStatus.textContent = "";
}

const PLACE_TIMEOUT = 10000;
let placeAbort = null; /* petición en vuelo, para poder cancelarla */

/* Traduce el fallo a algo accionable en vez de "error de red" */
function describeHttp(status) {
  if (status === 429) return "el servicio ha limitado las consultas; espere unos segundos";
  if (status === 403) return "el servicio ha rechazado la consulta";
  if (status >= 500) return `el servicio no est\u00E1 disponible (HTTP ${status})`;
  return `respuesta inesperada del servicio (HTTP ${status})`;
}

async function searchPlaces(query) {
  const seq = ++placeSeq;
  /* Cancela la consulta anterior: sus resultados ya no interesan y la
     conexión debe liberarse, no quedarse en vuelo                    */
  if (placeAbort) placeAbort.abort();
  const ctrl = placeAbort = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), PLACE_TIMEOUT);

  placeResults.hidden = false;
  placeList.innerHTML = "";
  placeStatus.textContent = "Buscando\u2026";
  const url = "https://nominatim.openstreetmap.org/search?format=jsonv2"
    + `&limit=${PLACE_LIMIT}&q=${encodeURIComponent(query)}`;
  let results;
  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    if (!resp.ok) throw new Error(describeHttp(resp.status));
    results = await resp.json();
    if (!Array.isArray(results)) throw new Error("respuesta con un formato inesperado");
  } catch (err) {
    if (seq !== placeSeq) return; /* cancelada por otra búsqueda: sin ruido */
    const why = err.name === "AbortError"
      ? `el servicio ha tardado m\u00E1s de ${PLACE_TIMEOUT / 1000} s en responder`
      : err.message;
    placeStatus.textContent = "No se pudo consultar el servicio de b\u00FAsqueda.";
    navMessage(`Error al buscar el lugar: ${why}.`);
    return;
  } finally {
    clearTimeout(timer);
    if (placeAbort === ctrl) placeAbort = null;
  }
  if (seq !== placeSeq) return; /* a newer search is already on screen */
  if (!results.length) {
    placeStatus.textContent = `Sin resultados para \u00AB${query}\u00BB.`;
    return;
  }
  placeStatus.textContent = `${results.length} resultado(s) \u2014 elija uno`;
  for (const r of results) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.textContent = r.display_name;
    b.title = r.display_name;
    b.addEventListener("click", () => addPlaceMarker(r));
    li.appendChild(b);
    placeList.appendChild(li);
  }
}

/* Marker for a chosen result. `ensureMarkerDefaults` gives it the default
   style (Leaflet pin, #1b5e97), the same one imported markers get.      */
function addPlaceMarker(r) {
  const lat = Number(r.lat), lon = Number(r.lon);
  if (!isFinite(lat) || !isFinite(lon)) { navMessage("El resultado no trae coordenadas v\u00E1lidas."); return; }
  const name = r.name || String(r.display_name).split(",")[0];
  const layer = L.marker([lat, lon]).addTo(rootGroup);
  const li = makeNode({ name, layer, style: { color: DEFAULT_MARKER_STYLE.color } });
  ensureNamedSection(PLACES_SECTION).appendChild(li);
  ensureMarkerDefaults(li);
  hidePlaceResults();
  placeBox.value = "";
  scheduleSave();

  /* Choosing a search result IS asking to go there, so this is the one
     case where the app moves the view on its own                       */
  const bb = r.boundingbox && r.boundingbox.map(Number);
  if (bb && bb.length === 4 && bb.every(isFinite)) {
    map.fitBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { padding: [30, 30] });
  } else {
    map.setView([lat, lon], Math.max(map.getZoom(), 14));
  }
}

/* Pin created from the viewer toolbar: dropped at the centre of the
   current view and opened straight into the style dialog, where its
   icon, text, size and position can be set. Cancelling there removes
   it again (see `styleIsNew`).                                       */
const PINS_SECTION = "Marcadores";
function createPin() {
  const marker = L.marker(map.getCenter()).addTo(rootGroup);
  const li = makeNode({
    name: "Marcador", layer: marker, style: { color: DEFAULT_MARKER_STYLE.color }
  });
  ensureNamedSection(PINS_SECTION).appendChild(li);
  ensureMarkerDefaults(li);
  scheduleSave();
  openStyleDialog(li, { isNew: true });
}

function runPlaceSearch() {
  const q = placeBox.value.trim();
  if (!q) { navMessage("Escriba un lugar que buscar."); return; }
  searchPlaces(q);
}
document.getElementById("place-btn").addEventListener("click", runPlaceSearch);
placeBox.addEventListener("keydown", e => { if (e.key === "Enter") runPlaceSearch(); });
document.getElementById("place-close").addEventListener("click", () => {
  placeSeq++;
  if (placeAbort) { placeAbort.abort(); placeAbort = null; } /* libera la conexión */
  hidePlaceResults();
});

/* New folder: hangs from the cursor. If the cursor is a folder, the new
   one goes INSIDE it as the last item, expanding it first if it was
   collapsed (same "always insert inside" rule the external-file-drop
   handler already follows, kept consistent here). Otherwise it lands
   right after the cursor as a sibling, or at the tree root with no
   cursor. Returns the new <li>.                                        */
async function createFolderNode(cur, name) {
  let ul, intoFolder = false;
  if (cur && nodeUl(cur)) {
    intoFolder = true;
    if (cur.classList.contains("collapsed")) {
      cur.classList.remove("collapsed");
      syncExpanded(cur);
      await ensureMaterialized(cur);
    }
    ul = nodeUl(cur);
  } else {
    ul = cur ? cur.parentElement : ensureRootUl();
  }
  const li = makeNode({ name, isFolder: true });
  if (!intoFolder && cur && cur.nextSibling) ul.insertBefore(li, cur.nextSibling);
  else ul.appendChild(li);
  return li;
}

/* It used to always land at the tree root and was not undoable.        */
const newFolderName = document.getElementById("new-folder-name");
document.getElementById("new-folder-btn").addEventListener("click", async () => {
  const name = newFolderName.value.trim();
  if (!name) { navMessage("Escriba un nombre para la carpeta."); return; }
  const cur = isRow(selCursor) && selCursor.isConnected ? selCursor : null;
  pushUndo("crear carpeta");
  const li = await createFolderNode(cur, name);
  newFolderName.value = "";
  moveCursorTo(li, false);
  scheduleSave();
});
newFolderName.addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("new-folder-btn").click();
});

/* Seleccionar / deseleccionar todo: cambia visibilidad de todas las
   capas sin alterar qué carpetas están desplegadas o colapsadas. Cede el
   hilo por lotes igual que cascadeVisibility: es el mismo barrido a
   escala de árbol completo.                                            */
/* Recorrido recursivo (no querySelectorAll plano) por la MISMA razón que
   cascadeVisibility: hay que alcanzar también los registros pendientes
   de cualquier carpeta nunca desplegada, en cualquier punto del árbol,
   no solo las filas ya materializadas.                                */
async function setPendingChecked(records, state, counter) {
  for (const rec of records) {
    rec.checked = state;
    if (rec.children) await setPendingChecked(rec.children, state, counter);
    else setLayerVisible(rec._layer, state);
    if (++counter.n % CASCADE_BATCH === 0) await yieldFrame();
  }
}
async function setAllChecked(state) {
  const counter = { n: 0 };
  const walk = async li => {
    const chk = li.querySelector(":scope > .node-row > input[type=checkbox]");
    if (chk) {
      chk.checked = state;
      applyVisibility(chk);
      if (++counter.n % CASCADE_BATCH === 0) await yieldFrame();
    }
    const ul = nodeUl(li);
    if (ul) for (const child of [...ul.children]) await walk(child);
    if (li._pending) await setPendingChecked(li._pending, state, counter);
  };
  if (rootUl) for (const li of [...rootUl.children]) await walk(li);
  scheduleSave();
}
document.getElementById("activate-all").addEventListener("click", () => setAllChecked(true));
document.getElementById("deactivate-all").addEventListener("click", () => setAllChecked(false));
document.getElementById("collapse-all").addEventListener("click", () => collapseDescendants(treeEl));

/* ================= Teclado del panel de navegación =================
   Se comporta como un árbol de Windows: las flechas mueven el cursor y
   la selección le sigue; con Shift se extiende el rango desde el ancla;
   derecha/izquierda despliegan y colapsan; Inicio/Fin van a los extremos
   de la carpeta actual; espacio activa o desactiva; Ctrl+X/C/V mueven y
   copian ramas; Alt+Intro abre las propiedades.                       */
const PAGE_STEP = 10;

/* Hermanos visibles del nodo: lo que recorren Inicio y Fin, que trabajan
   dentro de la carpeta actual y no sobre la lista entera             */
const siblingRows = li => childRows(li ? li.parentElement : rootUl);

/* Mueve el cursor a `to`. Con Shift arrastra el rango desde el ancla;
   sin Shift, la selección pasa a ser solo ese nodo (las flechas
   "olvidan" la selección anterior, como se pidió).                    */
function moveCursorTo(to, extend) {
  if (!to) return;
  if (extend) selectRange(to);
  else {
    for (const li of [...selection]) setSelected(li, false);
    selectNode(to, true);
  }
  nodeRow(to).scrollIntoView({ block: "nearest" });
}

/* Despliega, o entra en el primer hijo si ya estaba desplegada. Si el
   primer despliegue encuentra la carpeta pendiente, materializarla es
   asíncrono: una segunda pulsación de flecha derecha, si llega antes de
   que termine, simplemente no encuentra hijos todavía y no hace nada —
   se resuelve sola en cuanto la materialización acaba.                */
async function expandOrEnter(li, extend) {
  if (!nodeUl(li)) return;
  if (li.classList.contains("collapsed")) {
    li.classList.remove("collapsed");
    syncExpanded(li);
    scheduleSave();
    await ensureMaterialized(li);
    return;
  }
  const first = childRows(nodeUl(li))[0];
  if (first) moveCursorTo(first, extend);
}

/* Colapsa, o sube a la carpeta madre si ya estaba colapsada */
function collapseOrLeave(li, extend) {
  if (nodeUl(li) && !li.classList.contains("collapsed")) {
    li.classList.add("collapsed");
    syncExpanded(li);
    scheduleSave();
    return;
  }
  const parent = li.parentElement && li.parentElement.closest("li");
  if (parent) moveCursorTo(parent, extend);
}

/* Espacio: alterna la visibilidad de lo seleccionado (o del cursor) */
function toggleVisibility(li) {
  const targets = selection.has(li) && selection.size > 1 ? topLevelSelection() : [li];
  const chk = nodeRow(targets[0]).querySelector("input[type=checkbox]");
  if (!chk) return;
  const on = !chk.checked;
  for (const n of targets) {
    const c = nodeRow(n).querySelector("input[type=checkbox]");
    if (c && c.checked !== on) c.click(); /* reutiliza toda la lógica en cascada */
  }
}

/* ---------- Portapapeles interno ----------
   Se guardan los MISMOS registros con los que se serializa el árbol, así
   que pegar no es más que reconstruirlos. Cortar no borra nada hasta que
   se pega: si el usuario cambia de idea, no ha perdido su rama.       */
let clipboard = null; /* { nodes, cut: [li], move: bool } */

function copySelection(cut) {
  const picked = topLevelSelection();
  if (!picked.length) { navMessage("No hay nada seleccionado que copiar."); return; }
  clipboard = { nodes: picked.flatMap(serializeNode), cut: cut ? picked : [], move: cut };
  for (const li of treeEl.querySelectorAll(".node-row.cut")) li.classList.remove("cut");
  if (cut) for (const li of picked) nodeRow(li).classList.add("cut");
  navMessage(`${picked.length} nodo(s) ${cut ? "cortado(s)" : "copiado(s)"}.`, { tone: "info" });
}

/* Pega dentro de la carpeta del cursor, o a continuación de él si el
   cursor no es una carpeta                                            */
async function pasteClipboard() {
  if (!clipboard) { navMessage("El portapapeles est\u00E1 vac\u00EDo."); return; }
  const cur = selCursor;
  const intoFolder = cur && nodeUl(cur) && !cur.classList.contains("collapsed");
  const ul = intoFolder ? nodeUl(cur) : (cur ? cur.parentElement : ensureRootUl());
  pushUndo("pegar");
  const before = new Set(ul.children);
  try {
    const records = await buildRecordsFromStorage(clipboard.nodes, null);
    await materializeRecords(records, ul);
  } catch (err) {
    navMessage(`No se pudo pegar: ${err.message}`);
    return;
  }
  const added = [...ul.children].filter(n => !before.has(n));
  if (!intoFolder && cur && cur.nextSibling) {
    for (const n of added) ul.insertBefore(n, cur.nextSibling);
  }
  if (clipboard.move) {
    for (const li of clipboard.cut) if (li.isConnected) deleteNode(li);
    clipboard = null; /* mover es una sola vez; copiar se puede repetir */
  }
  if (added.length) moveCursorTo(added[0], false);
  scheduleSave();
}

/* Alt+Intro: propiedades de lo seleccionado */
function openPropertiesOfSelection() {
  const picked = topLevelSelection().filter(n => !nodeUl(n));
  if (!picked.length) { navMessage("Seleccione una o varias capas para editar sus propiedades."); return; }
  openStyleDialog(picked[0]);
}

document.addEventListener("keydown", e => {
  const t = e.target;
  /* Los campos de texto se quedan con todas las teclas */
  if (t.matches && t.matches("input:not([type=checkbox]), textarea, select, [contenteditable]")) return;
  /* Con el mapa enfocado, las flechas son el desplazamiento de Leaflet */
  if (t.closest && t.closest("#map")) return;

  /* Sin listas: el cursor y sus vecinos se buscan en local */
  const cur = isRow(selCursor) && selCursor.isConnected ? selCursor : null;

  /* Atajos con Ctrl / Alt primero, para que no los pise la navegación */
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === "c") { e.preventDefault(); copySelection(false); return; }
    if (k === "x") { e.preventDefault(); copySelection(true); return; }
    if (k === "v") { e.preventDefault(); pasteClipboard(); return; }
    if (k === "z") { e.preventDefault(); undoLast(); return; }
    if (k === "y") { e.preventDefault(); redoLast(); return; }
    if (k === "f") { e.preventDefault(); searchBox.focus(); searchBox.select(); return; }
    if (k === "a") { e.preventDefault(); selectAllStep(cur); return; }
    if (e.shiftKey) return; /* Ctrl+Shift+click se maneja en el ratón */
  }
  if (e.key === "F2" && cur) { e.preventDefault(); startRename(cur); return; }
  if (e.key === "?" || (e.key === "/" && e.shiftKey)) { e.preventDefault(); toggleShortcuts(); return; }
  if (e.altKey && e.key === "Enter") { e.preventDefault(); openPropertiesOfSelection(); return; }

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      moveCursorTo(cur ? stepRows(cur, 1) : firstRow(), e.shiftKey);
      return;
    case "ArrowUp":
      e.preventDefault();
      moveCursorTo(cur ? stepRows(cur, -1) : lastRow(), e.shiftKey);
      return;
    case "PageDown":
      e.preventDefault();
      moveCursorTo(cur ? stepRows(cur, PAGE_STEP) : firstRow(), e.shiftKey);
      return;
    case "PageUp":
      e.preventDefault();
      moveCursorTo(cur ? stepRows(cur, -PAGE_STEP) : lastRow(), e.shiftKey);
      return;
    case "Home": case "End": {
      e.preventDefault();
      /* Extremos de la CARPETA actual, no de la lista entera */
      const sibs = siblingRows(cur || firstRow());
      if (!sibs.length) return;
      moveCursorTo(e.key === "Home" ? sibs[0] : sibs[sibs.length - 1], e.shiftKey);
      return;
    }
    case "ArrowRight":
      if (!cur) return;
      e.preventDefault();
      expandOrEnter(cur, e.shiftKey);
      return;
    case "ArrowLeft":
      if (!cur) return;
      e.preventDefault();
      collapseOrLeave(cur, e.shiftKey);
      return;
    case " ": case "Spacebar":
      if (!cur) return;
      e.preventDefault();
      toggleVisibility(cur);
      return;
  }

});

