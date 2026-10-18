/* ================= Perfil de una ruta =================
   «Obtener perfil» (menú contextual sobre una ruta, o su diálogo de
   propiedades) descarga del MDT y del MDS elegidos en Propiedades →
   Fuentes de datos las celdas que recorre la ruta y dibuja la altura a
   lo largo de ella, una curva por modelo (MDT azul, MDS verde):
   distancia desde el inicio en horizontal (unidad de distancia), altura
   en vertical (unidad de altitud), con los vértices entre tramos
   marcados en negrita en el eje de distancias. Una flecha sobre la ruta
   en el mapa sigue a la línea vertical de la gráfica.

   La ventana de 40 m de «Consultar elevación aquí» daría cientos de
   peticiones para una ruta de kilómetros, así que aquí se pide por
   TROZOS: cada tramo se corta en piezas cuya caja mide como mucho
   PROFILE_CHUNK_CELLS celdas de lado, y cada pieza es una petición.
   De cada caja se aprovecha solo lo que pisa la ruta: es el precio de
   pedir rectángulos. Las peticiones van una tras otra, respetando el
   tope de peticiones por segundo (demRateWait) y con los reintentos de
   cualquier consulta (withElevRetries).

   Lo que queda en el árbol son SOLO las celdas recorridas, una capa
   «Perfil de «Ruta N» — …» en la carpeta raíz «Perfiles de ruta»: lo
   descargado y no usado se descarta. La capa guarda además las curvas
   (campo `profile`), atadas a la ruta por la GEOMETRÍA
   (routeProfileKey): con eso «Obtener perfil» pasa a «Mostrar perfil»
   y no se vuelve a descargar nada; editar la ruta cambia la clave y
   vuelve a pedir uno nuevo. La longitud de la ruta está acotada
   (profileMaxM, Preferencias) para que una ruta larga no llene
   IndexedDB de celdas.                                               */
const PROFILE_CHUNK_CELLS = 200;   /* celdas de lado, como mucho, por petición */
const PROFILE_SECTION = "Perfiles de ruta";
/* Cotas de un perfil leído de fuera (.kite.json, portapapeles): una
   ruta de 100 NM a 5 m son ~37 000 celdas por serie; un arco, 721
   vértices.                                                          */
const PROFILE_MAX_PTS = 100000;
const PROFILE_MAX_VERTICES = 10000;

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

/* ¿Cuenta el límite de longitud (profileMaxM) con estas fuentes? Solo si
   alguna de las elegidas tiene malla FINA: el límite existe para no
   llenar el árbol de celdas, y una malla de 200 m (`coarse`) deja pocas
   aunque la ruta sea larga. Con las dos en «Ninguna» no hay perfil y
   da igual (routeProfileDisabled lo dice antes).                      */
function profileLimitApplies(sources = elevSources) {
  return ["mdt", "mds"].some(k => {
    const s = sources[k] ? elevSourceById(sources[k]) : null;
    return !!s && !s.coarse;
  });
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

/* Tramos continuos de la curva (los huecos la cortan; `yOf(v, d)` recibe
   también la distancia, que la curvatura terrestre necesita), y en cada uno,
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
    const x = xOf(p.d), y = yOf(p.v, p.d), c = Math.round(x);
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

/* ---------- Ventana de la gráfica: zoom y desplazamiento (puro) ----------
   La gráfica enseña las distancias [x0, x1] de la ruta. Alejar tiene
   tope en la ruta entera; acercar, en `minSpan` (0,1 m por píxel,
   pedido). Siempre dentro de [0, total].                             */
function clampProfileView(x0, span, total, minSpan) {
  const s = Math.min(total, Math.max(Math.min(minSpan, total), span));
  const a = Math.min(total - s, Math.max(0, x0));
  return { x0: a, x1: a + s };
}

/* Zoom con ANCLA: la distancia bajo el ratón (`frac` de la anchura de la
   gráfica) se queda bajo el ratón. `factor` > 1 aleja, < 1 acerca.   */
function zoomProfileView(view, total, minSpan, frac, factor) {
  const span = view.x1 - view.x0;
  const anchor = view.x0 + frac * span;
  const s = Math.min(total, Math.max(Math.min(minSpan, total), span * factor));
  return clampProfileView(anchor - frac * s, s, total, minSpan);
}

/* Desplazar `dd` metros (arrastrar a la derecha = ver lo anterior) */
const panProfileView = (view, total, minSpan, dd) =>
  clampProfileView(view.x0 + dd, view.x1 - view.x0, total, minSpan);

/* ---------- Línea de vista y curvatura terrestre (puro) ----------
   La refracción estándar de la atmósfera dobla la señal hacia el suelo
   como si la Tierra tuviera un radio k veces mayor (k = 4/3). En vez de
   curvar el rayo se levanta el terreno: a una distancia `d` de un
   extremo de un trayecto de longitud `total`, la Tierra de radio k·R
   asoma d·(total − d)/(2·k·R) sobre la cuerda que une los extremos, y
   el rayo recto (la línea inicio–fin) se compara con terreno + eso.
   `d` es la distancia a lo largo de la ruta: en una ruta con giros se
   trata como un trayecto recto, que es lo único que un perfil dibuja.  */
const PF_K_FACTOR = 4 / 3;
function earthBulge(d, total, k = PF_K_FACTOR) {
  if (!(total > 0) || d <= 0 || d >= total) return 0;
  return d * (total - d) / (2 * k * EARTH_R);
}

/* Elipsoide de Fresnel: el radio de la PRIMERA zona a una distancia `d`
   de un extremo de un trayecto de longitud `total` es
   sqrt(λ·d·(total−d)/total), con λ = c/f. Se dibuja la zona del 60 %
   (PF_FRESNEL_ZONE), la que ha de estar libre de obstáculos para no
   perder señal de forma apreciable. Metros; 0 en los extremos y fuera.
   La longitud es la de la ruta, no la de la cuerda: como la línea de
   vista, trata la ruta como un trayecto recto. La frecuencia (MHz) es
   el ajuste global `fresnelFreqMHz` (Propiedades → Frecuencias).      */
const PF_FRESNEL_ZONE = 0.6;
const PF_TOWER_MAX = 10000;     /* m */
const PF_LIGHT_MS = 299792458;
function fresnelRadius(d, total, freqMHz) {
  if (!(total > 0) || !(freqMHz > 0) || d <= 0 || d >= total) return 0;
  return Math.sqrt(PF_LIGHT_MS / (freqMHz * 1e6) * d * (total - d) / total);
}

/* Extremos de la línea inicio–fin: alturas del MDS (la superficie, lo que
   de verdad tapa una señal) y, si no está elegido o no tiene dato, del
   MDT. Primer y último valor NUMÉRICO de la serie: un hueco en un
   extremo (celda sin dato) no impide dibujarla. `series`: las del
   perfil, `{ kind, points }`. Devuelve `{ kind, a, b }` o null.      */
function profileLosEnds(series) {
  for (const kind of ["mds", "mdt"]) {
    const s = series.find(x => x.kind === kind);
    if (!s) continue;
    const nums = s.points.filter(p => typeof p.v === "number");
    if (nums.length) return { kind, a: nums[0].v, b: nums[nums.length - 1].v };
  }
  return null;
}

/* Zoom del eje de ALTURAS: el intervalo {a, b} (metros) con ancla `frac`
   contada desde abajo, y anchura entre minSpan y maxSpan. Sin topes de
   dominio: con el eje bloqueado se puede mirar por encima o por debajo
   de la curva.                                                      */
function zoomRange(r, frac, factor, minSpan, maxSpan) {
  const span = r.b - r.a, anchor = r.a + frac * span;
  const s = Math.min(maxSpan, Math.max(minSpan, span * factor));
  return { a: anchor - frac * s, b: anchor - frac * s + s };
}

/* Decimales para leer una distancia con `mPerPx` metros por píxel en la
   unidad de factor `f`: los que distinguen un píxel, de 2 a 6.      */
const distDecimals = (mPerPx, f) => Math.max(2, Math.min(6, tickDecimals(mPerPx / f)));

/* Los puntos que se ven en [x0, x1], más el vecino de cada lado para que
   la curva llegue hasta el borde (recortada por el clipPath). `points`
   va ordenado por distancia.                                        */
function visibleProfilePoints(points, x0, x1) {
  let a = 0, b = points.length;
  while (a < points.length && points[a].d < x0) a++;
  while (b > 0 && points[b - 1].d > x1) b--;
  return points.slice(Math.max(0, a - 1), Math.min(points.length, b + 1));
}

/* La geometría de una ruta como clave de su perfil: los waypoints a 7
   decimales (~1 cm). Sin id nuevo en las rutas, y vale tras guardar,
   deshacer, exportar o copiar; mover un vértice da otra clave, y el
   perfil viejo deja de ser el de esta ruta.                          */
function routeProfileKey(waypoints) {
  return waypoints.map(p => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`).join(";");
}

/* Inversa de routeProfileSamples: el punto de la ruta (metros Web
   Mercator, sobre la línea tal como se dibuja) a una distancia `d`
   desde el inicio, y el ángulo de su tramo (grados, antihorario desde
   el este, con y hacia el norte). Es lo que coloca la flecha del mapa
   en el sitio que marca el cursor de la gráfica.                     */
function profilePointAt(legs, vertices, d) {
  if (!legs.length) return null;
  let i = 0;
  while (i < legs.length - 1 && d > vertices[i + 1]) i++;
  const leg = legs[i];
  const t = leg.dist > 0 ? Math.min(1, Math.max(0, (d - vertices[i]) / leg.dist)) : 0;
  return {
    x: leg.a.x + (leg.b.x - leg.a.x) * t, y: leg.a.y + (leg.b.y - leg.a.y) * t,
    angle: Math.atan2(leg.b.y - leg.a.y, leg.b.x - leg.a.x) * 180 / Math.PI
  };
}

/* Curva compacta para guardar: [d, v] con d a 0,1 m y v a 0,01 m (un
   perfil de 10 NM son ~4000 pares por serie), y de vuelta.          */
const packProfilePoints = points => points.map(p => [Math.round(p.d * 10) / 10,
  typeof p.v === "number" ? Math.round(p.v * 100) / 100 : null]);
const unpackProfilePoints = pts => pts.map(([d, v]) => ({ d, v }));

/* Un perfil leído de fuera (árbol guardado, .kite.json, portapapeles)
   es entrada ajena: forma exacta, números finitos, longitudes
   acotadas y vértices crecientes, o null (la capa queda como una
   cuadrícula normal, sin perfil que mostrar).                        */
function validRouteProfile(p) {
  const fin = x => typeof x === "number" && Number.isFinite(x);
  if (!p || typeof p !== "object" || typeof p.key !== "string" || !p.key) return null;
  if (!fin(p.total) || p.total <= 0) return null;
  const v = p.vertices;
  if (!Array.isArray(v) || v.length < 2 || v.length > PROFILE_MAX_VERTICES || !v.every(fin)) return null;
  for (let i = 1; i < v.length; i++) if (v[i] < v[i - 1]) return null;
  /* null = sin esa serie; undefined = serie mal formada */
  const series = s => {
    if (s === null || s === undefined) return null;
    if (typeof s !== "object" || typeof s.src !== "string" || !Array.isArray(s.pts)) return undefined;
    if (!s.pts.length || s.pts.length > PROFILE_MAX_PTS) return undefined;
    const good = s.pts.every(q => Array.isArray(q) && q.length === 2 && fin(q[0]) && (q[1] === null || fin(q[1])));
    return good ? { src: s.src, pts: s.pts } : undefined;
  };
  const mdt = series(p.mdt), mds = series(p.mds);
  if (mdt === undefined || mds === undefined || (!mdt && !mds)) return null;
  return { key: p.key, total: p.total, vertices: v, mdt, mds };
}

/* Celdas del árbol de un perfil, con la misma regla que buildElevCells:
   manda la malla de `drive` (la más fina) y `other` aporta su valor en
   el centro de cada celda (`valueAt(center)`, número o null). Solo las
   celdas RECORRIDAS (los puntos de la curva) con algún dato. `kinds`:
   los modelos consultados (el otro no lleva clave).                  */
function profileTreeCells(drive, other, kinds) {
  const cells = [];
  for (const p of drive.points) {
    if (!p.ref) continue;
    const { grid, r, c } = p.ref;
    const b = gridCellBounds(grid, r, c);
    const sw = gridToLatLng(grid, b.x0, b.y0), ne = gridToLatLng(grid, b.x1, b.y1);
    if (!sw || !ne) continue;
    const center = [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2];
    const own = typeof p.v === "number" ? p.v : null;
    const theirs = other ? other.valueAt(center) : null;
    const mdt = drive.kind === "mdt" ? own : theirs, mds = drive.kind === "mds" ? own : theirs;
    if (mdt === null && mds === null) continue;
    const cell = { sw, ne, center };
    if (kinds.mdt) cell.mdt = mdt;
    if (kinds.mds) cell.mds = mds;
    cell.diff = typeof mdt === "number" && typeof mds === "number" ? mds - mdt : null;
    cells.push(cell);
  }
  return cells;
}

/* ---------- Diálogo ---------- */
const profileDialog = document.getElementById("profile-dialog");
const profileBox = profileDialog.querySelector(".dlg-box");
const profileChart = document.getElementById("profile-chart");
makeDialogMovable(profileBox);
setupDialog(profileBox, { modal: false }); /* flotante: el mapa sigue vivo */

let profileRun = null;   /* { ctl } mientras descarga                  */
/* Lo que dibuja la gráfica: { total, vertices, series: [{ kind, label,
   points }], legs, li }. `legs` y `li` son los de la ruta, para la
   flecha del mapa.                                                   */
let profileData = null;

function setProfileProgress(done, total, what = "MDS") {
  const pct = total ? Math.round(100 * done / total) : 0;
  document.getElementById("profile-progress-fill").style.width = `${pct}%`;
  document.getElementById("profile-progress-label").textContent = total
    ? `Descargando celdas ${what}: ${pct} % (${done} de ${total} zona${total === 1 ? "" : "s"})`
    : "Consultando el servicio…";
}

/* Registro de depuración de la descarga: lo que la aplicación pide a
   cada servicio y lo que recibe (ver `trace` en 60-elevation.js). Vive
   en el bloque de progreso y se va con él al terminar. Los mensajes de
   un servicio son ajenos: siempre por textContent. Sigue al final
   salvo que el usuario haya subido a leer.                         */
const PROFILE_LOG_MAX = 3000; /* líneas; se descartan las más viejas */
const PROFILE_LOG_PREFIX = { req: "→ ", res: "← ", err: "✗ ", info: "  ", head: "" };
const profileLogBox = document.getElementById("profile-log");
let profileLogStart = 0;

function resetProfileLog() {
  profileLogBox.textContent = "";
  profileLogStart = performance.now();
}

function profileLog(kind, txt) {
  const box = profileLogBox;
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  const row = document.createElement("div");
  row.className = `pl-${kind}`;
  const secs = ((performance.now() - profileLogStart) / 1000).toFixed(1).padStart(6);
  row.textContent = `${secs} s  ${PROFILE_LOG_PREFIX[kind] ?? ""}${txt}`;
  box.appendChild(row);
  while (box.childElementCount > PROFILE_LOG_MAX) box.firstChild.remove();
  if (atEnd) box.scrollTop = box.scrollHeight;
}

function setProfileNote(txt) {
  const el = document.getElementById("profile-note");
  el.hidden = !txt;
  el.textContent = txt || "";
}

/* The header's × aborts while downloading and closes afterwards: its
   name says which (it has no visible text to say it).             */
function setProfileCloseLabel(txt) {
  const btn = document.getElementById("profile-close");
  btn.title = txt;
  btn.setAttribute("aria-label", txt);
}

function openProfileDialog(title) {
  hideProfileArrow();
  document.getElementById("profile-title").textContent = title;
  document.getElementById("profile-progress").hidden = false;
  resetProfileLog();
  profileChart.hidden = true; /* sin gráfica todavía: el sitio es del registro */
  setProfileCloseLabel("Cancelar la descarga");
  setProfileProgress(0, 0);
  setProfileNote("");
  profileData = null;
  profileView = null; /* un perfil nuevo empieza con la ruta entera */
  profileYView = null; /* y con la altura automática */
  profileLayout = null;
  showProfileTools(false);
  profileChart.innerHTML = "";
  profileDialog.hidden = false;
  clampToViewport(profileBox);
  focusDialog(profileBox);
}

/* Fin de la descarga (o perfil ya guardado): fuera la barra, «Cerrar» */
function profileDialogDone() {
  document.getElementById("profile-progress").hidden = true;
  profileChart.hidden = false;
  setProfileCloseLabel("Cerrar");
}

/* Cancelar (descargando) o Cerrar (con la gráfica): lo mismo, abortar
   lo que quede en vuelo. Cancelar a mitad no deja nada en el árbol. */
function closeProfileDialog() {
  if (profileRun) profileRun.ctl.abort();
  endProfileDrag();
  hideProfileCursor();
  if (profileDialog.hidden) return;
  profileDialog.hidden = true;
  releaseFocus();
}
document.getElementById("profile-close").addEventListener("click", closeProfileDialog);

/* ---------- La ruta y su perfil ---------- */
const isRouteLi = li => !!(li && li._measure && li._measure.type === "route");

/* El perfil guardado de una geometría, o null. elevGridGroups ya es la
   lista viva de cuadrículas (también las de carpetas nunca desplegadas;
   borrar y deshacer la mantienen), así que no hace falta otro registro. */
function findRouteProfile(key) {
  const g = elevGridGroups.find(x => x._profile && x._profile.key === key);
  return g ? g._profile : null;
}
const routeProfileOf = li => (isRouteLi(li) ? findRouteProfile(routeProfileKey(measureWaypoints(li._measure))) : null);

/* Por qué no se puede OBTENER el perfil de esta ruta, o false: es el
   `disabled()` del menú contextual y el title del botón del diálogo.
   Mostrar uno ya guardado no pide nada y no tiene motivo para no.    */
function routeProfileDisabled(li) {
  if (!isRouteLi(li)) return "Solo una ruta tiene perfil.";
  if (!elevSources.mdt && !elevSources.mds) return ELEV_NO_SOURCES_WHY;
  const m = li._measure;
  if (profileLimitApplies() && m.totalDist > profileMaxM) {
    return `La ruta mide ${fmtUnitDist(m.totalDist, measureUnit)} y el límite de un perfil con las `
      + `fuentes elegidas es ${fmtUnitDist(profileMaxM, measureUnit)} (Propiedades → Preferencias).`;
  }
  return false;
}

/* El ítem del menú contextual de una ruta, con una capa debajo o sin
   ella (70-view-controls.js): «Mostrar» si ya tiene perfil.          */
function routeProfileCtxItem(li) {
  const has = !!routeProfileOf(li);
  return { label: has ? "Mostrar perfil" : "Obtener perfil", action: () => openRouteProfile(li),
           disabled: () => (has ? false : routeProfileDisabled(li)) };
}

/* Entrada única del botón y del menú: lo guardado si lo hay (sin red y
   sin capa nueva), si no, descargarlo.                               */
function openRouteProfile(li) {
  const saved = routeProfileOf(li);
  if (saved) showSavedProfile(li, saved);
  else obtainRouteProfile(li);
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

const PROFILE_KIND_LABEL = { mdt: "MDT", mds: "MDS" };
const profileSeriesLabel = (kind, srcId) => {
  const src = elevSourceById(srcId);
  return src ? elevSourcesLabel([src]) : PROFILE_KIND_LABEL[kind];
};

/* El perfil guardado en la capa, a la gráfica tal cual */
function showSavedProfile(li, prof) {
  if (profileRun) profileRun.ctl.abort();
  openProfileDialog(`Perfil: ${li._name}`);
  profileDialogDone();
  profileData = {
    total: prof.total, vertices: prof.vertices, legs: profileLegs(li._measure), li,
    series: ["mdt", "mds"].filter(k => prof[k]).map(k => ({
      kind: k, label: profileSeriesLabel(k, prof[k].src), points: unpackProfilePoints(prof[k].pts)
    }))
  };
  renderProfileChart();
}

const profileFailText = err => (err.name === "TimeoutError" ? "el servicio no responde"
  : err.name === "TypeError"
    ? netFailText("el servicio no está disponible o no admite consultas desde el navegador (CORS)")
    : err.message);

async function obtainRouteProfile(li) {
  const why = routeProfileDisabled(li);
  if (why) { navMessage(why); return; }
  if (profileRun) profileRun.ctl.abort();
  const m = li._measure;
  const key = routeProfileKey(measureWaypoints(m));
  /* Las fuentes elegidas, MDT primero; una en «Ninguna» no se pide */
  const runs = ["mdt", "mds"].filter(k => elevSources[k])
    .map(kind => ({ kind, src: elevSourceById(elevSources[kind]), grids: [], failed: 0 }));
  const what = runs.map(s => PROFILE_KIND_LABEL[s.kind]).join(" y ");
  const run = { ctl: new AbortController() };
  profileRun = run;
  openProfileDialog(`Perfil: ${li._name}`);
  const notes = [];
  const srcName = s => elevSourcesLabel([s.src]);
  profileLog("head", `«${li._name}»: ${measureWaypoints(m).length} waypoints, `
    + `${fmtUnitDist(m.totalDist, measureUnit)} · fuentes: ${runs.map(srcName).join(", ")}`);
  try {
    const legs = profileLegs(m);
    /* Descubrimiento de cada fuente: la que falla se cuenta y se sigue
       con la otra; solo sin ninguna se da el perfil por perdido.     */
    for (const s of runs) {
      s.client = sourceClient(s.src.id);
      profileLog("head", `${srcName(s)} — ${s.src.base}`);
      try {
        const cfg = await s.client.discover(profileLog);
        s.cell = cfg.cellMeters > 0 ? cfg.cellMeters : 30;
        s.pieces = profilePieces(legs, s.cell);
        profileLog("info", `celda ${s.cell.toFixed(2)} m → ${s.pieces.length} zona(s) a lo largo de la ruta`);
      } catch (err) {
        if (run.ctl.signal.aborted) return;
        s.dead = profileFailText(err);
        profileLog("err", `${srcName(s)}: ${s.dead}`);
      }
      if (run.ctl.signal.aborted) return;
    }
    const live = runs.filter(s => !s.dead);
    for (const s of runs.filter(x => x.dead)) notes.push(`${s.src.dataset}: ${s.dead}.`);
    if (!live.length) throw Object.assign(new Error(runs.map(s => s.dead).join("; ")), { name: "ProfileError" });

    /* Una sola cola, secuencial (el tope de peticiones por segundo es
       de todas las fuentes): la barra cuenta las zonas de las dos.   */
    const total = live.reduce((n, s) => n + s.pieces.length, 0);
    let done = 0;
    setProfileProgress(0, total, what);
    for (const s of live) {
      for (const [i, q] of s.pieces.entries()) {
        const sw = map.options.crs.unproject(L.point(q.x0, q.y0));
        const ne = map.options.crs.unproject(L.point(q.x1, q.y1));
        profileLog("head", `${srcName(s)} · zona ${i + 1} de ${s.pieces.length}: `
          + `lat ${sw.lat.toFixed(5)}…${ne.lat.toFixed(5)}, lon ${sw.lng.toFixed(5)}…${ne.lng.toFixed(5)}`);
        const res = await s.client.area({ south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng },
          run.ctl.signal, profileLog);
        if (res.grid !== undefined) s.answered = true;
        if (res.grid && res.grid.located) s.grids.push(res.grid);
        if (res.grid === null) profileLog("info", "sin datos en esta zona");
        if (res.error) { s.failed++; s.lastError = res.error; profileLog("err", `zona sin respuesta: ${res.error}`); }
        setProfileProgress(++done, total, what);
      }
      if (s.answered) addElevAttribution(s.src.id);
      if (s.failed) {
        notes.push(`${s.src.dataset}: ${s.failed} de ${s.pieces.length} zonas sin respuesta (${s.lastError}): salen como huecos.`);
      }
    }
    profileDialogDone();

    /* Muestras a media celda de la malla MÁS FINA; cada serie funde
       las de su propia celda (MDT200 da un punto cada 200 m).        */
    const { samples, vertices, total: length } = routeProfileSamples(legs, Math.min(...live.map(s => s.cell)));
    for (const s of live) {
      s.lookup = makeProfileLookup(s.grids);
      s.points = profileFromSamples(samples, s.lookup);
    }
    const withData = live.filter(s => s.points.some(p => typeof p.v === "number"));
    if (!withData.length) {
      notes.push("Sin datos de elevación a lo largo de la ruta (fuera de la cobertura de las fuentes elegidas).");
      setProfileNote(notes.join(" "));
      return;
    }
    setProfileNote(notes.join(" "));
    const prof = { key, total: length, vertices, mdt: null, mds: null };
    for (const s of withData) prof[s.kind] = { src: s.src.id, pts: packProfilePoints(s.points) };
    profileData = {
      total: length, vertices, legs, li,
      series: withData.map(s => ({ kind: s.kind, label: elevSourcesLabel([s.src]), points: s.points }))
    };
    renderProfileChart();

    /* Al árbol, solo las celdas recorridas: las de la malla más fina
       (a igualdad, el terreno), con el valor de la otra en su centro. */
    const [drive, other] = withData.length === 2 && withData[1].cell < withData[0].cell * 0.99
      ? [withData[1], withData[0]] : withData;
    const valueAt = other && (center => {
      const hit = other.lookup(toWebMercator(center[0], center[1]));
      return hit && typeof hit.value === "number" ? hit.value : null;
    });
    const kinds = { mdt: live.some(s => s.kind === "mdt"), mds: live.some(s => s.kind === "mds") };
    const cells = profileTreeCells(drive, other ? { valueAt } : null, kinds);
    pushUndo("obtener perfil");
    const node = makeElevGridNode(elevNodeName(`Perfil de «${li._name}»`, live.map(s => s.src)), cells, prof);
    ensureNamedSection(PROFILE_SECTION).appendChild(node);
    refreshAncestorChecks(node);
    scheduleSave();
  } catch (err) {
    if (run.ctl.signal.aborted) return;
    profileDialogDone();
    notes.push(`No se pudo obtener el perfil: ${err.name === "ProfileError" ? err.message : profileFailText(err)}.`);
    setProfileNote(notes.join(" "));
  } finally {
    if (profileRun === run) profileRun = null;
  }
}

/* ---------- Gráfica (SVG propio) ----------
   Rueda = zoom de DISTANCIA con ancla en el ratón; Mayús+rueda, o la
   rueda sobre el eje de alturas, zoom de ALTURA; arrastrar = desplazar.
   La vista de distancias (`profileView`, [x0, x1]) va de la ruta entera
   a 0,1 m por píxel. La altura se ajusta sola a lo que se ve, salvo con
   el eje Y BLOQUEADO (`profileYView`, [a, b] en metros): entonces se
   queda quieta al desplazar o acercar la distancia. Hacer zoom de
   altura lo bloquea; desbloquear vuelve al ajuste automático. Los
   botones de la barra (`#profile-tools`) hacen lo mismo centrados.
   El SVG se rehace entero en cada cambio (un fotograma:
   `scheduleProfileChart`), así que los escuchas viven en el
   contenedor, no en el SVG.

   Las series se dibujan como `<polyline>`: SEGMENTOS RECTOS entre los
   valores de celdas consecutivas, sin curvas ni suavizado (la prueba lo
   comprueba vértice a vértice).                                      */
const PF_MARGIN = { l: 64, r: 22, t: 26, b: 40 }; /* r: la última cifra del eje (centrada en el borde) cabe entera */
const SVG_NS = "http://www.w3.org/2000/svg";
const PF_SNAP_PX = 8;          /* la lectura de una serie, si tiene un punto a menos de esto */
const PF_MIN_M_PER_PX = 0.1;   /* zoom máximo: 0,1 m de ruta por píxel (pedido) */
const PF_WHEEL_STEP = 0.0015;  /* factor de zoom = e^(píxeles de rueda × esto) */
const PF_Y_MIN_SPAN = 0.1;     /* m: altura mínima a la vista               */
const PF_Y_MAX_SPAN = 20000;   /* m: altura máxima a la vista               */
const PF_DRAG_LOCK_PX = 8;     /* px verticales que convierten un arrastre en desplazamiento de altura */

let profileView = null;   /* { x0, x1 } en metros; null = la ruta entera */
/* Opciones de la gráfica, de SESIÓN (como el resto de su estado, sin
   guardar): sobreviven a abrir otro perfil porque son del modo de mirar
   y no del perfil.                                                    */
let profileShowLos = false; /* recta negra inicio–fin                      */
let profileEarth = false;   /* curvatura terrestre con k = 4/3             */
let profileFresnel = false; /* elipsoide de Fresnel (zona del 60 %)        */
/* Alturas de torre SOBRE EL TERRENO en el inicio y en el final, metros
   (se escriben en la unidad de altitud): suben los extremos de la recta. */
const profileTowerM = { a: 0, b: 0 };
let profileYView = null;  /* { a, b } en metros: eje Y bloqueado; null = automático */
let profileLayout = null; /* geometría de la última gráfica dibujada     */
let profileFrame = 0;
let profileDrag = null;   /* { x, y, view, yView } mientras se arrastra */
const profileTools = document.getElementById("profile-tools");
const profileFoot = document.getElementById("profile-foot");
const profileInfoRows = Object.fromEntries([...document.querySelectorAll("#profile-info .pf-info-row")]
  .map(r => [r.dataset.k, r]));
/* Cabecera y pie van y vienen juntos: con la gráfica, no antes */
const showProfileTools = on => { profileTools.hidden = !on; profileFoot.hidden = !on; };
const profileYLock = document.getElementById("pf-y-lock");
const profileLosBox = document.getElementById("pf-los");
const profileEarthBox = document.getElementById("pf-earth");
const profileFresnelBox = document.getElementById("pf-fresnel");
const profileTowerInput = { a: document.getElementById("pf-tower-a"), b: document.getElementById("pf-tower-b") };

/* Anchura útil de la gráfica en píxeles, y el tope de zoom que da */
const profilePlotWidth = () => profileChart.clientWidth - PF_MARGIN.l - PF_MARGIN.r;
const profileMinSpan = () => PF_MIN_M_PER_PX * Math.max(1, profilePlotWidth());

function renderProfileChart() {
  /* la x del ratón sobrevive al redibujo: la línea sigue bajo él */
  const lastX = profileLayout ? profileLayout.lastX : undefined;
  profileLayout = null;
  if (!profileData || profileDialog.hidden) return;
  const { series, vertices, total } = profileData;
  const W = profileChart.clientWidth, H = profileChart.clientHeight;
  if (W < 80 || H < 60) return;
  const pw = W - PF_MARGIN.l - PF_MARGIN.r, ph = H - PF_MARGIN.t - PF_MARGIN.b;
  const v0 = profileView || { x0: 0, x1: total };
  const { x0, x1 } = clampProfileView(v0.x0, v0.x1 - v0.x0, total, PF_MIN_M_PER_PX * pw);
  profileView = { x0, x1 };
  const span = x1 - x0;
  const fx = POLY_UNIT_FACTOR[measureUnit], fy = POLY_UNIT_FACTOR[altitudeUnit];
  /* Con la curvatura, el terreno se dibuja elevado lo que asoma la
     Tierra sobre la cuerda entre los extremos (`lift`, metros): todo lo
     que se pinta a una distancia d pasa por ahí.                      */
  const lift = d => (profileEarth ? earthBulge(d, total) : 0);
  /* Los extremos de la recta inicio–fin salen de la serie ENTERA, no de
     la parte a la vista; `losAt` es su altura a la distancia d.        */
  const ground = (profileShowLos || profileFresnel) ? profileLosEnds(series) : null;
  const los = ground && { kind: ground.kind, a: ground.a + profileTowerM.a, b: ground.b + profileTowerM.b };
  const losAt = d => los.a + (los.b - los.a) * d / total;
  const fresnel = d => fresnelRadius(d, total, fresnelFreqMHz);
  /* Lo visible de cada serie: la altura se ajusta a ESO, no a la ruta */
  const shown = series.map(s => ({ ...s, points: visibleProfilePoints(s.points, x0, x1) }));
  const vals = shown.flatMap(s => s.points.filter(p => typeof p.v === "number" && p.d >= x0 && p.d <= x1)
    .map(p => (p.v + lift(p.d)) / fy));
  if (!vals.length) vals.push(...shown.flatMap(s => s.points.filter(p => typeof p.v === "number").map(p => (p.v + lift(p.d)) / fy)));
  if (!vals.length) vals.push(0);
  /* La recta y el arco de la Tierra también tienen que caber a la vista
     (el arco parte del nivel del mar, así que lo trae a la escala); el
     punto más alto del arco es el central de lo visible, el más bajo el
     borde más cercano a un extremo.                                  */
  if (los) vals.push(losAt(x0) / fy, losAt(x1) / fy);
  if (los && profileFresnel) {
    const m = Math.min(x1, Math.max(x0, total / 2)); /* el radio es máximo en el centro */
    vals.push((losAt(m) + fresnel(m)) / fy, (losAt(m) - fresnel(m)) / fy);
  }
  if (profileEarth) vals.push(lift(x0) / fy, lift(x1) / fy, lift(Math.min(x1, Math.max(x0, total / 2))) / fy);
  /* Alturas en METROS: automático = lo visible con un margen; con el
     eje bloqueado, el intervalo guardado, quieto.                    */
  let ym;
  if (profileYView) ym = { ...profileYView };
  else {
    const lo = Math.min(...vals) * fy, hi = Math.max(...vals) * fy;
    const pad = (hi - lo) * 0.08 || Math.max(1, Math.abs(lo) * 0.05) || 1;
    ym = { a: lo - pad, b: hi + pad };
  }
  const y0 = ym.a / fy, y1 = ym.b / fy;
  const xOf = d => PF_MARGIN.l + (d - x0) / span * pw;
  const yPix = u => PF_MARGIN.t + (1 - (u - y0) / (y1 - y0)) * ph;
  const yOf = (v, d = 0) => yPix((v + lift(d)) / fy);
  profileLayout = { W, H, pw, ph, x0, x1, total, ym, xOf, yOf, lift, los, losAt, fresnel,
                    dOf: x => x0 + (x - PF_MARGIN.l) / pw * span };

  const parts = [`<clipPath id="pf-clip"><rect x="${PF_MARGIN.l}" y="${PF_MARGIN.t}" width="${pw}" height="${ph}"/></clipPath>`];
  const yt = niceTicks(y0, y1, Math.max(2, Math.floor(ph / 36)));
  const yd = tickDecimals(yt.step);
  for (const u of yt.ticks) {
    const y = yPix(u).toFixed(1);
    parts.push(`<line class="pf-grid" x1="${PF_MARGIN.l}" x2="${W - PF_MARGIN.r}" y1="${y}" y2="${y}"/>`,
      `<text class="pf-tick" x="${PF_MARGIN.l - 6}" y="${y}" text-anchor="end" dominant-baseline="middle">${u.toFixed(yd)}</text>`);
  }
  /* Vértices a la vista: línea discontinua y su distancia en NEGRITA.
     Una cifra que se montaría sobre la anterior se omite (un arco son
     decenas de tramos cortos), pero su línea se dibuja; el final de la
     ruta siempre lleva la suya. Las marcas redondas que caerían encima
     de una se omiten.                                                */
  const eps = span * 1e-9;
  const inView = vertices.map((d, i) => ({ d, i })).filter(v => v.d >= x0 - eps && v.d <= x1 + eps);
  const labelled = [];
  for (const { d, i } of inView) {
    const vx = xOf(d), x = vx.toFixed(1);
    parts.push(`<line class="pf-vertex" x1="${x}" x2="${x}" y1="${PF_MARGIN.t}" y2="${H - PF_MARGIN.b}"/>`);
    const last = i === vertices.length - 1;
    if (labelled.length && vx - labelled[labelled.length - 1] < 40) {
      if (!last) continue;
      labelled.pop(); /* el final manda sobre el vértice que tenga encima */
      parts.splice(parts.findLastIndex(t => t.startsWith('<text class="pf-tick vertex"')), 1);
    }
    labelled.push(vx);
    parts.push(`<text class="pf-tick vertex" x="${x}" y="${H - PF_MARGIN.b + 14}" text-anchor="middle">${(d / fx).toFixed(vertexDecimals(span / fx))}</text>`);
  }
  const xt = niceTicks(x0 / fx, x1 / fx, Math.max(2, Math.floor(pw / 90)));
  const xd = tickDecimals(xt.step);
  for (const u of xt.ticks) {
    const x = xOf(u * fx);
    if (labelled.some(v => Math.abs(v - x) < 34)) continue;
    parts.push(`<text class="pf-tick" x="${x.toFixed(1)}" y="${H - PF_MARGIN.b + 14}" text-anchor="middle">${u.toFixed(xd)}</text>`);
  }
  parts.push(`<line class="pf-axis" x1="${PF_MARGIN.l}" x2="${PF_MARGIN.l}" y1="${PF_MARGIN.t}" y2="${H - PF_MARGIN.b}"/>`,
    `<line class="pf-axis" x1="${PF_MARGIN.l}" x2="${W - PF_MARGIN.r}" y1="${H - PF_MARGIN.b}" y2="${H - PF_MARGIN.b}"/>`,
    `<text class="pf-tick" x="${PF_MARGIN.l + pw / 2}" y="${H - 6}" text-anchor="middle">Distancia desde el inicio (${POLY_UNIT_LABEL[measureUnit]})</text>`,
    `<text class="pf-tick" transform="translate(12 ${PF_MARGIN.t + ph / 2}) rotate(-90)" text-anchor="middle">${profileEarth ? "Altura + curvatura k = 4/3" : "Altura"} (${POLY_UNIT_LABEL[altitudeUnit]})</text>`);
  /* Las curvas (MDT azul, MDS verde, por su clase), recortadas al área
     de la gráfica, y su leyenda en el margen de arriba.               */
  let lx = PF_MARGIN.l;
  /* Una entrada de leyenda, solo si cabe entera: en una ventana estrecha
     se pierde la última antes que verla cortada (los nombres, además,
     están en el rectángulo de lectura).                                */
  const legend = (cls, label) => {
    const w = 34 + label.length * 6.5;
    if (lx + w > W - PF_MARGIN.r + 12) return;
    parts.push(`<line class="pf-legend ${cls}" x1="${lx}" x2="${lx + 18}" y1="11" y2="11"/>`,
      `<text class="pf-tick pf-legend-label" x="${lx + 22}" y="11" dominant-baseline="middle">${escapeHtml(label)}</text>`);
    lx += w;
  };
  /* Tierra al fondo, bajo las curvas: un arco del nivel del mar con el
     relleno suave por debajo, recortado como ellas.                   */
  if (profileEarth) {
    const n = Math.max(2, Math.min(400, Math.ceil(pw / 4)));
    const arc = Array.from({ length: n + 1 }, (_, i) => {
      const d = x0 + span * i / n;
      return `${xOf(d).toFixed(1)},${yPix(earthBulge(d, total) / fy).toFixed(1)}`;
    });
    const floor = H - PF_MARGIN.b;
    parts.push(`<polygon class="pf-earth-fill" clip-path="url(#pf-clip)" points="${arc.join(" ")} ${xOf(x1).toFixed(1)},${floor} ${xOf(x0).toFixed(1)},${floor}"/>`,
      `<polyline class="pf-earth" clip-path="url(#pf-clip)" points="${arc.join(" ")}"/>`);
  }
  /* Elipsoide de Fresnel alrededor de la recta: el contorno de la primera
     zona (discontinuo) y, dentro, la del 60 % rellena. Mismo marco que
     el terreno: con la curvatura activa, el terreno ya va elevado y la
     recta y el elipsoide siguen siendo rectos, así que lo que se ve
     entrar en la zona es lo que de verdad la invade.                */
  if (los && profileFresnel) {
    const n = Math.max(2, Math.min(400, Math.ceil(pw / 4)));
    const ring = k => {
      const up = [], down = [];
      for (let i = 0; i <= n; i++) {
        const d = x0 + span * i / n, c = losAt(d), r = k * fresnel(d), x = xOf(d).toFixed(1);
        up.push(`${x},${yPix((c + r) / fy).toFixed(1)}`);
        down.push(`${x},${yPix((c - r) / fy).toFixed(1)}`);
      }
      return up.concat(down.reverse()).join(" ");
    };
    parts.push(`<polygon class="pf-fresnel" clip-path="url(#pf-clip)" points="${ring(1)}"/>`,
      `<polygon class="pf-fresnel60" clip-path="url(#pf-clip)" points="${ring(PF_FRESNEL_ZONE)}"/>`);
  }
  for (const s of shown) {
    for (const line of profilePolylines(s.points, xOf, yOf)) {
      parts.push(`<polyline class="pf-line ${s.kind}" clip-path="url(#pf-clip)" points="${line.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}"/>`);
    }
    legend(s.kind, s.label);
  }
  /* La recta, encima de las curvas; se dibuja solo lo visible (con 0,1 m
     por píxel, los extremos de una ruta larga caerían a cientos de miles
     de píxeles).                                                       */
  const extras = [];
  if (los && profileShowLos) {
    parts.push(`<line class="pf-los" clip-path="url(#pf-clip)" x1="${xOf(x0).toFixed(1)}" x2="${xOf(x1).toFixed(1)}" `
      + `y1="${yPix(losAt(x0) / fy).toFixed(1)}" y2="${yPix(losAt(x1) / fy).toFixed(1)}"/>`);
    extras.push({ cls: "los", label: `Línea inicio–fin (${PROFILE_KIND_LABEL[los.kind]})` });
  }
  /* Las torres: del terreno a la antena, en el inicio y en el final
     (solo las que están a la vista y miden algo).                    */
  if (los) {
    for (const [d, g, h] of [[0, ground.a, profileTowerM.a], [total, ground.b, profileTowerM.b]]) {
      if (!(h > 0) || d < x0 - eps || d > x1 + eps) continue;
      parts.push(`<line class="pf-tower" clip-path="url(#pf-clip)" x1="${xOf(d).toFixed(1)}" x2="${xOf(d).toFixed(1)}" `
        + `y1="${yPix(g / fy).toFixed(1)}" y2="${yPix((g + h) / fy).toFixed(1)}"/>`);
    }
  }
  if (los && profileFresnel) {
    extras.push({ cls: "fresnel", label: `Fresnel ${fresnelFreqMHz} MHz (zona ${Math.round(PF_FRESNEL_ZONE * 100)} %)` });
  }
  if (profileEarth) extras.push({ cls: "earth", label: "Tierra (k = 4/3)" });
  for (const e of extras) legend(e.cls, e.label);
  parts.push(`<line class="pf-cursor" id="pf-cursor" y1="${PF_MARGIN.t}" y2="${H - PF_MARGIN.b}" visibility="hidden"/>`);
  profileChart.innerHTML = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${W} ${H}" role="img" `
    + `aria-label="Perfil de alturas a lo largo de la ruta">${parts.join("")}</svg>`;
  profileChart.classList.toggle("zoomed", span < total - eps || !!profileYView);
  showProfileTools(true);
  profileYLock.checked = !!profileYView;
  profileLosBox.checked = profileShowLos;
  profileEarthBox.checked = profileEarth;
  profileFresnelBox.checked = profileFresnel;
  syncProfileInputs();
  if (lastX !== undefined) showProfileCursor(lastX);
  else setProfileInfo(null);
}

/* Los campos de torre (en la unidad de altitud) reflejan el estado; el que se está escribiendo no se pisa (un redibujo por
   cambio de unidad o de tamaño no debe borrar lo tecleado), salvo con
   `force` (al confirmar).                                            */
function syncProfileInputs(force = false) {
  const fy = POLY_UNIT_FACTOR[altitudeUnit];
  const put = (el, v) => { if (force || document.activeElement !== el) el.value = v; };
  put(profileTowerInput.a, Number((profileTowerM.a / fy).toPrecision(6)));
  put(profileTowerInput.b, Number((profileTowerM.b / fy).toPrecision(6)));
  for (const el of document.querySelectorAll(".pf-tower-unit")) el.textContent = POLY_UNIT_LABEL[altitudeUnit];
}

/* Cifras de los vértices: con zoom hacen falta más decimales que las
   dos de la ruta entera (a 0,1 m por píxel, una pantalla son ~0,04 NM). */
const vertexDecimals = spanUnits => Math.max(2, Math.min(5, tickDecimals(spanUnits / 10) + 1));

/* Rectángulo de lectura (#profile-info, fuera del SVG: no tapa las curvas
   ni se mueve con el ratón). `values`: { clave: { txt, alert } } de las
   filas con dato bajo el cursor, o null en reposo (todo guiones). Una fila
   cuya opción no está activada, o cuya serie no existe, queda atenuada
   —nunca oculta, para que la caja no cambie de tamaño— y sin valor. El
   texto, por textContent: lo que sale de la lectura nunca es HTML.      */
function setProfileInfo(values) {
  const has = kind => !!profileData && profileData.series.some(s => s.kind === kind);
  const on = {
    dist: true, mdt: has("mdt"), mds: has("mds"), diff: has("mdt") && has("mds"),
    bulge: profileEarth, clear: profileShowLos || profileFresnel,
    fres: profileFresnel, margin: profileFresnel
  };
  for (const [k, row] of Object.entries(profileInfoRows)) {
    const v = on[k] && values ? values[k] : null;
    const val = row.querySelector(".pf-info-val");
    val.textContent = v ? v.txt : "\u2014";
    val.classList.toggle("alert", !!(v && v.alert));
    row.classList.toggle("off", !on[k]);
  }
}

/* La línea roja, la lectura y la flecha del mapa en la x (píxeles del
   SVG) del ratón. Cada serie da su altura si tiene una celda a la
   vista de esa distancia (en un hueco, se omite); con las dos, también
   MDS−MDT, en rojo por encima de ELEV_ALERT_DIFF como en las celdas. */
function showProfileCursor(x) {
  const lay = profileLayout, svg = profileChart.firstChild;
  if (!lay || !svg) return;
  lay.lastX = x;
  const cursor = svg.querySelector("#pf-cursor");
  const d = Math.min(lay.x1, Math.max(lay.x0, lay.dOf(x)));
  const px = lay.xOf(d);
  cursor.setAttribute("x1", px); cursor.setAttribute("x2", px);
  cursor.setAttribute("visibility", "visible");
  const snap = PF_SNAP_PX / lay.pw * (lay.x1 - lay.x0);
  /* tantos decimales como distinga un píxel: a 0,1 m/px, 4 en km */
  const fx = POLY_UNIT_FACTOR[measureUnit], u = POLY_UNIT_LABEL[altitudeUnit];
  const at = {};
  for (const s of profileData.series) {
    const p = nearestProfilePoint(s.points, d);
    if (p && Math.abs(p.d - d) <= snap) at[s.kind] = p.v;
  }
  const diffTxt = v => `${fmtDiff(v)} ${u}`;
  const info = { dist: { txt: `${(d / fx).toFixed(distDecimals((lay.x1 - lay.x0) / lay.pw, fx))} ${POLY_UNIT_LABEL[measureUnit]}` } };
  for (const kind of ["mdt", "mds"]) if (at[kind] !== undefined) info[kind] = { txt: fmtHeight(at[kind], altitudeUnit) };
  if (at.mdt !== undefined && at.mds !== undefined) {
    const diff = at.mds - at.mdt;
    info.diff = { txt: diffTxt(diff), alert: diff > ELEV_ALERT_DIFF };
  }
  /* Lo que responde a «¿hay línea de vista?»: cuánto asoma la Tierra a
     esta distancia y cuánto pasa la recta por encima del terreno ya
     elevado (negativo, en rojo = lo tapa). Las alturas siguen siendo
     las reales, sin el abultamiento.                                   */
  const bulge = lay.lift(d);
  if (profileEarth) info.bulge = { txt: `+${fmtHeight(bulge, altitudeUnit)}` };
  if (lay.los && at[lay.los.kind] !== undefined) {
    const clear = lay.losAt(d) - (at[lay.los.kind] + bulge);
    info.clear = { txt: diffTxt(clear), alert: clear < 0 };
    /* Con Fresnel: su radio al 60 % y lo que sobra (o falta) de despeje
       una vez descontado; en rojo si el terreno entra en la zona.     */
    if (profileFresnel) {
      const r60 = PF_FRESNEL_ZONE * lay.fresnel(d), margin = clear - r60;
      info.fres = { txt: fmtHeight(r60, altitudeUnit) };
      info.margin = { txt: diffTxt(margin), alert: margin < 0 };
    }
  }
  setProfileInfo(info);
  placeProfileArrow(d);
}

function hideProfileCursor() {
  if (profileLayout) delete profileLayout.lastX;
  const svg = profileChart.firstChild;
  const el = svg && svg.querySelector && svg.querySelector("#pf-cursor");
  if (el) el.setAttribute("visibility", "hidden");
  setProfileInfo(null);
  hideProfileArrow();
}

/* x e y del ratón en píxeles del SVG (viewBox = tamaño del contenedor) */
function chartX(e) {
  const r = profileChart.getBoundingClientRect();
  return profileLayout ? (e.clientX - r.left) * profileLayout.W / r.width : 0;
}
function chartY(e) {
  const r = profileChart.getBoundingClientRect();
  return profileLayout ? (e.clientY - r.top) * profileLayout.H / r.height : 0;
}

/* Zoom de distancia o de altura, con ancla `frac` (0..1; la de altura
   contada desde abajo). Hacer zoom de altura BLOQUEA el eje Y en lo
   que se ve.                                                        */
function zoomProfileX(frac, factor) {
  const lay = profileLayout;
  if (!lay) return;
  profileView = zoomProfileView(profileView, lay.total, profileMinSpan(), frac, factor);
  scheduleProfileChart();
}
function zoomProfileY(frac, factor) {
  const lay = profileLayout;
  if (!lay) return;
  profileYView = zoomRange(profileYView || lay.ym, frac, factor, PF_Y_MIN_SPAN, PF_Y_MAX_SPAN);
  scheduleProfileChart();
}

/* Un redibujo por fotograma: la rueda y el arrastre dan más eventos.
   Medido (Chromium headless, 12 NM a 5 m, 4499 puntos por serie, dos
   series): 3,3 ms con la ruta entera y 1,0 ms con zoom, así que se
   rehace todo el SVG sin más.                                      */
function scheduleProfileChart() {
  if (!profileFrame) profileFrame = requestAnimationFrame(() => { profileFrame = 0; renderProfileChart(); });
}

/* Rueda: sobre la gráfica, distancia; con Mayús o sobre el eje de
   alturas (margen izquierdo), altura. Con Mayús, Chromium y Firefox en
   Windows/Linux mandan la rueda en deltaX, no en deltaY.           */
profileChart.addEventListener("wheel", e => {
  if (!profileLayout) return;
  e.preventDefault(); /* la rueda es de la gráfica, no de la página */
  const lay = profileLayout;
  const raw = e.deltaY || (e.shiftKey ? e.deltaX : 0);
  const px = raw * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
  const factor = Math.exp(px * PF_WHEEL_STEP);
  lay.lastX = chartX(e); /* tras redibujar, la línea sigue bajo el ratón */
  if (e.shiftKey || chartX(e) < PF_MARGIN.l) {
    zoomProfileY(Math.min(1, Math.max(0, 1 - (chartY(e) - PF_MARGIN.t) / lay.ph)), factor);
  } else {
    zoomProfileX(Math.min(1, Math.max(0, (chartX(e) - PF_MARGIN.l) / lay.pw)), factor);
  }
}, { passive: false });

profileChart.addEventListener("pointerdown", e => {
  if (!profileLayout || e.button !== 0) return;
  profileDrag = { x: chartX(e), y: chartY(e), view: { ...profileView },
                  yView: profileYView && { ...profileYView }, ym: { ...profileLayout.ym } };
  profileChart.setPointerCapture(e.pointerId);
  profileChart.classList.add("dragging");
});
profileChart.addEventListener("pointermove", e => {
  if (!profileLayout) return;
  const x = chartX(e);
  if (profileDrag) {
    const lay = profileLayout;
    const dd = -(x - profileDrag.x) / lay.pw * (profileDrag.view.x1 - profileDrag.view.x0);
    profileView = panProfileView(profileDrag.view, lay.total, profileMinSpan(), dd);
    /* Arrastrar también desplaza en VERTICAL. Con el eje Y bloqueado,
       desde el primer píxel (hacia abajo = ver más arriba). En
       automático, al pasar de PF_DRAG_LOCK_PX en vertical: se bloquea
       en lo que se veía y sigue la mano — un arrastre horizontal con la
       mano algo torcida no toca la altura.                              */
    let yv = profileDrag.yView;
    if (!yv && Math.abs(chartY(e) - profileDrag.y) > PF_DRAG_LOCK_PX) yv = profileDrag.yView = profileDrag.ym;
    if (yv) {
      const dm = (chartY(e) - profileDrag.y) / lay.ph * (yv.b - yv.a);
      profileYView = { a: yv.a + dm, b: yv.b + dm };
    }
    lay.lastX = x;
    scheduleProfileChart();
  } else {
    showProfileCursor(x);
  }
});
function endProfileDrag() {
  profileDrag = null;
  profileChart.classList.remove("dragging");
}
profileChart.addEventListener("pointerup", endProfileDrag);
profileChart.addEventListener("pointercancel", endProfileDrag);
profileChart.addEventListener("pointerleave", () => { if (!profileDrag) hideProfileCursor(); });

/* Controles: bloqueo del eje Y (marcarlo congela lo que se ve;
   desmarcarlo vuelve al ajuste automático) y «Ver todo» (ruta entera y
   altura automática). El zoom no tiene botones: es la rueda.         */
profileYLock.addEventListener("change", () => {
  profileYView = profileYLock.checked && profileLayout ? { ...profileLayout.ym } : null;
  scheduleProfileChart();
});
profileLosBox.addEventListener("change", () => { profileShowLos = profileLosBox.checked; scheduleProfileChart(); });
profileEarthBox.addEventListener("change", () => { profileEarth = profileEarthBox.checked; scheduleProfileChart(); });
profileFresnelBox.addEventListener("change", () => { profileFresnel = profileFresnelBox.checked; scheduleProfileChart(); });
/* Torres: `change` (al confirmar, no a cada tecla). Vacío vuelve al
   vigente; fuera de rango se ajusta a la cota y se avisa, como el resto
   de ajustes numéricos (`readClampedNumber`, 43-points-editor.js).     */
for (const k of ["a", "b"]) {
  profileTowerInput[k].addEventListener("change", () => {
    const fy = POLY_UNIT_FACTOR[altitudeUnit];
    const v = readClampedNumber(profileTowerInput[k], 0, PF_TOWER_MAX / fy, "La altura de torre", POLY_UNIT_LABEL[altitudeUnit]);
    if (v !== null) profileTowerM[k] = Math.min(PF_TOWER_MAX, v * fy);
    syncProfileInputs(true);
    scheduleProfileChart();
  });
}
document.getElementById("pf-reset").addEventListener("click", () => {
  profileView = null;
  profileYView = null;
  scheduleProfileChart();
});

/* Cambiar una unidad en Propiedades (setMeasureUnit/setAltitudeUnit) o
   el tamaño de la ventana redibuja la gráfica, sin volver a pedir nada
   y sin perder el zoom.                                            */
function refreshProfileChart() { renderProfileChart(); }
new ResizeObserver(() => renderProfileChart()).observe(profileChart);

/* ---------- Flecha en el mapa ----------
   Punta de flecha roja (el color de la línea del cursor) sobre la
   ruta, en la distancia que marca la gráfica y en el sentido de la
   marcha. Va AL MAPA, no a rootGroup: no es una capa del árbol y no
   debe entrar en el hit-testing del menú contextual. El marcador vive
   en el panel que no gira, así que su giro suma el del mapa. Un
   setLatLng por fotograma (llegan más mousemove que fotogramas). No
   mueve la vista.                                                    */
const PF_ARROW_SVG = `<svg viewBox="-13 -13 26 26" width="26" height="26" aria-hidden="true">`
  + `<path d="M11 0 L-8 -8 L-3 0 L-8 8 Z"/></svg>`;
let profileArrow = null;
let arrowFrame = 0, arrowWant = null;

function placeProfileArrow(d) {
  arrowWant = d;
  if (!arrowFrame) arrowFrame = requestAnimationFrame(() => { arrowFrame = 0; drawProfileArrow(arrowWant); });
}

function drawProfileArrow(d) {
  const pd = profileData;
  if (d === null || !pd || profileDialog.hidden || !pd.li.isConnected) { hideProfileArrow(); return; }
  const p = profilePointAt(pd.legs, pd.vertices, d);
  if (!p) return;
  const ll = map.options.crs.unproject(L.point(p.x, p.y));
  if (!profileArrow) {
    profileArrow = L.marker(ll, {
      icon: L.divIcon({ className: "pf-map-arrow", html: PF_ARROW_SVG, iconSize: [26, 26] }),
      interactive: false, keyboard: false, zIndexOffset: 1000
    });
  }
  profileArrow.setLatLng(ll);
  if (!map.hasLayer(profileArrow)) profileArrow.addTo(map);
  /* angle: antihorario con y al norte; en pantalla, horario, más el
     giro del mapa (también horario).                                 */
  profileArrow.getElement().firstChild.style.transform = `rotate(${map.getBearing() - p.angle}deg)`;
}

function hideProfileArrow() {
  arrowWant = null;
  if (arrowFrame) { cancelAnimationFrame(arrowFrame); arrowFrame = 0; }
  if (profileArrow && map.hasLayer(profileArrow)) map.removeLayer(profileArrow);
}

/* Botón del diálogo de propiedades de la ruta (44-dialogs.js lo enseña
   solo con una ruta ya creada: «Mostrar perfil» si ya lo tiene, si no
   «Obtener perfil», deshabilitado con el motivo).                    */
document.getElementById("ms-profile").addEventListener("click", () => {
  if (styleTargets.length === 1) openRouteProfile(styleTargets[0]);
});
