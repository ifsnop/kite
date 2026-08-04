const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const { DOMParser } = require("@xmldom/xmldom");
const fs = require("fs");
const script = fs.readFileSync(HTML_PATH,"utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];
function fn(n){ const i=script.indexOf(`function ${n}(`); let d=0;
  for(let k=script.indexOf("{",i);k<script.length;k++){ if(script[k]==="{")d++; else if(script[k]==="}"&&--d===0) return script.slice(i,k+1);} }
const helpers = script.slice(script.indexOf("/* Nombre sin prefijo"), script.indexOf("/* KML usa color"));
const fonts = script.slice(script.indexOf("const GRID_FONT_BASE"), script.indexOf("const elevGridLayer"));
/* ELEV_WINDOW se define antes del resto de constantes de elevación, pero
   la retícula fija (ELEV_TILE_WEB/ELEV_TILE_GEO, dentro del tramo
   webMercatorHalf→parseMdsCoverage) la necesita al evaluarse.        */
const elevWindow = script.slice(script.indexOf("const ELEV_WINDOW"), script.indexOf("const ELEV_CELL"));
const consts = fonts + elevWindow
  + script.slice(script.indexOf("const ELEV_GEO_CRS"), script.indexOf("function toWebMercator"))
  + script.slice(script.indexOf("const webMercatorHalf"), script.indexOf("function parseMdsCoverage"));
/* elevTileKey es una const de flecha, no una function declaration:
   fn() no la encuentra, así que se extrae por rango como los `consts`. */
const elevTileKeySrc = script.slice(script.indexOf("const elevTileKey ="),
  script.indexOf("/* Construye las capas Leaflet"));
/* METERS_PER_FOOT vive lejos de las demás constantes de elevación (junto
   a fmtAltitude, el formateo del cuadro de coordenadas); toElevUnit
   (también una const de flecha) lo necesita para la conversión m/ft. */
const meterFoot = script.slice(script.indexOf("const METERS_PER_FOOT"), script.indexOf("const fmtAltitude"));
const toElevUnitSrc = script.slice(script.indexOf("const toElevUnit ="), script.indexOf("const fmtCell"));
const src = "const parserErrorText = () => null;\nconst toRad = d => d * Math.PI / 180;\n" + helpers + consts +
  [fn("parseWcsCapabilities"), fn("pickMdtCoverage"), fn("pickMdsCoverage"),
   fn("parseMdsCoverage"), fn("parseOwsException"), fn("parseAsciiGrid"), fn("gridCellBounds"),
   fn("gridToLatLng"), fn("buildElevCells"), fn("pointInCell"), fn("text")].join("\n")
  + "\n" + elevTileKeySrc + "\n" + meterFoot + "\n" + toElevUnitSrc;
const apiExports = "\nreturn {parseWcsCapabilities, pickMdtCoverage, pickMdsCoverage, pickGeoCrs," +
  " pickMdsFormat, parseMdsCoverage, parseOwsException, parseAsciiGrid," +
  " pickWebMercator, webMercatorHalf, gridCellBounds, gridFontSize, gridIconSize," +
  " snapTile, ELEV_TILE_WEB, ELEV_TILE_GEO, ELEV_WINDOW, gridToLatLng, buildElevCells, elevTileKey," +
  " elevZoomBand, isElevAlert, pointInCell, toElevUnit, METERS_PER_FOOT};";
const api = new Function("DOMParser", src + apiExports)(DOMParser);
const ok=(c,m)=>{ if(!c){ console.error("FAIL: "+m); process.exitCode=1; } };

/* GetCapabilities real del WCS del MDT, recortado a lo que se usa */
const ids = ["Elevacion4258_1000","Elevacion4326_1000","Elevacion4258_500","Elevacion4326_500",
  "Elevacion4258_200","Elevacion4258_25","Elevacion4258_5","Elevacion25830_1000",
  "Elevacion4083_1000","Elevacion25830_500","Elevacion4083_500","Elevacion25830_200",
  "Elevacion4083_200","Elevacion25830_25","Elevacion4083_25","Elevacion25830_5","Elevacion4083_5"];
const caps = `<?xml version="1.0"?><wcs:Capabilities xmlns:wcs="http://www.opengis.net/wcs/2.0"
  xmlns:crs="http://www.opengis.net/wcs/crs/1.0">
  <wcs:ServiceMetadata>
    <wcs:formatSupported>image/tiff</wcs:formatSupported>
    <wcs:formatSupported>ArcGrid</wcs:formatSupported>
    <wcs:formatSupported>application/asc</wcs:formatSupported>
    <wcs:Extension><crs:CrsMetadata>
      <crs:crsSupported>http://www.opengis.net/def/crs/EPSG/0/25830</crs:crsSupported>
      <crs:crsSupported>http://www.opengis.net/def/crs/EPSG/0/4258</crs:crsSupported>
      <crs:crsSupported>http://www.opengis.net/def/crs/EPSG/0/4326</crs:crsSupported>
    </crs:CrsMetadata></wcs:Extension>
  </wcs:ServiceMetadata>
  <wcs:Contents>${ids.map(i => `<wcs:CoverageSummary><wcs:CoverageId>${i}</wcs:CoverageId></wcs:CoverageSummary>`).join("")}</wcs:Contents>
</wcs:Capabilities>`;

const parsed = api.parseWcsCapabilities(caps);
ok(parsed.coverages.length === 17, "las 17 coberturas se leen: " + parsed.coverages.length);
ok(parsed.formats.includes("ArcGrid"), "formatos leídos");
ok(parsed.crs.length === 3, "sistemas leídos");

/* Debe elegirse la malla de 5 m —la misma del MDS— y en un sistema
   geográfico, para poder preguntar en latitud/longitud */
const chosen = api.pickMdtCoverage(ids);
ok(chosen === "Elevacion4258_5", "cobertura elegida: " + chosen);
ok(/_5$/.test(chosen), "paso de malla de 5 m, comparable con el MDS");
ok(/4258|4326/.test(chosen), "y en coordenadas geográficas");

/* Si desapareciera la geográfica de 5 m, se prefiere seguir en 5 m */
ok(api.pickMdtCoverage(["Elevacion25830_5","Elevacion4258_25"]) === "Elevacion25830_5",
   "la malla manda sobre el sistema: " + api.pickMdtCoverage(["Elevacion25830_5","Elevacion4258_25"]));
ok(api.pickMdtCoverage(["Elevacion4083_25","Elevacion4258_25"]) === "Elevacion4258_25",
   "a igual malla, gana el geográfico");
ok(api.pickMdtCoverage(["otraCosa"]) === "otraCosa", "si no siguen el patrón, se usa la primera");
ok(api.pickMdtCoverage([]) === null, "sin coberturas, null");

/* El MDS sigue evitando las normalizadas */
ok(api.pickMdsCoverage(["mdsn_e025","mds05","mdsn_v025"]) === "mds05", "MDS absoluto");

/* Ambas fuentes acaban pidiendo la MISMA ventana y formato */
const mdt = api.pickMdtCoverage(ids), mds = api.pickMdsCoverage(["mds05"]);
ok(/_5$/.test(mdt) && /05$/.test(mds), `mismo paso de malla: ${mdt} vs ${mds}`);

/* ---- formatos: nombres reales del IGN, que no siguen ninguna convención ---- */
const realFormats = ["image/tiff","ArcGrid","application/asc","image/png","image/jpeg",
  "image/gif","image/png; mode=8bit","GEOTIFFINT16","GEOTIFF_RGB"];
ok(api.pickMdsFormat(realFormats) === "ArcGrid", "se elige la rejilla ASCII: " + api.pickMdsFormat(realFormats));
ok(api.pickMdsFormat(realFormats.filter(f => f !== "ArcGrid")) === "application/asc", "alternativa del IGN");
ok(api.pickMdsFormat(["image/tiff","image/png"]) === null, "solo binarios → null, se avisa en vez de pedir a ciegas");
ok(api.pickMdsFormat([]) === null, "lista vacía");

/* ---- CRS geográfico preferido ---- */
const crsReal = ["http://www.opengis.net/def/crs/EPSG/0/25830",
  "http://www.opengis.net/def/crs/EPSG/0/4258","http://www.opengis.net/def/crs/EPSG/0/4326"];
ok(api.pickGeoCrs(crsReal).endsWith("/4326"), "WGS84 geográfico primero");
ok(api.pickGeoCrs(["http://www.opengis.net/def/crs/EPSG/0/25830"]) === null, "solo proyectados → null");

/* ---- descripción de la cobertura: ejes por nombre, no por orden ---- */
const desc = ejes => `<?xml version="1.0"?><wcs:CoverageDescriptions xmlns:wcs="http://www.opengis.net/wcs/2.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"><gml:Envelope srsName="http://www.opengis.net/def/crs/EPSG/0/25830"
   axisLabels="${ejes}"><gml:lowerCorner>${ejes === "x y" ? "-16000 3900000" : "3900000 -16000"}</gml:lowerCorner>
   <gml:upperCorner>${ejes === "x y" ? "1200000 4900000" : "4900000 1200000"}</gml:upperCorner></gml:Envelope></wcs:CoverageDescriptions>`;
let cfg = api.parseMdsCoverage(desc("x y"));
ok(cfg.axisX === "x" && cfg.axisY === "y" && cfg.zone === 30, "ejes x/y y huso 30");
ok(cfg.minX === -16000 && cfg.maxY === 4900000, "extensión asociada a cada eje");
cfg = api.parseMdsCoverage(desc("N E"));
ok(cfg.axisX === "E" && cfg.axisY === "N", "convención N/E entendida igual");
ok(cfg.minX === -16000 && cfg.maxY === 4900000, "y su extensión también");
ok(api.parseMdsCoverage("<x/>") === null, "sin envolvente, null");

/* ---- errores OGC, que llegan como XML ---- */
const exml = code => `<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/2.0">
  <ows:Exception exceptionCode="${code}"><ows:ExceptionText>fallo ${code}</ows:ExceptionText>
  </ows:Exception></ows:ExceptionReport>`;
ok(api.parseOwsException(exml("ExtentError")).code === "ExtentError", "código leído");
ok(api.parseOwsException(exml("InvalidParameterValue")).msg.includes("fallo"), "texto leído");
ok(api.parseOwsException("ncols 3\n695.3") === null, "una rejilla no es una excepción");
ok(api.parseAsciiGrid(exml("ExtentError")) === null, "el XML de error no se lee como altitud");

/* ---- rejilla ASCII ---- */
const asc = "ncols 3\nnrows 2\ncellsize 5\nNODATA_value -9999\n-9999 695.32 696.10\n697.0 698.2 699.1\n";
const g = api.parseAsciiGrid(asc);
ok(g && g.cols === 3 && g.rows === 2, "dimensiones leídas: " + (g && `${g.cols}x${g.rows}`));
ok(g.values[0][0] === null, "NODATA se marca como hueco, no como altitud");
ok(Math.abs(g.values[0][1] - 695.32) < 1e-6, "valores en su sitio: " + g.values[0][1]);
ok(Math.abs(g.values[1][2] - 699.1) < 1e-6, "última fila y columna: " + g.values[1][2]);
ok(api.parseAsciiGrid("respuesta de error del servidor") === null, "texto suelto no es una rejilla");
ok(api.parseAsciiGrid("ncols 2\nnrows 2\ncellsize 5\nxllcorner 0\nyllcorner 0\n1 2\n") === null,
   "faltan valores → null, no una matriz a medias");


/* ---- Web Mercator preferido al geográfico ---- */
const crsMdt = ["http://www.opengis.net/def/crs/EPSG/0/25828","http://www.opengis.net/def/crs/EPSG/0/25830",
  "http://www.opengis.net/def/crs/EPSG/0/4258","http://www.opengis.net/def/crs/EPSG/0/3857",
  "http://www.opengis.net/def/crs/EPSG/0/4326","http://www.opengis.net/def/crs/EPSG/0/4083"];
ok(api.pickWebMercator(crsMdt).endsWith("/3857"), "de la lista real del MDT se elige 3857: " + api.pickWebMercator(crsMdt));
ok(api.pickWebMercator(["http://www.opengis.net/def/crs/EPSG/0/4326"]) === null,
   "si no lo ofrece, null y se cae a las geográficas");
ok(api.pickWebMercator([]) === null, "lista vacía");
ok(!api.pickWebMercator(["http://www.opengis.net/def/crs/EPSG/0/38571"]), "no confunde códigos parecidos");

/* La ventana en metros Web Mercator crece con la latitud: la proyección
   estira la escala y sin corregirlo se pediría un recorte demasiado
   pequeño en el norte peninsular                                     */
const h0 = api.webMercatorHalf(0, 10), h40 = api.webMercatorHalf(40, 10), h70 = api.webMercatorHalf(70, 10);
ok(Math.abs(h0 - 10) < 1e-9, "en el ecuador, 1:1: " + h0);
ok(h40 > 13 && h40 < 13.1, "a 40° hace falta un 30% más: " + h40.toFixed(2));
ok(h70 > h40, "y sigue creciendo hacia el norte");
ok(api.webMercatorHalf(89.9, 10) < 250, "cerca del polo no se dispara: " + api.webMercatorHalf(89.9, 10).toFixed(0));

/* ---- Georreferencia de la rejilla: es lo que sitúa la cuadrícula ---- */
const geo = api.parseAsciiGrid(
  "ncols 4\nnrows 4\nxllcorner 100\nyllcorner 200\ncellsize 5\nNODATA_value -9999\n" +
  "10 11 12 13\n20 21 22 23\n30 31 32 33\n40 41 42 43\n");
ok(geo.located && geo.cols === 4 && geo.rows === 4, "rejilla 4x4 ubicada");
ok(geo.xll === 100 && geo.yll === 200 && geo.cellX === 5 && geo.cellY === 5, "esquina y tamaño de celda");

/* Celdas RECTANGULARES: la rejilla declara `cellsize` solo si son
   cuadradas; si no, `dx` y `dy`. Exigir `cellsize` descartaba entera la
   respuesta del MDT (5x4 celdas frente a las 4x4 del MDS).          */
const rect = api.parseAsciiGrid(
  "ncols 5\nnrows 4\nxllcorner 100\nyllcorner 200\ndx 4\ndy 5\nNODATA_value -9999\n" +
  "1 2 3 4 5\n6 7 8 9 10\n11 12 13 14 15\n16 17 18 19 20\n");
ok(rect !== null, "una rejilla con dx/dy ya NO se descarta");
ok(rect.cols === 5 && rect.rows === 4, "dimensiones: " + `${rect.cols}x${rect.rows}`);
ok(rect.cellX === 4 && rect.cellY === 5, "celdas rectangulares: " + `${rect.cellX}x${rect.cellY}`);
const rb = api.gridCellBounds(rect, 0, 0);
ok(rb.x1 - rb.x0 === 4 && rb.y1 - rb.y0 === 5, "cada celda usa su propia anchura y altura");
const rlast = api.gridCellBounds(rect, 3, 4);
ok(rlast.x1 === 100 + 5 * 4 && rlast.y0 === 200, "la malla cubre columnas x dx y filas x dy");

/* La fila 0 es la de ARRIBA (norte): su y0 debe ser el mayor */
let b0 = api.gridCellBounds(geo, 0, 0), b3 = api.gridCellBounds(geo, 3, 0);
ok(b0.y0 === 215 && b0.y1 === 220, "primera fila al norte: " + JSON.stringify([b0.y0, b0.y1]));
ok(b3.y0 === 200 && b3.y1 === 205, "última fila al sur: " + JSON.stringify([b3.y0, b3.y1]));
ok(b0.x0 === 100 && b0.x1 === 105, "primera columna al oeste");
const bLast = api.gridCellBounds(geo, 0, 3);
ok(bLast.x0 === 115 && bLast.x1 === 120, "última columna al este");
/* La malla completa cubre exactamente cols x cell */
ok(bLast.x1 - b0.x0 === geo.cols * geo.cellX, "anchura total = columnas x celda");
ok(b0.y1 - b3.y0 === geo.rows * geo.cellY, "altura total = filas x celda");

/* ---- Muestreo bajo el cursor: es lo que se lee en el panel ----
   La rejilla `geo` está en coordenadas geográficas, así que se puede
   muestrear con la misma función que usa el visor.                  */
const sample = (grid, lat, lon) => {
  if (!grid || !grid.located || grid.crs === "native") return undefined;
  const x = grid.crs === "geo" ? lon : lon, y = grid.crs === "geo" ? lat : lat;
  const c = Math.floor((x - grid.xll) / grid.cellX);
  const r = grid.rows - 1 - Math.floor((y - grid.yll) / grid.cellY);
  if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) return undefined;
  return grid.values[r][c];
};
const geoTagged = { ...geo, crs: "geo" };
/* Esquina inferior izquierda (100,200): fila de abajo, columna 0 → 40 */
ok(sample(geoTagged, 202, 102) === 40, "esquina suroeste: " + sample(geoTagged, 202, 102));
/* Esquina superior izquierda: fila de arriba → 10 */
ok(sample(geoTagged, 218, 102) === 10, "esquina noroeste: " + sample(geoTagged, 218, 102));
/* Esquina superior derecha: última columna → 13 */
ok(sample(geoTagged, 218, 118) === 13, "esquina noreste: " + sample(geoTagged, 218, 118));
/* Moverse dentro de la rejilla da valores DISTINTOS: era el fallo, que
   siempre se leía la celda central                                  */
const dentro = new Set([sample(geoTagged, 202, 102), sample(geoTagged, 218, 118),
                        sample(geoTagged, 210, 110)]);
ok(dentro.size === 3, "cada punto de la rejilla da su propio valor: " + [...dentro]);
/* Fuera de la rejilla: `undefined`, que es lo que dispara una petición */
ok(sample(geoTagged, 250, 110) === undefined, "al norte, fuera");
ok(sample(geoTagged, 210, 90) === undefined, "al oeste, fuera");
ok(sample(geoTagged, 199, 110) === undefined, "justo al sur del borde, fuera");
/* Un hueco dentro de la rejilla es `null`, NO `undefined`: hay dato de
   cobertura pero no de altitud, y no debe pedirse otra vez         */
const hole = api.parseAsciiGrid("ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 5\n" +
  "NODATA_value -9999\n700 -9999\n-9999 -9999\n");
const holeTagged = { ...hole, crs: "geo" };
ok(sample(holeTagged, 7, 2) === 700, "celda con dato");
ok(sample(holeTagged, 7, 7) === null, "celda sin dato → null, no undefined");
ok(sample(holeTagged, 20, 20) === undefined, "fuera → undefined");

/* Variante centrada en celda: la esquina se deduce restando media celda */
const centered = api.parseAsciiGrid("ncols 1\nnrows 1\nxllcenter 102.5\nyllcenter 202.5\ncellsize 5\n700\n");
ok(centered.xll === 100 && centered.yll === 200, "xllcenter/yllcenter se convierten a esquina");

/* Sin esquina, la rejilla sigue sirviendo para leer aunque no se dibuje */
const noGeo = api.parseAsciiGrid("ncols 1\nnrows 1\ncellsize 5\n700\n");
ok(noGeo && noGeo.located === false, "sin esquina, no ubicable");
ok(noGeo.values[0][0] === 700, "pero su valor se sigue leyendo");


/* ---- Tamaño del texto de la cuadrícula según el zoom ---- */
for (const z of [6, 15, 19, 20]) ok(api.gridFontSize(z) === 10, `zoom ${z} mantiene el tamaño base`);
ok(api.gridFontSize(21) === 11, "desde el 21 crece: " + api.gridFontSize(21));
for (let z = 21; z < 25; z++) ok(api.gridFontSize(z + 1) - api.gridFontSize(z) === 1, `un punto por nivel en ${z}`);
ok(api.gridFontSize(40) === 22, "hay tope, para que quepa en la celda: " + api.gridFontSize(40));
ok(api.gridFontSize(21.6) === 12, "los zooms fraccionarios de Leaflet se redondean");
ok(api.gridIconSize(22)[0] > api.gridIconSize(10)[0], "la caja de la etiqueta crece con el texto");


/* ---- Caché por COBERTURA frente a caché por celdas ----
   Reproduce el hueco reportado: a 38.13° de latitud, entre dos
   longitudes separadas 13,5 m no aparecía cuadrícula. La causa era
   indexar por celdas de 25 m rejillas que solo abarcan ±10 m.       */
function traverse({ porCeldas, window, celda = 25 }) {
  const grids = [], porClave = new Map();
  let peticiones = 0, huecos = 0;
  const cubre = (g, x) => x >= g.c - g.w && x <= g.c + g.w;
  for (let x = 0; x <= 400; x += 0.5) {
    let g;
    if (porCeldas) {
      const k = Math.round(x / celda);
      g = porClave.get(k) || null;
      if (!g) { peticiones++; g = { c: x, w: window }; porClave.set(k, g); }
    } else {
      g = grids.find(t => cubre(t, x)) || null;
      if (!g) { peticiones++; g = { c: x, w: window }; grids.push(g); }
    }
    if (!cubre(g, x)) huecos++;
  }
  return { peticiones, huecos };
}
const viejo = traverse({ porCeldas: true, window: 10 });
const nuevo = traverse({ porCeldas: false, window: 20 });
ok(viejo.huecos > 0, "el caché por celdas dejaba puntos sin cobertura: " + viejo.huecos);
ok(nuevo.huecos === 0, "el caché por cobertura no deja ninguno: " + nuevo.huecos);
ok(nuevo.peticiones < viejo.peticiones * 1.5,
   `y el coste en red sigue siendo razonable: ${nuevo.peticiones} frente a ${viejo.peticiones}`);
/* El hueco medido por el usuario cabe en lo que predice el modelo */
const anchoHueco = (-5.221889 + 5.222043) * 111320 * Math.cos(38.133423 * Math.PI / 180);
ok(anchoHueco > 0 && anchoHueco < 25 / 2 + 10,
   `el hueco reportado (${anchoHueco.toFixed(1)} m) cabe en el peor caso del modelo`);

/* ---- Retícula fija de peticiones: snapTile no debe solapar teselas ---- */
ok(api.snapTile(5, 10) === 5, "el centro de la primera tesela es el propio tamaño/2: " + api.snapTile(5, 10));
ok(api.snapTile(9.9, 10) === 5, "todavía dentro de la tesela [0,10)");
ok(api.snapTile(10, 10) === 15, "justo en el borde, ya es la tesela siguiente");
ok(api.snapTile(-1, 10) === -5, "también funciona con negativos: " + api.snapTile(-1, 10));
/* Determinismo: mismo punto, mismo resultado siempre */
ok(api.snapTile(37.42, 10) === api.snapTile(37.42, 10), "snapTile es determinista");
/* No solapamiento: dos puntos en teselas vecinas producen ventanas
   [centro-half, centro+half] que como mucho SE TOCAN en el borde, nunca
   se solapan.                                                        */
{
  const size = 10, half = size / 2;
  const c1 = api.snapTile(4, size), c2 = api.snapTile(11, size);
  ok(c2 - c1 === size, "teselas vecinas separadas exactamente por el tamaño: " + (c2 - c1));
  ok(c1 + half <= c2 - half, "las ventanas no se solapan (a lo sumo se tocan)");
}

/* ---- ELEV_TILE_WEB / ELEV_TILE_GEO: coherentes con su latitud de referencia ---- */
ok(Math.abs(api.ELEV_TILE_WEB - 2 * api.webMercatorHalf(40, api.ELEV_WINDOW)) < 1e-9,
   "ELEV_TILE_WEB es 2x la media ventana Web Mercator a 40°N");
ok(Math.abs(api.ELEV_TILE_GEO.lat - 2 * (api.ELEV_WINDOW / 111320)) < 1e-12,
   "ELEV_TILE_GEO.lat coherente con ELEV_WINDOW en metros");
ok(api.ELEV_TILE_GEO.lon > api.ELEV_TILE_GEO.lat,
   "a 40°N la longitud necesita más grados que la latitud para los mismos metros");

/* ---- buildElevCells: registros autocontenidos, emparejados por posición ---- */
{
  const terrain = { ...api.parseAsciiGrid(
    "ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 10\nNODATA_value -9999\n" +
    "10 20\n30 40\n"), crs: "geo" };
  /* La malla de superficie está DESPLAZADA: no empieza en el mismo punto,
     así que el emparejamiento debe ser por posición, no por índice.   */
  const surface = { ...api.parseAsciiGrid(
    "ncols 3\nnrows 3\nxllcorner -5\nyllcorner -5\ncellsize 10\nNODATA_value -9999\n" +
    "1 2 3\n4 5 6\n7 8 9\n"), crs: "geo" };

  const built = api.buildElevCells(terrain, surface);
  ok(built && built.cells.length === 4, "una celda por cada celda del MDT (referencia): " + (built && built.cells.length));
  ok(built.role === "terrain", "el papel es el de la malla que manda en la geometría");
  const cell = built.cells.find(c => c.mdt === 40); /* esquina sureste del MDT */
  ok(cell && typeof cell.mds === "number", "el MDS se muestrea por posición, no por índice: " + JSON.stringify(cell));
  ok(built.cells.every(c => Array.isArray(c.sw) && Array.isArray(c.ne) && Array.isArray(c.center)),
     "cada celda trae sus esquinas y centro en lat/lng, autocontenidos");

  /* Sin MDS en absoluto: diff siempre null, sin inventar nada */
  const builtNoSurface = api.buildElevCells(terrain, null);
  ok(builtNoSurface.cells.every(c => c.diff === null && c.mds === null),
     "sin malla de superficie, diff y mds son null, no se interpola");

  /* MDS que no llega a cubrir ninguna celda del MDT: también null */
  const farSurface = { ...api.parseAsciiGrid(
    "ncols 1\nnrows 1\nxllcorner 1000\nyllcorner 1000\ncellsize 10\n700\n"), crs: "geo" };
  const builtFar = api.buildElevCells(terrain, farSurface);
  ok(builtFar.cells.every(c => c.mds === null && c.diff === null),
     "MDS fuera de la zona del MDT: sin dato, no falso cero");
}

/* ---- elevTileKey: exacta por esquina, no aproximada ---- */
{
  const gA = { crs: "geo", xll: 100, yll: 200 };
  const gA2 = { crs: "geo", xll: 100, yll: 200 }; /* misma esquina, otra instancia */
  const gB = { crs: "geo", xll: 100.03, yll: 200 }; /* esquina ligeramente distinta */
  const builtT1 = { role: "terrain", grid: gA, cells: [] };
  const builtT2 = { role: "terrain", grid: gA2, cells: [] };
  const builtS1 = { role: "surface", grid: gA, cells: [] };
  const builtT3 = { role: "terrain", grid: gB, cells: [] };

  ok(api.elevTileKey(builtT1) === api.elevTileKey(builtT2),
     "misma ventana (misma esquina) ⇒ misma clave, aunque sean objetos distintos");
  ok(api.elevTileKey(builtT1) !== api.elevTileKey(builtS1),
     "mismo punto pero distinto papel (MDT/MDS) ⇒ claves distintas, sin cruzarse");
  ok(api.elevTileKey(builtT1) !== api.elevTileKey(builtT3),
     "esquina distinta (aunque sea por poco) ⇒ clave distinta: " +
     `${api.elevTileKey(builtT1)} / ${api.elevTileKey(builtT3)}`);
}

/* ---- elevZoomBand: qué se dibuja según el zoom ---- */
ok(api.elevZoomBand(18) === "mini", "18: sin texto");
ok(api.elevZoomBand(10) === "mini", "muy alejado: también sin texto");
ok(api.elevZoomBand(19) === "diff", "19: solo la diferencia");
ok(api.elevZoomBand(20) === "full", "20: las tres líneas");
ok(api.elevZoomBand(25) === "full", "zoom máximo: las tres líneas");
/* Leaflet reporta zoom fraccionario durante animaciones; elevZoomBand
   redondea (Math.round), no trunca, antes de comparar los umbrales   */
ok(api.elevZoomBand(18.4) === "mini", "18.4 redondea a 18: sin texto");
ok(api.elevZoomBand(18.6) === "diff", "18.6 redondea a 19: solo diferencia");

/* ---- isElevAlert: umbral estricto, siempre en metros ---- */
ok(api.isElevAlert({ diff: 1.01 }) === true, "1.01 m > 1 m: aviso");
ok(api.isElevAlert({ diff: 1 }) === false, "exactamente 1 m: NO es aviso (estricto)");
ok(api.isElevAlert({ diff: 0.99 }) === false, "0.99 m: sin aviso");
ok(api.isElevAlert({ diff: -5 }) === false, "diferencia negativa: sin aviso");
ok(api.isElevAlert({ diff: null }) === false, "sin dato: sin aviso");

/* ---- toElevUnit: conversión pura m→ft, independiente del estado global ---- */
ok(api.toElevUnit(10, "m") === 10, "en metros, identidad");
ok(Math.abs(api.toElevUnit(1, "ft") - 1 / api.METERS_PER_FOOT) < 1e-12,
   "en pies, se divide por METERS_PER_FOOT (0.3048)");
ok(Math.abs(api.toElevUnit(0.3048, "ft") - 1) < 1e-9, "0.3048 m es 1 ft");
ok(api.toElevUnit(-5, "m") === -5, "negativos también, sin tocar el signo");

/* ---- pointInCell: punto-en-rectángulo sobre un registro de celda ---- */
{
  const cell = { sw: [40.0, -3.7], ne: [40.001, -3.699] };
  ok(api.pointInCell(cell, 40.0005, -3.6995) === true, "centro de la celda: dentro");
  ok(api.pointInCell(cell, 40.0, -3.7) === true, "esquina SW incluida (borde cerrado)");
  ok(api.pointInCell(cell, 40.001, -3.699) === true, "esquina NE incluida (borde cerrado)");
  ok(api.pointInCell(cell, 39.999, -3.6995) === false, "al sur, fuera");
  ok(api.pointInCell(cell, 40.0005, -3.701) === false, "al oeste, fuera");
  /* sw/ne no siempre vienen en el orden "menor primero": pointInCell no
     debe asumirlo (usa Math.min/max internamente)                    */
  const swapped = { sw: [40.001, -3.699], ne: [40.0, -3.7] };
  ok(api.pointInCell(swapped, 40.0005, -3.6995) === true,
     "funciona igual con sw/ne intercambiados");
}

if (!process.exitCode) console.log("ELEVATION TESTS OK");
