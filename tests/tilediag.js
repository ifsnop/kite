/* Teselas que un servidor propio no entrega: `tileFailureReason` dice, en
   una línea, qué contestó el servidor en lugar de la imagen. Es lo que
   leen los avisos de «Custom Web Map Service»/«Custom Tile Map Service»
   cuando una tesela vuelve con error (el contorno rojo y la petición de
   diagnóstico se prueban en tests/browser/custom-wms.mjs).             */
const { DOMParser } = require("@xmldom/xmldom");
const { fn, between } = require("./_extract");
const helpers = between("/* Nombre sin prefijo", "/* KML usa color");
const src = "const parserErrorText = () => null;\n" + helpers + "const TILE_REASON_MAX = 200;\n"
  + [fn("describeHttp"), fn("parseWmsServiceException"), fn("tileFailureReason")].join("\n");
const api = new Function("DOMParser", src + "\nreturn { tileFailureReason };")(DOMParser);
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const why = api.tileFailureReason;

const exc = msg => `<?xml version="1.0"?><ServiceExceptionReport version="1.3.0" xmlns="http://www.opengis.net/ogc"><ServiceException code="X">${msg}</ServiceException></ServiceExceptionReport>`;

ok(why(200, "image/png", "") === null, "una imagen no es un fallo");
ok(why(200, "image/jpeg; charset=x", "") === null, "ni con parámetros en el tipo");
ok(why(200, "text/xml;charset=utf-8", exc("Creating maps using image/png is not allowed"))
  === "Creating maps using image/png is not allowed",
  "el error OGC viaja con HTTP 200: se lee el mensaje del cuerpo");
ok(why(200, "text/xml", exc("  con espacios  ")) === "con espacios", "sin espacios alrededor");
ok(why(200, "text/xml", exc("")) === "excepción del servicio sin mensaje",
  "una excepción vacía (la que da GeoServer al fallar el codificador JPEG) lo dice, no queda en blanco");
ok(why(400, "text/xml", exc("Invalid layer")) === "Invalid layer", "el mensaje del cuerpo gana al código HTTP");
ok(/no existe \(HTTP 404\)/.test(why(404, "text/html", "<html>no</html>")),
  "sin excepción OGC, con HTTP de error: el texto de describeHttp: " + why(404, "text/html", ""));
ok(/no est\u00e1 disponible \(HTTP 503\)/.test(why(503, "text/plain", "")), "también un 5xx: " + why(503, "text/plain", ""));
ok(why(200, "text/html; charset=utf-8", "<html>login</html>") === "respuesta text/html en vez de una imagen",
  "200 con una página en vez de una imagen: lo dice");
ok(why(200, "", "x") === "respuesta sin tipo en vez de una imagen", "sin tipo de contenido");
const largo = why(200, "text/xml", exc("x".repeat(500)));
ok(largo.length === 201 && largo.endsWith("…"), "un mensaje largo se corta (200 + puntos suspensivos): " + largo.length);

if (!process.exitCode) console.log("TILE DIAGNOSIS TESTS OK");
