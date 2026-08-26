/* ringClosed, ringArea, polygonParts, rawPolygonRings (puras) y
   ringPerimeter (necesita map.distance: aquí se sustituye por una
   haversine de referencia, igual de fiel al haversine real de Leaflet
   que usa map.distance en el propio visor) — perímetro y área del
   diálogo de propiedades para cualquier nodo de tipo polígono.        */
const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const fs = require("fs");
const html = fs.readFileSync(HTML_PATH, "utf8");
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];

const coordEps = script.slice(script.indexOf("const COORD_EPS ="), script.indexOf("function clampDeg"));
const geodesiaBase = script.slice(script.indexOf("/* ================= Geodesia"),
                                   script.indexOf("/* Rumbo inicial de a"));
const ringFns = script.slice(script.indexOf("/* Un anillo se considera cerrado"),
                             script.indexOf("/* ================= Herramientas de medición"));
/* Esta franja incluye de paso rawPolygonRings, que vive justo entre
   ringPerimeter y polygonMeasures.                                    */
const ringPerimeterSrc = script.slice(script.indexOf("function ringPerimeter"),
                                      script.indexOf("function polygonMeasures"));

/* map.distance de sustitución: haversine sobre la misma esfera (EARTH_R,
   toRad, ya extraídos arriba), no una reimplementación de Leaflet.     */
const mapStub = `
function haversineDistance(a, b) {
  const p1 = toRad(a.lat), p2 = toRad(b.lat);
  const dp = toRad(b.lat - a.lat), dl = toRad(b.lng - a.lng);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}
const map = { distance: haversineDistance };
`;

const src = coordEps + "\n" + geodesiaBase + "\n" + mapStub + "\n" + ringFns + "\n" + ringPerimeterSrc;
const { ringClosed, ringArea, polygonParts, ringPerimeter, rawPolygonRings, COORD_EPS, EARTH_R, toRad, map } =
  new Function(src + "\nreturn {ringClosed, ringArea, polygonParts, ringPerimeter, rawPolygonRings, COORD_EPS, EARTH_R, toRad, map};")();

const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* ---- ringArea: cuadrado pequeño cerca del ecuador ---- */
const side = 0.01; /* grados */
const squareOpen = [{ lat: 0, lng: 0 }, { lat: 0, lng: side }, { lat: side, lng: side }, { lat: side, lng: 0 }];
const square = [...squareOpen, squareOpen[0]]; /* cerrado explícitamente */
const approxSide = EARTH_R * toRad(side);
const approxArea = approxSide * approxSide;
const area = ringArea(square);
ok(Math.abs(area - approxArea) / approxArea < 0.001,
  `área cerca de la aproximación plana: ${area} vs ${approxArea}`);

/* el sentido de recorrido no cambia el área (se toma en valor absoluto) */
const reversed = [...square].reverse();
ok(Math.abs(ringArea(square) - ringArea(reversed)) < 1e-6, "el sentido de recorrido no afecta al área");

/* un anillo con menos de 3 puntos no tiene área ni puede estar cerrado */
const twoPoints = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }];
ok(ringArea(twoPoints) === 0, "menos de 3 puntos: área 0");
ok(ringClosed(twoPoints) === false, "menos de 3 puntos: nunca cerrado");

/* ---- ringClosed: el caso explícito del pedido (un ABC sin repetir A) ---- */
const A = { lat: 0, lng: 0 }, B = { lat: 0, lng: 0.01 }, C = { lat: 0.01, lng: 0.01 };
const abcOpen = [A, B, C];
ok(ringClosed(abcOpen) === false, "ABC sin repetir A al final: no está cerrado");
ok(ringClosed([...abcOpen, A]) === true, "ABC + A repetido: cerrado");
ok(ringClosed([...abcOpen, { lat: 1e-7, lng: 1e-7 }]) === true,
  "un cierre a menos de COORD_EPS de A también cuenta como cerrado");

/* ---- ringPerimeter: abierto no incluye el tramo de cierre ---- */
const distAB = map.distance(A, B), distBC = map.distance(B, C), distCA = map.distance(C, A);
ok(Math.abs(ringPerimeter(abcOpen, false) - (distAB + distBC)) < 1e-6,
  "perímetro abierto: A→B + B→C, sin C→A (el caso del pedido)");
ok(Math.abs(ringPerimeter(abcOpen, true) - (distAB + distBC + distCA)) < 1e-6,
  "perímetro cerrado sí incluye C→A");

/* ---- polygonParts: las dos profundidades de getLatLngs() ---- */
let parts = polygonParts([squareOpen]);
ok(parts.length === 1 && parts[0].holes.length === 0, "un solo anillo: un elemento sin agujeros");

const hole = [{ lat: 0.002, lng: 0.002 }, { lat: 0.002, lng: 0.008 },
              { lat: 0.008, lng: 0.008 }, { lat: 0.008, lng: 0.002 }];
parts = polygonParts([squareOpen, hole]);
ok(parts.length === 1 && parts[0].holes.length === 1, "exterior + agujero: un elemento con un agujero");

const outer2 = [{ lat: 1, lng: 1 }, { lat: 1, lng: 1.01 }, { lat: 1.01, lng: 1.01 }, { lat: 1.01, lng: 1 }];
parts = polygonParts([[squareOpen], [outer2, hole]]);
ok(parts.length === 2, "multipolígono anidado: dos elementos");
ok(parts[0].holes.length === 0 && parts[1].holes.length === 1,
  "cada parte del multipolígono conserva sus propios agujeros");

/* ---- área con agujero: menor que sin agujero, y próxima a la resta ---- */
const bigSide = 0.02, smallSide = 0.01, offset = 0.005;
const bigOuter = [{ lat: 0, lng: 0 }, { lat: 0, lng: bigSide },
                  { lat: bigSide, lng: bigSide }, { lat: bigSide, lng: 0 }, { lat: 0, lng: 0 }];
const holeRing = [
  { lat: offset, lng: offset }, { lat: offset, lng: offset + smallSide },
  { lat: offset + smallSide, lng: offset + smallSide }, { lat: offset + smallSide, lng: offset },
  { lat: offset, lng: offset }
];
const outerArea = ringArea(bigOuter);
const holeArea = ringArea(holeRing);
const netArea = outerArea - holeArea;
ok(netArea < outerArea, "el área con agujero es menor que sin él");
const approxOuter = (EARTH_R * toRad(bigSide)) ** 2;
const approxHole = (EARTH_R * toRad(smallSide)) ** 2;
ok(Math.abs(netArea - (approxOuter - approxHole)) / (approxOuter - approxHole) < 0.01,
  "área neta cerca de la aproximación plana exterior−agujero");

const partsWithHole = polygonParts([bigOuter, holeRing]);
const computedNet = partsWithHole.reduce((s, p) =>
  s + ringArea(p.outer) - p.holes.reduce((s2, h) => s2 + ringArea(h), 0), 0);
ok(Math.abs(computedNet - netArea) < 1e-6, "polygonParts + ringArea reproduce la misma resta");

/* ---- rawPolygonRings: anillos de una geometría GeoJSON en crudo ---- */
ok(rawPolygonRings(null) === null, "sin geometría: null");
ok(rawPolygonRings({ type: "LineString", coordinates: [] }) === null,
  "tipo que no es Polygon/MultiPolygon: null");

const rawOuterClosed = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]; /* [lng,lat], cerrado */
const rawOuterOpen = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]]; /* sin repetir el primer punto */

let raw = rawPolygonRings({ type: "Polygon", coordinates: [rawOuterClosed] });
ok(raw.length === 1 && raw[0].length === 1, "Polygon: un elemento con un anillo");

raw = rawPolygonRings({ type: "MultiPolygon", coordinates: [[rawOuterClosed], [rawOuterOpen]] });
ok(raw.length === 2, "MultiPolygon: tantos elementos como polígonos");

/* El caso real del pedido: un L.Polygon SIEMPRE quita el punto de cierre
   duplicado al construirse (verificado contra Leaflet 1.9.4 real), así
   que getLatLngs() ya no sirve para saber si el archivo original traía
   el anillo cerrado o no. rawPolygonRings, sobre las coordenadas ORIGINALES
   del GeoJSON (antes de Leaflet), sí lo distingue correctamente.       */
const closedAsLatLng = rawOuterClosed.map(([lng, lat]) => ({ lat, lng }));
const openAsLatLng = rawOuterOpen.map(([lng, lat]) => ({ lat, lng }));
ok(ringClosed(closedAsLatLng) === true, "anillo GeoJSON que sí repite el punto de cierre: cerrado");
ok(ringClosed(openAsLatLng) === false, "anillo GeoJSON que no lo repite (algunos JSON): no cerrado");

if (!process.exitCode) console.log("POLYGON AREA/PERIMETER TESTS OK");
