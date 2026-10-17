/* Búsquedas por nombre local en el XML de un KML (12-copernicus.js):
   `elsByTag`, `firstByTag` y `childrenByTag` se reescribieron para no
   copiar colecciones enteras ni repetir, en cada búsqueda vacía, un
   recorrido de todos los descendientes con una llamada por elemento.

   Medido (importar 10 000 marcadores): esas funciones eran el 17 % de la
   importación; cada Placemark buscaba además `Polygon` y `LineString`,
   que no tiene, y cada búsqueda vacía caía al filtrado a mano.

   La suite lleva COPIADA la implementación de antes (`legacy`) y fija:

   1. EQUIVALENCIA: con las dos, sobre documentos con namespace por
      defecto, con prefijo, sin namespace y analizados sin soporte de
      namespaces (un DOM simulado), desde el documento y desde un elemento,
      con nombres que existen y que no, devuelven los mismos elementos
      (los mismos objetos, en el mismo orden).
   2. TRABAJO, determinista: las llamadas `getElementsByTagName("*")` —el
      recorrido de todos los descendientes— que hace el patrón de
      búsquedas de `buildPlacemarkLayer` sobre 3 000 puntos. Antes, dos
      por Placemark como mínimo; ahora, una por documento.
   3. QUE EL RESPALDO SIGUE VIVO donde hace falta: en un documento sin
      soporte de namespaces la ruta lenta se sigue tomando.              */
const { DOMParser } = require("@xmldom/xmldom");
const { fn, between } = require("./_extract");

let failed = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); failed++; } };

/* ---------- La implementación de antes, tal cual ---------- */
const legacy = new Function(`
  function bareName(el) {
    const n = el.localName || el.nodeName || "";
    const i = n.indexOf(":");
    return i < 0 ? n : n.slice(i + 1);
  }
  function elsByTag(root, name) {
    if (!root || !root.getElementsByTagName) return [];
    if (root.getElementsByTagNameNS) {
      const found = [...root.getElementsByTagNameNS("*", name)];
      if (found.length) return found;
    }
    return [...root.getElementsByTagName("*")].filter(el => bareName(el) === name);
  }
  const firstByTag = (root, name) => elsByTag(root, name)[0] || null;
  const childrenByTag = (parent, name) =>
    parent ? [...parent.children].filter(c => bareName(c) === name) : [];
  return { bareName, elsByTag, firstByTag, childrenByTag };
`)();

/* ---------- La de ahora, extraída del archivo entregado ---------- */
const now = new Function(
  between("/* Nombre sin prefijo", "/* KML usa color") + "\n" + fn("text") +
  "\nreturn { bareName, elsByTag, firstByTag, childrenByTag, mayNeedPrefixFallback, text };")();

/* ---------- Documentos ---------- */
const body = `
  <Document><name>doc</name>
    <Style id="s"><LineStyle><color>ff0000ff</color></LineStyle></Style>
    <Folder><name>carpeta</name>
      <Placemark><name>uno</name><Point><coordinates>-3.7,40.4,0</coordinates></Point></Placemark>
      <Placemark><name>dos</name><LineString><coordinates>-3,40 -3.1,40.1</coordinates></LineString></Placemark>
      <Placemark><name>tres</name><MultiGeometry>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon>
        <Point><coordinates>0.5,0.5</coordinates></Point></MultiGeometry></Placemark>
    </Folder>
  </Document>`;
/* Un DOM mínimo que se comporta como un analizador sin namespaces:
   elementos «k:Placemark» sin localName limpio. No hay librería a mano
   que lo haga bien (linkedom pasa los nombres a minúsculas).            */
function fakeDoc({ ns }) {
  const doc = { nodeName: "#document", children: [], ownerDocument: null };
  const all = [];
  const el = (name, kids = []) => {
    const e = { nodeName: "k:" + name, children: kids, ownerDocument: doc };
    if (ns === "broken") e.localName = "k:" + name;
    kids.forEach(k => { k.parent = e; });
    all.push(e);
    return e;
  };
  const sub = e => e.children.flatMap(c => [c, ...sub(c)]);
  const methods = e => {
    e.getElementsByTagName = tag => (tag === "*" ? sub(e) : sub(e).filter(x => x.nodeName === tag));
    if (ns === "broken") e.getElementsByTagNameNS = () => [];
  };
  const pm = n => el("Placemark", [el("name"), el("Point", [el("coordinates")])]);
  const root = el("kml", [el("Document", [el("name"), el("Folder", [pm(1), pm(2), pm(3)])])]);
  doc.children = [root];
  doc.documentElement = root;
  methods(doc);
  all.forEach(methods);
  return doc;
}
const kmlNs = "http://www.opengis.net/kml/2.2";
const xml = s => new DOMParser().parseFromString(s, "text/xml");
const prefixed = body.replace(/<(\/?)([A-Za-z]+)/g, "<$1k:$2");
const docs = {
  "namespace por defecto": xml(`<kml xmlns="${kmlNs}">${body}</kml>`),
  "con prefijo declarado": xml(`<k:kml xmlns:k="${kmlNs}">${prefixed}</k:kml>`),
  "sin namespace": xml(`<kml>${body}</kml>`),
  /* Sin soporte de namespaces: lo que hace el respaldo de elsByTag.
     «sin NS»: ni getElementsByTagNameNS, ni localName (solo nodeName con
     el prefijo dentro). «NS roto»: tiene el método pero no encuentra
     nada y el localName lleva el prefijo.                               */
  "analizado sin namespaces (sin NS)": fakeDoc({ ns: false }),
  "analizado sin namespaces (NS roto)": fakeDoc({ ns: "broken" })
};
const NAMES = ["Placemark", "name", "Point", "Polygon", "LineString", "coordinates", "Style",
  "Folder", "Document", "MultiGeometry", "outerBoundaryIs", "Zzz", "placemark", ""];

/* ---------- 1. Equivalencia ---------- */
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
let compared = 0;
for (const [label, doc] of Object.entries(docs)) {
  const roots = [doc];
  const firstPm = legacy.elsByTag(doc, "Placemark")[0];
  if (firstPm) roots.push(firstPm);
  const folder = legacy.elsByTag(doc, "Folder")[0];
  if (folder) roots.push(folder);
  roots.push(null, {});   /* entradas que no son nodos */
  for (const root of roots) {
    for (const name of NAMES) {
      const a = legacy.elsByTag(root, name), b = now.elsByTag(root, name);
      ok(same(a, b), `${label}: elsByTag(${root && root.nodeName}, "${name}") — ${a.length} frente a ${b.length}`);
      ok(legacy.firstByTag(root, name) === now.firstByTag(root, name), `${label}: firstByTag(${root && root.nodeName}, "${name}")`);
      if (root && root.children) {
        ok(same(legacy.childrenByTag(root, name), now.childrenByTag(root, name)), `${label}: childrenByTag(${root.nodeName}, "${name}")`);
      }
      compared += 3;
    }
  }
}
ok(compared > 400, "se compararon todas las combinaciones: " + compared);
/* Y el resultado no es vacío por casualidad */
ok(now.elsByTag(docs["namespace por defecto"], "Placemark").length === 3, "encuentra los tres Placemark (namespace por defecto)");
ok(now.elsByTag(docs["con prefijo declarado"], "Placemark").length === 3, "y con prefijo declarado");
ok(now.elsByTag(docs["sin namespace"], "Placemark").length === 3, "y sin namespace");
ok(now.elsByTag(docs["analizado sin namespaces (sin NS)"], "Placemark").length === 3, "y en un documento sin soporte de namespaces (por el respaldo)");
ok(now.elsByTag(docs["analizado sin namespaces (NS roto)"], "Placemark").length === 3, "y en uno con la consulta de namespace rota");
ok(now.text(docs["namespace por defecto"].documentElement, "name") === "doc", "text() lee el primer <name>");

/* ---------- 2. Trabajo: recorridos de todos los descendientes ---------- */
function bigDoc(n) {
  let pm = "";
  for (let i = 0; i < n; i++) pm += `<Placemark><name>P${i}</name><Point><coordinates>${-4 + i * 1e-4},40,0</coordinates></Point></Placemark>`;
  return xml(`<kml xmlns="${kmlNs}"><Document><name>pts</name>${pm}</Document></kml>`);
}
/* Cuenta los `getElementsByTagName("*")` sobre cualquier nodo del documento */
function countWildcardScans(doc, run) {
  const protos = new Set([Object.getPrototypeOf(doc), Object.getPrototypeOf(doc.documentElement)]);
  let scans = 0;
  const saved = [];
  for (const p of protos) {
    const orig = p.getElementsByTagName;
    if (typeof orig !== "function") continue;
    saved.push([p, orig]);
    p.getElementsByTagName = function (name) { if (name === "*") scans++; return orig.call(this, name); };
  }
  const t = process.hrtime.bigint();
  run();
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  for (const [p, orig] of saved) p.getElementsByTagName = orig;
  return { scans, ms };
}
/* El patrón de buildPlacemarkLayer + findDuplicatePlacemarks por Placemark */
const lookups = impl => doc => {
  for (const pm of impl.elsByTag(doc, "Placemark")) {
    impl.elsByTag(pm, "Polygon");
    impl.elsByTag(pm, "LineString");
    for (const ptEl of impl.elsByTag(pm, "Point")) impl.firstByTag(ptEl, "coordinates");
    impl.firstByTag(pm, "name");
    impl.childrenByTag(pm, "MultiGeometry");
  }
};
const N = 3000;
const docBefore = bigDoc(N), docAfter = bigDoc(N);
const antes = countWildcardScans(docBefore, () => lookups(legacy)(docBefore));
const despues = countWildcardScans(docAfter, () => lookups(now)(docAfter));
console.log(`  recorridos de todos los descendientes con ${N} puntos: ${antes.scans} antes, ${despues.scans} ahora ` +
  `(${antes.ms.toFixed(0)} ms → ${despues.ms.toFixed(0)} ms)`);
ok(antes.scans >= 2 * N, `antes cada Placemark disparaba al menos dos (Polygon y LineString vacíos): ${antes.scans}`);
ok(despues.scans <= 1, `ahora, uno por documento como mucho: ${despues.scans}`);
ok(despues.ms < antes.ms, `y por eso es más rápido (${despues.ms.toFixed(0)} ms frente a ${antes.ms.toFixed(0)} ms)`);

/* ---------- 3. El respaldo sigue vivo donde hace falta ---------- */
ok(now.mayNeedPrefixFallback(docs["analizado sin namespaces (sin NS)"]) === true, "un documento sin soporte de namespaces SÍ pide el respaldo");
ok(now.mayNeedPrefixFallback(docs["analizado sin namespaces (NS roto)"]) === true, "y uno con el prefijo dentro del localName también");
ok(now.mayNeedPrefixFallback(docs["namespace por defecto"]) === false, "uno con namespaces limpios, no");
ok(now.mayNeedPrefixFallback(docs["sin namespace"]) === false, "ni uno sin namespace (localName limpio)");
ok(now.mayNeedPrefixFallback(docs["con prefijo declarado"]) === false, "ni uno con prefijo declarado (localName sin el prefijo)");
/* y el resultado se recuerda: la segunda pregunta no vuelve a recorrer */
const again = countWildcardScans(docAfter, () => { for (let i = 0; i < 50; i++) now.mayNeedPrefixFallback(docAfter.documentElement); });
ok(again.scans === 0, "la respuesta se recuerda por documento: " + again.scans);

if (failed) { console.error(`${failed} comprobación(es) fallidas`); process.exit(1); }
console.log("XML LOOKUP TESTS OK");
