/* ---------- Retícula fija de peticiones ----------
   Para que la cuadrícula se pueda ACUMULAR sin huecos ni solapes, dos
   peticiones sobre la misma zona deben producir la MISMA ventana. Antes
   cada petición se centraba en el cursor, así que dos pasadas por el
   mismo sitio en momentos distintos pedían ventanas ligeramente
   distintas. Ahora cada petición se ajusta (`snapTile`) al mosaico de
   teselas de 2×ELEV_WINDOW más cercano, con origen y tamaño fijos para
   toda la vida de la página: la misma zona cae siempre en la misma
   tesela y teselas vecinas nunca se solapan por construcción.
   El tamaño real en metros de una tesela varía con la latitud (Web
   Mercator la estira, y en el sistema geográfico la longitud se
   estrecha), así que se fija una única latitud de referencia en vez de
   recalcular con la del cursor: el error resultante ENSANCHA la ventana
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

/* De todos los formatos que ofrezca el servicio hay que quedarse con uno
   legible sin librerías: la rejilla ASCII es texto plano. Los nombres
   varían entre servidores (el IGN la publica como `ArcGrid` y
   `application/asc`), así que se busca por patrón, no por igualdad.  */
const ELEV_TEXT_FORMATS = [
  /arcgrid/i, /(^|\/)asc$/i, /aaigrid/i, /ascii/i, /^text\/plain$/i, /^text\//i
];
function pickMdsFormat(formats) {
  for (const pattern of ELEV_TEXT_FORMATS) {
    const found = (formats || []).find(f => pattern.test(f));
    if (found) return found;
  }
  return null;
}

/* Del DescribeCoverage sale todo lo necesario para pedir bien: sistema
   de referencia, nombres de los ejes y extensión válida. El eje se
   identifica por su NOMBRE, nunca por su orden: hay servicios que los
   declaran `x y` y otros `N E`, y suponerlo produce un ExtentError. */
function parseMdsCoverage(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (parserErrorText(doc)) return null;
  const env = firstByTag(doc, "Envelope");
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
  return {
    axisX: labels[ix], axisY: labels[iy], geographic, zone,
    minX: Math.min(lower[ix], upper[ix]), maxX: Math.max(lower[ix], upper[ix]),
    minY: Math.min(lower[iy], upper[iy]), maxY: Math.max(lower[iy], upper[iy])
  };
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

/* Rejilla ASCII de ESRI: cabecera de "clave valor" y luego los números.
   Se devuelve el primer valor que no sea el NODATA declarado.        */
/* Rejilla ASCII de ESRI completa: cabecera de "clave valor" y luego la
   matriz de valores, por filas de norte a sur. Se devuelve entera —no
   solo un valor— porque además de leer la altitud bajo el cursor hay que
   dibujar la cuadrícula sobre el mapa, y para colocarla hacen falta
   `xllcorner`, `yllcorner` y `cellsize`.                              */
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
    for (let c = 0; c < cols; c++) {
      const v = Number(tokens[r * cols + c]);
      /* Fuera de rango o NODATA se marcan como hueco, no como altitud */
      row.push(!isFinite(v) || v === nodata || v <= -500 || v >= 9000 ? null : v);
    }
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

/* Esquinas de una celda en coordenadas del sistema de la rejilla. Las
   filas van de norte a sur, así que la fila 0 es la de arriba.       */
function gridCellBounds(grid, r, c) {
  const x0 = grid.xll + c * grid.cellX;
  const y0 = grid.yll + (grid.rows - r - 1) * grid.cellY;
  return { x0, y0, x1: x0 + grid.cellX, y1: y0 + grid.cellY };
}

/* ---------- Cliente WCS de elevaciones ----------
   Sirve para los dos servicios porque solo cambian la dirección y qué
   cobertura elegir. Nada del servicio se supone: identificador de
   cobertura, formato, sistema de referencia, ejes y extensión salen de
   su GetCapabilities y su DescribeCoverage.                          */
function makeElevationSource({ base, label, pickCoverage }) {
  let config = null, discovering = null;

  const url = (params, extra = []) => {
    const q = new URLSearchParams({ service: "WCS", version: "2.0.1", ...params });
    for (const [k, v] of extra) q.append(k, v);
    return `${base}?${q}`;
  };

  async function request(params, signal, extra = []) {
    const r = await fetch(url(params, extra), { signal });
    const txt = await r.text();
    /* Los servicios OGC explican el fallo en el CUERPO aunque devuelvan
       un 400: quedarse en el código HTTP tira el dato que sirve      */
    const ex = parseOwsException(txt);
    if (ex) throw Object.assign(new Error(ex.msg), { owsCode: ex.code });
    if (!r.ok) throw new Error(describeHttp(r.status));
    return txt;
  }

  function discover() {
    if (config) return Promise.resolve(config);
    if (discovering) return discovering;
    discovering = (async () => {
      const signal = AbortSignal.timeout(ELEV_TIMEOUT);
      const caps = parseWcsCapabilities(await request({ request: "GetCapabilities" }, signal));
      if (!caps) throw new Error(`${label}: el servicio no declara coberturas`);
      const coverageId = pickCoverage(caps.coverages);
      if (!coverageId) throw new Error(`${label}: sin cobertura utilizable`);
      const format = pickMdsFormat(caps.formats.length ? caps.formats
        : ["ArcGrid", "application/asc"]);
      if (!format) throw new Error(`${label}: solo ofrece formatos binarios`);
      const desc = parseMdsCoverage(
        await request({ request: "DescribeCoverage", coverageId }, signal));
      if (!desc) throw new Error(`${label}: no se pudo leer la descripci\u00F3n`);
      config = {
        coverageId, format,
        webCrs: pickWebMercator(caps.crs),
        geoCrs: pickGeoCrs(caps.crs),
        ...desc
      };
      return config;
    })().catch(err => { discovering = null; throw err; });
    return discovering;
  }

  /* La rejilla viaja con el sistema en que se pidió: sin saberlo no se
     pueden convertir sus esquinas a latitud y longitud para dibujarla */
  const tag = (grid, crs) => (grid ? { ...grid, crs } : null);

  async function fetchValue(lat, lon) {
    const cfg = await discover();

    /* Vía preferida: Web Mercator, el sistema del visor. La ventana se
       ajusta a la retícula fija (ELEV_TILE_WEB), no al cursor: así dos
       peticiones sobre la misma zona piden exactamente lo mismo.      */
    if (cfg.webCrs && cfg.useWeb !== false) {
      const p = toWebMercator(lat, lon);
      const cx = snapTile(p.x, ELEV_TILE_WEB), cy = snapTile(p.y, ELEV_TILE_WEB);
      const half = ELEV_TILE_WEB / 2;
      try {
        return tag(parseAsciiGrid(await request({
          request: "GetCoverage", coverageId: cfg.coverageId,
          format: cfg.format, subsettingCrs: cfg.webCrs
        }, AbortSignal.timeout(ELEV_TIMEOUT), [
          ["subset", `${cfg.axisX}(${(cx - half).toFixed(2)},${(cx + half).toFixed(2)})`],
          ["subset", `${cfg.axisY}(${(cy - half).toFixed(2)},${(cy + half).toFixed(2)})`]
        ])), "web");
      } catch (err) {
        /* Salir de la cobertura es respuesta legítima; solo se abandona
           esta vía si el servicio no entiende la petición            */
        if (/extent/i.test(err.owsCode || "")) throw err;
        cfg.useWeb = false;
      }
    }

    /* Respaldo: latitud y longitud, también ajustado a la retícula fija
       (ELEV_TILE_GEO), no a la latitud real del cursor.               */
    if (cfg.geoCrs && cfg.useGeo !== false) {
      const tlon = snapTile(lon, ELEV_TILE_GEO.lon), tlat = snapTile(lat, ELEV_TILE_GEO.lat);
      const halfLon = ELEV_TILE_GEO.lon / 2, halfLat = ELEV_TILE_GEO.lat / 2;
      try {
        return tag(parseAsciiGrid(await request({
          request: "GetCoverage", coverageId: cfg.coverageId,
          format: cfg.format, subsettingCrs: cfg.geoCrs
        }, AbortSignal.timeout(ELEV_TIMEOUT), [
          ["subset", `Long(${(tlon - halfLon).toFixed(7)},${(tlon + halfLon).toFixed(7)})`],
          ["subset", `Lat(${(tlat - halfLat).toFixed(7)},${(tlat + halfLat).toFixed(7)})`]
        ])), "geo");
      } catch (err) {
        /* Salir de la cobertura es respuesta legítima, no un rechazo del
           modo geográfico: solo se abandona si no entiende la petición */
        if (/extent/i.test(err.owsCode || "")) throw err;
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

    return tag(parseAsciiGrid(await request({
      request: "GetCoverage", coverageId: cfg.coverageId, format: cfg.format
    }, AbortSignal.timeout(ELEV_TIMEOUT), [
      ["subset", `${cfg.axisX}(${(tx - p.half).toFixed(1)},${(tx + p.half).toFixed(1)})`],
      ["subset", `${cfg.axisY}(${(ty - p.half).toFixed(1)},${(ty + p.half).toFixed(1)})`]
    ])), cfg.geographic ? "geo" : "native");
  }

  /* El caché guarda REJILLAS y se busca en él por COBERTURA: una rejilla
     sirve si contiene el punto pedido. Antes se indexaba por celdas de
     25 m y, como la rejilla solo abarca ±10 m alrededor del punto donde
     se pidió, había puntos que caían dentro de la celda ya "resuelta"
     pero fuera de la rejilla: el caché devolvía una rejilla que no los
     cubría, no se pedía otra y quedaban huecos de hasta 22 m.       */
  const grids = [];   /* rejillas recientes, la más nueva al final     */

  /* Las zonas SIN datos sí se indexan por celda: no hay rejilla que
     delimite su extensión, y así no se pregunta por ellas sin parar */
  const emptyAt = new Set();
  const emptyKey = (lat, lon) => {
    const u = latLngToUtm(lat, lon);
    return u ? `${u.zone}/${Math.round(u.easting / ELEV_CELL)}/${Math.round(u.northing / ELEV_CELL)}` : null;
  };

  return {
    label,
    /* `undefined` = no se pudo consultar; `null` = sin dato ahí */
    async value(lat, lon) {
      for (let i = grids.length - 1; i >= 0; i--) {
        if (gridCovers(grids[i], lat, lon)) return grids[i];
      }
      const ek = emptyKey(lat, lon);
      if (ek && emptyAt.has(ek)) return null;
      if (!demRateOk()) return undefined;
      try {
        const g = await fetchValue(lat, lon);
        if (g && g.located) {
          grids.push(g);
          while (grids.length > ELEV_CACHE_MAX) grids.shift();
        } else if (ek) {
          emptyAt.add(ek); /* sin rejilla utilizable en esta zona */
        }
        demStatus("ok");
        return g;
      } catch (err) {
        if (/extent/i.test(err.owsCode || "")) {
          if (ek) emptyAt.add(ek);
          return null;
        }
        const why = err.name === "TimeoutError" ? "el servicio no responde"
          : err.message === "Failed to fetch"
            ? "el servicio no admite consultas desde el navegador (CORS)"
            : err.message;
        demStatus("error", `${label}: ${why}`);
        return undefined;
      }
    }
  };
}

/* Del GetCapabilities se sacan coberturas, formatos y sistemas */
function parseWcsCapabilities(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (parserErrorText(doc)) return null;
  const coverages = elsByTag(doc, "CoverageId").map(el => el.textContent.trim()).filter(Boolean);
  if (!coverages.length) return null;
  return {
    coverages,
    formats: elsByTag(doc, "formatSupported").map(el => el.textContent.trim()).filter(Boolean),
    crs: elsByTag(doc, "crsSupported").map(el => el.textContent.trim()).filter(Boolean)
  };
}

/* El MDT se publica en varias mallas y sistemas: `Elevacion<EPSG>_<paso>`.
   Interesa el paso MÁS FINO (5 m, el mismo que el MDS) y, entre los
   sistemas, uno geográfico, para poder preguntar en latitud/longitud. */
function pickMdtCoverage(ids) {
  const parsed = ids
    .map(id => ({ id, m: /^Elevacion(\d+)_(\d+)$/i.exec(id) }))
    .filter(x => x.m)
    .map(x => ({ id: x.id, epsg: Number(x.m[1]), step: Number(x.m[2]) }));
  if (!parsed.length) return ids[0] || null;
  const geo = new Set([4326, 4258]);
  parsed.sort((a, b) =>
    a.step - b.step ||                                   /* malla más fina  */
    (geo.has(b.epsg) ? 1 : 0) - (geo.has(a.epsg) ? 1 : 0) /* y geográfico    */
  );
  return parsed[0].id;
}

/* El MDS publica además coberturas "normalizadas" (mdsn_*), que dan la
   altura sobre el suelo y no la altitud: no sirven para comparar.    */
function pickMdsCoverage(ids) {
  return ids.find(id => !/mdsn|norm/i.test(id)) || ids[0] || null;
}

const mdtSource = makeElevationSource({
  base: "https://servicios.idee.es/wcs-inspire/mdt",
  label: "MDT", pickCoverage: pickMdtCoverage
});
const mdsSource = makeElevationSource({
  base: "https://wcs-mds.idee.es/mds",
  label: "MDS", pickCoverage: pickMdsCoverage
});

/* ---------- Cuadrícula de elevaciones ----------
   Se dibuja lo que ha devuelto el servicio, celda por celda y en su
   sitio: la cabecera de la rejilla trae esquina y tamaño de celda. Cada
   celda muestra el terreno (MDT), la superficie (MDS) y su diferencia.
   Mientras el modo altura está activo, las celdas se ACUMULAN: nada se
   borra hasta que se desactiva, momento en el que todo lo acumulado pasa
   a ser una capa del árbol de navegación (ver setAltitudeMode).       */
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
   de visualización (ver toElevUnit): es un umbral físico fijo, no una
   comodidad de pantalla.                                             */
const isElevAlert = cell => typeof cell.diff === "number" && cell.diff > ELEV_ALERT_DIFF;

/* La caja de la etiqueta acompaña al texto: tres líneas más margen */
const gridIconSize = font => [Math.round(font * 5.4), Math.round(font * 3.6)];
const elevGridLayer = L.layerGroup().addTo(map);
/* Vista viva (elevGridLayer) + una capa por sesión ya guardada en el
   árbol: refreshElevCells debe recalcular relleno y texto de todas
   ellas, no solo el de la sesión en curso.                           */
const elevGridGroups = [elevGridLayer];

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

/* Conversión pura, parametrizada por unidad (no por el estado mutable
   `elevUnit`) para poder probarla en Node sin depender de él.        */
const toElevUnit = (v, unit) => unit === "ft" ? v / METERS_PER_FOOT : v;

const fmtCell = v => v === null || v === undefined ? "—" : toElevUnit(v, elevUnit).toFixed(1);
const fmtDiff = d => d === null || d === undefined ? "—"
  : (d >= 0 ? "+" : "") + toElevUnit(d, elevUnit).toFixed(1);

/* Contenido de una celda según la banda de zoom (ver elevZoomBand):
   sin texto por debajo del 19, solo la diferencia en el 19, las tres
   líneas de siempre a partir del 20. El aviso (`.alert`) va SIEMPRE en
   la diferencia cuando supera ELEV_ALERT_DIFF, sea cual sea la banda. */
function elevCellHtml(cell, band) {
  const diffSpan = `<span class="ec-d${isElevAlert(cell) ? " alert" : ""}">${fmtDiff(cell.diff)}</span>`;
  if (band === "mini") return "";
  if (band === "diff") return diffSpan;
  return `<span class="ec-t">${fmtCell(cell.mdt)}</span>`
    + `<span class="ec-s">${fmtCell(cell.mds)}</span>`
    + diffSpan;
}

/* El relleno del rectángulo solo avisa en la banda "mini": ahí es la
   ÚNICA señal visible (no hay texto), así que si MDS supera al MDT en
   más de ELEV_ALERT_DIFF se colorea en rojo pastel; el resto de bandas
   siempre llevan el blanco translúcido de siempre.                   */
function renderElevRect(rect, cell, zoom) {
  const mini = elevZoomBand(zoom) === "mini";
  rect.setStyle({ fillColor: (mini && isElevAlert(cell)) ? GRID_ALERT_FILL : "#ffffff" });
}

function clearElevGrid() {
  elevGridLayer.clearLayers();
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
   el zoom (banda de contenido, tamaño de letra) y al conmutar la unidad
   (m/ft, ver elevUnitButton). La geometría de la cuadrícula no depende
   de ninguno de los dos, y volver a pedir datos sería absurdo: todo se
   recalcula a partir de `l._cell`, los valores crudos que ya guarda
   cada capa. Se recorren TODOS los grupos (la vista en curso y las
   sesiones ya guardadas en el árbol), no solo la vista en curso.      */
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
   difieren (5x4 frente a 4x4, y donde el MDS no llega NO se inventa ni
   se interpola).                                                      */
function buildElevCells(terrain, surface) {
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
      const diff = (typeof mdt === "number" && typeof mds === "number") ? mds - mdt : null;
      cells.push({ sw, ne, center: [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2], mdt, mds, diff });
    }
  }
  return { grid, role: terrain === grid ? "terrain" : "surface", cells };
}

/* Clave de deduplicado EXACTA: como las peticiones se ajustan a la
   retícula fija (ver snapTile), dos peticiones sobre la misma tesela
   producen siempre la misma esquina xll/yll en la respuesta, así que
   comparar por esquina + sistema + papel (MDT/MDS) basta, sin falta de
   comparación geométrica aproximada.                                 */
const elevTileKey = built =>
  `${built.role}:${built.grid.crs}:${built.grid.xll.toFixed(2)}:${built.grid.yll.toFixed(2)}`;

/* Construye las capas Leaflet (rectángulo + etiqueta) de UNA celda.
   Compartido entre el dibujo en vivo y la reconstrucción de una capa
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

/* Dibuja una respuesta nueva SIN borrar lo anterior: mientras el modo
   altura esté activo, las celdas se acumulan en `elevAccum` y se añaden
   a la vista en vivo. Una tesela ya dibujada no se vuelve a dibujar
   (deduplicado exacto, ver elevTileKey), y hay un tope de celdas por
   sesión (ELEV_ACCUM_MAX_CELLS) para no acumular sin límite.          */
function drawElevGrid(terrain, surface) {
  if (!elevAccum) return; /* defensivo: no debería llamarse con el modo apagado */
  const built = buildElevCells(terrain, surface);
  if (!built || !built.cells.length) return;

  const key = elevTileKey(built);
  if (elevAccum.tileKeys.has(key)) return;
  if (elevAccum.cells.length >= ELEV_ACCUM_MAX_CELLS) {
    if (!elevAccumCapped) {
      elevAccumCapped = true;
      navMessage(`Cuadr\u00EDcula de elevaciones: se alcanz\u00F3 el m\u00E1ximo de `
        + `${ELEV_ACCUM_MAX_CELLS} celdas acumuladas en esta sesi\u00F3n; la lectura `
        + `bajo el cursor sigue funcionando, pero no se dibujan m\u00E1s celdas. `
        + `Apague y vuelva a activar el modo altura para empezar una capa nueva.`,
        { tone: "info" });
    }
    return;
  }
  elevAccum.tileKeys.add(key);

  const zoom = map.getZoom();
  for (const cell of built.cells) {
    elevAccum.cells.push(cell);
    for (const layer of makeElevCellLayers(cell, zoom)) elevGridLayer.addLayer(layer);
  }
}

/* Construye una capa completa (rectángulos + etiquetas) a partir de
   registros de celda ya calculados: se usa tanto al cerrar una sesión
   de modo altura como al restaurar una capa guardada desde IndexedDB.
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

/* ---------- Muestreo ----------
   Quien manda es la COBERTURA de la última rejilla, no la distancia
   recorrida: mientras el cursor siga dentro de ella, sus valores se leen
   directamente y no se pide nada. Se pide solo al salirse. Antes se
   decidía por celdas de 25 m, y como la rejilla se centra donde estaba
   el ratón al pedirla, había puntos que caían fuera de la rejilla pero
   dentro de la celda ya "resuelta": ni se repintaba ni se volvía a
   pedir, y quedaban zonas muertas.                                    */
let elevTimer = null, elevSeq = 0;
let lastCursor = null;
const lastGrid = { terrain: null, surface: null };

/* Acumulador de la sesión de modo altura en curso: null cuando el modo
   está apagado. `tileKeys` es el mismo deduplicado exacto de drawElevGrid
   (ver elevTileKey). `elevAccumCapped` evita repetir el aviso de tope.
   `elevGridCount` numera "Elevación N" y se autosincroniza al restaurar
   el árbol. Lleva contador propio porque `elevGrid` es un tipo de
   registro propio y puede resincronizarlo al restaurar; las mediciones
   y las formas dibujadas usan `nextNumberedName`, que deduce el número
   de los nombres existentes (ver esa función).                        */
let elevAccum = null;
let elevAccumCapped = false;
let elevGridCount = 0;
/* Unidad de visualización de la cuadrícula (no del cuadro de
   coordenadas, que sigue mostrando siempre m y ft): arranca en metros
   en cada carga de página, sin persistirse. Ver elevUnitButton.       */
let elevUnit = "m";

/* Posición del cursor en las coordenadas de una rejilla concreta */
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
   lat/lng). Es lo que permite comprobar cobertura contra una capa de
   elevaciones existente SIN tener la esquina de rejilla WCS que usa
   elevTileKey (esa solo existe justo tras una respuesta nueva).       */
function pointInCell(cell, lat, lng) {
  const loLat = Math.min(cell.sw[0], cell.ne[0]), hiLat = Math.max(cell.sw[0], cell.ne[0]);
  const loLng = Math.min(cell.sw[1], cell.ne[1]), hiLng = Math.max(cell.sw[1], cell.ne[1]);
  return lat >= loLat && lat <= hiLat && lng >= loLng && lng <= hiLng;
}

/* ¿Ya tiene la capa destino de esta sesión (ver setAltitudeMode) un dato
   para este punto? Barrido lineal de las celdas previas: hasta
   ELEV_ACCUM_MAX_CELLS (4000), a lo sumo una vez cada ELEV_SETTLE_MS,
   así que el coste es despreciable, no hace falta indexar.           */
const coveredByPriorCells = (lat, lng) =>
  !!elevAccum && elevAccum.priorCells.some(c => pointInCell(c, lat, lng));

/* Celda previa (de la capa destino) que cubre el punto, o null. Se usa
   para la lectura del cursor cuando ni la rejilla en vivo ni la
   petición actual tienen el dato: sin esto, un punto ya cubierto por la
   capa destino pero no re-pedido en esta sesión se quedaba en
   "consultando…" para siempre.                                       */
const priorCellAt = (lat, lng) =>
  (elevAccum && elevAccum.priorCells.find(c => pointInCell(c, lat, lng))) || null;

/* Escribe la lectura con lo que ya se tiene, sin pedir nada */
function showElevationAt(latlng) {
  let t = gridSample(lastGrid.terrain, latlng.lat, latlng.lng);
  let s = gridSample(lastGrid.surface, latlng.lat, latlng.lng);
  if (t === undefined || s === undefined) {
    const prior = priorCellAt(latlng.lat, latlng.lng);
    if (prior) {
      if (t === undefined) t = prior.mdt;
      if (s === undefined) s = prior.mds;
    }
  }
  coordsControl.setElevation("terrain",
    t === undefined ? "consultando\u2026" : fmtElevation(t), t === undefined ? null : t);
  coordsControl.setElevation("surface",
    s === undefined ? "consultando\u2026" : fmtElevation(s), s === undefined ? null : s);
}

/* Llamado en cada movimiento del ratón: barato, sin red */
function elevRequest(latlng) {
  lastCursor = latlng;
  showElevationAt(latlng);
  /* Si las dos rejillas cubren el punto, no hay nada que pedir */
  if (gridCovers(lastGrid.terrain, latlng.lat, latlng.lng)
      && gridCovers(lastGrid.surface, latlng.lat, latlng.lng)) {
    clearTimeout(elevTimer);
    elevTimer = null;
    return;
  }
  /* Ni tampoco si la capa destino de esta sesión ya lo tiene: fusionar
     no debe repetir peticiones que esa capa ya resolvió.              */
  if (coveredByPriorCells(latlng.lat, latlng.lng)) {
    clearTimeout(elevTimer);
    elevTimer = null;
    return;
  }
  clearTimeout(elevTimer);
  elevTimer = setTimeout(() => sampleElevations(latlng), ELEV_SETTLE_MS);
}

async function sampleElevations(latlng) {
  if (!demOn || !latlng) return;
  const seq = ++elevSeq;
  const [terrain, surface] = await Promise.all([
    mdtSource.value(latlng.lat, latlng.lng),
    mdsSource.value(latlng.lat, latlng.lng)
  ]);
  if (!demOn || seq !== elevSeq) return; /* el cursor ya está en otro sitio */

  /* `undefined` significa "no se pudo consultar": se conserva la rejilla
     anterior en vez de borrar lo que ya se veía                       */
  if (terrain !== undefined) lastGrid.terrain = terrain;
  if (surface !== undefined) lastGrid.surface = surface;
  drawElevGrid(lastGrid.terrain, lastGrid.surface);

  if (lastCursor) showElevationAt(lastCursor);
  /* Si el servicio no da nada, decirlo: si no, se quedaría en
     "consultando…" para siempre                                      */
  if (terrain === undefined) coordsControl.setElevation("terrain", "no disponible", null);
  if (surface === undefined) coordsControl.setElevation("surface", "no disponible", null);
}

const fmtElevation = h => h === undefined ? "no disponible"
  : h === null ? "sin datos" : fmtAltitude(h);

/* Sección del árbol para las capas de elevación guardadas. Se localiza
   por nombre (ensureNamedSection, igual que "Lugares"/"Marcadores"), no
   con una caché de referencia como las mediciones: así sobrevive a la
   restauración sin necesitar un enganche especial en materializeRecords. */
function ensureElevSection() {
  return ensureNamedSection("Elevaciones");
}

/* Nodos "elevGrid" cuya capa está VISIBLE ahora mismo (casilla marcada,
   la misma fuente de verdad que usa applyVisibility: pertenencia a
   rootGroup), materializados o no: findMatches ya recorre filas reales
   Y registros pendientes (li._pending) por igual, así que una capa de
   elevaciones dentro de una carpeta nunca desplegada se encuentra y se
   materializa bajo demanda (resolveMatch) igual que un resultado del
   buscador, en vez de fusionarse a ciegas por no poder alcanzarla.     */
async function visibleElevGridNodes() {
  const matches = findMatches(
    li => li._elevGrid && rootGroup.hasLayer(nodeLayer(li)),
    rec => rec.t === "elevGrid" && rec._layer && rootGroup.hasLayer(rec._layer)
  );
  const lis = [];
  for (const m of matches) {
    const li = await resolveMatch(m);
    if (li) lis.push(li);
  }
  return lis;
}

/* De varias capas visibles a la vez, la que recibe la sesión nueva es
   la más cercana al centro actual de la vista (proxy razonable de por
   dónde va a empezar a medir el usuario), con la misma distancia
   geodésica que ya usan las mediciones (map.distance).                */
function pickClosestElevLi(nodes) {
  if (nodes.length <= 1) return nodes[0] || null;
  const ref = map.getCenter();
  let best = nodes[0], bestDist = Infinity;
  for (const li of nodes) {
    const d = map.distance(ref, nodeLayer(li).getBounds().getCenter());
    if (d < bestDist) { bestDist = d; best = li; }
  }
  return best;
}

/* Convierte lo acumulado en una sesión de modo altura en una capa normal
   del árbol: persistente, con checkbox, borrable. Sin pushUndo (ninguna
   creación de nodo lo llama hoy, solo las operaciones destructivas).  */
function finalizeElevSession(cells) {
  const group = buildElevGridGroup(cells).addTo(rootGroup);
  elevGridGroups.push(group);
  const name = "Elevación " + (++elevGridCount);
  const li = makeNode({
    name, layer: group, styleable: false,
    onDelete: () => {
      const i = elevGridGroups.indexOf(group);
      if (i >= 0) elevGridGroups.splice(i, 1);
    }
  });
  li._elevGrid = { cells };
  ensureElevSection().appendChild(li);
  scheduleSave();
}

/* Añade lo acumulado en esta sesión a una capa YA EXISTENTE (la que
   pickClosestElevLi eligió al activar el modo), en vez de crear una
   capa nueva. Añadir capas a un featureGroup que ya está en el mapa
   (vía rootGroup) funciona sin más: addLayer ya comprueba si su _map
   está definido y las añade al mapa en el mismo paso — el mismo
   mecanismo que ya usa drawElevGrid con elevGridLayer.                */
function mergeElevSession(targetLi, newCells) {
  const group = nodeLayer(targetLi);
  const zoom = map.getZoom();
  for (const cell of newCells) {
    for (const layer of makeElevCellLayers(cell, zoom)) group.addLayer(layer);
  }
  targetLi._elevGrid.cells = targetLi._elevGrid.cells.concat(newCells);
  scheduleSave();
}

/* Reconstruye una capa de elevaciones guardada (usado al restaurar el
   árbol), como registro pendiente. Sigue el patrón de las capas
   normales (t === "layer"): se construye desconectada y solo se añade a
   rootGroup si está marcada; el DOM lo pone materializeRecords después. */
function buildElevGridRecord(n) {
  const group = buildElevGridGroup(n.cells);
  elevGridGroups.push(group);
  if (n.checked) group.addTo(rootGroup);
  elevGridCount++;
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

async function setAltitudeMode(on) {
  demOn = on;
  if (demButton) demButton.classList.toggle("active", on);
  if (elevUnitButton) elevUnitButton.hidden = !on;
  coordsControl.showElevation(on);
  if (on) {
    /* Si ya hay una (o varias) capas de elevaciones visibles, esta
       sesión se fusiona en la más cercana en vez de crear una nueva;
       priorCells alimenta el "no repetir peticiones" de elevRequest. */
    const target = pickClosestElevLi(await visibleElevGridNodes());
    elevAccum = {
      cells: [], tileKeys: new Set(),
      targetLi: target, priorCells: target ? target._elevGrid.cells : []
    };
    elevAccumCapped = false;
    map.attributionControl.addAttribution(ELEV_ATTRIB); /* CC BY 4.0 obliga */
  } else {
    map.attributionControl.removeAttribution(ELEV_ATTRIB);
    clearTimeout(elevTimer);
    elevTimer = null;
    elevSeq++;
    /* La sesión se convierte en capa (o se fusiona) ANTES de limpiar la
       vista transitoria. Si la capa destino desapareció mientras tanto
       (el usuario la borró con el modo activo), se cae a crear una
       capa nueva en vez de perder lo medido.                          */
    if (elevAccum && elevAccum.cells.length) {
      if (elevAccum.targetLi && elevAccum.targetLi.isConnected) {
        mergeElevSession(elevAccum.targetLi, elevAccum.cells);
      } else {
        finalizeElevSession(elevAccum.cells);
      }
    }
    elevAccum = null;
    clearElevGrid();
    lastGrid.terrain = lastGrid.surface = null;
  }
}

