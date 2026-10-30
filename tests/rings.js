/* Anillos de alcance y sectores (51-geodesy.js, 53-range-rings.js): la
   geometría y la lectura de radios, puras. El diálogo, la vista previa y
   los nodos del árbol los cubre tests/browser/rings.mjs.               */
const { fn, between, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const L = { latLng: (lat, lng) => ({ lat, lng }) };
const geo = new Function("L", [constDecl("EARTH_R"), constDecl("toRad"), constDecl("toDeg"), fn("destPoint"), fn("arcPoints"),
  constDecl("METERS_PER_NM"), constDecl("METERS_PER_MILE"), constDecl("METERS_PER_FOOT"),
  between("const RANGE_STEP_DEG", "/* getLatLngs() de un L.Polygon"),
  constDecl("POLY_UNIT_FACTOR"), constDecl("POLY_UNIT_LABEL"),
  between("const RANGE_DEFAULT_RADII", "/* ---------- Diálogo ----------"),
  `return { ringLatLngs, sectorLatLngs, sectorSweep, radialLatLngs, parseRadiusList, rangeRadiusLabel, rangeShapes,
           RANGE_MAX_M, RANGE_MAX_RINGS, RANGE_STEP_DEG, haversine: (a, b) => {
    const dp = toRad(b.lat - a.lat), dl = toRad(b.lng - a.lng);
    const h = Math.sin(dp / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dl / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.sqrt(h)); } };`].join("\n"))(L);
const { ringLatLngs, sectorLatLngs, sectorSweep, radialLatLngs, parseRadiusList, rangeRadiusLabel, rangeShapes, haversine } = geo;
const NM = 1852;
const madrid = { lat: 40.4, lng: -3.7 };

/* ---------- Anillo ---------- */
const ring = ringLatLngs(madrid, 50 * NM);
ok(ring.length === 180, "un vértice cada 2°: 180 (y el primero no se repite al final): " + ring.length);
ok(ring.every(p => Math.abs(haversine(madrid, p) - 50 * NM) < 50 * NM * 1e-3), "cada vértice a r del centro (±0,1 %)");
const norte = ring[0], este = ring[45];
ok(norte.lat > madrid.lat && Math.abs(norte.lng - madrid.lng) < 1e-9, "el primero cae al norte");
ok(este.lng > madrid.lng, "y va en sentido horario (el 45º, a 90°, al este)");
ok(ringLatLngs(madrid, 1000, 90).length === 12, "un paso enorme no baja de 12 lados");

/* ---------- Sector ---------- */
ok(sectorSweep(0, 90) === 90 && sectorSweep(330, 30) === 60 && sectorSweep(90, 0) === 270, "apertura en sentido horario: 330→30 son 60°, no 300");
ok(sectorSweep(10, 10) === 0 && sectorSweep(0, 360) === 0, "azimut igual (o 0 y 360): no hay sector");
const sec = sectorLatLngs(madrid, 330, 30, 40 * NM, 0);
ok(sec[0].lat === madrid.lat && sec[0].lng === madrid.lng, "el sector empieza en el centro");
ok(sec.length === 1 + 30 + 1, "centro + arco de 60° en tramos de 2°: " + sec.length);
const arc = sec.slice(1);
ok(arc.every(p => Math.abs(haversine(madrid, p) - 40 * NM) < 40 * NM * 1e-3), "el arco está a r del centro");
const brg = p => (Math.atan2(Math.sin((p.lng - madrid.lng) * Math.PI / 180) * Math.cos(p.lat * Math.PI / 180),
  Math.cos(madrid.lat * Math.PI / 180) * Math.sin(p.lat * Math.PI / 180) - Math.sin(madrid.lat * Math.PI / 180) * Math.cos(p.lat * Math.PI / 180) * Math.cos((p.lng - madrid.lng) * Math.PI / 180)) * 180 / Math.PI + 360) % 360;
ok(Math.abs(brg(arc[0]) - 330) < 0.1 && Math.abs(brg(arc[arc.length - 1]) - 30) < 0.1, "de 330° a 30° pasando por el norte: " + brg(arc[0]).toFixed(2) + " → " + brg(arc[arc.length - 1]).toFixed(2));
ok(arc.every(p => { const b = brg(p); return b >= 329.9 || b <= 30.1; }), "ningún punto fuera de la apertura");
ok(sectorLatLngs(madrid, 20, 20, 1000).length === 0, "sin apertura, sin vértices");

const crown = sectorLatLngs(madrid, 0, 90, 40 * NM, 20 * NM);
ok(crown.length === 2 * (45 + 1), "corona: arco exterior de ida e interior de vuelta: " + crown.length);
ok(Math.abs(haversine(madrid, crown[0]) - 40 * NM) < 40, "empieza en el radio exterior");
ok(Math.abs(haversine(madrid, crown[crown.length - 1]) - 20 * NM) < 40, "y vuelve por el interior");
ok(crown.every(p => { const d = haversine(madrid, p); return Math.abs(d - 40 * NM) < 80 || Math.abs(d - 20 * NM) < 80; }), "sin vértices en el centro");
const wide = sectorLatLngs(madrid, 10, 350, 10 * NM);
ok(wide.length === 1 + 170 + 1, "un sector de 340° sigue siendo un sector, no un anillo: " + wide.length);

/* ---------- Radiales ---------- */
const rad = radialLatLngs(madrid, 30 * NM, 45);
ok(rad.length === 8 && rad.every(r => r.length === 2 && r[0].lat === madrid.lat), "cada 45° salen 8 radiales, desde el centro");
ok(Math.abs(haversine(madrid, rad[2][1]) - 30 * NM) < 30, "hasta el radio mayor");
ok(radialLatLngs(madrid, 1000, 7).length === 52, "7° no divide 360: 0°, 7° … 357° (52)");

/* ---------- Cruce del antimeridiano ---------- */
const fiji = { lat: -17, lng: 179.9 };
const big = ringLatLngs(fiji, 100 * NM);
ok(big.some(p => p.lng > 180) && big.every(p => Math.abs(p.lng - fiji.lng) < 5), "cruzando ±180° las longitudes quedan continuas (>180), no saltan");

/* ---------- Lista de radios ---------- */
const nm = NM;
let r = parseRadiusList("10, 20 30;40", nm);
ok(r.values && r.values.join() === [10, 20, 30, 40].map(x => x * nm).join(), "separadores: coma, espacio y punto y coma");
ok(parseRadiusList("30 10 20 10", nm).values.join() === [10, 20, 30].map(x => x * nm).join(), "se ordenan y se quitan los repetidos");
ok(parseRadiusList("2.5", nm).values[0] === 2.5 * nm, "decimales con punto");
ok(parseRadiusList("", nm).error === "empty" && parseRadiusList(" , ; ", nm).error === "empty", "vacío");
for (const bad of ["abc", "10,x", "-5", "1e3", "0", "0.0", "2,5", "10 .5"]) {
  ok(["bad"].includes(parseRadiusList(bad, nm).error) || (bad === "2,5" && parseRadiusList(bad, nm).values.length === 2), `ilegible: «${bad}» → ${JSON.stringify(parseRadiusList(bad, nm))}`);
}
ok(parseRadiusList("6000", nm).error === "max" && parseRadiusList("5000", nm).values, "tope de 10 000 km (5400 NM sí, 6000 no)");
ok(parseRadiusList(Array.from({ length: 41 }, (_, i) => i + 1).join(" "), 1).error === "count", "más de 40 anillos");
ok(parseRadiusList(Array.from({ length: 40 }, (_, i) => i + 1).join(" "), 1).values.length === 40, "40 sí");

/* ---------- Etiqueta y formas ---------- */
ok(rangeRadiusLabel(10 * NM, "nm") === "10 NM" && rangeRadiusLabel(2.5 * 1000, "km") === "2.5 km" && rangeRadiusLabel(1000, "m") === "1000 m",
  "etiqueta sin ceros de relleno: " + rangeRadiusLabel(10 * NM, "nm") + ", " + rangeRadiusLabel(2500, "km"));
const sh = rangeShapes({ mode: "rings", center: madrid, radii: [NM * 10, NM * 20], radialStep: 90 });
ok(sh.map(s => s.kind).join() === "ring,ring,radials" && sh[2].latlngs.length === 4, "dos anillos y las radiales detrás");
ok(Math.abs(haversine(madrid, sh[2].latlngs[0][1]) - 20 * NM) < 20, "las radiales llegan al anillo mayor");
ok(rangeShapes({ mode: "rings", center: madrid, radii: [NM], radialStep: 0 }).length === 1, "sin radiales, solo anillos");
ok(rangeShapes({ mode: "sector", center: madrid, az1: 0, az2: 90, rOut: NM * 5, rIn: 0 }).map(s => s.kind).join() === "sector", "un sector es una forma");

if (!process.exitCode) console.log("RINGS TESTS OK");
