const { DOMParser } = require("@xmldom/xmldom");
const { fn, between } = require("./_extract");
const helpers = between("/* Nombre sin prefijo", "/* KML usa color");
const fonts = between("const GRID_FONT_BASE", "const elevGridGroups");
/* ELEV_WINDOW se define antes del resto de constantes de elevación, pero
   la retícula fija (ELEV_TILE_WEB/ELEV_TILE_GEO, dentro del tramo
   webMercatorHalf→parseCoverageDescription) la necesita al evaluarse. */
const elevWindow = between("const ELEV_WINDOW", "const ELEV_CELL");
const consts = fonts + elevWindow
  + between("const ELEV_GEO_CRS", "function toWebMercator")
  + between("const webMercatorHalf", "function parseCoverageDescription");
/* Unidades y formato de alturas (51-geodesy.js): fmtCell/fmtDiff y el
   cuadro de coordenadas escriben en la unidad global measureUnit, que
   aquí se fija desde la prueba con setUnit.                          */
const units = between("const METERS_PER_NM", "/* ---------- Ángulo de elevación");
const arrows = [
  between("const isOutOfCoverage", "/* Rejilla ASCII de ESRI"),
  between("const elevValue", "/* La misma rejilla que parseAsciiGrid"),
  between("const pickDeaDemCoverage", "/* ---------- Catálogo de fuentes"),
  between("const ELEV_SOURCES = [", "/* Valida lo leído"),
  between("const ELEV_KIND_LABEL", "function describeElevChoice"),
  between("const hasMdt", "/* Contenido de una celda")
].join("\n");
const src = "const parserErrorText = () => null;\nconst toRad = d => d * Math.PI / 180;\n"
  + "let measureUnit = 'm'; const setUnit = u => { measureUnit = u; };\n"
  + helpers + units + consts + arrows + "\n" +
  [fn("parseWcsCapabilities"), fn("pickMdtCoverage"), fn("pickMdsCoverage"),
   fn("parseCoverageDescription"), fn("coverageCellMeters"), fn("pickFinestCoverage"),
   fn("describeElevChoice"), fn("validElevSources"), fn("parseOwsException"),
   fn("parseAsciiGrid"), fn("gridFromRaster"), fn("gridCellBounds"), fn("gridToLatLng"),
   fn("buildElevCells"), fn("elevCellHtml"), fn("pointInCell"), fn("sessionStamp"),
   fn("text")].join("\n");
const apiExports = "\nreturn {parseWcsCapabilities, pickMdtCoverage, pickMdsCoverage, pickDeaDemCoverage," +
  " pickGeoCrs, pickElevFormat, parseCoverageDescription, pickFinestCoverage, describeElevChoice," +
  " validElevSources, ELEV_SOURCES, ELEV_SOURCE_DEFAULT, isOutOfCoverage, parseOwsException," +
  " parseAsciiGrid, gridFromRaster, pickWebMercator, webMercatorHalf, gridCellBounds, gridFontSize," +
  " gridIconSize, snapTile, latticeKey, ELEV_TILE_WEB, ELEV_TILE_GEO, ELEV_WINDOW, gridToLatLng," +
  " buildElevCells, elevCellHtml, elevZoomBand, isElevAlert, pointInCell, sessionStamp," +
  " fmtHeight, fmtHeightValue, setUnit};";
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
ok(Object.keys(parsed.bboxes).length === 0, "sin WGS84BoundingBox no se inventa ninguna caja");

/* Del nombre se toman solo las de malla más fina (las de 5 m, en
   cualquier sistema), con las geográficas primero: la decisión final
   entre ellas la toma pickFinestCoverage con sus descripciones.      */
const cand = api.pickMdtCoverage(ids);
ok(cand.length === 3 && cand.every(id => /_5$/.test(id)), "candidatas: las tres de 5 m: " + cand);
ok(cand[0] === "Elevacion4258_5", "la geográfica de 5 m, la primera: " + cand[0]);
ok(api.pickMdtCoverage(["Elevacion25830_5","Elevacion4258_25"]).join() === "Elevacion25830_5",
   "la malla manda sobre el sistema");
ok(api.pickMdtCoverage(["Elevacion4083_25","Elevacion4258_25"])[0] === "Elevacion4258_25",
   "a igual malla, gana el geográfico");
ok(api.pickMdtCoverage(["otraCosa"]).join() === "otraCosa", "si no siguen el patrón, se ofrecen tal cual");
ok(api.pickMdtCoverage([]).length === 0, "sin coberturas, ninguna candidata");

/* El MDS sigue evitando las normalizadas */
ok(api.pickMdsCoverage(["mdsn_e025","mds05","mdsn_v025"]).join() === "mds05", "MDS absoluto");
ok(api.pickMdsCoverage(["mdsn_e025"]).join() === "mdsn_e025", "si solo hay normalizadas, se ofrecen (mejor que nada)");

/* ---- formatos: ASCII siempre primero; GeoTIFF solo si no hay ASCII ---- */
const realFormats = ["image/tiff","ArcGrid","application/asc","image/png","image/jpeg",
  "image/gif","image/png; mode=8bit","GEOTIFFINT16","GEOTIFF_RGB"];
let f = api.pickElevFormat(realFormats);
ok(f.name === "ArcGrid" && f.kind === "ascii", "con ASCII disponible se elige ASCII aunque haya TIFF: " + JSON.stringify(f));
ok(api.pickElevFormat(realFormats.filter(x => x !== "ArcGrid")).name === "application/asc", "alternativa del IGN");
f = api.pickElevFormat(["image/geotiff", "application/x-netcdf"]);
ok(f && f.name === "image/geotiff" && f.kind === "geotiff", "Digital Earth Africa: GeoTIFF, que sí se lee: " + JSON.stringify(f));
ok(api.pickElevFormat(["image/png", "application/x-netcdf"]) === null, "ni ASCII ni GeoTIFF → null, se avisa");
ok(api.pickElevFormat(["GEOTIFF_RGB", "image/png"]) === null, "un GeoTIFF de color no es una rejilla de alturas");
ok(api.pickElevFormat([]) === null, "lista vacía");

/* ---- CRS: forma URL (IGN) y forma corta (Digital Earth Africa) ---- */
const crsReal = ["http://www.opengis.net/def/crs/EPSG/0/25830",
  "http://www.opengis.net/def/crs/EPSG/0/4258","http://www.opengis.net/def/crs/EPSG/0/4326"];
ok(api.pickGeoCrs(crsReal).endsWith("/4326"), "WGS84 geográfico primero");
ok(api.pickGeoCrs(["http://www.opengis.net/def/crs/EPSG/0/25830"]) === null, "solo proyectados → null");
const crsDea = ["EPSG:3857", "EPSG:4326", "EPSG:6933"];
ok(api.pickGeoCrs(crsDea) === "EPSG:4326", "forma corta geográfica: " + api.pickGeoCrs(crsDea));
ok(api.pickWebMercator(crsDea) === "EPSG:3857", "forma corta Web Mercator: " + api.pickWebMercator(crsDea));
ok(!api.pickWebMercator(["EPSG:38571"]), "forma corta: no confunde códigos parecidos");

/* ---- descripción de la cobertura: ejes por nombre, no por orden ---- */
const desc = ejes => `<?xml version="1.0"?><wcs:CoverageDescriptions xmlns:wcs="http://www.opengis.net/wcs/2.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"><gml:Envelope srsName="http://www.opengis.net/def/crs/EPSG/0/25830"
   axisLabels="${ejes}"><gml:lowerCorner>${ejes === "x y" ? "-16000 3900000" : "3900000 -16000"}</gml:lowerCorner>
   <gml:upperCorner>${ejes === "x y" ? "1200000 4900000" : "4900000 1200000"}</gml:upperCorner></gml:Envelope></wcs:CoverageDescriptions>`;
let cfg = api.parseCoverageDescription(desc("x y"));
ok(cfg.axisX === "x" && cfg.axisY === "y" && cfg.zone === 30, "ejes x/y y huso 30");
ok(cfg.minX === -16000 && cfg.maxY === 4900000, "extensión asociada a cada eje");
ok(cfg.cellMeters === null, "sin malla descrita, tamaño de celda desconocido (null), no inventado");
cfg = api.parseCoverageDescription(desc("N E"));
ok(cfg.axisX === "E" && cfg.axisY === "N", "convención N/E entendida igual");
ok(cfg.minX === -16000 && cfg.maxY === 4900000, "y su extensión también");
ok(api.parseCoverageDescription("<x/>") === null, "sin envolvente, null");

/* Malla con offsetVector (RectifiedGrid): el paso de cada eje, en metros */
const rectified = `<?xml version="1.0"?><wcs:CoverageDescriptions xmlns:wcs="http://www.opengis.net/wcs/2.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"><gml:Envelope srsName="http://www.opengis.net/def/crs/EPSG/0/25830"
  axisLabels="x y"><gml:lowerCorner>0 4000000</gml:lowerCorner><gml:upperCorner>100000 4100000</gml:upperCorner></gml:Envelope>
  <gml:domainSet><gml:RectifiedGrid dimension="2"><gml:axisLabels>x y</gml:axisLabels>
  <gml:offsetVector>5 0</gml:offsetVector><gml:offsetVector>0 -5</gml:offsetVector></gml:RectifiedGrid></gml:domainSet>
  </wcs:CoverageDescriptions>`;
ok(api.parseCoverageDescription(rectified).cellMeters === 5, "offsetVector: celda de 5 m: "
   + api.parseCoverageDescription(rectified).cellMeters);

/* DescribeCoverage REAL de Digital Earth Africa (dem_cop_30), recortado:
   extensión con dimensión de tiempo, ejes `latitude longitude`, y malla
   sin offsetVector (solo GridLimits, con un tercer eje de tiempo).  */
const deaDesc = `<wcs:CoverageDescriptions xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:wcs="http://www.opengis.net/wcs/2.0">
<wcs:CoverageDescription gml:id="dem_cop_30"><gml:boundedBy><gml:EnvelopeWithTimePeriod srsName="EPSG:4326" srsDimension="2"
 axisLabels="latitude longitude" uomLabels="deg deg" frame="ISO-8601"><gml:lowerCorner>-46.9998611111111 -26.0001388888889</gml:lowerCorner>
 <gml:upperCorner>39.0001388888889 64.9998611111111</gml:upperCorner><gml:beginPosition>1900-01-01T00:00:00.000Z</gml:beginPosition>
 <gml:endPosition>1900-01-01T00:00:00.000Z</gml:endPosition></gml:EnvelopeWithTimePeriod></gml:boundedBy>
 <wcs:CoverageId>dem_cop_30</wcs:CoverageId><gml:domainSet><gml:Grid gml:id="dem_cop_30__grid" dimension="3" srsName="EPSG:4326">
 <gml:limits><gml:GridLimits><gml:low>0 0 0</gml:low><gml:high>309600 327600 1</gml:high></gml:GridLimits></gml:limits>
 <gml:axisLabels>latitude longitude time</gml:axisLabels></gml:Grid></gml:domainSet></wcs:CoverageDescription></wcs:CoverageDescriptions>`;
const dea = api.parseCoverageDescription(deaDesc);
ok(dea, "EnvelopeWithTimePeriod se lee como la extensión");
ok(dea.geographic && dea.axisX === "longitude" && dea.axisY === "latitude", "ejes por nombre: " + JSON.stringify(dea));
ok(dea.minX < -25.9 && dea.maxX > 64.9 && dea.minY < -46.9 && dea.maxY > 39, "extensión en su eje");
ok(dea.cellMeters > 27 && dea.cellMeters < 32, "celda de ~30 m desde GridLimits y la extensión: " + dea.cellMeters);

/* ---- elegir entre candidatas: la de celda más fina ---- */
const descOf = (cellMeters, geographic = false) => ({ cellMeters, geographic });
ok(api.pickFinestCoverage([{ id: "a", desc: descOf(25) }, { id: "b", desc: descOf(5) },
  { id: "c", desc: descOf(1000) }]).id === "b", "se queda con la de 5 m");
ok(api.pickFinestCoverage([{ id: "utm", desc: descOf(5) }, { id: "geo", desc: descOf(5.2, true) }]).id === "geo",
   "a igualdad (medio metro de tolerancia), la geográfica");
ok(api.pickFinestCoverage([{ id: "x", desc: descOf(null) }, { id: "y", desc: descOf(30) }]).id === "y",
   "sin tamaño de celda cuenta como la peor");
ok(api.pickFinestCoverage([{ id: "x", desc: null }, { id: "y", desc: descOf(30) }]).id === "y",
   "una candidata que no se pudo describir se descarta");
ok(api.pickFinestCoverage([{ id: "x", desc: null }]) === null, "ninguna descrita → null");

/* ---- capacidades de Digital Earth Africa: cajas WGS84 y su cobertura ---- */
const deaCaps = `<wcs:Capabilities xmlns:ows="http://www.opengis.net/ows/2.0" xmlns:wcs="http://www.opengis.net/wcs/2.0"
  xmlns:crs="http://www.opengis.net/wcs/crs/1.0"><wcs:ServiceMetadata><wcs:formatSupported>image/geotiff</wcs:formatSupported>
  <wcs:formatSupported>application/x-netcdf</wcs:formatSupported><wcs:Extension><crs:CrsMetadata>
  <crs:crsSupported>EPSG:3857</crs:crsSupported><crs:crsSupported>EPSG:4326</crs:crsSupported></crs:CrsMetadata></wcs:Extension>
  </wcs:ServiceMetadata><wcs:Contents>
  <wcs:CoverageSummary><ows:Title>Cropland extent 2019</ows:Title><ows:WGS84BoundingBox dimension="2">
  <ows:LowerCorner>-17.9 -35.2</ows:LowerCorner><ows:UpperCorner>58.7 38.0</ows:UpperCorner></ows:WGS84BoundingBox>
  <wcs:CoverageId>crop_mask</wcs:CoverageId></wcs:CoverageSummary>
  <wcs:CoverageSummary><ows:Title>Copernicus Digital Elevation Model (30 m)</ows:Title><ows:WGS84BoundingBox dimension="2">
  <ows:LowerCorner>-26.0001388888889 -46.9998611111111</ows:LowerCorner><ows:UpperCorner>64.9998611111111 39.0001388888889</ows:UpperCorner>
  </ows:WGS84BoundingBox><wcs:CoverageId>dem_cop_30</wcs:CoverageId></wcs:CoverageSummary>
  <wcs:CoverageSummary><wcs:CoverageId>nasadem</wcs:CoverageId></wcs:CoverageSummary></wcs:Contents></wcs:Capabilities>`;
const dcaps = api.parseWcsCapabilities(deaCaps);
ok(dcaps.coverages.length === 3, "tres coberturas");
const bb = dcaps.bboxes.dem_cop_30;
ok(bb && bb.west < -25.9 && bb.east > 64.9 && bb.south < -46.9 && bb.north > 39, "caja WGS84 en orden longitud latitud: " + JSON.stringify(bb));
ok(!dcaps.bboxes.nasadem, "sin caja declarada, sin entrada");
ok(api.pickDeaDemCoverage(dcaps.coverages).join() === "dem_cop_30", "de todo el catálogo, solo Copernicus DEM");
ok(api.pickDeaDemCoverage(["crop_mask"]).length === 0, "sin Copernicus DEM, ninguna candidata (no la primera que haya)");
/* Canarias dentro, Madrid fuera: lo que decide no pedir en vano */
const inside = (b, lat, lon) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
ok(inside(bb, 28.3, -16.5), "Tenerife cae dentro de la cobertura");
ok(!inside(bb, 40.4, -3.7), "Madrid queda fuera (por encima de 39°N)");

/* ---- lo elegido, en una línea para el registro de avisos ---- */
const ign = api.ELEV_SOURCES.find(s => s.id === "ign-mdt");
const deaSrc = api.ELEV_SOURCES.find(s => s.id === "dea-cop30");
let line = api.describeElevChoice(ign, { coverageId: "Elevacion4258_5", format: { name: "ArcGrid", kind: "ascii" }, cellMeters: 5 });
ok(/^MDT \(terreno\) · IGN/.test(line) && /Elevacion4258_5/.test(line) && /ArcGrid \(rejilla ASCII\)/.test(line)
   && /celda ≈ 5\.0 m/.test(line), "aviso del MDT: " + line);
line = api.describeElevChoice(deaSrc, { coverageId: "dem_cop_30", format: { name: "image/geotiff", kind: "geotiff" }, cellMeters: 30.9 });
ok(/^MDS \(superficie\) · Digital Earth Africa/.test(line) && /no ofrece rejilla ASCII/.test(line) && /celda ≈ 31 m/.test(line),
   "aviso de Digital Earth Africa: " + line);
ok(/no declarado/.test(api.describeElevChoice(ign, { coverageId: "x", format: { name: "ArcGrid", kind: "ascii" }, cellMeters: null })),
   "sin celda conocida, se dice");

/* ---- catálogo ---- */
const catIds = api.ELEV_SOURCES.map(s => s.id);
ok(new Set(catIds).size === catIds.length, "ids únicos: " + catIds);
ok(api.ELEV_SOURCES.every(s => (s.kind === "mdt" || s.kind === "mds") && /^https:\/\//.test(s.base)
   && typeof s.pickCoverage === "function" && s.label && s.attrib), "cada fuente completa, https y con atribución");
ok(api.ELEV_SOURCES.filter(s => s.kind === "mds").length >= 2, "al menos dos MDS (IGN y Digital Earth Africa)");
ok(api.ELEV_SOURCE_DEFAULT.mdt === "ign-mdt" && api.ELEV_SOURCE_DEFAULT.mds === "ign-mds", "por defecto, las del IGN");
for (const k of ["mdt", "mds"]) {
  const s = api.ELEV_SOURCES.find(x => x.id === api.ELEV_SOURCE_DEFAULT[k]);
  ok(s && s.kind === k, `la fuente por defecto de ${k} es de ese tipo`);
}

/* ---- validar la elección guardada contra el catálogo actual ---- */
ok(JSON.stringify(api.validElevSources({ mdt: "ign-mdt", mds: "dea-cop30" })) === '{"mdt":"ign-mdt","mds":"dea-cop30"}',
   "una elección válida se respeta");
ok(JSON.stringify(api.validElevSources({ mdt: null, mds: null })) === '{"mdt":null,"mds":null}',
   "«Ninguna» en las dos es legítimo");
ok(api.validElevSources({ mdt: "retirada", mds: "ign-mds" }).mdt === "ign-mdt", "una fuente retirada vuelve a la de por defecto");
ok(api.validElevSources({ mdt: "ign-mds", mds: "ign-mdt" }).mdt === "ign-mdt", "un MDS en el hueco del MDT no se cuela");
ok(api.validElevSources(null) === null && api.validElevSources("x") === null, "sin forma de elección → null");

/* ---- errores OGC, que llegan como XML ---- */
const exml = code => `<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/2.0">
  <ows:Exception exceptionCode="${code}"><ows:ExceptionText>fallo ${code}</ows:ExceptionText>
  </ows:Exception></ows:ExceptionReport>`;
ok(api.parseOwsException(exml("ExtentError")).code === "ExtentError", "código leído");
ok(api.parseOwsException(exml("InvalidParameterValue")).msg.includes("fallo"), "texto leído");
ok(api.parseOwsException("ncols 3\n695.3") === null, "una rejilla no es una excepción");
ok(api.parseAsciiGrid(exml("ExtentError")) === null, "el XML de error no se lee como altitud");
/* Fuera de cobertura: el IGN dice ExtentError, Digital Earth Africa
   InvalidSubsetting (con HTTP 404). Los dos son «sin dato».         */
ok(api.isOutOfCoverage({ owsCode: "ExtentError" }), "ExtentError = fuera de cobertura");
ok(api.isOutOfCoverage({ owsCode: "InvalidSubsetting" }), "InvalidSubsetting = fuera de cobertura");
ok(!api.isOutOfCoverage({ owsCode: "InvalidParameterValue" }), "otro error NO es falta de cobertura");
ok(!api.isOutOfCoverage(new Error("Failed to fetch")) && !api.isOutOfCoverage(null), "sin código, no");

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

/* ---- rejilla desde un ráster GeoTIFF ya decodificado ----
   Es el caso real de Digital Earth Africa: 2x2 celdas de 26 m en
   EPSG:3857, origen en la esquina SUPERIOR izquierda, resolución con
   la y negativa y huecos como NaN.                                  */
{
  const r = api.gridFromRaster({
    width: 2, height: 2, origin: [-1810052, 3307052, 0], resolution: [26, -26, 0],
    data: Float32Array.from([53.68, NaN, 54.1, -32767]), nodata: -32767
  });
  ok(r && r.cols === 2 && r.rows === 2 && r.cellX === 26 && r.cellY === 26, "dimensiones y celda: " + JSON.stringify(r));
  ok(r.xll === -1810052 && r.yll === 3307052 - 52, "esquina INFERIOR izquierda desde el origen superior: " + r.yll);
  ok(Math.abs(r.values[0][0] - 53.68) < 1e-4, "primera fila = la de arriba (norte)");
  ok(r.values[0][1] === null, "NaN es hueco, no altitud");
  ok(r.values[1][1] === null, "el NODATA declarado también");
  ok(r.located, "ubicable");
  ok(api.gridFromRaster({ width: 2, height: 2, origin: [0, 0], resolution: [1, -1], data: [1, 2] }) === null,
     "faltan datos → null");
  ok(api.gridFromRaster({ width: 1, height: 1, origin: [0, 0], resolution: [0, 0], data: [1] }) === null,
     "resolución nula → null");
}

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
ok(bLast.x1 - b0.x0 === geo.cols * geo.cellX, "anchura total = columnas x celda");
ok(b0.y1 - b3.y0 === geo.rows * geo.cellY, "altura total = filas x celda");

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

/* ---- Retícula fija de peticiones: snapTile no debe solapar teselas ---- */
ok(api.snapTile(5, 10) === 5, "el centro de la primera tesela es el propio tamaño/2: " + api.snapTile(5, 10));
ok(api.snapTile(9.9, 10) === 5, "todavía dentro de la tesela [0,10)");
ok(api.snapTile(10, 10) === 15, "justo en el borde, ya es la tesela siguiente");
ok(api.snapTile(-1, 10) === -5, "también funciona con negativos: " + api.snapTile(-1, 10));
{
  const size = 10, half = size / 2;
  const c1 = api.snapTile(4, size), c2 = api.snapTile(11, size);
  ok(c2 - c1 === size, "teselas vecinas separadas exactamente por el tamaño: " + (c2 - c1));
  ok(c1 + half <= c2 - half, "las ventanas no se solapan (a lo sumo se tocan)");
}

/* ---- latticeKey: dos consultas en la misma tesela son la MISMA ---- */
{
  const T = api.ELEV_TILE_WEB;
  ok(api.latticeKey(0.1, 0.1) === api.latticeKey(T - 0.1, T - 0.1), "dos puntos de la misma tesela, misma clave");
  ok(api.latticeKey(0.1, 0.1) !== api.latticeKey(T + 0.1, 0.1), "la tesela vecina, otra clave");
  ok(api.latticeKey(-0.1, 0.1) !== api.latticeKey(0.1, 0.1), "a ambos lados del origen, teselas distintas");
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

  /* MDS consultado pero sin dato: la clave está, con null */
  const builtNoSurface = api.buildElevCells(terrain, null);
  ok(builtNoSurface.cells.every(c => c.diff === null && "mds" in c && c.mds === null),
     "MDS consultado sin respuesta: mds null (clave presente), diff null, no se interpola");

  /* MDS en «Ninguna»: la celda NO lleva la clave, ni diferencia */
  const onlyT = api.buildElevCells(terrain, null, { mdt: true, mds: false });
  ok(onlyT.cells.every(c => !("mds" in c) && "mdt" in c && c.diff === null),
     "MDS no consultado: sin clave mds; " + JSON.stringify(onlyT.cells[0]));
  /* Solo MDS (MDT en «Ninguna»): la superficie manda en la geometría */
  const onlyS = api.buildElevCells(null, surface, { mdt: false, mds: true });
  ok(onlyS.role === "surface" && onlyS.cells.length === 9 && onlyS.cells.every(c => !("mdt" in c) && "mds" in c),
     "solo MDS: nueve celdas de la superficie, sin clave mdt");
  /* La distinción sobrevive a guardar (JSON quita lo que no está) */
  const back = JSON.parse(JSON.stringify(onlyT.cells[0]));
  ok(!("mds" in back) && "mdt" in back, "tras JSON sigue sin clave mds");

  /* MDS que no llega a cubrir ninguna celda del MDT: también null */
  const farSurface = { ...api.parseAsciiGrid(
    "ncols 1\nnrows 1\nxllcorner 1000\nyllcorner 1000\ncellsize 10\n700\n"), crs: "geo" };
  const builtFar = api.buildElevCells(terrain, farSurface);
  ok(builtFar.cells.every(c => c.mds === null && c.diff === null),
     "MDS fuera de la zona del MDT: sin dato, no falso cero");
  ok(api.buildElevCells(null, null) === null, "sin ninguna rejilla, nada que dibujar");
}

/* ---- elevCellHtml: solo las líneas de lo consultado, en la unidad global ---- */
{
  api.setUnit("m");
  const both = { mdt: 100, mds: 102.5, diff: 2.5 };
  let h = api.elevCellHtml(both, "full");
  ok(/ec-t">100\.0</.test(h) && /ec-s">102\.5</.test(h) && /ec-d alert">\+2\.5</.test(h),
     "las tres líneas, con el aviso: " + h);
  ok(api.elevCellHtml(both, "diff") === '<span class="ec-d alert">+2.5</span>', "zoom 19: solo la diferencia");
  ok(api.elevCellHtml(both, "mini") === "", "zoom bajo: sin texto");
  h = api.elevCellHtml({ mdt: 100, diff: null }, "full");
  ok(h === '<span class="ec-t">100.0</span>', "solo MDT: una línea, sin diferencia: " + h);
  ok(api.elevCellHtml({ mds: 7, diff: null }, "diff") === '<span class="ec-s">7.0</span>',
     "solo MDS a zoom 19: su valor, no una diferencia vacía");
  ok(/ec-s">—</.test(api.elevCellHtml({ mdt: 1, mds: null, diff: null }, "full")), "consultado sin dato: raya");
  api.setUnit("ft");
  ok(/ec-t">328\.1</.test(api.elevCellHtml({ mdt: 100, diff: null }, "full")), "en pies: 100 m = 328,1 ft");
  api.setUnit("nm");
  ok(/ec-d alert">\+0\.0013</.test(api.elevCellHtml(both, "diff")), "en NM, cuatro decimales para que +2,5 m no sea 0");
  api.setUnit("m");
}

/* ---- fmtHeight: la unidad global de Propiedades ---- */
ok(api.fmtHeight(695.32, "m") === "695.3 m", api.fmtHeight(695.32, "m"));
ok(api.fmtHeight(100, "ft") === "328.1 ft", api.fmtHeight(100, "ft"));
ok(api.fmtHeight(1852, "nm") === "1.0000 NM", api.fmtHeight(1852, "nm"));
ok(api.fmtHeight(1609.344, "mi") === "1.0000 mi", api.fmtHeight(1609.344, "mi"));
ok(api.fmtHeight(2500, "km") === "2.5000 km", api.fmtHeight(2500, "km"));
ok(api.fmtHeightValue(-3.04, "m") === "-3.0", "negativos sin unidad: " + api.fmtHeightValue(-3.04, "m"));

/* ---- elevZoomBand: qué se dibuja según el zoom ---- */
ok(api.elevZoomBand(18) === "mini", "18: sin texto");
ok(api.elevZoomBand(10) === "mini", "muy alejado: también sin texto");
ok(api.elevZoomBand(19) === "diff", "19: solo la diferencia");
ok(api.elevZoomBand(20) === "full", "20: las tres líneas");
ok(api.elevZoomBand(25) === "full", "zoom máximo: las tres líneas");
ok(api.elevZoomBand(18.4) === "mini", "18.4 redondea a 18: sin texto");
ok(api.elevZoomBand(18.6) === "diff", "18.6 redondea a 19: solo diferencia");

/* ---- isElevAlert: umbral estricto, siempre en metros ---- */
ok(api.isElevAlert({ diff: 1.01 }) === true, "1.01 m > 1 m: aviso");
ok(api.isElevAlert({ diff: 1 }) === false, "exactamente 1 m: NO es aviso (estricto)");
ok(api.isElevAlert({ diff: 0.99 }) === false, "0.99 m: sin aviso");
ok(api.isElevAlert({ diff: -5 }) === false, "diferencia negativa: sin aviso");
ok(api.isElevAlert({ diff: null }) === false, "sin dato: sin aviso");

/* ---- pointInCell: punto-en-rectángulo sobre un registro de celda ---- */
{
  const cell = { sw: [40.0, -3.7], ne: [40.001, -3.699] };
  ok(api.pointInCell(cell, 40.0005, -3.6995) === true, "centro de la celda: dentro");
  ok(api.pointInCell(cell, 40.0, -3.7) === true, "esquina SW incluida (borde cerrado)");
  ok(api.pointInCell(cell, 40.001, -3.699) === true, "esquina NE incluida (borde cerrado)");
  ok(api.pointInCell(cell, 39.999, -3.6995) === false, "al sur, fuera");
  ok(api.pointInCell(cell, 40.0005, -3.701) === false, "al oeste, fuera");
  const swapped = { sw: [40.001, -3.699], ne: [40.0, -3.7] };
  ok(api.pointInCell(swapped, 40.0005, -3.6995) === true,
     "funciona igual con sw/ne intercambiados");
}

/* ---- nombre de la carpeta de sesión ---- */
ok(api.sessionStamp(new Date(2026, 9, 5, 7, 3)) === "2026-10-05 07:03",
   "fecha y hora locales con ceros: " + api.sessionStamp(new Date(2026, 9, 5, 7, 3)));

if (!process.exitCode) console.log("ELEVATION TESTS OK");
