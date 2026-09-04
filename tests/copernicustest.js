/* Copernicus DEM vía Sentinel Hub: validación del instance ID y lectura
   del GetCapabilities de una configuración de usuario.

   Por qué esta vía y no un WMS anónimo de Copernicus: comprobado contra
   los servicios reales (agosto/septiembre de 2026), no existe. El de la
   EEA (EU-DEM v1.1) está retirado —su MapServer responde "not started" y
   su WMSServer da 404— y el mirror de AWS sirve COG sin cabeceras CORS,
   ilegible desde el navegador. Sentinel Hub es la única vía viva y
   autentica con el instance ID de la cuenta del usuario.              */
const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const { DOMParser } = require("@xmldom/xmldom");
const fs = require("fs");
const script = fs.readFileSync(HTML_PATH, "utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];
function fn(n) {
  const i = script.indexOf(`function ${n}(`); let d = 0;
  for (let k = script.indexOf("{", i); k < script.length; k++) {
    if (script[k] === "{") d++; else if (script[k] === "}" && --d === 0) return script.slice(i, k + 1);
  }
}
const helpers = script.slice(script.indexOf("/* Nombre sin prefijo"), script.indexOf("/* KML usa color"));
/* Las constantes de la sección de Copernicus (COP_WMS_BASE..COP_WMS_OPTS) */
const copConsts = script.slice(script.indexOf("const COP_WMS_BASE"), script.indexOf("let shInstanceId"));
/* parserErrorText usa querySelector, que @xmldom/xmldom no implementa
   para documentos XML: se stubea igual que en pnoahisttest.js.        */
const src = "const parserErrorText = () => null;\n" + helpers + copConsts +
  [fn("directChildText"), fn("collectWmsLayers"), fn("parseWmsCapabilities"),
   fn("parseWmsServiceException"), fn("validInstanceId")].join("\n");
const apiExports = "\nreturn {parseWmsCapabilities, parseWmsServiceException," +
  " validInstanceId, COP_WMS_OPTS};";
const api = new Function("DOMParser", src + apiExports)(DOMParser);
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* ---------- Forma del instance ID ---------- */
ok(api.validInstanceId("12345678-90ab-cdef-1234-567890abcdef"), "un UUID en minúsculas vale");
ok(api.validInstanceId("ABCDEF12-3456-7890-ABCD-EF1234567890"), "un UUID en mayúsculas vale");
ok(api.validInstanceId("  12345678-90ab-cdef-1234-567890abcdef  "),
  "se toleran espacios alrededor: pegar desde el panel de Sentinel Hub los arrastra");
ok(!api.validInstanceId(""), "vacío no vale");
ok(!api.validInstanceId("12345678-90ab-cdef-1234"), "un UUID truncado no vale");
ok(!api.validInstanceId("no-es-un-uuid"), "texto suelto no vale");
ok(!api.validInstanceId("12345678_90ab_cdef_1234_567890abcdef"), "sin guiones no vale");
/* Un carácter fuera de [0-9a-f] con la longitud correcta: el caso que se
   cuela si se valida solo por longitud y guiones.                      */
ok(!api.validInstanceId("z2345678-90ab-cdef-1234-567890abcdef"),
  "un dígito no hexadecimal no vale aunque la forma encaje");

/* ---------- GetCapabilities de una configuración de Sentinel Hub ----------
   Fixture sintética con la estructura de WMS 1.3.0 que publica Sentinel
   Hub: capas planas bajo la raíz, sin grupos anidados, porque cada una
   es una capa que el usuario ha definido en su Configuration Utility.  */
const caps = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Service><Name>WMS</Name><Title>Sentinel Hub WMS</Title></Service>
  <Capability>
    <Layer>
      <Title>Configuración del usuario</Title>
      <Layer queryable="1"><Name>DEM</Name><Title>Copernicus DEM</Title>
        <Style><Name>default</Name><Title>default</Title></Style></Layer>
      <Layer queryable="1"><Name>DEM_COLOR</Name><Title>Copernicus DEM coloreado</Title>
        <Style><Name>default</Name></Style></Layer>
      <Layer queryable="1"><Name>TRUE_COLOR</Name><Title>Sentinel-2 color real</Title>
        <Style><Name>default</Name></Style></Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

const entries = api.parseWmsCapabilities(caps, api.COP_WMS_OPTS);
ok(entries && entries.length === 3, "se leen las 3 capas configuradas: " + (entries && entries.length));
ok(!entries.some(e => e.name === "default"),
  "el <Name> de <Style> no se confunde con el de la capa");
const byName = Object.fromEntries(entries.map(e => [e.name, e]));
ok(byName.DEM && byName.DEM.title === "Copernicus DEM",
  "el título de la capa se lee: " + (byName.DEM && byName.DEM.title));
/* Todas caen en el mismo cajón: no hay jerarquía que reproducir y el
   usuario puede publicar cualquier cosa, no solo elevación.           */
ok(entries.every(e => e.group === api.COP_WMS_OPTS.rootGroup),
  "todas las capas caen en el grupo único de la configuración");
/* Sin exclusiones: a diferencia del PNOA, aquí no hay ninguna capa que
   sobre, así que nada debe filtrarse por nombre.                      */
ok(api.COP_WMS_OPTS.exclude.size === 0, "Copernicus no excluye ninguna capa por nombre");

/* La primera capa es el valor por defecto (lo que hace pickDefault de la
   fuente): no hay criterio mejor, el orden lo decide el usuario.      */
ok(entries[0].name === "DEM", "la primera capa declarada es la que se ofrece por defecto");

/* Una configuración sin capas no debe producir un selector vacío */
ok(api.parseWmsCapabilities("<WMS_Capabilities><Capability><Layer><Title>Sin capas</Title>"
  + "</Layer></Capability></WMS_Capabilities>", api.COP_WMS_OPTS) === null,
  "una configuración que no publica capas devuelve null");

/* ---------- Error real del servicio ----------
   Cuerpo capturado del servicio real al pedir GetCapabilities con un
   instance ID inexistente: llega con HTTP 400, así que quedarse en el
   código HTTP perdería el texto que explica el problema.              */
const invalidId = `<?xml version='1.0' encoding="UTF-8"?>
<ServiceExceptionReport version="1.3.0"
\txmlns="http://www.opengis.net/ogc"
\txmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
\t<ServiceException>
\t\t<![CDATA[ Invalid instance id: 00000000-0000-0000-0000-000000000000 ]]>
\t</ServiceException>
</ServiceExceptionReport>`;
const ex = api.parseWmsServiceException(invalidId);
ok(ex && /Invalid instance id/.test(ex.msg),
  "el 'Invalid instance id' del servicio se reconoce y se puede mostrar: " + (ex && ex.msg));
ok(api.parseWmsServiceException(caps) === null,
  "un GetCapabilities correcto no se confunde con una excepción");

if (!process.exitCode) console.log("COPERNICUS / SENTINEL HUB TESTS OK");
