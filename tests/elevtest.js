const { DOMParser } = require("@xmldom/xmldom");
const { fn, between } = require("./_extract");
const helpers = between("/* Nombre sin prefijo", "/* KML usa color");
const fonts = between("const GRID_FONT_BASE", "const elevGridGroups");
/* ELEV_WINDOW se define antes del resto de constantes de elevación, pero
   la retícula fija (ELEV_TILE_WEB/ELEV_TILE_GEO, dentro del tramo
   webMercatorHalf→parseCoverageDescription) la necesita al evaluarse. */
const elevWindow = between("const ELEV_WINDOW", "const ELEV_CELL");
const consts = fonts + elevWindow
  + between("const ELEV_RETRIES", "const demTimes")
  + between("const ELEV_GEO_CRS", "function toWebMercator")
  + between("const webMercatorHalf", "function parseCoverageDescription");
/* Unidades y formato de alturas (51-geodesy.js): fmtCell/fmtDiff y el
   cuadro de coordenadas escriben en la unidad de ALTITUD altitudeUnit,
   que aquí se fija desde la prueba con setUnit.                       */
const units = between("const METERS_PER_NM", "/* ---------- Ángulo de elevación");
const arrows = [
  between("const isOutOfCoverage", "/* Rejilla ASCII de ESRI"),
  between("const elevValue", "/* La misma rejilla que parseAsciiGrid"),
  between("const mdtCoverages", "/* El MDS del IGN publica"),
  between("const pickDeaDemCoverage", "/* ---------- Catálogo de fuentes"),
  between("const IGN_MDT_BASE", "/* Valida lo leído"),
  between("const elevNodeName", "/* ---------- Cuadrícula de elevaciones"),
  between("const ELEV_KIND_LABEL", "function describeElevChoice"),
  between("const elevTileFactor", "/* La señal de UN intento"),
  between("const hasMdt", "/* Contenido de una celda"),
  /* Preferencias: unidad de altitud y límite del perfil (validación) */
  between("const MEASURE_UNITS", "async function dbSaveMeasureUnit"),
  between("const PROFILE_MAX_DEFAULT", "let profileMaxM"),
  between("const ALTITUDE_UNIT_KEY", "async function dbSaveAltitudeUnit"),
  between("const PROFILE_MAX_KEY", "async function dbSaveProfileMax"),
  /* Perfil de una ruta (63-route-profile.js), solo lo puro */
  between("const PROFILE_CHUNK_CELLS", "/* ---------- Cálculo"),
  between("const tickDecimals", "/* Tramos continuos"),
  between("const packProfilePoints", "/* Un perfil leído de fuera"),
  between("const panProfileView", "/* Los puntos que se ven"),
  /* Registro de depuración de la descarga del perfil */
  between("const fmtTraceBytes", "/* Un intento fallido")
].join("\n");
/* nextNumberedName barre el árbol: aquí, un árbol de mentira */
const fakeTree = "let fakeNames = []; const treeEl = { querySelectorAll: () => fakeNames.map(n => ({ _name: n })) };\n";
const src = "const parserErrorText = () => null;\nconst toRad = d => d * Math.PI / 180;\n"
  + "let altitudeUnit = 'm'; const setUnit = u => { altitudeUnit = u; };\n" + fakeTree
  + helpers + units + consts + arrows + "\n" +
  [fn("parseWcsCapabilities"), fn("pickMdsCoverage"),
   fn("parseCoverageDescription"), fn("coverageCellMeters"), fn("pickFinestCoverage"),
   fn("describeElevChoice"), fn("validElevSources"), fn("elevSourcesLabel"),
   fn("parseOwsException"), fn("isRetryableElevError"), fn("withElevRetries"),
   fn("parseAsciiGrid"), fn("gridFromRaster"), fn("gridCellBounds"), fn("gridToLatLng"),
   fn("buildElevCells"), fn("elevCellHtml"), fn("pointInCell"), fn("sessionStamp"),
   fn("nextNumberedName"), fn("profilePieces"), fn("routeProfileSamples"), fn("profileFromSamples"),
   fn("niceTicks"), fn("profilePolylines"), fn("nearestProfilePoint"),
   fn("routeProfileKey"), fn("profilePointAt"), fn("clampProfileView"), fn("zoomProfileView"),
   fn("visibleProfilePoints"), fn("validRouteProfile"), fn("profileTreeCells"), fn("describeTraceError"),
   fn("text")].join("\n");
const apiExports = "\nreturn {parseWcsCapabilities, mdtCoverages, pickMdsCoverage, pickDeaDemCoverage," +
  " pickGeoCrs, pickElevFormat, parseCoverageDescription, pickFinestCoverage, describeElevChoice," +
  " validElevSources, ELEV_SOURCES, ELEV_SOURCE_DEFAULT, elevSourceById, elevNodeName," +
  " isOutOfCoverage, parseOwsException, isRetryableElevError, withElevRetries, ELEV_RETRIES," +
  " parseAsciiGrid, gridFromRaster, pickWebMercator, webMercatorHalf, gridCellBounds, gridFontSize," +
  " gridIconSize, snapTile, latticeKey, ELEV_TILE_WEB, ELEV_TILE_GEO, ELEV_WINDOW, gridToLatLng," +
  " buildElevCells, elevCellHtml, elevZoomBand, isElevAlert, pointInCell, sessionStamp," +
  " fmtHeight, fmtHeightValue, setUnit, nextNumberedName, setNames: n => { fakeNames = n; }," +
  " validAltitudeUnit, validProfileMax, PROFILE_MAX_DEFAULT, ALTITUDE_UNIT_SCHEMA, PROFILE_MAX_SCHEMA," +
  " profilePieces, routeProfileSamples, profileFromSamples, niceTicks, tickDecimals, profilePolylines," +
  " nearestProfilePoint, PROFILE_CHUNK_CELLS, elevTileFactor, routeProfileKey, profilePointAt," +
  " validRouteProfile, profileTreeCells, clampProfileView, zoomProfileView, panProfileView," +
  " visibleProfilePoints, zoomRange, distDecimals, elevOutputCell, snapToCells, tileToCells, elevBandLat, packProfilePoints, unpackProfilePoints, PROFILE_MAX_PTS," +
  " fmtTraceBytes, describeTraceGrid, describeTraceError};";
const api = new Function("DOMParser", src + apiExports)(DOMParser);
const ok=(c,m)=>{ if(!c){ console.error("FAIL: "+m); process.exitCode=1; } };

/* GetCapabilities real del WCS del MDT, recortado a lo que se usa */
const ids = ["Elevacion4258_1000","Elevacion4326_1000","Elevacion4258_500","Elevacion4326_500",
  "Elevacion4258_200","Elevacion4258_25","Elevacion4258_5","Elevacion25830_1000",
  "Elevacion4083_1000","Elevacion25830_500","Elevacion4083_500","Elevacion25830_200",
  "Elevacion4083_200","Elevacion25830_25","Elevacion4083_25","Elevacion25830_5","Elevacion4083_5"];
const caps = `<?xml version="1.0"?><wcs:Capabilities xmlns:wcs="http://www.opengis.net/wcs/2.0"
  xmlns:crs="http://www.opengis.net/wcs/crs/1.0">
  <ows:OperationsMetadata xmlns:ows="http://www.opengis.net/ows/2.0"
   xmlns:inspire_dls="http://inspire.ec.europa.eu/schemas/inspire_dls/1.0"
   xmlns:inspire_common="http://inspire.ec.europa.eu/schemas/common/1.0"><ows:ExtendedCapabilities>
   <inspire_dls:ExtendedCapabilities>${["MDT05","MDT25","MDT200","MDT500","MDT1000"].map(c =>
     `<inspire_dls:SpatialDataSetIdentifier><inspire_common:Code>${c}</inspire_common:Code>` +
     `<inspire_common:Namespace>IGN</inspire_common:Namespace></inspire_dls:SpatialDataSetIdentifier>`).join("")}
   </inspire_dls:ExtendedCapabilities></ows:ExtendedCapabilities></ows:OperationsMetadata>
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
ok(parsed.datasets.join() === "MDT05,MDT25,MDT200,MDT500,MDT1000",
   "SpatialDataSetIdentifier del IGN (INSPIRE): " + parsed.datasets);
for (const src of api.ELEV_SOURCES.filter(x => x.provider === "IGN" && x.kind === "mdt")) {
  ok(parsed.datasets.includes(src.dataset), `el conjunto ${src.dataset} del catálogo existe en el servicio`);
}

/* Cada conjunto de datos del MDT (MDT05, MDT25, MDT200) es UNA malla:
   del nombre se toman solo las coberturas de su paso, en cualquier
   sistema, con las geográficas primero; la decisión final entre ellas
   la toma pickFinestCoverage con sus descripciones.                  */
const cand = api.mdtCoverages(5)(ids);
ok(cand.length === 3 && cand.every(id => /_5$/.test(id)), "MDT05: las tres de 5 m: " + cand);
ok(cand[0] === "Elevacion4258_5", "la geográfica de 5 m, la primera: " + cand[0]);
const c25 = api.mdtCoverages(25)(ids);
ok(c25.length === 3 && c25.every(id => /_25$/.test(id)) && c25[0] === "Elevacion4258_25",
   "MDT25: solo las de 25 m, nunca las de 5: " + c25);
ok(api.mdtCoverages(200)(ids).every(id => /_200$/.test(id)) && api.mdtCoverages(200)(ids).length === 3,
   "MDT200: las tres de 200 m");
ok(api.mdtCoverages(25)(["Elevacion4083_25","Elevacion4258_25"])[0] === "Elevacion4258_25",
   "a igual malla, gana el geográfico");
ok(api.mdtCoverages(5)(["otraCosa"]).length === 0, "lo que no sigue el patrón no es de ningún conjunto");
ok(api.mdtCoverages(5)([]).length === 0, "sin coberturas, ninguna candidata");

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
ok(dcaps.datasets.length === 0, "Digital Earth Africa no declara conjuntos de datos");
ok(api.pickDeaDemCoverage(dcaps.coverages).join() === "dem_cop_30", "de todo el catálogo, solo Copernicus DEM");
ok(api.pickDeaDemCoverage(["crop_mask"]).length === 0, "sin Copernicus DEM, ninguna candidata (no la primera que haya)");
/* Canarias dentro, Madrid fuera: lo que decide no pedir en vano */
const inside = (b, lat, lon) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
ok(inside(bb, 28.3, -16.5), "Tenerife cae dentro de la cobertura");
ok(!inside(bb, 40.4, -3.7), "Madrid queda fuera (por encima de 39°N)");

/* ---- lo elegido, en una línea para el registro de avisos ---- */
const ign = api.ELEV_SOURCES.find(s => s.id === "ign-mdt05");
const deaSrc = api.ELEV_SOURCES.find(s => s.id === "dea-cop30");
let line = api.describeElevChoice(ign, { coverageId: "Elevacion4258_5", format: { name: "ArcGrid", kind: "ascii" }, cellMeters: 5 });
ok(/^MDT \(terreno\) · IGN/.test(line) && /conjunto MDT05/.test(line) && /Elevacion4258_5/.test(line) && /ArcGrid \(rejilla ASCII\)/.test(line)
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
   && typeof s.pickCoverage === "function" && s.label && s.attrib && s.dataset && s.provider),
   "cada fuente completa: https, atribución, conjunto de datos y proveedor");
ok(["ign-mdt05", "ign-mdt25", "ign-mdt200"].every(id => api.ELEV_SOURCES.some(s => s.id === id && s.kind === "mdt")),
   "el IGN ofrece MDT05, MDT25 y MDT200");
ok(api.ELEV_SOURCES.find(s => s.id === "dea-cop30").timeout >= 35000,
   "Digital Earth Africa lleva su propio tiempo máximo (tarda 17-33 s en frío)");
ok(api.ELEV_SOURCES.filter(s => s.kind === "mds").length >= 2, "al menos dos MDS (IGN y Digital Earth Africa)");
ok(api.ELEV_SOURCE_DEFAULT.mdt === "ign-mdt05" && api.ELEV_SOURCE_DEFAULT.mds === "ign-mds", "por defecto, MDT05 y MDS del IGN");
for (const k of ["mdt", "mds"]) {
  const s = api.ELEV_SOURCES.find(x => x.id === api.ELEV_SOURCE_DEFAULT[k]);
  ok(s && s.kind === k, `la fuente por defecto de ${k} es de ese tipo`);
}

/* ---- validar la elección guardada contra el catálogo actual ---- */
ok(JSON.stringify(api.validElevSources({ mdt: "ign-mdt25", mds: "dea-cop30" })) === '{"mdt":"ign-mdt25","mds":"dea-cop30"}',
   "una elección válida se respeta");
ok(api.validElevSources({ mdt: "ign-mdt", mds: "ign-mds" }).mdt === "ign-mdt05",
   "el id anterior al catálogo por conjuntos (ign-mdt) cae al de por defecto, sin migración");
ok(JSON.stringify(api.validElevSources({ mdt: null, mds: null })) === '{"mdt":null,"mds":null}',
   "«Ninguna» en las dos es legítimo");
ok(api.validElevSources({ mdt: "retirada", mds: "ign-mds" }).mdt === "ign-mdt05", "una fuente retirada vuelve a la de por defecto");
ok(api.validElevSources({ mdt: "ign-mds", mds: "ign-mdt25" }).mdt === "ign-mdt05", "un MDS en el hueco del MDT no se cuela");
ok(api.validElevSources({ mdt: "ign-mds", mds: "ign-mdt25" }).mds === "ign-mds", "ni un MDT en el del MDS");

/* ---- nombre de las capas: conjunto de datos y proveedor ---- */
{
  const S = id => api.elevSourceById(id);
  ok(api.elevNodeName("Elevación 3", [S("ign-mdt25"), S("ign-mds")]) === "Elevación 3 — MDT25 + MDS (IGN)",
     "mismo proveedor: una vez: " + api.elevNodeName("Elevación 3", [S("ign-mdt25"), S("ign-mds")]));
  ok(api.elevNodeName("Elevación 4", [S("ign-mdt05"), S("dea-cop30")])
     === "Elevación 4 — MDT05 (IGN) + COP-DEM GLO-30 (Digital Earth Africa)", "proveedores distintos: cada uno con el suyo");
  ok(api.elevNodeName("Elevación 5", [null, S("dea-cop30")]) === "Elevación 5 — COP-DEM GLO-30 (Digital Earth Africa)",
     "un solo modelo consultado");
  ok(api.elevNodeName("Perfil de «Ruta 1»", [S("ign-mds")]) === "Perfil de «Ruta 1» — MDS (IGN)", "perfil");
  ok(api.elevNodeName("Elevación 6", [null, null]) === "Elevación 6", "sin fuentes, el nombre tal cual");
  /* La numeración sigue contando con el sufijo detrás */
  api.setNames(["Elevación 3 — MDT25 + MDS (IGN)", "Elevación 7 — MDS (IGN)", "Elevación 2", "Elevación 9x"]);
  ok(api.nextNumberedName("Elevación") === "Elevación 8", "nextNumberedName ve el número con sufijo: "
     + api.nextNumberedName("Elevación"));
  api.setNames(["Ruta 4 — algo", "Ruta 5—pegado"]);
  ok(api.nextNumberedName("Ruta") === "Ruta 5", "solo el sufijo « — …» separado cuenta");
  api.setNames([]);
}
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

  /* Mallas de distinto paso (MDT200 o MDT25 con el MDS de 5 m): manda
     la FINA, y cada celda lleva el valor de la gruesa que la contiene.
     Si mandara la gruesa, su centro caería fuera de la tesela del MDS
     y la superficie saldría vacía.                                    */
  const coarseT = { ...api.parseAsciiGrid(
    "ncols 1\nnrows 1\nxllcorner 0\nyllcorner 0\ncellsize 40\nNODATA_value -9999\n650\n"), crs: "geo" };
  const fineS = { ...api.parseAsciiGrid(
    "ncols 2\nnrows 2\nxllcorner 10\nyllcorner 10\ncellsize 10\nNODATA_value -9999\n661 662\n663 664\n"), crs: "geo" };
  const mixed = api.buildElevCells(coarseT, fineS);
  ok(mixed.role === "surface" && mixed.cells.length === 4, "la malla fina manda: " + (mixed && mixed.cells.length));
  ok(mixed.cells.every(c => c.mdt === 650 && c.diff === c.mds - 650), "cada celda fina con el MDT grueso que la contiene");
}
{
  ok(api.elevTileFactor(5) === 1 && api.elevTileFactor(null) === 1, "malla de 5 m (o desconocida): la tesela base");
  ok(api.elevTileFactor(25) === 2 && api.elevTileFactor(31) === 2, "25-31 m: el doble (caben dos celdas)");
  ok(api.elevTileFactor(200) === 10, "200 m: diez teselas base, 400 m (40 m no llegaban a un píxel)");
}

/* ---- elevCellHtml: solo las líneas de lo consultado, en la unidad de altitud ---- */
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

/* ---- fmtHeight: en la unidad que se le pida (la de altitud de Propiedades) ---- */
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

/* ---- reintentos: solo lo pasajero, con espera creciente ---- */
{
  const E = (props) => Object.assign(new Error("x"), props);
  ok(api.isRetryableElevError(E({ name: "TimeoutError" })), "tiempo agotado: se reintenta");
  ok(api.isRetryableElevError(new TypeError("Failed to fetch")), "red caída (o CORS de un 403): se reintenta");
  ok(api.isRetryableElevError(E({ status: 503 })) && api.isRetryableElevError(E({ status: 429 })), "5xx y 429: se reintenta");
  ok(!api.isRetryableElevError(E({ status: 404 })) && !api.isRetryableElevError(E({ status: 400 })), "otro 4xx: no");
  ok(!api.isRetryableElevError(E({ owsCode: "InvalidSubsetting", status: 404 })), "fuera de cobertura es una respuesta: no");
  ok(!api.isRetryableElevError(E({ name: "AbortError" })), "cancelado por el usuario: no");
  ok(api.ELEV_RETRIES >= 3, "al menos tres reintentos (pedido)");
}
(async () => {
  const waits = [];
  const sleep = async ms => { waits.push(ms); };
  const run = async outcomes => {
    let calls = 0;
    const attempt = async () => {
      const o = outcomes[Math.min(calls++, outcomes.length - 1)];
      if (o instanceof Error) throw o;
      return o;
    };
    try { return { value: await api.withElevRetries(attempt, { sleep }), calls }; }
    catch (err) { return { err, calls }; }
  };
  const e503 = Object.assign(new Error("no disponible"), { status: 503 });
  let r = await run([e503, e503, "rejilla"]);
  ok(r.value === "rejilla" && r.calls === 3, "dos 503 y un acierto: éxito al tercer intento: " + JSON.stringify(r));
  ok(waits.join() === "1000,2000", "espera creciente entre intentos: " + waits);
  r = await run([Object.assign(new Error("fuera"), { owsCode: "InvalidSubsetting", status: 404 })]);
  ok(r.err && r.calls === 1, "fuera de cobertura: un solo intento");
  const tmo = Object.assign(new Error("t"), { name: "TimeoutError" });
  r = await run([tmo]);
  ok(r.err && r.calls === 1 + api.ELEV_RETRIES && r.err.attempts === 1 + api.ELEV_RETRIES,
     `siempre tiempo agotado: ${1 + api.ELEV_RETRIES} intentos y se rinde: ` + r.calls);

  /* ---- Preferencias: unidad de altitud y límite del perfil ---- */
  ok(api.validAltitudeUnit({ v: api.ALTITUDE_UNIT_SCHEMA, unit: "ft" }) === "ft", "unidad de altitud válida");
  ok(api.validAltitudeUnit({ v: api.ALTITUDE_UNIT_SCHEMA, unit: "yd" }) === null, "unidad desconocida: descartada");
  ok(api.validAltitudeUnit({ v: 99, unit: "m" }) === null && api.validAltitudeUnit(undefined) === null, "otra versión o nada: null");
  ok(Math.abs(api.PROFILE_MAX_DEFAULT - 18520) < 1e-9, "límite del perfil por defecto: 10 NM");
  ok(api.validProfileMax({ v: api.PROFILE_MAX_SCHEMA, m: 5000 }) === 5000, "límite válido");
  ok(api.validProfileMax({ v: api.PROFILE_MAX_SCHEMA, m: 0 }) === null, "cero: descartado");
  ok(api.validProfileMax({ v: api.PROFILE_MAX_SCHEMA, m: 1e9 }) === null, "desmesurado: descartado");
  ok(api.validProfileMax({ v: api.PROFILE_MAX_SCHEMA, m: "5000" }) === null, "no numérico: descartado");

  /* ---- perfil: trozos, muestras y un punto por celda ---- */
  {
    /* Dos tramos en metros Web Mercator, escala 1 (ecuador): 1000 m al
       este y luego 500 m al norte; distancias geodésicas 1000 y 500.  */
    const legs = [
      { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, dist: 1000, scale: 1 },
      { a: { x: 1000, y: 0 }, b: { x: 1000, y: 500 }, dist: 500, scale: 1 }
    ];
    const pieces = api.profilePieces(legs, 5, 100);  /* 100 celdas de 5 m = 500 m por trozo */
    ok(pieces.length === 3, "1000 m en dos trozos de 500 y 500 m en uno: " + pieces.length);
    ok(pieces.every(q => q.x1 - q.x0 <= 500 + 10 + 1e-9 && q.y1 - q.y0 <= 500 + 10 + 1e-9),
       "ninguna caja pasa del tope más una celda de margen por lado");
    ok(pieces[0].x0 === -5 && pieces[0].y0 === -5, "margen de una celda");
    const diag = api.profilePieces([{ a: { x: 0, y: 0 }, b: { x: 3000, y: 4000 }, dist: 5000, scale: 2 }], 5, 100);
    ok(diag.length === 5, "la escala de Mercator agranda la celda en la proyección: 5000/(100·5·2) = 5 trozos: " + diag.length);

    const { samples, vertices, total } = api.routeProfileSamples(legs, 5);
    ok(total === 1500 && vertices.join() === "0,1000,1500", "vértices en la suma de los tramos: " + vertices);
    ok(samples[0].d === 0 && samples[samples.length - 1].d === 1500, "de principio a fin");
    ok(samples.every((s, i) => i === 0 || s.d > samples[i - 1].d), "distancias crecientes, sin repetir el vértice");
    ok(samples.every((s, i) => i === 0 || Math.hypot(s.x - samples[i - 1].x, s.y - samples[i - 1].y) <= 2.5 + 1e-9),
       "a media celda o menos: no se salta ninguna");

    /* Rejilla falsa de celdas de 10 m: valor = columna + 100·fila */
    const lookup = s => (s.y > 300 ? undefined : {
      key: `${Math.floor(s.x / 10)}:${Math.floor(s.y / 10)}`,
      value: Math.floor(s.x / 10) === 50 ? null : Math.floor(s.x / 10) + 100 * Math.floor(s.y / 10), ref: {}
    });
    const pts = api.profileFromSamples(samples, lookup);
    const along = pts.filter(p => p.d <= 1000);
    ok(along.length === 100 || along.length === 101, "un punto por celda recorrida en el primer tramo: " + along.length);
    ok(pts.some(p => p.v === null && p.ref), "celda sin dato: hueco (con su celda)");
    ok(pts[pts.length - 1].v === null && !pts[pts.length - 1].ref, "sin rejilla que cubra: hueco sin celda");
    ok(pts.filter(p => !p.ref).length === 1, "los huecos seguidos se funden en uno");
    ok(pts.every((p, i) => i === 0 || p.d > pts[i - 1].d), "puntos en orden de distancia");
    const mid = pts.find(p => p.v === 3);
    ok(mid && Math.abs(mid.d - 35) < 3, "cada punto, en la distancia media de su celda: " + (mid && mid.d));
    ok(api.nearestProfilePoint(pts, 503).v !== null, "la lectura bajo el ratón salta los huecos");

    /* Diezmado: con más puntos que píxeles, min y max por columna */
    const many = Array.from({ length: 1000 }, (_, i) => ({ d: i, v: i === 500 ? 999 : 10 }));
    const lines = api.profilePolylines(many, d => d / 10, v => 1000 - v);
    ok(lines.length === 1 && lines[0].length < 250, "1000 puntos en 100 columnas: se reducen: " + lines[0].length);
    ok(lines[0].some(p => p.y === 1), "y el pico no se pierde");
    const gappy = [{ d: 0, v: 1 }, { d: 1, v: 2 }, { d: 2, v: null }, { d: 3, v: 4 }];
    ok(api.profilePolylines(gappy, d => d * 100, v => v).length === 2, "un hueco corta la curva en dos");
  }

  /* ---- perfil: la ruta y su perfil guardado ---- */
  {
    const wps = [{ lat: 40.4168, lng: -3.7038 }, { lat: 40.4168, lng: -3.69 }];
    const k = api.routeProfileKey(wps);
    ok(k === api.routeProfileKey(wps.map(p => ({ ...p }))), "misma geometría, misma clave");
    ok(k === api.routeProfileKey([{ lat: 40.41680000001, lng: -3.7038 }, wps[1]]), "ruido por debajo de 7 decimales: misma clave");
    ok(k !== api.routeProfileKey([{ lat: 40.4169, lng: -3.7038 }, wps[1]]), "mover un vértice cambia la clave");

    /* La flecha: inversa de routeProfileSamples sobre los mismos tramos */
    const legs = [
      { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, dist: 1000, scale: 1 },
      { a: { x: 1000, y: 0 }, b: { x: 1000, y: 500 }, dist: 500, scale: 1 }
    ];
    const vertices = [0, 1000, 1500];
    const at = d => api.profilePointAt(legs, vertices, d);
    ok(at(0).x === 0 && at(0).y === 0 && at(0).angle === 0, "inicio, hacia el este: " + JSON.stringify(at(0)));
    ok(at(250).x === 250 && at(250).y === 0, "a mitad del primer tramo, sobre él");
    ok(at(1000).x === 1000 && at(1000).y === 0, "el vértice, en su distancia exacta");
    ok(at(1250).x === 1000 && at(1250).y === 250 && at(1250).angle === 90, "segundo tramo, hacia el norte: " + JSON.stringify(at(1250)));
    ok(at(1500).y === 500 && at(9999).y === 500 && at(-5).x === 0, "fuera de rango: en los extremos");
    const { samples } = api.routeProfileSamples(legs, 5);
    ok(samples.every(s => { const p = at(s.d); return Math.hypot(p.x - s.x, p.y - s.y) < 1e-6; }),
       "cada muestra de la curva cae en su sitio del mapa");

    /* Guardar y validar */
    const packed = api.packProfilePoints([{ d: 12.345, v: 601.23456 }, { d: 20, v: null }]);
    ok(JSON.stringify(packed) === "[[12.3,601.23],[20,null]]", "curva compacta: " + JSON.stringify(packed));
    ok(api.unpackProfilePoints(packed)[1].v === null, "y de vuelta, los huecos siguen siéndolo");
    const good = { key: k, total: 1500, vertices, mdt: { src: "ign-mdt05", pts: packed }, mds: null };
    ok(api.validRouteProfile(good) && api.validRouteProfile(good).mds === null, "perfil válido, con una sola serie");
    ok(api.validRouteProfile(JSON.parse(JSON.stringify(good))), "sobrevive a JSON");
    const bad = [null, "x", { ...good, key: "" }, { ...good, total: -1 }, { ...good, total: "1500" },
      { ...good, vertices: [0, 1000, 900] }, { ...good, vertices: [0] }, { ...good, mdt: null },
      { ...good, mdt: { src: "ign-mdt05", pts: [[1, "600"]] } }, { ...good, mdt: { src: 5, pts: packed } },
      { ...good, mdt: { src: "x", pts: [[1, 2, 3]] } }, { ...good, mds: "nada" },
      { ...good, mdt: { src: "x", pts: Array.from({ length: api.PROFILE_MAX_PTS + 1 }, (_, i) => [i, 1]) } }];
    ok(bad.every(b => api.validRouteProfile(b) === null),
       "basura, vértices decrecientes, sin series o desmesurado: descartado: "
       + bad.map(b => !!api.validRouteProfile(b)).join());

    /* Celdas del árbol: manda la malla de `drive`, la otra da su valor
       en el centro; solo las recorridas con algún dato.               */
    const grid = { crs: "geo", located: true, xll: -3.70, yll: 40.41, cellX: 0.001, cellY: 0.001,
                   rows: 1, cols: 3, values: [[600, null, 610]] };
    const drive = { kind: "mds", points: [
      { d: 5, v: 600, ref: { grid, r: 0, c: 0 } }, { d: 15, v: null, ref: { grid, r: 0, c: 1 } },
      { d: 25, v: 610, ref: { grid, r: 0, c: 2 } }, { d: 35, v: null, ref: null }] };
    const both = api.profileTreeCells(drive, { valueAt: c => (c[1] < -3.699 ? 590 : null) }, { mdt: true, mds: true });
    ok(both.length === 2, "la celda sin dato en ninguna y el hueco sin celda no entran: " + both.length);
    ok(both[0].mds === 600 && both[0].mdt === 590 && both[0].diff === 10, "la otra malla en el centro, y su diferencia");
    ok(both[1].mdt === null && both[1].diff === null, "sin la otra: null, sin diferencia");
    const one = api.profileTreeCells(drive, null, { mdt: false, mds: true });
    ok(one.length === 2 && !("mdt" in one[0]), "con un solo modelo, sin la clave del otro");
  }

  /* ---- malla de salida fija: misma rejilla en cualquier caja ---- */
  {
    const c40 = api.elevOutputCell(5.004, 40.42);
    ok(api.elevBandLat(40.42) === 40.5 && api.elevBandLat(-0.2) === -0.5, "franja de 1° por su centro");
    ok(c40.web === 6.58 && c40.lat === 0.0000449 && c40.lon === 0.0000591, "5 m a 40,5°: 6,58 m Web Mercator, al cm y a 1e-7°: " + JSON.stringify(c40));
    ok(JSON.stringify(api.elevOutputCell(5.0, 40.9)) === JSON.stringify(c40), "el MDT05 (5,0 m) y el MDS (5,004 m) comparten malla en la franja");
    ok(api.elevOutputCell(30.9, 37.98).web === 38.95, "Copernicus a 37,98°N: 38,95 m");
    ok(api.elevOutputCell(0, 40) === null && api.elevOutputCell(5, NaN) === null, "sin celda conocida, sin malla (la caja va tal cual)");
    /* Dos cajas cualesquiera ajustadas a la misma malla comparten líneas */
    const cell = 6.58;
    const a = api.snapToCells(-412300, -412260, cell), b = api.snapToCells(-412297.7, -411300, cell);
    const onGrid = v => Math.abs(v / cell - Math.round(v / cell)) < 1e-9;
    ok(onGrid(a.a) && onGrid(a.b) && onGrid(b.a) && onGrid(b.b), "los extremos caen en la malla");
    ok(a.a <= -412300 && a.b >= -412260 && a.n === Math.round((a.b - a.a) / cell), "ajuste hacia fuera, con su número de celdas: " + JSON.stringify(a));
    ok(Math.abs((b.a - a.a) / cell - Math.round((b.a - a.a) / cell)) < 1e-9, "otra caja, desplazada 2,3 m: misma malla");
    const exact = api.snapToCells(10 * cell, 20 * cell, cell);
    ok(exact.n === 10 && Math.abs(exact.a - 10 * cell) < 1e-9, "una caja ya en la malla no crece");
    ok(api.snapToCells(1, 1.0001, cell).n === 1, "al menos una celda");
    /* Teselas de consultas puntuales vecinas: mismo borde, sin solape */
    const T = 52.22, t1 = api.tileToCells(0, T, 10, cell), t2 = api.tileToCells(T, 2 * T, 60, cell);
    ok(t1.b === t2.a, "dos teselas vecinas comparten borde (ni solape ni hueco): " + JSON.stringify([t1, t2]));
    const edge = api.tileToCells(0, T, 52.1, cell);
    ok(edge.a <= 0 + cell && edge.b >= 52.1 && edge.b - 52.1 <= cell, "la celda del punto pulsado, siempre dentro: " + JSON.stringify(edge));
  }

  /* ---- gráfica: zoom con ancla y desplazamiento ---- */
  {
    const total = 10000, minSpan = 600; /* 600 px a 1 m por píxel */
    const full = { x0: 0, x1: total };
    let v = api.zoomProfileView(full, total, minSpan, 0.25, 0.5);
    ok(v.x0 === 1250 && v.x1 === 6250, "acercar a la mitad con el ratón al 25 %: ese punto (2500 m) no se mueve: " + JSON.stringify(v));
    ok(Math.abs((v.x0 + 0.25 * (v.x1 - v.x0)) - 2500) < 1e-9, "el ancla sigue bajo el ratón");
    ok(JSON.stringify(api.zoomProfileView(full, total, minSpan, 0.5, 4)) === JSON.stringify(full),
       "alejar tiene tope en la ruta entera");
    v = api.zoomProfileView({ x0: 4000, x1: 5000 }, total, minSpan, 0.5, 0.01);
    ok(v.x1 - v.x0 === minSpan && v.x0 === 4200, "acercar tiene tope en 1 m por píxel, centrado en el ancla: " + JSON.stringify(v));
    v = api.zoomProfileView({ x0: 0, x1: 2000 }, total, minSpan, 0, 0.5);
    ok(v.x0 === 0 && v.x1 === 1000, "con el ratón en el borde izquierdo, el inicio se queda");
    v = api.zoomProfileView({ x0: 8000, x1: 10000 }, total, minSpan, 0.9, 3);
    ok(v.x0 === 4000 && v.x1 === 10000, "alejar junto al final no se sale de la ruta: " + JSON.stringify(v));
    ok(JSON.stringify(api.zoomProfileView({ x0: 0, x1: 300 }, 300, minSpan, 0.5, 0.5)) === '{"x0":0,"x1":300}',
       "una ruta más corta que el tope no se acerca más");
    v = api.panProfileView({ x0: 1000, x1: 2000 }, total, minSpan, 500);
    ok(v.x0 === 1500 && v.x1 === 2500, "desplazar mantiene el zoom");
    ok(api.panProfileView({ x0: 1000, x1: 2000 }, total, minSpan, -5000).x0 === 0
       && api.panProfileView({ x0: 1000, x1: 2000 }, total, minSpan, 1e6).x1 === total, "y se para en los extremos");
    const pts = Array.from({ length: 11 }, (_, i) => ({ d: i * 100, v: i }));
    const vis = api.visibleProfilePoints(pts, 250, 520);
    ok(vis.map(p => p.d).join() === "200,300,400,500,600", "lo visible más un vecino a cada lado: " + vis.map(p => p.d));
    ok(api.visibleProfilePoints(pts, 0, 1000).length === 11, "con la ruta entera, todos");
    /* Eje de alturas: ancla contada desde abajo, topes de anchura, sin topes de dominio */
    let r = api.zoomRange({ a: 500, b: 700 }, 0.25, 0.5, 0.1, 20000);
    ok(r.a === 525 && r.b === 625, "acercar la altura con el ratón a un cuarto desde abajo: 550 m no se mueve: " + JSON.stringify(r));
    r = api.zoomRange({ a: 600, b: 600.15 }, 0.5, 0.1, 0.1, 20000);
    ok(Math.abs((r.b - r.a) - 0.1) < 1e-9, "acercar tiene tope (0,1 m a la vista)");
    r = api.zoomRange({ a: 0, b: 15000 }, 0.5, 4, 0.1, 20000);
    ok(r.b - r.a === 20000 && r.a === -2500, "alejar tiene tope, y puede bajar de cero (eje bloqueado): " + JSON.stringify(r));
    /* Decimales de la lectura: los que distinguen un píxel */
    ok(api.distDecimals(3.2, 1000) === 3 && api.distDecimals(0.1, 1000) === 4 && api.distDecimals(50, 1000) === 2,
       "km: 3,2 m/px → 3 decimales; 0,1 m/px → 4; 50 m/px → 2 (nunca menos)");
    ok(api.distDecimals(0.1, 1852) === 5 && api.distDecimals(1e-6, 1) === 6, "NM a 0,1 m/px → 5 (0,00005 NM ≈ 9 cm); tope de 6");
  }

  /* ---- marcas de eje ---- */
  {
    let t = api.niceTicks(0, 18.52, 5);
    ok(t.step === 5 && t.ticks.join() === "0,5,10,15", "0–18,52 NM: de 5 en 5: " + t.ticks);
    t = api.niceTicks(612.3, 698.9, 4);
    ok(t.step === 20 && t.ticks[0] === 620 && t.ticks[t.ticks.length - 1] === 680, "alturas: de 20 en 20: " + t.ticks);
    t = api.niceTicks(0, 0.0123, 4);
    ok(t.step === 0.005 && api.tickDecimals(t.step) === 3, "en NM, pasos pequeños con sus decimales: " + t.ticks);
    ok(api.niceTicks(5, 5, 4).ticks.join() === "5", "sin rango: una sola marca");
  }

  /* ---- registro de depuración de la descarga del perfil ---- */
  {
    ok(api.fmtTraceBytes(812) === "812 B" && api.fmtTraceBytes(46285) === "45.2 kB"
      && api.fmtTraceBytes(3 * 1024 * 1024) === "3.0 MB", "tamaños de respuesta legibles");
    const g = api.parseAsciiGrid("ncols 3\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 5\nNODATA_value -9999\n"
      + "612.5 640 -9999\n700.25 655 630\n");
    ok(api.describeTraceGrid(g) === "rejilla de 3 × 2 celdas de 5 · 1 sin dato · alturas 612.5–700.3 m",
      "la rejilla recibida, resumida: " + api.describeTraceGrid(g));
    ok(/no es una rejilla/.test(api.describeTraceGrid(null)), "una respuesta ilegible se dice");
    const E = o => Object.assign(new Error(o.message || "x"), o);
    ok(api.describeTraceError(E({ name: "TimeoutError" }), 0, 12000) === "sin respuesta en 12 s · se reintenta en 1 s",
      "tiempo agotado: cuánto y cuándo se reintenta");
    ok(api.describeTraceError(E({ status: 503, message: "no disponible" }), 2, 12000) === "HTTP 503: no disponible · se reintenta en 4 s",
      "5xx: el estado, y la espera que toca a ese intento");
    ok(!/reintenta/.test(api.describeTraceError(E({ status: 503 }), api.ELEV_RETRIES, 12000)),
      "agotados los intentos, ya no se reintenta");
    ok(api.describeTraceError(E({ owsCode: "InvalidSubsetting", message: "fuera" }), 0, 12000)
      === "excepción del servicio InvalidSubsetting: fuera (fuera de cobertura: no es un error)",
      "una excepción OGC lleva su código, y fuera de cobertura no se reintenta");
  }

  if (!process.exitCode) console.log("ELEVATION TESTS OK");
})();
