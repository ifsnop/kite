/* ================= Árbol de la ventana de navegación ================= */

const treeEl = document.getElementById("tree");
const navPanel = document.getElementById("nav-panel");
let rootUl = null;
let nodeSeq = 0;
let dragLi = null;    /* nodo representativo del arrastre en curso */
let dragItems = null; /* nodos que viajan en el arrastre (la selección o uno suelto) */

/* ---------- Selección múltiple (Shift+click en la navegación) ----------
   Shift está libre en el panel (en el visor es el box-zoom de Leaflet).
   La selección permite arrastrar y borrar varios nodos de golpe.        */
/* ---------- Selección ----------
   Marcar miles de capas tiene que costar lo mismo por capa que por una:
   nada aquí puede recorrer la selección entera ni consultar el árbol en
   cada nodo, o el coste se vuelve cuadrático y marcar una carpeta grande
   tarda segundos. De ahí `selectionKind` (el tipo de la selección, en vez
   de recalcularlo mirando a todos sus miembros), quitar la marca de
   cursor solo al cursor anterior y `nodeRow`, que evita una consulta al
   DOM por nodo.                                                        */
const selection = new Set();
let selCursor = null;       /* last row the selection touched */
let selAnchor = null;       /* extremo fijo de los rangos con Shift    */

const nodeRow = li => li._row || li.querySelector(":scope > .node-row");

function setSelected(li, on) {
  nodeRow(li).classList.toggle("selected", on);
  li.setAttribute("aria-selected", String(on));
  if (on) selection.add(li); else selection.delete(li);
}
function clearSelection() {
  for (const li of [...selection]) setSelected(li, false);
  selAnchor = null;
  setSelCursor(null);
}

/* The cursor is where the keyboard picks up from; it is drawn so the user
   can see which row Shift+arrows will move away from                     */
function setSelCursor(li) {
  if (selCursor) nodeRow(selCursor).classList.remove("cursor");
  selCursor = li;
  if (li) nodeRow(li).classList.add("cursor");
  /* Único punto de paso de todo cambio de cursor (ver sus llamadas): es
     el sitio correcto para mantener aria-activedescendant, la forma en
     que un lector de pantalla sabe qué fila "tiene el foco" cuando todo
     el árbol comparte un solo tabindex. Medido (linkedom, 20.000
     llamadas seguidas): 0,38 µs de más por llamada — nada frente a una
     flecha pulsada por una persona, ni con repetición automática.      */
  if (li) treeEl.setAttribute("aria-activedescendant", li.id);
  else treeEl.removeAttribute("aria-activedescendant");
}

/* Punto único para marcar o desmarcar un nodo suelto. Ya NO se exige que
   toda la selección sea del mismo tipo: se puede seleccionar lo que sea
   y es el diálogo de propiedades quien avisa si la mezcla no se puede
   editar en bloque. Así el teclado y el ratón se comportan como en
   cualquier gestor de archivos.                                       */
function selectNode(li, on) {
  setSelected(li, on);
  setSelCursor(li);
  selAnchor = li;
}

/* ---------- Selección por rango (Shift) ----------
   El ancla es el extremo fijo: Shift+click y Shift+flechas seleccionan
   todo lo que hay entre ella y el nodo de destino, reemplazando la
   selección anterior, como en el explorador de Windows.               */
function selectRange(to) {
  if (!isRow(to)) return;
  if (!isRow(selAnchor) || !selAnchor.isConnected) { selectNode(to, true); return; }
  /* Se camina desde el ancla hacia el destino en las dos direcciones y
     gana la que lo encuentre: cuesta la distancia entre ambos, no el
     tamaño del árbol                                                 */
  const walk = step => {
    const out = [];
    for (let n = selAnchor; n; n = step(n)) {
      out.push(n);
      if (n === to) return out;
    }
    return null;
  };
  const span = walk(nextRow) || walk(prevRow);
  if (!span) { selectNode(to, true); return; }
  for (const li of [...selection]) setSelected(li, false);
  for (const li of span) setSelected(li, true);
  setSelCursor(to);
}

/* Añade (o quita) un nodo sin arrastrar los intermedios: Ctrl+Shift */
function toggleOne(li) {
  const on = !selection.has(li);
  setSelected(li, on);
  setSelCursor(li);
  selAnchor = li;
}

/* Nombre legible del tipo, para poder explicar por qué algo se queda
   fuera de una selección                                              */
const KIND_LABEL = { marker: "marcadores", polygon: "pol\u00EDgonos", measure: "mediciones",
  elevGrid: "cuadr\u00EDculas de elevaci\u00F3n", imageOverlay: "ortofotos" };

/* Selecciona de una vez todas las capas de la rama que cuelga de un
   contenedor. Como solo pueden convivir capas del mismo tipo en la
   selección, manda el tipo de la primera capa encontrada y se avisa de
   cuántas quedan fuera en vez de marcarlas y desmarcarlas en silencio. */
/* Materializa TODA la rama, carpeta a carpeta, batido de ensureMaterialized
   (que ya cede el hilo internamente para una sola carpeta grande). Es lo
   que necesita "seleccionar todas las capas de esta carpeta": no tiene
   sentido pedir seleccionar filas que ni siquiera existen todavía.    */
async function materializeSubtree(li) {
  await ensureMaterialized(li);
  const ul = nodeUl(li);
  if (!ul) return;
  for (const child of [...ul.children]) {
    if (nodeUl(child)) await materializeSubtree(child);
  }
}
async function selectFolderLayers(li) {
  await materializeSubtree(li);
  const ul = nodeUl(li);
  if (!ul) return;
  const layers = [...ul.querySelectorAll("li")]
    .filter(n => n._name !== undefined && !nodeUl(n)); /* capas, no contenedores */
  if (!layers.length) { navMessage("Esta carpeta no contiene capas."); return; }

  clearSelection();
  /* Ruta masiva: se marcan directas y el cursor se fija UNA vez, no una
     por capa, que era lo que hacía lento marcar una carpeta grande   */
  for (const n of layers) setSelected(n, true);
  setSelCursor(layers[layers.length - 1]);
  selAnchor = layers[0];
}

/* ---------- Recorrido del árbol, nodo a nodo ----------
   Moverse NO puede costar recorrer el árbol entero: construir la lista
   completa de filas visibles en cada pulsación son ~9 ms con 10.000
   nodos, y con la tecla repetida el panel se atasca. Se navega en local:
   el siguiente y el anterior se encuentran mirando hermanos, hijos y
   madre, o sea O(profundidad), no O(nodos).                           */
const isRow = li => li && li.tagName === "LI" && li._name !== undefined;
const isOpen = li => nodeUl(li) && !li.classList.contains("collapsed");
const childRows = ul => (ul ? [...ul.children].filter(isRow) : []);

function nextSiblingRow(li) {
  for (let n = li.nextElementSibling; n; n = n.nextElementSibling) if (isRow(n)) return n;
  return null;
}
function prevSiblingRow(li) {
  for (let n = li.previousElementSibling; n; n = n.previousElementSibling) if (isRow(n)) return n;
  return null;
}
const parentRow = li => {
  const p = li.parentElement && li.parentElement.closest("li");
  return isRow(p) ? p : null;
};

/* Fila siguiente en el orden que se ve: primer hijo, hermano, o el
   hermano de algún ancestro                                          */
function nextRow(li) {
  if (isOpen(li)) {
    const first = childRows(nodeUl(li))[0];
    if (first) return first;
  }
  for (let n = li; n; n = parentRow(n)) {
    const sib = nextSiblingRow(n);
    if (sib) return sib;
  }
  return null;
}

/* Última fila visible de una rama, para poder subir "por dentro" */
function lastVisibleIn(li) {
  let cur = li;
  while (isOpen(cur)) {
    const kids = childRows(nodeUl(cur));
    if (!kids.length) break;
    cur = kids[kids.length - 1];
  }
  return cur;
}
function prevRow(li) {
  const sib = prevSiblingRow(li);
  return sib ? lastVisibleIn(sib) : parentRow(li);
}

/* Primera y última fila del árbol entero (para cuando no hay cursor) */
const firstRow = () => childRows(rootUl)[0] || null;
const lastRow = () => {
  const rows = childRows(rootUl);
  return rows.length ? lastVisibleIn(rows[rows.length - 1]) : null;
};

/* Avanza `n` filas, parándose en el extremo */
function stepRows(li, n) {
  const move = n > 0 ? nextRow : prevRow;
  let cur = li;
  for (let k = 0; k < Math.abs(n); k++) {
    const nx = move(cur);
    if (!nx) break;
    cur = nx;
  }
  return cur;
}
/* Selección en orden de documento, excluyendo nodos contenidos en otros
   seleccionados: esos viajan (o se borran) con su ancestro              */
/* Nodos seleccionados que NO cuelgan de otro seleccionado (esos viajan
   con su ancestro). Se mira hacia arriba consultando el Set, en vez de
   cruzar la selección consigo misma, que era cuadrático.             */
function topLevelSelection() {
  const out = [];
  for (const li of selection) {
    let covered = false;
    for (let p = li.parentElement; p && p !== treeEl && !covered; p = p.parentElement) {
      if (p.tagName === "LI" && selection.has(p)) covered = true;
    }
    if (!covered) out.push(li);
  }
  return out;
}

/* Where the cursor should land after deleting `items` (the top-level
   nodes about to be removed — a single row, or topLevelSelection()):
   the next surviving row after `anchor`, skipping anything that IS one
   of `items` or lives inside one (nextRow would otherwise descend into
   an open folder that's about to disappear entirely). Falls back to
   walking backward if nothing survives forward; null if nothing is
   left to land on at all. Call this BEFORE deleting — afterwards the
   sibling/parent relationships it walks are gone.                      */
function cursorAfterDelete(anchor, items) {
  if (!isRow(anchor)) return null;
  const isDeleted = node => items.some(it => it === node || it.contains(node));
  let candidate = nextRow(anchor);
  while (candidate && isDeleted(candidate)) candidate = nextRow(candidate);
  if (candidate) return candidate;
  candidate = prevRow(anchor);
  while (candidate && isDeleted(candidate)) candidate = prevRow(candidate);
  return candidate;
}

/* Encuadre combinado de todas las capas de un subárbol */
function extendBounds(bounds, l) {
  if (!l) return;
  if (l.getBounds) bounds.extend(l.getBounds());
  else if (l.getLatLng) bounds.extend(l.getLatLng());
}
/* Recorre registros pendientes (li._pending) SIN materializar nada: sus
   capas Leaflet ya existen (construidas al importar/restaurar,
   independientemente del panel), así que sus límites se leen
   directamente de rec._layer. Forzar la materialización de una carpeta
   entera solo para enfocarla sería mucho más caro que esto.           */
function extendBoundsFromRecords(bounds, records) {
  for (const rec of records) {
    if (rec.children) extendBoundsFromRecords(bounds, rec.children);
    else extendBounds(bounds, rec._layer);
  }
}
function subtreeBounds(li) {
  const bounds = L.latLngBounds([]);
  const walk = node => {
    const chk = node.querySelector(":scope > .node-row > input[type=checkbox]");
    if (chk) extendBounds(bounds, chk._layer);
    const ul = nodeUl(node);
    if (ul) for (const child of ul.children) walk(child);
    if (node._pending) extendBoundsFromRecords(bounds, node._pending);
  };
  walk(li);
  return bounds;
}

/* Colapsa todas las carpetas/archivos dentro de `root` y, si `root` es
   una carpeta, también ella: no debe quedar nada desplegado por debajo */
function collapseDescendants(root) {
  for (const li of root.querySelectorAll("li")) {
    if (nodeUl(li)) li.classList.add("collapsed");
  }
  if (root.tagName === "LI" && nodeUl(root)) root.classList.add("collapsed");
  syncAllExpanded();
  scheduleSave();
}

function ensureRootUl() {
  if (!rootUl || !rootUl.isConnected) {
    treeEl.innerHTML = "";
    rootUl = document.createElement("ul");
    rootUl.className = "node-list";
    rootUl.setAttribute("role", "group"); /* como el <ul> de cada carpeta: hijos de #tree, role=tree */
    treeEl.appendChild(rootUl);
  }
  return rootUl;
}
/* Dos textos para el mismo hueco del panel. «No hay capas cargadas» es
   una CONCLUSIÓN, y al arrancar todavía no se puede sacar: el árbol
   guardado está en IndexedDB y leerlo es asíncrono. Anunciarla mientras
   se restauraba era además contradecir a la barra de progreso, que a la
   vez decía «Restaurando capas…».                                     */
function showTreePlaceholder(txt) {
  treeEl.innerHTML = "";
  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = txt;
  treeEl.appendChild(div);
  rootUl = null;
}
function showEmptyMessage() { showTreePlaceholder("No hay capas cargadas."); }
function showLoadingMessage() { showTreePlaceholder("Inicializando…"); }
/* Se arranca en «Inicializando…»; es el arranque (99-boot.js) quien
   concluye, ya con el árbol guardado leído, si de verdad no hay nada. */
showLoadingMessage();

/* Mensajes informativos/de error del panel de navegación */
/* Avisos del panel. Los transitorios se van solos a los 6 s; los que el
   usuario TIENE que leer (resúmenes de importación con elementos
   omitidos) se quedan hasta que pulsa "Aceptar", porque si no, no da
   tiempo a leerlos. Se acumulan por líneas para que soltar varios
   archivos a la vez no haga que un aviso pise al anterior.           */
const MSG_TIMEOUT = 6000;
const MSG_MAX_LINES = 8;
/* Tope del registro de la sesión. Solo vive en memoria: no se guarda en
   IndexedDB, así que se pierde al cerrar la página.                   */
const MSG_LOG_MAX = 200;

/* Registro de la sesión: sobrevive a que la línea del panel se vaya a
   los MSG_TIMEOUT, que es lo que antes hacía imposible leer un aviso
   que pasó desapercibido. Entradas en orden cronológico, la más
   reciente al final, como las líneas de un fichero de log.           */
const msgLog = [];
let msgLogUnseen = 0; /* entradas desde la última apertura del registro */

/* "2026-09-08 13:02:11". Cuidado con el relleno de ceros: el proyecto ya
   tuvo ese fallo en otra marca de tiempo (pngTimestamp, ver
   tests/pngnametest.js). Se usa la hora LOCAL, que es la que el usuario
   reconoce como "cuándo pasó".                                       */
function msgStamp(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* El registro entero como texto plano, para el portapapeles. Mismo orden
   que en pantalla y marca completa en cada línea, para que lo pegado se
   parezca a un log de verdad y no dependa del contexto.              */
function logText() {
  if (!msgLog.length) return "";
  return msgLog.map(e => {
    const rep = e.count > 1 ? ` [x${e.count}, última ${msgStamp(e.last)}]` : "";
    return `${msgStamp(e.first)}\t${e.tone === "info" ? "INFO " : "AVISO"}\t${e.text}${rep}`;
  }).join("\n");
}

/* Pinta la marca de tiempo y el contador de una línea ya existente. En
   el panel se muestra la marca de la ÚLTIMA repetición: es una vista en
   vivo, y ahí "cuándo se produjo" significa cuándo ha vuelto a pasar.
   El detalle completo (primera y última) lo da el registro.          */
function paintMsgLine(line, entry) {
  line.querySelector(".nav-msg-time").textContent = msgStamp(entry.last);
  const count = line.querySelector(".nav-msg-count");
  count.textContent = entry.count > 1 ? `×${entry.count}` : "";
}

/* DOS tonos, no más: `info` es una NOTIFICACIÓN (algo salió bien o
   simplemente ha ocurrido: una descarga terminada, una selección, un
   dato recibido) y se pinta en el color normal del texto; `error` —el
   de por defecto, para que olvidarlo nunca calle una alerta— es una
   ALERTA (algo ha fallado, falta o no se puede hacer) y va en rojo.
   No hacen falta más niveles: el que exige lectura ya se distingue con
   `sticky`, que es ortogonal al tono.                                */
function navMessage(txt, { sticky = false, tone = "error" } = {}) {
  const el = document.getElementById("nav-msg");
  const now = Date.now();
  const key = `${tone} ${txt}`;

  /* Un aviso se FUNDE con una línea que siga visible y diga lo mismo, en
     vez de añadir otra: es lo que evita que una racha llene el panel.
     Se busca recorriendo las líneas (como mucho MSG_MAX_LINES) en vez de
     con un selector de atributo, que obligaría a escapar el texto.    */
  for (const old of el.querySelectorAll(".nav-msg-line")) {
    if (old._msgKey !== key) continue;
    old._logEntry.count++;
    old._logEntry.last = now;
    paintMsgLine(old, old._logEntry);
    /* Se reinicia el temporizador —mientras siga ocurriendo, la línea
       sigue a la vista— y NO se mueve de sitio: reordenar haría saltar
       el texto bajo el cursor.                                        */
    if (old._timer) {
      clearTimeout(old._timer);
      old._timer = setTimeout(() => old.remove(), MSG_TIMEOUT);
    }
    return;
  }

  const entry = { text: txt, tone, sticky, count: 1, first: now, last: now };
  msgLog.push(entry);
  if (msgLog.length > MSG_LOG_MAX) msgLog.shift();
  msgLogUnseen++;
  refreshLogButton();

  const line = document.createElement("p");
  line.className = `nav-msg-line ${tone}`;
  line._msgKey = key;
  line._logEntry = entry;
  const time = document.createElement("time");
  time.className = "nav-msg-time";
  const body = document.createElement("span");
  body.className = "nav-msg-text";
  body.textContent = txt;
  const count = document.createElement("span");
  count.className = "nav-msg-count";
  line.append(time, body, count);
  paintMsgLine(line, entry);
  el.insertBefore(line, el.querySelector(".nav-msg-ok"));

  /* Tope de líneas: se retiran las más antiguas que no exijan lectura */
  const lines = [...el.querySelectorAll(".nav-msg-line")];
  for (const old of lines.slice(0, Math.max(0, lines.length - MSG_MAX_LINES))) {
    if (!old.classList.contains("keep")) old.remove();
  }

  if (sticky) {
    line.classList.add("keep");
    if (!el.querySelector(".nav-msg-ok")) {
      const ok = document.createElement("button");
      ok.className = "btn nav-msg-ok";
      ok.textContent = "Aceptar";
      ok.addEventListener("click", clearNavMessage);
      el.appendChild(ok);
    }
  } else {
    line._timer = setTimeout(() => line.remove(), MSG_TIMEOUT);
  }
}

function clearNavMessage() {
  document.getElementById("nav-msg").textContent = "";
}

/* hwAccelerated se calculó antes de crear el mapa (para poder pasar
   zoomAnimation en sus opciones), pero el aviso no puede lanzarse hasta
   aquí: navMessage necesita MSG_MAX_LINES/MSG_TIMEOUT, declaradas más
   abajo en el script.                                                 */
if (!hwAccelerated) {
  navMessage(
    "No se detecta aceleración por hardware en el navegador. " +
    "Se aplica una mitigación automática (zoom sin animación), pero se recomienda " +
    "habilitar la aceleración por hardware en el navegador (chrome://gpu) para un mejor rendimiento.",
    { sticky: true }
  );
}

/* Centrar la vista en un nodo y acercar a un zoom de trabajo. A
   diferencia del doble click, no depende de dónde estuviera la vista ni
   de la escalera: siempre deja el nodo centrado y a la misma escala. */
const FOCUS_ZOOM = 9;
/* Margen relativo al tama\u00F1o del panel del visor (20% a cada lado), no
   una cifra fija de p\u00EDxeles: as\u00ED un pol\u00EDgono peque\u00F1o y uno grande, o el
   panel en una ventana estrecha y en una ancha, quedan igual de
   enmarcados sin tocar los bordes.                                    */
const FRAME_MARGIN_RATIO = 0.2;
function fitBoundsFramed(bounds) {
  const size = map.getSize();
  map.fitBounds(bounds, { padding: [size.x * FRAME_MARGIN_RATIO, size.y * FRAME_MARGIN_RATIO] });
}
/* Los nodos de pol\u00EDgono (styleKind "polygon": tambi\u00E9n las l\u00EDneas, que
   comparten estilo) no usan el zoom de trabajo fijo: se encuadran
   enteros con margen (fitBoundsFramed), la misma regla tanto si se
   llega por aqu\u00ED como por el doble click en la fila (m\u00E1s abajo) \u2014 para
   un pol\u00EDgono no hay escalera de zoom de tres pelda\u00F1os.               */
function focusOnNode(li) {
  const b = subtreeBounds(li);
  if (!b.isValid()) { navMessage("Esta capa no tiene geometr\u00EDa que enfocar."); return; }
  if (styleKind(li) === "polygon") fitBoundsFramed(b);
  else map.setView(b.getCenter(), FOCUS_ZOOM);
}

/* ---------- Escalera de zoom del doble click ----------
   Repetir el doble click sobre algo ya centrado va acercando por
   peldaños fijos y, al llegar al máximo, vuelve a empezar por abajo, de
   modo que el gesto es un ciclo y nunca deja al usuario atrapado en el
   zoom máximo.                                                        */
const ZOOM_STEPS = [5, 9];
const ZOOM_RESTART = 3;
/* Tope de la escalera: el último zoom con teselas reales. Más allá la
   imagen solo se amplía, y no es a donde el usuario quiere ir de un
   doble clic (para eso está la rueda).                              */
const ZOOM_LADDER_TOP = 19;

function nextZoomStep(current, maxZoom) {
  maxZoom = Math.min(maxZoom, ZOOM_LADDER_TOP);
  /* La escalera se arma en cada llamada porque el zoom máximo depende
     del mapa base activo; los duplicados se descartan               */
  const ladder = [...new Set([...ZOOM_STEPS.filter(z => z < maxZoom), maxZoom, ZOOM_RESTART])];
  const i = ladder.indexOf(current);
  return i < 0 ? ladder[0] : ladder[(i + 1) % ladder.length];
}

/* Centrado "a ojo": se compara en píxeles, no en grados, porque un mismo
   margen en grados significa distancias muy distintas según el zoom.   */
const CENTER_TOLERANCE_PX = 4;
function isCenteredOn(latlng) {
  const p = map.latLngToContainerPoint(latlng);
  const c = map.getSize().divideBy(2);
  return p.distanceTo(c) <= CENTER_TOLERANCE_PX;
}

/* Alta o baja de una capa en rootGroup, la fuente de verdad de qué se
   ve en el mapa. Compartida por applyVisibility (checkboxes reales) y
   cascadeVisibility (también sobre registros pendientes, que no tienen
   checkbox propio).                                                   */
function setLayerVisible(layer, checked) {
  if (!layer) return;
  if (checked) rootGroup.addLayer(layer);
  else rootGroup.removeLayer(layer);
}
/* Muestra u oculta en el visor la capa asociada a un checkbox */
function applyVisibility(chk) {
  setLayerVisible(chk._layer, chk.checked);
}

/* Interruptor masivo en cascada de una carpeta/archivo: activar o
   desactivar unas pocas capas es instantáneo, pero una carpeta con miles
   de descendientes bloqueaba el hilo entero en un solo tirón (a
   diferencia de la importación, que ya cede el hilo por lotes). Cede
   cada CASCADE_BATCH casillas con yieldFrame(), igual que el resto de
   bucles largos del archivo. El token de generación (`li._cascadeGen`)
   deja que una cascada obsoleta —el usuario volvió a pulsar la casilla
   antes de que terminara la anterior— deje de tocar checkboxes en
   cuanto una cascada más nueva sobre el MISMO nodo empieza: la nueva
   siempre es una pasada completa e idempotente sobre el estado actual,
   así que no hace falta fusionar resultados parciales. `li.isConnected`
   corta la cascada si la carpeta se borra mientras sigue en marcha,
   para no resucitar capas que deleteNode ya quitó de rootGroup.
   Recorre el DOM materializado de forma recursiva (no un
   querySelectorAll plano) precisamente para poder bajar también a
   li._pending en cada carpeta que lo tenga: una capa marcada dentro de
   una carpeta nunca desplegada sigue en el mapa (visibilidad y colapso
   son ejes independientes), así que la cascada tiene que alcanzarla
   igual, sin forzar su materialización solo para esto.                */
async function cascadeVisibility(li, checked) {
  const myGen = ++li._cascadeGen;
  const counter = { n: 0 };
  const yieldMaybe = async () => {
    if (++counter.n % CASCADE_BATCH !== 0) return true;
    await yieldFrame();
    return li._cascadeGen === myGen && li.isConnected;
  };
  const walkRecords = async records => {
    for (const rec of records) {
      rec.checked = checked;
      if (rec.children) { if (!(await walkRecords(rec.children))) return false; }
      else setLayerVisible(rec._layer, checked);
      if (!(await yieldMaybe())) return false;
    }
    return true;
  };
  const walkLi = async node => {
    const chk = node.querySelector(":scope > .node-row > input[type=checkbox]");
    if (chk) {
      chk.checked = checked;
      applyVisibility(chk);
      if (!(await yieldMaybe())) return false;
    }
    const ul = nodeUl(node);
    if (ul) for (const child of [...ul.children]) if (!(await walkLi(child))) return false;
    if (node._pending) return walkRecords(node._pending);
    return true;
  };
  if (await walkLi(li)) scheduleSave();
}

/* Trae una capa (de cualquier tipo) al frente de su propio pane/canvas,
   SIN desconectarla del mapa: no cierra popups abiertos en otras capas
   ni interrumpe un arrastre en curso, a diferencia de vaciar y
   reconstruir rootGroup. Los grupos (placemarks mixtos, mediciones,
   elevGrid) se resuelven recursivamente. bringToFront (L.Path) y
   L.DomUtil.toFront sobre getElement() (Marker/ImageOverlay) son API
   pública de Leaflet: no hay que reinventar el reordenado del DOM.    */
function bringLayerToFront(layer) {
  if (typeof layer.bringToFront === "function") { layer.bringToFront(); return; }
  if (typeof layer.eachLayer === "function") { layer.eachLayer(bringLayerToFront); return; }
  const el = typeof layer.getElement === "function" && layer.getElement();
  if (el) L.DomUtil.toFront(el);
}

/* Recorre el árbol en su orden actual y trae cada capa activada al
   frente, en ese orden: como bringToFront/toFront mandan al final de su
   propia cola, procesar de arriba abajo deja el orden final igual al
   orden del árbol. Es una resincronización completa e idempotente:
   segura de llamar tantas veces como haga falta. Entre TIPOS de capa
   distintos la pila queda fija por los panes nativos de Leaflet (un
   marcador siempre por encima de polígonos/líneas/ortofotos); dentro de
   cada tipo, el orden del árbol se respeta con exactitud.             */
function reorderPaintOrder() {
  for (const chk of treeEl.querySelectorAll("input[type=checkbox]")) {
    if (chk.checked && chk._layer) bringLayerToFront(chk._layer);
  }
}

/* Toda mutación del árbol ya llama a scheduleSave() (regla del proyecto),
   así que enganchar aquí da cobertura automática y completa —activar o
   desactivar con o sin cascada de carpeta, arrastrar para reordenar,
   cortar/pegar, ordenar, soltar en mitad del árbol...— sin tener que
   tocar cada sitio por separado. requestAnimationFrame agrupa ráfagas:
   activar una carpeta con miles de descendientes dispara miles de
   llamadas, pero reorderPaintOrder corre una sola vez, en el siguiente
   frame.                                                              */
let reorderPending = false;
function scheduleReorder() {
  if (reorderPending) return;
  reorderPending = true;
  requestAnimationFrame(() => { reorderPending = false; reorderPaintOrder(); });
}

