/* ================= Ortofotos COG (Cloud Optimized GeoTIFF) =================
   Una ortofoto del PNOA pesa cientos de MB: no se puede convertir en
   una imagen ni guardar como texto en el árbol (lo que hace un
   GroundOverlay de KMZ). Un COG está hecho para leerse a trozos: en
   mosaico y con vistas generales (la misma imagen a 1/2, 1/4…), así
   que para cada tesela del mapa basta leer la ventana justa del nivel
   que toca.

   - Los BYTES van, tal cual, como Blob al almacén "rasters" de
     IndexedDB (ver DB_VERSION v4); el nodo del árbol solo guarda su id,
     la extensión y la opacidad. Así persiste entre sesiones sin pasar
     nunca por texto.
   - La lectura la hace geotiff.js (`fromBlob`: lee con Blob.slice, sin
     cargar el archivo), en el hilo principal: la CSP no deja crear los
     workers de su Pool.
   - Se pinta con una L.GridLayer propia: cada tesela es un <canvas> que
     se llena pidiendo al COG la ventana que cubre. La ortofoto suele
     venir en ETRS89 UTM, no en la Web Mercator del mapa: cada píxel de
     la tesela busca su píxel de origen interpolando una malla de
     COG_GRID × COG_GRID puntos proyectados con proj4 (proyectarlos
     todos costaría 65 536 llamadas por tesela; la malla da error de
     una fracción de píxel, ver tests/cogtest.js).
   - Un GeoTIFF de UNA banda con 16 o más bits (un modelo de elevación,
     p. ej. un MDT del CNIG) entra por el mismo camino pero se pinta con
     una rampa de color por altitud y sombreado de relieve (`warpDemTile`),
     y el cuadro de coordenadas da su altitud bajo el cursor
     (`demAltitudeAt`). Sigue siendo un nodo `cog`: no se guarda nada
     más, el tipo se deduce de la propia imagen al abrirla.
   - Las teselas viven en `rotatePane`: con el mapa girado se piden
     para la caja de la vista girada (parche de GridLayer en
     08-map-rotation.js) y giran con el resto sin hacer nada.         */

const COG_PANE = "kiteCogPane";
const COG_TILE = 256;
const COG_GRID = 16;
/* Ventana máxima que se lee para UNA tesela (píxeles del nivel
   elegido). Sin una vista general adecuada, alejarse pediría la imagen
   entera por tesela: por encima de esto la tesela se deja vacía y el
   aviso de la importación ya dijo por qué.                           */
const COG_MAX_WINDOW = 2048 * 2048;
/* Teselas leyéndose a la vez: decodificar JPEG es trabajo del hilo
   principal, y cuarenta a la vez solo multiplican la memoria.      */
const COG_CONCURRENCY = 4;
/* Margen de la cuota del navegador que no se apura al copiar */
const COG_QUOTA_MARGIN = 0.95;

/* Sistemas admitidos. proj4 solo trae de serie 4326 y 3857; el resto se
   define aquí, y lo que no esté se rechaza nombrándolo (no se supone
   nada). Solo entran familias que el código EPSG determina POR
   COMPLETO: UTM de WGS84 (todo el mundo, p. ej. Sentinel-2) y de ETRS89
   (Europa), más los de la cartografía española. ED50 se queda en los
   husos peninsulares: sus parámetros de transformación (ED50_TOWGS84)
   solo valen en España, y en otro huso darían un desplazamiento sin
   aviso.                                                            */
function cogCrsDef(epsg) {
  if (epsg === 4326) return "+proj=longlat +datum=WGS84 +no_defs";
  if (epsg === 4258) return "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs";
  if (epsg === 3857) return "EPSG:3857";
  const utm = (zone, datum) => `+proj=utm +zone=${zone} ${datum} +units=m +no_defs`;
  /* ETRS89 / UTM 28N–38N, con los dos códigos del EPSG: 258zz (E, N) y
     30zz (N, E: 3040 es el huso 28, 3043 el 31). Un GeoTIFF guarda
     siempre x = este e y = norte, sea cual sea el orden de ejes del
     código, así que es la misma proyección.                          */
  const etrs = "+ellps=GRS80 +towgs84=0,0,0,0,0,0,0";
  if (epsg >= 25828 && epsg <= 25838) return utm(epsg - 25800, etrs);
  if (epsg >= 3040 && epsg <= 3050) return utm(epsg - 3012, etrs);
  /* WGS84 / UTM norte (326zz) y sur (327zz): el hemisferio sur lleva
     falso norte de 10 000 km, que proj4 solo aplica con +south       */
  if (epsg >= 32601 && epsg <= 32660) return utm(epsg - 32600, "+datum=WGS84");
  if (epsg >= 32701 && epsg <= 32760) return utm(epsg - 32700, "+datum=WGS84 +south");
  /* ED50, con los parámetros peninsulares (ver ED50_TOWGS84) */
  if (epsg >= 23028 && epsg <= 23031) return utm(epsg - 23000, `+ellps=intl +towgs84=${ED50_TOWGS84}`);
  /* REGCAN95 / UTM 27N y 28N: el PNOA de Canarias */
  if (epsg === 4082 || epsg === 4083) return utm(epsg - 4055, "+ellps=GRS80 +towgs84=0,0,0,0,0,0,0");
  return null;
}
const COG_CRS_LIST = "WGS84 (4326), ETRS89 (4258), Web Mercator (3857), ETRS89 UTM 28–38 "
  + "(25828–25838 y 3040–3050), WGS84 UTM norte y sur (32601–32660, 32701–32760), ED50 UTM 28–31 "
  + "y REGCAN95 UTM 27–28";

/* El EPSG de las GeoKeys de la imagen: el proyectado si lo hay, si no
   el geográfico. 32767 es «definido por el usuario»: sin código no hay
   nada que buscar en la tabla.                                       */
function cogEpsg(keys) {
  if (!keys) return null;
  const ok = v => Number.isInteger(v) && v > 0 && v !== 32767;
  if (ok(keys.ProjectedCSTypeGeoKey)) return keys.ProjectedCSTypeGeoKey;
  if (ok(keys.GeographicTypeGeoKey) && keys.GTModelTypeGeoKey !== 1) return keys.GeographicTypeGeoKey;
  return null;
}

/* Qué nivel leer: el de MENOS detalle que siga siendo al menos tan fino
   como lo que se pinta. `factors`, de cada nivel respecto al original
   (1, 2, 4…); `wanted`, cuántos píxeles del original caen en uno de la
   tesela. Más fino de lo necesario solo gasta; más basto, emborrona. */
function pickOverview(factors, wanted) {
  let best = 0;
  for (let i = 0; i < factors.length; i++) {
    if (factors[i] <= wanted * 1.001 && factors[i] > factors[best]) best = i;
  }
  return best;
}

/* La ventana del nivel que cubre una malla de puntos (pares x, y en
   píxeles de ese nivel), con un píxel de margen y recortada a la
   imagen; null si la tesela cae fuera.                              */
function tileWindow(grid, w, h) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < grid.length; k += 2) {
    const x = grid[k], y = grid[k + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!(x0 <= x1 && y0 <= y1)) return null;
  const win = [Math.max(0, Math.floor(x0) - 1), Math.max(0, Math.floor(y0) - 1),
               Math.min(w, Math.ceil(x1) + 1), Math.min(h, Math.ceil(y1) + 1)];
  return win[0] < win[2] && win[1] < win[3] ? win : null;
}

/* Recorre los píxeles de una tesela (size × size) y, para cada uno,
   busca el de origen que le corresponde: su posición sale de interpolar
   la malla (G+1)² en coordenadas de la VENTANA leída. Vecino más
   próximo, a propósito: una ortofoto es dato, y promediar píxeles
   inventaría colores que no están en la imagen. Fuera de la ventana,
   deja el píxel transparente; dentro, llama a `paint(o, sx, sy)` con
   el desplazamiento en `out` y el píxel de origen. PURA.            */
function warpPixels(grid, G, size, ww, wh, out, paint) {
  const cell = size / G;
  const row = (G + 1) * 2;
  for (let v = 0; v < size; v++) {
    const gy = (v + 0.5) / cell;
    const j = Math.min(G - 1, Math.floor(gy));
    const ty = gy - j;
    for (let u = 0; u < size; u++) {
      const gx = (u + 0.5) / cell;
      const i = Math.min(G - 1, Math.floor(gx));
      const tx = gx - i;
      const k00 = j * row + i * 2, k10 = k00 + 2, k01 = k00 + row, k11 = k01 + 2;
      const x = (1 - ty) * ((1 - tx) * grid[k00] + tx * grid[k10])
              + ty * ((1 - tx) * grid[k01] + tx * grid[k11]);
      const y = (1 - ty) * ((1 - tx) * grid[k00 + 1] + tx * grid[k10 + 1])
              + ty * ((1 - tx) * grid[k01 + 1] + tx * grid[k11 + 1]);
      const o = (v * size + u) * 4;
      const sx = Math.floor(x), sy = Math.floor(y);
      if (!(sx >= 0 && sy >= 0 && sx < ww && sy < wh)) { out[o + 3] = 0; continue; }
      paint(o, sx, sy);
    }
  }
}

/* Rellena `out` (RGBA) con una ortofoto: la máscara y el nodata dejan el
   píxel transparente. PURA.                                         */
function warpTile(src, ww, wh, ch, mask, nodata, grid, G, size, out) {
  warpPixels(grid, G, size, ww, wh, out, (o, sx, sy) => {
    const p = sy * ww + sx;
    if (mask && !mask[p]) { out[o + 3] = 0; return; }
    const s = p * ch;
    const r = src[s], g = src[s + 1], b = src[s + 2];
    if (nodata !== null && r === nodata && g === nodata && b === nodata) { out[o + 3] = 0; return; }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = ch === 4 ? src[s + 3] : 255;
  });
}

/* ---------- Modelos de elevación (GeoTIFF de una banda) ----------
   Rampa hipsométrica (verde → amarillo → marrón → blanco) entre el
   mínimo y el máximo de la propia imagen, con sombreado de relieve por
   encima. El color es la altitud REAL de la celda (vecino más próximo,
   sin interpolar); el sombreado solo ayuda a leer el relieve.        */
const DEM_RAMP = [
  [0, [56, 128, 60]], [0.25, [160, 190, 90]], [0.5, [225, 215, 130]],
  [0.75, [170, 120, 70]], [1, [245, 245, 245]]
];
/* Luz del noroeste a 45°, el sombreado cartográfico de siempre. El
   relieve se exagera ×2: con celdas de 200 m las pendientes son tan
   suaves que sin ello apenas se nota. Es solo sombreado; la altitud la
   da el color y la lectura bajo el cursor.                            */
const DEM_LIGHT_AZIMUTH = 315, DEM_LIGHT_ALTITUDE = 45, DEM_Z_FACTOR = 2;
const DEM_BLOCK = 128;

/* Color de la rampa para t en [0, 1] (fuera, se recorta). PURA. */
function demColor(t) {
  const x = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  let k = 1;
  while (k < DEM_RAMP.length - 1 && x > DEM_RAMP[k][0]) k++;
  const [t0, c0] = DEM_RAMP[k - 1], [t1, c1] = DEM_RAMP[k];
  const f = (x - t0) / (t1 - t0);
  return c0.map((v, i) => v + (c1[i] - v) * f);
}

/* Claridad del relieve en [0, 1] para un píxel con las alturas de sus
   vecinos (oeste, este, norte, sur) y el tamaño de celda en metros.
   Llano da sin(altitud de la luz). PURA.                             */
function demHillshade(zw, ze, zn, zs, cx, cy) {
  const dzdx = (ze - zw) / (2 * cx), dzdy = (zn - zs) / (2 * cy);
  const nx = -DEM_Z_FACTOR * dzdx, ny = -DEM_Z_FACTOR * dzdy;
  const len = Math.sqrt(nx * nx + ny * ny + 1);
  const az = DEM_LIGHT_AZIMUTH * Math.PI / 180, alt = DEM_LIGHT_ALTITUDE * Math.PI / 180;
  const lx = Math.sin(az) * Math.cos(alt), ly = Math.cos(az) * Math.cos(alt), lz = Math.sin(alt);
  return Math.max(0, (nx * lx + ny * ly + lz) / len);
}

/* Mínimo y máximo de las altitudes VÁLIDAS (sin nodata ni valores fuera
   de rango, ver elevValue), o null si no hay ninguna. PURA.            */
function demRange(values, nodata) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = elevValue(Number(values[i]), nodata);
    if (v === null) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : null;
}

/* Pinta una tesela de elevación: `src` son las altitudes de la ventana
   (ww × wh); `opt` trae el rango de la rampa (`min`, `max`) y el tamaño
   de celda en metros del nivel leído (`cx`, `cy`). Una celda sin dato
   (o fuera de la máscara) queda transparente; un vecino sin dato se
   sustituye por la propia celda al sombrear. PURA.                    */
function warpDemTile(src, ww, wh, mask, nodata, grid, G, size, out, opt) {
  const span = opt.max - opt.min || 1;
  const at = (x, y) => elevValue(Number(src[y * ww + x]), nodata);
  warpPixels(grid, G, size, ww, wh, out, (o, sx, sy) => {
    const p = sy * ww + sx;
    const z = mask && !mask[p] ? null : at(sx, sy);
    if (z === null) { out[o + 3] = 0; return; }
    const nb = (x, y) => (x < 0 || y < 0 || x >= ww || y >= wh ? z : (at(x, y) ?? z));
    const hs = demHillshade(nb(sx - 1, sy), nb(sx + 1, sy), nb(sx, sy - 1), nb(sx, sy + 1), opt.cx, opt.cy);
    const k = 0.35 + 0.65 * hs;
    const c = demColor((z - opt.min) / span);
    out[o] = Math.min(255, c[0] * k);
    out[o + 1] = Math.min(255, c[1] * k);
    out[o + 2] = Math.min(255, c[2] * k);
    out[o + 3] = 255;
  });
}

/* Los ids de "rasters" que ya no nombra nadie: ni el árbol ni las
   instantáneas de deshacer/rehacer ni el portapapeles interno. PURA. */
function orphanRasterIds(nodeLists, storedIds) {
  const used = new Set();
  const walk = list => {
    for (const n of list || []) {
      if (n.t === "cog") used.add(n.rasterId);
      if (n.children) walk(n.children);
    }
  };
  for (const list of nodeLists) walk(list);
  return storedIds.filter(id => !used.has(id));
}

/* Un registro "cog" leído de fuera (IndexedDB, un .kite.json) es
   entrada ajena: id con la forma de los nuestros, caja finita y en
   rango, opacidad entre 0 y 1. PURA.                                */
const COG_ID_RE = /^[0-9a-f]{32}$/;
function validCogRecord(n) {
  if (!n || typeof n.rasterId !== "string" || !COG_ID_RE.test(n.rasterId)) return false;
  const b = n.box;
  if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) return false;
  const [s, w, nn, e] = b;
  return s < nn && w < e && s >= -90 && nn <= 90 && w >= -180 && e <= 180;
}

/* ---------- Almacén "rasters" ---------- */
function dbRasterTx(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_RASTERS, mode);
    const rq = fn(tx.objectStore(DB_RASTERS));
    let out;
    if (rq) rq.onsuccess = () => { out = rq.result; };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}
const dbPutRaster = (id, rec) => dbRasterTx("readwrite", st => st.put(rec, id));
const dbGetRaster = id => dbRasterTx("readonly", st => st.get(id));
const dbRasterKeys = () => dbRasterTx("readonly", st => st.getAllKeys());
const dbDeleteRasters = ids => dbRasterTx("readwrite", st => { for (const id of ids) st.delete(id); return null; });

function newRasterId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

/* Al arrancar, con el árbol ya restaurado: se borran los blobs que nada
   nombra (una ortofoto borrada en otra sesión). En sesión no se borra
   nada, porque deshacer puede devolver el nodo.                       */
async function cleanOrphanRasters() {
  const ids = await dbRasterKeys();
  if (!ids || !ids.length) return;
  const lists = [serializeTree(), ...undoStack.map(s => s.nodes), ...redoStack.map(s => s.nodes)];
  if (clipboard) lists.push(clipboard.nodes);
  const orphans = orphanRasterIds(lists, ids);
  if (orphans.length) await dbDeleteRasters(orphans);
}

/* ---------- Abrir un COG ---------- */

/* Abre y valida. Lanza con un mensaje para el usuario si la imagen no
   se puede dibujar; si se puede pero irá mal (sin mosaico, sin vistas
   generales), lo dice en `notes`.                                    */
async function openCog(blob) {
  if (typeof GeoTIFF === "undefined") throw new Error("no se pudo cargar el soporte de GeoTIFF");
  if (typeof proj4 === "undefined") throw new Error("no se pudo cargar el soporte de proyecciones");
  let tiff, first;
  try {
    tiff = await GeoTIFF.fromBlob(blob);
    first = await tiff.getImage(0);
  } catch (err) {
    throw new Error(`no es un GeoTIFF legible (${err && err.message || err})`);
  }
  const fd = first.fileDirectory;
  /* Vienen como array tipado (o un número suelto): Array.from los
     despliega, [].concat no.                                        */
  const list = v => (v === undefined ? [] : typeof v === "number" ? [v] : Array.from(v));
  const bits = list(fd.BitsPerSample), fmt = list(fd.SampleFormat);
  const samples = Number(fd.SamplesPerPixel) || bits.length || 1;
  /* Una ortofoto son canales de 8 bits; un modelo de elevación, una sola
     banda de enteros (16/32 bits) o de coma flotante (32/64).         */
  const isOrtho = bits.length > 0 && bits.every(b => b === 8) && fmt.every(f => f === 1);
  const isDem = samples === 1 && bits.length === 1 && (fmt[0] === 3 ? bits[0] >= 32
    : bits[0] >= 16 && (fmt.length === 0 || fmt[0] === 1 || fmt[0] === 2));
  if (!isOrtho && !isDem) {
    throw new Error("solo se dibujan ortofotos de 8 bits por canal y modelos de elevación de una banda "
      + `(esta tiene ${samples} banda(s) de ${bits.join("/") || "?"} bits)`);
  }
  const epsg = cogEpsg(first.getGeoKeys());
  const def = epsg && cogCrsDef(epsg);
  if (!def) {
    throw new Error(epsg
      ? `sistema de coordenadas EPSG:${epsg} no admitido (admitidos: ${COG_CRS_LIST})`
      : "la imagen no está georreferenciada (no trae su sistema de coordenadas)");
  }
  let ox, oy, rx, ry;
  try {
    [ox, oy] = first.getOrigin();
    [rx, ry] = first.getResolution();
  } catch {
    throw new Error("georreferencia no admitida (imagen girada o sin origen)");
  }
  const W = first.getWidth(), H = first.getHeight();

  /* Niveles y máscaras: NewSubfileType bit 0 = vista general, bit 2 =
     máscara. Una máscara va con el nivel de su mismo tamaño.        */
  const levels = [{ image: first, w: W, h: H, fx: 1, fy: 1, mask: null }];
  const masks = [];
  const count = await tiff.getImageCount();
  for (let i = 1; i < count; i++) {
    const img = await tiff.getImage(i);
    const t = img.fileDirectory.NewSubfileType || 0;
    const w = img.getWidth(), h = img.getHeight();
    if (t & 4) masks.push({ img, w, h });
    else if (t & 1) levels.push({ image: img, w, h, fx: W / w, fy: H / h, mask: null });
  }
  for (const m of masks) {
    const lv = levels.find(l => l.w === m.w && l.h === m.h);
    if (lv) lv.mask = m.img;
  }
  levels.sort((a, b) => a.fx - b.fx);

  const toSrc = proj4("WGS84", def).forward;
  const toWgs = proj4(def, "WGS84").forward;
  /* La extensión en grados: el borde de una imagen UTM no es recto en
     geográficas, así que se muestrean puntos a lo largo de él.      */
  let s = 90, w = 180, n = -90, e = -180;
  const STEPS = 8;
  for (let k = 0; k <= STEPS; k++) {
    for (const [px, py] of [[k / STEPS * W, 0], [k / STEPS * W, H], [0, k / STEPS * H], [W, k / STEPS * H]]) {
      const [lon, lat] = toWgs([ox + px * rx, oy + py * ry]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lon); e = Math.max(e, lon);
    }
  }
  const box = [s, w, n, e];
  if (!validCogRecord({ rasterId: "0".repeat(32), box })) {
    throw new Error("la extensión de la imagen no cae en coordenadas válidas");
  }
  const nodata = first.getGDALNoData();
  const noData = Number.isFinite(nodata) ? nodata : null;
  /* Modelo de elevación: el rango de la rampa sale de una muestra de la
     imagen (hasta 512 × 512 del nivel más basto, por vecino más próximo)
     y el tamaño de celda en metros, para el sombreado. En grados se pasa
     a metros con la latitud central.                                  */
  let dem = null, cellM = null;
  if (isDem) {
    const lv = levels[levels.length - 1];
    let sample;
    try {
      sample = await lv.image.readRasters({
        interleave: true, samples: [0], resampleMethod: "nearest",
        width: Math.min(lv.w, 512), height: Math.min(lv.h, 512)
      });
    } catch (err) {
      throw new Error(`no se pudo leer la banda de elevación (${err && err.message || err})`);
    }
    dem = demRange(sample, noData);
    if (!dem) throw new Error("el modelo de elevación no trae ninguna altitud válida (todo es «sin datos»)");
    if (dem.max === dem.min) dem.max = dem.min + 1;
    const geographic = /\+proj=longlat/.test(def);
    const cosLat = Math.cos((s + n) / 2 * Math.PI / 180);
    cellM = geographic ? [Math.abs(rx) * 111320 * cosLat, Math.abs(ry) * 110574]
      : epsg === 3857 ? [Math.abs(rx) * cosLat, Math.abs(ry) * cosLat]
      : [Math.abs(rx), Math.abs(ry)];
  }
  const notes = [];
  if (!fd.TileWidth) notes.push("no está en mosaico (no es un COG): cada tesela lee franjas enteras y puede ir lento");
  if (levels.length === 1 && Math.max(W, H) > 4096) {
    notes.push("no trae vistas generales: de lejos no se dibuja, hay que acercarse");
  }
  return {
    levels, ox, oy, rx, ry, W, H, epsg, toSrc, box, notes, nodata: noData,
    dem, cellM, blocks: new Map()
  };
}

/* Un COG abierto por id, una vez por sesión: lo comparten todas sus
   teselas y cualquier copia pegada del mismo nodo.                   */
const cogOpened = new Map();
function cogById(id) {
  if (!cogOpened.has(id)) {
    cogOpened.set(id, dbGetRaster(id).then(rec => {
      if (!rec || !rec.blob) throw new Error("ya no está en el almacenamiento del navegador");
      return openCog(rec.blob);
    }));
  }
  return cogOpened.get(id);
}

/* Cola de lecturas, COG_CONCURRENCY a la vez */
let cogActive = 0;
const cogQueue = [];
function cogSchedule(job) {
  return new Promise((resolve, reject) => {
    cogQueue.push({ job, resolve, reject });
    cogPump();
  });
}
function cogPump() {
  while (cogActive < COG_CONCURRENCY && cogQueue.length) {
    const { job, resolve, reject } = cogQueue.shift();
    cogActive++;
    Promise.resolve().then(job).then(resolve, reject).finally(() => { cogActive--; cogPump(); });
  }
}

/* La malla de una tesela: (G+1)² puntos, de su esquina noroeste a la
   sureste, en píxeles del ORIGINAL (nivel 0) del COG.               */
function tileSourceGrid(cog, coords) {
  const size = COG_TILE, G = COG_GRID;
  const nw = coords.scaleBy(L.point(size, size));
  const grid = new Float64Array((G + 1) * (G + 1) * 2);
  for (let j = 0, k = 0; j <= G; j++) {
    for (let i = 0; i <= G; i++, k += 2) {
      const ll = map.unproject(nw.add(L.point(i * size / G, j * size / G)), coords.z);
      const [X, Y] = cog.toSrc([ll.lng, ll.lat]);
      grid[k] = (X - cog.ox) / cog.rx;
      grid[k + 1] = (Y - cog.oy) / cog.ry;
    }
  }
  return grid;
}

/* Dónde cae el centro del píxel (u, v) de la tesela según la malla: la
   misma interpolación bilineal que warpTile hace en línea. PURA.   */
function cogGridPoint(grid, G, size, u, v) {
  const cell = size / G, row = (G + 1) * 2;
  const gx = (u + 0.5) / cell, gy = (v + 0.5) / cell;
  const i = Math.min(G - 1, Math.floor(gx)), j = Math.min(G - 1, Math.floor(gy));
  const tx = gx - i, ty = gy - j;
  const k00 = j * row + i * 2, k10 = k00 + 2, k01 = k00 + row, k11 = k01 + 2;
  return [(1 - ty) * ((1 - tx) * grid[k00] + tx * grid[k10]) + ty * ((1 - tx) * grid[k01] + tx * grid[k11]),
          (1 - ty) * ((1 - tx) * grid[k00 + 1] + tx * grid[k10 + 1]) + ty * ((1 - tx) * grid[k01 + 1] + tx * grid[k11 + 1])];
}

/* Altitud del píxel (ix, iy) del original de un modelo de elevación.
   Lee bloques alineados de DEM_BLOCK² y guarda los últimos: el cursor
   se mueve por decenas de píxeles de la misma zona, y cada lectura
   decodifica un bloque entero. Devuelve null si no hay dato.        */
async function demValueAtPixel(cog, ix, iy) {
  if (!(ix >= 0 && iy >= 0 && ix < cog.W && iy < cog.H)) return null;
  const bx = Math.floor(ix / DEM_BLOCK), by = Math.floor(iy / DEM_BLOCK);
  const key = bx + ":" + by;
  let blk = cog.blocks.get(key);
  if (!blk) {
    const x0 = bx * DEM_BLOCK, y0 = by * DEM_BLOCK;
    const x1 = Math.min(cog.W, x0 + DEM_BLOCK), y1 = Math.min(cog.H, y0 + DEM_BLOCK);
    blk = cog.levels[0].image.readRasters({ window: [x0, y0, x1, y1], interleave: true, samples: [0] })
      .then(data => ({ data, x0, y0, w: x1 - x0 }));
    cog.blocks.set(key, blk);
    if (cog.blocks.size > 16) cog.blocks.delete(cog.blocks.keys().next().value);
    blk.catch(() => cog.blocks.delete(key));
  }
  const b = await blk;
  return elevValue(Number(b.data[(iy - b.y0) * b.w + (ix - b.x0)]), cog.nodata);
}

/* La altitud bajo el cursor según el modelo de elevación visible más
   arriba que cubra el punto, o null. Sin red: lo lee del archivo
   guardado en el navegador.                                        */
async function demAltitudeAt(lat, lng) {
  for (const layer of [...cogLayersOnMap].reverse()) {
    const cog = layer._cog;
    if (!cog || !cog.dem || !layer.options.bounds.contains([lat, lng])) continue;
    const [X, Y] = cog.toSrc([lng, lat]);
    const value = await demValueAtPixel(cog, Math.floor((X - cog.ox) / cog.rx), Math.floor((Y - cog.oy) / cog.ry));
    if (value !== null) return { name: layer._li ? layer._li._name : "Modelo de elevación", value };
  }
  return null;
}

/* Pinta una tesela. Devuelve false si no hay nada que pintar (fuera de
   la imagen o, sin vista general, demasiado lejos).                 */
async function renderCogTile(cog, coords, canvas) {
  const size = COG_TILE, G = COG_GRID;
  const grid = tileSourceGrid(cog, coords);
  /* Píxeles del original por píxel de tesela, en el eje más fino */
  const k1 = G * 2, k2 = G * (G + 1) * 2;
  const across = Math.hypot(grid[k1] - grid[0], grid[k1 + 1] - grid[1]) / size;
  const down = Math.hypot(grid[k2] - grid[0], grid[k2 + 1] - grid[1]) / size;
  const lv = cog.levels[pickOverview(cog.levels.map(l => l.fx), Math.min(across, down))];
  for (let k = 0; k < grid.length; k += 2) { grid[k] /= lv.fx; grid[k + 1] /= lv.fy; }
  const win = tileWindow(grid, lv.w, lv.h);
  if (!win) return false;
  const ww = win[2] - win[0], wh = win[3] - win[1];
  if (ww * wh > COG_MAX_WINDOW) return false;
  for (let k = 0; k < grid.length; k += 2) { grid[k] -= win[0]; grid[k + 1] -= win[1]; }

  const mask = lv.mask ? await lv.mask.readRasters({ window: win, interleave: true }) : null;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  if (cog.dem) {
    const vals = await lv.image.readRasters({ window: win, interleave: true, samples: [0] });
    warpDemTile(vals, ww, wh, mask, cog.nodata, grid, G, size, img.data,
      { min: cog.dem.min, max: cog.dem.max, cx: cog.cellM[0] * lv.fx, cy: cog.cellM[1] * lv.fy });
  } else {
    const src = await lv.image.readRGB({ window: win, interleave: true, enableAlpha: true });
    const ch = Math.round(src.length / (ww * wh));
    warpTile(src, ww, wh, ch, mask, cog.nodata, grid, G, size, img.data);
  }
  ctx.putImageData(img, 0, 0);
  return true;
}

/* El pane, dentro de rotatePane: por encima de los mapas base
   (tilePane, 200) y por debajo de vectores y ortofotos de KMZ
   (overlayPane, 400).                                                */
map.createPane(COG_PANE, map.getPane("rotatePane")).style.zIndex = 300;

/* Las capas COG que están en el mapa (para la altitud bajo el cursor) */
const cogLayersOnMap = new Set();

const CogLayer = L.GridLayer.extend({
  options: { pane: COG_PANE, tileSize: COG_TILE, keepBuffer: 1 },
  onAdd(m) {
    L.GridLayer.prototype.onAdd.call(this, m);
    cogLayersOnMap.add(this);
    cogById(this._rasterId).then(cog => { this._cog = cog; }, () => {});
  },
  onRemove(m) {
    cogLayersOnMap.delete(this);
    L.GridLayer.prototype.onRemove.call(this, m);
  },
  initialize(rasterId, box, options) {
    L.GridLayer.prototype.initialize.call(this, options);
    this._rasterId = rasterId;
    this.options.bounds = L.latLngBounds([box[0], box[1]], [box[2], box[3]]);
  },
  /* Lo piden el encuadre de 🔍 y la caja de un rootGroup */
  getBounds() { return this.options.bounds; },
  createTile(coords, done) {
    const tile = document.createElement("canvas");
    tile.width = tile.height = COG_TILE;
    cogById(this._rasterId)
      .then(cog => cogSchedule(() => (tile.isConnected ? renderCogTile(cog, coords, tile) : false)))
      .then(() => done(null, tile), err => {
        if (!this._warned) {
          this._warned = true;
          const name = this._li ? this._li._name : "una ortofoto";
          navMessage(`No se puede dibujar «${name}»: ${err && err.message || err}.`);
        }
        done(null, tile);
      });
    return tile;
  }
});

/* Registro de un nodo "cog" desde lo guardado (o null si no es válido) */
function buildCogRecord(n) {
  if (!validCogRecord(n)) return null;
  const opacity = Number.isFinite(n.opacity) && n.opacity >= 0 && n.opacity <= 1 ? n.opacity : 1;
  const layer = new CogLayer(n.rasterId, n.box, { opacity });
  if (n.checked) layer.addTo(rootGroup);
  return { t: "cog", name: String(n.name || "Ortofoto"), checked: !!n.checked,
           rasterId: n.rasterId, box: n.box, opacity, _layer: layer };
}

/* Un .tif soltado en el panel: se valida ANTES de copiar nada (un
   archivo que no se puede dibujar no gasta cuota), se copia al almacén
   y entra como un nodo más, deshacible.                             */
async function addCogNode(file, insertBefore, dropTargetUl) {
  try {
    return await addCogNodeSteps(file, insertBefore, dropTargetUl);
  } finally {
    progress.hide(); /* se enseña siempre, no solo con archivos grandes */
  }
}
async function addCogNodeSteps(file, insertBefore, dropTargetUl) {
  progress.indet(`Comprobando ${file.name}…`);
  await yieldFrame();
  const cog = await openCog(file);
  if (navigator.storage && navigator.storage.estimate) {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    if (quota && usage + file.size > quota * COG_QUOTA_MARGIN) {
      throw new Error(`no cabe en el almacenamiento del navegador (ocupa ${fmtBytes(file.size)}; `
        + `quedan unos ${fmtBytes(Math.max(0, quota * COG_QUOTA_MARGIN - usage))})`);
    }
  }
  progress.indet(`Guardando ${file.name} en el navegador…`);
  await yieldFrame();
  const id = newRasterId();
  try {
    await dbPutRaster(id, { blob: file, name: file.name, size: file.size });
  } catch (err) {
    const full = err && err.name === "QuotaExceededError";
    throw new Error(full ? "no cabe en el almacenamiento del navegador"
      : `no se pudo guardar en el navegador (${err && err.message || err})`);
  }
  cogOpened.set(id, Promise.resolve(cog));

  pushUndo("añadir ortofoto");
  const ul = dropTargetUl || ensureRootUl();
  const before = new Set(ul.children);
  const rec = buildCogRecord({ name: file.name, checked: true, rasterId: id, box: cog.box, opacity: 1 });
  await materializeRecords([rec], ul);
  const li = rec._li;
  if (insertBefore && insertBefore.parentElement === ul && !before.has(li)) ul.insertBefore(li, insertBefore);
  refreshAncestorChecks(li);

  const levels = cog.levels.length - 1;
  const what = cog.dem
    ? `modelo de elevación de ${cog.W} × ${cog.H} px (EPSG:${cog.epsg}, de ${fmtHeight(cog.dem.min, "m")} `
      + `a ${fmtHeight(cog.dem.max, "m")}, ${levels} vista(s) general(es))`
    : `ortofoto de ${cog.W} × ${cog.H} px (EPSG:${cog.epsg}, ${levels} vista(s) general(es))`;
  const txt = `«${file.name}»: ${what}, guardada en el navegador (${fmtBytes(file.size)}).`;
  if (cog.notes.length) navMessage(`${txt} Atención: ${cog.notes.join("; ")}.`, { sticky: true });
  else navMessage(txt, { tone: "info" });
  return li;
}
