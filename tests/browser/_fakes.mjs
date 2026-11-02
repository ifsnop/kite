/* Servicios falsos compartidos por las pruebas de navegador y por
   tools/capturas.mjs (las capturas del manual).

   `ignFakes()`: el MDT y el MDS del IGN servidos por `page.route`, como los
   da el servicio real (comprobado contra el IGN y Digital Earth Africa): una
   rejilla ASCII que empieza en la esquina de la caja pedida; con `scaleSize`,
   tantas celdas como diga; sin él, celdas de ~6,5 m Web Mercator (≈ 5 m
   reales a 40°N) que reparten el ancho en un número entero que elige el
   servicio.

   Altura por defecto: MDS = 600 + 50·sen(x/300) en el centro de cada celda y
   el MDT, 10 m por debajo. `fake.terrain(x, mds)` (x en metros Web Mercator)
   la sustituye por otra, para una figura con más relieve. Los demás
   campos son interruptores que las pruebas mueven en caliente:
     failBox      { host, x0 }: el recorte que responde siempre 500
     slow         ms de espera antes de cada GetCoverage
     rejectScale  un servicio que no entiende scaleSize
     seen         cada petición que llega: { request, params, host }       */

export const IGN_ROUTE = /wcs-mds\.idee\.es|servicios\.idee\.es/;

const caps = cov => `<?xml version="1.0"?><wcs:Capabilities xmlns:wcs="http://www.opengis.net/wcs/2.0"
  xmlns:crs="http://www.opengis.net/wcs/crs/1.0"><wcs:ServiceMetadata><wcs:formatSupported>ArcGrid</wcs:formatSupported>
  <wcs:Extension><crs:CrsMetadata><crs:crsSupported>http://www.opengis.net/def/crs/EPSG/0/3857</crs:crsSupported>
  <crs:crsSupported>http://www.opengis.net/def/crs/EPSG/0/25830</crs:crsSupported></crs:CrsMetadata></wcs:Extension>
  </wcs:ServiceMetadata><wcs:Contents><wcs:CoverageSummary><wcs:CoverageId>${cov}</wcs:CoverageId></wcs:CoverageSummary>
  </wcs:Contents></wcs:Capabilities>`;
const desc = `<?xml version="1.0"?><wcs:CoverageDescriptions xmlns:wcs="http://www.opengis.net/wcs/2.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"><gml:Envelope srsName="http://www.opengis.net/def/crs/EPSG/0/25830"
  axisLabels="x y"><gml:lowerCorner>-16000 3000000</gml:lowerCorner><gml:upperCorner>1200000 4900000</gml:upperCorner></gml:Envelope>
  <gml:domainSet><gml:RectifiedGrid dimension="2"><gml:offsetVector>5 0</gml:offsetVector>
  <gml:offsetVector>0 -5</gml:offsetVector></gml:RectifiedGrid></gml:domainSet></wcs:CoverageDescriptions>`;
const CS = 6.5;

export function ignFakes() {
  const fake = { seen: [], failBox: null, slow: 0, rejectScale: false, terrain: null };

  function asciiFor(params, mds) {
    const [[x0, x1], [y0, y1]] = params.getAll("subset").map(s => /\(([-\d.]+),([-\d.]+)\)/.exec(s).slice(1).map(Number));
    const sc = params.get("scaleSize");
    const [nx, ny] = sc ? sc.match(/\((\d+)\)/g).map(t => Number(t.slice(1, -1)))
      : [Math.max(1, Math.round((x1 - x0) / CS)), Math.max(1, Math.round((y1 - y0) / CS))];
    const gx0 = x0, gy0 = y0, cols = nx, rows = ny, CX = (x1 - x0) / nx, CY = (y1 - y0) / ny;
    const lines = [];
    for (let r = rows - 1; r >= 0; r--) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const x = gx0 + (c + 0.5) * CX;
        row.push((fake.terrain ? fake.terrain(x, mds) : (mds ? 600 : 590) + 50 * Math.sin(x / 300)).toFixed(2));
      }
      lines.push(row.join(" "));
    }
    return `ncols ${cols}\nnrows ${rows}\nxllcorner ${gx0}\nyllcorner ${gy0}\ndx ${CX}\ndy ${CY}\nNODATA_value -9999\n${lines.join("\n")}\n`;
  }

  fake.handler = async route => {
    const u = new URL(route.request().url());
    const mdt = u.host === "servicios.idee.es";
    const params = u.searchParams, request = params.get("request");
    fake.seen.push({ request, params, host: u.host });
    if (request === "GetCapabilities") {
      return route.fulfill({ status: 200, contentType: "application/xml", body: caps(mdt ? "Elevacion4258_5" : "mds05") });
    }
    if (request === "DescribeCoverage") return route.fulfill({ status: 200, contentType: "application/xml", body: desc });
    if (fake.slow) await new Promise(r => setTimeout(r, fake.slow));
    if (fake.rejectScale && params.get("scaleSize")) {
      return route.fulfill({ status: 400, contentType: "application/xml", body: `<?xml version="1.0"?>
      <ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/2.0"><ows:Exception exceptionCode="InvalidParameterValue"
      locator="scaleSize"><ows:ExceptionText>scaleSize no soportado</ows:ExceptionText></ows:Exception></ows:ExceptionReport>` });
    }
    const x0 = Number(/\(([-\d.]+),/.exec(params.getAll("subset")[0])[1]);
    if (fake.failBox && fake.failBox.host === u.host && Math.abs(x0 - fake.failBox.x0) < 1) {
      return route.fulfill({ status: 500, contentType: "text/html", body: "<h1>Internal Server Error</h1>" });
    }
    return route.fulfill({ status: 200, contentType: "text/plain", body: asciiFor(params, !mdt) });
  };
  return fake;
}
