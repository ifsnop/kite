/* Copernicus DEM vía Sentinel Hub: validación del instance ID y lectura
   del GetCapabilities de una configuración de usuario.

   Por qué esta vía y no un WMS anónimo de Copernicus: comprobado contra
   los servicios reales (agosto/septiembre de 2026), no existe. El de la
   EEA (EU-DEM v1.1) está retirado —su MapServer responde "not started" y
   su WMSServer da 404— y el mirror de AWS sirve COG sin cabeceras CORS,
   ilegible desde el navegador. Sentinel Hub es la única vía viva y
   autentica con el instance ID de la cuenta del usuario.              */
const { DOMParser } = require("@xmldom/xmldom");
const { fn, between } = require("./_extract");
const helpers = between("/* Nombre sin prefijo", "/* KML usa color");
/* Las constantes de la sección de Copernicus (COP_WMS_BASE..COP_WMS_OPTS) */
const copConsts = between("const COP_WMS_BASE", "let shInstanceId");
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

/* ---------- Cambiar la credencial con una consulta en vuelo ----------
   `setInstanceId` invalida catálogo, error y consulta en curso, pero la
   petición YA lanzada sigue su camino: lo que conteste no es de la
   credencial nueva y no debe pisar nada suyo. Se prueba la función real
   con un `fetch` que se resuelve a mano, y el estado como lo deja
   `setInstanceId` (lo que éste hace con la capa y el panel no importa).  */
const raceSrc = [fn("shWmsUrl"), fn("fetchCopernicusCatalog")].join("\n");
function newRace() {
  const pending = [];                                  /* consultas en vuelo */
  const fetchStub = url => new Promise((resolve, reject) => pending.push({ url, resolve, reject }));
  const reply = (p, body, status = 200) => p.resolve({ ok: status < 400, status, text: async () => body });
  const make = new Function("fetch", `
    const COP_WMS_BASE = "https://sh.test/", COP_TIMEOUT = 5000, COP_WMS_OPTS = {};
    const parseWmsServiceException = t => /^error:/.test(t) ? { msg: t.slice(6) } : null;
    const parseWmsCapabilities = t => /^caps:/.test(t) ? t.slice(5).split(",").map(name => ({ name })) : null;
    const describeHttp = s => "HTTP " + s, netFailText = g => g;
    let shInstanceId = null, copCatalog = null, copError = null, copDiscovering = null;
    ${raceSrc}
    return {
      fetchCopernicusCatalog,
      state: () => ({ copCatalog, copError, copDiscovering }),
      /* lo que hace setInstanceId con el estado de este módulo */
      setId(id) { shInstanceId = id || null; copCatalog = null; copError = null; copDiscovering = null; }
    };`);
  return { ...make(fetchStub), pending, reply };
}
const quiet = p => p.catch(() => {});
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  /* 1. Camino normal: sin cambio de credencial, el catálogo queda */
  let t = newRace();
  t.setId("A");
  const a1 = t.fetchCopernicusCatalog();
  ok(t.pending.length === 1 && t.pending[0].url.startsWith("https://sh.test/A?"), "la consulta lleva el ID de A");
  t.reply(t.pending[0], "caps:uno,dos");
  await a1;
  ok(t.state().copCatalog && t.state().copCatalog.length === 2, "sin cambios, el catálogo se guarda");

  /* 2. A cambia a B con la consulta de A en vuelo; B contesta primero y A después */
  t = newRace();
  t.setId("A");
  const pa = quiet(t.fetchCopernicusCatalog());
  t.setId("B");
  const pb = quiet(t.fetchCopernicusCatalog());
  ok(t.pending.length === 2 && t.pending[1].url.startsWith("https://sh.test/B?"), "B lanza su propia consulta");
  t.reply(t.pending[1], "caps:de-b");
  await pb;
  t.reply(t.pending[0], "caps:de-a");
  await pa;
  const s2 = t.state();
  ok(s2.copCatalog && s2.copCatalog.map(e => e.name).join() === "de-b",
    "la respuesta tardía de A NO pisa el catálogo de B: " + JSON.stringify(s2.copCatalog));

  /* 3. Lo mismo con A contestando primero: no puede dejar su catálogo mientras B vuela */
  t = newRace();
  t.setId("A");
  const pa3 = quiet(t.fetchCopernicusCatalog());
  t.setId("B");
  const pb3 = quiet(t.fetchCopernicusCatalog());
  t.reply(t.pending[0], "caps:de-a");
  await pa3;
  ok(t.state().copCatalog === null, "con B aún en vuelo, la respuesta de A no deja catálogo");
  t.reply(t.pending[1], "caps:de-b");
  await pb3;
  ok(t.state().copCatalog.map(e => e.name).join() === "de-b", "y al llegar B, el suyo");

  /* 4. Credencial borrada con la consulta en vuelo: nada queda */
  t = newRace();
  t.setId("A");
  const pa4 = quiet(t.fetchCopernicusCatalog());
  t.setId(null);
  t.reply(t.pending[0], "caps:de-a");
  await pa4;
  ok(t.state().copCatalog === null, "con la credencial borrada, la respuesta de A no deja catálogo");

  /* 5. El fallo de A no pisa el error de B ni suelta su consulta en curso */
  t = newRace();
  t.setId("A");
  const pa5 = quiet(t.fetchCopernicusCatalog());
  t.setId("B");
  const pb5 = quiet(t.fetchCopernicusCatalog());
  const discB = t.state().copDiscovering;
  t.reply(t.pending[0], "error:Invalid instance id", 400);
  await pa5;
  ok(t.state().copError === null, "el error de A no se muestra con la credencial B: " + t.state().copError);
  ok(t.state().copDiscovering === discB && discB !== null,
    "ni suelta la consulta de B (otra llamada no debe lanzar una duplicada)");
  const antes = t.pending.length;
  quiet(t.fetchCopernicusCatalog());
  ok(t.pending.length === antes, "una llamada mientras B vuela reutiliza su consulta");
  t.reply(t.pending[1], "error:otro fallo", 400);
  await pb5;
  ok(t.state().copError === "otro fallo", "el error de B, que es el vigente, sí se guarda: " + t.state().copError);
  ok(t.state().copDiscovering === null, "y permite reintentar");

  /* 6. A → B → A: la consulta de A vuelve a ser la vigente y vale */
  t = newRace();
  t.setId("A");
  const pa6 = quiet(t.fetchCopernicusCatalog());
  t.setId("B"); t.setId("A");
  t.reply(t.pending[0], "caps:de-a");
  await pa6;
  ok(t.state().copCatalog && t.state().copCatalog.map(e => e.name).join() === "de-a",
    "si la credencial vuelve a ser A, la respuesta de A es válida");
  await tick();

  if (!process.exitCode) console.log("COPERNICUS / SENTINEL HUB TESTS OK");
})();

