/* ================= Calculadora geodésica =================
   Ventana flotante con una pestaña por cálculo: ángulo de elevación
   (con cono de silencio y corrección por presión) y vector GPS. Añadir
   otra es una entrada más en `geocalcTabs` (con su función de cálculo),
   su botón y su panel en index.html. La lógica pura vive en
   51-geodesy.js; aquí solo hay interfaz.

   NO hay botón «Calcular»: cada pestaña se recalcula SOLA al cambiar
   cualquier dato (campo, unidad, tipo de distancia, modelo, formato), con
   el resultado a la vista al momento. Mientras falte algún dato, el
   resultado queda vacío y SIN aviso: un error por cada tecla pulsada a
   medio escribir sería ruido; el aviso solo sale cuando los datos están
   completos y no valen.

   Se registra aquí (makeDialogMovable/setupDialog) y no en la lista de
   44-dialogs.js: ese archivo carga antes y la caja aún no existiría.   */
const geocalcDialog = document.getElementById("geocalc-dialog");
const geocalcBox = geocalcDialog.querySelector(".dlg-box");
makeDialogMovable(geocalcBox);
setupDialog(geocalcBox, { modal: false }); /* flotante: el mapa sigue vivo */

const gcEl = id => document.getElementById(id);

/* ---------- Pestañas ----------
   Cada una trae su función de cálculo, que se ejecuta al cambiar un dato
   de SU panel, al mostrarla y al abrir la ventana. Cada panel lleva su
   propio resultado y aviso, así que cambiar de pestaña no arrastra el
   de otra.                                                              */
const geocalcTabs = {
  elev: { btn: gcEl("geocalc-tab-btn-elev"), panel: gcEl("geocalc-tab-elev"), calc: () => calcElevation() },
  gps:  { btn: gcEl("geocalc-tab-btn-gps"),  panel: gcEl("geocalc-tab-gps"),  calc: () => calcGps() }
};
let geocalcActiveTab = "elev";

/* Cada pestaña tiene una altura distinta. Sin arrastrar, la ventana está
   anclada abajo y crece hacia arriba sola; pero una vez arrastrada
   queda fijada POR ARRIBA (makeDialogMovable) y una pestaña más alta
   saca el pie de la pantalla. `clampToViewport` no sirve aquí: solo
   garantiza que el título sea alcanzable, no que quepa el cuadro. Se
   sube lo justo para que el borde inferior se vea.                     */
function fitGeocalcBottom() {
  if (!geocalcBox.style.top) return; /* nunca movida: el ancla ya lo resuelve */
  const r = geocalcBox.getBoundingClientRect();
  const top = Math.max(0, Math.min(r.top, window.innerHeight - r.height - 8));
  geocalcBox.style.top = `${top}px`;
}
function showGeocalcTab(tab) {
  geocalcActiveTab = tab;
  for (const [key, { btn, panel }] of Object.entries(geocalcTabs)) {
    const active = key === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
    panel.hidden = !active;
  }
  fitGeocalcBottom();
  geocalcTabs[tab].calc();
}
for (const [key, { btn, panel, calc }] of Object.entries(geocalcTabs)) {
  btn.addEventListener("click", () => showGeocalcTab(key));
  /* Teclear en un campo recalcula al momento. Los <select> NO por `input`:
     el navegador lo dispara ANTES de `change`, y la conversión de valor
     al cambiar de unidad (convertGeocalcField) va en `change`, así que
     calcular en `input` usaría el valor viejo con la unidad nueva.     */
  panel.addEventListener("input", e => { if (e.target.tagName !== "SELECT") calc(); });
  panel.addEventListener("change", e => { if (e.target.tagName === "SELECT") calc(); });
}

/* ---------- Unidades ----------
   Se copian de #props-unit en vez de repetir la lista: así son siempre
   las mismas y en el mismo orden que en Propiedades.                   */
const GEOCALC_UNIT_OPTIONS = propsUnitSelect.innerHTML;
function geocalcUnitSelect(id, unit) {
  const sel = gcEl(id);
  sel.innerHTML = GEOCALC_UNIT_OPTIONS;
  sel.value = unit;
  sel.dataset.prev = unit;
  return sel;
}

/* Cambiar la unidad de un campo CONVIERTE su valor, no lo reinterpreta:
   1000 ft pasados a metros pasan a ser 304,8, no «1000 m». La cantidad
   física es la misma. Cada selector recuerda su unidad anterior
   (`dataset.prev`) porque `change` solo trae la nueva. Se redondea a 12
   cifras significativas: las bastantes para que el ruido de coma
   flotante (~1e-16, p. ej. 304.79999999999995) desaparezca, y las
   bastantes para que ida y vuelta m → ft → m devuelva lo mismo (con 10,
   650 m daban «650.0000001» al volver: el valor intermedio ya había
   perdido precisión). Un campo vacío o ilegible se deja como está.     */
function convertGeocalcField(input, unitSel) {
  const from = unitSel.dataset.prev || unitSel.value;
  unitSel.dataset.prev = unitSel.value;
  if (from === unitSel.value || input.value.trim() === "") return;
  const v = Number(input.value);
  if (!Number.isFinite(v)) return;
  input.value = String(Number((v * POLY_UNIT_FACTOR[from] / POLY_UNIT_FACTOR[unitSel.value]).toPrecision(12)));
}
/* Campo numérico con su selector de unidad, ya enlazados. */
function geocalcUnitField(inputId, unitId, unit) {
  const input = gcEl(inputId), sel = geocalcUnitSelect(unitId, unit);
  sel.addEventListener("change", () => convertGeocalcField(input, sel));
  return { input, sel };
}

const geocalcEmpty = el => el.value.trim() === "";

/* Valor numérico del campo en metros; NaN si está vacío o no es número
   (un <input type=number> con texto inválido da value === "").        */
function geocalcMeters({ input, sel }) {
  if (geocalcEmpty(input)) return NaN;
  return Number(input.value) * POLY_UNIT_FACTOR[sel.value];
}

/* Aviso de un panel: lo muestra u oculta, y con aviso borra el resultado. */
function geocalcShowError(errId, resultId, msg) {
  const el = gcEl(errId);
  el.hidden = !msg;
  el.textContent = msg || "";
  if (msg) gcEl(resultId).textContent = "";
}
const geocalcMarkBad = (el, bad) => el.classList.toggle("bad", bad);
/* Datos incompletos: ni resultado ni aviso ni marcas rojas. */
function geocalcIdle(errId, resultId, inputs) {
  for (const el of inputs) el.classList.remove("bad");
  geocalcShowError(errId, resultId, null);
  gcEl(resultId).textContent = "";
}

/* ---------- Pestaña 1: ángulo de elevación y cono de silencio ---------- */
const gcH1 = geocalcUnitField("geocalc-h1", "geocalc-h1-unit", "m");
const gcH2 = geocalcUnitField("geocalc-h2", "geocalc-h2-unit", "m");
const gcD = geocalcUnitField("geocalc-d", "geocalc-d-unit", "nm");
/* Presión al nivel del mar (QNH), en hPa (= mbar): parte en la estándar. */
const gcP = gcEl("geocalc-p");
gcP.value = ISA_P0_HPA;
let geocalcUnitsSeeded = false;

/* Primera apertura: la distancia en la unidad global y las alturas en
   pies si la unidad global es de uso aeronáutico/marino, en metros si
   no. Después manda el usuario y no se vuelve a tocar (ni se persiste).
   Solo esta pestaña: el vector GPS tiene unidades de partida FIJAS.    */
function seedGeocalcUnits() {
  if (geocalcUnitsSeeded) return;
  geocalcUnitsSeeded = true;
  gcD.sel.value = measureUnit;
  const heightUnit = ["ft", "mi", "nm"].includes(measureUnit) ? "ft" : "m";
  gcH1.sel.value = gcH2.sel.value = heightUnit;
  for (const f of [gcH1, gcH2, gcD]) f.sel.dataset.prev = f.sel.value;
}

/* La distancia puede ser la de superficie (arco a nivel del mar) o la
   OBLICUA entre los dos puntos a sus alturas (`kind`, ver
   `surfaceFromSlant`); parte como oblicua, el alcance en línea recta que
   da un radar y con el que trabajan las demás herramientas (tomar esa
   cifra como arco sobre el suelo daba otra elevación: 24,21 m, 45000 ft
   y 12,2 NM, 31° en vez de 37°). Cambiar de tipo NO convierte el valor
   escrito: no es una unidad, es otra magnitud.
   La presión corrige SOLO la altura de destino, que se toma como
   altitud de altímetro (reglaje estándar), como la de una aeronave; la
   de origen se usa tal cual (una cota de antena es geométrica y no
   depende de la presión). Ver `trueAltitudeM`.                         */
function calcElevation() {
  const inputs = [gcH1.input, gcH2.input, gcD.input, gcP];
  if (inputs.some(geocalcEmpty)) { geocalcIdle("geocalc-error", "geocalc-elev-result", inputs); return; }
  const h1 = geocalcMeters(gcH1), h2 = geocalcMeters(gcH2), d = geocalcMeters(gcD), q = Number(gcP.value);
  const model = gcEl("geocalc-model").value, kind = gcEl("geocalc-dkind").value;
  const pErr = Number.isFinite(h2) ? pressureInputError(h2, q) : null;
  /* El error de presión señala el campo que de verdad lo causa: la presión
     si está fuera de rango, la altura de destino si es ella la que no
     admite corrección.                                                  */
  const qBad = !Number.isFinite(q) || q < QNH_MIN_HPA || q > QNH_MAX_HPA;
  geocalcMarkBad(gcH1.input, !Number.isFinite(h1));
  geocalcMarkBad(gcH2.input, !Number.isFinite(h2) || (!!pErr && !qBad));
  geocalcMarkBad(gcD.input, !Number.isFinite(d) || d < 0);
  geocalcMarkBad(gcP, !!pErr && qBad);
  const h2c = pErr ? NaN : trueAltitudeM(h2, q);
  const err = pErr || elevationInputError(h1, h2c, d, model, kind);
  geocalcShowError("geocalc-error", "geocalc-elev-result", err);
  if (err) return;
  const deg = elevationAngleDeg(h1, h2c, d, model, kind);
  let text = `Ángulo de elevación: ${deg.toFixed(3)}°\nCono de silencio: ${silenceConeDeg(deg).toFixed(3)}°`;
  if (q !== ISA_P0_HPA) {
    const u = gcH2.sel.value, delta = h2c - h2;
    text += `\nAltura de destino corregida: ${fmtUnitDist(h2c, u)} (${delta >= 0 ? "+" : ""}${fmtUnitDist(delta, u)})`;
  }
  gcEl("geocalc-elev-result").textContent = text;
}

/* ---------- Pestaña 2: vector GPS ----------
   Dos puntos (latitud, longitud, altitud). Altitudes en metros por
   defecto (lo que da un GPS) y distancia del resultado en millas
   náuticas (las demás unidades se eligen en el desplegable).
   Latitud y longitud se leen con `parseCoord`, que acepta decimal y GMS
   indistintamente, así que pegar una coordenada funciona sea cual sea el
   formato mostrado. El formato de ESTA pestaña (`gps-coord-format`) es
   propio, no el global de Propiedades: parte en GMS, con Madrid en A y
   Barcelona en B para que haya un resultado desde el primer momento, y
   al cambiarlo CONVIERTE lo escrito (como las unidades).                */
const gcGpsLat1 = gcEl("gps-lat1"), gcGpsLng1 = gcEl("gps-lng1");
const gcGpsLat2 = gcEl("gps-lat2"), gcGpsLng2 = gcEl("gps-lng2");
const gcGpsAlt1 = geocalcUnitField("gps-alt1", "gps-alt1-unit", "m");
const gcGpsAlt2 = geocalcUnitField("gps-alt2", "gps-alt2-unit", "m");
const gcGpsDUnit = geocalcUnitSelect("gps-d-unit", "nm");
const gcGpsFormat = gcEl("gps-coord-format");
gcGpsFormat.innerHTML = propsCoordFormatSelect.innerHTML; /* mismas opciones y rótulos que Propiedades */
gcGpsFormat.value = "dms";
const gcGpsCoordFields = [[gcGpsLat1, true], [gcGpsLng1, false], [gcGpsLat2, true], [gcGpsLng2, false]];

/* Valores de partida (grados decimales y metros), escritos en el formato
   que esté elegido.                                                    */
const GEOCALC_GPS_START = {
  a: { lat: 40.4168, lng: -3.7038, alt: 650 }, /* Madrid */
  b: { lat: 41.3874, lng: 2.1686, alt: 12 }    /* Barcelona */
};
function fillGpsStart() {
  const { a, b } = GEOCALC_GPS_START, mode = gcGpsFormat.value;
  gcGpsLat1.value = formatCoord(a.lat, true, mode);
  gcGpsLng1.value = formatCoord(a.lng, false, mode);
  gcGpsAlt1.input.value = a.alt;
  gcGpsLat2.value = formatCoord(b.lat, true, mode);
  gcGpsLng2.value = formatCoord(b.lng, false, mode);
  gcGpsAlt2.input.value = b.alt;
}
fillGpsStart();

/* Cambiar el formato reescribe cada coordenada en el nuevo, sin cambiar
   el punto. Lo que no se pueda leer (vacío, a medio escribir, fuera de
   rango) se deja tal cual: no se inventa un valor ni se pierde lo
   escrito, y el cálculo lo marcará.                                    */
gcGpsFormat.addEventListener("change", () => {
  for (const [input, isLat] of gcGpsCoordFields) {
    const v = parseCoord(input.value, isLat);
    if (Number.isFinite(v)) input.value = formatCoord(v, isLat, gcGpsFormat.value);
  }
});

function calcGps() {
  const inputs = [gcGpsLat1, gcGpsLng1, gcGpsAlt1.input, gcGpsLat2, gcGpsLng2, gcGpsAlt2.input];
  if (inputs.some(geocalcEmpty)) { geocalcIdle("gps-error", "gps-result", inputs); return; }
  const a = { lat: parseCoord(gcGpsLat1.value, true), lng: parseCoord(gcGpsLng1.value, false), alt: geocalcMeters(gcGpsAlt1) };
  const b = { lat: parseCoord(gcGpsLat2.value, true), lng: parseCoord(gcGpsLng2.value, false), alt: geocalcMeters(gcGpsAlt2) };
  geocalcMarkBad(gcGpsLat1, !Number.isFinite(a.lat));
  geocalcMarkBad(gcGpsLng1, !Number.isFinite(a.lng));
  geocalcMarkBad(gcGpsAlt1.input, !Number.isFinite(a.alt));
  geocalcMarkBad(gcGpsLat2, !Number.isFinite(b.lat));
  geocalcMarkBad(gcGpsLng2, !Number.isFinite(b.lng));
  geocalcMarkBad(gcGpsAlt2.input, !Number.isFinite(b.alt));
  const err = gpsVectorError(a, b);
  geocalcShowError("gps-error", "gps-result", err);
  if (err) return;
  const v = gpsVector(a, b), u = gcGpsDUnit.value;
  const dist = m => `${(m / POLY_UNIT_FACTOR[u]).toFixed(3)} ${POLY_UNIT_LABEL[u]}`; /* 3 decimales: a 1 cm de precisión en NM */
  gcEl("gps-result").textContent =
    `Distancia: ${dist(v.slant)}\nDistancia horizontal: ${dist(v.horizontal)}\n` +
    (v.bearing === null ? "Orientación: no definida (mismas latitud y longitud)"
      : `Orientación: ${v.bearing.toFixed(3)}°`);
}

/* ---------- Abrir y cerrar ---------- */
function toggleGeocalcDialog() {
  geocalcDialog.hidden = !geocalcDialog.hidden;
  if (geocalcDialog.hidden) { releaseFocus(); return; }
  seedGeocalcUnits();
  clampToViewport(geocalcBox);
  fitGeocalcBottom();
  focusDialog(geocalcBox);
  geocalcTabs[geocalcActiveTab].calc(); /* el vector GPS ya trae datos de partida */
}
gcEl("geocalc-btn").addEventListener("click", toggleGeocalcDialog);
gcEl("geocalc-close").addEventListener("click", toggleGeocalcDialog);
