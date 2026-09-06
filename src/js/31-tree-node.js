/* ---------- Fábrica de nodos del árbol ----------
   Crea la fila completa (caret, checkbox, color, etiqueta y acciones
   de renombrar / subir / bajar / borrar) para cualquier tipo de nodo:
   archivo, carpeta, capa (placemark / feature) o medición.            */
function makeNode({ name, layer = null, isFolder = false, isFile = false,
                    style = null, checked = true, desc = null,
                    onDelete = null, onRename = null,
                    styleable = layer !== null }) {
  const li = document.createElement("li");
  if (isFile) li.className = "file";
  li._name = name;
  li._isContainer = isFolder || isFile; /* evita un querySelector redundante en serializeNode */
  li._cascadeGen = 0; /* ver cascadeVisibility */
  /* La ficha se asigna AQUÍ, antes de crear los botones: al hacerlo
     después, `makeActions` no la veía y el botón ℹ nunca aparecía.  */
  li._desc = desc;
  li._style = style;
  li._onDelete = onDelete;
  li._onRename = onRename;

  const row = document.createElement("div");
  row.className = "node-row" + (isFolder ? " folder" : "");
  /* Semántica de árbol: cada nodo es un treeitem con su estado */
  li.setAttribute("role", "treeitem");
  li.setAttribute("aria-selected", "false");
  li.setAttribute("aria-label", name);
  /* #tree tiene un único tabindex (patrón de foco único de la guía ARIA
     para un tree): la fila "actual" no recibe el foco del DOM, así que
     hace falta un id estable para que aria-activedescendant (ver
     setSelCursor) pueda señalarla.                                    */
  li.id = "node-" + (++nodeSeq);

  if (isFolder || isFile) {
    row.appendChild(makeCaret(li));
  } else {
    const spacer = document.createElement("span");
    spacer.className = "caret-spacer";
    row.appendChild(spacer);
  }

  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.id = "chk-" + (++nodeSeq);
  chk.checked = checked;
  chk._layer = layer; /* null en carpetas y archivos */
  /* Sin `for` en el <label> (ver más abajo), la casilla se queda sin
     nombre accesible: aria-label la compensa. startRename la mantiene al
     día si el nodo se renombra.                                        */
  chk.setAttribute("aria-label", `Activar o desactivar «${name}»`);
  chk.addEventListener("change", () => {
    const ul = li.querySelector(":scope > ul.node-list");
    if (ul) {
      /* Carpeta / archivo: interruptor masivo en cascada, por lotes
         (ver cascadeVisibility) para no bloquear con miles de capas */
      cascadeVisibility(li, chk.checked);
    } else {
      applyVisibility(chk);
      scheduleSave();
    }
  });
  row.appendChild(chk);

  if (style) {
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = style.fillColor || style.color;
    row.appendChild(swatch);
  }

  const label = document.createElement("label");
  /* El nombre NO activa la casilla: pinchar en él selecciona la fila, y
     un doble click acabaría alternando la visibilidad a medias (ese era
     el "se desmarca" al hacer doble click). La casilla se pulsa aparte,
     y el espacio hace lo mismo desde el teclado.                      */
  label.textContent = name;
  label.title = name;
  row.appendChild(label);

  row.appendChild(makeActions(li, isFolder || isFile, styleable, layer));

  /* Shift+click toggles multi-selection without touching the checkbox.
     Only same-kind nodes can be selected together (marker layers with
     marker layers, polygon layers with polygon layers…): picking a node
     of a different kind drops the previous selection.                  */
  /* Ratón, como en un gestor de archivos: Shift+click extiende el rango
     desde el ancla; Ctrl+Shift+click marca solo ese nodo sin arrastrar
     los intermedios. Sin modificadores no se toca la selección, para no
     estorbar a los clicks normales sobre casilla, color o botones.    */
  row.addEventListener("click", e => {
    /* Los botones de la fila actúan sobre la selección existente: no
       deben cambiarla al pulsarlos                                   */
    if (e.target.closest(".actions")) return;
    if (e.shiftKey) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) toggleOne(li);
      else selectRange(li);
      return;
    }
    /* Click normal: el cursor se va DONDE se ha pulsado y ese pasa a
       ser el único nodo seleccionado, como en cualquier árbol         */
    moveCursorTo(li, false);
  });
  /* Doble click: llevar la vista a las capas del nodo. El primero solo
     desplaza, sin tocar el zoom (la vista es del usuario). Si ya está
     centrada, los siguientes van subiendo por la escalera de zoom —
     salvo en un nodo de polígono/línea, que no tiene escalera: siempre
     se encuadra entero con margen (ver focusOnNode/fitBoundsFramed).
     Sobre el checkbox NO debe dispararse: una sucesión rápida de
     activar/desactivar no es un gesto de "ir a esta capa".            */
  row.addEventListener("dblclick", e => {
    if (e.target === chk) return;
    const b = subtreeBounds(li);
    if (!b.isValid()) return;
    /* Un nodo de polígono no sigue la escalera: se encuadra entero con
       margen, igual que la lupa (focusOnNode), sin depender de si la
       vista ya estaba centrada.                                       */
    if (styleKind(li) === "polygon") { fitBoundsFramed(b); return; }
    const target = b.getCenter();
    if (isCenteredOn(target)) map.setView(target, nextZoomStep(map.getZoom(), map.getMaxZoom()));
    else map.panTo(target);
  });

  li._row = row; /* referencia directa: evita consultar el DOM por nodo */
  li.appendChild(row);

  if (isFolder || isFile) {
    const ul = document.createElement("ul");
    ul.className = "node-list";
    ul.setAttribute("role", "group"); /* los hijos de un treeitem */
    li.appendChild(ul);
  }

  wireDrag(li, row);

  /* Click en la capa dentro del visor → resaltarla en la navegación.
     Al pasar el ratón, el panel de información (Ficha KML o properties
     de GeoJSON) se muestra sin robar el foco; showLayerInfo es un no-op
     silencioso si la capa no tiene nada que enseñar. Estos son los
     listeners DEFINITIVOS: una capa "layer" marcada dentro de una
     carpeta nunca desplegada ya tiene, desde que se construyó su
     registro, un par de listeners de espera (wirePendingLayerEvents)
     que resuelven y materializan bajo demanda al primer clic/hover; al
     llegar aquí (materializeRecords) esos se retiran para que solo
     queden estos. Sigue habiendo un hueco menor y aceptado para
     mediciones/elevaciones/ortofotos pendientes (mismo patrón, no
     enganchado por ser casos raros).                                  */
  if (layer) {
    layer._li = li; /* back-reference used by the context menu's hit-testing */
    /* While drawing a polygon, a click inside another layer must fix a
       vertex there, not highlight that layer in the tree               */
    layer.on("click", () => { if (activeTool !== "polygon") highlightNode(li); });
    layer.on("mouseover", () => showLayerInfo(li, { focus: false }));
    layer.on("mouseout", scheduleLayerInfoHide);
  }

  return li;
}

const nodeUl = li => li.querySelector(":scope > ul.node-list");

/* aria-expanded refleja el colapso; se llama tras cualquier cambio */
function syncExpanded(li) {
  if (nodeUl(li)) li.setAttribute("aria-expanded", String(!li.classList.contains("collapsed")));
}
const syncAllExpanded = () => {
  for (const li of treeEl.querySelectorAll("li[role=treeitem]")) syncExpanded(li);
};

/* Construye las filas reales de una carpeta pendiente (li._pending) la
   primera vez que se despliega. Reutiliza materializeRecords, la misma
   función que ya construye el DOM al importar/restaurar: para ella
   "estos registros van aquí dentro" es el mismo trabajo sea cual sea su
   origen. `li._materializing` evita una segunda pasada si algo dispara
   la materialización dos veces antes de que termine la primera (por
   ejemplo, el buscador y un clic casi a la vez); `li._pending` se limpia
   ANTES de empezar, así que una llamada reentrante ve `_materializing`
   en vez de arrancar otra pasada sobre los mismos registros.           */
async function ensureMaterialized(li) {
  if (!li._pending) return;
  if (li._materializing) return li._materializing;
  const records = li._pending;
  li._pending = null;
  li._materializing = materializeRecords(records, nodeUl(li))
    .finally(() => { li._materializing = null; });
  return li._materializing;
}

/* Flecha que colapsa/expande el nodo */
function makeCaret(li) {
  const caret = document.createElement("span");
  caret.className = "caret";
  caret.textContent = "\u25BE";
  caret.title = "Colapsar / desplegar";
  caret.addEventListener("click", () => {
    const collapsing = !li.classList.contains("collapsed");
    li.classList.toggle("collapsed");
    syncExpanded(li);
    scheduleSave();
    if (!collapsing) ensureMaterialized(li); /* desplegar: construye el DOM diferido, por lotes */
  });
  return caret;
}

/* Row action buttons: sort/collapse (containers), layer styles (layers),
   rename, move up/down and delete */
function makeActions(li, sortable, styleable, layer) {
  const box = document.createElement("span");
  box.className = "actions";
  const btn = (glyph, title, cls, fn) => {
    const b = document.createElement("button");
    b.textContent = glyph;
    b.title = title;
    b.setAttribute("aria-label", title); /* botones solo con icono */
    if (cls) b.className = cls;
    b.addEventListener("click", e => { e.preventDefault(); fn(); });
    box.appendChild(b);
  };
  if (sortable) {
    btn("\u2611", "Seleccionar todas las capas de esta carpeta", "", () => selectFolderLayers(li));
    btn("\u2610", "Quitar la selecci\u00F3n (igual que Escape)", "", () => clearSelection());
    btn("AZ", "Ordenar alfab\u00E9ticamente (alterna ascendente/descendente)", "az",
        () => withUndo(`ordenar \u00AB${li._name}\u00BB`, () => sortChildren(li)));
    btn("\u229F", "Colapsar esta carpeta y las interiores", "", () => collapseDescendants(li));
    btn("\uD83D\uDCBE", "Guardar esta carpeta en un archivo para volver a cargarla despu\u00E9s", "", () => exportNode(li));
  }
  if (styleable) {
    btn("\uD83D\uDD0D", `Centrar la vista aqu\u00ED y acercar (zoom ${FOCUS_ZOOM})`, "",
        () => focusOnNode(li));
    btn("\uD83C\uDFA8", "Estilos de la capa", "", () => openStyleDialog(li));
  }
  if (li._desc || layerProperties(layer)) {
    btn("\u2139", "Ver informaci\u00F3n de la capa", "", () => showLayerInfo(li));
  }
  btn("\u2191", "Subir", "", () => {
    const prev = li.previousElementSibling;
    if (prev) { li.parentElement.insertBefore(li, prev); scheduleSave(); }
  });
  btn("\u2193", "Bajar", "", () => {
    const next = li.nextElementSibling;
    if (next) { li.parentElement.insertBefore(next, li); scheduleSave(); }
  });
  btn("\u00D7", "Borrar", "delete", () => {
    pushUndo(`borrar \u00AB${li._name}\u00BB`);
    /* si el nodo forma parte de la selección, se borra toda la selección */
    if (selection.has(li) && selection.size > 1) {
      const items = topLevelSelection();
      const next = cursorAfterDelete(isRow(selCursor) ? selCursor : items[0], items);
      for (const s of items) deleteNode(s, { pruneSelection: false });
      clearSelection();
      if (next) selectNode(next, true);
    } else {
      /* El cursor no desaparece: se mueve a la fila que ocupe el hueco,
         como en cualquier gestor de archivos.                        */
      const next = cursorAfterDelete(li, [li]);
      deleteNode(li);
      if (next) selectNode(next, true);
    }
  });
  return box;
}

/* Ordena alfabéticamente los hijos directos de una carpeta o archivo.
   Pulsaciones sucesivas alternan ascendente ↔ descendente. Solo hace
   falta materializar el nivel directo (ensureMaterialized), no la rama
   entera: ordenar no toca nietos.                                     */
async function sortChildren(li) {
  await ensureMaterialized(li);
  const ul = nodeUl(li);
  if (!ul) return;
  const dir = (li._sortAsc = li._sortAsc !== true) ? 1 : -1;
  [...ul.children]
    .filter(c => c._name !== undefined) /* ignora filas de mensaje */
    .sort((a, b) => dir * a._name.localeCompare(b._name, "es", { numeric: true, sensitivity: "base" }))
    .forEach(c => ul.appendChild(c));
  scheduleSave();
}

/* La geometría cacheada deja de valer: se recalculará al guardar */
const invalidateGeo = li => { if (li) li._geo = null; };

/* Rename a node from code: updates the label, the marker text and storage */
function setNodeName(li, name) {
  name = String(name).trim();
  if (!name || name === li._name) return;
  li._name = name;
  const label = li.querySelector(":scope > .node-row > label");
  if (label) { label.textContent = name; label.title = name; }
  const chk = li.querySelector(":scope > .node-row > input[type=checkbox]");
  if (chk) chk.setAttribute("aria-label", `Activar o desactivar «${name}»`);
  if (li._onRename) li._onRename(name);
  if (li._mstyle) applyMarkerText(li); /* the marker text shows the name */
  scheduleSave();
}

/* Renombrado en línea: la etiqueta se sustituye por un input */
function startRename(li) {
  const label = li.querySelector(":scope > .node-row > label");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rename-input";
  input.value = li._name;
  label.replaceWith(input);
  input.focus();
  input.select();
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { input.value = li._name; input.blur(); }
  });
  input.addEventListener("blur", () => {
    const v = input.value.trim() || li._name;
    label.textContent = li._name;
    label.title = li._name;
    input.replaceWith(label);
    setNodeName(li, v);
  });
}

/* Borra un nodo: retira del visor todas las capas de su subárbol */
/* pruneSelection:false lo usan los borrados en lote (× con selección
   múltiple, Supr): purgar la MISMA selection una vez por nodo borrado
   es O(k²); como esos sitios borran la selección entera, basta
   limpiarla una sola vez con clearSelection() al final del lote.     */
/* Recorre registros pendientes quitando sus capas de rootGroup: una capa
   marcada dentro de una carpeta nunca desplegada sigue en el mapa (la
   visibilidad no depende del panel), así que borrar esa carpeta sin
   esto la dejaría huérfana ahí para siempre, inalcanzable ya desde
   ningún checkbox.                                                    */
function removeRecordsFromMap(records) {
  for (const rec of records) {
    if (rec.children) { removeRecordsFromMap(rec.children); continue; }
    if (rec._layer) rootGroup.removeLayer(rec._layer);
    if (rec.t === "elevGrid") { /* mismo onDelete que materializeRecords le habría dado */
      const i = elevGridGroups.indexOf(rec._layer);
      if (i >= 0) elevGridGroups.splice(i, 1);
    }
  }
}
/* Gemela recursiva del barrido anterior para lo YA materializado: cada
   <li> de la rama (incluida la raíz) más, si alguna carpeta de camino
   sigue pendiente, sus registros.                                     */
function removeSubtreeFromMap(li) {
  const chk = li.querySelector(":scope > .node-row > input[type=checkbox]");
  if (chk && chk._layer) rootGroup.removeLayer(chk._layer);
  const ul = nodeUl(li);
  if (ul) for (const child of ul.children) removeSubtreeFromMap(child);
  if (li._pending) removeRecordsFromMap(li._pending);
}
function deleteNode(li, { pruneSelection = true } = {}) {
  if (pruneSelection) {
    for (const s of [...selection]) {
      if (s === li || li.contains(s)) selection.delete(s);
    }
  }
  removeSubtreeFromMap(li);
  li.remove();
  if (li._onDelete) li._onDelete();
  scheduleSave();
  if (rootUl && !rootUl.children.length) showEmptyMessage();
}

/* Resalta un nodo en la navegación desplegando sus ancestros */
function highlightNode(li) {
  for (let p = li.parentElement; p && p !== treeEl; p = p.parentElement) {
    if (p.tagName === "LI") p.classList.remove("collapsed");
  }
  clearSelection();
  selectNode(li, true);
  nodeRow(li).scrollIntoView({ block: "nearest" });
}

/* ---------- Reordenación arrastrando dentro de la navegación ----------
   Arrastrar una fila sobre otra la coloca antes/después según la mitad
   de la fila; sobre el centro de una carpeta/archivo, la mete dentro.   */
function wireDrag(li, row) {
  li.draggable = true;
  li.addEventListener("dragstart", e => {
    e.stopPropagation();
    /* arrastrar un nodo seleccionado arrastra toda la selección;
       arrastrar uno no seleccionado la descarta y lo lleva solo   */
    if (selection.has(li)) dragItems = topLevelSelection();
    else { clearSelection(); dragItems = [li]; }
    dragLi = li;
    e.dataTransfer.effectAllowed = "move";
  });
  li.addEventListener("dragend", () => { dragLi = null; dragItems = null; clearDropMarks(); });

  row.addEventListener("dragover", e => {
    if (!validDrop(li)) return;
    e.preventDefault();
    e.stopPropagation();
    markDrop(row, dropZone(row, li, e.clientY));
  });
  row.addEventListener("dragleave", () => { if (dropMarked === row) clearDropMarks(); });
  row.addEventListener("drop", async e => {
    if (!validDrop(li)) return;
    e.preventDefault();
    e.stopPropagation();
    pushUndo("mover nodos");
    /* Capturados ANTES del await: dragend puede llegar y limpiar
       dragItems/dragLi mientras esperamos a ensureMaterialized (el
       navegador no espera a un `drop` async antes de disparar
       dragend), así que la variable compartida ya no sería fiable
       después.                                                        */
    const items = dragItems;
    const zone = dropZone(row, li, e.clientY);
    if (zone === "drop-into") {
      /* Si la carpeta destino sigue pendiente, materializarla primero:
         soltar directamente en su <ul> (vacío a propósito) dejaría su
         contenido real escondido para siempre detrás de lo soltado, sin
         que quitar la clase "collapsed" lo trajera de vuelta.          */
      await ensureMaterialized(li);
      const ul = nodeUl(li);
      for (const item of items) ul.appendChild(item);
      li.classList.remove("collapsed");
    } else {
      /* insertar todos manteniendo su orden relativo */
      const ref = zone === "drop-before" ? li : li.nextSibling;
      for (const item of items) li.parentElement.insertBefore(item, ref);
    }
    clearDropMarks();
    dragLi = null;
    dragItems = null;
    scheduleSave();
  });
}
function validDrop(li) {
  return dragItems && dragItems.every(item => item !== li && !item.contains(li));
}
function dropZone(row, li, clientY) {
  const r = row.getBoundingClientRect();
  const y = clientY - r.top;
  /* Franjas en PÍXELES: con un porcentaje, en filas de 24 px el borde
     útil quedaba en 4 px y era imposible acertar. Seis píxeles arriba y
     abajo reordenan; el resto de una carpeta mete dentro.            */
  const edge = Math.min(6, r.height / 3);
  if (y < edge) return "drop-before";
  if (y > r.height - edge) return "drop-after";
  return nodeUl(li) ? "drop-into" : (y < r.height / 2 ? "drop-before" : "drop-after");
}
/* La marca de destino la lleva UNA fila cada vez. Barrer el árbol entero
   en cada `dragover` —que se dispara decenas de veces por segundo—
   hacía que arrastrar fuera a tirones en árboles grandes.            */
let dropMarked = null;
function clearDropMarks() {
  if (!dropMarked) return;
  dropMarked.classList.remove("drop-before", "drop-after", "drop-into");
  dropMarked = null;
}
function markDrop(row, zone) {
  if (dropMarked === row && row.classList.contains(zone)) return;
  clearDropMarks();
  row.classList.add(zone);
  dropMarked = row;
}

/* ================= Construcción del árbol desde KML / GeoJSON =================
   Los constructores son asíncronos: con archivos grandes procesan las capas
   por lotes, cediendo el hilo entre lote y lote (la interfaz no se congela)
   y notificando el avance a la barra de progreso vía `prog`.                */

/* Cede el hilo y deja que el navegador pinte un frame */
const yieldFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

const PROGRESS_BATCH = 150; /* capas construidas entre cesiones del hilo */
const CASCADE_BATCH = 300; /* casillas conmutadas entre cesiones del hilo en
                               una cascada de visibilidad: cada iteración es
                               más barata que construir una fila (solo un
                               addLayer/removeLayer), de ahí un lote mayor
                               que PROGRESS_BATCH en vez de reutilizarla    */

/* ---------- Informe de importación ----------
   Errors are isolated per entity: a broken placemark or feature is
   skipped, counted and described, and the rest of the file still loads.
   At the end the user gets a summary instead of a silent half-import.  */
const MAX_REPORT_DETAIL = 3; /* distinct causes quoted in the summary */

function makeImportReport(fileName) {
  return {
    file: fileName,
    loaded: 0,
    skipped: 0,
    causes: new Map(),
    kinds: new Set(),
    notes: [],
    /* Una entidad que no ha entrado */
    warn(why) {
      this.skipped++;
      this.causes.set(why, (this.causes.get(why) || 0) + 1);
    },
    /* Una advertencia que no cuesta ningún elemento (compatibilidad) */
    note(txt) { this.notes.push(txt); },
    /* Hay algo que el usuario debe leer antes de que el aviso se vaya */
    get hasIssues() { return this.skipped > 0 || this.notes.length > 0; },
    /* Human summary: what came in, what did not and why */
    summary() {
      const top = [...this.causes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_REPORT_DETAIL)
        .map(([why, n]) => `${why} (\u00D7${n})`);
      const parts = [`\u00AB${this.file}\u00BB: ${this.loaded} elemento(s) cargado(s)`];
      if (this.kinds.size) parts.push(`tipos: ${[...this.kinds].join(", ")}`);
      if (this.skipped) parts.push(`${this.skipped} omitido(s)`);
      if (top.length) parts.push(`causas: ${top.join(", ")}`);
      if (this.causes.size > MAX_REPORT_DETAIL) {
        parts.push(`y ${this.causes.size - MAX_REPORT_DETAIL} causa(s) m\u00E1s`);
      }
      for (const n of this.notes) parts.push(n);
      return parts.join("; ") + ".";
    }
  };
}

/* Recorre Document/Folder y devuelve REGISTROS (la misma forma que
   serializeNode produce), nunca filas del panel: construir la capa
   Leaflet de cada Placemark/GroundOverlay y decidir su alta en
   rootGroup es trabajo independiente de si esa fila llega a existir en
   el DOM del panel — ver materializeRecords, que es quien decide cuánto
   materializar y cuándo (todo de una carpeta abierta, solo el registro
   `_pending` de una colapsada). Un registro de carpeta lleva su propio
   `checked` calculado aquí mismo, bottom-up (marcada solo si algún
   descendiente lo está): sustituye al antiguo recorrido posterior
   `syncSubtree`, que necesitaba DOM real para funcionar y ya no lo hay
   disponible para una carpeta que empieza colapsada.                   */
async function buildKmlRecords(el, styleIndex, inheritedVisible, prog, report, zip = null) {
  const out = [];
  for (const child of el.children) {
    /* El prefijo es irrelevante: <kml:Folder> también es un Folder */
    const tag = bareName(child);
    if (tag === "Folder" || tag === "Document") {
      const visible = inheritedVisible && ownVisibility(child);
      /* <open>: solo desplegada si es 1 (0 o ausente → colapsada) */
      const collapsed = directChildText(child, "open") !== "1";
      const children = await buildKmlRecords(child, styleIndex, visible, prog, report, zip);
      out.push({ t: "folder", name: text(child, "name") || "Carpeta",
                 checked: children.some(c => c.checked), collapsed, children });
    } else if (tag === "Placemark") {
      const name = text(child, "name") || "Placemark";
      try {
        const style = placemarkStyle(child, styleIndex);
        const { group: layer, reported } = buildPlacemarkLayer(child, style, report);
        if (!layer) {
          /* Ya se cont\u00F3 arriba con una causa concreta (p. ej. "punto sin
             coordenadas v\u00E1lidas"); solo hace falta este gen\u00E9rico cuando
             el placemark no ten\u00EDa ninguna geometr\u00EDa que intentar.      */
          if (!reported && report) report.warn(`\u00AB${name}\u00BB sin geometr\u00EDa utilizable`);
          continue;
        }
        const visible = inheritedVisible && ownVisibility(child);
        if (visible) layer.addTo(rootGroup);
        /* La ficha del placemark suele traer una tabla con los datos
           reales del elemento; se guarda para poder consultarla       */
        const rec = { t: "layer", name, checked: visible, style,
                       desc: text(child, "description") || null, _layer: layer };
        wirePendingLayerEvents(rec);
        out.push(rec);
        if (report) { report.loaded++; report.kinds.add(layerKind(layer) || "?"); }
      } catch (err) {
        /* One bad entity must never abort the whole import */
        if (report) report.warn(`\u00AB${name}\u00BB: ${err.message}`);
      }
      if (prog && ++prog.done % PROGRESS_BATCH === 0) {
        prog.update(prog.done);
        await yieldFrame();
      }
    } else if (tag === "GroundOverlay") {
      const name = text(child, "name") || "Ortofoto";
      try {
        const overlay = await buildGroundOverlay(child, zip, report, name);
        if (overlay) {
          const visible = inheritedVisible && ownVisibility(child);
          if (visible) overlay.layer.addTo(rootGroup);
          out.push({ t: "imageOverlay", name, checked: visible,
                     box: overlay.box, dataUrl: overlay.dataUrl, opacity: 1, _layer: overlay.layer });
          if (report) { report.loaded++; report.kinds.add("imageOverlay"); }
        }
      } catch (err) {
        /* One bad entity must never abort the whole import */
        if (report) report.warn(`«${name}»: ${err.message}`);
      }
      if (prog && ++prog.done % PROGRESS_BATCH === 0) {
        prog.update(prog.done);
        await yieldFrame();
      }
    }
  }
  return out;
}

/* Estilo simplestyle-spec (mapbox) para features GeoJSON */
function geojsonStyle(props) {
  const style = { color: "#3388ff", weight: 2, fillOpacity: 0.35 };
  if (props["stroke"]) style.color = props["stroke"];
  if (props["stroke-width"] != null) {
    style.weight = Number(props["stroke-width"]);
    /* Ancho 0: un lineWidth de canvas a 0 sigue dibujando (la especificación
       ignora el valor y conserva el anterior), así que hace falta
       stroke:false, igual que con un <width>0</width> de KML. */
    if (style.weight === 0) style.stroke = false;
  }
  /* Su opacidad se ignora (el contorno es siempre 100% opaco), pero 0 es
     la señal de "sin contorno", igual que <outline>0</outline> en KML. */
  if (Number(props["stroke-opacity"]) === 0) style.stroke = false;
  if (props["fill"]) style.fillColor = props["fill"];
  if (props["fill-opacity"] != null) {
    style.fillOpacity = Number(props["fill-opacity"]);
    if (style.fillOpacity === 0) style.fill = false;
  }
  return style;
}

