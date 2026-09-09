/* Mediciones: estilo propio, medidas del diálogo de propiedades y
   renombrado sin perder la medida.

   Tres cosas que antes no existían o estaban mal:

   1. Una medición no tenía estilo editable (`styleable: false`, colores
      fijos por tipo). Ahora lleva su propio estilo de trazo, se guarda
      con el nodo y una LÍNEA nunca puede rellenarse — la misma regla
      que ya vale para cualquier trazo abierto.
   2. El diálogo enseña sus medidas: distancia y rumbo de una línea,
      radio y área de un círculo, con la misma unidad recordada que el
      perímetro/área de un polígono. El área de un círculo es la del
      CASQUETE esférico, no πr².
   3. Renombrar una medición perdía la distancia de su fila: startRename
      devolvía la etiqueta reescribiéndola con `li._name`, y el texto de
      una medición no es el nombre a secas sino "Nombre — 1,20 km · 45°".
      Con el nombre sin cambiar (o cancelando con Escape) setNodeName
      sale antes de llamar a _onRename, que es quien lo repinta, así que
      la medida se quedaba borrada.                                    */
const { parseHTML } = require("linkedom");
const { fn, constDecl, between } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* ================= 1. Estilo por defecto de una medición ================= */
const styleSrc = constDecl("MEASURE_COLORS") + "\n"
  + constDecl("defaultMeasureStyle") + "\n" + fn("normalizePathStyle");
const st = new Function(styleSrc
  + "\nreturn {defaultMeasureStyle, normalizePathStyle, MEASURE_COLORS};")();

const lineStyle = st.normalizePathStyle(st.defaultMeasureStyle("line"));
const circleStyle = st.normalizePathStyle(st.defaultMeasureStyle("circle"));
ok(lineStyle.fill === false, "una línea de medición no se rellena: " + lineStyle.fill);
ok(circleStyle.fill === true, "un círculo sí: " + circleStyle.fill);
ok(lineStyle.color === st.MEASURE_COLORS.line && circleStyle.color === st.MEASURE_COLORS.circle,
  "cada tipo conserva su color de siempre");
/* El contorno nunca lleva opacidad propia, aquí tampoco */
ok(lineStyle.opacity === 1 && circleStyle.opacity === 1, "el contorno va siempre opaco");
ok(circleStyle.fillOpacity === 0.1,
  "el relleno del círculo arranca muy translúcido, para no tapar el mapa: " + circleStyle.fillOpacity);

/* ================= 2. Medidas: casquete esférico y lectura ================= */
const geoSrc = between("/* ================= Geodesia", "/* Rumbo inicial de a")
  + "\n" + fn("bearingDeg") + "\n" + constDecl("capArea");
/* map.distance de sustitución: haversine sobre la misma esfera que usa
   Leaflet (EARTH_R/toRad ya extraídos arriba), no una reimplementación. */
const mapStub = `
const map = { distance(a, b) {
  const p1 = toRad(a.lat), p2 = toRad(b.lat);
  const dp = toRad(b.lat - a.lat), dl = toRad(b.lng - a.lng);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
} };
`;
const mv = new Function(geoSrc + mapStub + "\n" + fn("measurementValues")
  + "\nreturn {measurementValues, capArea, EARTH_R};")();

/* capArea: para un círculo pequeño es πr² con toda la precisión que
   hace falta; para uno grande se separa, y SIEMPRE por debajo (la
   esfera se cierra sobre sí misma, el plano no).                     */
const small = 1000;
ok(Math.abs(mv.capArea(small) - Math.PI * small * small) / (Math.PI * small * small) < 1e-6,
  "a 1 km el casquete y πr² coinciden: " + mv.capArea(small));
const big = 1000000; /* 1000 km */
ok(mv.capArea(big) < Math.PI * big * big,
  "a 1000 km el casquete es MENOR que πr²: " + mv.capArea(big) + " vs " + Math.PI * big * big);
ok(mv.capArea(0) === 0, "radio cero, área cero");
/* Media esfera: el casquete de radio πR/2 es exactamente 2πR² */
ok(Math.abs(mv.capArea(Math.PI * mv.EARTH_R / 2) - 2 * Math.PI * mv.EARTH_R ** 2) < 1,
  "un cuarto de vuelta de radio cubre medio globo");

/* Una medición de mentira: solo hacen falta sus dos manejadores */
const fakeM = (type, a, b) => ({
  type,
  mOrigin: { getLatLng: () => a },
  mDest: { getLatLng: () => b }
});
const A = { lat: 40, lng: -3 }, B = { lat: 40, lng: -2 };

const lineVals = mv.measurementValues(fakeM("line", A, B));
ok(lineVals.circle === false, "una línea no es un círculo");
ok(lineVals.area === null, "una línea no tiene área");
ok(lineVals.brg !== null && Math.abs(lineVals.brg - 90) < 0.5,
  "y sí rumbo, ~90° hacia el este: " + lineVals.brg);
ok(lineVals.dist > 85000 && lineVals.dist < 86000,
  "un grado de longitud a 40°N son ~85 km: " + lineVals.dist);

const circVals = mv.measurementValues(fakeM("circle", A, B));
ok(circVals.circle === true, "un círculo sí lo es");
ok(circVals.brg === null, "un círculo no tiene rumbo: el radio apunta a todas partes");
ok(circVals.area === mv.capArea(circVals.dist),
  "su área es la del casquete de su radio, no πr²");
ok(circVals.dist === lineVals.dist, "y el radio se mide igual que la distancia");

/* ---------- renderMeasureValues: unidades y filas que se ocultan ---------- */
const { document } = parseHTML(`
  <span id="ms-dist-label"></span><span id="ms-dist"></span>
  <div id="ms-area-row"><span id="ms-area"></span></div>
  <div id="ms-bearing-row"><span id="ms-bearing"></span></div>`);
const units = constDecl("METERS_PER_NM") + "\n" + constDecl("METERS_PER_FOOT") + "\n"
  + constDecl("POLY_UNIT_FACTOR") + "\n" + constDecl("POLY_UNIT_LABEL") + "\n"
  + constDecl("fmtUnitDist") + "\n" + constDecl("fmtUnitArea");
const render = new Function("document",
  "const $id = id => document.getElementById(id);\n" + units
  + "\nlet measureUnit = 'm';\nlet msMeasures = null;\n"
  + fn("renderMeasureValues")
  + "\nreturn { fmtUnitDist, fmtUnitArea,"
  + " render(vals, unit) { msMeasures = vals; measureUnit = unit;"
  + " renderMeasureValues(); } };")(document);
const $ = id => document.getElementById(id);

/* fmtUnitDist/fmtUnitArea: el MISMO formateo para el diálogo y para las
   etiquetas del visor, así que se prueban por su cuenta.             */
ok(render.fmtUnitDist(1852, "nm") === "1.00 NM", "1852 m es 1 NM exacta");
ok(render.fmtUnitDist(1852, "m") === "1852.00 m", "y 1852,00 m en metros");
ok(render.fmtUnitDist(1000, "km") === "1.00 km", "1000 m es 1 km");
ok(render.fmtUnitDist(0.3048, "ft") === "1.00 ft", "0,3048 m es 1 pie exacto");
/* El área usa el factor AL CUADRADO, no el mismo que la distancia */
ok(render.fmtUnitArea(1e6, "km") === "1.00 km²", "un millón de m² es 1 km²");
ok(render.fmtUnitArea(1e6, "m") === "1000000.00 m²", "y en metros, un millón");

render.render({ circle: false, dist: 1852, area: null, brg: 45 }, "m");
ok($("ms-dist-label").textContent === "Distancia", "una línea mide DISTANCIA");
ok($("ms-dist").textContent === "1852.00 m", "en metros: " + $("ms-dist").textContent);
ok($("ms-area-row").hidden === true, "y sin fila de área");
ok($("ms-bearing-row").hidden === false && $("ms-bearing").textContent === "45.0°",
  "el rumbo va en grados, con un decimal: " + $("ms-bearing").textContent);

/* La misma medida en millas náuticas: 1852 m es exactamente 1 NM */
render.render({ circle: false, dist: 1852, area: null, brg: 45 }, "nm");
ok($("ms-dist").textContent === "1.00 NM", "1852 m es 1 NM exacta: " + $("ms-dist").textContent);
/* El rumbo NO cambia con la unidad: no es una distancia */
ok($("ms-bearing").textContent === "45.0°", "el rumbo sigue en grados");

render.render({ circle: true, dist: 1000, area: mv.capArea(1000), brg: null }, "km");
ok($("ms-dist-label").textContent === "Radio", "un círculo mide RADIO");
ok($("ms-dist").textContent === "1.00 km", "1000 m es 1 km: " + $("ms-dist").textContent);
ok($("ms-bearing-row").hidden === true, "y no enseña rumbo");
ok($("ms-area-row").hidden === false, "pero sí área");
/* El área va en unidad AL CUADRADO: πr² de 1 km son ~3.14 km² */
ok($("ms-area").textContent === "3.14 km²",
  "el área se convierte con el factor al cuadrado: " + $("ms-area").textContent);

/* ============ 3. La etiqueta va en la unidad elegida ============
   Antes la etiqueta del visor y la de la fila del árbol iban siempre en
   métrico Y náutico a la vez (`fmtDist`, ya retirado), sin relación con
   la unidad del diálogo de propiedades. Ahora dicen lo mismo que él, y
   arrancan en NM.                                                     */
const { document: doc3 } = parseHTML("<ul id='tree'></ul>");
const Lstub = { latLng: (lat, lng) => ({ lat, lng }) };
const labelApi = new Function("treeEl", "L", "document",
  geoSrc.replace(constDecl("capArea"), "") + mapStub + "\n" + units
  + "\nlet measureUnit = 'nm';\n"
  + fn("midPoint") + "\n" + fn("updateMeasurement") + "\n" + fn("refreshMeasureLabels")
  + "\nreturn {updateMeasurement, refreshMeasureLabels,"
  + " setUnit: u => { measureUnit = u; }};")(doc3.getElementById("tree"), Lstub, doc3);

/* Una medición de mentira con lo justo que toca updateMeasurement */
function fakeMeasure(type, a, b, name, treeLabel) {
  return {
    type, treeName: name, treeLabel,
    mOrigin: { getLatLng: () => a }, mDest: { getLatLng: () => b },
    geom: { setLatLngs() {}, setLatLng() {}, setRadius(r) { this.radius = r; } },
    label: { setLatLng() {}, setContent(t) { this.content = t; } }
  };
}
const mLbl = fakeMeasure("line", A, B, "Línea 1", null);
labelApi.updateMeasurement(mLbl);
ok(/^45\.99 NM · 89\.\d°$/.test(mLbl.label.content),
  "por defecto, NM y rumbo en grados: " + mLbl.label.content);
labelApi.setUnit("km");
labelApi.updateMeasurement(mLbl);
ok(/^85\.18 km · /.test(mLbl.label.content),
  "en km, la misma medida: " + mLbl.label.content);
/* Y es EXACTAMENTE el formato del diálogo, no otro parecido */
ok(mLbl.label.content.startsWith(render.fmtUnitDist(85179.81, "km").slice(0, 5)),
  "el visor y el diálogo escriben la distancia igual");

/* refreshMeasureLabels alcanza filas Y registros pendientes ---------- */
const rowLabel = { textContent: "" };
const rowM = fakeMeasure("line", A, B, "Línea 1", rowLabel);
const rowLi = doc3.createElement("li");
rowLi._measure = rowM;
doc3.getElementById("tree").appendChild(rowLi);
/* Una carpeta nunca desplegada: su medición está en el mapa sin fila */
const pendM = fakeMeasure("circle", A, B, "Círculo 1", null);
const pendLi = doc3.createElement("li");
pendLi._pending = [{ t: "folder", children: [{ t: "measure", _m: pendM }] }];
doc3.getElementById("tree").appendChild(pendLi);

labelApi.setUnit("nm");
labelApi.refreshMeasureLabels();
ok(rowLabel.textContent === `Línea 1 — ${rowM.label.content}`,
  "la fila del árbol repite la etiqueta con el nombre delante: " + rowLabel.textContent);
ok(/NM/.test(rowLabel.textContent), "y en la unidad nueva: " + rowLabel.textContent);
ok(/NM/.test(pendM.label.content),
  "una medición dentro de una carpeta nunca desplegada también se repinta: "
  + pendM.label.content);
labelApi.setUnit("m");
labelApi.refreshMeasureLabels();
ok(/ m ·/.test(pendM.label.content) && / m ·/.test(rowM.label.content),
  "y vuelven a cambiar juntas: " + pendM.label.content);

/* ================= 4. Renombrar sin perder la medida ================= */
const { document: doc2 } = parseHTML("<ul id='tree'></ul>");
/* linkedom no implementa focus()/select() de un <input>: startRename los
   llama para dejar el nombre listo para escribir encima, que es
   comportamiento de navegador y no lo que se prueba aquí.            */
for (const m of ["focus", "select"]) {
  const proto = doc2.defaultView.HTMLInputElement.prototype;
  if (!proto[m]) proto[m] = () => {};
}
const nameApi = new Function("document", "treeEl",
  "function applyMarkerText() {}\nfunction scheduleSave() {}\n"
  + fn("setNodeName") + "\n" + fn("startRename")
  + "\nreturn {setNodeName, startRename};")(doc2, doc2.getElementById("tree"));

/* Una fila de medición como la construye makeMeasureLi: la etiqueta
   muestra "nombre — medida", no el nombre a secas.                   */
function measureRow(name, measure) {
  const li = doc2.createElement("li");
  li._name = name;
  const row = doc2.createElement("div");
  row.className = "node-row";
  const chk = doc2.createElement("input");
  chk.type = "checkbox";
  const label = doc2.createElement("label");
  label.textContent = `${name} — ${measure}`;
  row.append(chk, label);
  li.appendChild(row);
  doc2.getElementById("tree").appendChild(li);
  /* onRename: lo que hace makeMeasureLi — repinta la etiqueta entera */
  li._onRename = v => { label.textContent = `${v} — ${measure}`; };
  return { li, label };
}

/* --- Nombre SIN cambiar: el caso que fallaba --- */
let { li, label } = measureRow("Línea 1", "1,20 km · 45,0°");
nameApi.startRename(li);
let input = li.querySelector("input.rename-input");
ok(!!input, "F2 sustituye la etiqueta por un campo de texto");
ok(input.value === "Línea 1", "que arranca con el NOMBRE, no con el texto medido: " + input.value);
input.dispatchEvent(new doc2.defaultView.Event("blur"));
ok(label.textContent === "Línea 1 — 1,20 km · 45,0°",
  "dejar el nombre igual conserva la medida: " + JSON.stringify(label.textContent));
ok(li.querySelector(":scope > .node-row > label") === label, "y la etiqueta vuelve a su sitio");

/* --- Nombre cambiado: _onRename repinta con el nombre nuevo --- */
({ li, label } = measureRow("Círculo 2", "500,0 m"));
nameApi.startRename(li);
input = li.querySelector("input.rename-input");
input.value = "Radio de acción";
input.dispatchEvent(new doc2.defaultView.Event("blur"));
ok(li._name === "Radio de acción", "el nombre del nodo cambia: " + li._name);
ok(label.textContent === "Radio de acción — 500,0 m",
  "y la fila lo muestra CON su medida: " + JSON.stringify(label.textContent));

/* --- Escape: mismo camino que el nombre sin cambiar --- */
({ li, label } = measureRow("Línea 3", "12,0 m"));
nameApi.startRename(li);
input = li.querySelector("input.rename-input");
input.value = "";  /* Escape restaura el valor y hace blur */
input.dispatchEvent(new doc2.defaultView.Event("blur"));
ok(label.textContent === "Línea 3 — 12,0 m",
  "cancelar tampoco borra la medida: " + JSON.stringify(label.textContent));

/* --- Y una fila normal (etiqueta = nombre) sigue renombrándose bien --- */
const plain = doc2.createElement("li");
plain._name = "Capa";
const prow = doc2.createElement("div");
prow.className = "node-row";
const pchk = doc2.createElement("input");
pchk.type = "checkbox";
const plabel = doc2.createElement("label");
plabel.textContent = "Capa";
prow.append(pchk, plabel);
plain.appendChild(prow);
doc2.getElementById("tree").appendChild(plain);
nameApi.startRename(plain);
input = plain.querySelector("input.rename-input");
input.value = "Capa nueva";
input.dispatchEvent(new doc2.defaultView.Event("blur"));
ok(plabel.textContent === "Capa nueva" && plabel.title === "Capa nueva",
  "una capa sin medida se renombra como siempre: " + plabel.textContent);
ok(pchk.getAttribute("aria-label") === "Activar o desactivar «Capa nueva»",
  "y la casilla mantiene su nombre accesible");

if (!process.exitCode) console.log("MEASURE TESTS OK");
