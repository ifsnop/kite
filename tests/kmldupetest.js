const { DOMParser } = require("@xmldom/xmldom");
const { fn, constDecl } = require("./_extract");

const src = [
  constDecl("COORD_EPS"), constDecl("DUP_POS_DECIMALS"),
  fn("bareName"), fn("elsByTag"), constDecl("firstByTag"), fn("text"), fn("clampLatLng"), fn("clampDeg"), fn("parseCoords"),
  fn("findDuplicatePlacemarks"), fn("removeDuplicatePlacemarks"),
].join("\n");
const api = new Function(src + "\nreturn { findDuplicatePlacemarks, removeDuplicatePlacemarks };")();
const { findDuplicatePlacemarks, removeDuplicatePlacemarks } = api;

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

if (!process.exitCode) console.log("KML DUPLICATE PLACEMARK TESTS OK");
