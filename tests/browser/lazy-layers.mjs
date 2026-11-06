/* Capas Leaflet perezosas (20-kml-geom.js `buildPlacemarkGeo`, 32-geojson.js
   `defineLazyLayer`): un placemark APAGADO de solo polígonos y líneas guarda
   su GeoJSON y no construye su capa hasta que se pide. Un KML real de 309 MB
   (62 673 placemarks apagados, 9,66 M de vértices) tardaba 9 s y +1,1 GB al
   importar, otros 7,6 s y 3,1 GB en CADA arranque, y con un límite de heap de
   3 GB el guardado pasaba de 1,3 s a 67 s.

   1) EQUIVALENCIA: para un corpus de placemarks, el GeoJSON que construye
      `buildPlacemarkGeo` es IGUAL (texto idéntico, orden de claves incluido)
      al `toGeoJSON()` de la capa que construye `buildPlacemarkLayer`, con
      Leaflet real. Es el riesgo del cambio: si difiere, un archivo importado
      guardaría otra geometría que antes.
   2) Al importar, los apagados sin marcadores son perezosos (`_built` falso),
      no hay nada de ellos en el mapa, y un marcador apagado se construye ya.
   3) Guardar, encuadrar, leer sus atributos y borrar la carpeta NO los
      construyen.
   4) Recargar: vuelven perezosos (los apagados), los visibles se construyen.
   5) Encender la carpeta los construye y los pone en el mapa; apagarla los
      quita; apagar una capa que nunca se construyó no la construye.        */
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER LAZY LAYERS TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8966);
const { ctx, page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

/* ---------- 1. Equivalencia con toGeoJSON() de Leaflet ---------- */
const corpus = [
  ["anillo cerrado", `<Polygon><outerBoundaryIs><LinearRing><coordinates>-3.5,40.1 -3.4,40.1 -3.4,40.2 -3.5,40.1</coordinates></LinearRing></outerBoundaryIs></Polygon>`],
  ["anillo SIN cerrar", `<Polygon><outerBoundaryIs><LinearRing><coordinates>-3.5,40.1 -3.4,40.1 -3.4,40.2</coordinates></LinearRing></outerBoundaryIs></Polygon>`],
  ["con agujero", `<Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 4,0 4,4 0,4 0,0</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>1,1 2,1 2,2 1,2 1,1</coordinates></LinearRing></innerBoundaryIs></Polygon>`],
  ["altitud 0 y real", `<Polygon><outerBoundaryIs><LinearRing><coordinates>-5.69846,37.332944,0 -5.69325,37.337129,120.5 -5.687986999999999,37.332986,0 -5.69846,37.332944,0</coordinates></LinearRing></outerBoundaryIs></Polygon>`],
  ["quince decimales, negativos y redondeo al .5", `<Polygon><outerBoundaryIs><LinearRing><coordinates>-5.6898655555555555,37.3329445555555,3.0000005 -5.6932500000005,37.3371290000005,-0.0000004 -5.687986999999999,37.332986,1e-7 -5.6898655555555555,37.3329445555555,3.0000005</coordinates></LinearRing></outerBoundaryIs></Polygon>`],
  ["cierre a menos de 1e-9 (se descarta y se vuelve a cerrar)", `<Polygon><outerBoundaryIs><LinearRing><coordinates>10,10 11,10 11,11 10.0000000005,10.0000000005</coordinates></LinearRing></outerBoundaryIs></Polygon>`],
  ["cierre a 1e-8 (no se descarta)", `<Polygon><outerBoundaryIs><LinearRing><coordinates>10,10 11,10 11,11 10.00000001,10.00000001</coordinates></LinearRing></outerBoundaryIs></Polygon>`],
  ["cierre igual en lat/lon pero distinta altitud", `<Polygon><outerBoundaryIs><LinearRing><coordinates>10,10,5 11,10,6 11,11,7 10,10,9</coordinates></LinearRing></outerBoundaryIs></Polygon>`],
  /* El modo de altitud (kiteAlt) va en el Feature de cada polígono, también con el modo en solo uno de varios */
  ["modo absolute", `<Polygon><altitudeMode>absolute</altitudeMode><outerBoundaryIs><LinearRing><coordinates>-3.5,40.1,700 -3.4,40.1,710 -3.4,40.2,720 -3.5,40.1,700</coordinates></LinearRing></outerBoundaryIs></Polygon>`],
  ["modo relativeToGround con agujero", `<Polygon><altitudeMode>relativeToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>0,0,30 4,0,30 4,4,30 0,4,30 0,0,30</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>1,1,30 2,1,30 2,2,30 1,2,30 1,1,30</coordinates></LinearRing></innerBoundaryIs></Polygon>`],
  ["modo solo en uno de dos polígonos y una línea", `<MultiGeometry>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>0,0,5 1,0,5 1,1,5 0,0,5</coordinates></LinearRing></outerBoundaryIs></Polygon>
    <LineString><coordinates>5,5 6,6</coordinates></LineString>
    <Polygon><altitudeMode>clampToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>2,2,5 3,2,5 3,3,5 2,2,5</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry>`],
  ["modo desconocido: sin marca", `<Polygon><altitudeMode>volando</altitudeMode><outerBoundaryIs><LinearRing><coordinates>0,0,5 1,0,5 1,1,5 0,0,5</coordinates></LinearRing></outerBoundaryIs></Polygon>`],
  ["línea", `<LineString><coordinates>-3.7,40.4 -3.6,40.5,10 -3.55,40.55</coordinates></LineString>`],
  ["multigeometría polígonos + línea", `<MultiGeometry>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon>
    <LineString><coordinates>5,5 6,6</coordinates></LineString>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>2,2 3,2 3,3 2,2</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry>`],
  ["espacios, tabuladores y saltos de línea", `<Polygon><outerBoundaryIs><LinearRing><coordinates>
        \t-3.5,40.1\n   -3.4,40.1 \t -3.4,40.2\r\n -3.5,40.1  </coordinates></LinearRing></outerBoundaryIs></Polygon>`],
  ["una geometría mala y una buena", `<Polygon><outerBoundaryIs><LinearRing><coordinates>1,1 2,2</coordinates></LinearRing></outerBoundaryIs></Polygon>
    <LineString><coordinates>7,7 8,8</coordinates></LineString>`],
  ["coordenada fuera de rango en un vértice", `<LineString><coordinates>1,1 2,95 3,3</coordinates></LineString>`],
  ["sin geometría utilizable", `<Polygon><outerBoundaryIs><LinearRing><coordinates>1,1 2,2</coordinates></LinearRing></outerBoundaryIs></Polygon>`],
  ["-0 al redondear", `<LineString><coordinates>-0.0000001,0.0000001 0.0000002,-0.0000002</coordinates></LineString>`],
];
const withData = `<ExtendedData><Data name="ref"><value>A-1</value></Data><SchemaData schemaUrl="#s"><SimpleData name="n">7</SimpleData></SchemaData></ExtendedData>`;
const eq = await page.evaluate(({ corpus, withData }) => {
  const out = [];
  const one = (label, geom, extra) => {
    const doc = new DOMParser().parseFromString(`<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>x</name>${extra}${geom}</Placemark></Document></kml>`, "text/xml");
    const pm = elsByTag(doc, "Placemark")[0];
    const a = { warns: [], warn(w) { this.warns.push(w); } }, b = { warns: [], warn(w) { this.warns.push(w); } };
    const els = placemarkGeomEls(pm);
    const eager = buildPlacemarkLayer(pm, {}, a, placemarkGeomEls(pm));
    const lazy = buildPlacemarkGeo(pm, {}, b, els);
    const ja = eager.group ? JSON.stringify(eager.group.toGeoJSON()) : null;
    const jb = lazy.geo ? JSON.stringify(lazy.geo) : null;
    out.push({ label, same: ja === jb, ja, jb, reported: eager.reported === lazy.reported, warns: JSON.stringify(a.warns) === JSON.stringify(b.warns) });
  };
  for (const [label, geom] of corpus) { one(label, geom, ""); one(label + " + ExtendedData", geom, withData); }
  return out;
}, { corpus, withData });
for (const r of eq) {
  ok(r.same, `GeoJSON directo = toGeoJSON() de Leaflet — ${r.label}\n  Leaflet: ${r.ja}\n  directo: ${r.jb}`);
  ok(r.reported && r.warns, `mismo aviso y mismo «reported» — ${r.label}`);
}
ok(eq.filter(r => r.ja && r.ja.includes('"kiteAlt":"abs"')).length === 2 && eq.filter(r => r.ja && r.ja.includes('"kiteAlt":"agl"')).length === 2
  && eq.filter(r => r.ja && r.ja.includes('"kiteAlt":"ground"')).length === 2 && eq.filter(r => r.ja && r.ja.includes("volando")).length === 0
  && eq.filter(r => r.ja && r.ja.includes("kiteAlt")).length === 6,
  "el modo de altitud llega a los dos caminos (y un valor desconocido, ni rastro): " + eq.filter(r => r.ja && r.ja.includes("kiteAlt")).length);
ok(eq.length === corpus.length * 2 && eq.filter(r => r.ja !== null).length >= 20, "el corpus produce geometría de verdad (no todo null): " + eq.filter(r => r.ja !== null).length);

/* ---------- 2. Importar un KML con una carpeta apagada ---------- */
const poly = (x, y) => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${x},${y} ${x + 1},${y} ${x + 1},${y + 1} ${x},${y}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Doc</name><open>1</open>
<Folder><name>Apagada</name><visibility>0</visibility>
  <Placemark><name>P1</name><visibility>0</visibility>${withData}${poly(10, 20)}</Placemark>
  <Placemark><name>L1</name><visibility>0</visibility><LineString><coordinates>-5,40 -4,41</coordinates></LineString></Placemark>
  <Placemark><name>Pt</name><visibility>0</visibility><Point><coordinates>7,8</coordinates></Point></Placemark>
</Folder>
<Folder><name>Visible</name><Placemark><name>V1</name>${poly(30, 40)}</Placemark></Folder>
</Document></kml>`;
const recsOf = name => page.evaluate(n => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  return li && li._pending ? li._pending.map(r => ({ name: r.name, built: r._built, checked: r.checked })) : null;
}, name);
const mapLayers = () => page.evaluate(() => rootGroup.getLayers().length);
const importKml = () => page.evaluate(async kml => { await handleDroppedFiles([new File([kml], "p.kml")]); }, kml);

await importKml();
let off = await recsOf("Apagada");
ok(off && off.length === 3, "la carpeta apagada está pendiente con sus 3 registros: " + JSON.stringify(off));
ok(off.find(r => r.name === "P1").built === false && off.find(r => r.name === "L1").built === false,
   "polígono y línea apagados: sin construir: " + JSON.stringify(off));
ok(off.find(r => r.name === "Pt").built === undefined, "un marcador apagado se construye ya (necesita su icono)");
ok(await mapLayers() === 1, "en el mapa solo la visible (V1): " + await mapLayers());
const msg = await page.evaluate(() => msgLog.map(m => m.text).join(" | "));
ok(/4/.test(msg), "el resumen cuenta las 4 capas, perezosas incluidas: " + msg);

/* ---------- 3. Guardar, encuadrar, atributos y borrar NO construyen ---------- */
const probe = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Apagada");
  const pend = li._pending, p1 = pend.find(r => r.name === "P1");
  const saved = serializeTree();
  const b = subtreeBounds(li);
  const props = recProperties(p1);
  return {
    built: pend.map(r => [r.name, r._built]),
    geoSaved: JSON.stringify(saved[0].children[0].children.find(c => c.name === "P1").geo) === JSON.stringify(p1.geo),
    bounds: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()], props
  };
});
ok(probe.built.find(x => x[0] === "P1")[1] === false && probe.built.find(x => x[0] === "L1")[1] === false,
   "serializar, encuadrar y leer atributos no construyen nada: " + JSON.stringify(probe.built));
ok(probe.geoSaved, "se guarda el mismo GeoJSON que tiene el registro");
ok(probe.bounds[0] <= 8 && probe.bounds[1] <= -5 && probe.bounds[2] >= 41 && probe.bounds[3] >= 11,
   "el encuadre abarca el polígono, la línea y el marcador: " + JSON.stringify(probe.bounds));
ok(probe.props && probe.props.ref === "A-1" && probe.props.n === "7", "los atributos salen del GeoJSON: " + JSON.stringify(probe.props));

/* ---------- 4. Guardar y recargar: vuelven perezosos ---------- */
await page.evaluate(() => saveTree());
await page.reload(); await waitAppReady(page);
off = await recsOf("Apagada");
ok(off && off.length === 3 && off.find(r => r.name === "P1").built === false && off.find(r => r.name === "L1").built === false,
   "tras recargar, el polígono y la línea apagados siguen sin construir: " + JSON.stringify(off));
ok(off.find(r => r.name === "Pt").built === undefined, "y el marcador, construido");
ok(await mapLayers() === 1, "tras recargar, en el mapa solo la visible: " + await mapLayers());
const back = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Apagada");
  const p1 = li._pending.find(r => r.name === "P1");
  return { props: recProperties(p1), geom: p1.geo.features[0].geometry.type };
});
ok(back.geom === "Polygon" && back.props && back.props.ref === "A-1", "el GeoJSON y los atributos sobreviven a guardar y recargar: " + JSON.stringify(back));

/* ---------- 5. Encender construye; apagar quita; apagar lo que no existe no construye ---------- */
const chkId = name => page.evaluate(n => [...document.querySelectorAll("#tree li")].find(x => x._name === n)
  .querySelector(":scope > .node-row > input[type=checkbox]").id, name);
const settle = () => page.waitForFunction(() => cascadingNodes.size === 0);
await page.click("#" + await chkId("Apagada"));
await settle();
off = await recsOf("Apagada");
ok(off.every(r => r.checked), "encender la carpeta marca sus 3 registros");
ok(off.find(r => r.name === "P1").built === true && off.find(r => r.name === "L1").built === true, "y construye las capas perezosas: " + JSON.stringify(off));
ok(await mapLayers() === 4, "y las pone en el mapa (1 + 3): " + await mapLayers());
await page.click("#" + await chkId("Apagada"));
await settle();
ok(await mapLayers() === 1, "apagarla las quita del mapa: " + await mapLayers());
ok((await recsOf("Apagada")).find(r => r.name === "P1").built === true, "la capa ya construida se queda (solo se quita del mapa)");

/* apagar, sin haber encendido nunca, no construye: se recarga para volver al estado perezoso */
await page.evaluate(() => saveTree());
await page.reload(); await waitAppReady(page);
await page.evaluate(() => { const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Apagada"); return setPendingChecked(li._pending, false, { n: 0 }); });
off = await recsOf("Apagada");
ok(off.find(r => r.name === "P1").built === false && off.find(r => r.name === "L1").built === false,
   "apagar (setPendingChecked) lo que nunca se construyó no lo construye: " + JSON.stringify(off));
await page.evaluate(() => { const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Apagada"); deleteNode(li); });
await page.waitForFunction(() => ![...document.querySelectorAll("#tree li")].some(x => x._name === "Apagada"));
ok(await mapLayers() === 1, "borrar la carpeta apagada deja el mapa como estaba");

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");
await ctx.close(); await browser.close();
srv.close();
done();
