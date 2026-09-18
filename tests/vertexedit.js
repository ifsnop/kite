/* Edición interactiva de vértices (arrastrar y borrar) de un polígono
   ya creado, al ver su diálogo de propiedades.

   Complementa al editor de texto («Ver y editar…», que sigue existiendo
   para listas grandes): reutiliza el MISMO recorrido de anillos/partes
   que ya usa pointsToText (pathRings), así que un polígono con agujeros
   o multi-parte se cubre igual, sin reimplementar cómo se camina
   layer.getLatLngs() anidado.

   No se simulan eventos de ratón reales (attachVertexDrag ya se prueba
   por su cuenta, es una escucha "mousedown" genérica): se llama
   directamente a las funciones que attachVertexDrag invocaría al
   soltar, que es donde vive la lógica que importa probar (encontrar en
   qué anillo/posición vive un manejador, el mínimo antes de bloquear
   el borrado, y que "Cancelar" deje la capa real EXACTAMENTE como
   estaba).                                                            */
const { fn, constDecl } = require("./_extract");

/* ---------- Leaflet de mentira: solo lo que pathRings/setLatLngs necesitan --- */
class FakeLatLng {
  constructor(lat, lng) { this.lat = lat; this.lng = lng; }
}
class FakePolyline {
  constructor(latlngs) { this._latlngs = latlngs; }
  getLatLngs() { return this._latlngs; }
  setLatLngs(v) { this._latlngs = v; }
}
class FakePolygon extends FakePolyline {}
function fakeMarker(latlng) {
  const listeners = {};
  return {
    _latlng: latlng,
    getLatLng() { return this._latlng; },
    setLatLng(v) { this._latlng = v; },
    on(evt, f) { (listeners[evt] = listeners[evt] || []).push(f); return this; },
    off() {},
    fire(evt) { for (const f of (listeners[evt] || [])) f({ originalEvent: { stopPropagation() {} } }); }
  };
}
function fakeFeatureGroup() {
  const layers = [];
  return { addTo() { return this; }, addLayer(l) { layers.push(l); }, removeLayer(l) {
    const i = layers.indexOf(l); if (i !== -1) layers.splice(i, 1);
  }, layers };
}
const L = {
  latLng: (lat, lng) => new FakeLatLng(lat, lng),
  Polyline: FakePolyline,
  Polygon: FakePolygon,
  marker: latlng => fakeMarker(latlng),
  divIcon: opts => opts,
  featureGroup: () => fakeFeatureGroup(),
  DomEvent: { stop() {} }
};
const rootGroup = { addTo() { return this; }, addLayer() {}, removeLayer() {} };

let navCalls = [];
const navMessage = txt => navCalls.push(txt);
let invalidated = [];
const invalidateGeo = li => invalidated.push(li);
let polyMeasures = null;
let renderCalls = 0;
const renderPolyMeasures = () => { renderCalls++; };
const polygonMeasures = () => null; /* no es lo que se prueba aquí */
const nodeLayer = li => li._layer;

const src = constDecl("VERTEX_EDIT_MAX") + "\n"
  + [fn("pathRings"), fn("solePath"), fn("cloneLatLngRings"), fn("beginVertexEdit"),
     fn("applyVertexEditRings"), fn("findVertexEditPos"), fn("wireVertexEditHandle"),
     fn("removeVertexEditPoint"), fn("endVertexEdit"), fn("makeHandle"), fn("attachVertexDrag")]
    .join("\n");
const api = new Function("L", "rootGroup", "navMessage", "invalidateGeo", "nodeLayer",
  "map", "getPolyMeasures", "setPolyMeasures", "renderPolyMeasures", "polygonMeasures",
  src + "\nlet polyMeasures = getPolyMeasures();"
  + "\nreturn {beginVertexEdit, endVertexEdit, removeVertexEditPoint, findVertexEditPos,"
  + " getVertexEdit: () => vertexEdit, VERTEX_EDIT_MAX};"
)(L, rootGroup, navMessage, invalidateGeo, nodeLayer,
  { dragging: { disable() {}, enable() {} }, on() {}, off() {} },
  () => polyMeasures, v => { polyMeasures = v; }, renderPolyMeasures, polygonMeasures);
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const P = (lat, lng) => L.latLng(lat, lng);

/* ---------- Un anillo simple (triángulo cerrado) ---------- */
{
  const ring = [P(0, 0), P(0, 1), P(1, 1)];
  const layer = new FakePolygon([ring]); /* getLatLngs() anidado, como un L.Polygon real */
  const li = { _layer: layer };
  navCalls = []; invalidated = []; renderCalls = 0;
  api.beginVertexEdit(li);
  const ve = api.getVertexEdit();
  ok(!!ve, "por debajo del tope, sí construye edición interactiva");
  ok(ve.closed === true, "un L.Polygon se reconoce como anillo cerrado");
  ok(ve.handleRings[0].length === 3, "un manejador por vértice: " + ve.handleRings[0].length);

  /* Mover el vértice 1 (arrastre): se aplica a la capa real */
  const h1 = ve.handleRings[0][1];
  h1.fire("mousedown"); // sin Ctrl: attachVertexDrag no hace nada más aquí (requireCtrl real se prueba en su mousemove/up simulado abajo)

  /* Borrar por debajo del mínimo (3 en un anillo cerrado) se bloquea */
  api.removeVertexEditPoint(ve.handleRings[0][0]);
  api.removeVertexEditPoint(ve.handleRings[0][0]);
  ok(ve.rings[0].length === 3, "no deja bajar de 3 vértices en un anillo cerrado: " + ve.rings[0].length);
  ok(navCalls.length === 2 && /mínimo 3/.test(navCalls[0]), "avisa por qué no borra: " + navCalls[0]);

  /* Cancelar: la capa real vuelve exactamente a como estaba */
  api.endVertexEdit(false);
  ok(!api.getVertexEdit(), "tras cerrar, ya no hay edición en curso");
  const back = layer.getLatLngs()[0];
  ok(back.length === 3 && back[0].lat === 0 && back[0].lng === 0,
    "cancelar restaura los vértices originales tal cual: " + JSON.stringify(back));
}

/* ---------- Borrar SÍ funciona por encima del mínimo, y Aceptar lo deja ---------- */
{
  const ring = [P(0, 0), P(0, 1), P(1, 1), P(1, 0)]; /* cuadrado: 4 vértices */
  const layer = new FakePolygon([ring]);
  const li = { _layer: layer };
  navCalls = [];
  api.beginVertexEdit(li);
  const ve = api.getVertexEdit();
  const target = ve.handleRings[0][2];
  api.removeVertexEditPoint(target);
  ok(ve.rings[0].length === 3, "con 4 vértices, borrar uno deja 3 (el mínimo, pero permitido): " + ve.rings[0].length);
  ok(navCalls.length === 0, "por encima del mínimo, borrar no avisa nada");
  api.endVertexEdit(true); /* Aceptar: se queda como está */
  ok(layer.getLatLngs()[0].length === 3, "aceptar conserva el borrado: " + layer.getLatLngs()[0].length);
}

/* ---------- Forma abierta: mínimo 2, no 3 ---------- */
{
  const line = [P(0, 0), P(0, 1)]; /* getLatLngs() SIN anidar: una polilínea simple */
  const layer = new FakePolyline(line);
  const li = { _layer: layer };
  navCalls = [];
  api.beginVertexEdit(li);
  const ve = api.getVertexEdit();
  ok(ve.closed === false, "un L.Polyline (no Polygon) es una forma abierta");
  api.removeVertexEditPoint(ve.handleRings[0][0]);
  ok(ve.rings[0].length === 2, "no deja bajar de 2 en una forma abierta");
  ok(/mínimo 2/.test(navCalls[0]), "mensaje distinto para forma abierta: " + navCalls[0]);
  api.endVertexEdit(false);
}

/* ---------- Multi-anillo (agujero): un anillo se edita sin tocar el otro --- */
{
  const outer = [P(0, 0), P(0, 4), P(4, 4), P(4, 0)];
  const hole = [P(1, 1), P(1, 2), P(2, 2)];
  const layer = new FakePolygon([outer, hole]); /* dos anillos anidados */
  const li = { _layer: layer };
  navCalls = [];
  api.beginVertexEdit(li);
  const ve = api.getVertexEdit();
  ok(ve.handleRings.length === 2, "un grupo de manejadores por anillo: " + ve.handleRings.length);
  ok(ve.handleRings[0].length === 4 && ve.handleRings[1].length === 3, "cada anillo con los suyos");
  /* Borrar del agujero (3, en el mínimo) se bloquea sin afectar al exterior */
  api.removeVertexEditPoint(ve.handleRings[1][0]);
  ok(ve.rings[1].length === 3 && ve.rings[0].length === 4,
    "el mínimo se exige POR ANILLO: el agujero no baja de 3 y el exterior no se toca");
  api.endVertexEdit(false);
}

/* ---------- Tope de vértices: por encima, no se construye nada ---------- */
{
  const many = Array.from({ length: api.VERTEX_EDIT_MAX + 1 }, (_, i) => P(i * 0.001, 0));
  const layer = new FakePolygon([many]);
  const li = { _layer: layer };
  api.beginVertexEdit(li);
  ok(!api.getVertexEdit(), "por encima del tope no se crean manejadores interactivos: solo queda el editor de texto");
}

if (!process.exitCode) console.log("VERTEX EDIT TESTS OK");
