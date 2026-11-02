/* ================= Tabla de atributos =================
   Botón ▦ de una carpeta o archivo: una fila por capa de dentro y una
   columna por atributo (las `properties` de GeoJSON, de un shapefile o de
   un <ExtendedData> de KML), para ordenar, filtrar, ir a una capa y
   exportar a CSV. Es una INSTANTÁNEA de solo lectura de lo que había al
   abrirla.

   Se lee del árbol SIN construir filas: las capas de una carpeta nunca
   desplegada son registros pendientes (`li._pending`) con su capa ya
   construida, y de ahí salen sus propiedades. Solo al pulsar una fila se
   materializa lo necesario para llegar a ella (`resolveRecordLi`).
   Una carpeta puede tener decenas de miles de capas: la tabla pinta solo
   las filas que se ven (`renderAttrRows`).

   Lo puro va arriba y se prueba en Node (tests/attrtable.js). Sin DOM al
   cargar el archivo, como 53-range-rings.js: el diálogo se enlaza al
   abrirlo.                                                             */

const ATTR_ROW_PX = 24;       /* alto fijo de fila: sin él no hay ventana de filas */
const ATTR_COL_PX = 150;
const ATTR_NAME_COL_PX = 210;
const ATTR_MAX_COLS = 80;     /* un archivo con cientos de campos no cabe ni se lee */
const ATTR_OVERSCAN = 6;

/* ---------- Lo puro ---------- */

/* Las filas de un subárbol: [{ name, props, li | rec }], en el orden del
   árbol. `li` es una capa ya con fila; `rec`, un registro pendiente.
   Solo capas con geometría de verdad (no mediciones, cuadrículas ni
   ortofotos). `props` puede ser null.                                  */
function collectAttrRows(root) {
  const rows = [];
  const fromRecords = recs => {
    for (const rec of recs) {
      if (Array.isArray(rec.children)) fromRecords(rec.children);
      else if (rec.t === "layer") rows.push({ name: rec.name, props: layerProperties(rec._layer), rec });
    }
  };
  const fromLi = li => {
    if (li._name === undefined) return; /* mensajes tipo «Sin geometrías» */
    if (li._isContainer) {
      if (li._pending) fromRecords(li._pending);
      const ul = nodeUl(li);
      if (ul) for (const child of ul.children) fromLi(child);
      return;
    }
    if (li._measure || li._elevGrid || li._imageOverlay || li._cog || li._arcgis || li._arcgisLayer) return;
    rows.push({ name: li._name, props: layerProperties(nodeLayer(li)), li });
  };
  fromLi(root);
  return rows;
}

/* Las columnas: la unión de las claves en el orden en que se ven por
   primera vez, con tope. `key: null` es la del nombre del nodo.        */
function attrColumns(rows, max = ATTR_MAX_COLS) {
  const keys = new Set();
  for (const r of rows) {
    if (!r.props) continue;
    for (const k of Object.keys(r.props)) { keys.add(k); if (keys.size >= max) break; }
    if (keys.size >= max) break;
  }
  return { cols: [{ key: null }, ...[...keys].map(key => ({ key }))], capped: keys.size >= max };
}

/* El texto de una celda: el nombre del nodo (key null) o la propiedad */
const attrCell = (row, key) => key === null ? String(row.name) : (row.props && key in row.props ? stringifyPropValue(row.props[key]) : "");

/* ¿Una columna entera es numérica? Entonces se ordena por valor y no por
   texto («10» después de «9»). Las celdas vacías no cuentan.            */
function attrIsNumeric(rows, key) {
  let seen = false;
  for (const r of rows) {
    const v = attrCell(r, key).trim();
    if (v === "") continue;
    if (!/^-?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?$/.test(v)) return false;
    seen = true;
  }
  return seen;
}

/* Orden estable; las celdas vacías siempre al final, en cualquier sentido */
function attrSort(rows, key, dir) {
  const numeric = attrIsNumeric(rows, key);
  const val = r => attrCell(r, key).trim();
  const cmp = (a, b) => {
    const x = val(a), y = val(b);
    if (x === "" || y === "") return x === y ? 0 : x === "" ? 1 : -1;
    const c = numeric ? Number(x.replace(",", ".")) - Number(y.replace(",", "."))
      : x.localeCompare(y, uiLang, { numeric: true, sensitivity: "base" });
    return dir * c;
  };
  return rows.map((r, i) => [r, i]).sort((p, q) => cmp(p[0], q[0]) || p[1] - q[1]).map(p => p[0]);
}

/* Filtro de texto, sin distinguir mayúsculas, sobre el nombre y todos los valores */
function attrFilter(rows, term) {
  const t = String(term || "").trim().toLowerCase();
  if (!t) return rows;
  return rows.filter(r => {
    if (String(r.name).toLowerCase().includes(t)) return true;
    return !!r.props && Object.values(r.props).some(v => stringifyPropValue(v).toLowerCase().includes(t));
  });
}

/* CSV (RFC 4180): coma, comillas dobles duplicadas, CRLF. Un valor que
   una hoja de cálculo leería como FÓRMULA (empieza por =, @ o por + / -
   sin que siga una cifra) lleva delante un apóstrofo: es la defensa
   estándar contra un archivo ajeno que lo aprovecha, y no toca los
   números negativos. Los números llevan punto decimal, como todo lo que
   escribe la aplicación.                                               */
const csvCell = v => {
  let s = String(v);
  if (/^[=@\t\r]/.test(s) || /^[+-](?![\d.])/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) => [header, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/* ---------- El diálogo (se enlaza al abrirlo) ---------- */

let attrUi = null;
/* Lo que muestra: las filas de la instantánea, las columnas, el orden y el filtro */
const attrState = { li: null, rows: [], cols: [], view: [], sortKey: undefined, sortDir: 1, frame: 0 };
const isAttrDialogOpen = () => !!attrUi && !attrUi.dialog.hidden;

function attrDialogUi() {
  if (attrUi) return attrUi;
  const el = id => document.getElementById(id);
  const dialog = el("attr-dialog");
  attrUi = {
    dialog, box: dialog.querySelector(".dlg-box"), title: el("attr-title"), filter: el("attr-filter"),
    count: el("attr-count"), note: el("attr-note"), scroll: el("attr-scroll"), table: el("attr-table"),
    head: el("attr-head"), body: el("attr-body"), colgroup: el("attr-cols"), csv: el("attr-csv"), style: el("attr-style")
  };
  makeDialogMovable(attrUi.box);
  setupDialog(attrUi.box, { modal: false });
  attrUi.filter.addEventListener("input", () => { updateAttrView(); });
  attrUi.scroll.addEventListener("scroll", scheduleAttrRender);
  new ResizeObserver(scheduleAttrRender).observe(attrUi.scroll);
  /* Pulsar el encabezado ordena (otra vez, invierte); la fila, va a la capa */
  attrUi.head.addEventListener("click", e => {
    const th = e.target.closest("th[data-c]");
    if (!th) return;
    const key = attrState.cols[Number(th.dataset.c)].key;
    attrState.sortDir = attrState.sortKey === key ? -attrState.sortDir : 1;
    attrState.sortKey = key;
    updateAttrView();
  });
  attrUi.body.addEventListener("click", e => { const tr_ = e.target.closest("tr[data-i]"); if (tr_) gotoAttrRow(Number(tr_.dataset.i), false); });
  attrUi.body.addEventListener("dblclick", e => { const tr_ = e.target.closest("tr[data-i]"); if (tr_) gotoAttrRow(Number(tr_.dataset.i), true); });
  el("attr-close").addEventListener("click", closeAttrDialog);
  attrUi.csv.addEventListener("click", exportAttrCsv);
  attrUi.style.addEventListener("click", openAttrStyleDialog);
  return attrUi;
}

const attrColLabel = col => col.key === null ? tr("Nombre") : col.key;

/* Cabecera y anchos: solo cuando cambian las columnas (al abrir) o el orden */
function renderAttrHead() {
  const ui = attrUi, st = attrState;
  ui.colgroup.innerHTML = st.cols.map(c => `<col style="width:${c.key === null ? ATTR_NAME_COL_PX : ATTR_COL_PX}px">`).join("");
  ui.table.style.width = `${st.cols.reduce((n, c) => n + (c.key === null ? ATTR_NAME_COL_PX : ATTR_COL_PX), 0)}px`;
  ui.head.innerHTML = "<tr>" + st.cols.map((c, i) => {
    const on = st.sortKey === c.key;
    const arrow = on ? (st.sortDir === 1 ? " ▲" : " ▼") : "";
    return `<th data-c="${i}" scope="col" aria-sort="${on ? (st.sortDir === 1 ? "ascending" : "descending") : "none"}" title="${escapeHtml(attrColLabel(c))}">`
      + `${escapeHtml(attrColLabel(c))}${arrow}</th>`;
  }).join("") + "</tr>";
}

/* Las filas visibles (más un margen) entre dos separadores del alto de las
   que no se pintan: la barra de desplazamiento mide lo de la lista entera. */
function renderAttrRows() {
  attrState.frame = 0;
  if (!isAttrDialogOpen()) return;
  const ui = attrUi, st = attrState, n = st.view.length, cols = st.cols.length;
  const first = Math.max(0, Math.floor(ui.scroll.scrollTop / ATTR_ROW_PX) - ATTR_OVERSCAN);
  const last = Math.min(n, first + Math.ceil(ui.scroll.clientHeight / ATTR_ROW_PX) + 2 * ATTR_OVERSCAN);
  const spacer = rows => rows > 0 ? `<tr class="attr-spacer" aria-hidden="true"><td colspan="${cols}" style="height:${rows * ATTR_ROW_PX}px"></td></tr>` : "";
  let html = spacer(first);
  for (let i = first; i < last; i++) {
    const row = st.view[i];
    html += `<tr data-i="${i}">` + st.cols.map(c => {
      const v = attrCell(row, c.key);
      return `<td${v.length > 22 ? ` title="${escapeHtml(v.slice(0, 500))}"` : ""}>${escapeHtml(v)}</td>`;
    }).join("") + "</tr>";
  }
  ui.body.innerHTML = html + spacer(n - last);
}
const scheduleAttrRender = () => { if (!attrState.frame) attrState.frame = requestAnimationFrame(renderAttrRows); };

/* Filtra y ordena la instantánea y repinta */
function updateAttrView() {
  const ui = attrUi, st = attrState;
  let view = attrFilter(st.rows, ui.filter.value);
  if (st.sortKey !== undefined) view = attrSort(view, st.sortKey, st.sortDir);
  st.view = view;
  ui.count.textContent = view.length === st.rows.length
    ? trn(view.length, "{n} capa", "{n} capas", { n: view.length })
    : tr("{shown} de {n} capas", { shown: view.length, n: st.rows.length });
  ui.scroll.scrollTop = 0;
  renderAttrHead();
  renderAttrRows();
}

async function gotoAttrRow(i, zoom) {
  const row = attrState.view[i];
  if (!row) return;
  const li = row.li && row.li.isConnected ? row.li : (row.rec ? await resolveRecordLi(row.rec) : null);
  if (!li) { navMessage(tr("Esa capa ya no está en el árbol.")); return; }
  goToNodeAndBlink(li);
  if (zoom) focusOnNode(li);
}

function openAttrTable(li) {
  const ui = attrDialogUi();
  const rows = collectAttrRows(li);
  const { cols, capped } = attrColumns(rows);
  Object.assign(attrState, { li, rows, cols, view: rows, sortKey: undefined, sortDir: 1 });
  ui.title.textContent = tr("Atributos de «{name}»", { name: li._name });
  ui.filter.value = "";
  const notes = [];
  if (!rows.length) notes.push(tr("Esta carpeta no tiene ninguna capa."));
  else if (cols.length === 1) notes.push(tr("Ninguna de estas capas trae atributos: solo se ven sus nombres."));
  if (capped) notes.push(tr("Se muestran los primeros {n} atributos.", { n: ATTR_MAX_COLS }));
  ui.note.textContent = notes.join(" ");
  ui.note.hidden = !notes.length;
  ui.csv.disabled = !rows.length;
  ui.style.disabled = cols.length < 2; /* sin atributos no hay con qué colorear */
  ui.dialog.hidden = false;
  clampToViewport(ui.box);
  focusDialog(ui.box);
  updateAttrView();
}

function closeAttrDialog() {
  attrUi.dialog.hidden = true;
  Object.assign(attrState, { li: null, rows: [], view: [] }); /* no retener la instantánea */
  attrUi.body.innerHTML = "";
  releaseFocus();
}

/* Lo que se ve, tal como se ve: con el filtro y el orden puestos */
function exportAttrCsv() {
  const st = attrState;
  if (!st.view.length) return;
  const csv = toCsv(st.cols.map(attrColLabel), st.view.map(r => st.cols.map(c => attrCell(r, c.key))));
  downloadBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), safeFileName(st.li._name) + ".csv");
}
