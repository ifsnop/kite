/* "Custom Web Map Service": servidor WMS del propio usuario. A diferencia
   de "Custom Tile Map Service" sus capas salen del GetCapabilities del
   servidor, así que aquí se prueban las piezas puras: validación de la
   dirección, normalización (quita los parámetros de OGC que se cuelan al
   pegar una petición entera), URL del GetCapabilities, versión que
   anuncia el servidor, agrupado para el <select> y la lectura de un
   servidor con una sola capa publicada como raíz, y el formato de imagen
   (PNG si lo hay, JPEG si es lo único).                                */
const { DOMParser } = require("@xmldom/xmldom");
const { fn, between } = require("./_extract");
const helpers = between("/* Nombre sin prefijo", "/* KML usa color");
const consts = between("const CUSTOM_WMS_OPTS", "let customWmsUrl");
const src = "const parserErrorText = () => null;\n" + helpers + consts + [
  fn("directChildText"), fn("collectWmsLayers"), fn("parseWmsCapabilities"),
  fn("validCustomWmsUrl"), fn("normalizeCustomWmsBase"), fn("customWmsCapabilitiesUrl"),
  fn("wmsCapabilitiesVersion"), fn("wmsGetMapFormat"), fn("groupWmsEntries")].join("\n");
const api = new Function("DOMParser", src +
  "\nreturn {parseWmsCapabilities, validCustomWmsUrl, normalizeCustomWmsBase," +
  " customWmsCapabilitiesUrl, wmsCapabilitiesVersion, wmsGetMapFormat, groupWmsEntries, CUSTOM_WMS_OPTS};")(DOMParser);
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* ---------- Validación: https, forma de URL y sin credenciales ---------- */
ok(api.validCustomWmsUrl("https://mi-servidor.example.org/wms"), "https vale");
ok(api.validCustomWmsUrl("  https://mi-servidor.example.org/wms?map=/x.map  "), "con espacios y consulta propia vale");
ok(!api.validCustomWmsUrl("http://mi-servidor.example.org/wms"), "http no vale");
ok(!api.validCustomWmsUrl("ftp://mi-servidor.example.org/wms"), "otros esquemas no valen");
ok(!api.validCustomWmsUrl("no es una url"), "texto suelto no vale");
ok(!api.validCustomWmsUrl(""), "vacío no vale");
ok(!api.validCustomWmsUrl("https://usuario:clave@mi-servidor.example.org/wms"),
  "con usuario y contraseña no vale (fetch lo rechaza)");

/* ---------- Normalización ---------- */
ok(api.normalizeCustomWmsBase("  https://x.example.org/wms  ") === "https://x.example.org/wms",
  "quita los espacios alrededor");
ok(api.normalizeCustomWmsBase("https://x.example.org/wms?service=WMS&request=GetCapabilities&version=1.3.0")
  === "https://x.example.org/wms", "una petición GetCapabilities pegada entera se queda en la base");
ok(api.normalizeCustomWmsBase("https://x.example.org/wms?SERVICE=WMS&Request=GetMap&LAYERS=a&BBOX=0,0,1,1&WIDTH=256&HEIGHT=256&CRS=EPSG:3857")
  === "https://x.example.org/wms", "los parámetros de OGC se quitan sin distinguir mayúsculas");
/* URLSearchParams reescribe la consulta codificada ("/" → %2F): un
   servidor la decodifica igual, y es la forma que conserva el valor. */
ok(api.normalizeCustomWmsBase("https://x.example.org/cgi-bin/mapserv?map=/data/a.map&service=WMS")
  === "https://x.example.org/cgi-bin/mapserv?map=%2Fdata%2Fa.map", "los parámetros propios del servidor se conservan");
ok(api.normalizeCustomWmsBase("https://x.example.org/wms#ancla") === "https://x.example.org/wms", "sin ancla");

/* ---------- URL del GetCapabilities ---------- */
ok(api.customWmsCapabilitiesUrl("https://x.example.org/wms")
  === "https://x.example.org/wms?service=WMS&request=GetCapabilities&version=1.3.0",
  "GetCapabilities sobre una base sin consulta");
ok(api.customWmsCapabilitiesUrl("https://x.example.org/cgi-bin/mapserv?map=/data/a.map")
  === "https://x.example.org/cgi-bin/mapserv?map=%2Fdata%2Fa.map&service=WMS&request=GetCapabilities&version=1.3.0",
  "y sobre una con consulta propia, sin un segundo «?»");

/* ---------- Versión que anuncia el servidor ---------- */
const v = ver => {
  const root = ver === "1.1.1" ? "WMT_MS_Capabilities" : "WMS_Capabilities";
  return api.wmsCapabilitiesVersion(`<?xml version="1.0"?><${root} version="${ver}"><Service/></${root}>`);
};
ok(v("1.3.0") === "1.3.0", "1.3.0");
ok(v("1.1.1") === "1.1.1", "1.1.1 (WMT_MS_Capabilities)");
ok(v("1.0.0") === "1.3.0", "una versión que no se sabe pedir vuelve a 1.3.0");
ok(api.wmsCapabilitiesVersion("<html>no es xml de WMS</html>") === "1.3.0", "sin raíz reconocible, 1.3.0");
ok(api.wmsCapabilitiesVersion(`<wms:WMS_Capabilities xmlns:wms="x" version='1.1.0'/>`) === "1.1.0",
  "con prefijo de namespace y comillas simples");

/* ---------- Formato de GetMap: PNG si lo hay, si no JPEG ---------- */
const fmt = (...formats) => api.wmsGetMapFormat(
  `<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms"><Capability><Request>
     <GetCapabilities><Format>text/xml</Format></GetCapabilities>
     <GetMap>${formats.map(f => `<Format>${f}</Format>`).join("")}</GetMap>
     <GetFeatureInfo><Format>image/png</Format></GetFeatureInfo>
   </Request></Capability></WMS_Capabilities>`);
ok(fmt("image/jpeg", "image/png") === "image/png", "con los dos, PNG (transparencia), sea cual sea el orden");
ok(fmt("image/jpeg") === "image/jpeg", "un servidor que solo sirve JPEG");
ok(fmt("image/jpeg", "image/gif") === "image/jpeg", "JPEG aunque lo otro no sepamos pedirlo");
ok(fmt("image/jpg") === "image/jpg", "el alias image/jpg tal cual lo declara el servidor");
ok(fmt("image/PNG; mode=8bit") === "image/png", "los parámetros y las mayúsculas se ignoran, y se pide el tipo a secas");
ok(fmt("image/tiff", "image/gif") === "image/png", "sin ninguno de los que sabemos pedir, PNG (fallará a la vista)");
ok(fmt() === "image/png", "un <GetMap> sin formatos, PNG");
ok(api.wmsGetMapFormat("<html>no es xml de WMS</html>") === "image/png", "sin GetMap reconocible, PNG");
ok(api.wmsGetMapFormat(`<WMS_Capabilities><Capability><Request><GetFeatureInfo><Format>image/jpeg</Format></GetFeatureInfo></Request></Capability></WMS_Capabilities>`) === "image/png",
  "los formatos de otra operación (GetFeatureInfo) no cuentan");

/* ---------- Capas: grupos y servidor de una sola capa ---------- */
const nested = `<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms"><Capability>
  <Layer><Title>Servidor</Title>
    <Layer><Name>suelta</Name><Title>Capa suelta</Title></Layer>
    <Layer><Title>Hidrografía</Title>
      <Layer><Name>rios</Name><Title>Ríos</Title><Style><Name>default</Name></Style></Layer>
      <Layer><Name>lagos</Name><Title>Lagos</Title></Layer>
    </Layer>
  </Layer></Capability></WMS_Capabilities>`;
const entries = api.parseWmsCapabilities(nested, api.CUSTOM_WMS_OPTS);
ok(entries && entries.length === 3, "tres capas con nombre: " + JSON.stringify(entries));
const groups = api.groupWmsEntries(entries);
ok(groups.length === 2 && groups[0].group === "Capas del servidor" && groups[1].group === "Hidrografía",
  "grupos en el orden del servidor: " + JSON.stringify(groups.map(g => g.group)));
ok(groups[1].items.map(e => e.name).join() === "rios,lagos", "y cada capa en su grupo");

const single = `<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms"><Capability>
  <Layer><Name>unica</Name><Title>Única capa</Title><CRS>EPSG:3857</CRS></Layer>
  </Capability></WMS_Capabilities>`;
const one = api.parseWmsCapabilities(single, api.CUSTOM_WMS_OPTS);
ok(one && one.length === 1 && one[0].name === "unica" && one[0].title === "Única capa",
  "una raíz con nombre y sin hijos es LA capa: " + JSON.stringify(one));
const rootOnlyGroup = api.parseWmsCapabilities(
  `<WMS_Capabilities xmlns="http://www.opengis.net/wms"><Capability><Layer><Title>Solo título</Title></Layer></Capability></WMS_Capabilities>`,
  api.CUSTOM_WMS_OPTS);
ok(rootOnlyGroup === null, "una raíz sin nombre ni hijos no aporta nada");
const rootWithKids = api.parseWmsCapabilities(
  `<WMS_Capabilities xmlns="http://www.opengis.net/wms"><Capability><Layer><Name>todas</Name><Title>Todas</Title>
     <Layer><Name>a</Name><Title>A</Title></Layer></Layer></Capability></WMS_Capabilities>`, api.CUSTOM_WMS_OPTS);
ok(rootWithKids.length === 1 && rootWithKids[0].name === "a", "con hijos, la raíz solo los agrupa (no se duplica)");

if (!process.exitCode) console.log("CUSTOM WMS TESTS OK");
