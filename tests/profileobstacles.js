/* Polígonos con altitud como obstáculos del perfil de una ruta (63-route-profile.js,
   «Obstáculos»; el modo de altitud se lee en 20-kml-geom.js): lo PURO, sin
   navegador. Cruces de la ruta con un polígono (interpolación en el lado cortado,
   agujeros, cóncavos, rutas que empiezan o acaban dentro), el techo AMSL y el AGL
   sobre el terreno del propio perfil, qué obstáculos tapan la línea inicio–fin y
   por dónde, y la validación de lo guardado (obstáculos y torres). La parte con
   Leaflet y el mapa (recoger los polígonos visibles, dibujar, guardar con el
   perfil) la cubre browser/elev-profile.mjs.                                   */
const { DOMParser } = require("@xmldom/xmldom");
const { fn, between, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const api = new Function(
  [constDecl("PF_TOWER_MAX"), fn("pointInRing"),
    between("const PROFILE_CHUNK_CELLS", "/* ---------- Cálculo"),
    between("const PROFILE_MAX_OBSTACLES", "/* ---------- Diálogo"),
    fn("validRouteProfile")].join("\n")
  + "\nreturn { profileValueAt, sliceByD, nearestRingAlt, routePolygonSpans, obstacleRoof, profileObstacleFrom,"
  + " packObstacle, obstacleRoofAt, profileObstructions, validProfileObstacles, validProfileTowers,"
  + " validRouteProfile, PROFILE_MAX_OBSTACLES, PROFILE_MAX_OBSTACLE_PTS, PROFILE_MAX_OBSTACLE_SPANS,"
  + " PROFILE_OBSTACLE_NAME_MAX };")();
const { profileValueAt, sliceByD, routePolygonSpans, obstacleRoof, profileObstacleFrom, packObstacle,
  obstacleRoofAt, profileObstructions, validProfileObstacles, validProfileTowers, validRouteProfile } = api;

/* ---------- Geometría de pruebas: coordenadas planas (la proyección da igual) ---------- */
const leg = (ax, ay, bx, by) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, dist: Math.hypot(bx - ax, by - ay), scale: 1 });
const route = (...pts) => {
  const legs = [], vertices = [0];
  for (let i = 0; i + 1 < pts.length; i++) {
    legs.push(leg(...pts[i], ...pts[i + 1]));
    vertices.push(vertices[i] + legs[i].dist);
  }
  return { legs, vertices };
};
const poly = (...pts) => pts.map(([x, y, z]) => ({ x, y, z: z === undefined ? NaN : z }));
const straight = route([0, 0], [1000, 0]);

/* ---------- profileValueAt y sliceByD ---------- */
const terrain = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map(d => ({ d, v: 1000 + d * 0.1 }));
ok(profileValueAt(terrain, 150) === 1015, "lineal entre vecinos: " + profileValueAt(terrain, 150));
ok(profileValueAt(terrain, -50) === 1000 && profileValueAt(terrain, 5000) === 1100, "fuera de la serie, el valor del extremo");
ok(Number.isNaN(profileValueAt([], 1)), "sin puntos, NaN (nunca un número inventado)");
const sl = sliceByD(terrain, 150, 450);
ok(sl.map(p => p.d).join() === "150,200,300,400,450" && sl[0].v === 1015 && sl.at(-1).v === 1045,
  "sliceByD: extremos interpolados y los puntos de dentro: " + JSON.stringify(sl));
ok(sliceByD(terrain, 200, 200).length === 0 && sliceByD([], 0, 1).length === 0, "un intervalo vacío no da nada");
ok(sliceByD(terrain, 200, 400).map(p => p.d).join() === "200,300,400", "un punto justo en el borde no se repite");

/* ---------- Cruces con un polígono ---------- */
/* Cuadrado de x 200–400, y ±100; la altura crece de oeste a este: 100 → 140 */
const square = poly([200, -100, 100], [400, -100, 140], [400, 100, 140], [200, 100, 100]);
let spans = routePolygonSpans(straight.legs, straight.vertices, [square]);
ok(spans.length === 1 && spans[0].d0 === 200 && spans[0].d1 === 400 && spans[0].z0 === 100 && spans[0].z1 === 140,
  "un cuadrado: un tramo, de la entrada a la salida: " + JSON.stringify(spans));

/* La altura del cruce se INTERPOLA entre los dos vértices del lado cortado:
   el lado oeste va de 0 (y = −100) a 100 (y = +100) y la ruta lo corta en y = 0 */
const slanted = poly([200, -100, 0], [400, -100, 0], [400, 100, 100], [200, 100, 100]);
spans = routePolygonSpans(straight.legs, straight.vertices, [slanted]);
ok(near(spans[0].z0, 50) && near(spans[0].z1, 50), "interpolada entre los vértices del lado: " + JSON.stringify(spans));
/* Cortando más cerca de un vértice, más cerca de su altura */
const off = route([0, 50], [1000, 50]);
spans = routePolygonSpans(off.legs, off.vertices, [slanted]);
ok(near(spans[0].z0, 75), "a y = +50, tres cuartos del lado: " + spans[0].z0);

/* Dos tramos: la distancia del cruce suma los tramos anteriores (la del muestreo) */
const bent = route([0, 0], [500, 0], [500, 500]);
const northBox = poly([400, 200, 10], [600, 200, 10], [600, 300, 30], [400, 300, 30]);
spans = routePolygonSpans(bent.legs, bent.vertices, [northBox]);
ok(spans.length === 1 && near(spans[0].d0, 700) && near(spans[0].d1, 800), "en el segundo tramo, 500 + y: " + JSON.stringify(spans));
ok(spans[0].z0 === 10 && spans[0].z1 === 30, "con su altura en cada cruce");

/* Un agujero saca la ruta del polígono: dos tramos */
const hole = poly([300, -20, 100], [350, -20, 100], [350, 20, 100], [300, 20, 100]);
spans = routePolygonSpans(straight.legs, straight.vertices, [square, hole]);
ok(spans.length === 2 && spans[0].d0 === 200 && spans[0].d1 === 300 && spans[1].d0 === 350 && spans[1].d1 === 400,
  "un agujero parte el tramo en dos: " + JSON.stringify(spans));

/* Un polígono cóncavo (una U) cruzado por la ruta entra y sale dos veces */
const U = poly([100, -100, 5], [500, -100, 5], [500, 100, 5], [400, 100, 5], [400, -50, 5], [200, -50, 5], [200, 100, 5], [100, 100, 5]);
const lowRoute = route([0, 50], [1000, 50]); /* y = 50 corta los dos brazos de la U */
spans = routePolygonSpans(lowRoute.legs, lowRoute.vertices, [U]);
ok(spans.length === 2 && spans[0].d0 === 100 && spans[0].d1 === 200 && spans[1].d0 === 400 && spans[1].d1 === 500,
  "una U cortada por los brazos: dos tramos: " + JSON.stringify(spans));
const highRoute = route([0, -75], [1000, -75]); /* por el fondo de la U: un solo tramo */
spans = routePolygonSpans(highRoute.legs, highRoute.vertices, [U]);
ok(spans.length === 1 && spans[0].d0 === 100 && spans[0].d1 === 500, "por el fondo, uno solo");

/* Una ruta que no toca el polígono no da nada; una paralela, tampoco */
ok(routePolygonSpans(route([0, 500], [1000, 500]).legs, [0, 1000], [square]).length === 0, "no cruza: nada");
ok(routePolygonSpans(route([0, 100], [1000, 100]).legs, [0, 1000], [square]).length === 0, "corriendo sobre un lado, no cruza");

/* Empezar o acabar DENTRO: el tramo arranca en 0 / acaba en el total, con la altura del contorno más cercano */
const inside = route([300, 0], [1000, 0]);
spans = routePolygonSpans(inside.legs, inside.vertices, [square]);
ok(spans.length === 1 && spans[0].d0 === 0 && near(spans[0].d1, 100), "empieza dentro: de 0 a la salida: " + JSON.stringify(spans));
ok(near(spans[0].z0, 120) || spans[0].z0 >= 100 && spans[0].z0 <= 140, "con la altura del punto más cercano del contorno: " + spans[0].z0);
const endsIn = route([0, 0], [300, 0]);
spans = routePolygonSpans(endsIn.legs, endsIn.vertices, [square]);
ok(spans.length === 1 && spans[0].d0 === 200 && spans[0].d1 === 300, "acaba dentro: de la entrada al total: " + JSON.stringify(spans));
const allIn = route([250, 0], [350, 0]);
spans = routePolygonSpans(allIn.legs, allIn.vertices, [square]);
ok(spans.length === 1 && spans[0].d0 === 0 && near(spans[0].d1, 100), "toda la ruta dentro: un tramo de 0 al total");

/* Un cruce justo en un vértice del polígono no se cuenta dos veces */
const diamond = poly([500, -100, 7], [600, 0, 7], [500, 100, 7], [400, 0, 7]);
spans = routePolygonSpans(straight.legs, straight.vertices, [diamond]);
ok(spans.length === 1 && near(spans[0].d0, 400) && near(spans[0].d1, 600), "por dos vértices opuestos: un tramo, no cuatro cruces: " + JSON.stringify(spans));

/* Un vértice de la ruta en el borde del polígono tampoco duplica */
const joint = route([0, 0], [200, 0], [1000, 0]);
spans = routePolygonSpans(joint.legs, joint.vertices, [square]);
ok(spans.length === 1 && spans[0].d0 === 200 && spans[0].d1 === 400, "un vértice de la ruta justo en el lado: un solo cruce");

/* ---------- El techo ---------- */
const abs = obstacleRoof({ d0: 200, z0: 100, d1: 400, z1: 140 }, "abs", terrain);
ok(JSON.stringify(abs) === "[[200,100],[400,140]]", "AMSL: la recta de la entrada a la salida");
const agl = obstacleRoof({ d0: 150, z0: 30, d1: 450, z1: 60 }, "agl", terrain);
ok(agl.map(p => p[0]).join() === "150,200,300,400,450", "AGL: un punto por cada uno del terreno dentro del tramo: " + JSON.stringify(agl));
ok(near(agl[0][1], 1015 + 30) && near(agl[2][1], 1030 + 45) && near(agl.at(-1)[1], 1045 + 60),
  "AGL: el terreno de ESE punto más la altura interpolada: " + JSON.stringify(agl));
ok(obstacleRoof({ d0: 0, z0: 5, d1: 10, z1: 5 }, "agl", []) === null, "AGL sin terreno: no se puede convertir");

/* ---------- De un polígono a un obstáculo ---------- */
const mk = (rings, mode, name = "Edificio") => ({ name, mode, rings });
/* El terreno de la serie anda por 1020–1040 m en x 200–400: este cuadrado, a 1100–1140 AMSL, sobresale */
const tall = poly([200, -100, 1100], [400, -100, 1140], [400, 100, 1140], [200, 100, 1100]);
let got = profileObstacleFrom(mk([tall], null), straight.legs, straight.vertices, terrain);
ok(got.obstacle && got.obstacle.mode === "abs" && got.obstacle.name === "Edificio" && got.obstacle.spans.length === 1,
  "sin modo, la Z es AMSL: " + JSON.stringify(got));
ok(profileObstacleFrom(mk([square], "agl"), straight.legs, straight.vertices, terrain).obstacle.mode === "agl", "modo AGL");
ok(profileObstacleFrom(mk([square], "ground"), straight.legs, straight.vertices, terrain).why === "ground", "pegado al suelo: no es obstáculo");
ok(profileObstacleFrom(mk([square], "sea"), straight.legs, straight.vertices, terrain).why === "sea", "fondo marino: se descarta, con su motivo");
ok(profileObstacleFrom(mk([poly([2000, 0, 5], [2100, 0, 5], [2100, 50, 5])], null), straight.legs, straight.vertices, terrain).why === "outside",
  "fuera de la ruta: outside (y sea/ground no se mencionan si ni cruzan)");
ok(profileObstacleFrom(mk([poly([200, -100, 100], [400, -100], [400, 100], [200, 100, 100])], null), straight.legs, straight.vertices, terrain).why === "noalt",
  "el lado cortado sin altitud en un vértice: noalt");
/* Una Z de 100 m con el terreno a 1020–1040 m: el techo queda ENTERRADO */
ok(profileObstacleFrom(mk([square], "abs"), straight.legs, straight.vertices, terrain).why === "buried", "un techo bajo el terreno: buried");
ok(profileObstacleFrom(mk([poly([200, -100, 1100], [400, -100, 1100], [400, 100, 1100], [200, 100, 1100])], "abs"), straight.legs, straight.vertices, terrain).obstacle,
  "a 1100 m AMSL sí sobresale del terreno (1020–1040 m)");
ok(profileObstacleFrom(mk([square], "agl"), straight.legs, straight.vertices, []).why === "noterrain", "AGL sin terreno en la serie: noterrain");
/* Sin terreno que comparar (todo huecos) un AMSL se conserva: no se sabe que esté enterrado */
ok(profileObstacleFrom(mk([square], "abs"), straight.legs, straight.vertices, [{ d: 0, v: null }]).obstacle, "AMSL con el terreno en huecos: se conserva");

const packed = packObstacle({ name: "x", mode: "abs", spans: [[[0.04, 1.234], [10.06, 2.999]]] });
ok(JSON.stringify(packed.spans) === "[[[0,1.23],[10.1,3]]]", "d a 0,1 m y z a 0,01 m: " + JSON.stringify(packed.spans));

/* ---------- El techo en una distancia ---------- */
const ob = { name: "A", mode: "abs", spans: [[[200, 100], [400, 140]], [[600, 50], [700, 50]]] };
ok(obstacleRoofAt(ob, 300) === 120 && obstacleRoofAt(ob, 650) === 50, "interpolado dentro de un tramo");
ok(obstacleRoofAt(ob, 500) === null && obstacleRoofAt(ob, 100) === null, "fuera de todos los tramos: null");
ok(obstacleRoofAt(ob, 200) === 100 && obstacleRoofAt(ob, 400) === 140, "los extremos cuentan");

/* ---------- Qué tapa la línea inicio–fin ---------- */
/* Modelo de enlace simulado: recta a 150 m entre las torres 0 y 1000, sin curvatura */
const link = (dA = 0, dB = 1000, h = 150) => ({ los: { kind: "mdt", a: h, b: h }, dA, dB, lift: () => 0, losAt: () => h });
const flat = (z, d0 = 200, d1 = 400) => ({ name: "B" + z, mode: "abs", spans: [[[d0, z], [d1, z]]] });
let r = profileObstructions([flat(100), flat(160)], link());
ok(r.length === 2, "dos obstáculos entre las torres");
ok(near(r[0].clear, 50) && r[0].blocked.length === 0, "techo a 100 con la recta a 150: despeje +50, no tapa: " + JSON.stringify(r[0]));
ok(near(r[1].clear, -10) && r[1].blocked.length === 1 && r[1].blocked[0][0] === 200 && r[1].blocked[0][1] === 400,
  "techo a 160: despeje −10 y tapa todo el tramo: " + JSON.stringify(r[1]));
/* Un techo inclinado que cruza la recta: tapa solo desde donde la pasa */
const ramp = { name: "R", mode: "abs", spans: [[[0, 100], [1000, 200]]] }; /* 150 m a mitad de ruta */
r = profileObstructions([ramp], link());
ok(r[0].blocked.length === 1 && near(r[0].blocked[0][0], 500, 1e-6) && r[0].blocked[0][1] === 1000,
  "el techo pasa la recta en d = 500 (cruce interpolado): " + JSON.stringify(r[0].blocked));
ok(near(r[0].clear, -50) && r[0].at === 1000, "peor despeje al final: " + JSON.stringify(r[0]));
/* Fuera de las torres no hay enlace */
ok(profileObstructions([flat(500, 0, 100)], link(200, 800)).length === 0, "un obstáculo fuera de las torres no cuenta");
const half = profileObstructions([flat(500, 100, 500)], link(300, 800));
ok(half.length === 1 && half[0].blocked[0][0] === 300 && half[0].blocked[0][1] === 500, "solo la parte entre las torres: " + JSON.stringify(half));
ok(profileObstructions([flat(500)], { ...link(), los: null }).length === 0, "sin recta, nada que comprobar");
/* Con curvatura: el despeje es losAt − lift − techo, el mismo marco que el del terreno */
const bulged = { los: { kind: "mdt", a: 150, b: 150 }, dA: 0, dB: 1000, lift: d => 30, losAt: () => 150 + 30 };
r = profileObstructions([flat(130)], bulged);
ok(near(r[0].clear, 20), "el despeje resta lift: 150 + 30 − 30 − 130 = 20: " + r[0].clear);
/* Una curva no lineal también se detecta aunque los extremos queden libres */
const arch = { los: { kind: "mdt", a: 100, b: 100 }, dA: 0, dB: 1000, lift: () => 0, losAt: d => 100 - ((d - 500) / 500) ** 2 * -20 };
r = profileObstructions([flat(110, 0, 1000)], arch);
ok(r[0].blocked.length === 1 && r[0].blocked[0][0] > 0 && r[0].blocked[0][1] < 1000, "la recta curvada por debajo del techo solo en el centro: " + JSON.stringify(r[0].blocked));

/* ---------- Lo que viene de fuera ---------- */
const good = { name: "Torre", mode: "abs", spans: [[[10, 100.5], [20, 101]]] };
let v = validProfileObstacles([good], 1000);
ok(v.length === 1 && v[0].name === "Torre" && v[0].spans[0][1][1] === 101, "un obstáculo bien formado pasa");
ok(validProfileObstacles(undefined, 1000) === null && validProfileObstacles(null, 1000) === null && validProfileObstacles("x", 1000) === null,
  "sin obstáculos guardados (un perfil de antes) o con otra forma: null");
ok(Array.isArray(validProfileObstacles([], 1000)) && validProfileObstacles([], 1000).length === 0, "una lista vacía es válida: ninguno");
const bads = [
  { ...good, mode: "sea" }, { ...good, mode: "x" }, { ...good, name: 5 }, { ...good, spans: [] }, { ...good, spans: "x" },
  { ...good, spans: [[[10, 1]]] }, { ...good, spans: [[[10, 1], [5, 1]]] },            /* un solo punto; no creciente */
  { ...good, spans: [[[10, NaN], [20, 1]]] }, { ...good, spans: [[[10, 1], [20, Infinity]]] },
  { ...good, spans: [[[-5, 1], [20, 1]]] }, { ...good, spans: [[[10, 1], [5000, 1]]] },  /* d fuera de la ruta */
  { ...good, spans: [[[10, 1, 3], [20, 1]]] }, null, 7, "x"
];
for (const b of bads) {
  ok(validProfileObstacles([b, good], 1000).length === 1, "un obstáculo malo se descarta y el resto sigue: " + JSON.stringify(b));
}
const longName = validProfileObstacles([{ ...good, name: "x".repeat(5000) }], 1000)[0].name;
ok(longName.length === api.PROFILE_OBSTACLE_NAME_MAX, "el nombre se corta: " + longName.length);
ok(validProfileObstacles(Array.from({ length: api.PROFILE_MAX_OBSTACLES + 50 }, () => good), 1000).length === api.PROFILE_MAX_OBSTACLES,
  "tope de obstáculos");
const bigSpan = { name: "G", mode: "abs", spans: [Array.from({ length: 60000 }, (_, i) => [i * 0.01, 1])] };
ok(validProfileObstacles([bigSpan, bigSpan, good], 1000).length === 1, "tope de puntos entre todos: el segundo gran obstáculo ya no cabe");
ok(validProfileObstacles([{ ...good, spans: Array.from({ length: api.PROFILE_MAX_OBSTACLE_SPANS + 1 }, () => [[1, 1], [2, 1]]) }], 1000).length === 0,
  "tope de tramos de un obstáculo");
/* No comparte objetos con lo recibido */
const src = { ...good, spans: [[[10, 1], [20, 2]]] };
const copy = validProfileObstacles([src], 1000)[0];
copy.spans[0][0][1] = 99;
ok(src.spans[0][0][1] === 1, "devuelve copias: no toca lo recibido");

/* Torres */
ok(JSON.stringify(validProfileTowers({ a: { at: 0, m: 12.5 }, b: { at: 3, m: 0 } }, 4)) === '{"a":{"at":0,"m":12.5},"b":{"at":3,"m":0}}', "torres válidas");
const badTowers = [null, 5, {}, { a: { at: 0, m: 1 } }, { a: { at: 2, m: 1 }, b: { at: 2, m: 1 } }, { a: { at: 3, m: 1 }, b: { at: 1, m: 1 } },
  { a: { at: 0, m: -1 }, b: { at: 1, m: 1 } }, { a: { at: 0, m: 1 }, b: { at: 9, m: 1 } }, { a: { at: 0.5, m: 1 }, b: { at: 1, m: 1 } },
  { a: { at: 0, m: NaN }, b: { at: 1, m: 1 } }, { a: { at: 0, m: 1 }, b: { at: 1, m: 1e9 } }, { a: { at: "0", m: 1 }, b: { at: 1, m: 1 } }];
for (const t of badTowers) ok(validProfileTowers(t, 4) === null, "torres inválidas: " + JSON.stringify(t));

/* validRouteProfile los conserva, los descarta si son malos, y un perfil de antes sigue valiendo */
const base = { key: "k", total: 1000, vertices: [0, 500, 1000], mdt: { src: "ign-mdt05", pts: [[0, 1], [10, 2]] }, mds: null };
let p = validRouteProfile({ ...base, obstacles: [good], towers: { a: { at: 0, m: 10 }, b: { at: 2, m: 5 } } });
ok(p && p.obstacles.length === 1 && p.towers.b.m === 5, "el perfil conserva obstáculos y torres");
p = validRouteProfile(base);
ok(p && !("obstacles" in p) && !("towers" in p), "un perfil sin ellos (de antes) vale tal cual");
p = validRouteProfile({ ...base, obstacles: "no", towers: { a: 1 } });
ok(p && !("obstacles" in p) && !("towers" in p), "obstáculos o torres mal formados no tumban el perfil: se quedan sin ellos");
p = validRouteProfile({ ...base, obstacles: [] });
ok(p && Array.isArray(p.obstacles) && p.obstacles.length === 0, "una lista vacía se conserva (se calcularon y no había ninguno)");
p = validRouteProfile({ ...base, towers: { a: { at: 0, m: 10 }, b: { at: 7, m: 5 } } });
ok(p && !p.towers, "un vértice que no existe en esta ruta: sin torres guardadas");

/* ---------- El modo de altitud de un KML (20-kml-geom.js) ---------- */
const imp = new Function(between("/* Nombre sin prefijo", "/* Un <Polygon> KML")
  + "\nreturn { kmlAltitudeMode, featureAltMode, ALT_MODES };")();
const polyOf = inner => {
  const doc = new DOMParser().parseFromString(
    `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Placemark>`
    + `<LookAt><gx:altitudeMode>relativeToSeaFloor</gx:altitudeMode><altitudeMode>absolute</altitudeMode></LookAt>`
    + `<Polygon>${inner}<outerBoundaryIs><LinearRing><coordinates>0,0,5 1,0,5 1,1,5 0,0,5</coordinates></LinearRing></outerBoundaryIs></Polygon>`
    + `</Placemark></kml>`, "text/xml");
  return doc.getElementsByTagName("Polygon")[0];
};
const modeOf = inner => imp.kmlAltitudeMode(polyOf(inner));
ok(modeOf("") === null, "sin <altitudeMode> (aunque el <LookAt> del mismo placemark traiga uno): null");
ok(modeOf("<altitudeMode>absolute</altitudeMode>") === "abs", "absolute → abs");
ok(modeOf("<altitudeMode>relativeToGround</altitudeMode>") === "agl", "relativeToGround → agl");
ok(modeOf("<altitudeMode>clampToGround</altitudeMode>") === "ground", "clampToGround → ground");
ok(modeOf("<gx:altitudeMode>relativeToSeaFloor</gx:altitudeMode>") === "sea", "gx:relativeToSeaFloor → sea");
ok(modeOf("<gx:altitudeMode>clampToSeaFloor</gx:altitudeMode>") === "sea", "gx:clampToSeaFloor → sea");
ok(modeOf("<altitudeMode>absolute</altitudeMode><gx:altitudeMode>clampToSeaFloor</gx:altitudeMode>") === "sea", "si están los dos, manda gx:");
ok(modeOf("<altitudeMode> relativeToGround </altitudeMode>") === "agl", "con espacios alrededor");
ok(modeOf("<altitudeMode>volando</altitudeMode>") === null && modeOf("<altitudeMode>__proto__</altitudeMode>") === null, "un valor desconocido: sin modo");
ok(modeOf("<altitudeMode>constructor</altitudeMode>") === null, "ni un nombre de Object.prototype");
ok(imp.featureAltMode({ kiteAlt: "agl" }) === "agl" && imp.featureAltMode({ kiteAlt: "x" }) === null
  && imp.featureAltMode({}) === null && imp.featureAltMode(null) === null && imp.featureAltMode({ kiteAlt: "toString" }) === null,
  "featureAltMode: solo los cuatro valores, lo demás es «sin modo»");

if (!process.exitCode) console.log("PROFILE OBSTACLES TESTS OK");
