/* Edición interactiva de vértices (arrastrar, borrar e insertar) de un
   polígono ya creado — activada por tener su diálogo de propiedades
   abierto (y solo mientras lo esté: ver la integración completa,
   incluida la puerta `styleDialogShows`, en
   tests/browser/vertex-select.mjs). Este archivo prueba las
   funciones de bajo nivel (beginVertexEdit/removeVertexEditPoint/
   insertVertexEditPoint/etc.) tal cual, ajenas a QUIÉN las llama.

   Complementa al editor de texto («Ver y editar…», que sigue existiendo
   para listas grandes): reutiliza el MISMO recorrido de anillos/partes
   que ya usa pointsToText (pathRings), así que un polígono con agujeros
   o multi-parte se cubre igual, sin reimplementar cómo se camina
   layer.getLatLngs() anidado.

   Cada arrastre, borrado o inserción se guarda al momento, como ya
   hacía un waypoint de ruta — de ahí que se compruebe que cada
   operación llama a scheduleSave; "Cancelar" el diálogo SÍ revierte
   todo esto ahora (captureVertexSnapshot/restoreVertexSnapshot), pero
   eso se prueba en tests/browser/vertex-select.mjs, que es donde vive
   el diálogo de verdad.

   `convertVertexEditShape` (cerrar/abrir un anillo simple durante la
   edición, cambiando entre L.Polygon y L.Polyline) se sustituye aquí
   por un doble mínimo, sin tocar el mapa ni el DOM: el real
   (43-points-editor.js) reconstruye la capa con `setPathLayerClosed` y
   la re-cablea con `wireLayerEvents` (31-tree-node.js), que exigirían
   simular bastante más DOM del que este arnés necesita para el resto.
   Ese camino completo, y el gesto de cerrar (Mayús+clic sobre el primer
   vértice), se prueban de punta a punta en tests/browser/vertex-select.mjs.

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
  /* on/off hacen falta desde que mover un vértice ya no exige Ctrl: el
     mousedown de prueba llega hasta el final de attachVertexDrag (antes
     se paraba en el chequeo de Ctrl) y registra un mouseup en
     `document`.                                                       */
  DomEvent: { stop() {}, on() {}, off() {} }
};
const fakeDocument = { addEventListener() {}, removeEventListener() {} };
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
/* Sustituto mínimo de convertVertexEditShape (ver cabecera): cambia la
   capa fake de clase y el flag `closed`, sin DOM. Se pasa como
   parámetro más al `new Function(...)` de abajo, igual que
   `navMessage`/`scheduleSave`. Para LEER/ESCRIBIR `vertexEdit` desde
   aquí fuera hace falta un detalle: `beginVertexEdit` lo asigna sin
   `let` (`vertexEdit = {...}`), así que en el modo no estricto de
   `new Function` es un global implícito de `globalThis` — la misma
   variable que ya lee `getVertexEdit: () => vertexEdit` en el `return`
   de esa función, y que esta función, aunque está fuera de ese
   `new Function`, ve igual por ser el mismo `globalThis`.              */
function convertVertexEditShape(closed) {
  vertexEdit.layer = closed ? new FakePolygon(vertexEdit.rings[0]) : new FakePolyline(vertexEdit.rings[0]);
  vertexEdit.closed = closed;
}

/* VERTEX_EDIT_MAX_DEFAULT es solo el punto de partida: el tope real
   (vertexEditMax) es una preferencia editable, guardada en IndexedDB
   (dbSaveVertexEditMax/dbLoadVertexEditMax, 32-geojson.js) y ajustable
   desde el editor 🏷️ — depende del hardware de quien lo usa, así que
   no puede ser una constante fija. Se declara aquí con el mismo `let`
   que el archivo real, y se expone un setter para probar los dos
   sentidos del cambio.                                                */
const src = "let vertexSelHandle = null;\nlet activeTool = null;\n" + constDecl("VERTEX_EDIT_MAX_DEFAULT")
  + "\nlet vertexEditMax = VERTEX_EDIT_MAX_DEFAULT;\n" + constDecl("MEASURE_DOT_HTML")
  + [fn("pathRings"), fn("solePath"), fn("cloneLatLngRings"), fn("beginVertexEdit"),
     fn("applyVertexEditRings"), fn("findVertexEditPos"), fn("wireVertexEditHandle"),
     fn("removeVertexEditPoint"), fn("insertVertexEditPoint"), fn("endVertexEdit"),
     fn("makeHandle"), fn("attachVertexDrag")]
    .join("\n");
const api = new Function("L", "rootGroup", "navMessage", "invalidateGeo", "nodeLayer",
  "map", "document", "scheduleSave", "refreshOpenPolygonDialog", "clearVertexSelection", "convertVertexEditShape",
  src
  + "\nreturn {beginVertexEdit, endVertexEdit, removeVertexEditPoint, insertVertexEditPoint,"
  + " findVertexEditPos, getVertexEdit: () => vertexEdit, VERTEX_EDIT_MAX_DEFAULT,"
  + " setVertexEditMax: v => { vertexEditMax = v; }};"
)(L, rootGroup, navMessage, invalidateGeo, nodeLayer,
  { dragging: { disable() {}, enable() {} }, on() {}, off() {} },
  fakeDocument,
  scheduleSave, refreshOpenPolygonDialog, clearVertexSelection, convertVertexEditShape);
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

  /* Mover un vértice ya NO exige Ctrl (wireVertexEditHandle pasa
     requireCtrl=false a attachVertexDrag): un mousedown cualquiera
     arranca el gesto sin lanzar nada, aquí solo se comprueba que no
     revienta (el mecanismo de mousemove/mouseup en sí, con eventos de
     ratón de verdad, se prueba en tests/browser/vertex-select.mjs).   */
  const h1 = ve.handleRings[0][1];
  h1.fire("mousedown");

  /* Borrar por debajo del mínimo (3) en un anillo cerrado ya NO bloquea:
     ABRE el polígono (pasa a línea, mínimo 2) y el borrado sigue.      */
  api.removeVertexEditPoint(ve.handleRings[0][0]);
  ok(ve.closed === false, "bajar de 3 en un anillo cerrado lo abre en vez de bloquear el borrado");
  ok(ve.rings[0].length === 2, "y el borrado se completa: " + ve.rings[0].length);
  ok(navCalls.length === 1 && /se ha abierto/.test(navCalls[0]), "avisa del cambio: " + navCalls[0]);
  ok(saveCalls === 1, "y guarda, porque el borrado sí llegó a completarse: " + saveCalls);

  /* Ya es una forma abierta: el mínimo pasa a ser 2, y ESE sí bloquea */
  navCalls = [];
  api.removeVertexEditPoint(ve.handleRings[0][0]);
  ok(ve.rings[0].length === 2, "en el mínimo de una forma abierta, no baja más: " + ve.rings[0].length);
  ok(navCalls.length === 1 && /mínimo 2/.test(navCalls[0]), "mensaje de forma abierta esta vez: " + navCalls[0]);

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

/* ---------- Tope de vértices: por encima, no se construye nada, y avisa
   dónde subirlo ---------- */
{
  const many = Array.from({ length: api.VERTEX_EDIT_MAX_DEFAULT + 1 }, (_, i) => P(i * 0.001, 0));
  const layer = new FakePolygon([many]);
  const li = { _layer: layer, _name: "Muchos vértices" };
  navCalls = [];
  ok(api.beginVertexEdit(li) === false, "por encima del tope no se crean manejadores interactivos: solo queda el editor de texto");
  ok(!api.getVertexEdit(), "y no queda vertexEdit puesto");
  ok(navCalls.length === 1, "y esta vez SÍ avisa (a diferencia de \"sin trazo propio\", que no avisa nada)");
  ok(navCalls[0].includes(li._name), "nombrando la capa: " + navCalls[0]);
  ok(navCalls[0].includes(String(many.length)), "cuántos vértices tiene: " + navCalls[0]);
  ok(navCalls[0].includes(`(${api.VERTEX_EDIT_MAX_DEFAULT})`), "y el tope configurado: " + navCalls[0]);
  ok(/🏷️/.test(navCalls[0]), "con dónde se puede subir: " + navCalls[0]);
}

/* ---------- El tope es CONFIGURABLE, no una constante fija ---------- */
{
  const ring = [P(0, 0), P(0, 1), P(1, 1), P(1, 0), P(2, 2)]; /* 5 vértices */
  const layer = new FakePolygon([ring]);
  const li = { _layer: layer, _name: "Cinco vértices" };

  api.setVertexEditMax(3);
  navCalls = [];
  ok(api.beginVertexEdit(li) === false, "con el tope bajado a 3, un trazo de 5 vértices ya no cabe");
  ok(navCalls.length === 1 && /\(3\)/.test(navCalls[0]),
    "y el aviso cita el tope YA VIGENTE, no el de partida (500): " + navCalls[0]);

  api.setVertexEditMax(10);
  ok(api.beginVertexEdit(li) === true, "subiéndolo por encima de sus vértices, la edición se activa");
  api.endVertexEdit();

  api.setVertexEditMax(api.VERTEX_EDIT_MAX_DEFAULT); /* no contaminar otros bloques */
}

if (!process.exitCode) console.log("VERTEX EDIT TESTS OK");
