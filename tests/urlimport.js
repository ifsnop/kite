/* Reconocer lo que llega de una dirección (URL).

   El botón 🔗 descarga lo que el usuario pegue, y lo que llega no viene
   con ninguna promesa de qué es: media web sirve un GeoJSON desde una
   ruta que no termina en nada, y quien pega la página de GitHub en vez
   del enlace «Raw» se trae un HTML. De ahí estas funciones, y de ahí
   que sean PURAS: deciden mirando el contenido, sin DOM ni red, que es
   justo lo que se puede comprobar aquí.

   Lo que NO se prueba aquí —que el diálogo encadene sus dos pasos, que
   cancelar aborte de verdad, que el nodo acabe en el árbol— está en
   tests/browser/url-import.mjs, porque hace falta un navegador.      */
const { fn, constDecl, between } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* EXPORT_KIND y EXPORT_EXT viven en otro archivo del script: sin ellos,
   sniffJsonKind no sabría reconocer una carpeta exportada.           */
const src = constDecl("EXPORT_KIND") + "\n" + constDecl("EXPORT_EXT") + "\n"
  + constDecl("safeFileName") + "\n" + constDecl("KMZ_MAX_ENTRIES") + "\n"
  + between("/* ---------- Reconocimiento de lo descargado de una dirección",
            "/* ================= Acciones del panel");
const api = new Function(src + `\nreturn { fileNameFromUrl, isZipSignature, sniffJsonKind,
  sniffTextKind, sniffContentKind, downloadFileName, URL_KIND_EXT, URL_KIND_LABEL, zipEntryNames };`)();
const { fileNameFromUrl, isZipSignature, sniffTextKind, sniffContentKind,
        downloadFileName, URL_KIND_EXT, URL_KIND_LABEL, zipEntryNames } = api;

/* Un zip mínimo de verdad (entradas vacías, sin comprimir), con su
   directorio central y su registro final: lo que lee zipEntryNames.  */
function makeZip(names, comment = "") {
  const enc = new TextEncoder();
  const local = [], central = [];
  let offset = 0;
  for (const name of names) {
    const n = enc.encode(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034B50, 0); lh.writeUInt16LE(n.length, 26);
    local.push(lh, Buffer.from(n));
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014B50, 0); ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, Buffer.from(n));
    offset += 30 + n.length;
  }
  const cd = Buffer.concat(central);
  const c = enc.encode(comment);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(c.length, 20);
  return new Uint8Array(Buffer.concat([...local, cd, end, Buffer.from(c)]));
}

/* ---------- El nombre que sugiere una dirección ---------- */
ok(fileNameFromUrl("https://ejemplo.com/datos/rutas.kml") === "rutas.kml",
  "último segmento de la ruta: " + fileNameFromUrl("https://ejemplo.com/datos/rutas.kml"));
ok(fileNameFromUrl("https://ejemplo.com/rutas.kml?v=3#zona") === "rutas.kml",
  "la consulta y el fragmento no son parte del nombre: "
  + fileNameFromUrl("https://ejemplo.com/rutas.kml?v=3#zona"));
ok(fileNameFromUrl("https://ejemplo.com/a/b/") === "b",
  "una barra final no deja el nombre vacío: " + fileNameFromUrl("https://ejemplo.com/a/b/"));
/* Sin ruta útil se usa el host: al menos dice de dónde salió */
ok(fileNameFromUrl("https://ejemplo.com/") === "ejemplo.com",
  "la raíz de un sitio cae en su host: " + fileNameFromUrl("https://ejemplo.com/"));
ok(fileNameFromUrl("https://ejemplo.com/mis%20rutas.kml") === "mis rutas.kml",
  "se decodifica el %20: " + fileNameFromUrl("https://ejemplo.com/mis%20rutas.kml"));
/* safeFileName quita lo que no puede ir en un nombre; una ruta de URL
   sí puede traerlo (`:` y `*` son legales ahí).                      */
ok(!/[\\/:*?"<>|]/.test(fileNameFromUrl("https://ejemplo.com/a:b*c.kml")),
  "se sanea lo que no puede ir en un nombre: " + fileNameFromUrl("https://ejemplo.com/a:b*c.kml"));
ok(fileNameFromUrl("no es una url") === "", "lo que no es una URL no da nombre");
ok(fileNameFromUrl("") === "", "ni una cadena vacía");

/* ---------- Firma de zip ---------- */
const zip = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0, 0]);
ok(isZipSignature(zip) === true, "PK\\x03\\x04 es un zip");
ok(isZipSignature(new Uint8Array([0x50, 0x4B])) === false, "«PK» a secas no basta");
ok(isZipSignature(new Uint8Array([0x3C, 0x6B, 0x6D, 0x6C])) === false, "«<kml» no es un zip");
ok(isZipSignature(new Uint8Array([])) === false, "ni nada vacío");
ok(isZipSignature(null) === false, "ni null");

/* ---------- Tipo por el texto ---------- */
ok(sniffTextKind('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"></kml>') === "kml",
  "un KML con prólogo XML");
ok(sniffTextKind("<kml:kml xmlns:kml='x'></kml:kml>") === "kml",
  "y con prefijo de namespace, que es la regla de todo el parseo de KML");
ok(sniffTextKind("﻿   <kml></kml>") === "kml", "con BOM y blancos delante");
/* El diagnóstico más útil de todos: pegar la página en vez del «Raw» */
ok(sniffTextKind("<!DOCTYPE html><html><body>…") === "html", "una página HTML se reconoce como tal");
ok(sniffTextKind("<html lang='es'>") === "html", "aunque no traiga DOCTYPE");
ok(sniffTextKind("<gpx version='1.1'></gpx>") === "gpx", "un GPX se reconoce");
ok(sniffTextKind('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><wpt lat="1" lon="2"/></gpx>') === "gpx", "con prólogo y namespace");
ok(sniffTextKind("<g:gpx xmlns:g='x'></g:gpx>") === "gpx", "y con prefijo");
ok(sniffTextKind('<?xml version="1.0"?><ServiceExceptionReport/>') === null, "otro XML (una excepción OGC) sigue sin ser nuestro");
ok(sniffTextKind('{"type":"FeatureCollection","features":[]}') === "geojson", "FeatureCollection");
ok(sniffTextKind('{"type":"Feature","geometry":null}') === "geojson", "un Feature suelto");
ok(sniffTextKind('{"type":"Polygon","coordinates":[]}') === "geojson", "una geometría suelta");
ok(sniffTextKind('{"type":"Topology","objects":{}}') === "topojson", "TopoJSON");
ok(sniffTextKind('{"app":"kite-local/tree","nodes":[]}') === "kite", "una carpeta exportada");
/* Un JSON que no es ninguno de los nuestros no se cuela */
ok(sniffTextKind('{"type":"Cualquiera"}') === null, "otro JSON cualquiera no vale");
ok(sniffTextKind('{"a":1}') === null, "ni un objeto sin type");
ok(sniffTextKind('{"type":"FeatureCollection",') === null, "ni un JSON truncado");
ok(sniffTextKind("hola") === null, "ni texto suelto");
ok(sniffTextKind("") === null, "ni nada");

/* ---------- Tipo por bytes + texto ---------- */
ok(sniffContentKind(zip, "PKbasura") === "kmz",
  "los bytes mandan: un zip es KMZ aunque su texto sea ilegible");
ok(sniffContentKind(new Uint8Array([0x3C]), "<kml></kml>") === "kml",
  "y si no es zip, decide el texto");

/* ---------- Dentro del zip: KMZ o shapefile ---------- */
ok(JSON.stringify(zipEntryNames(makeZip(["doc.kml", "files/a.png"]))) === '["doc.kml","files/a.png"]',
  "zipEntryNames lee los nombres del directorio central: " + JSON.stringify(zipEntryNames(makeZip(["doc.kml", "files/a.png"]))));
ok(zipEntryNames(makeZip(["x.shp"], "comentario del zip")).join() === "x.shp",
  "también con comentario al final, que desplaza el registro final");
ok(zipEntryNames(new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0, 0])).length === 0,
  "un zip truncado (sin directorio) no lanza: lista vacía");
const shpZip = makeZip(["capas/vias.shp", "capas/vias.dbf", "capas/vias.prj"]);
ok(sniffContentKind(shpZip, "") === "shpzip", "un zip con .shp y sin .kml es un shapefile");
ok(sniffContentKind(makeZip(["doc.kml", "x.shp"]), "") === "kmz",
  "con .kml manda el KML, aunque traiga un .shp");
ok(sniffContentKind(makeZip(["leeme.txt"]), "") === "kmz",
  "un zip sin ninguno de los dos se sigue tratando como KMZ (y su aviso lo explica)");
ok(downloadFileName("https://x.com/vias.zip", "shpzip") === "vias.zip", "un .zip se respeta");
ok(downloadFileName("https://x.com/ruta.gpx", "gpx") === "ruta.gpx", "un .gpx se respeta");
ok(downloadFileName("https://x.com/descarga?id=7", "gpx") === "descarga.gpx", "sin extensión se le añade .gpx, que es la que despacha handleDroppedFiles");
ok(URL_KIND_EXT.gpx === ".gpx" && URL_KIND_LABEL.gpx === "GPX", "extensión y etiqueta del tipo");
ok(downloadFileName("https://x.com/descarga?id=7", "shpzip") === "descarga.zip",
  "y sin extensión se le pone .zip");

/* ---------- El nombre final, que es el puente con la importación ----------
   handleDroppedFiles despacha por EXTENSIÓN, así que el nombre tiene
   que llevar una que caiga en su rama; si no, lo descargado se
   rechazaría a sí mismo.                                             */
ok(downloadFileName("https://x.com/rutas.kml", "kml") === "rutas.kml",
  "un nombre que ya trae su extensión se respeta");
ok(downloadFileName("https://x.com/datos.geojson", "geojson") === "datos.geojson",
  "un .geojson no se renombra: entra por la misma rama que .json");
ok(downloadFileName("https://x.com/datos.topojson", "topojson") === "datos.topojson",
  "ni un .topojson");
ok(downloadFileName("https://x.com/descarga?id=7", "kml") === "descarga.kml",
  "sin extensión se sintetiza la que toca: "
  + downloadFileName("https://x.com/descarga?id=7", "kml"));
ok(downloadFileName("https://x.com/api/v1/geo", "geojson") === "geo.json",
  "una ruta de API acaba en .json: " + downloadFileName("https://x.com/api/v1/geo", "geojson"));
ok(downloadFileName("https://x.com/export.php", "geojson") === "export.php.json",
  "una extensión ajena se conserva y se le añade la buena: "
  + downloadFileName("https://x.com/export.php", "geojson"));
ok(downloadFileName("https://x.com/", "geojson") === "x.com.json",
  "sin ruta, el host: " + downloadFileName("https://x.com/", "geojson"));
ok(downloadFileName("https://x.com/rama.kite.json", "kite") === "rama.kite.json",
  "una carpeta exportada conserva su doble extensión");
ok(downloadFileName("https://x.com/rama", "kite") === "rama.kite.json",
  "y si no la trae, se le pone entera: " + downloadFileName("https://x.com/rama", "kite"));
ok(downloadFileName("https://x.com/a.kml", "cualquiera") === "",
  "un tipo que no existe no produce nombre");

/* El INVARIANTE: pase lo que pase, la extensión cae en una rama viva de
   handleDroppedFiles. Si alguien añade un tipo y olvida su extensión,
   esto lo caza antes de que se rechace en ejecución.                 */
const RAMAS = [".kml", ".kmz", ".gpx", ".json", ".geojson", ".topojson", ".zip"];
for (const kind of Object.keys(URL_KIND_EXT)) {
  for (const url of ["https://x.com/a", "https://x.com/a.txt", "https://x.com/",
                     "https://x.com/a.kml", "https://x.com/a.json"]) {
    const name = downloadFileName(url, kind).toLowerCase();
    ok(RAMAS.some(e => name.endsWith(e)),
      `«${url}» como ${kind} da un nombre que la importación reconoce: ${name}`);
  }
}

/* Las dos tablas describen el mismo conjunto de tipos: olvidar una
   etiqueta dejaría al usuario leyendo «undefined» al descargar.     */
ok(JSON.stringify(Object.keys(URL_KIND_EXT).sort())
   === JSON.stringify(Object.keys(URL_KIND_LABEL).sort()),
  "URL_KIND_EXT y URL_KIND_LABEL cubren los mismos tipos: "
  + Object.keys(URL_KIND_EXT).sort() + " vs " + Object.keys(URL_KIND_LABEL).sort());
/* Y son exactamente los que devuelven los reconocedores (html aparte,
   que es un diagnóstico, no un formato admitido).                   */
for (const kind of ["kml", "kmz", "gpx", "geojson", "topojson", "kite", "shpzip"]) {
  ok(!!URL_KIND_EXT[kind] && !!URL_KIND_LABEL[kind], `${kind} tiene extensión y etiqueta`);
}

if (!process.exitCode) console.log("URL IMPORT TESTS OK");
