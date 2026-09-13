const { DOMParser } = require("@xmldom/xmldom");
const { fn, constDecl } = require("./_extract");

const src = [
  constDecl("COORD_EPS"), constDecl("DUP_POS_DECIMALS"),
  fn("bareName"), fn("elsByTag"), constDecl("firstByTag"), fn("text"), fn("clampLatLng"), fn("clampDeg"), fn("parseCoords"),
  fn("findDuplicatePlacemarks"), fn("removeDuplicatePlacemarks"),
  fn("featureDupName"), fn("findDuplicateFeatures"), fn("removeDuplicateFeatures"),
].join("\n");
const api = new Function(src + "\nreturn { findDuplicatePlacemarks, removeDuplicatePlacemarks,"
  + " findDuplicateFeatures, removeDuplicateFeatures, featureDupName };")();
const { findDuplicatePlacemarks, removeDuplicatePlacemarks,
        findDuplicateFeatures, removeDuplicateFeatures, featureDupName } = api;

const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

function docFrom(placemarksXml) {
  return new DOMParser().parseFromString(`<kml><Document>${placemarksXml}</Document></kml>`, "text/xml");
}
function pm(nameText, lat, lng) {
  return `<Placemark><name>${nameText}</name><Point><coordinates>${lng},${lat},0</coordinates></Point></Placemark>`;
}

{
  // Two placemarks, same name, exact same position -> one group of 2.
  const doc = docFrom(pm("Bar Pepe", 40.4, -3.7) + pm("Bar Pepe", 40.4, -3.7));
  const groups = findDuplicatePlacemarks(doc);
  ok(groups.length === 1, "un grupo de duplicados exactos: " + groups.length);
  ok(groups[0].length === 2, "con los 2 placemarks: " + groups[0].length);
}
{
  // Same name, position differs by far more than the tolerance -> no group.
  const doc = docFrom(pm("Bar Pepe", 40.4, -3.7) + pm("Bar Pepe", 41.0, -3.7));
  ok(findDuplicatePlacemarks(doc).length === 0, "misma posición pero distinta de verdad: no son duplicados");
}
{
  // Same position, different name -> no group.
  const doc = docFrom(pm("Bar Pepe", 40.4, -3.7) + pm("Otro bar", 40.4, -3.7));
  ok(findDuplicatePlacemarks(doc).length === 0, "misma posición pero distinto nombre: no son duplicados");
}
{
  // Tiny float noise well within tolerance (~1.1 m) still counts as the same position.
  const doc = docFrom(pm("Bar Pepe", 40.400001, -3.700001) + pm("Bar Pepe", 40.400002, -3.700000));
  ok(findDuplicatePlacemarks(doc).length === 1, "ruido de coma flotante dentro de la tolerancia sigue contando como el mismo punto");
}
{
  // A polygon/line-only placemark (no <Point>) never joins a group, even
  // with a matching name — "position" is only defined for a point.
  const doc = docFrom(
    pm("Zona", 40.4, -3.7) +
    `<Placemark><name>Zona</name><Polygon><outerBoundaryIs><LinearRing>
      <coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`
  );
  ok(findDuplicatePlacemarks(doc).length === 0, "un polígono sin <Point> nunca se agrupa, aunque comparta nombre");
}
{
  // Three-way duplicate group, plus an unrelated singleton and a second,
  // separate duplicate pair — findDuplicatePlacemarks must tell them apart.
  const doc = docFrom(
    pm("A", 1, 1) + pm("A", 1, 1) + pm("A", 1, 1) +
    pm("B", 2, 2) +
    pm("C", 3, 3) + pm("C", 3, 3)
  );
  const groups = findDuplicatePlacemarks(doc).sort((a, b) => b.length - a.length);
  ok(groups.length === 2, "dos grupos distintos (A triple, C doble), B queda fuera: " + groups.length);
  ok(groups[0].length === 3 && groups[1].length === 2, "tamaños correctos: " + groups.map(g => g.length));
}
{
  // removeDuplicatePlacemarks keeps the FIRST of each group (document
  // order) and removes the rest from the DOM.
  const doc = docFrom(pm("A", 1, 1) + pm("B", 2, 2) + pm("A", 1, 1) + pm("A", 1, 1));
  const groups = findDuplicatePlacemarks(doc);
  const removed = removeDuplicatePlacemarks(groups);
  ok(removed === 2, "se retiran 2 (quedan 2 de los 3 'A' fuera... 1 se queda): " + removed);
  const remainingNames = [...doc.getElementsByTagName("Placemark")]
    .map(p => [...p.getElementsByTagName("name")][0].textContent);
  ok(remainingNames.length === 2, "quedan 2 placemarks en el documento: " + remainingNames.length);
  ok(JSON.stringify(remainingNames) === JSON.stringify(["A", "B"]), "se conserva el PRIMER 'A' y el 'B', en orden: " + JSON.stringify(remainingNames));
}
{
  // No duplicates at all -> empty array, removeDuplicatePlacemarks is a no-op.
  const doc = docFrom(pm("A", 1, 1) + pm("B", 2, 2));
  const groups = findDuplicatePlacemarks(doc);
  ok(groups.length === 0, "sin duplicados, ningún grupo");
  ok(removeDuplicatePlacemarks(groups) === 0, "y nada que retirar");
}

/* ================= Lo mismo en un GeoJSON =================
   Es el mismo problema (un exportador que repite la misma ficha) y la
   misma pregunta; solo cambia de dónde salen el nombre y la posición.
   Antes esto NO se miraba al importar un GeoJSON: el archivo entraba
   con los duplicados dentro y sin preguntar nada.                    */
const feat = (props, coords, type = "Point") =>
  ({ type: "Feature", properties: props, geometry: { type, coordinates: coords } });
const fc = features => ({ type: "FeatureCollection", features });
/* Ojo al orden: en GeoJSON las coordenadas van [lng, lat] */
const pt = (nombre, lat, lng) => feat(nombre === null ? {} : { name: nombre }, [lng, lat]);

{
  const g = findDuplicateFeatures([pt("Faro", 40.4, -3.7), pt("Faro", 40.4, -3.7)], null);
  ok(g.length === 1 && g[0].length === 2, "GeoJSON: mismo nombre y posición, un grupo de 2");
}
{
  ok(findDuplicateFeatures([pt("Faro", 40.4, -3.7), pt("Faro", 41.0, -3.7)], null).length === 0,
    "GeoJSON: mismo nombre en otro sitio no es duplicado");
  ok(findDuplicateFeatures([pt("Faro", 40.4, -3.7), pt("Otro", 40.4, -3.7)], null).length === 0,
    "GeoJSON: misma posición con otro nombre tampoco");
}
{
  ok(findDuplicateFeatures([pt("Faro", 40.400001, -3.700001), pt("Faro", 40.400002, -3.7)], null).length === 1,
    "GeoJSON: el ruido de coma flotante entra en la misma tolerancia que en KML");
}
{
  /* Las coordenadas se leen [lng, lat]. Con los dos números cambiados
     de sitio son puntos DISTINTOS, y agruparlos delataría una lectura
     al revés — el error fácil, porque el resto del proyecto usa
     lat/lng.                                                         */
  ok(findDuplicateFeatures([feat({ name: "X" }, [-3.7, 40.4]), feat({ name: "X" }, [40.4, -3.7])], null).length === 0,
    "GeoJSON: lng/lat intercambiados son sitios distintos, no un duplicado");
}
{
  /* Sin nombre propio no se agrupa, igual que un Placemark sin <name>:
     el «Elemento N» de respaldo lo da el índice, así que no dice nada
     sobre si dos fichas son la misma.                                */
  ok(findDuplicateFeatures([pt(null, 40.4, -3.7), pt(null, 40.4, -3.7)], null).length === 0,
    "GeoJSON: dos elementos sin nombre no se fusionan");
  ok(featureDupName({}, null) === null, "sin name ni title no hay nombre con el que agrupar");
  ok(featureDupName({ title: "T" }, null) === "T", "vale también `title`");
  ok(featureDupName({ ref: "R", name: "N" }, "ref") === "R",
    "y manda la propiedad elegida en el selector de nombre");
}
{
  /* La propiedad elegida cambia QUIÉN es duplicado de quién: con `ref`
     estos dos son el mismo sitio; con el nombre por defecto, no.     */
  const dos = [feat({ ref: "K1", name: "Uno" }, [-3.7, 40.4]),
               feat({ ref: "K1", name: "Dos" }, [-3.7, 40.4])];
  ok(findDuplicateFeatures(dos, "ref").length === 1, "con la propiedad elegida, son duplicados");
  ok(findDuplicateFeatures(dos, null).length === 0, "sin ella, no lo son");
}
{
  /* Una línea no tiene una posición única que comparar, igual que un
     Placemark sin <Point>.                                           */
  const linea = feat({ name: "Ruta" }, [[-3.7, 40.4], [-3.6, 40.5]], "LineString");
  ok(findDuplicateFeatures([linea, linea], null).length === 0,
    "GeoJSON: una línea nunca se agrupa, aunque comparta nombre");
  ok(findDuplicateFeatures([feat({ name: "X" }, []), feat({ name: "X" }, [])], null).length === 0,
    "ni un punto sin coordenadas");
}
{
  const doc = fc([pt("A", 1, 1), pt("B", 2, 2), pt("A", 1, 1), pt("A", 1, 1)]);
  const arrayOriginal = doc.features;
  const groups = findDuplicateFeatures(doc.features, null);
  const removed = removeDuplicateFeatures(doc, groups);
  ok(removed === 2, "se retiran 2: " + removed);
  ok(doc.features.map(f => f.properties.name).join() === "A,B",
    "se conserva el PRIMERO de cada grupo, en orden: " + doc.features.map(f => f.properties.name));
  /* EN EL SITIO: quien llamó tiene ya ese array en la mano (es el que
     devolvió geojsonFeatures), y sustituirlo por otro le dejaría los
     duplicados delante.                                              */
  ok(doc.features === arrayOriginal, "el array es el MISMO objeto, filtrado en el sitio");
}
{
  const doc = fc([pt("A", 1, 1), pt("B", 2, 2)]);
  ok(findDuplicateFeatures(doc.features, null).length === 0, "sin duplicados, ningún grupo");
  ok(removeDuplicateFeatures(doc, []) === 0, "y nada que retirar");
  /* Un Feature suelto o una geometría pelada son UN elemento: no hay
     array que tocar y tampoco puede haber duplicados.                */
  ok(removeDuplicateFeatures(pt("A", 1, 1), []) === 0, "un Feature suelto no tiene lista que filtrar");
}

if (!process.exitCode) console.log("DUPLICATE MARKER TESTS OK");
