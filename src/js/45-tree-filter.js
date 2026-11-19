/* ================= Tree filter (the panel's search box) =================
   Typing in the box leaves in the tree ONLY what matches (no case, no
   accents, inside words, several words allowed: see searchTokens in
   40-panel-actions.js) and the ancestors that lead to it. A folder that
   matches shows what it holds, one level deep: it is drawn open while the
   filter lasts, and whatever is inside keeps the state the user left it in.
   See tree-navigation-selection.md.

   The expensive part was reaching a match inside a folder that has never been
   opened: its layers are data (`li._pending`) and building them all took 6.9 s
   with 20 000. Building is therefore planned first (planRows/planRecs: one
   cheap walk over rows AND pending records, 5 ms with 20 000) and done in two
   phases under ONE budget of FILTER_BUILD_MAX rows:
     1. the matches and the path to them (materializeMatching, 31-tree-node.js:
        5 ms with 38 matches, 84 ms with 1 000). Over the budget, nothing: the
        folder comes out closed with «(n)» and is built when it is opened.
     2. what each matching folder shows, in document order while budget is
        left. A folder that does not fit stays closed (`filterNoFit`) and is
        built whole when it is opened, so one huge folder cannot keep the small
        matches elsewhere from being seen.

   What the filter NEVER touches: `collapsed` (folders are drawn open with the
   class `filter-open`, which the CSS lets override it), the checkboxes and
   the map layers. What it hides is `li.hidden`, which `isRow`
   (30-tree-walk.js) skips, so the keyboard, ranges and Ctrl+A never land on a
   row that cannot be seen. None of this is serialized. The highlight of the
   typed words uses the CSS Custom Highlight API: ranges over the label's text,
   no DOM written, so nothing here wakes the observer or races a rename.   */
const FILTER_BUILD_MAX = 300;
const FILTER_HIGHLIGHT_MAX = 1000; /* rows highlighted at once: one Range each */
const F_MATCH = 1, F_BELOW = 2;    /* record flags: it matches / a match is inside it */
const HL_NAME = "kite-search";
const canHighlight = typeof CSS !== "undefined" && !!CSS.highlights && typeof Highlight === "function";
let treeFilter = null;           /* { raw, tokens, all } while a filter is set */
let filterGen = 0;               /* a pass in flight is dropped when a newer one arrives */
let filterApplying = false;
let filterFlags = new WeakMap();  /* record -> F_MATCH | F_BELOW, from this pass's plan */
let filterScope = new WeakSet();  /* records phase 2 builds: what a matching folder shows */
const filterNoFit = new Set();    /* matching folders whose content did not fit the budget */
let refilterTimer = null;
const treeFilterEmpty = document.getElementById("tree-filter-empty");

/* What phase 1 builds, and what the filter lets a folder build when the user
   opens it: a match, or a record with a match inside. */
const recWanted = rec => ((filterFlags.get(rec) || 0) & (F_MATCH | F_BELOW)) !== 0;
const recInScope = rec => filterScope.has(rec);

/* How many pending records match, at any depth (only descends where the plan
   saw a match below). The «(n)» of a folder that has not been built. */
function pendingMatches(records) {
  let n = 0;
  for (const r of records) {
    const f = filterFlags.get(r) || 0;
    if (f & F_MATCH) n++;
    if ((f & F_BELOW) && r.children) n += pendingMatches(r.children);
  }
  return n;
}

/* The plan for the records of ONE row's `_pending`: flags each record
   (F_MATCH, F_BELOW: the mask of the ancestors above it travels in `inh`) and
   collects in `list` the ones the user would SEE if the folder were built as
   it stands: `showing` says this level is drawn (the parent matches, or is in
   a matching folder and was left open), `reach` that every record above is in
   the list too (a record can only be built through its parents).
   Returns whether a match is here or below. */
function planRecs(records, inh, showing, reach, ctx, list) {
  const { tokens, all } = treeFilter;
  let any = false;
  for (const rec of records) {
    const self = tokenMask(recKey(rec), tokens);
    const match = maskMatches(self, inh, all);
    if (match) ctx.matches++;
    if (showing && reach) list.push(rec);
    const kidsShown = match || (showing && !rec.collapsed);
    const below = rec.children
      ? planRecs(rec.children, inh | self, kidsShown, reach && showing, ctx, list) : false;
    const f = (match ? F_MATCH : 0) | (below ? F_BELOW : 0);
    if (f) filterFlags.set(rec, f);
    if (f) any = true;
  }
  return any;
}

/* The same plan over the rows that exist, which carry pending records of
   their own. `ctx.withMatches`: rows with a match among their pending records
   (phase 1 builds those); `ctx.shown`: rows with pending records that would be
   seen, and which ones (phase 2). `ctx.matches` counts pending matches only. */
function planRows(ul, inh, showing, ctx) {
  const { tokens, all } = treeFilter;
  for (const li of ul.children) {
    if (li._name === undefined) continue;
    const self = tokenMask(rowKey(li), tokens);
    const match = maskMatches(self, inh, all);
    const kidsShown = match || (showing && !li.classList.contains("collapsed"));
    const cul = li._isContainer ? nodeUl(li) : null;
    if (cul) planRows(cul, inh | self, kidsShown, ctx);
    if (li._pending) {
      const before = ctx.matches, list = [];
      planRecs(li._pending, inh | self, kidsShown, true, ctx, list);
      if (ctx.matches > before) ctx.withMatches.push(li);
      if (list.length) ctx.shown.push({ li, list });
    }
  }
}
const newPlan = () => ({ matches: 0, withMatches: [], shown: [] });

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

/* One pass over the rows that exist: hides what does not match, draws open
   (to the eye only) what holds matches, counts, and notes which rows to
   highlight. `inScope`: the row is inside a folder that matched, so nothing
   in there is hidden; it stays drawn as the user left it (`collapsed`) unless
   a match is inside it. Returns bit 1 if something stays visible and bit 2 if
   a match is here or below (a visible row is not always a match: scope).
   Only writes where something changes: with 20 000 rows built, hiding them
   all measured 134 ms.                                                    */
function filterPass(ul, inh, inScope, st) {
  const { tokens, all } = treeFilter;
  let seen = 0;
  for (const li of ul.children) {
    if (li._name === undefined) { setHidden(li, true); continue; } /* message rows */
    const self = tokenMask(rowKey(li), tokens);
    const match = maskMatches(self, inh, all);
    if (match) st.matches++;
    const shows = match && !filterNoFit.has(li);
    const cul = li._isContainer ? nodeUl(li) : null;
    const sub = cul ? filterPass(cul, inh | self, shows || inScope, st) : 0;
    const pend = li._pending ? pendingMatches(li._pending) : 0;
    st.matches += pend;
    const deep = (sub & 2) !== 0;
    const visible = match || inScope || deep || pend > 0;
    setHidden(li, !visible);
    li._fscope = match || inScope; /* expandFolder: its content is built whole */
    setFilterOpen(li, visible && !filterClosed.has(li) && (deep || (shows && !!cul)));
    setBadge(li, pend);
    if (self && visible) st.rows.push(li);
    if (visible) seen |= 1;
    if (match || deep || pend > 0) seen |= 2;
  }
  return seen;
}

/* Mark the typed words in the labels of the rows that stay (those whose own
   name holds one). Ranges over the label's text node, nothing written to the
   DOM. A label that is not just the name (a measurement appends its length)
   is marked over the name part only. */
function paintHighlights(rows) {
  if (!canHighlight) return;
  const ranges = [];
  for (const li of rows) {
    if (ranges.length >= FILTER_HIGHLIGHT_MAX) break;
    const label = nodeRow(li).querySelector(":scope > label");
    const node = label && label.firstChild;
    if (!node || node.nodeType !== 3 || !node.data.startsWith(li._name)) continue;
    for (const [from, to] of highlightRanges(li._name, treeFilter.tokens)) {
      const r = document.createRange();
      r.setStart(node, from);
      r.setEnd(node, to);
      ranges.push(r);
    }
  }
  CSS.highlights.set(HL_NAME, new Highlight(...ranges));
}
const clearHighlights = () => { if (canHighlight) CSS.highlights.delete(HL_NAME); };

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
  const text = raw.trim();
  const tokens = searchTokens(text);
  if (!tokens.length) return clearTreeFilter();
  const gen = ++filterGen;
  treeFilter = { raw: text, tokens, all: tokensAll(tokens) };
  treeFilterWanted = recWanted;
  filterFlags = new WeakMap();
  filterScope = new WeakSet();
  filterNoFit.clear();
  filterApplying = true;
  try {
    if (rootUl && rootUl.isConnected) {
      /* Phase 1: the matches inside folders that were never opened are counted
         without building and, if they fit the budget, ONLY they get built */
      let plan = newPlan();
      planRows(rootUl, 0, false, plan);
      let spent = 0;
      if (plan.matches > 0 && plan.matches <= FILTER_BUILD_MAX) {
        for (const li of plan.withMatches) {
          await materializeMatching(li, recWanted);
          if (gen !== filterGen) return;
        }
        spent = plan.matches;
      }
      /* Phase 2: what each matching folder shows, with what is left of the
         budget. Planned again: the folders phase 1 built are rows now and may
         hold records of their own to show. */
      plan = newPlan();
      planRows(rootUl, 0, false, plan);
      let budget = FILTER_BUILD_MAX - spent;
      for (const { li, list } of plan.shown) {
        if (list.length > budget) { filterNoFit.add(li); continue; }
        budget -= list.length;
        for (const rec of list) filterScope.add(rec);
        await materializeMatching(li, recInScope);
        if (gen !== filterGen) return;
      }
    }
    if (gen !== filterGen) return;
    const st = { matches: 0, rows: [] };
    const any = rootUl && rootUl.isConnected ? (filterPass(rootUl, 0, false, st) & 1) !== 0 : false;
    dropHiddenSelection();
    searchCount.textContent = String(st.matches);
    paintHighlights(st.rows);
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
  filterNoFit.clear();
  clearHighlights();
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
