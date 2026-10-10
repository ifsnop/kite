/* ---------- Retícula fija de peticiones ----------
   Cada consulta pide la tesela de la retícula que contiene el punto
   pulsado, no una ventana centrada en él: así dos consultas sobre la
   misma zona piden exactamente lo mismo (y se reconocen como repetidas,
   ver elevQueryKey), y las de zonas vecinas encajan sin huecos ni
   solapes. Cada petición se ajusta (`snapTile`) al mosaico de teselas
   de 2×ELEV_WINDOW, con origen y tamaño fijos para toda la vida de la
   página.
   El tamaño real en metros de una tesela varía con la latitud (Web
   Mercator la estira, y en el sistema geográfico la longitud se
   estrecha), así que se fija una única latitud de referencia en vez de
   recalcular con la del punto: el error resultante ENSANCHA la ventana
   pedida fuera de esa latitud, nunca la estrecha, así que no deja
   huecos, solo pide un poco más de lo estrictamente necesario. 40°N cae
   cerca del centro de España (Tarifa ~36°N, cornisa cantábrica ~43,8°N):
   las Canarias (~28°N) quedan con una ventana algo más ancha de lo
   necesario, el lado inofensivo del error.                            */
const ELEV_LATTICE_REF_LAT = 40;
const ELEV_TILE_WEB = 2 * webMercatorHalf(ELEV_LATTICE_REF_LAT, ELEV_WINDOW);
const ELEV_TILE_GEO = (() => {
  const d = degHalf(ELEV_LATTICE_REF_LAT);
  return { lat: 2 * d.lat, lon: 2 * d.lon };
})();

/* Centro de la tesela de tamaño `size` (origen 0) que contiene `value`.
   Con origen y tamaño fijos, un mismo punto cae siempre en la misma
   tesela y las teselas vecinas nunca se solapan.                     */
const snapTile = (value, size) => Math.floor(value / size) * size + size / 2;

/* Clave de la tesela Web Mercator que contiene un punto: dos consultas
   con la misma clave piden exactamente la misma ventana. Pura, con las
   coordenadas ya proyectadas, para probarla sin mapa.                 */
const latticeKey = (x, y) =>
  `${snapTile(x, ELEV_TILE_WEB).toFixed(2)}:${snapTile(y, ELEV_TILE_WEB).toFixed(2)}`;

/* ---------- Formato de la respuesta ----------
   De todos los formatos que ofrezca el servicio se prefiere la rejilla
   ASCII: es texto plano, legible sin librerías y sin ambigüedad de tipo
   de dato. Solo si el servicio no la ofrece se pide GeoTIFF, que lee
   geotiff.js (Digital Earth Africa, por ejemplo, solo sirve GeoTIFF y
   NetCDF). Los nombres varían entre servidores (el IGN publica el ASCII
   como `ArcGrid` y `application/asc`), así que se busca por patrón, no
   por igualdad, y en orden de preferencia.                           */
const ELEV_FORMATS = [
  { kind: "ascii", re: /arcgrid/i }, { kind: "ascii", re: /(^|\/)asc$/i },
  { kind: "ascii", re: /aaigrid/i }, { kind: "ascii", re: /ascii/i },
  { kind: "ascii", re: /^text\/plain$/i }, { kind: "ascii", re: /^text\//i },
  { kind: "geotiff", re: /^image\/geotiff$/i }, { kind: "geotiff", re: /^image\/tiff$/i },
  { kind: "geotiff", re: /^geotiff$/i }
];
function pickElevFormat(formats) {
  for (const { kind, re } of ELEV_FORMATS) {
    const name = (formats || []).find(f => re.test(f));
    if (name) return { name, kind };
  }
  return null;
}

/* Del DescribeCoverage sale todo lo necesario para pedir bien: sistema
   de referencia, nombres de los ejes, extensión válida y tamaño de
   celda. El eje se identifica por su NOMBRE, nunca por su orden: hay
   servicios que los declaran `x y`, otros `N E` y otros `latitude
   longitude`, y suponerlo produce un ExtentError.                    */
function parseCoverageDescription(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (parserErrorText(doc)) return null;
  /* Digital Earth Africa declara la extensión con una dimensión de
     tiempo (`EnvelopeWithTimePeriod`): mismo contenido espacial.      */
  const env = firstByTag(doc, "Envelope") || firstByTag(doc, "EnvelopeWithTimePeriod");
  if (!env) return null;

  /* `axisLabels` es un ATRIBUTO del <Envelope>, no un elemento */
  const labels = (env.getAttribute("axisLabels") || text(doc, "axisLabels") || "")
    .trim().split(/\s+/).filter(Boolean);
  const lower = (text(env, "lowerCorner") || "").trim().split(/\s+/).map(Number);
  const upper = (text(env, "upperCorner") || "").trim().split(/\s+/).map(Number);
  if (labels.length < 2 || lower.length < 2 || upper.length < 2) return null;

  const isEast = l => /^(x|e|east|easting|lon|long)/i.test(l);
  let ix = labels.findIndex(isEast);
  let iy = labels.findIndex(l => !isEast(l));
  if (ix < 0 || iy < 0 || ix === iy) { ix = 0; iy = 1; }

  const srs = env.getAttribute("srsName") || "";
  const epsg = Number((srs.match(/(\d{4,5})(?:\D*)$/) || [])[1]);
  const geographic = epsg === 4326 || epsg === 4258;
  let zone = null;
  if (!geographic) {
    if (epsg >= 25828 && epsg <= 25838) zone = epsg - 25800;      /* ETRS89 / UTM */
    else if (epsg >= 32601 && epsg <= 32660) zone = epsg - 32600; /* WGS84 / UTM  */
    else zone = 30;
  }
  const box = {
    minX: Math.min(lower[ix], upper[ix]), maxX: Math.max(lower[ix], upper[ix]),
    minY: Math.min(lower[iy], upper[iy]), maxY: Math.max(lower[iy], upper[iy])
  };
  return {
    axisX: labels[ix], axisY: labels[iy], geographic, zone, ...box,
    cellMeters: coverageCellMeters(doc, labels, ix, iy, box, geographic)
  };
}

/* Tamaño de celda de una cobertura, en METROS, para poder comparar
   coberturas en sistemas distintos y quedarse con la más fina. Se lee
   de la malla, no del nombre: `offsetVector` de una RectifiedGrid (el
   paso de cada eje) o, si solo hay una Grid con sus límites, extensión
   entre número de celdas. En grados se pasa a metros en la latitud
   media de la extensión. De dos ejes distintos manda el más grueso: es
   el detalle que de verdad se puede distinguir. `null` si la
   descripción no dice nada de la malla.                              */
function coverageCellMeters(doc, labels, ix, iy, box, geographic) {
  let dx = NaN, dy = NaN;
  const vectors = elsByTag(doc, "offsetVector")
    .map(el => el.textContent.trim().split(/\s+/).map(Number));
  if (vectors.length >= 2) {
    dx = Math.max(...vectors.map(v => Math.abs(v[ix] || 0)));
    dy = Math.max(...vectors.map(v => Math.abs(v[iy] || 0)));
  } else {
    const low = (text(doc, "low") || "").trim().split(/\s+/).map(Number);
    const high = (text(doc, "high") || "").trim().split(/\s+/).map(Number);
    /* La malla puede nombrar sus ejes en otro orden que la extensión */
    const grid = firstByTag(doc, "Grid") || firstByTag(doc, "RectifiedGrid");
    const gridLabels = ((grid && text(grid, "axisLabels")) || "").trim().split(/\s+/).filter(Boolean);
    const at = name => { const i = gridLabels.indexOf(name); return i >= 0 ? i : labels.indexOf(name); };
    const gx = at(labels[ix]), gy = at(labels[iy]);
    const count = i => high[i] - low[i] + 1;
    if (gx >= 0 && gy >= 0 && count(gx) > 0 && count(gy) > 0) {
      dx = (box.maxX - box.minX) / count(gx);
      dy = (box.maxY - box.minY) / count(gy);
    }
  }
  if (!(dx > 0) || !(dy > 0)) return null;
  if (geographic) {
    const midLat = (box.minY + box.maxY) / 2;
    dx *= 111320 * Math.max(0.05, Math.cos(toRad(midLat)));
    dy *= 111320;
  }
  return Math.max(dx, dy);
}

/* Los servicios OGC devuelven los errores como XML y a veces con HTTP
   200: sin mirarlos, un ExtentError se leería como "sin datos".      */
function parseOwsException(txt) {
  if (!/ExceptionReport/.test(txt)) return null;
  const doc = new DOMParser().parseFromString(txt, "text/xml");
  if (parserErrorText(doc)) return null;
  const el = firstByTag(doc, "ExceptionText") || firstByTag(doc, "Exception");
  const code = firstByTag(doc, "Exception");
  return {
    code: (code && code.getAttribute("exceptionCode")) || "",
    msg: el ? el.textContent.trim() : "error del servicio"
  };
}

/* Pedir fuera del área cubierta no es un error del servicio sino una
   respuesta legítima: «ahí no hay dato». Cada servidor lo dice a su
   manera: el IGN con `ExtentError`, Digital Earth Africa con un HTTP
   404 y `InvalidSubsetting` («los recortes pedidos no devuelven
   datos»). Confundirlo con un rechazo haría abandonar para siempre una
   vía de petición que sí funciona.                                   */
const isOutOfCoverage = err =>
  /extent|InvalidSubsetting/i.test((err && err.owsCode) || "");

/* Rejilla ASCII de ESRI completa: cabecera de "clave valor" y luego la
   matriz de valores, por filas de norte a sur. Se devuelve entera —no
   solo un valor— porque además de leer la altitud hay que dibujar la
   cuadrícula sobre el mapa, y para colocarla hacen falta `xllcorner`,
   `yllcorner` y `cellsize`.                                          */
function parseAsciiGrid(txt) {
  const head = {};
  for (const m of String(txt).matchAll(/^\s*([A-Za-z_]+)\s+(-?[\d.eE+]+)\s*$/gm)) {
    head[m[1].toLowerCase()] = Number(m[2]);
  }
  const cols = head.ncols, rows = head.nrows;
  /* Celdas RECTANGULARES: la rejilla ASCII declara `cellsize` solo si
     son cuadradas; si no, `dx` y `dy` por separado. Exigir `cellsize`
     hacía descartar entera la respuesta del MDT, que al pedir una
     ventana cuadrada en metros devuelve celdas de distinta anchura y
     altura (5x4 celdas frente a las 4x4 del MDS).                   */
  const cellX = Number.isFinite(head.cellsize) ? head.cellsize : head.dx;
  const cellY = Number.isFinite(head.cellsize) ? head.cellsize : head.dy;
  if (!Number.isFinite(cols) || !Number.isFinite(rows)
      || !Number.isFinite(cellX) || !Number.isFinite(cellY)) return null;
  const nodata = Number.isFinite(head.nodata_value) ? head.nodata_value : -9999;

  /* Cuerpo: las líneas que no son cabecera. `xllcenter`/`yllcenter` son
     la variante centrada en la celda, no en su esquina.             */
  const body = String(txt).split(/\r?\n/)
    .filter(l => !/^\s*[A-Za-z_]+\s+-?[\d.eE+]/.test(l))
    .join(" ");
  const tokens = body.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) || [];
  if (tokens.length < cols * rows) return null;

  const values = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(elevValue(Number(tokens[r * cols + c]), nodata));
    values.push(row);
  }
  /* Sin esquina no se puede DIBUJAR, pero los valores siguen valiendo
     para la lectura: se devuelve la rejilla marcada como no ubicable
     en vez de descartarla entera.                                  */
  const xll = Number.isFinite(head.xllcorner) ? head.xllcorner
    : Number.isFinite(head.xllcenter) ? head.xllcenter - cellX / 2 : NaN;
  const yll = Number.isFinite(head.yllcorner) ? head.yllcorner
    : Number.isFinite(head.yllcenter) ? head.yllcenter - cellY / 2 : NaN;
  const located = Number.isFinite(xll) && Number.isFinite(yll);

  return { cols, rows, cellX, cellY, xll, yll, located, values };
}

/* Fuera de rango, NaN o NODATA son huecos, no altitudes: la fosa
   marina más honda y el Everest acotan lo que puede ser un dato real
   de tierra firme con margen de sobra.                               */
const elevValue = (v, nodata) =>
  !Number.isFinite(v) || v === nodata || v <= -500 || v >= 9000 ? null : v;

/* La misma rejilla que parseAsciiGrid, a partir de un ráster ya
   decodificado (GeoTIFF): origen = esquina SUPERIOR izquierda y
   resolución con la y negativa, como los da geotiff.js. Pura, para
   probarla en Node sin la librería.                                  */
function gridFromRaster({ width, height, origin, resolution, data, nodata }) {
  if (!(width > 0) || !(height > 0) || !data || data.length < width * height) return null;
  const cellX = Math.abs(resolution[0]), cellY = Math.abs(resolution[1]);
  if (!(cellX > 0) || !(cellY > 0)) return null;
  const values = [];
  for (let r = 0; r < height; r++) {
    const row = [];
    for (let c = 0; c < width; c++) row.push(elevValue(Number(data[r * width + c]), nodata));
    values.push(row);
  }
  const xll = origin[0], yll = origin[1] - height * cellY;
  return {
    cols: width, rows: height, cellX, cellY, xll, yll,
    located: Number.isFinite(xll) && Number.isFinite(yll), values
  };
}

/* GeoTIFF → rejilla, con geotiff.js (CDN, ver src/index.html). Sin
   Pool de workers: decodificar unas pocas celdas no lo justifica, y la
   CSP (default-src 'none') bloquearía sus workers de `blob:`.         */
async function readGeoTiffGrid(buf) {
  if (typeof GeoTIFF === "undefined") throw new Error("no se pudo cargar el lector GeoTIFF");
  const tiff = await GeoTIFF.fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const data = await image.readRasters({ interleave: true, samples: [0] });
  const nodata = image.getGDALNoData();
  return gridFromRaster({
    width: image.getWidth(), height: image.getHeight(),
    origin: image.getOrigin(), resolution: image.getResolution(),
    data, nodata: Number.isFinite(nodata) ? nodata : -9999
  });
}

/* Esquinas de una celda en coordenadas del sistema de la rejilla. Las
   filas van de norte a sur, así que la fila 0 es la de arriba.       */
function gridCellBounds(grid, r, c) {
  const x0 = grid.xll + c * grid.cellX;
  const y0 = grid.yll + (grid.rows - r - 1) * grid.cellY;
  return { x0, y0, x1: x0 + grid.cellX, y1: y0 + grid.cellY };
}

/* ---------- Cliente WCS de elevaciones ----------
   El mismo para todas las fuentes del catálogo: solo cambian la
   dirección y qué coberturas son candidatas. Nada del servicio se
   supone: cobertura, formato, sistema de referencia, ejes, extensión y
   tamaño de celda salen de su GetCapabilities y su DescribeCoverage.

   Ese descubrimiento se hace UNA vez por fuente y sesión (carga de
   página), en su primera consulta —nunca al arrancar—, y lo elegido se
   anota en el registro de avisos: con varias coberturas o formatos
   posibles, quien lee una altura tiene que poder saber de qué malla
   salió. Un fallo de red no cuenta: se reintenta en la siguiente
   consulta, porque no llegó a elegirse nada.                         */
const ELEV_MAX_CANDIDATES = 8; /* DescribeCoverage como mucho, por fuente */

function makeElevationSource(source) {
  const { base, label, pickCoverage } = source;
  let config = null, discovering = null;

  const url = (params, extra = []) => {
    const q = new URLSearchParams({ service: "WCS", version: "2.0.1", ...params });
    for (const [k, v] of extra) q.append(k, v);
    return `${base}?${q}`;
  };

  /* `binary`: se espera un GeoTIFF. Los servicios OGC explican el fallo
     en el CUERPO aunque devuelvan un 400 o un 404, y en XML: quedarse
     en el código HTTP, o leer ese XML como imagen, tira el dato que
     sirve.                                                            */
  async function request(params, signal, extra = [], binary = false) {
    const r = await fetch(url(params, extra), { signal });
    const xml = /xml|text\/plain/i.test(r.headers.get("content-type") || "");
    if (binary && r.ok && !xml) return r.arrayBuffer();
    const txt = await r.text();
    const ex = parseOwsException(txt);
    if (ex) throw Object.assign(new Error(ex.msg), { owsCode: ex.code });
    if (!r.ok) throw new Error(describeHttp(r.status));
    return txt;
  }

  async function fetchGrid(cfg, params, extra) {
    const geotiff = cfg.format.kind === "geotiff";
    const body = await request({
      request: "GetCoverage", coverageId: cfg.coverageId, format: cfg.format.name, ...params
    }, AbortSignal.timeout(ELEV_TIMEOUT), extra, geotiff);
    return geotiff ? readGeoTiffGrid(body) : parseAsciiGrid(body);
  }

  function discover() {
    if (config) return Promise.resolve(config);
    if (discovering) return discovering;
    discovering = (async () => {
      const signal = AbortSignal.timeout(ELEV_TIMEOUT);
      const caps = parseWcsCapabilities(await request({ request: "GetCapabilities" }, signal));
      if (!caps) throw new Error(`${label}: el servicio no declara coberturas`);
      const candidates = pickCoverage(caps.coverages).slice(0, ELEV_MAX_CANDIDATES);
      if (!candidates.length) throw new Error(`${label}: sin cobertura utilizable`);
      const format = pickElevFormat(caps.formats.length ? caps.formats
        : ["ArcGrid", "application/asc"]);
      if (!format) throw new Error(`${label}: no ofrece rejilla ASCII ni GeoTIFF`);
      /* Todas las candidatas a la vez: es una espera, no varias */
      const described = await Promise.all(candidates.map(id =>
        request({ request: "DescribeCoverage", coverageId: id }, signal)
          .then(parseCoverageDescription, () => null)));
      const best = pickFinestCoverage(candidates.map((id, i) => ({ id, desc: described[i] })));
      if (!best) throw new Error(`${label}: no se pudo leer la descripción`);
      config = {
        coverageId: best.id, format,
        webCrs: pickWebMercator(caps.crs),
        geoCrs: pickGeoCrs(caps.crs),
        wgs84: caps.bboxes[best.id] || null,
        ...best.desc
      };
      navMessage(describeElevChoice(source, config), { tone: "info" });
      return config;
    })().catch(err => { discovering = null; throw err; });
    return discovering;
  }

  /* La rejilla viaja con el sistema en que se pidió: sin saberlo no se
     pueden convertir sus esquinas a latitud y longitud para dibujarla */
  const tag = (grid, crs) => (grid ? { ...grid, crs } : null);

  async function fetchValue(lat, lon) {
    const cfg = await discover();
    /* La extensión se comprueba ANTES de pedir: una petición fuera de
       la cobertura está condenada a fallar.                          */
    const w = cfg.wgs84;
    if (w && (lat < w.south || lat > w.north || lon < w.west || lon > w.east)) return null;

    /* Vía preferida: Web Mercator, el sistema del visor. La ventana se
       ajusta a la retícula fija (ELEV_TILE_WEB), no al punto: así dos
       peticiones sobre la misma zona piden exactamente lo mismo.      */
    if (cfg.webCrs && cfg.useWeb !== false) {
      const p = toWebMercator(lat, lon);
      const cx = snapTile(p.x, ELEV_TILE_WEB), cy = snapTile(p.y, ELEV_TILE_WEB);
      const half = ELEV_TILE_WEB / 2;
      try {
        return tag(await fetchGrid(cfg, { subsettingCrs: cfg.webCrs }, [
          ["subset", `${cfg.axisX}(${(cx - half).toFixed(2)},${(cx + half).toFixed(2)})`],
          ["subset", `${cfg.axisY}(${(cy - half).toFixed(2)},${(cy + half).toFixed(2)})`]
        ]), "web");
      } catch (err) {
        /* Salir de la cobertura es respuesta legítima; solo se abandona
           esta vía si el servicio no entiende la petición            */
        if (isOutOfCoverage(err) || err.name === "TimeoutError") throw err;
        cfg.useWeb = false;
      }
    }

    /* Respaldo: latitud y longitud, también ajustado a la retícula fija
       (ELEV_TILE_GEO). Si la cobertura es geográfica sus ejes ya tienen
       nombre (`latitude`/`longitude` en Digital Earth Africa); si no,
       los del IGN para el subsettingCrs geográfico.                   */
    if (cfg.geoCrs && cfg.useGeo !== false) {
      const tlon = snapTile(lon, ELEV_TILE_GEO.lon), tlat = snapTile(lat, ELEV_TILE_GEO.lat);
      const halfLon = ELEV_TILE_GEO.lon / 2, halfLat = ELEV_TILE_GEO.lat / 2;
      const ax = cfg.geographic ? cfg.axisX : "Long", ay = cfg.geographic ? cfg.axisY : "Lat";
      try {
        return tag(await fetchGrid(cfg, { subsettingCrs: cfg.geoCrs }, [
          ["subset", `${ax}(${(tlon - halfLon).toFixed(7)},${(tlon + halfLon).toFixed(7)})`],
          ["subset", `${ay}(${(tlat - halfLat).toFixed(7)},${(tlat + halfLat).toFixed(7)})`]
        ]), "geo");
      } catch (err) {
        if (isOutOfCoverage(err) || err.name === "TimeoutError") throw err;
        cfg.useGeo = false;
      }
    }

    /* Respaldo: coordenadas nativas de la cobertura */
    const p = cfg.geographic
      ? { x: lon, y: lat, half: ELEV_WINDOW / 111320 }
      : (() => {
          const u = latLngToUtm(lat, lon, cfg.zone);
          return u ? { x: u.easting, y: u.northing, half: ELEV_WINDOW } : null;
        })();
    if (!p) return null;
    /* El rechazo por extensión mira el punto CRUDO: si se mirara el
       ajustado a tesela, un punto cerca del borde de cobertura podría
       rechazarse por error aunque el punto real sí esté dentro.       */
    if (p.x < cfg.minX || p.x > cfg.maxX || p.y < cfg.minY || p.y > cfg.maxY) return null;

    /* Esta rejilla no llega a dibujarse (gridToLatLng no sabe situar el
       CRS nativo), pero se ajusta a la misma retícula por consistencia
       con las otras dos vías y para no romper su caché por cobertura. */
    const tileSize = p.half * 2;
    const tx = snapTile(p.x, tileSize), ty = snapTile(p.y, tileSize);
    return tag(await fetchGrid(cfg, {}, [
      ["subset", `${cfg.axisX}(${(tx - p.half).toFixed(1)},${(tx + p.half).toFixed(1)})`],
      ["subset", `${cfg.axisY}(${(ty - p.half).toFixed(1)},${(ty + p.half).toFixed(1)})`]
    ]), cfg.geographic ? "geo" : "native");
  }

  /* El caché guarda REJILLAS y se busca en él por COBERTURA: una rejilla
     sirve si contiene el punto pedido (indexar por celdas dejaba huecos
     donde la celda ya estaba "resuelta" pero la rejilla no llegaba). */
  const grids = [];   /* rejillas recientes, la más nueva al final     */

  /* Las zonas SIN datos sí se indexan por celda: no hay rejilla que
     delimite su extensión, y así no se pregunta por ellas sin parar */
  const emptyAt = new Set();
  const emptyKey = (lat, lon) => {
    const u = latLngToUtm(lat, lon);
    return u ? `${u.zone}/${Math.round(u.easting / ELEV_CELL)}/${Math.round(u.northing / ELEV_CELL)}` : null;
  };

  return {
    source,
    /* `undefined` = no se pudo consultar; `null` = sin dato ahí */
    async value(lat, lon) {
      for (let i = grids.length - 1; i >= 0; i--) {
        if (gridCovers(grids[i], lat, lon)) return grids[i];
      }
      const ek = emptyKey(lat, lon);
      if (ek && emptyAt.has(ek)) return null;
      if (!demRateOk()) {
        demError("rate", "demasiadas consultas seguidas, espera un momento");
        return undefined;
      }
      try {
        const g = await fetchValue(lat, lon);
        if (g && g.located) {
          grids.push(g);
          while (grids.length > ELEV_CACHE_MAX) grids.shift();
        } else if (ek) {
          emptyAt.add(ek); /* sin rejilla utilizable en esta zona */
        }
        return g;
      } catch (err) {
        if (isOutOfCoverage(err)) {
          if (ek) emptyAt.add(ek);
          return null;
        }
        const why = err.name === "TimeoutError" ? "el servicio no responde"
          : err.message === "Failed to fetch"
            ? "el servicio no admite consultas desde el navegador (CORS)"
            : err.message;
        demError(source.id, `${label}: ${why}`);
        return undefined;
      }
    }
  };
}

/* Del GetCapabilities se sacan coberturas (con su caja WGS84, para no
   pedir fuera de ella), formatos y sistemas.                         */
function parseWcsCapabilities(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (parserErrorText(doc)) return null;
  const coverages = elsByTag(doc, "CoverageId").map(el => el.textContent.trim()).filter(Boolean);
  if (!coverages.length) return null;
  const bboxes = {};
  for (const sum of elsByTag(doc, "CoverageSummary")) {
    const id = (text(sum, "CoverageId") || "").trim();
    const bb = firstByTag(sum, "WGS84BoundingBox");
    if (!id || !bb) continue;
    /* WGS84BoundingBox va siempre en orden longitud latitud */
    const lo = (text(bb, "LowerCorner") || "").trim().split(/\s+/).map(Number);
    const hi = (text(bb, "UpperCorner") || "").trim().split(/\s+/).map(Number);
    if (lo.length < 2 || hi.length < 2 || ![...lo, ...hi].every(Number.isFinite)) continue;
    bboxes[id] = { west: lo[0], south: lo[1], east: hi[0], north: hi[1] };
  }
  return {
    coverages, bboxes,
    formats: elsByTag(doc, "formatSupported").map(el => el.textContent.trim()).filter(Boolean),
    crs: elsByTag(doc, "crsSupported").map(el => el.textContent.trim()).filter(Boolean)
  };
}

/* De las candidatas descritas, la de celda MÁS FINA; a igualdad, la de
   sistema geográfico (se puede preguntar en latitud/longitud sin
   convertir nada) y, después, el orden de la propia fuente. Sin tamaño
   de celda conocido cuenta como la peor. Las que no se pudieron
   describir se descartan.                                           */
function pickFinestCoverage(described) {
  const usable = described.filter(c => c.desc);
  if (!usable.length) return null;
  const size = c => (c.desc.cellMeters > 0 ? c.desc.cellMeters : Infinity);
  return usable.reduce((best, c) => {
    const d = size(c) - size(best);
    /* medio metro de tolerancia: 5 m en grados y en UTM no dan
       exactamente el mismo número al pasarlos a metros           */
    if (d < -0.5) return c;
    if (d > 0.5) return best;
    return (c.desc.geographic && !best.desc.geographic) ? c : best;
  });
}

/* Lo elegido en el descubrimiento, en una línea para el registro de
   avisos. Pura, para probar el texto sin servicio.                  */
const ELEV_KIND_LABEL = { mdt: "MDT (terreno)", mds: "MDS (superficie)" };
function describeElevChoice(source, cfg) {
  const fmt = cfg.format.kind === "ascii"
    ? `${cfg.format.name} (rejilla ASCII)`
    : `${cfg.format.name} (el servicio no ofrece rejilla ASCII)`;
  const cell = cfg.cellMeters > 0
    ? `celda ≈ ${cfg.cellMeters < 10 ? cfg.cellMeters.toFixed(1) : Math.round(cfg.cellMeters)} m`
    : "tamaño de celda no declarado";
  return `${ELEV_KIND_LABEL[source.kind]} · ${source.label}: cobertura ${cfg.coverageId}, `
    + `formato ${fmt}, ${cell}.`;
}

/* El MDT del IGN se publica en varias mallas y sistemas:
   `Elevacion<EPSG>_<paso>`. El paso del nombre basta para quedarse con
   las de malla más fina —todas las que lo empatan— y no pedir la
   descripción de las diecisiete; entre esas decide pickFinestCoverage
   con lo que digan sus descripciones. Lo que no siga el patrón se
   ofrece tal cual, en su orden.                                     */
function pickMdtCoverage(ids) {
  const parsed = ids
    .map(id => ({ id, m: /^Elevacion(\d+)_(\d+)$/i.exec(id) }))
    .filter(x => x.m)
    .map(x => ({ id: x.id, epsg: Number(x.m[1]), step: Number(x.m[2]) }));
  if (!parsed.length) return ids.slice();
  const finest = Math.min(...parsed.map(x => x.step));
  const geo = new Set([4326, 4258]);
  return parsed.filter(x => x.step === finest)
    .sort((a, b) => (geo.has(b.epsg) ? 1 : 0) - (geo.has(a.epsg) ? 1 : 0))
    .map(x => x.id);
}

/* El MDS del IGN publica además coberturas "normalizadas" (mdsn_*), que
   dan la altura sobre el suelo y no la altitud: no sirven para comparar. */
function pickMdsCoverage(ids) {
  const absolute = ids.filter(id => !/mdsn|norm/i.test(id));
  return absolute.length ? absolute : ids.slice();
}

/* Digital Earth Africa publica decenas de coberturas (cultivos, agua,
   reflectancia…); de elevación, tres. Copernicus DEM es un modelo de
   SUPERFICIE (radar: edificios y vegetación incluidos), el que toca
   comparar con un MDT; SRTM y NASADEM son más antiguos y no aportan
   resolución.                                                       */
const pickDeaDemCoverage = ids => ids.filter(id => id === "dem_cop_30");

/* ---------- Catálogo de fuentes ----------
   Cada fuente es un servicio WCS 2.0 que da un modelo (`kind`): MDT
   (terreno) o MDS (superficie). El usuario elige una de cada tipo, o
   ninguna (Propiedades → Fuentes de datos, que se rellena desde esta
   lista). Añadir una fuente es añadir una entrada: `pickCoverage`
   filtra qué coberturas del servicio son candidatas, y del resto
   —formato, sistema, ejes, celda— se encarga el descubrimiento.     */
const ELEV_SOURCES = [
  {
    id: "ign-mdt", kind: "mdt", label: "IGN — MDT05 (España)",
    base: "https://servicios.idee.es/wcs-inspire/mdt", pickCoverage: pickMdtCoverage,
    attrib: 'MDT05 PNOA © <a href="https://www.ign.es">IGN</a> (CC BY 4.0)'
  },
  {
    id: "ign-mds", kind: "mds", label: "IGN — MDS05 (España)",
    base: "https://wcs-mds.idee.es/mds", pickCoverage: pickMdsCoverage,
    attrib: 'MDS PNOA © <a href="https://www.ign.es">IGN</a> (CC BY 4.0)'
  },
  {
    id: "dea-cop30", kind: "mds",
    label: "Digital Earth Africa — Copernicus DEM 30 m (África y Canarias)",
    base: "https://ows.digitalearth.africa/wcs", pickCoverage: pickDeaDemCoverage,
    attrib: 'Copernicus DEM © DLR e.V. 2010-2014 y © Airbus Defence and Space GmbH 2014-2018 '
      + '(Copernicus, UE/ESA), vía <a href="https://www.digitalearthafrica.org">Digital Earth Africa</a>'
  }
];
const ELEV_SOURCE_DEFAULT = { mdt: "ign-mdt", mds: "ign-mds" };
/* Lo elegido ahora: id del catálogo, o null = «Ninguna» (no se pide) */
let elevSources = { ...ELEV_SOURCE_DEFAULT };

const elevSourceById = id => ELEV_SOURCES.find(s => s.id === id) || null;

/* Valida lo leído de IndexedDB contra el catálogo ACTUAL: un id que ya
   no existe (fuente retirada del código) o de otro tipo vuelve a la de
   por defecto; `null` es una elección legítima («Ninguna»). Devuelve
   null si el registro no tiene forma de elección.                    */
function validElevSources(r) {
  if (!r || typeof r !== "object") return null;
  const out = {};
  for (const kind of ["mdt", "mds"]) {
    const v = r[kind];
    const s = v === null ? null : elevSourceById(v);
    out[kind] = v === null ? null : (s && s.kind === kind ? s.id : ELEV_SOURCE_DEFAULT[kind]);
  }
  return out;
}

/* Un cliente por fuente, construido en su primera consulta y vivo toda
   la sesión: con él vive su descubrimiento (una sola vez) y su caché. */
const elevClients = new Map();
function sourceClient(id) {
  if (!elevClients.has(id)) elevClients.set(id, makeElevationSource(elevSourceById(id)));
  return elevClients.get(id);
}

/* ---------- Cuadrícula de elevaciones ----------
   Se dibuja lo que ha devuelto el servicio, celda por celda y en su
   sitio: la cabecera de la rejilla trae esquina y tamaño de celda. Cada
   celda muestra el terreno (MDT), la superficie (MDS) y su diferencia,
   o solo lo que se consultó si una de las dos fuentes está en
   «Ninguna». Cada consulta es una capa del árbol («Elevación N»).    */
const GRID_FILL_OPACITY = 0.4;   /* se ve la cartografía por debajo   */
/* A partir del zoom 21 las celdas ya son grandes en pantalla y el texto
   de 10 px se queda pequeño: crece un punto por nivel. Es un tamaño
   PROPORCIONAL A LA CELDA, no absoluto, así que la etiqueta debe
   recalcularse al cambiar el zoom, no solo al llegar datos.         */
const GRID_FONT_BASE = 10;   /* px, hasta el zoom umbral            */
const GRID_FONT_FROM = 21;   /* zoom a partir del cual crece        */
const GRID_FONT_MAX = 22;    /* tope, para que quepa en la celda    */

/* Por debajo del zoom 19 la celda es demasiado pequeña para tres líneas
   de texto legibles: se deja de escribir número y la propia celda se
   colorea como aviso. En el 19 cabe justo una línea, así que se muestra
   solo la diferencia (lo que de verdad importa: MDS por encima del MDT
   sugiere algo construido o vegetación). A partir del 20 caben las tres
   líneas de siempre.                                                 */
const ELEV_ZOOM_MINI = 18;      /* <=: sin texto, solo aviso de relleno */
const ELEV_ZOOM_DIFF_ONLY = 19; /* ==: una sola línea (la diferencia)  */
                                 /* >=20: las tres líneas, como siempre */
const ELEV_ALERT_DIFF = 1;      /* m: umbral de "MDS por encima del MDT" */
const GRID_ALERT_FILL = "#ff8a80"; /* rojo pastel, relleno de aviso a zoom bajo */

const gridFontSize = zoom =>
  Math.min(GRID_FONT_MAX, GRID_FONT_BASE + Math.max(0, Math.round(zoom) - GRID_FONT_FROM + 1));

/* Banda de contenido según el zoom, ver comentario arriba. Pura: se
   prueba en Node sin necesitar un mapa real.                        */
function elevZoomBand(zoom) {
  const z = Math.round(zoom);
  if (z <= ELEV_ZOOM_MINI) return "mini";
  if (z === ELEV_ZOOM_DIFF_ONLY) return "diff";
  return "full";
}

/* El aviso se decide siempre en METROS, con independencia de la unidad
   de visualización: es un umbral físico fijo, no una comodidad de
   pantalla.                                                          */
const isElevAlert = cell => typeof cell.diff === "number" && cell.diff > ELEV_ALERT_DIFF;

/* La caja de la etiqueta acompaña al texto: tres líneas más margen */
const gridIconSize = font => [Math.round(font * 5.4), Math.round(font * 3.6)];
/* Una capa por consulta guardada en el árbol: refreshElevCells debe
   recalcular relleno y texto de todas ellas, y el cuadro de
   coordenadas busca en ellas la celda bajo el cursor.                */
const elevGridGroups = [];

/* Esquinas de la rejilla a latitud/longitud según el sistema en que se
   pidió. Web Mercator lo deshace Leaflet con su propia proyección; el
   geográfico ya son grados. El sistema nativo (UTM) no se dibuja: no
   tenemos la conversión inversa y preferimos no colocar mal la malla. */
function gridToLatLng(grid, x, y) {
  if (grid.crs === "web") {
    const p = map.options.crs.unproject(L.point(x, y));
    return [p.lat, p.lng];
  }
  if (grid.crs === "geo") return [y, x];
  return null;
}

/* Una celda lleva la clave `mdt`/`mds` solo si ESE modelo se consultó;
   `null` dentro de la clave es «se consultó y no hay dato». Lo guardado
   antes de poder elegir fuentes trae siempre las dos claves.          */
const hasMdt = cell => "mdt" in cell;
const hasMds = cell => "mds" in cell;

/* En la unidad global de Propiedades (measureUnit), como las distancias */
const fmtCell = v => v === null || v === undefined ? "—" : fmtHeightValue(v, measureUnit);
const fmtDiff = d => d === null || d === undefined ? "—"
  : (d >= 0 ? "+" : "") + fmtHeightValue(d, measureUnit);

/* Contenido de una celda según la banda de zoom (ver elevZoomBand):
   sin texto por debajo del 19, una sola línea en el 19, todas a partir
   del 20. Con un solo modelo consultado no hay diferencia que dar: la
   línea única es su valor. El aviso (`.alert`) va SIEMPRE en la
   diferencia cuando supera ELEV_ALERT_DIFF, sea cual sea la banda.  */
function elevCellHtml(cell, band) {
  if (band === "mini") return "";
  const t = hasMdt(cell), s = hasMds(cell);
  const tSpan = `<span class="ec-t">${fmtCell(cell.mdt)}</span>`;
  const sSpan = `<span class="ec-s">${fmtCell(cell.mds)}</span>`;
  if (!(t && s)) return t ? tSpan : s ? sSpan : "";
  const diffSpan = `<span class="ec-d${isElevAlert(cell) ? " alert" : ""}">${fmtDiff(cell.diff)}</span>`;
  if (band === "diff") return diffSpan;
  return tSpan + sSpan + diffSpan;
}

/* El relleno del rectángulo solo avisa en la banda "mini": ahí es la
   ÚNICA señal visible (no hay texto), así que si MDS supera al MDT en
   más de ELEV_ALERT_DIFF se colorea en rojo pastel; el resto de bandas
   siempre llevan el blanco translúcido de siempre.                   */
function renderElevRect(rect, cell, zoom) {
  const mini = elevZoomBand(zoom) === "mini";
  rect.setStyle({ fillColor: (mini && isElevAlert(cell)) ? GRID_ALERT_FILL : "#ffffff" });
}

function cellIcon(html, font) {
  const [w, h] = gridIconSize(font);
  return L.divIcon({
    className: "elev-cell",
    html: `<span style="font-size:${font}px">${html}</span>`,
    iconSize: [w, h], iconAnchor: [w / 2, h / 2]
  });
}

/* Recalcula el aspecto de todas las celdas (relleno + texto): al cambiar
   el zoom (banda de contenido, tamaño de letra) y la unidad de medida
   (setMeasureUnit, Propiedades). La geometría de la cuadrícula no
   depende de ninguno de los dos, y volver a pedir datos sería absurdo:
   todo se recalcula a partir de `l._cell`, los valores crudos que ya
   guarda cada capa.                                                  */
function refreshElevCells() {
  const zoom = map.getZoom();
  const band = elevZoomBand(zoom);
  const font = gridFontSize(zoom);
  for (const g of elevGridGroups) {
    g.eachLayer(l => {
      if (!l._cell) return;
      if (l instanceof L.Rectangle) { renderElevRect(l, l._cell, zoom); return; }
      l.setOpacity(band === "mini" ? 0 : 1);
      if (band !== "mini") l.setIcon(cellIcon(elevCellHtml(l._cell, band), font));
    });
  }
}
map.on("zoomend", refreshElevCells);

/* Cálculo puro: convierte un par de rejillas (MDT/MDS) en registros de
   celda autocontenidos (esquinas en lat/lng + valores), sin construir
   nada de Leaflet. `terrain` manda en la geometría; de `surface` se toma
   el valor de la celda que coincide, que puede no existir si las mallas
   difieren (5x4 frente a 4x4, o 5 m frente a 30 m; donde el MDS no
   llega NO se inventa ni se interpola). `kinds` dice qué modelos se
   consultaron: el que no, no aporta clave a la celda (ver hasMdt).   */
function buildElevCells(terrain, surface, kinds = { mdt: true, mds: true }) {
  const grid = terrain || surface;
  if (!grid || !grid.located || !gridToLatLng(grid, grid.xll, grid.yll)) return null;

  /* Las dos mallas pueden no empezar en el mismo punto, así que el valor
     de la otra se busca por POSICIÓN, no por índice de celda.        */
  const sampleAt = (g, x, y) => {
    if (!g || !g.located || g.crs !== grid.crs) return null;
    const c = Math.floor((x - g.xll) / g.cellX);
    const r = g.rows - 1 - Math.floor((y - g.yll) / g.cellY);
    return (r >= 0 && r < g.rows && c >= 0 && c < g.cols) ? g.values[r][c] : null;
  };

  const cells = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const b = gridCellBounds(grid, r, c);
      const sw = gridToLatLng(grid, b.x0, b.y0);
      const ne = gridToLatLng(grid, b.x1, b.y1);
      if (!sw || !ne) continue;

      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const mdt = terrain === grid ? grid.values[r][c] : sampleAt(terrain, cx, cy);
      const mds = surface === grid ? grid.values[r][c] : sampleAt(surface, cx, cy);
      const cell = { sw, ne, center: [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2] };
      if (kinds.mdt) cell.mdt = mdt;
      if (kinds.mds) cell.mds = mds;
      cell.diff = (kinds.mdt && kinds.mds && typeof mdt === "number" && typeof mds === "number")
        ? mds - mdt : null;
      cells.push(cell);
    }
  }
  return { grid, role: terrain === grid ? "terrain" : "surface", cells };
}

/* Construye las capas Leaflet (rectángulo + etiqueta) de UNA celda.
   Compartido entre una consulta nueva y la reconstrucción de una capa
   guardada (buildElevGridGroup), para que ambas se vean idénticas.   */
function makeElevCellLayers(cell, zoom) {
  const band = elevZoomBand(zoom);
  const font = gridFontSize(zoom);

  const rect = L.rectangle([cell.sw, cell.ne], {
    color: "#1b5e97", weight: 1, opacity: 0.8,
    fillColor: "#ffffff", fillOpacity: GRID_FILL_OPACITY,
    interactive: false
  });
  rect._cell = cell;
  renderElevRect(rect, cell, zoom);

  /* La etiqueta va como marcador sin icono, anclado al centro de la
     celda: así la escribe el navegador y no hay que escalar texto */
  const label = L.marker(cell.center, { interactive: false });
  label._cell = cell;
  label.setIcon(cellIcon(elevCellHtml(cell, band), font));
  label.setOpacity(band === "mini" ? 0 : 1); /* sin texto por debajo del zoom 19 */
  return [rect, label];
}

/* Construye una capa completa (rectángulos + etiquetas) a partir de
   registros de celda ya calculados: se usa tanto al terminar una
   consulta como al restaurar una capa guardada desde IndexedDB.
   Debe ser un L.featureGroup, no un L.layerGroup: subtreeBounds (usado
   por "Autoescalar" y el doble click) necesita getBounds(), que
   L.LayerGroup no tiene en Leaflet 1.9.4.                             */
function buildElevGridGroup(cells) {
  const group = L.featureGroup();
  const zoom = map.getZoom();
  for (const cell of cells) {
    for (const layer of makeElevCellLayers(cell, zoom)) group.addLayer(layer);
  }
  return group;
}

/* ---------- Lectura de una rejilla en un punto ---------- */

/* Posición de un punto en las coordenadas de una rejilla concreta */
function gridPoint(grid, lat, lon) {
  if (!grid || !grid.located) return null;
  if (grid.crs === "web") {
    const p = map.options.crs.project(L.latLng(lat, lon));
    return { x: p.x, y: p.y };
  }
  if (grid.crs === "geo") return { x: lon, y: lat };
  return null; /* nativo: sin conversión inversa, no se puede situar */
}

/* Valor de la rejilla bajo un punto.
   `undefined` = el punto queda FUERA (o no se puede situar);
   `null`      = dentro, pero sin dato en esa celda.                  */
function gridSample(grid, lat, lon) {
  const p = gridPoint(grid, lat, lon);
  if (!p) return undefined;
  const c = Math.floor((p.x - grid.xll) / grid.cellX);
  const r = grid.rows - 1 - Math.floor((p.y - grid.yll) / grid.cellY);
  if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) return undefined;
  return grid.values[r][c];
}

const gridCovers = (grid, lat, lon) => gridSample(grid, lat, lon) !== undefined;

/* Punto-en-rectángulo sobre un registro de celda ya guardado (sw/ne en
   lat/lng): la lectura del cuadro de coordenadas no tiene la rejilla
   WCS original, solo las celdas de cada capa.                        */
function pointInCell(cell, lat, lng) {
  const loLat = Math.min(cell.sw[0], cell.ne[0]), hiLat = Math.max(cell.sw[0], cell.ne[0]);
  const loLng = Math.min(cell.sw[1], cell.ne[1]), hiLng = Math.max(cell.sw[1], cell.ne[1]);
  return lat >= loLat && lat <= hiLat && lng >= loLng && lng <= hiLng;
}

/* Celda descargada bajo el cursor, en las capas de elevaciones VISIBLES
   (las que están en rootGroup: casilla marcada), o null. Es lo que
   enseña el cuadro de coordenadas, sin red. Barrido lineal de los
   rectángulos: una consulta trae del orden de cien celdas y se lanza
   a mano, así que aun con decenas de consultas son pocos miles de
   comparaciones por fotograma; las capas ocultas ni se recorren.    */
function elevCellAt(lat, lng) {
  for (let i = elevGridGroups.length - 1; i >= 0; i--) {
    const g = elevGridGroups[i];
    if (!rootGroup.hasLayer(g)) continue;
    let found = null;
    g.eachLayer(l => {
      if (!found && l instanceof L.Rectangle && l._cell && pointInCell(l._cell, lat, lng)) found = l._cell;
    });
    if (found) return found;
  }
  return null;
}

/* ---------- Consulta puntual (menú contextual del visor) ----------
   «Consultar elevación aquí» pide a las fuentes elegidas la tesela de
   la retícula que contiene el punto pulsado y la convierte en una capa
   del árbol. Todo lo descargado en una carga de página cuelga de UNA
   carpeta «Sesión AAAA-MM-DD HH:MM» dentro de la sección «Elevaciones»,
   una capa por consulta, para poder ocultar o borrar cada una aparte.
   La carpeta se recuerda por REFERENCIA, no por nombre: dos sesiones
   pueden llamarse igual (mismo minuto) y una sesión anterior restaurada
   de IndexedDB no es esta. Si se borra (o un deshacer reconstruye el
   árbol), la siguiente consulta crea otra.                          */
let elevSessionLi = null;
/* Tesela ya consultada en esta sesión CON LAS MISMAS FUENTES → su capa:
   repetirla no pide nada, señala la que ya hay. Las fuentes van en la
   clave: tras cambiar el MDS en Propiedades, la misma tesela es otra
   consulta (otro modelo, otra malla).                                */
const elevSessionKeys = new Map();
const elevInFlight = new Set();
const elevAttribDone = new Set();

const ALT_ROTATED_WHY = "La consulta de elevación no está disponible con el mapa rotado: "
  + "pulsa R o la brújula para poner el norte arriba.";
const ELEV_NO_SOURCES_WHY = "Sin fuentes de elevación: elígelas en Propiedades → Fuentes de datos.";

/* Motivo por el que la entrada del menú está deshabilitada, o false */
function elevQueryDisabled() {
  if (isMapRotated()) return ALT_ROTATED_WHY;
  if (!elevSources.mdt && !elevSources.mds) return ELEV_NO_SOURCES_WHY;
  return false;
}

/* «AAAA-MM-DD HH:MM» en hora local: nombre de la carpeta de sesión */
function sessionStamp(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const elevQueryKey = (latlng, ids) => {
  const p = toWebMercator(latlng.lat, latlng.lng);
  return `${ids.mdt || "-"}|${ids.mds || "-"}|${latticeKey(p.x, p.y)}`;
};

async function ensureElevSessionFolder() {
  if (elevSessionLi && elevSessionLi.isConnected) return elevSessionLi;
  const section = ensureNamedSection("Elevaciones").parentElement;
  elevSessionLi = await createFolderNode(section, `Sesión ${sessionStamp(new Date())}`);
  return elevSessionLi;
}

/* Una capa normal del árbol: persistente, con casilla, borrable */
function makeElevGridNode(name, cells) {
  const group = buildElevGridGroup(cells).addTo(rootGroup);
  elevGridGroups.push(group);
  const li = makeNode({
    name, layer: group, styleable: false,
    onDelete: () => {
      const i = elevGridGroups.indexOf(group);
      if (i >= 0) elevGridGroups.splice(i, 1);
    }
  });
  li._elevGrid = { cells };
  return li;
}

async function queryElevationAt(latlng) {
  const why = elevQueryDisabled();
  if (why) { navMessage(why); return; }
  const ids = { mdt: elevSources.mdt, mds: elevSources.mds };
  const key = elevQueryKey(latlng, ids);
  const prev = elevSessionKeys.get(key);
  if (prev && prev.isConnected) {
    highlightNode(prev);
    blinkLayer(prev);
    navMessage(`Esa celda ya está descargada en esta sesión: «${prev._name}».`, { tone: "info" });
    return;
  }
  if (elevInFlight.has(key)) return;
  elevInFlight.add(key);
  try {
    navMessage("Consultando elevación…", { tone: "info" });
    const ask = id => (id ? sourceClient(id).value(latlng.lat, latlng.lng) : Promise.resolve(null));
    const [terrain, surface] = await Promise.all([ask(ids.mdt), ask(ids.mds)]);

    /* La atribución de cada fuente que ha respondido, una vez por sesión
       (CC BY 4.0 y la licencia de Copernicus lo exigen)               */
    for (const [id, got] of [[ids.mdt, terrain], [ids.mds, surface]]) {
      if (!id || got === undefined || elevAttribDone.has(id)) continue;
      elevAttribDone.add(id);
      map.attributionControl.addAttribution(elevSourceById(id).attrib);
    }

    const built = buildElevCells(terrain || null, surface || null, { mdt: !!ids.mdt, mds: !!ids.mds });
    if (!built || !built.cells.length) {
      /* Una fuente que falló (`undefined`) ya avisó por su cuenta
         (demError); «sin datos» solo si alguna de las ELEGIDAS respondió
         de verdad —la que está en «Ninguna» no cuenta como respuesta. */
      const answered = (ids.mdt && terrain !== undefined) || (ids.mds && surface !== undefined);
      if (answered) {
        navMessage("Elevación: sin datos en ese punto (fuera de la cobertura de las fuentes elegidas).",
          { tone: "info" });
      }
      return;
    }

    pushUndo("consultar elevación");
    const folder = await ensureElevSessionFolder();
    const li = makeElevGridNode(nextNumberedName("Elevación"), built.cells);
    nodeUl(folder).appendChild(li);
    refreshAncestorChecks(li);
    scheduleSave();
    elevSessionKeys.set(key, li);
    navMessage(`Elevación: «${li._name}» añadida a «${folder._name}».`, { tone: "info" });
  } finally {
    elevInFlight.delete(key);
  }
}

/* Reconstruye una capa de elevaciones guardada (usado al restaurar el
   árbol), como registro pendiente. Sigue el patrón de las capas
   normales (t === "layer"): se construye desconectada y solo se añade a
   rootGroup si está marcada; el DOM lo pone materializeRecords después. */
function buildElevGridRecord(n) {
  const group = buildElevGridGroup(n.cells);
  elevGridGroups.push(group);
  if (n.checked) group.addTo(rootGroup);
  return { t: "elevGrid", name: n.name, checked: !!n.checked, cells: n.cells, _layer: group };
}

/* Reconstruye una ortofoto guardada (usado al restaurar el árbol), como
   registro pendiente. Sigue el patrón de las capas normales
   (t === "layer"): se construye desconectada y solo se añade a
   rootGroup si está marcada; el DOM lo pone materializeRecords después. */
function buildImageOverlayRecord(n) {
  const bounds = L.latLngBounds([n.box.south, n.box.west], [n.box.north, n.box.east]);
  const layer = L.imageOverlay(n.dataUrl, bounds, { opacity: n.opacity });
  if (n.checked) layer.addTo(rootGroup);
  return { t: "imageOverlay", name: n.name, checked: !!n.checked, box: n.box, dataUrl: n.dataUrl, opacity: n.opacity, _layer: layer };
}
