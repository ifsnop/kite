/* ================= Índice de oyentes de Leaflet =================
   Cada capa que Leaflet añade al mapa registra sus propios oyentes en
   él (`map.on(layer.getEvents(), layer)`: un marcador, `zoom` y
   `viewreset`; un tooltip permanente, lo mismo; con animación de zoom,
   además `zoomanim`). Y `Evented._on` empieza comprobando que el par
   (función, contexto) no esté ya registrado RECORRIENDO la lista
   entera de ese evento. Con N marcadores la lista tiene N entradas, así
   que añadir el N-ésimo cuesta N y añadirlos todos, N².

   Medido (Chromium headless, sin GPU): importar 10 000 marcadores tardó
   1,8 s y 579 ms de ellos eran esa comprobación (`_on` ← `_layerAdd`);
   añadir un grupo al mapa: 161 ms con 2 500, 478 con 5 000, 1 082 con
   10 000 y 3 883 con 20 000 (al doblar el número, de 2,3 a 3,6 veces
   más tiempo, no 2).

   El arreglo no cambia lo que Leaflet hace, solo cómo lo averigua: a
   las listas largas (INDEX_MIN o más) se les lleva al lado un índice
   `Map(función → Set(contexto))` que responde «no está» sin recorrer
   nada. Solo se acelera ese «no está», que es lo que ocurre al añadir;
   un «sí está» (quitar un oyente, o un duplicado) sigue por la
   búsqueda original, que además da la POSICIÓN que `_off` necesita.

   Mantener el índice exige envolver también `_off`: al quitar un
   oyente lo saca del índice, y si Leaflet sustituye la lista por una
   copia (lo hace mientras se dispara el evento, para no alterar el
   recorrido en curso) el índice se traslada a la copia. Un índice que
   dijera «no está» de algo que sí está dejaría registrar un oyente
   DOS veces, y un marcador se movería dos veces por zoom: por eso el
   índice se construye entero de la lista real, nunca incrementalmente
   desde cero, y se descarta al desactivar el parche.

   Va ANTES de crear el mapa (10-map.js), como 08-map-rotation.js.     */

const LEAFLET_EVENTS_ORIGINAL = {
  _on: L.Evented.prototype._on,
  _off: L.Evented.prototype._off,
  _listens: L.Evented.prototype._listens
};

/* Por debajo de este tamaño recorrer la lista es más barato que
   mantener el índice (la inmensa mayoría de los objetos de Leaflet
   tienen uno o dos oyentes por evento).                             */
const LISTENER_INDEX_MIN = 32;

/* lista de oyentes → Map(función → Set(contexto)). Débil: la lista
   desaparece con su evento y el índice con ella.                    */
let listenerIndexes = new WeakMap();

/* Leaflet guarda `undefined` como contexto cuando es el propio objeto */
const listenerCtx = (self, context) => (context === self ? undefined : context);

function buildListenerIndex(list) {
  const index = new Map();
  for (const l of list) {
    let ctxs = index.get(l.fn);
    if (!ctxs) index.set(l.fn, ctxs = new Set());
    ctxs.add(l.ctx);
  }
  listenerIndexes.set(list, index);
  return index;
}

function indexedListens(type, fn, context) {
  if (fn && this._events) {
    const list = this._events[type];
    if (list && list.length >= LISTENER_INDEX_MIN) {
      const ctxs = (listenerIndexes.get(list) || buildListenerIndex(list)).get(fn);
      if (!ctxs || !ctxs.has(listenerCtx(this, context))) return false;
    }
  }
  return LEAFLET_EVENTS_ORIGINAL._listens.call(this, type, fn, context);
}

function indexedOn(type, fn, context, once) {
  const before = this._events && this._events[type];
  const n = before ? before.length : 0;
  LEAFLET_EVENTS_ORIGINAL._on.call(this, type, fn, context, once);
  const list = this._events && this._events[type];
  /* Si la lista creció, el oyente nuevo entra en su índice (si todavía
     no hay índice, se construirá entero en la próxima consulta).      */
  const index = list && list.length > n && listenerIndexes.get(list);
  if (index) {
    const ctx = listenerCtx(this, context);
    let ctxs = index.get(fn);
    if (!ctxs) index.set(fn, ctxs = new Set());
    ctxs.add(ctx);
  }
}

function indexedOff(type, fn, context) {
  const before = this._events && this._events[type];
  const index = before && listenerIndexes.get(before);
  const result = LEAFLET_EVENTS_ORIGINAL._off.apply(this, arguments);
  /* Con un solo argumento `_off` borra la lista entera: el índice se va con ella */
  if (index && arguments.length > 1) {
    const list = this._events && this._events[type];
    if (list && list !== before) listenerIndexes.set(list, index); /* copia durante un `fire` */
    const ctxs = index.get(fn);
    if (ctxs) {
      ctxs.delete(listenerCtx(this, context));
      if (!ctxs.size) index.delete(fn);
    }
  }
  return result;
}

/* Activar/desactivar el parche. Desactivarlo existe para que una
   prueba pueda medir el «antes» y el «después» en la misma página
   (tests/browser/perf-markers.mjs); los índices se descartan en los
   dos sentidos porque dejan de mantenerse mientras está apagado.     */
function setListenerIndex(on) {
  const proto = L.Evented.prototype;
  listenerIndexes = new WeakMap();
  proto._on = on ? indexedOn : LEAFLET_EVENTS_ORIGINAL._on;
  proto._off = on ? indexedOff : LEAFLET_EVENTS_ORIGINAL._off;
  proto._listens = on ? indexedListens : LEAFLET_EVENTS_ORIGINAL._listens;
}
setListenerIndex(true);
