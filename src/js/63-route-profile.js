/* ================= Perfil de una ruta =================
   «Obtener perfil» (menú contextual sobre una ruta, o su diálogo de
   propiedades) descarga del MDT y del MDS elegidos en Propiedades →
   Fuentes de datos las celdas que recorre la ruta y dibuja la altura a
   lo largo de ella, una curva por modelo (MDT azul, MDS verde):
   distancia desde el inicio en horizontal (unidad de distancia), altura
   en vertical (unidad de altitud), con los vértices entre tramos
   marcados en negrita en el eje de distancias. Una flecha sobre la ruta
   en el mapa sigue a la línea vertical de la gráfica.

   La ventana de 40 m de «Consultas › Elevación» daría cientos de
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
const PROFILE_SECTION = tr("Perfiles de ruta");
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
   curvar el rayo se corrige el DIBUJO, y hay tres maneras de hacerlo
   (`PF_CURVE_MODES`). Entre las torres, a `dA` y `dB` metros del inicio de
   la ruta, la Tierra de radio k·R asoma
       c(d) = (d − dA)·(dB − d) / (2·k·R)
   sobre la cuerda que une las antenas (negativa fuera de ellas: la Tierra
   cae por detrás). `profileCurve` devuelve dos correcciones, `lift` (se
   suma al TERRENO y al nivel del mar) y `bend` (se suma a la LÍNEA):
     classic  Tierra curva con el centro entre las torres: lift = c.
     flat     Tierra plana, rayo curvo: el terreno queda como está y la
              línea (y el elipsoide) se curvan, bend = −c.
     origin   Tierra curva desde la torre de inicio (plano tangente):
              lift = −(d − dA)²/(2·k·R); la línea, una vez unidas las
              antenas dibujadas, sigue recta.
   El despeje (línea − terreno) es el mismo en los tres: solo cambia el
   dibujo. `d` es la distancia a lo largo de la ruta: una ruta con giros
   se trata como un trayecto recto, que es lo único que un perfil dibuja. */
const PF_K_FACTOR = 4 / 3;
const PF_CURVE_MODES = ["none", "classic", "flat", "origin"];
function profileCurve(mode, dA, dB, k = PF_K_FACTOR) {
  const f = 2 * k * EARTH_R;
  const c = d => (d - dA) * (dB - d) / f;
  switch (mode) {
    case "classic": return { lift: c, bend: () => 0 };
    case "flat": return { lift: () => 0, bend: d => -c(d) };
    case "origin": return { lift: d => -(d - dA) * (d - dA) / f, bend: () => 0 };
    default: return { lift: () => 0, bend: () => 0 };
  }
}

/* Las torres, en vértices de la ruta: `at` = { a, b } con el ÍNDICE del
   vértice de la torre de inicio y de la final (b null = el último).
   Devuelve índices válidos, con 0 ≤ ia < ib ≤ n−1; lo que no lo sea cae
   a los extremos, que es lo de siempre.                              */
function profileTowerSpan(vertices, at) {
  const last = vertices.length - 1;
  if (last < 1) return { ia: 0, ib: Math.max(0, last) };
  const ia = Number.isInteger(at && at.a) && at.a >= 0 && at.a < last ? at.a : 0;
  const ib = Number.isInteger(at && at.b) && at.b > ia && at.b <= last ? at.b : last;
  return { ia, ib };
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
   MDT. Sin `dA`/`dB`: primer y último valor NUMÉRICO de la serie (un
   hueco en un extremo, celda sin dato, no impide dibujarla). Con ellos
   (distancias de los vértices de las torres): el valor con dato más
   cercano a cada una, que es lo que lee el cursor. `series`: las del
   perfil, `{ kind, points }`. Devuelve `{ kind, a, b }` o null.       */
function profileLosEnds(series, dA, dB) {
  for (const kind of ["mds", "mdt"]) {
    const s = series.find(x => x.kind === kind);
    if (!s) continue;
    const nums = s.points.filter(p => typeof p.v === "number");
    if (!nums.length) continue;
    const at = d => d === undefined ? null : nearestProfilePoint(nums, d);
    const first = at(dA) || nums[0], last = at(dB) || nums[nums.length - 1];
    return { kind, a: first.v, b: last.v };
  }
  return null;
}

/* El enlace entre las torres, PURO: lo que la gráfica dibuja y el CSV
   exporta salen de aquí, para que sean lo mismo. `opts`: `at` (vértices de
   las torres), `towerM` ({ a, b }, alturas sobre el terreno, metros),
   `curveMode`, `showLos` y `showFresnel` (qué está activado) y `freqMHz`.
   Devuelve los vértices de las torres (`ia`, `ib`) y sus distancias (`dA`,
   `dB`), las correcciones de curvatura (`lift`, `bend`), `ground` y `los`
   (los extremos de la recta, `null` si no hay recta ni Fresnel), `losAt(d)`
   (la altura DIBUJADA de la recta a la distancia d, ver `profileCurve`) y
   `fresnel(d)` (el radio de la primera zona).                           */
function profileLinkModel(series, vertices, opts) {
  const { ia, ib } = profileTowerSpan(vertices, opts.at);
  const dA = vertices[ia], dB = vertices[ib];
  const { lift, bend } = profileCurve(opts.curveMode, dA, dB);
  const ground = (opts.showLos || opts.showFresnel) ? profileLosEnds(series, dA, dB) : null;
  const los = ground && { kind: ground.kind, a: ground.a + opts.towerM.a, b: ground.b + opts.towerM.b };
  const losAt = d => {
    const ya = los.a + lift(dA), yb = los.b + lift(dB);
    return (dB > dA ? ya + (yb - ya) * (d - dA) / (dB - dA) : ya) + bend(d);
  };
  const fresnel = d => fresnelRadius(d - dA, dB - dA, opts.freqMHz);
  return { ia, ib, dA, dB, lift, bend, ground, los, losAt, fresnel };
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
  const out = { key: p.key, total: p.total, vertices: v, mdt, mds };
  /* Opcionales: un perfil de antes no los trae, y uno malo se queda sin ellos */
  const obstacles = validProfileObstacles(p.obstacles, p.total);
  if (obstacles) out.obstacles = obstacles;
  const towers = validProfileTowers(p.towers, v.length);
  if (towers) out.towers = towers;
  return out;
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

/* ---------- Obstáculos: polígonos con altitud (puro, se prueba en Node) ----------
   Un polígono de un KML o un GeoJSON con altitud en sus vértices puede
   tapar la línea inicio–fin. Cada tramo de la ruta (metros Web Mercator,
   como `routeProfileSamples`) se corta con los lados del polígono: los
   cruces, ordenados por distancia, se emparejan entrada–salida. La altura
   del techo en un cruce se INTERPOLA entre los dos vértices del lado
   cortado (los más cercanos al cruce) y entre la entrada y la salida va
   recta. El polígono es un bloque desde el terreno hasta ese techo.

   La Z es AMSL (altitud sobre el nivel del mar) salvo en un polígono
   `agl` (`relativeToGround` del KML): entonces es una ALTURA sobre el
   terreno y se convierte en AMSL sumándole el terreno que acaba de
   descargar ESTE perfil (`obstacleRoof`), nunca antes: el MDT se pide
   para la ruta y el techo lo aprovecha sin petición nueva. Guardado con
   el perfil, el techo ya es AMSL: una foto, independiente de que el
   polígono siga en el árbol. Ver `20-kml-geom.js` (`kiteAlt`).        */
const PROFILE_MAX_OBSTACLES = 500;
const PROFILE_MAX_OBSTACLE_PTS = 100000;   /* puntos de techo, entre todos los obstáculos */
const PROFILE_MAX_OBSTACLE_SPANS = 2000;   /* tramos de UN obstáculo */
const PROFILE_OBSTACLE_NAME_MAX = 200;
const PROFILE_OBSTACLE_SAMPLES = 16;       /* subdivisiones de un tramo al buscar el peor despeje */

const cross2 = (ax, ay, bx, by) => ax * by - ay * bx;

/* Altura del terreno (o de cualquier serie ordenada de {d, v}) a una
   distancia: lineal entre vecinos, y fuera de la serie la del extremo.
   `nums` solo lleva puntos con valor.                                 */
function profileValueAt(nums, d) {
  if (!nums.length) return NaN;
  if (d <= nums[0].d) return nums[0].v;
  const last = nums[nums.length - 1];
  if (d >= last.d) return last.v;
  let lo = 0, hi = nums.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (nums[mid].d <= d) lo = mid; else hi = mid;
  }
  const a = nums[lo], b = nums[hi];
  return b.d > a.d ? a.v + (b.v - a.v) * (d - a.d) / (b.d - a.d) : a.v;
}

/* La parte de una serie entre dos distancias, con los extremos exactos
   (interpolados): lo que se dibuja de un bloque y de su terreno.       */
function sliceByD(nums, a, b) {
  if (!nums.length || !(b > a)) return [];
  /* Con búsqueda binaria: se llama por cada tramo de cada obstáculo en
     cada redibujado, sobre series de miles de puntos.                  */
  const lowerBound = d => {
    let lo = 0, hi = nums.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (nums[mid].d < d) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const inner = [];
  for (let k = lowerBound(a), end = lowerBound(b); k < end; k++) if (nums[k].d > a) inner.push(nums[k]);
  return [{ d: a, v: profileValueAt(nums, a) }, ...inner, { d: b, v: profileValueAt(nums, b) }];
}

/* Altitud interpolada del punto del contorno más cercano a `p`: la del
   extremo de la ruta cuando empieza o acaba DENTRO del polígono (no hay
   cruce ahí que interpolar).                                           */
function nearestRingAlt(rings, p) {
  let best = null;
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const ex = b.x - a.x, ey = b.y - a.y, len2 = ex * ex + ey * ey;
      const u = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
      const dx = a.x + u * ex - p.x, dy = a.y + u * ey - p.y, dist = dx * dx + dy * dy;
      if (!best || dist < best.dist) best = { dist, z: a.z + u * (b.z - a.z) };
    }
  }
  return best ? best.z : NaN;
}

/* Los tramos de la ruta DENTRO de un polígono: `[{ d0, z0, d1, z1 }]`,
   distancias desde el inicio (la misma correspondencia que el muestreo:
   `vertices[i] + t · dist` del tramo) y altitudes en el cruce. `rings`:
   anillos `[{ x, y, z }]` en metros Web Mercator, el exterior primero (par
   e impar: un agujero saca la ruta del polígono). `z` es NaN donde el
   vértice no trae altitud. Los intervalos son semiabiertos (un cruce justo
   en un vértice no se cuenta dos veces); una ruta que corra sobre un lado
   no cruza nada. Un tramo de longitud 0 no cruza (no hay recta).                                                       */
function routePolygonSpans(legs, vertices, rings) {
  if (!legs.length || !rings.length) return [];
  const hits = [];
  legs.forEach((leg, i) => {
    const rx = leg.b.x - leg.a.x, ry = leg.b.y - leg.a.y;
    if (rx === 0 && ry === 0) return;
    for (const ring of rings) {
      for (let k = 0, n = ring.length; k < n; k++) {
        const e0 = ring[k], e1 = ring[(k + 1) % n];
        /* De qué lado de la recta de la ruta cae cada extremo del lado. Un
           extremo SOBRE la recta cuenta como «no positivo»: así un vértice
           del polígono en la ruta, o un lado paralelo a ella, da siempre un
           número par de cruces (la regla del rayo, la misma que pointInRing)
           y no se cuentan dos veces ni se inventa uno.                     */
        const s0 = cross2(rx, ry, e0.x - leg.a.x, e0.y - leg.a.y), s1 = cross2(rx, ry, e1.x - leg.a.x, e1.y - leg.a.y);
        if ((s0 > 0) === (s1 > 0)) continue;
        const u = s0 / (s0 - s1);
        const px = e0.x + u * (e1.x - e0.x) - leg.a.x, py = e0.y + u * (e1.y - e0.y) - leg.a.y;
        const t = (px * rx + py * ry) / (rx * rx + ry * ry);
        /* [0, 1): un cruce justo en el vértice entre dos tramos es del segundo */
        if (t >= 0 && t < 1) hits.push({ d: vertices[i] + t * leg.dist, z: e0.z + u * (e1.z - e0.z) });
      }
    }
  });
  hits.sort((a, b) => a.d - b.d);
  const start = legs[0].a, end = legs[legs.length - 1].b;
  const inside = p => rings.reduce((acc, ring) => pointInRing(p, ring) !== acc, false);
  const startIn = inside(start);
  const endIn = startIn !== (hits.length % 2 === 1);
  const seq = [];
  if (startIn) seq.push({ d: 0, z: nearestRingAlt(rings, start) });
  seq.push(...hits);
  if (endIn) seq.push({ d: vertices[vertices.length - 1], z: nearestRingAlt(rings, end) });
  const spans = [];
  for (let k = 0; k + 1 < seq.length; k += 2) {
    const a = seq[k], b = seq[k + 1];
    if (b.d - a.d > 1e-6) spans.push({ d0: a.d, z0: a.z, d1: b.d, z1: b.z });
  }
  return spans;
}

/* El techo AMSL de un tramo, como polilínea `[[d, z]]`. AMSL: la recta de
   la entrada a la salida. AGL: la altura interpolada de la entrada a la
   salida SOBRE el terreno de la serie (`nums`, puntos con valor), con un
   punto por cada uno del terreno dentro del tramo, para que el techo siga
   el relieve. null si no hay terreno sobre el que ponerla.             */
function obstacleRoof(span, mode, nums) {
  const { d0, z0, d1, z1 } = span;
  if (mode !== "agl") return [[d0, z0], [d1, z1]];
  if (!nums.length) return null;
  const h = d => z0 + (z1 - z0) * (d - d0) / (d1 - d0);
  return [d0, ...nums.filter(p => p.d > d0 && p.d < d1).map(p => p.d), d1]
    .map(d => [d, profileValueAt(nums, d) + h(d)]);
}

/* Un polígono → obstáculo del perfil, o el motivo de que no lo sea
   (`why`: outside = no cruza la ruta, ground = pegado al suelo, sea =
   fondo marino, noalt = el lado cortado no trae altitud, noterrain = AGL
   sin terreno, buried = el techo no pasa del terreno). `polygon`:
   `{ name, mode, rings }`. `terrain`: la serie del terreno `[{ d, v }]`.
   Un polígono sin modo cuenta como AMSL.                               */
function profileObstacleFrom(polygon, legs, vertices, terrain) {
  const spans = routePolygonSpans(legs, vertices, polygon.rings);
  if (!spans.length) return { why: "outside" };
  if (polygon.mode === "ground") return { why: "ground" };
  if (polygon.mode === "sea") return { why: "sea" };
  if (spans.some(s => !Number.isFinite(s.z0) || !Number.isFinite(s.z1))) return { why: "noalt" };
  const mode = polygon.mode === "agl" ? "agl" : "abs";
  const nums = terrain.filter(p => Number.isFinite(p.v));
  const roofs = [];
  for (const s of spans) {
    const roof = obstacleRoof(s, mode, nums);
    if (!roof) return { why: "noterrain" };
    /* Sin terreno que comparar (AMSL y todo huecos) se conserva: no se sabe que esté enterrado */
    if (!nums.length || roof.some(([d, z]) => z > profileValueAt(nums, d))) roofs.push(roof);
  }
  if (!roofs.length) return { why: "buried" };
  return { obstacle: { name: polygon.name, mode, spans: roofs } };
}

/* Los tramos de un obstáculo como series `[{ d, v }]` (lo que entienden
   `profileValueAt` y `sliceByD`), hechas una vez por obstáculo: un
   redibujado por fotograma no las rehace.                              */
const obstaclePtsCache = new WeakMap();
function obstacleSpanPts(o) {
  let pts = obstaclePtsCache.get(o);
  if (!pts) obstaclePtsCache.set(o, pts = o.spans.map(sp => sp.map(([d, z]) => ({ d, v: z }))));
  return pts;
}

/* Lo que se guarda y se dibuja: d a 0,1 m y z a 0,01 m (como las curvas) */
const packObstacle = o => ({ name: o.name, mode: o.mode,
  spans: o.spans.map(sp => sp.map(([d, z]) => [Math.round(d * 10) / 10, Math.round(z * 100) / 100])) });

/* La altura del techo de un obstáculo a la distancia `d`, o null si ahí
   no hay obstáculo (fuera de todos sus tramos).                        */
function obstacleRoofAt(o, d) {
  const all = obstacleSpanPts(o);
  for (const pts of all) {
    if (d >= pts[0].d && d <= pts[pts.length - 1].d) return profileValueAt(pts, d);
  }
  return null;
}

/* Qué obstáculos tapan la recta inicio–fin y por dónde. `model` es el de
   `profileLinkModel` (el mismo que dibuja la gráfica): el despeje en d es
   `losAt(d) − lift(d) − techo(d)`, en el marco de las series, el MISMO en
   los tres modos de curvatura. Solo cuenta entre las torres (`dA`…`dB`:
   fuera no hay enlace). Se mira en cada vértice del techo, en los límites
   y en PROFILE_OBSTACLE_SAMPLES subdivisiones. Devuelve, de cada obstáculo
   que cae entre las torres, `{ obstacle, clear, at, blocked }`: el peor
   despeje (metros, negativo = la recta pasa por DEBAJO del techo), dónde, y
   los intervalos `[da, db]` donde la tapa. Sin recta, nada.            */
function profileObstructions(obstacles, model) {
  if (!model.los) return [];
  const out = [];
  for (const o of obstacles) {
    let worst = null;
    const blocked = [];
    for (const pts of obstacleSpanPts(o)) {
      const a = Math.max(pts[0].d, model.dA), b = Math.min(pts[pts.length - 1].d, model.dB);
      if (!(a <= b)) continue;
      const ds = new Set([a, b]);
      for (const p of pts) if (p.d > a && p.d < b) ds.add(p.d);
      for (let i = 1; i < PROFILE_OBSTACLE_SAMPLES; i++) ds.add(a + (b - a) * i / PROFILE_OBSTACLE_SAMPLES);
      let prev = null, open = null;
      for (const d of [...ds].sort((x, y) => x - y)) {
        const clear = model.losAt(d) - model.lift(d) - profileValueAt(pts, d);
        if (!worst || clear < worst.clear) worst = { clear, at: d };
        if (clear < 0) {
          if (open === null) open = prev && prev.clear >= 0 ? prev.d + (d - prev.d) * prev.clear / (prev.clear - clear) : d;
        } else if (open !== null) {
          blocked.push([open, prev.d + (d - prev.d) * prev.clear / (prev.clear - clear)]);
          open = null;
        }
        prev = { d, clear };
      }
      if (open !== null) blocked.push([open, prev.d]);
    }
    if (worst) out.push({ obstacle: o, clear: worst.clear, at: worst.at, blocked });
  }
  return out;
}

/* Obstáculos leídos de fuera (árbol guardado, .kite.json, portapapeles):
   forma exacta, números finitos, distancias dentro de la ruta y
   crecientes, longitudes acotadas. Lo malo se descarta uno a uno (la lista
   y el perfil siguen); `undefined`/`null` = el perfil nunca los calculó.   */
function validProfileObstacles(list, total) {
  if (list === undefined || list === null) return null;
  if (!Array.isArray(list)) return null;
  const fin = x => typeof x === "number" && Number.isFinite(x);
  const out = [];
  let pts = 0;
  for (const o of list) {
    if (out.length >= PROFILE_MAX_OBSTACLES) break;
    if (!o || typeof o !== "object" || typeof o.name !== "string") continue;
    if (o.mode !== "abs" && o.mode !== "agl") continue;
    if (!Array.isArray(o.spans) || !o.spans.length || o.spans.length > PROFILE_MAX_OBSTACLE_SPANS) continue;
    const good = o.spans.every(sp => Array.isArray(sp) && sp.length >= 2
      && sp.every((q, i) => Array.isArray(q) && q.length === 2 && fin(q[0]) && fin(q[1])
        && q[0] >= 0 && q[0] <= total + 1e-6 && (i === 0 || q[0] >= sp[i - 1][0])));
    if (!good) continue;
    const n = o.spans.reduce((s, sp) => s + sp.length, 0);
    if (pts + n > PROFILE_MAX_OBSTACLE_PTS) break;
    pts += n;
    out.push({ name: o.name.slice(0, PROFILE_OBSTACLE_NAME_MAX), mode: o.mode, spans: o.spans.map(sp => sp.map(q => [q[0], q[1]])) });
  }
  return out;
}

/* Las torres que se guardan con el perfil: vértice (índice) y altura
   sobre el terreno en metros de cada una. null si no son válidas (el
   perfil vuelve a las de por defecto: los extremos y 0).               */
function validProfileTowers(t, vertexCount) {
  const fin = x => typeof x === "number" && Number.isFinite(x);
  const one = q => q && typeof q === "object" && Number.isInteger(q.at) && q.at >= 0 && q.at < vertexCount
    && fin(q.m) && q.m >= 0 && q.m <= PF_TOWER_MAX;
  if (!t || typeof t !== "object" || !one(t.a) || !one(t.b) || !(t.a.at < t.b.at)) return null;
  return { a: { at: t.a.at, m: t.a.m }, b: { at: t.b.at, m: t.b.m } };
}

/* ---------- Diálogo ---------- */
const profileDialog = document.getElementById("profile-dialog");
const profileBox = profileDialog.querySelector(".dlg-box");
const profileChart = document.getElementById("profile-chart");
makeDialogMovable(profileBox);
setupDialog(profileBox, { modal: false }); /* flotante: el mapa sigue vivo */

let profileRun = null;   /* { ctl } mientras descarga                  */
/* Lo que dibuja la gráfica: { key, total, vertices, series: [{ kind,
   label, points }], legs, li }. `legs` y `li` son los de la ruta, para la
   flecha del mapa; `key`, su geometría (`routeProfileKey`).           */
let profileData = null;
/* Los vértices de las torres son índices de ESTA ruta: otra ruta, otros
   vértices. Las alturas, en cambio, valen para cualquiera.            */
let profileTowerKey = null;
function setProfileData(data) {
  profileData = data;
  if (data.key !== profileTowerKey) { profileTowerKey = data.key; profileTowerAt.a = 0; profileTowerAt.b = null; }
}

function setProfileProgress(done, total, what = "MDS") {
  const pct = total ? Math.round(100 * done / total) : 0;
  document.getElementById("profile-progress-fill").style.width = `${pct}%`;
  document.getElementById("profile-progress-label").textContent = total
    ? trn(total, "Descargando celdas {what}: {pct} % ({done} de {n} zona)",
      "Descargando celdas {what}: {pct} % ({done} de {n} zonas)", { what, pct, done })
    : tr("Consultando el servicio…");
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
  setProfileCloseLabel(tr("Cancelar la descarga"));
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
  setProfileCloseLabel(tr("Cerrar"));
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
function findRouteProfileGroup(key) {
  return elevGridGroups.find(x => x._profile && x._profile.key === key) || null;
}
function findRouteProfile(key) {
  const g = findRouteProfileGroup(key);
  return g ? g._profile : null;
}
const routeProfileOf = li => (isRouteLi(li) ? findRouteProfile(routeProfileKey(measureWaypoints(li._measure))) : null);

/* Por qué no se puede OBTENER el perfil de esta ruta, o false: es el
   `disabled()` del menú contextual y el title del botón del diálogo.
   Mostrar uno ya guardado no pide nada y no tiene motivo para no.    */
function routeProfileDisabled(li) {
  if (!isRouteLi(li)) return tr("Solo una ruta tiene perfil.");
  if (!elevSources.mdt && !elevSources.mds) return ELEV_NO_SOURCES_WHY;
  const m = li._measure;
  if (profileLimitApplies() && m.totalDist > profileMaxM) {
    return tr("La ruta mide {dist} y el límite de un perfil con las "
      + "fuentes elegidas es {max} (Propiedades → Preferencias).",
      { dist: fmtUnitDist(m.totalDist, measureUnit), max: fmtUnitDist(profileMaxM, measureUnit) });
  }
  return false;
}

/* El ítem del menú contextual de una ruta, con una capa debajo o sin
   ella (70-view-controls.js): «Mostrar» si ya tiene perfil.          */
function routeProfileCtxItem(li) {
  const has = !!routeProfileOf(li);
  return { label: has ? tr("Mostrar perfil") : tr("Obtener perfil"), shown: has, action: () => openRouteProfile(li),
           disabled: () => (has ? false : routeProfileDisabled(li)) };
}

/* Entrada única del botón y del menú: lo guardado si lo hay (sin red y
   sin capa nueva), si no, descargarlo.                               */
function openRouteProfile(li) {
  const saved = routeProfileOf(li);
  if (saved) showSavedProfile(li, saved, findRouteProfileGroup(routeProfileKey(measureWaypoints(li._measure))));
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

const PROFILE_KIND_LABEL = { mdt: tr("MDT"), mds: tr("MDS") };
const profileSeriesLabel = (kind, srcId) => {
  const src = elevSourceById(srcId);
  return src ? elevSourcesLabel([src]) : PROFILE_KIND_LABEL[kind];
};

/* ---------- Recoger los polígonos con altitud que hay en el mapa ----------
   `rootGroup` tiene exactamente lo marcado (visible), también las capas
   de una carpeta nunca desplegada. Solo cuentan los `L.Polygon` con
   altitud en sus vértices: las cuadrículas de elevación son rectángulos,
   y un polígono dibujado a mano o una parcela no traen Z (y sin ella no
   son un obstáculo, así que no se mencionan). El nombre es el de la fila
   o, si la carpeta nunca se desplegó, el del globo de la capa.        */
const htmlToText = html => new DOMParser().parseFromString(html, "text/html").body.textContent;
function profileObstacleName(top) {
  if (top._li && top._li._name) return top._li._name;
  const pop = typeof top.getPopup === "function" && top.getPopup();
  const html = pop && pop.getContent();
  return typeof html === "string" && html ? htmlToText(html) : tr("Polígono");
}

const hasVertexAlt = rings => rings.some(r => r.some(ll => Number.isFinite(ll.alt)));

/* `terrain`: la serie del terreno de ESTE perfil, `[{ d, v }]` (MDT; sin
   él, la superficie). Devuelve `{ obstacles, skipped }` con `skipped` =
   { sea, noalt, noterrain, capped }: polígonos que cruzan la ruta y no se
   pueden usar, para decirlo (un recuento, no uno por polígono).        */
function collectProfileObstacles(legs, vertices, terrain) {
  const found = [], skipped = { sea: 0, noalt: 0, noterrain: 0, capped: 0 };
  if (!legs.length) return { obstacles: found, skipped };
  const xs = legs.flatMap(l => [l.a.x, l.b.x]), ys = legs.flatMap(l => [l.a.y, l.b.y]);
  const box = L.latLngBounds(
    map.options.crs.unproject(L.point(Math.min(...xs), Math.min(...ys))),
    map.options.crs.unproject(L.point(Math.max(...xs), Math.max(...ys))));
  const visit = (layer, top) => {
    if (layer instanceof L.Polygon && !(layer instanceof L.Rectangle)) {
      if (!layer.getBounds().intersects(box)) return;
      const parts = polygonParts(layer.getLatLngs());
      if (!parts.some(part => hasVertexAlt([part.outer]))) return; /* sin Z: no es un obstáculo */
      const mode = featureAltMode(layer.feature);
      const name = profileObstacleName(top);
      const merged = { name, mode: null, spans: [] };
      let why = null;
      for (const part of parts) {
        const rings = [part.outer, ...part.holes].map(ring => ring.map(ll => {
          const m = toWebMercator(ll.lat, ll.lng);
          return { x: m.x, y: m.y, z: Number.isFinite(ll.alt) ? ll.alt : NaN };
        }));
        const got = profileObstacleFrom({ name, mode, rings }, legs, vertices, terrain);
        if (got.obstacle) { merged.mode = got.obstacle.mode; merged.spans.push(...got.obstacle.spans); }
        else if (got.why !== "outside" && got.why !== "ground" && got.why !== "buried") why = got.why;
      }
      if (merged.spans.length) {
        if (found.length >= PROFILE_MAX_OBSTACLES) skipped.capped++;
        else found.push(packObstacle(merged));
      } else if (why) skipped[why]++;
      return;
    }
    if (typeof layer.eachLayer === "function") layer.eachLayer(l => visit(l, top));
  };
  rootGroup.eachLayer(layer => visit(layer, layer));
  return { obstacles: found, skipped };
}

/* Lo que no entró, en frases para el aviso del perfil */
function obstacleSkipNotes(skipped) {
  const notes = [];
  if (skipped.sea) notes.push(trn(skipped.sea, "{n} polígono con altitud sobre el fondo marino no se ha tenido en cuenta.",
    "{n} polígonos con altitud sobre el fondo marino no se han tenido en cuenta.", { n: skipped.sea }));
  if (skipped.noalt) notes.push(trn(skipped.noalt, "{n} polígono sin altitud en todos sus vértices no se ha tenido en cuenta.",
    "{n} polígonos sin altitud en todos sus vértices no se han tenido en cuenta.", { n: skipped.noalt }));
  if (skipped.noterrain) notes.push(trn(skipped.noterrain, "{n} polígono sobre el terreno (AGL) no se ha tenido en cuenta: no hay terreno bajo la ruta.",
    "{n} polígonos sobre el terreno (AGL) no se han tenido en cuenta: no hay terreno bajo la ruta.", { n: skipped.noterrain }));
  if (skipped.capped) notes.push(trn(skipped.capped, "{n} polígono más no cabe: el perfil guarda como mucho {max} obstáculos.",
    "{n} polígonos más no caben: el perfil guarda como mucho {max} obstáculos.", { n: skipped.capped, max: PROFILE_MAX_OBSTACLES }));
  return notes;
}

/* La serie sobre la que se mide el techo y se pone el bloque: el terreno
   (MDT) y, sin él, la superficie. `[{ d, v }]` con valor.                */
function profileTerrainSeries(series) {
  const s = series.find(x => x.kind === "mdt") || series[0];
  return s ? s.points.filter(p => typeof p.v === "number") : [];
}

/* ---------- Lo que se guarda con el perfil (torres, obstáculos) ----------
   Los dos viven en el campo `profile` de la capa de celdas (ver
   validRouteProfile). Se SUSTITUYE el objeto, nunca se modifica en sitio:
   el guardado sabe qué ha cambiado por identidad (persistence-indexeddb.md).
   La capa puede tener fila (`group._li`) o ser aún un registro pendiente
   de una carpeta nunca desplegada (`group._rec`).                      */
const round2 = x => Math.round(x * 100) / 100;
function profileTowersRecord(vertices) {
  const { ia, ib } = profileTowerSpan(vertices, profileTowerAt);
  return { a: { at: ia, m: round2(profileTowerM.a) }, b: { at: ib, m: round2(profileTowerM.b) } };
}
function persistProfileEdit(patch) {
  const g = profileData && profileData.group;
  if (!g || !g._profile || !elevGridGroups.includes(g)) return;
  const next = { ...g._profile, ...patch };
  g._profile = next;
  if (g._li && g._li._elevGrid) g._li._elevGrid.profile = next;
  else if (g._rec) g._rec.profile = next;
  scheduleSave();
}
const persistProfileTowers = () => { if (profileData) persistProfileEdit({ towers: profileTowersRecord(profileData.vertices) }); };

/* El perfil guardado en la capa, a la gráfica tal cual */
function showSavedProfile(li, prof, group = null) {
  if (profileRun) profileRun.ctl.abort();
  openProfileDialog(tr("Perfil: {name}", { name: li._name }));
  profileDialogDone();
  setProfileData({
    key: prof.key, total: prof.total, vertices: prof.vertices, legs: profileLegs(li._measure), li, group,
    obstacles: prof.obstacles || [],
    series: ["mdt", "mds"].filter(k => prof[k]).map(k => ({
      kind: k, label: profileSeriesLabel(k, prof[k].src), points: unpackProfilePoints(prof[k].pts)
    }))
  });
  /* Las torres son del perfil: las suyas, no las que dejó otro en la ventana.
     Un perfil de antes no las trae y se queda con lo que hay.            */
  if (prof.towers) {
    profileTowerAt.a = prof.towers.a.at;
    profileTowerAt.b = prof.towers.b.at;
    profileTowerM.a = prof.towers.a.m;
    profileTowerM.b = prof.towers.b.m;
  }
  renderProfileChart();
}

const profileFailText = err => (err.name === "TimeoutError" ? tr("el servicio no responde")
  : err.name === "TypeError"
    ? netFailText(tr("el servicio no está disponible o no admite consultas desde el navegador (CORS)"))
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
  const what = new Intl.ListFormat(uiLang, { type: "conjunction" }).format(runs.map(s => PROFILE_KIND_LABEL[s.kind]));
  const run = { ctl: new AbortController() };
  profileRun = run;
  openProfileDialog(tr("Perfil: {name}", { name: li._name }));
  const notes = [];
  const srcName = s => elevSourcesLabel([s.src]);
  profileLog("head", tr("«{name}»: {n} waypoints, {dist} · fuentes: {sources}",
    { name: li._name, n: measureWaypoints(m).length, dist: fmtUnitDist(m.totalDist, measureUnit), sources: runs.map(srcName).join(", ") }));
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
        profileLog("info", tr("celda {cell} m → {n} zona(s) a lo largo de la ruta", { cell: s.cell.toFixed(2), n: s.pieces.length }));
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
        profileLog("head", tr("{source} · zona {i} de {n}: lat {lat0}…{lat1}, lon {lon0}…{lon1}",
          { source: srcName(s), i: i + 1, n: s.pieces.length,
            lat0: sw.lat.toFixed(5), lat1: ne.lat.toFixed(5), lon0: sw.lng.toFixed(5), lon1: ne.lng.toFixed(5) }));
        const res = await s.client.area({ south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng },
          run.ctl.signal, profileLog);
        if (res.grid !== undefined) s.answered = true;
        if (res.grid && res.grid.located) s.grids.push(res.grid);
        if (res.grid === null) profileLog("info", tr("sin datos en esta zona"));
        if (res.error) { s.failed++; s.lastError = res.error; profileLog("err", tr("zona sin respuesta: {error}", { error: res.error })); }
        setProfileProgress(++done, total, what);
      }
      if (s.answered) addElevAttribution(s.src.id);
      if (s.failed) {
        notes.push(tr("{dataset}: {failed} de {n} zonas sin respuesta ({error}): salen como huecos.", { dataset: s.src.dataset, failed: s.failed, n: s.pieces.length, error: s.lastError }));
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
      notes.push(tr("Sin datos de elevación a lo largo de la ruta (fuera de la cobertura de las fuentes elegidas)."));
      setProfileNote(notes.join(" "));
      return;
    }
    setProfileNote(notes.join(" "));
    const prof = { key, total: length, vertices, mdt: null, mds: null };
    for (const s of withData) prof[s.kind] = { src: s.src.id, pts: packProfilePoints(s.points) };
    const series = withData.map(s => ({ kind: s.kind, label: elevSourcesLabel([s.src]), points: s.points }));
    /* Los polígonos con altitud que hay AHORA a la vista, con el terreno que
       acaba de bajar este perfil (los AGL se convierten aquí, sin otra
       petición). Se guardan como foto con el perfil.                     */
    const { obstacles, skipped } = collectProfileObstacles(legs, vertices, profileTerrainSeries(series));
    notes.push(...obstacleSkipNotes(skipped));
    if (obstacles.length) {
      profileLog("info", trn(obstacles.length, "{n} obstáculo (polígono con altitud) en la ruta",
        "{n} obstáculos (polígonos con altitud) en la ruta", { n: obstacles.length }));
    }
    prof.obstacles = obstacles;
    setProfileData({ key, total: length, vertices, legs, li, group: null, obstacles, series });
    prof.towers = profileTowersRecord(vertices); /* tras setProfileData: ya son los de ESTA ruta */
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
    pushUndo(tr("obtener perfil"));
    const node = makeElevGridNode(elevNodeName(tr("Perfil de «{name}»", { name: li._name }), live.map(s => s.src)), cells, prof);
    ensureNamedSection(PROFILE_SECTION).appendChild(node);
    refreshAncestorChecks(node);
    scheduleSave();
    profileData.group = nodeLayer(node); /* para guardar lo que se cambie después */
    setProfileNote(notes.join(" "));
  } catch (err) {
    if (run.ctl.signal.aborted) return;
    profileDialogDone();
    notes.push(tr("No se pudo obtener el perfil: {why}.", { why: err.name === "ProfileError" ? err.message : profileFailText(err) }));
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
/* Rótulo del eje de alturas y entrada de la leyenda según el modo de
   curvatura (funciones: `tr()` ha de ejecutarse con el idioma ya fijado) */
const PF_AXIS_LABEL = {
  none: () => tr("Altura"),
  classic: () => tr("Altura + curvatura k = 4/3"),
  flat: () => tr("Altura"),
  origin: () => tr("Altura − caída k = 4/3")
};
const PF_EARTH_LABEL = {
  classic: () => tr("Tierra (k = 4/3)"),
  flat: () => tr("Tierra plana (rayo curvo, k = 4/3)"),
  origin: () => tr("Tierra desde el inicio (k = 4/3)")
};
const PF_DRAG_LOCK_PX = 8;     /* px verticales que convierten un arrastre en desplazamiento de altura */

let profileView = null;   /* { x0, x1 } en metros; null = la ruta entera */
/* Opciones de la gráfica, de SESIÓN (como el resto de su estado, sin
   guardar): sobreviven a abrir otro perfil porque son del modo de mirar
   y no del perfil.                                                    */
let profileShowLos = false; /* recta negra inicio–fin                      */
let profileCurveMode = "none"; /* PF_CURVE_MODES: cómo se dibuja la curvatura terrestre (k = 4/3) */
let profileFresnel = false; /* elipsoide de Fresnel (zona del 60 %)        */
let profileShowObstacles = true; /* bloques de los polígonos con altitud     */
/* Contra qué se miden «Despeje» y «Margen Fresnel» en la lectura: `mdt`,
   `mds` u `obs` (el techo del obstáculo bajo el cursor), o null = el de
   siempre (la superficie, o el terreno si no hay). De sesión, como el resto. */
let profileRef = null;
/* Alturas de torre SOBRE EL TERRENO en el inicio y en el final, metros
   (se escriben en la unidad de altitud): suben los extremos de la recta. */
const profileTowerM = { a: 0, b: 0 };
/* Vértices (índice en `vertices`) donde están las torres; b null = el
   último. Ver `profileTowerSpan`.                                    */
const profileTowerAt = { a: 0, b: null };
let profileYView = null;  /* { a, b } en metros: eje Y bloqueado; null = automático */
let profileLayout = null; /* geometría de la última gráfica dibujada     */
let profileFrame = 0;
let profileDrag = null;   /* { x, y, view, yView } mientras se arrastra */
const profileTools = document.getElementById("profile-tools");
const profileFoot = document.getElementById("profile-foot");
const profileInfoRows = Object.fromEntries([...document.querySelectorAll("#profile-info .pf-info-row")]
  .map(r => [r.dataset.k, r]));
/* Cabecera y pie van y vienen juntos: con la gráfica, no antes */
const showProfileTools = on => {
  profileTools.hidden = !on; profileFoot.hidden = !on;
  if (!on) profileObsNote.hidden = true; /* su texto lo pone cada redibujado */
};
const profileYLock = document.getElementById("pf-y-lock");
const profileLosBox = document.getElementById("pf-los");
const profileCurveSel = document.getElementById("pf-curve");
/* Los obstáculos que se dibujan: los del perfil si la casilla está marcada */
const obstaclesShown = () => (profileShowObstacles && profileData && profileData.obstacles) || [];

/* La referencia que vale AHORA: la elegida si este perfil la tiene (hay serie
   de ese modelo, o algún obstáculo a la vista); si no, la superficie y, sin
   ella, el terreno —lo que usaba la lectura antes de poder elegir—. Siempre
   se dice en la etiqueta de la fila: «Despeje (MDS)».                     */
function profileRefKind() {
  const has = k => !!profileData && profileData.series.some(s => s.kind === k);
  if (profileRef === "obs" ? obstaclesShown().length > 0 : profileRef && has(profileRef)) return profileRef;
  return has("mds") ? "mds" : "mdt";
}
const profileRefName = kind => (kind === "obs" ? tr("Obstáculo") : PROFILE_KIND_LABEL[kind]);
/* Lo que decide el enlace, tal como está ahora en la ventana (ver profileLinkModel) */
const profileLinkOpts = () => ({ at: profileTowerAt, towerM: profileTowerM, curveMode: profileCurveMode,
  showLos: profileShowLos, showFresnel: profileFresnel, freqMHz: fresnelFreqMHz });
const profileFresnelBox = document.getElementById("pf-fresnel");
const profileObsBox = document.getElementById("pf-obstacles");
const profileObsNote = document.getElementById("profile-obstructions");
const profileRefSel = document.getElementById("pf-ref");
const profileTowerInput = { a: document.getElementById("pf-tower-a"), b: document.getElementById("pf-tower-b") };
const profileTowerAtSel = { a: document.getElementById("pf-tower-a-at"), b: document.getElementById("pf-tower-b-at") };

/* Anchura útil de la gráfica en píxeles, y el tope de zoom que da */
const profilePlotWidth = () => profileChart.clientWidth - PF_MARGIN.l - PF_MARGIN.r;
const profileMinSpan = () => PF_MIN_M_PER_PX * Math.max(1, profilePlotWidth());

/* Qué obstáculos tapan la recta, calculado una vez por combinación de
   torres, curvatura y obstáculos (un redibujado por fotograma al arrastrar
   no lo repite). `model.los` null = sin recta: nada que comprobar.       */
let obstructionCache = { obstacles: null, key: "", value: [] };
function obstructionsFor(obstacles, model) {
  const key = model.los ? `${model.dA}|${model.dB}|${model.los.a}|${model.los.b}|${profileCurveMode}` : "";
  if (obstructionCache.obstacles === obstacles && obstructionCache.key === key) return obstructionCache.value;
  const value = profileObstructions(obstacles, model);
  obstructionCache = { obstacles, key, value };
  return value;
}

/* La frase sobre los obstáculos, entre la cabecera y la gráfica: es lo que
   responde a «¿hay algo en medio?». Va en rojo si tapan la línea. Solo se
   toca el DOM si cambia, para no mover la gráfica sin motivo.            */
function updateObstructionNote(obstacles, results, hasLos) {
  let txt = "", alert = false;
  const n = obstacles.length;
  if (n && !hasLos) {
    txt = trn(n, "{n} obstáculo (polígono con altitud) en la ruta. Activa «Línea inicio–fin» para ver si tapa la línea.",
      "{n} obstáculos (polígonos con altitud) en la ruta. Activa «Línea inicio–fin» para ver si alguno la tapa.", { n });
  } else if (n) {
    const hits = results.filter(r => r.clear < 0).sort((a, b) => a.clear - b.clear);
    if (hits.length) {
      const u = POLY_UNIT_LABEL[altitudeUnit];
      txt = tr("Obstáculos que tapan la línea: {list}.", {
        list: hits.slice(0, 5).map(r => tr("«{name}» ({clear} {unit})", { name: r.obstacle.name, clear: fmtDiff(r.clear), unit: u })).join(", ")
          + (hits.length > 5 ? ` +${hits.length - 5}` : "")
      });
      alert = true;
    } else {
      txt = tr("Ningún obstáculo tapa la línea.");
    }
  }
  if (profileObsNote.textContent !== txt) profileObsNote.textContent = txt;
  profileObsNote.hidden = !txt;
  profileObsNote.classList.toggle("alert", alert);
}

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
  /* Las torres están en dos vértices (`dA` ≤ `dB`, por defecto los
     extremos). La curvatura se dibuja según el modo (ver `profileCurve`):
     `lift` (metros) se suma al terreno y al nivel del mar —todo lo que
     se pinta a una distancia d pasa por ahí— y `bend` a la línea.    */
  /* Los extremos de la recta inicio–fin salen de la serie ENTERA, no de
     la parte a la vista; `losAt` es su altura DIBUJADA a la distancia d
     (entre las antenas, ya elevadas por `lift`, más `bend`); fuera de
     las torres es su prolongación. Es `profileLinkModel`, el mismo que
     usa el CSV.                                                       */
  const model = profileLinkModel(series, vertices, profileLinkOpts());
  const { ia, ib, dA, dB, lift, bend, ground, los, losAt, fresnel } = model;
  /* Polígonos con altitud (ver «Obstáculos»): cuáles tapan la recta, y por dónde */
  const obstacles = obstaclesShown();
  const obstructions = new Map(obstructionsFor(obstacles, model).map(r => [r.obstacle, r]));
  /* Lo visible de cada serie: la altura se ajusta a ESO, no a la ruta */
  const shown = series.map(s => ({ ...s, points: visibleProfilePoints(s.points, x0, x1) }));
  const vals = shown.flatMap(s => s.points.filter(p => typeof p.v === "number" && p.d >= x0 && p.d <= x1)
    .map(p => (p.v + lift(p.d)) / fy));
  if (!vals.length) vals.push(...shown.flatMap(s => s.points.filter(p => typeof p.v === "number").map(p => (p.v + lift(p.d)) / fy)));
  if (!vals.length) vals.push(0);
  /* La recta entre las torres y el arco de la Tierra también tienen que
     caber a la vista (el arco parte del nivel del mar, así que lo trae a
     la escala). Las parábolas tienen el vértice en el centro entre las
     torres o en la torre de inicio: se miran sus extremos y esos puntos.
     La prolongación fuera de las torres NO entra: un haz empinado
     aplastaría el relieve.                                           */
  const within = (d, a, b) => Math.min(b, Math.max(a, d));
  const sa = Math.max(x0, dA), sb = Math.min(x1, dB); /* el tramo entre torres que se ve */
  if (los && sa <= sb) {
    const m = within((dA + dB) / 2, sa, sb); /* el radio de Fresnel es máximo en el centro */
    vals.push(losAt(sa) / fy, losAt(sb) / fy, losAt(m) / fy);
    if (profileFresnel) vals.push((losAt(m) + fresnel(m)) / fy, (losAt(m) - fresnel(m)) / fy);
  }
  if (profileCurveMode !== "none") {
    for (const d of [x0, x1, within(dA, x0, x1), within(dB, x0, x1), within((dA + dB) / 2, x0, x1)]) vals.push(lift(d) / fy);
  }
  /* Los techos que se ven también tienen que caber: es lo que se ha venido a mirar */
  for (const o of obstacles) {
    for (const pts of obstacleSpanPts(o)) {
      for (const p of sliceByD(pts, Math.max(x0, pts[0].d), Math.min(x1, pts[pts.length - 1].d))) vals.push((p.v + lift(p.d)) / fy);
    }
  }
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
  profileLayout = { W, H, pw, ph, x0, x1, total, ym, xOf, yPix, yOf, lift, bend, dA, dB, los, losAt, fresnel,
                    dOf: x => x0 + (x - PF_MARGIN.l) / pw * span };

  const parts = [`<clipPath id="pf-clip"><rect x="${PF_MARGIN.l}" y="${PF_MARGIN.t}" width="${pw}" height="${ph}"/></clipPath>`];
  const yt = niceTicks(y0, y1, Math.max(2, Math.floor(ph / 36)));
  const yd = tickDecimals(yt.step);
  for (const u of yt.ticks) {
    const y = yPix(u).toFixed(1);
    parts.push(`<line class="pf-grid" x1="${PF_MARGIN.l}" x2="${W - PF_MARGIN.r}" y1="${y}" y2="${y}"/>`,
      `<text class="pf-tick" x="${PF_MARGIN.l - 6}" y="${y}" text-anchor="end" dominant-baseline="middle">${u.toFixed(yd)}</text>`);
  }
  /* Fuera del enlace (antes de la torre de inicio, después de la final)
     un velo apenas visible bajo las curvas: lo que se mira ahí es contexto
     y no cuenta para la recta ni para Fresnel.                          */
  if (los) {
    for (const [a, b] of [[x0, Math.min(x1, dA)], [Math.max(x0, dB), x1]]) {
      if (a < b) parts.push(`<rect class="pf-outside" x="${xOf(a).toFixed(1)}" y="${PF_MARGIN.t}" width="${(xOf(b) - xOf(a)).toFixed(1)}" height="${ph}"/>`);
    }
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
    const isTower = los && (i === ia || i === ib);
    parts.push(`<line class="pf-vertex${isTower ? " tower" : ""}" x1="${x}" x2="${x}" y1="${PF_MARGIN.t}" y2="${H - PF_MARGIN.b}"/>`);
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
    `<text class="pf-tick" x="${PF_MARGIN.l + pw / 2}" y="${H - 6}" text-anchor="middle">${tr("Distancia desde el inicio ({unit})", { unit: POLY_UNIT_LABEL[measureUnit] })}</text>`,
    `<text class="pf-tick" transform="translate(12 ${PF_MARGIN.t + ph / 2}) rotate(-90)" text-anchor="middle">${PF_AXIS_LABEL[profileCurveMode]()} (${POLY_UNIT_LABEL[altitudeUnit]})</text>`);
  /* Las curvas (MDT azul, MDS verde, por su clase), recortadas al área
     de la gráfica, y su leyenda en el margen de arriba.               */
  let lx = PF_MARGIN.l;
  /* Una entrada de leyenda, solo si cabe entera: en una ventana estrecha
     se pierde la última antes que verla cortada (los nombres, además,
     están en el rectángulo de lectura).                                */
  const legend = (cls, label, swatch = false) => {
    const w = 34 + label.length * 6.5;
    if (lx + w > W - PF_MARGIN.r + 12) return;
    /* `swatch`: un cuadrito RELLENO en vez de una raya, para lo que en la gráfica es una zona */
    parts.push(swatch ? `<rect class="pf-legend-swatch ${cls}" x="${lx}" y="6" width="18" height="10" rx="1"/>`
      : `<line class="pf-legend ${cls}" x1="${lx}" x2="${lx + 18}" y1="11" y2="11"/>`,
      `<text class="pf-tick pf-legend-label" x="${lx + 22}" y="11" dominant-baseline="middle">${escapeHtml(label)}</text>`);
    lx += w;
  };
  /* Tierra al fondo, bajo las curvas: un arco del nivel del mar con el
     relleno suave por debajo, recortado como ellas.                   */
  if (profileCurveMode !== "none") {
    const n = Math.max(2, Math.min(400, Math.ceil(pw / 4)));
    const arc = Array.from({ length: n + 1 }, (_, i) => {
      const d = x0 + span * i / n;
      return `${xOf(d).toFixed(1)},${yPix(lift(d) / fy).toFixed(1)}`;
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
  if (los && profileFresnel && sa < sb) {
    const n = Math.max(2, Math.min(400, Math.ceil(pw * (sb - sa) / span / 4)));
    const ring = k => {
      const up = [], down = [];
      for (let i = 0; i <= n; i++) {
        const d = sa + (sb - sa) * i / n, c = losAt(d), r = k * fresnel(d), x = xOf(d).toFixed(1);
        up.push(`${x},${yPix((c + r) / fy).toFixed(1)}`);
        down.push(`${x},${yPix((c - r) / fy).toFixed(1)}`);
      }
      return up.concat(down.reverse()).join(" ");
    };
    parts.push(`<polygon class="pf-fresnel" clip-path="url(#pf-clip)" points="${ring(1)}"/>`,
      `<polygon class="pf-fresnel60" clip-path="url(#pf-clip)" points="${ring(PF_FRESNEL_ZONE)}"/>`);
  }
  /* Obstáculos: un bloque del terreno al techo entre la entrada y la salida
     de la ruta, y encima, en rojo, lo que cae donde la recta pasa por
     debajo del techo. Bajo las curvas, que se siguen leyendo.         */
  if (obstacles.length) {
    const terrainPts = profileTerrainSeries(series);
    for (const o of obstacles) {
      for (const roof of obstacleSpanPts(o)) {
        const a = Math.max(x0, roof[0].d), b = Math.min(x1, roof[roof.length - 1].d);
        if (!(a < b)) continue;
        const block = (da, db) => [...sliceByD(roof, da, db), ...sliceByD(terrainPts, da, db).reverse()]
          .map(p => `${xOf(p.d).toFixed(1)},${yOf(p.v, p.d).toFixed(1)}`).join(" ");
        parts.push(`<polygon class="pf-obstacle" clip-path="url(#pf-clip)" points="${block(a, b)}"/>`);
        const hit = obstructions.get(o);
        for (const [ba, bb] of hit ? hit.blocked : []) {
          const ha = Math.max(a, ba), hb = Math.min(b, bb);
          if (ha < hb) parts.push(`<polygon class="pf-obstacle pf-obstacle-hit" clip-path="url(#pf-clip)" points="${block(ha, hb)}"/>`);
        }
      }
    }
  }
  for (const s of shown) {
    for (const line of profilePolylines(s.points, xOf, yOf)) {
      parts.push(`<polyline class="pf-line ${s.kind}" clip-path="url(#pf-clip)" points="${line.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}"/>`);
    }
    legend(s.kind, s.label);
  }
  /* La recta, encima de las curvas: continua entre las torres y, fuera de
     ellas, su prolongación discontinua. Se dibuja solo lo visible (con
     0,1 m por píxel, los extremos de una ruta larga caerían a cientos de
     miles de píxeles) y muestreada, porque con «Tierra plana» se curva. */
  const extras = [];
  if (los && profileShowLos) {
    const line = (a, b, cls) => {
      if (!(a < b)) return;
      const n = Math.max(2, Math.min(400, Math.ceil(pw * (b - a) / span / 4)));
      const pts = Array.from({ length: n + 1 }, (_, i) => {
        const d = a + (b - a) * i / n;
        return `${xOf(d).toFixed(1)},${yPix(losAt(d) / fy).toFixed(1)}`;
      });
      parts.push(`<polyline class="${cls}" clip-path="url(#pf-clip)" points="${pts.join(" ")}"/>`);
    };
    line(x0, Math.min(x1, dA), "pf-los-ext");
    line(sa, sb, "pf-los");
    line(Math.max(x0, dB), x1, "pf-los-ext");
    extras.push({ cls: "los", label: tr("Línea inicio–fin ({kind})", { kind: PROFILE_KIND_LABEL[los.kind] }) });
  }
  /* Las torres: del terreno a la antena, en su vértice (solo las que
     están a la vista y miden algo). Llevan `lift` como el terreno.   */
  if (los) {
    for (const [d, g, h, side] of [[dA, ground.a, profileTowerM.a, "start"], [dB, ground.b, profileTowerM.b, "end"]]) {
      if (d < x0 - eps || d > x1 + eps) continue;
      const x = xOf(d).toFixed(1), top = yOf(g + h, d);
      if (h > 0) {
        parts.push(`<line class="pf-tower" clip-path="url(#pf-clip)" x1="${x}" x2="${x}" y1="${yOf(g, d).toFixed(1)}" y2="${top.toFixed(1)}"/>`);
      }
      /* La antena es el extremo de la recta; su altura, a un lado (hacia
         dentro del enlace, que es donde hay sitio).                    */
      parts.push(`<circle class="pf-antenna" cx="${x}" cy="${top.toFixed(1)}" r="4"/>`);
      if (h > 0) {
        const lx = +x + (side === "start" ? 8 : -8), ly = top - 8;
        parts.push(`<text class="pf-tower-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${side}">${escapeHtml(fmtHeight(h, altitudeUnit))}</text>`);
      }
    }
  }
  if (los && profileFresnel) {
    /* DOS entradas, cada una con el aspecto de lo que nombra: el contorno
       discontinuo es la primera zona entera y el relleno, el 60 % que debe
       quedar libre (con una sola entrada no se sabía cuál era cuál). Cortas
       a propósito: una entrada que no cabe se pierde (la Tierra se perdía con
       los textos largos), y la frecuencia se lee aquí (las pruebas la miran). */
    extras.push({ cls: "fresnel", label: tr("Fresnel 100 %") });
    extras.push({ cls: "pf-fresnel60", swatch: true,
      label: tr("{zone} % · {freq} MHz", { zone: Math.round(PF_FRESNEL_ZONE * 100), freq: fresnelFreqMHz }) });
  }
  if (obstacles.length) extras.push({ cls: "obstacle", label: tr("Obstáculos ({n})", { n: obstacles.length }) });
  if (profileCurveMode !== "none") extras.push({ cls: "earth", label: PF_EARTH_LABEL[profileCurveMode]() });
  for (const e of extras) legend(e.cls, e.label, e.swatch);
  parts.push(`<line class="pf-cursor" id="pf-cursor" y1="${PF_MARGIN.t}" y2="${H - PF_MARGIN.b}" visibility="hidden"/>`,
    `<g id="pf-dots" clip-path="url(#pf-clip)"></g>`);
  profileChart.innerHTML = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${W} ${H}" role="img" `
    + `aria-label="${tr("Perfil de alturas a lo largo de la ruta")}">${parts.join("")}</svg>`;
  profileChart.classList.toggle("zoomed", span < total - eps || !!profileYView);
  showProfileTools(true);
  profileYLock.checked = !!profileYView;
  profileLosBox.checked = profileShowLos;
  profileCurveSel.value = profileCurveMode;
  profileFresnelBox.checked = profileFresnel;
  profileObsBox.checked = profileShowObstacles;
  /* Las referencias que este perfil tiene (la que no, deshabilitada) y la que vale */
  const hasSeries = k => series.some(x => x.kind === k);
  for (const o of profileRefSel.options) o.disabled = o.value === "obs" ? !(profileData.obstacles && profileData.obstacles.length) : !hasSeries(o.value);
  profileRefSel.value = profileRefKind();
  profileObsBox.disabled = !(profileData.obstacles && profileData.obstacles.length);
  updateObstructionNote(obstacles, [...obstructions.values()], !!los);
  syncProfileInputs();
  if (lastX !== undefined) showProfileCursor(lastX);
  else setProfileInfo(null);
}

/* Los campos de torre (en la unidad de altitud) reflejan el estado; el que se está escribiendo no se pisa (un redibujo por
   cambio de unidad o de tamaño no debe borrar lo tecleado), salvo con
   `force` (al confirmar).                                            */
function syncProfileInputs(force = false) {
  syncTowerVertexSelects();
  const fy = POLY_UNIT_FACTOR[altitudeUnit];
  const put = (el, v) => { if (force || document.activeElement !== el) el.value = v; };
  put(profileTowerInput.a, Number((profileTowerM.a / fy).toPrecision(6)));
  put(profileTowerInput.b, Number((profileTowerM.b / fy).toPrecision(6)));
  for (const el of document.querySelectorAll(".pf-tower-unit")) el.textContent = POLY_UNIT_LABEL[altitudeUnit];
}

/* Los desplegables de vértice de las torres: una opción por vértice
   («3 · 4.20 km»; el primero «Inicio», el último «Final»), con el valor
   en ÍNDICE. Las opciones se rehacen solo si cambia la ruta o la unidad
   de distancia (se llama en cada redibujado); el orden «inicio antes que
   final» se impone deshabilitando las opciones que lo romperían.      */
let towerSelFor = null;
function syncTowerVertexSelects() {
  if (!profileData) return;
  const { vertices, total } = profileData, n = vertices.length;
  if (!towerSelFor || towerSelFor.data !== profileData || towerSelFor.unit !== measureUnit) {
    towerSelFor = { data: profileData, unit: measureUnit };
    const fx = POLY_UNIT_FACTOR[measureUnit], dec = vertexDecimals(total / fx), unit = POLY_UNIT_LABEL[measureUnit];
    for (const sel of Object.values(profileTowerAtSel)) {
      sel.replaceChildren(...vertices.map((d, i) => {
        const dist = (d / fx).toFixed(dec);
        const txt = i === 0 ? tr("{n} · Inicio · {dist} {unit}", { n: i + 1, dist, unit })
          : i === n - 1 ? tr("{n} · Final · {dist} {unit}", { n: i + 1, dist, unit })
          : tr("{n} · {dist} {unit}", { n: i + 1, dist, unit });
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = txt;
        return opt;
      }));
    }
  }
  const { ia, ib } = profileTowerSpan(vertices, profileTowerAt);
  profileTowerAtSel.a.value = String(ia);
  profileTowerAtSel.b.value = String(ib);
  for (const o of profileTowerAtSel.a.options) o.disabled = +o.value >= ib;
  for (const o of profileTowerAtSel.b.options) o.disabled = +o.value <= ia;
  profileTowerAtSel.a.disabled = profileTowerAtSel.b.disabled = n < 3;
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
    bulge: profileCurveMode !== "none", clear: profileShowLos || profileFresnel,
    fres: profileFresnel, margin: profileFresnel,
    obs: obstaclesShown().length > 0,
    /* con «Obstáculos» como referencia, «Despeje» ya es éste: no se repite */
    oclear: obstaclesShown().length > 0 && (profileShowLos || profileFresnel) && profileRefKind() !== "obs"
  };
  /* Las dos filas que dependen de la referencia dicen CONTRA QUÉ se miden */
  const ref = profileRefName(profileRefKind());
  const dyn = { clear: tr("Despeje ({ref})", { ref }), margin: tr("Margen Fresnel ({ref})", { ref }) };
  for (const [k, text] of Object.entries(dyn)) {
    const label = profileInfoRows[k].querySelector(".pf-info-label");
    if (label.textContent !== text) { label.textContent = text; label.title = text; }
  }
  for (const [k, row] of Object.entries(profileInfoRows)) {
    const v = on[k] && values ? values[k] : null;
    const val = row.querySelector(".pf-info-val");
    val.textContent = v ? v.txt : "\u2014";
    val.title = v ? v.txt : ""; /* un nombre largo se corta con puntos suspensivos */
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
  const at = {}, near = {};
  for (const s of profileData.series) {
    const p = nearestProfilePoint(s.points, d);
    if (p && Math.abs(p.d - d) <= snap) { at[s.kind] = p.v; near[s.kind] = p; }
  }
  /* Un punto con anillo sobre cada curva que se lee (y sobre la recta, si
     está dibujada): el ojo ve de qué altura habla la lectura. */
  const dots = Object.entries(near).map(([kind, p]) =>
    `<circle class="pf-dot ${kind}" cx="${lay.xOf(p.d).toFixed(1)}" cy="${lay.yOf(p.v, p.d).toFixed(1)}" r="4"/>`);
  if (lay.los && profileShowLos) dots.push(`<circle class="pf-dot los" cx="${px.toFixed(1)}" cy="${lay.yPix(lay.losAt(d) / POLY_UNIT_FACTOR[altitudeUnit]).toFixed(1)}" r="4"/>`);
  svg.querySelector("#pf-dots").innerHTML = dots.join("");
  const diffTxt = v => `${fmtDiff(v)} ${u}`;
  const info = { dist: { txt: `${(d / fx).toFixed(distDecimals((lay.x1 - lay.x0) / lay.pw, fx))} ${POLY_UNIT_LABEL[measureUnit]}` } };
  for (const kind of ["mdt", "mds"]) if (at[kind] !== undefined) info[kind] = { txt: fmtHeight(at[kind], altitudeUnit) };
  if (at.mdt !== undefined && at.mds !== undefined) {
    const diff = at.mds - at.mdt;
    info.diff = { txt: diffTxt(diff), alert: diff > ELEV_ALERT_DIFF };
  }
  /* Lo que responde a «¿hay línea de vista?»: la corrección de curvatura
     de este modo a esta distancia (la que se suma al terreno o a la
     línea, con signo) y cuánto pasa la recta por encima del terreno ya
     corregido (negativo, en rojo = lo tapa): el mismo número en los tres
     modos. Las alturas siguen siendo las reales, sin la corrección.
     Fuera de las torres es la prolongación de la recta, y solo se lee
     si está dibujada; Fresnel y su margen existen solo entre ellas.   */
  const lift = lay.lift(d);
  if (profileCurveMode !== "none") info.bulge = { txt: diffTxt(profileCurveMode === "flat" ? lay.bend(d) : lift) };
  const between = d >= lay.dA && d <= lay.dB;
  /* El obstáculo bajo el cursor (el de techo más alto si se solapan), con su
     techo AMSL.                                                           */
  let top = null;
  for (const o of obstaclesShown()) {
    const z = obstacleRoofAt(o, d);
    if (z !== null && (!top || z > top.z)) top = { o, z };
  }
  if (top) info.obs = { txt: `${top.o.name} \u00B7 ${fmtHeight(top.z, altitudeUnit)}` };
  /* «Despeje» y «Margen Fresnel»: cuánto pasa la recta por encima de la
     REFERENCIA elegida (`profileRefKind`: el terreno, la superficie o el
     techo del obstáculo de arriba; la etiqueta de la fila lo dice) —en rojo
     si es negativo: la tapa—. Es el mismo número en los tres modos de
     curvatura (`losAt − lift − referencia`, en el marco de las series; las
     alturas leídas siguen siendo las reales). Fuera de las torres es la
     prolongación de la recta, y solo se lee si está dibujada; Fresnel y su
     margen existen solo entre ellas. El RADIO de Fresnel no depende de la
     referencia. El margen es el despeje menos el radio al 60 %: con el
     terreno o la superficie, negativo = entran en la zona; con un
     obstáculo, lo mismo con su techo.                                      */
  const ref = profileRefKind();
  const base = ref === "obs" ? (top ? top.z : undefined) : at[ref];
  const lineHere = lay.los && (between || profileShowLos);
  if (lineHere && base !== undefined) {
    const clear = lay.losAt(d) - lift - base;
    info.clear = { txt: diffTxt(clear), alert: clear < 0 };
    if (profileFresnel && between) {
      const margin = clear - PF_FRESNEL_ZONE * lay.fresnel(d);
      info.margin = { txt: diffTxt(margin), alert: margin < 0 };
    }
  }
  if (lay.los && profileFresnel && between) info.fres = { txt: fmtHeight(PF_FRESNEL_ZONE * lay.fresnel(d), altitudeUnit) };
  /* Con otra referencia, «Despeje obstáculo» sigue dando el del techo (sin Fresnel) */
  if (top && lineHere && ref !== "obs") {
    const clear = lay.losAt(d) - lift - top.z;
    info.oclear = { txt: diffTxt(clear), alert: clear < 0 };
  }
  setProfileInfo(info);
  placeProfileArrow(d);
}

function hideProfileCursor() {
  if (profileLayout) delete profileLayout.lastX;
  const svg = profileChart.firstChild;
  const el = svg && svg.querySelector && svg.querySelector("#pf-cursor");
  if (el) el.setAttribute("visibility", "hidden");
  const dots = svg && svg.querySelector && svg.querySelector("#pf-dots");
  if (dots) dots.innerHTML = "";
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
profileCurveSel.addEventListener("change", () => {
  if (PF_CURVE_MODES.includes(profileCurveSel.value)) profileCurveMode = profileCurveSel.value;
  scheduleProfileChart();
});
/* El vértice de cada torre: el valor es un índice, no un texto */
for (const k of ["a", "b"]) {
  profileTowerAtSel[k].addEventListener("change", () => {
    profileTowerAt[k] = Number(profileTowerAtSel[k].value);
    persistProfileTowers();
    scheduleProfileChart();
  });
}
profileFresnelBox.addEventListener("change", () => { profileFresnel = profileFresnelBox.checked; scheduleProfileChart(); });
profileObsBox.addEventListener("change", () => { profileShowObstacles = profileObsBox.checked; scheduleProfileChart(); });
profileRefSel.addEventListener("change", () => { profileRef = profileRefSel.value; scheduleProfileChart(); });
/* «Actualizar obstáculos»: los polígonos con altitud que hay AHORA a la vista,
   sobre las series de este perfil (sin red). Sustituye a los guardados: el
   perfil es una foto y esto es sacar otra, a petición. */
function updateProfileObstacles() {
  const d = profileData;
  if (!d) return;
  const { obstacles, skipped } = collectProfileObstacles(d.legs, d.vertices, profileTerrainSeries(d.series));
  d.obstacles = obstacles;
  persistProfileEdit({ obstacles });
  scheduleProfileChart();
  const notes = obstacleSkipNotes(skipped);
  navMessage([trn(obstacles.length, "{n} obstáculo en el perfil.", "{n} obstáculos en el perfil.", { n: obstacles.length }),
    ...notes].join(" "), { tone: notes.length ? "error" : "info" });
}
document.getElementById("pf-obstacles-refresh").addEventListener("click", updateProfileObstacles);
/* Torres: `change` (al confirmar, no a cada tecla). Vacío vuelve al
   vigente; fuera de rango se ajusta a la cota y se avisa, como el resto
   de ajustes numéricos (`readClampedNumber`, 43-points-editor.js).     */
for (const k of ["a", "b"]) {
  profileTowerInput[k].addEventListener("change", () => {
    const fy = POLY_UNIT_FACTOR[altitudeUnit];
    const v = readClampedNumber(profileTowerInput[k], 0, PF_TOWER_MAX / fy, tr("La altura de torre"), POLY_UNIT_LABEL[altitudeUnit]);
    if (v !== null) profileTowerM[k] = Math.min(PF_TOWER_MAX, v * fy);
    persistProfileTowers();
    syncProfileInputs(true);
    scheduleProfileChart();
  });
}
document.getElementById("pf-reset").addEventListener("click", () => {
  profileView = null;
  profileYView = null;
  scheduleProfileChart();
});

/* ---------- Exportar el perfil: CSV e imagen ----------
   El CSV es la ruta ENTERA (no lo que se ve) en las unidades de la
   gráfica; el PNG, la gráfica TAL COMO se ve, con su zoom.             */

/* Las filas del CSV: una por cada distancia donde ALGUNA serie tiene un
   punto (las dos mallas son distintas, 5 m y 25 m por ejemplo: la unión,
   con la celda vacía donde una serie no tiene punto), en orden, con la
   latitud y la longitud de ese punto de la ruta (`locate(d)`, d en
   metros; null = vacías). Lo vacío es vacío, nunca un 0 inventado: un
   hueco del servicio sigue siendo un hueco. PURA. `dialect` (csvDialect,
   54-attr-table.js): separador de campos y marca decimal según el idioma
   de la interfaz; por omisión, coma y punto.

   `link` (null sin recta ni Fresnel activados) añade lo que la gráfica
   dibuja entre las torres: `{ dA, dB, showLos, showFresnel, altitude(d),
   radius(d) }`, distancias y alturas en METROS. Entonces:
   - se añaden filas en la distancia EXACTA de cada torre (sus vértices no
     suelen coincidir con ninguna celda), con latitud y longitud, y la
     columna «Torre» vale 1 en la torre de inicio, 2 en la final y 0 en el
     resto; las series de esas filas quedan vacías salvo que haya un punto
     justo ahí (no se inventa un valor);
   - «Línea de vista»: la altitud de la recta, en el MISMO marco que las
     series (con la curvatura elegida: es la que mide el «Despeje»; en los
     extremos, la antena), también fuera de las torres si la recta está
     activada (su prolongación);
   - «Fresnel 60 % inferior» y «superior»: la altitud de la recta menos y
     más el radio de la zona del 60 %, solo entre las torres (fuera, vacías:
     el elipsoide no existe). El inferior es el que el terreno no debe pasar.

   `obstacles` (null sin ninguno que enseñar): los polígonos con altitud que
   se dibujan. Añaden filas en la entrada y la salida EXACTAS de cada tramo
   y dos columnas: «Obstáculo» (el nombre de los que hay en esa distancia,
   unidos con « / ») y «Techo obstáculo» (el más alto, AMSL, en la unidad de
   altitud); vacías fuera de todos.                                     */
function profileCsv(data, u, locate, dialect = CSV_DEFAULT, link = null, obstacles = null) {
  const distances = new Set();
  const lookups = data.series.map(s => {
    const m = new Map();
    for (const p of s.points) { distances.add(p.d); if (typeof p.v === "number" && Number.isFinite(p.v)) m.set(p.d, p.v); }
    return m;
  });
  if (link) { distances.add(link.dA); distances.add(link.dB); }
  const obs = obstacles && obstacles.length ? obstacles : null;
  if (obs) for (const o of obs) for (const sp of o.spans) { distances.add(sp[0][0]); distances.add(sp[sp.length - 1][0]); }
  const alt = v => Number.isFinite(v) ? +(v / u.altFactor).toFixed(u.altDecimals) : "";
  const rows = [...distances].sort((a, b) => a - b).map(d => {
    const at = locate(d);
    const row = [+(d / u.distFactor).toFixed(5), at ? +at.lat.toFixed(6) : "", at ? +at.lng.toFixed(6) : "",
      ...lookups.map(m => m.has(d) ? +(m.get(d) / u.altFactor).toFixed(u.altDecimals) : "")];
    if (link) {
      row.push(d === link.dA ? 1 : d === link.dB ? 2 : 0);
      const line = link.altitude(d);
      if (link.showLos) row.push(alt(line));
      if (link.showFresnel) {
        const inside = d >= link.dA && d <= link.dB, r = link.radius(d);
        row.push(inside ? alt(line - r) : "", inside ? alt(line + r) : "");
      }
    }
    if (obs) {
      const here = obs.map(o => ({ o, z: obstacleRoofAt(o, d) })).filter(x => x.z !== null);
      row.push(here.map(x => x.o.name).join(" / "), here.length ? alt(Math.max(...here.map(x => x.z))) : "");
    }
    return row;
  });
  const zone = Math.round(PF_FRESNEL_ZONE * 100); /* 60 */
  const header = [tr("Distancia ({unit})", { unit: u.distLabel }), tr("Latitud"), tr("Longitud"),
    ...data.series.map(s => `${s.kind.toUpperCase()} (${u.altLabel})`),
    ...(link ? [tr("Torre")] : []),
    ...(link && link.showLos ? [tr("Línea de vista ({unit})", { unit: u.altLabel })] : []),
    ...(link && link.showFresnel ? [tr("Fresnel {zone} % inferior ({unit})", { zone, unit: u.altLabel }),
      tr("Fresnel {zone} % superior ({unit})", { zone, unit: u.altLabel })] : []),
    ...(obs ? [tr("Obstáculo"), tr("Techo obstáculo ({unit})", { unit: u.altLabel })] : [])];
  return "\uFEFF" + toCsv(header, rows, dialect); /* BOM: Excel lee UTF-8 */
}

/* El nombre de los archivos: el de la ruta, sin lo que un sistema de archivos no admite */
const profileExportName = () => `${safeFileName((profileData.li && profileData.li._name) || tr("Ruta"))}-${tr("perfil")}`;

/* Lo del enlace que va al CSV (ver profileCsv): null si ni la recta ni
   Fresnel están activados. La altitud de la recta en el marco de las series
   es la dibujada menos la elevación de la Tierra (`lift`): así vale lo mismo
   en los tres modos de curvatura, igual que el «Despeje».                 */
function profileCsvLink(data) {
  const m = profileLinkModel(data.series, data.vertices, profileLinkOpts());
  if (!m.los) return null;
  return { dA: m.dA, dB: m.dB, showLos: profileShowLos, showFresnel: profileFresnel,
    altitude: d => m.losAt(d) - m.lift(d), radius: d => PF_FRESNEL_ZONE * m.fresnel(d) };
}

function exportProfileCsv() {
  if (!profileData) return;
  const data = profileData;
  const locate = d => {
    const p = profilePointAt(data.legs, data.vertices, d);
    if (!p) return null;
    const ll = map.options.crs.unproject(L.point(p.x, p.y));
    return { lat: ll.lat, lng: ll.lng };
  };
  const text = profileCsv(data, { distFactor: POLY_UNIT_FACTOR[measureUnit], altFactor: POLY_UNIT_FACTOR[altitudeUnit],
    altDecimals: HEIGHT_DECIMALS[altitudeUnit], distLabel: POLY_UNIT_LABEL[measureUnit], altLabel: POLY_UNIT_LABEL[altitudeUnit] }, locate, csvDialect(uiLang), profileCsvLink(data), obstaclesShown());
  downloadBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), `${profileExportName()}.csv`);
}

/* Lo que pinta la hoja de estilos de la página (clases `.pf-*` con
   variables `var(--…)` y `light-dark()`) no existe en un SVG suelto: se
   copia a cada elemento su valor CALCULADO, que ya es un color de verdad,
   y la imagen sale igual que en pantalla, en el tema que haya.         */
const PF_EXPORT_PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray",
  "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "text-anchor",
  "dominant-baseline", "paint-order", "visibility"];
const PF_EXPORT_TITLE_PX = 30;
const PF_EXPORT_SCALE = 2;

function inlineSvgStyles(src, dst) {
  const from = [src, ...src.querySelectorAll("*")], to = [dst, ...dst.querySelectorAll("*")];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    for (const p of PF_EXPORT_PROPS) to[i].style.setProperty(p, cs.getPropertyValue(p));
  });
}

/* El SVG de la gráfica listo para exportar: con los estilos dentro, sin el
   cursor ni los puntos de lectura (son del ratón), con fondo y un título.  */
function profileExportSvg() {
  const svg = profileChart.querySelector("svg");
  if (!svg) return null;
  const W = profileChart.clientWidth, H = profileChart.clientHeight;
  const clone = svg.cloneNode(true);
  inlineSvgStyles(svg, clone);
  for (const id of ["pf-cursor", "pf-dots"]) { const n = clone.querySelector("#" + id); if (n) n.remove(); }
  clone.setAttribute("width", W);
  clone.setAttribute("height", H);
  const box = getComputedStyle(profileBox);
  const title = `${(profileData.li && profileData.li._name) || tr("Ruta")} \u2014 ${profileData.series.map(s => s.label).join(" + ")}`;
  const outer = `<svg xmlns="${SVG_NS}" width="${W}" height="${H + PF_EXPORT_TITLE_PX}" viewBox="0 0 ${W} ${H + PF_EXPORT_TITLE_PX}">`
    + `<rect width="100%" height="100%" fill="${box.backgroundColor}"/>`
    + `<text x="${PF_MARGIN.l}" y="20" fill="${box.color}" font-family="system-ui, sans-serif" font-size="14" font-weight="600">${escapeHtml(title)}</text>`
    + `<g transform="translate(0 ${PF_EXPORT_TITLE_PX})">${new XMLSerializer().serializeToString(clone)}</g></svg>`;
  return { svg: outer, w: W, h: H + PF_EXPORT_TITLE_PX };
}

/* SVG → <img> (un `data:`, que la CSP admite) → lienzo al doble de tamaño → PNG.
   Sin html2canvas: un SVG propio no la necesita y no pide ninguna librería.   */
async function exportProfilePng() {
  if (!profileData) return;
  const out = profileExportSvg();
  if (!out) return;
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error(tr("el navegador no pudo dibujar la gráfica")));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(out.svg);
    });
    const canvas = document.createElement("canvas");
    canvas.width = out.w * PF_EXPORT_SCALE;
    canvas.height = out.h * PF_EXPORT_SCALE;
    const g = canvas.getContext("2d");
    g.scale(PF_EXPORT_SCALE, PF_EXPORT_SCALE);
    g.drawImage(img, 0, 0, out.w, out.h);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error(tr("no se pudo generar la imagen"));
    downloadBlob(blob, `${profileExportName()}.png`);
  } catch (err) {
    navMessage(tr("No se pudo exportar el perfil: {message}", { message: err.message }));
  }
}
document.getElementById("pf-csv").addEventListener("click", exportProfileCsv);
document.getElementById("pf-png").addEventListener("click", exportProfilePng);

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
