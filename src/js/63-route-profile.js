/* ================= Perfil de una ruta =================
   «Obtener perfil» (menú contextual sobre una ruta, o su diálogo de
   propiedades) descarga del MDS elegido en Propiedades → Fuentes de
   datos las celdas que recorre la ruta y dibuja la altura a lo largo
   de ella: distancia desde el inicio en horizontal (unidad de
   distancia), altura en vertical (unidad de altitud), con los vértices
   entre tramos marcados en negrita en el eje de distancias.

   La ventana de 40 m de «Consultar elevación aquí» daría cientos de
   peticiones para una ruta de kilómetros, así que aquí se pide por
   TROZOS: cada tramo se corta en piezas cuya caja mide como mucho
   PROFILE_CHUNK_CELLS celdas de lado, y cada pieza es una petición.
   De cada caja se aprovecha solo lo que pisa la ruta: es el precio de
   pedir rectángulos. Las peticiones van una tras otra, respetando el
   tope de peticiones por segundo (demRateWait) y con los reintentos de
   cualquier consulta (withElevRetries).

   Lo que queda en el árbol son SOLO las celdas recorridas, una capa
   «Perfil de «Ruta N» — …» en la carpeta de la sesión: lo descargado y
   no usado se descarta. La gráfica no se guarda; se vuelve a obtener.
   La longitud de la ruta está acotada (profileMaxM, Preferencias) para
   que una ruta larga no llene IndexedDB de celdas.                   */
const PROFILE_CHUNK_CELLS = 200;   /* celdas de lado, como mucho, por petición */

/* ---------- Cálculo (puro: se prueba en Node) ----------
   Los tramos van en metros Web Mercator, como los dibuja el visor
   (`L.polyline` es recta en la proyección, no un arco geodésico): la
   ruta que se ve es la que se muestrea. `scale` es cuántos metros Web
   Mercator mide un metro real a la latitud del tramo (1/cos φ), para
   pasar el tamaño de celda del modelo a la proyección. `dist` es la
   distancia geodésica del tramo, la misma de su etiqueta.            */

/* Cajas de petición: cada tramo en tantas piezas iguales como hagan
   falta para que ninguna caja supere PROFILE_CHUNK_CELLS celdas de
   lado, más una celda de margen (que la celda bajo el borde de la
   pieza llegue entera).                                              */
function profilePieces(legs, cellMeters, maxCells = PROFILE_CHUNK_CELLS) {
  const out = [];
  for (const leg of legs) {
    const cell = cellMeters * leg.scale;
    const len = Math.hypot(leg.b.x - leg.a.x, leg.b.y - leg.a.y);
    const n = Math.max(1, Math.ceil(len / (maxCells * cell)));
    for (let k = 0; k < n; k++) {
      const p = { x: leg.a.x + (leg.b.x - leg.a.x) * k / n, y: leg.a.y + (leg.b.y - leg.a.y) * k / n };
      const q = { x: leg.a.x + (leg.b.x - leg.a.x) * (k + 1) / n, y: leg.a.y + (leg.b.y - leg.a.y) * (k + 1) / n };
      out.push({
        x0: Math.min(p.x, q.x) - cell, y0: Math.min(p.y, q.y) - cell,
        x1: Math.max(p.x, q.x) + cell, y1: Math.max(p.y, q.y) + cell
      });
    }
  }
  return out;
}

/* Muestras a lo largo de la ruta, a media celda o menos (así no se
   salta ninguna celda que la línea cruce), cada una con su distancia
   desde el inicio. Dentro de un tramo la distancia es proporcional
   sobre su distancia geodésica: cada vértice cae EXACTAMENTE en la suma
   de las etiquetas de los tramos anteriores, que es lo que el usuario
   ha leído en el mapa. `vertices`: la distancia de cada vértice.     */
function routeProfileSamples(legs, cellMeters) {
  const samples = [], vertices = [0];
  let cum = 0;
  legs.forEach((leg, i) => {
    const len = Math.hypot(leg.b.x - leg.a.x, leg.b.y - leg.a.y);
    const n = Math.max(1, Math.ceil(len / (cellMeters * leg.scale / 2)));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      samples.push({
        x: leg.a.x + (leg.b.x - leg.a.x) * t, y: leg.a.y + (leg.b.y - leg.a.y) * t,
        d: cum + t * leg.dist
      });
    }
    cum += leg.dist;
    vertices.push(cum);
  });
  return { samples, vertices, total: cum };
}

/* Un punto por CELDA RECORRIDA: las muestras seguidas que caen en la
   misma celda se funden en una, situada en la distancia media de su
   recorrido. `lookup(sample)` da `{ key, value, ref }` de la celda bajo
   la muestra, o `undefined` si ninguna rejilla la cubre (trozo sin
   respuesta): eso es un hueco, igual que una celda sin dato
   (`value: null`). Los huecos seguidos también se funden.            */
function profileFromSamples(samples, lookup) {
  const points = [];
  let run = null;
  const close = () => {
    if (!run) return;
    points.push({ d: (run.d0 + run.d1) / 2, v: run.v, ref: run.ref });
    run = null;
  };
  for (const s of samples) {
    const hit = lookup(s);
    const key = hit ? hit.key : "∅";
    if (run && run.key === key) { run.d1 = s.d; continue; }
    close();
    run = { key, d0: s.d, d1: s.d, v: hit ? hit.value : null, ref: hit ? hit.ref : null };
  }
  close();
  return points;
}

/* Marcas «redondas» de un eje (1, 2 o 5 por potencia de diez) entre
   min y max, unas `n`. `step` sirve para decidir cuántos decimales.  */
function niceTicks(min, max, n) {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return { ticks: [min], step: 0 };
  const rough = span / Math.max(1, n);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(12)));
  }
  return { ticks, step };
}

/* Decimales de las cifras de un eje: los que pide su paso */
const tickDecimals = step => (step > 0 ? Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9))) : 2);

/* Tramos continuos de la curva (los huecos la cortan), y en cada uno,
   si hay más puntos que píxeles, el mínimo y el máximo de cada columna
   en su orden: así no se pierde un pico al dibujar 7000 celdas en 600
   píxeles.                                                          */
function profilePolylines(points, xOf, yOf) {
  const lines = [];
  let cur = [];
  const flush = () => { if (cur.length) lines.push(cur); cur = []; };
  let col = null, lo = null, hi = null;
  const emit = () => {
    if (!lo) return;
    if (lo === hi) cur.push(lo);
    else if (lo.i < hi.i) cur.push(lo, hi); else cur.push(hi, lo);
    lo = hi = null;
  };
  points.forEach((p, i) => {
    if (p.v === null || p.v === undefined) { emit(); flush(); col = null; return; }
    const x = xOf(p.d), y = yOf(p.v), c = Math.round(x);
    if (c !== col) { emit(); col = c; }
    const pt = { x, y, i };
    if (!lo || y > lo.y) lo = pt;  /* y de pantalla: mayor = más bajo */
    if (!hi || y < hi.y) hi = pt;
  });
  emit();
  flush();
  return lines;
}

/* El punto con dato más cercano a una distancia (lectura bajo el ratón).
   `points` va ordenado por distancia.                                */
function nearestProfilePoint(points, d) {
  let best = null;
  for (const p of points) {
    if (p.v === null || p.v === undefined) continue;
    if (!best || Math.abs(p.d - d) < Math.abs(best.d - d)) best = p;
    else if (p.d > d) break;
  }
  return best;
}

/* ---------- Diálogo ---------- */
const profileDialog = document.getElementById("profile-dialog");
const profileBox = profileDialog.querySelector(".dlg-box");
const profileChart = document.getElementById("profile-chart");
makeDialogMovable(profileBox);
setupDialog(profileBox, { modal: false }); /* flotante: el mapa sigue vivo */

let profileRun = null;   /* { ctl } mientras descarga                  */
let profileData = null;  /* { points, vertices, total } ya calculado   */

function setProfileProgress(done, total) {
  const pct = total ? Math.round(100 * done / total) : 0;
  document.getElementById("profile-progress-fill").style.width = `${pct}%`;
  document.getElementById("profile-progress-label").textContent = total
    ? `Descargando celdas MDS: ${pct} % (${done} de ${total} zona${total === 1 ? "" : "s"})`
    : "Consultando el servicio…";
}

function setProfileNote(txt) {
  const el = document.getElementById("profile-note");
  el.hidden = !txt;
  el.textContent = txt || "";
}

function openProfileDialog(title) {
  document.getElementById("profile-title").textContent = title;
  document.getElementById("profile-progress").hidden = false;
  document.getElementById("profile-close").textContent = "Cancelar";
  setProfileProgress(0, 0);
  setProfileNote("");
  profileData = null;
  profileChart.innerHTML = "";
  profileDialog.hidden = false;
  clampToViewport(profileBox);
  focusDialog(profileBox);
}

/* Cancelar (descargando) o Cerrar (con la gráfica): lo mismo, abortar
   lo que quede en vuelo. Cancelar a mitad no deja nada en el árbol. */
function closeProfileDialog() {
  if (profileRun) profileRun.ctl.abort();
  if (profileDialog.hidden) return;
  profileDialog.hidden = true;
  releaseFocus();
}
document.getElementById("profile-close").addEventListener("click", closeProfileDialog);

/* Por qué no se puede obtener el perfil de esta ruta, o false: es el
   `disabled()` del menú contextual y el title del botón del diálogo.  */
function routeProfileDisabled(li) {
  const m = li && li._measure;
  if (!m || m.type !== "route") return "Solo una ruta tiene perfil.";
  if (!elevSources.mds) return "Sin fuente MDS: elígela en Propiedades → Fuentes de datos.";
  if (m.totalDist > profileMaxM) {
    return `La ruta mide ${fmtUnitDist(m.totalDist, measureUnit)} y el límite de un perfil es `
      + `${fmtUnitDist(profileMaxM, measureUnit)} (Propiedades → Preferencias).`;
  }
  return false;
}

/* Tramos de la ruta en metros Web Mercator, con su escala local y su
   distancia geodésica (la de las etiquetas, m.legs).                  */
function profileLegs(m) {
  const pts = m.handles.map(h => h.getLatLng());
  return m.legs.map((leg, i) => {
    const a = toWebMercator(pts[i].lat, pts[i].lng), b = toWebMercator(pts[i + 1].lat, pts[i + 1].lng);
    const midLat = (pts[i].lat + pts[i + 1].lat) / 2;
    return { a, b, dist: leg.dist, scale: 1 / Math.max(0.05, Math.cos(toRad(midLat))) };
  });
}

/* La celda bajo una muestra: la primera rejilla que la cubre (empezando
   por la última que acertó, que casi siempre es la buena).           */
function makeProfileLookup(grids) {
  let last = 0;
  return s => {
    let ll = null; /* solo hace falta para una rejilla geográfica */
    for (let k = 0; k < grids.length; k++) {
      const gi = (last + k) % grids.length, g = grids[gi];
      if (g.crs !== "web" && !ll) ll = map.options.crs.unproject(L.point(s.x, s.y));
      const p = g.crs === "web" ? s : gridPoint(g, ll.lat, ll.lng);
      if (!p) continue;
      const c = Math.floor((p.x - g.xll) / g.cellX);
      const r = g.rows - 1 - Math.floor((p.y - g.yll) / g.cellY);
      if (r < 0 || r >= g.rows || c < 0 || c >= g.cols) continue;
      last = gi;
      return { key: `${gi}:${r}:${c}`, value: g.values[r][c], ref: { grid: g, r, c } };
    }
    return undefined;
  };
}

/* Registro de celda (el mismo que buildElevCells) de una celda recorrida */
function profileCell(p) {
  const { grid, r, c } = p.ref;
  const b = gridCellBounds(grid, r, c);
  const sw = gridToLatLng(grid, b.x0, b.y0), ne = gridToLatLng(grid, b.x1, b.y1);
  if (!sw || !ne) return null;
  return { sw, ne, center: [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2], mds: p.v, diff: null };
}

async function obtainRouteProfile(li) {
  const why = routeProfileDisabled(li);
  if (why) { navMessage(why); return; }
  if (profileRun) profileRun.ctl.abort();
  const m = li._measure;
  const src = elevSourceById(elevSources.mds);
  const client = sourceClient(src.id);
  const run = { ctl: new AbortController() };
  profileRun = run;
  openProfileDialog(`Perfil: ${li._name}`);
  try {
    const cfg = await client.discover();
    if (run.ctl.signal.aborted) return;
    const cellMeters = cfg.cellMeters > 0 ? cfg.cellMeters : 30;
    const legs = profileLegs(m);
    const pieces = profilePieces(legs, cellMeters);
    const grids = [];
    let failed = 0, lastError = null, answered = false;
    setProfileProgress(0, pieces.length);
    for (let i = 0; i < pieces.length; i++) {
      const q = pieces[i];
      const sw = map.options.crs.unproject(L.point(q.x0, q.y0));
      const ne = map.options.crs.unproject(L.point(q.x1, q.y1));
      const res = await client.area({ south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng },
        run.ctl.signal);
      if (res.grid !== undefined) answered = true;
      if (res.grid && res.grid.located) grids.push(res.grid);
      if (res.error) { failed++; lastError = res.error; }
      setProfileProgress(i + 1, pieces.length);
    }
    if (answered) addElevAttribution(src.id);
    document.getElementById("profile-progress").hidden = true;
    document.getElementById("profile-close").textContent = "Cerrar";

    const { samples, vertices, total } = routeProfileSamples(legs, cellMeters);
    const points = profileFromSamples(samples, makeProfileLookup(grids));
    const notes = [];
    if (failed) notes.push(`${failed} de ${pieces.length} zonas sin respuesta (${lastError}): salen como huecos.`);
    const cells = points.filter(p => p.ref && p.v !== null).map(profileCell).filter(Boolean);
    if (!cells.length) {
      notes.push("Sin datos de elevación a lo largo de la ruta (fuera de la cobertura de la fuente MDS elegida).");
      setProfileNote(notes.join(" "));
      return;
    }
    setProfileNote(notes.join(" "));
    profileData = { points, vertices, total };
    renderProfileChart();

    /* Al árbol, solo las celdas recorridas con dato */
    pushUndo("obtener perfil");
    const folder = await ensureElevSessionFolder();
    const node = makeElevGridNode(elevNodeName(`Perfil de «${li._name}»`, [src]), cells);
    nodeUl(folder).appendChild(node);
    refreshAncestorChecks(node);
    scheduleSave();
  } catch (err) {
    if (run.ctl.signal.aborted) return;
    document.getElementById("profile-progress").hidden = true;
    document.getElementById("profile-close").textContent = "Cerrar";
    const why = err.name === "TimeoutError" ? "el servicio no responde"
      : err.name === "TypeError"
        ? "el servicio no está disponible o no admite consultas desde el navegador (CORS)"
        : err.message;
    setProfileNote(`No se pudo obtener el perfil: ${why}.`);
  } finally {
    if (profileRun === run) profileRun = null;
  }
}

/* ---------- Gráfica (SVG propio) ---------- */
const PF_MARGIN = { l: 64, r: 14, t: 14, b: 40 };
const SVG_NS = "http://www.w3.org/2000/svg";

function renderProfileChart() {
  if (!profileData || profileDialog.hidden) return;
  const { points, vertices, total } = profileData;
  const W = profileChart.clientWidth, H = profileChart.clientHeight;
  if (W < 80 || H < 60) return;
  const pw = W - PF_MARGIN.l - PF_MARGIN.r, ph = H - PF_MARGIN.t - PF_MARGIN.b;
  const fx = POLY_UNIT_FACTOR[measureUnit], fy = POLY_UNIT_FACTOR[altitudeUnit];
  const vals = points.filter(p => p.v !== null && p.v !== undefined).map(p => p.v / fy);
  let y0 = Math.min(...vals), y1 = Math.max(...vals);
  const pad = (y1 - y0) * 0.08 || Math.max(1 / fy, Math.abs(y0) * 0.05) || 1;
  y0 -= pad; y1 += pad;
  const xMax = total / fx || 1;
  const xOf = d => PF_MARGIN.l + (d / fx) / xMax * pw;
  const yOf = v => PF_MARGIN.t + (1 - (v / fy - y0) / (y1 - y0)) * ph;
  const yPix = u => PF_MARGIN.t + (1 - (u - y0) / (y1 - y0)) * ph;

  const parts = [];
  const yt = niceTicks(y0, y1, Math.max(2, Math.floor(ph / 36)));
  const yd = tickDecimals(yt.step);
  for (const u of yt.ticks) {
    const y = yPix(u).toFixed(1);
    parts.push(`<line class="pf-grid" x1="${PF_MARGIN.l}" x2="${W - PF_MARGIN.r}" y1="${y}" y2="${y}"/>`,
      `<text class="pf-tick" x="${PF_MARGIN.l - 6}" y="${y}" text-anchor="end" dominant-baseline="middle">${u.toFixed(yd)}</text>`);
  }
  /* Vértices: línea discontinua y su distancia en NEGRITA. Una cifra
     que se montaría sobre la anterior se omite (un arco son decenas de
     tramos cortos), pero su línea se dibuja; el final siempre lleva la
     suya. Las marcas redondas que caerían encima de una se omiten.   */
  const vx = vertices.map(xOf);
  const labelled = [];
  for (let i = 0; i < vertices.length; i++) {
    const x = vx[i].toFixed(1);
    parts.push(`<line class="pf-vertex" x1="${x}" x2="${x}" y1="${PF_MARGIN.t}" y2="${H - PF_MARGIN.b}"/>`);
    const last = i === vertices.length - 1;
    if (labelled.length && vx[i] - labelled[labelled.length - 1] < 40) {
      if (!last) continue;
      labelled.pop(); /* el final manda sobre el vértice que tenga encima */
      parts.splice(parts.findLastIndex(t => t.startsWith('<text class="pf-tick vertex"')), 1);
    }
    labelled.push(vx[i]);
    parts.push(`<text class="pf-tick vertex" x="${x}" y="${H - PF_MARGIN.b + 14}" text-anchor="middle">${(vertices[i] / fx).toFixed(2)}</text>`);
  }
  const xt = niceTicks(0, xMax, Math.max(2, Math.floor(pw / 90)));
  const xd = tickDecimals(xt.step);
  for (const u of xt.ticks) {
    const x = PF_MARGIN.l + u / xMax * pw;
    if (labelled.some(v => Math.abs(v - x) < 34)) continue;
    parts.push(`<text class="pf-tick" x="${x.toFixed(1)}" y="${H - PF_MARGIN.b + 14}" text-anchor="middle">${u.toFixed(xd)}</text>`);
  }
  parts.push(`<line class="pf-axis" x1="${PF_MARGIN.l}" x2="${PF_MARGIN.l}" y1="${PF_MARGIN.t}" y2="${H - PF_MARGIN.b}"/>`,
    `<line class="pf-axis" x1="${PF_MARGIN.l}" x2="${W - PF_MARGIN.r}" y1="${H - PF_MARGIN.b}" y2="${H - PF_MARGIN.b}"/>`,
    `<text class="pf-tick" x="${PF_MARGIN.l + pw / 2}" y="${H - 6}" text-anchor="middle">Distancia desde el inicio (${POLY_UNIT_LABEL[measureUnit]})</text>`,
    `<text class="pf-tick" transform="translate(12 ${PF_MARGIN.t + ph / 2}) rotate(-90)" text-anchor="middle">Altura MDS (${POLY_UNIT_LABEL[altitudeUnit]})</text>`);
  for (const line of profilePolylines(points, xOf, yOf)) {
    parts.push(`<polyline class="pf-line" points="${line.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}"/>`);
  }
  parts.push(`<line class="pf-cursor" id="pf-cursor" y1="${PF_MARGIN.t}" y2="${H - PF_MARGIN.b}" visibility="hidden"/>`,
    `<text class="pf-readout" id="pf-readout" y="${PF_MARGIN.t + 10}" visibility="hidden"></text>`);
  profileChart.innerHTML = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${W} ${H}" role="img" `
    + `aria-label="Perfil de alturas a lo largo de la ruta">${parts.join("")}</svg>`;

  /* Lectura bajo el ratón: la celda más cercana a esa distancia */
  const svg = profileChart.firstChild;
  const cursor = svg.querySelector("#pf-cursor"), readout = svg.querySelector("#pf-readout");
  svg.addEventListener("mousemove", e => {
    const r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left) * W / r.width;
    const d = Math.min(total, Math.max(0, (x - PF_MARGIN.l) / pw * xMax * fx));
    const p = nearestProfilePoint(points, d);
    if (!p) return;
    const px = xOf(p.d);
    cursor.setAttribute("x1", px); cursor.setAttribute("x2", px);
    cursor.setAttribute("visibility", "visible");
    readout.textContent = `${fmtUnitDist(p.d, measureUnit)} · ${fmtHeight(p.v, altitudeUnit)}`;
    const right = px > PF_MARGIN.l + pw / 2;
    readout.setAttribute("x", right ? px - 6 : px + 6);
    readout.setAttribute("text-anchor", right ? "end" : "start");
    readout.setAttribute("visibility", "visible");
  });
  svg.addEventListener("mouseleave", () => {
    cursor.setAttribute("visibility", "hidden");
    readout.setAttribute("visibility", "hidden");
  });
}

/* Cambiar una unidad en Propiedades (setMeasureUnit/setAltitudeUnit) o
   el tamaño de la ventana redibuja la gráfica, sin volver a pedir nada. */
function refreshProfileChart() { renderProfileChart(); }
new ResizeObserver(() => renderProfileChart()).observe(profileChart);

/* Botón del diálogo de propiedades de la ruta (44-dialogs.js lo enseña
   solo con una ruta ya creada, y lo deshabilita con el motivo).      */
document.getElementById("ms-profile").addEventListener("click", () => {
  if (styleTargets.length === 1) obtainRouteProfile(styleTargets[0]);
});
