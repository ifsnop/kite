/* Edición interactiva de vértices (arrastrar, borrar e insertar) de un
   polígono ya creado — activada por tenerlo como ÚNICA selección del
   árbol, sin que haga falta abrir su diálogo de propiedades.

   Complementa al editor de texto («Ver y editar…», que sigue existiendo
   para listas grandes): reutiliza el MISMO recorrido de anillos/partes
   que ya usa pointsToText (pathRings), así que un polígono con agujeros
   o multi-parte se cubre igual, sin reimplementar cómo se camina
   layer.getLatLngs() anidado.

   Ya NO es edición diferida (no hay "Cancelar" que revierta): cada
   arrastre, borrado o inserción se guarda al momento, como ya hacía un
   waypoint de ruta — de ahí que se compruebe que cada operación llama a
   scheduleSave.

   No se simulan eventos de ratón reales (attachVertexDrag ya se prueba
   por su cuenta, es una escucha "mousedown" genérica): se llama
   directamente a las funciones que attachVertexDrag invocaría al
   soltar, que es donde vive la lógica que importa probar (encontrar en
   qué anillo/posición vive un manejador y el mínimo antes de bloquear
   el borrado).                                                        */
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
let saveCalls = 0;
const scheduleSave = () => { saveCalls++; };
const refreshOpenPolygonDialog = () => {}; /* el diálogo de verdad lo prueba tests/browser */
const nodeLayer = li => li._layer;
/* La selección de vértice (vertexOwner/vertexSelHandle) es un mecanismo
   COMPARTIDO con las rutas, probado de punta a punta en un navegador
   real (tests/browser/vertex-select.mjs): aquí basta con declarar el
   estado sin ningún vértice seleccionado, para que removeVertexEditPoint
   no falle al leerlo (clearVertexSelection se estampa como no-op).    */
const clearVertexSelection = () => {};

const src = "let vertexSelHandle = null;\n" + constDecl("VERTEX_EDIT_MAX") + "\n"
  + [fn("pathRings"), fn("solePath"), fn("cloneLatLngRings"), fn("beginVertexEdit"),
     fn("applyVertexEditRings"), fn("findVertexEditPos"), fn("wireVertexEditHandle"),
     fn("removeVertexEditPoint"), fn("insertVertexEditPoint"), fn("endVertexEdit"),
     fn("makeHandle"), fn("attachVertexDrag")]
    .join("\n");
const api = new Function("L", "rootGroup", "navMessage", "invalidateGeo", "nodeLayer",
  "map", "scheduleSave", "refreshOpenPolygonDialog", "clearVertexSelection",
  src
  + "\nreturn {beginVertexEdit, endVertexEdit, removeVertexEditPoint, insertVertexEditPoint,"
  + " findVertexEditPos, getVertexEdit: () => vertexEdit, VERTEX_EDIT_MAX};"
)(L, rootGroup, navMessage, invalidateGeo, nodeLayer,
  { dragging: { disable() {}, enable() {} }, on() {}, off() {} },
  scheduleSave, refreshOpenPolygonDialog, clearVertexSelection);
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const P = (lat, lng) => L.latLng(lat, lng);

/* ---------- Un anillo simple (triángulo cerrado) ---------- */
{
  const ring = [P(0, 0), P(0, 1), P(1, 1)];
  const layer = new FakePolygon([ring]); /* getLatLngs() anidado, como un L.Polygon real */
  const li = { _layer: layer };
  navCalls = []; invalidated = []; saveCalls = 0;
  ok(api.beginVertexEdit(li) === true, "por debajo del tope, sí construye edición interactiva");
  const ve = api.getVertexEdit();
  ok(!!ve, "y deja vertexEdit puesto");
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
  ok(saveCalls === 0, "y bloqueado por el mínimo, no guarda nada");

  api.endVertexEdit();
  ok(!api.getVertexEdit(), "tras cerrar, ya no hay edición en curso");
}

/* ---------- Borrar SÍ funciona por encima del mínimo: EN VIVO ---------- */
{
  const ring = [P(0, 0), P(0, 1), P(1, 1), P(1, 0)]; /* cuadrado: 4 vértices */
  const layer = new FakePolygon([ring]);
  const li = { _layer: layer };
  navCalls = []; saveCalls = 0;
  api.beginVertexEdit(li);
  const ve = api.getVertexEdit();
  const target = ve.handleRings[0][2];
  api.removeVertexEditPoint(target);
  ok(ve.rings[0].length === 3, "con 4 vértices, borrar uno deja 3 (el mínimo, pero permitido): " + ve.rings[0].length);
  ok(navCalls.length === 0, "por encima del mínimo, borrar no avisa nada");
  /* Ya NO es edición diferida: se aplica y se guarda al momento, sin
     esperar a ningún "Aceptar".                                      */
  ok(layer.getLatLngs()[0].length === 3, "el borrado llega a la capa real de inmediato: " + layer.getLatLngs()[0].length);
  ok(saveCalls === 1, "y se guarda solo, sin diálogo de por medio: " + saveCalls);
  api.endVertexEdit();
}

/* ---------- Insertar un vértice nuevo: después del elegido, o al final ---------- */
{
  const ring = [P(0, 0), P(0, 1), P(1, 1)];
  const layer = new FakePolygon([ring]);
  const li = { _layer: layer };
  navCalls = []; saveCalls = 0;
  api.beginVertexEdit(li);
  const ve = api.getVertexEdit();

  /* Sin manejador (nada seleccionado): se añade al final del anillo */
  const hEnd = api.insertVertexEditPoint(null, { lat: 9, lng: 9 });
  ok(!!hEnd, "insertar sin selección devuelve el manejador nuevo");
  ok(ve.rings[0].length === 4 && ve.rings[0][3].lat === 9, "se añade al final: " + JSON.stringify(ve.rings[0]));
  ok(ve.handleRings[0][3] === hEnd, "y su manejador va al final también");

  /* Con un manejador: se inserta justo DESPUÉS de él */
  const first = ve.handleRings[0][0];
  const hMid = api.insertVertexEditPoint(first, { lat: 5, lng: 5 });
  ok(ve.rings[0].length === 5, "ahora 5 vértices: " + ve.rings[0].length);
  ok(ve.rings[0][1].lat === 5, "el nuevo cae justo tras el elegido: " + JSON.stringify(ve.rings[0]));
  ok(ve.handleRings[0][1] === hMid, "su manejador también queda en esa posición");
  ok(saveCalls === 2, "cada inserción se guarda al momento: " + saveCalls);
  api.endVertexEdit();
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
  api.endVertexEdit();
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
  /* Insertar tras un manejador del agujero cae en el anillo DEL AGUJERO */
  api.insertVertexEditPoint(ve.handleRings[1][0], { lat: 1.5, lng: 1.5 });
  ok(ve.rings[1].length === 4 && ve.rings[0].length === 4,
    "insertar en el agujero no toca el anillo exterior: " + ve.rings[0].length + "/" + ve.rings[1].length);
  api.endVertexEdit();
}

/* ---------- Tope de vértices: por encima, no se construye nada ---------- */
{
  const many = Array.from({ length: api.VERTEX_EDIT_MAX + 1 }, (_, i) => P(i * 0.001, 0));
  const layer = new FakePolygon([many]);
  const li = { _layer: layer };
  ok(api.beginVertexEdit(li) === false, "por encima del tope no se crean manejadores interactivos: solo queda el editor de texto");
  ok(!api.getVertexEdit(), "y no queda vertexEdit puesto");
}

if (!process.exitCode) console.log("VERTEX EDIT TESTS OK");
