/* Parcela catastral (65-cadastre.js): lo puro, sobre el código ENTREGADO.
   Las respuestas de tests/fixtures/catastro-*.xml son las REALES del
   Catastro (octubre de 2026); lo sintético cubre lo que el servicio real
   no da a voluntad: agujeros, varias partes, Latin-1 con tildes y datos
   hostiles. La parte con red y árbol está en browser/cadastre.mjs.     */
const fs = require("fs");
const path = require("path");
const { DOMParser } = require("@xmldom/xmldom");
const { fn, between } = require("./_extract");

const helpers = between("/* Nombre sin prefijo", "/* KML usa color");
const pure = between("/* ===== Parcela catastral", "/* ---------- Red y árbol");
const src = helpers + "\n" + fn("text") + "\n" + pure + "\n" + fn("readCapped") + "\n"
  + "return { validRefcat, cadastreCoordUrl, cadastreParcelUrl, decodeXmlBytes, parseCadastreXml,"
  + " parseRccoor, parseCadastralParcel, cadastreProps, cadastreFeature, readCapped,"
  + " CADASTRE_MAX_VERTICES, CADASTRE_MAX_BYTES };";
const api = new Function("DOMParser", src)(DOMParser);

let failed = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.error("FAIL: " + m); } };
const fixture = n => fs.readFileSync(path.join(__dirname, "fixtures", n));
const xml = bytes => api.parseCadastreXml(api.decodeXmlBytes(bytes));
const throwsWith = (f, re, m) => {
  try { f(); ok(false, m + " (no lanzó)"); } catch (e) { ok(re.test(e.message), `${m}: «${e.message}»`); }
};

/* ---- Referencia catastral: entrada ajena que acaba en una dirección ---- */
ok(api.validRefcat("0443112VK4704C") === "0443112VK4704C", "referencia válida");
ok(api.validRefcat("  0443112vk4704c ") === "0443112VK4704C", "minúsculas y espacios se normalizan");
for (const bad of ["", "0443112VK4704", "0443112VK4704CX", "0443112VK470 C", "0443112VK4704&", "../etc/passwd...", null, undefined, 14, {}]) {
  ok(api.validRefcat(bad) === null, `referencia inválida rechazada: ${JSON.stringify(bad)}`);
}

/* ---- Direcciones ---- */
{
  const u = api.cadastreCoordUrl({ lat: 40.4153, lng: -3.7038 });
  ok(u.startsWith("https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR?"), "RCCOOR: servidor");
  ok(u.includes("SRS=EPSG:4326"), "RCCOOR: SRS");
  ok(u.includes("Coordenada_X=-3.7038000") && u.includes("Coordenada_Y=40.4153000"), "RCCOOR: X es la longitud e Y la latitud");
  throwsWith(() => api.cadastreCoordUrl({ lat: NaN, lng: 1 }), /coordenadas/, "latitud NaN");
  throwsWith(() => api.cadastreCoordUrl(null), /coordenadas/, "sin punto");
  const p = api.cadastreParcelUrl("0443112vk4704c");
  ok(p.startsWith("https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx?service=wfs&version=2.0.0&request=GetFeature"), "WFS: servidor y petición");
  ok(p.includes("STOREDQUERIE_ID=GetParcel") && p.includes("refcat=0443112VK4704C") && p.includes("srsname=EPSG::4326"), "WFS: consulta, referencia en mayúsculas y CRS");
  throwsWith(() => api.cadastreParcelUrl("x&y=1"), /referencia/, "una referencia con caracteres de dirección no llega a la URL");
}

/* ---- Consulta_RCCOOR real ---- */
{
  const r = api.parseRccoor(xml(fixture("catastro-rccoor-madrid.xml")));
  ok(r.rc === "0443112VK4704C", "RCCOOR real: pc1+pc2 = " + r.rc);
  ok(r.address === "CL PAZ 11 MADRID (MADRID)", "RCCOOR real: dirección = " + r.address);
  const none = api.parseRccoor(xml(fixture("catastro-rccoor-none.xml")));
  ok(none.none === true && !none.rc, "RCCOOR real sin parcela (cod 16): none");
  throwsWith(() => api.parseRccoor(api.parseCadastreXml("<a><b/></a>")), /formato/, "RCCOOR sin coord ni lerr");
  throwsWith(() => api.parseRccoor(api.parseCadastreXml(
    "<c><coordenadas><coord><pc><pc1>../..</pc1><pc2>x</pc2></pc></coord></coordenadas></c>")), /formato/, "RCCOOR con referencia hostil");
}

/* ---- GetParcel real ---- */
{
  const p = api.parseCadastralParcel(xml(fixture("catastro-parcela-madrid.xml")));
  ok(p.rc === "0443112VK4704C", "parcela real: referencia");
  ok(p.area === 1377, "parcela real: superficie 1377 m² = " + p.area);
  ok(p.label === "12", "parcela real: etiqueta");
  ok(p.since === "2002-01-22", "parcela real: fecha de alta = " + p.since);
  ok(p.geometry.type === "Polygon" && p.geometry.coordinates.length === 1, "parcela real: un polígono sin agujeros");
  const ring = p.geometry.coordinates[0];
  ok(ring.length === 35, "parcela real: 35 puntos (count del servicio), son " + ring.length);
  ok(ring[0][0] === -3.703981 && ring[0][1] === 40.415538, "parcela real: [lon, lat], invertido respecto del GML");
  ok(ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1], "anillo cerrado");
  ok(ring.every(([lon, lat]) => lon > -3.71 && lon < -3.70 && lat > 40.41 && lat < 40.42), "todos los puntos caen en Madrid, centro");

  const props = api.cadastreProps(p, "CL PAZ 11 MADRID (MADRID)");
  ok(props["Referencia catastral"] === "0443112VK4704C" && props["Dirección"] === "CL PAZ 11 MADRID (MADRID)"
    && props["Superficie catastral (m²)"] === 1377 && props["Fecha de alta"] === "2002-01-22" && props["Etiqueta"] === "12",
    "ficha completa");
  ok(Object.keys(api.cadastreProps({ rc: "0443112VK4704C", area: null, label: null, since: null }, null)).length === 1,
    "lo que no hay no se escribe");
  const f = api.cadastreFeature(p, null);
  ok(f.type === "Feature" && f.geometry === p.geometry && f.properties["Referencia catastral"], "Feature de GeoJSON");
}

/* ---- Excepción OGC real (HTTP 200) ---- */
{
  let err = null;
  try { api.parseCadastralParcel(xml(fixture("catastro-parcela-error.xml"))); } catch (e) { err = e; }
  ok(err && /No se ha encontrado la parcela/.test(err.message), "ExceptionReport: el texto del servicio");
  ok(err && err.owsCode === "OperationProcessingFailed", "ExceptionReport: owsCode (no se reintenta)");
}

/* ---- Sintético: agujeros, varias partes, tildes, hostil ---- */
const gml = ({ rc = "1234567AB1234C", srs = "http://www.opengis.net/def/crs/EPSG/0/4326", patches, extra = "" }) => `<?xml version="1.0" encoding="ISO-8859-1"?>
<FeatureCollection xmlns="http://www.opengis.net/wfs/2.0" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:cp="http://inspire.ec.europa.eu/schemas/cp/4.0"><member>
<cp:CadastralParcel gml:id="x"><cp:areaValue uom="m2">500</cp:areaValue>
<cp:geometry><gml:MultiSurface srsName="${srs}"><gml:surfaceMember><gml:Surface><gml:patches>${patches}</gml:patches></gml:Surface></gml:surfaceMember></gml:MultiSurface></cp:geometry>
<cp:nationalCadastralReference>${rc}</cp:nationalCadastralReference>${extra}</cp:CadastralParcel></member></FeatureCollection>`;
const ringXml = (tag, coords, attrs = "") => `<gml:${tag}><gml:LinearRing><gml:posList ${attrs}>${coords}</gml:posList></gml:LinearRing></gml:${tag}>`;
const SQ = "10 20 10 21 11 21 11 20 10 20";
const HOLE = "10.2 20.2 10.2 20.4 10.4 20.4 10.4 20.2 10.2 20.2";
const parse = o => api.parseCadastralParcel(api.parseCadastreXml(gml(o)));
{
  const withHole = parse({ patches: `<gml:PolygonPatch>${ringXml("exterior", SQ, 'srsDimension="2" count="5"')}${ringXml("interior", HOLE)}</gml:PolygonPatch>` });
  ok(withHole.geometry.type === "Polygon" && withHole.geometry.coordinates.length === 2, "agujero: anillo exterior + interior");
  ok(withHole.geometry.coordinates[1][0][0] === 20.2 && withHole.geometry.coordinates[1][0][1] === 10.2, "agujero: también [lon, lat]");

  const multi = parse({ patches: `<gml:PolygonPatch>${ringXml("exterior", SQ)}</gml:PolygonPatch><gml:PolygonPatch>${ringXml("exterior", "30 40 30 41 31 41 31 40 30 40")}</gml:PolygonPatch>` });
  ok(multi.geometry.type === "MultiPolygon" && multi.geometry.coordinates.length === 2, "varias partes: MultiPolygon");

  const open = parse({ patches: `<gml:PolygonPatch>${ringXml("exterior", "10 20 10 21 11 21 11 20")}</gml:PolygonPatch>` });
  ok(open.geometry.coordinates[0].length === 5, "anillo sin cerrar: se cierra");

  const dim3 = parse({ patches: `<gml:PolygonPatch>${ringXml("exterior", "10 20 5 10 21 5 11 21 5 11 20 5 10 20 5", 'srsDimension="3"')}</gml:PolygonPatch>` });
  ok(dim3.geometry.coordinates[0].length === 5 && dim3.geometry.coordinates[0][1][0] === 21, "srsDimension 3: la altura se descarta");

  const noMeta = parse({ patches: `<gml:PolygonPatch>${ringXml("exterior", SQ)}</gml:PolygonPatch>` });
  ok(noMeta.label === null && noMeta.since === null && noMeta.area === 500, "sin etiqueta ni fecha: null; la superficie sí");
  const badArea = api.parseCadastralParcel(api.parseCadastreXml(gml({ patches: `<gml:PolygonPatch>${ringXml("exterior", SQ)}</gml:PolygonPatch>` }).replace(">500<", ">mucho<")));
  ok(badArea.area === null, "superficie ilegible: null, no NaN");
  const badDate = parse({ patches: `<gml:PolygonPatch>${ringXml("exterior", SQ)}</gml:PolygonPatch>`, extra: "<cp:beginLifespanVersion>ayer por la tarde</cp:beginLifespanVersion>" });
  ok(badDate.since === null, "fecha ilegible: null");
}
{
  const patch = c => `<gml:PolygonPatch>${ringXml("exterior", c.coords || SQ, c.attrs || "")}</gml:PolygonPatch>`;
  throwsWith(() => parse({ patches: patch({ coords: "10 20 10 abc 11 21 11 20 10 20" }) }), /geometría/, "coordenada no numérica");
  throwsWith(() => parse({ patches: patch({ coords: "10 20 10 NaN 11 21 11 20 10 20" }) }), /geometría/, "coordenada NaN");
  throwsWith(() => parse({ patches: patch({ coords: "10 20 10 Infinity 11 21 11 20 10 20" }) }), /geometría/, "coordenada infinita");
  throwsWith(() => parse({ patches: patch({ coords: "95 20 10 21 11 21 11 20 95 20" }) }), /geometría/, "latitud fuera de rango");
  throwsWith(() => parse({ patches: patch({ coords: "10 200 10 21 11 21 11 20 10 200" }) }), /geometría/, "longitud fuera de rango");
  throwsWith(() => parse({ patches: patch({ attrs: 'count="9"' }) }), /geometría/, "count que no cuadra");
  throwsWith(() => parse({ patches: patch({ coords: "10 20 10 21 11 21 11" }) }), /geometría/, "número impar de valores");
  throwsWith(() => parse({ patches: patch({ coords: "10 20 10 21" }) }), /geometría/, "anillo de dos puntos");
  throwsWith(() => parse({ patches: patch({ attrs: 'srsDimension="4"' }) }), /geometría/, "srsDimension 4");
  throwsWith(() => parse({ patches: patch({ coords: " " }) }), /geometría/, "anillo vacío");
  throwsWith(() => parse({ patches: "" }), /geometría/, "sin ninguna parte");
  throwsWith(() => parse({ patches: "<gml:PolygonPatch/>" }), /geometría/, "parte sin anillo exterior");
  throwsWith(() => parse({ srs: "http://www.opengis.net/def/crs/EPSG/0/25830", patches: patch({}) }), /geometría/, "otro CRS: no se sabe el orden de los ejes");
  throwsWith(() => parse({ rc: "no-es-una-referencia", patches: patch({}) }), /formato/, "referencia de la parcela inválida");
  throwsWith(() => api.parseCadastralParcel(api.parseCadastreXml("<a/>")), /formato/, "sin parcela");

  /* Tope de vértices: una parcela de un millón de puntos no se dibuja */
  const n = api.CADASTRE_MAX_VERTICES + 1;
  const big = [];
  for (let i = 0; i < n; i++) big.push(`${(i % 80) + 1} ${(i % 170) + 1}`);
  big.push(big[0]);
  throwsWith(() => parse({ patches: patch({ coords: big.join(" ") }) }), /demasiados/, "tope de vértices");
}

/* ---- XML mal formado y bytes ---- */
throwsWith(() => api.parseCadastreXml(""), /formato/, "respuesta vacía");
{
  /* El WFS declara ISO-8859-1: 0xF1 es «ñ». Leído como UTF-8 saldría «�». */
  const latin = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a><ldt>CL CA\xD1ADA 1 \xC1VILA</ldt></a>', "latin1");
  const doc = xml(latin);
  ok(doc.getElementsByTagName("ldt")[0].textContent === "CL CAÑADA 1 ÁVILA", "ISO-8859-1 declarado: tildes y eñes bien");
  const utf = Buffer.from('<?xml version="1.0" encoding="utf-8"?><a><ldt>CL CAÑADA 1</ldt></a>', "utf8");
  ok(xml(utf).getElementsByTagName("ldt")[0].textContent === "CL CAÑADA 1", "UTF-8 declarado");
  const nodecl = Buffer.from("<a><ldt>CAÑADA</ldt></a>", "utf8");
  ok(xml(nodecl).getElementsByTagName("ldt")[0].textContent === "CAÑADA", "sin declaración: UTF-8");
  const weird = Buffer.from('<?xml version="1.0" encoding="no-existe-9"?><a><ldt>ok</ldt></a>', "utf8");
  ok(xml(weird).getElementsByTagName("ldt")[0].textContent === "ok", "codificación desconocida: UTF-8, sin romper");
  ok(api.decodeXmlBytes(latin.buffer.slice(latin.byteOffset, latin.byteOffset + latin.length)).includes("CAÑADA"), "también con un ArrayBuffer");
}

/* ---- Lectura con tope ---- */
(async () => {
  const fakeResp = (chunks, declared) => {
    let i = 0, cancelled = false;
    return {
      headers: { get: k => (k === "content-length" && declared != null ? String(declared) : null) },
      body: { getReader: () => ({
        read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }),
        cancel: () => { cancelled = true; }
      }) },
      get cancelled() { return cancelled; }
    };
  };
  const got = await api.readCapped(fakeResp([new Uint8Array([1, 2]), new Uint8Array([3])]), 10);
  ok(got.length === 3 && got[2] === 3, "readCapped junta los trozos");
  let err = null;
  try { await api.readCapped(fakeResp([new Uint8Array(6), new Uint8Array(6)]), 10); } catch (e) { err = e; }
  ok(err && /grande/.test(err.message), "readCapped: corta al pasarse aunque no haya content-length");
  const liar = fakeResp([new Uint8Array(6), new Uint8Array(6)], 3);
  err = null;
  try { await api.readCapped(liar, 10); } catch (e) { err = e; }
  ok(err && /grande/.test(err.message) && liar.cancelled, "readCapped: content-length que miente, y se cancela la lectura");
  const huge = fakeResp([new Uint8Array(1)], 11);
  err = null;
  try { await api.readCapped(huge, 10); } catch (e) { err = e; }
  ok(err && /grande/.test(err.message), "readCapped: content-length declarado de más, sin leer nada");

  if (failed) console.error(`\n${failed} FALLO(S), ${passed} correctas`);
  else console.log("CADASTRE TESTS OK");
  process.exit(failed ? 1 : 0);
})();
