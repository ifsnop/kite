/* ================= Filtro del árbol (buscador del panel) =================
   Teclear en el buscador deja en el árbol SOLO lo que coincide con lo
   escrito (sin mayúsculas ni tildes, dentro de las palabras) y los
   ancestros que lo llevan. Ver tree-navigation-selection.md.

   Lo caro era llegar a una coincidencia dentro de una carpeta sin desplegar:
   sus capas son datos (`li._pending`) y construirlas todas costaba 6,9 s con
   20 000. Aquí solo se construyen las que coinciden (materializeMatching,
   31-tree-node.js: 5 ms con 38 coincidencias, 84 ms con 1 000) y, si son más
   de FILTER_BUILD_MAX, ninguna: la carpeta sale cerrada con «(n)» y se
   construyen al desplegarla. Encontrarlas es solo recorrer nombres (5 ms
   con 20 000).

   Lo que el filtro NUNCA toca: `collapsed` (las carpetas se ven abiertas con
   la clase `filter-open`, que lo anula en el CSS), las casillas ni las capas
   del mapa. Lo oculto es `li.hidden`, y `isRow` (30-tree-walk.js) lo salta,
   con lo que el teclado, los rangos y Ctrl+A no aterrizan en una fila que no
   se ve. Nada de esto se serializa.                                       */
const FILTER_BUILD_MAX = 300;
let treeFilter = null;           /* { raw, term } mientras hay un filtro puesto */
let filterGen = 0;               /* una pasada en vuelo se abandona si llega otra */
let filterApplying = false;
let filterWanted = new WeakMap(); /* caché de UNA pasada: ¿este registro, o algo de dentro, coincide? */
let refilterTimer = null;
const treeFilterEmpty = document.getElementById("tree-filter-empty");

/* ¿Este registro, o algún descendiente, coincide? Es lo que se construye. */
function recWanted(rec) {
  let w = filterWanted.get(rec);
  if (w === undefined) {
    w = recKey(rec).includes(treeFilter.term) || (!!rec.children && rec.children.some(recWanted));
    filterWanted.set(rec, w);
  }
  return w;
}

/* Cuántos registros (a cualquier profundidad) coinciden, sin crear arrays */
function countMatches(records, term) {
  let n = 0;
  for (const r of records) {
    if (recKey(r).includes(term)) n++;
    if (r.children) n += countMatches(r.children, term);
  }
  return n;
}

/* Las carpetas con registros pendientes, en el orden del documento */
function collectPending(ul, out) {
  for (const li of ul.children) {
    if (li._name === undefined) continue;
    if (li._pending) out.push(li);
    const cul = li._isContainer ? nodeUl(li) : null;
    if (cul) collectPending(cul, out);
  }
  return out;
}

const setHidden = (li, hide) => { if (li.hidden !== hide) li.hidden = hide; };

/* El «(n)» de una carpeta con coincidencias aún sin construir */
function setBadge(li, n) {
  let b = li._fbadge;
  if (n > 0) {
    if (!b) {
      b = li._fbadge = document.createElement("span");
      b.className = "filter-count";
      const label = nodeRow(li).querySelector(":scope > label");
      if (label) label.after(b); else nodeRow(li).appendChild(b);
    }
    const txt = `(${n})`;
    if (b.textContent !== txt) b.textContent = txt;
  } else if (b) {
    b.remove();
    li._fbadge = null;
  }
}

/* Una pasada sobre las filas que hay: oculta lo que no coincide, abre (solo a
   la vista) lo que lleva coincidencias dentro y cuenta. Devuelve si algo se
   queda a la vista. Solo escribe donde algo cambia: con 20 000 filas
   construidas, ocultarlas todas medía 134 ms.                           */
function filterPass(ul, term, st) {
  let any = false;
  for (const li of ul.children) {
    if (li._name === undefined) { setHidden(li, true); continue; } /* filas de mensaje */
    const self = rowKey(li).includes(term);
    if (self) st.matches++;
    const cul = li._isContainer ? nodeUl(li) : null;
    const kids = cul ? filterPass(cul, term, st) : false;
    const pend = li._pending ? countMatches(li._pending, term) : 0;
    st.matches += pend;
    const visible = self || kids || pend > 0;
    setHidden(li, !visible);
    setFilterOpen(li, visible && kids && !filterClosed.has(li));
    setBadge(li, pend);
    if (visible) any = true;
  }
  return any;
}

/* Lo oculto no puede quedarse seleccionado: Supr, cortar o arrastrar
   actuarían sobre filas que el usuario no ve. */
function dropHiddenSelection() {
  const hidden = li => li.hidden || !!(li.parentElement && li.parentElement.closest("li[hidden]"));
  for (const li of [...selection]) if (hidden(li)) setSelected(li, false);
  if (selAnchor && hidden(selAnchor)) selAnchor = null;
  if (selCursor && hidden(selCursor)) setSelCursor(null);
}

/* Lo que nazca con el filtro puesto (importar, pegar, un pin, deshacer,
   renombrar) se filtra solo: un único observador, sin enganchar cada sitio
   que crea filas. Ignora lo que el propio filtro escribe (las insignias).  */
const treeObserver = new MutationObserver(muts => {
  if (!treeFilter || filterApplying) return;
  const own = n => n.nodeType === 1 && n.classList.contains("filter-count");
  const foreign = muts.some(m => !(m.target.classList && m.target.classList.contains("filter-count"))
    && ![...m.addedNodes, ...m.removedNodes].every(own));
  if (!foreign) return;
  clearTimeout(refilterTimer);
  refilterTimer = setTimeout(() => { if (treeFilter) applyTreeFilter(treeFilter.raw); }, 120);
});

async function applyTreeFilter(raw) {
  const term = normSearch(raw.trim());
  if (!term) return clearTreeFilter();
  const gen = ++filterGen;
  treeFilter = { raw: raw.trim(), term };
  treeFilterWanted = recWanted;
  filterWanted = new WeakMap();
  filterApplying = true;
  try {
    if (rootUl && rootUl.isConnected) {
      /* Coincidencias dentro de carpetas sin desplegar: se cuentan sin
         construir y, si caben en el tope, se construyen SOLO ellas */
      const pend = collectPending(rootUl, []);
      const counts = pend.map(li => countMatches(li._pending, term));
      const total = counts.reduce((a, b) => a + b, 0);
      if (total > 0 && total <= FILTER_BUILD_MAX) {
        for (let i = 0; i < pend.length; i++) {
          if (!counts[i]) continue;
          await materializeMatching(pend[i], recWanted);
          if (gen !== filterGen) return;
        }
      }
    }
    if (gen !== filterGen) return;
    const st = { matches: 0 };
    const any = rootUl && rootUl.isConnected ? filterPass(rootUl, term, st) : false;
    dropHiddenSelection();
    searchCount.textContent = String(st.matches);
    treeFilterEmpty.hidden = any;
    if (!any) treeFilterEmpty.textContent = tr("Ninguna coincidencia con «{term}»", { term: treeFilter.raw });
    treeObserver.observe(treeEl, { childList: true, subtree: true });
  } finally {
    if (gen === filterGen) { treeObserver.takeRecords(); filterApplying = false; }
  }
}

/* Quita el filtro y devuelve el árbol tal cual estaba. Las filas construidas
   se quedan; una carpeta ABIERTA que quedó a medio construir se completa
   (una abierta con solo parte de sus hijas sería un árbol incorrecto) y una
   cerrada se completa al desplegarla.                                    */
async function clearTreeFilter() {
  const had = !!treeFilter;
  filterGen++;
  clearTimeout(refilterTimer);
  treeFilter = null;
  treeFilterWanted = null;
  filterApplying = false;
  filterClosed.clear();
  treeObserver.disconnect();
  for (const li of treeEl.querySelectorAll("li[hidden]")) li.hidden = false;
  for (const li of treeEl.querySelectorAll("li.filter-open")) setFilterOpen(li, false);
  for (const b of treeEl.querySelectorAll(".filter-count")) {
    const li = b.closest("li");
    if (li) li._fbadge = null;
    b.remove();
  }
  treeFilterEmpty.hidden = true;
  treeFilterEmpty.textContent = "";
  if (!had) return;
  for (const li of [...partialFolders]) {
    if (!li.isConnected) { partialFolders.delete(li); continue; }
    if (!li.classList.contains("collapsed")) await ensureMaterialized(li);
  }
}
