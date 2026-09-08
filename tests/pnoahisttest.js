const { DOMParser } = require("@xmldom/xmldom");
const { fn, between } = require("./_extract");
const helpers = between("/* Nombre sin prefijo", "/* KML usa color");
const excludeConst = between("const PNOA_HIST_EXCLUDE", "let pnoaHistCatalog");
/* parserErrorText usa querySelector, que @xmldom/xmldom no implementa
   para documentos XML: se stubea igual que hace elevtest.js, ninguna
   de las fixtures de este archivo es un XML mal formado.              */
const src = "const parserErrorText = () => null;\n" + helpers + excludeConst +
  [fn("directChildText"), fn("collectWmsLayers"), fn("parseWmsCapabilities"), fn("parseWmsServiceException"),
   fn("pnoaHistDefault"), fn("groupPnoaHistEntries")].join("\n");
const apiExports = "\nreturn {collectWmsLayers, parseWmsCapabilities, parseWmsServiceException," +
  " pnoaHistDefault, groupPnoaHistEntries, PNOA_HIST_WMS_OPTS};";
const api = new Function("DOMParser", src + apiExports)(DOMParser);
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* Recorte del GetCapabilities real de https://www.ign.es/wms/pnoa-historico
   (descargado en agosto de 2026), con la misma forma que el original:
   raíz "Ortoimagenes" sin <Name> propio, grupo "PNOA anual" con varios
   años, grupo "PNOA10" con una capa regional, dos vuelos históricos
   sueltos y la capa de consulta infoVuelos (sin imagen propia).       */
const caps = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Service><Name>WMS</Name><Title>Ortofotos históricas de España y PNOA anual</Title></Service>
  <Capability>
    <Layer>
      <Title>Ortoimagenes</Title>
      <Layer>
        <Title>PNOA anual</Title>
        <Layer queryable="1"><Name>PNOA2024</Name><Title>PNOA 2024</Title>
          <Style><Name>default</Name><Title>default</Title></Style></Layer>
        <Layer queryable="1"><Name>PNOA2023</Name><Title>PNOA 2023</Title>
          <Style><Name>default</Name><Title>default</Title></Style></Layer>
        <Layer queryable="1"><Name>PNOA2004</Name><Title>PNOA 2004</Title>
          <Style><Name>default</Name><Title>default</Title></Style></Layer>
      </Layer>
      <Layer>
        <Title>PNOA10</Title>
        <Layer queryable="1"><Name>pnoa10_2018</Name><Title>PNOA10:Galicia 2018</Title>
          <Style><Name>default</Name></Style></Layer>
      </Layer>
      <Layer queryable="1"><Name>SIGPAC</Name><Title>SIGPAC (1997-2003)</Title>
        <Style><Name>default</Name></Style></Layer>
      <Layer queryable="1"><Name>AMS_1956-1957</Name><Title>Americano (Serie B, 1956-1957)</Title>
        <Style><Name>default</Name></Style></Layer>
      <Layer queryable="1"><Name>infoVuelos</Name><Title>Consultar ortoimágenes disponibles</Title>
        <Style><Name>estilo-visible</Name></Style>
        <Style><Name>estilo-invisible</Name></Style></Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

const entries = api.parseWmsCapabilities(caps, api.PNOA_HIST_WMS_OPTS);
ok(entries && entries.length === 6, "6 capas seleccionables: " + (entries && entries.length));
ok(!entries.some(e => e.name === "infoVuelos"), "infoVuelos queda excluida");
ok(!entries.some(e => e.name === "default"), "el <Name> de <Style> no se confunde con el de la capa");

const byName = Object.fromEntries(entries.map(e => [e.name, e]));
ok(byName.PNOA2024 && byName.PNOA2024.group === "PNOA anual", "PNOA2024 agrupada bajo 'PNOA anual'");
ok(byName.pnoa10_2018 && byName.pnoa10_2018.group === "PNOA10", "pnoa10_2018 agrupada bajo 'PNOA10'");
ok(byName.SIGPAC && byName.SIGPAC.group === "Vuelos históricos",
  "SIGPAC (vuelo suelto, sin grupo propio) cae en 'Vuelos históricos'");
ok(byName["AMS_1956-1957"] && byName["AMS_1956-1957"].group === "Vuelos históricos",
  "AMS_1956-1957 cae en 'Vuelos históricos'");
ok(byName.PNOA2024.title === "PNOA 2024", "título leído correctamente: " + byName.PNOA2024.title);

ok(api.pnoaHistDefault(entries) === "PNOA2024", "por defecto se elige el año más reciente: "
  + api.pnoaHistDefault(entries));

const grouped = api.groupPnoaHistEntries(entries);
ok(grouped[0].group === "PNOA anual", "el primer grupo del selector es 'PNOA anual'");
ok(grouped[0].items.map(e => e.name).join(",") === "PNOA2024,PNOA2023,PNOA2004",
  "'PNOA anual' se ordena por año descendente: " + grouped[0].items.map(e => e.name).join(","));
ok(grouped[1].group === "Vuelos históricos", "el segundo grupo es 'Vuelos históricos'");
ok(grouped[2].group === "PNOA10", "un grupo no anticipado ('PNOA10') se coloca al final sin hardcodearlo");

/* Sin ninguna capa con <Name>, no hay nada que ofrecer */
ok(api.parseWmsCapabilities("<WMS_Capabilities><Capability><Layer><Title>Vacío</Title></Layer>"
  + "</Capability></WMS_Capabilities>", api.PNOA_HIST_WMS_OPTS) === null,
  "documento sin capas nombradas devuelve null");

/* WMS 1.3.0 informa sus errores como ServiceExceptionReport, no como el
   ExceptionReport de OWS que usa el WCS de elevaciones (elevtest.js).  */
const wmsError = `<?xml version="1.0"?><ServiceExceptionReport>
  <ServiceException code="LayerNotDefined">La capa PNOA1900 no existe</ServiceException>
</ServiceExceptionReport>`;
const ex = api.parseWmsServiceException(wmsError);
ok(ex && ex.code === "LayerNotDefined", "código de ServiceException leído: " + (ex && ex.code));
ok(ex && /no existe/.test(ex.msg), "mensaje de ServiceException leído: " + (ex && ex.msg));

const owsError = `<?xml version="1.0"?><ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1">
  <ows:Exception exceptionCode="InvalidParameterValue"><ows:ExceptionText>otro esquema</ows:ExceptionText></ows:Exception>
</ows:ExceptionReport>`;
ok(api.parseWmsServiceException(owsError) === null,
  "un ExceptionReport de OWS no se confunde con un ServiceExceptionReport de WMS");
ok(api.parseWmsServiceException("<WMS_Capabilities/>") === null, "una respuesta normal no dispara excepción");

console.log("PNOA HISTÓRICO TESTS OK");
