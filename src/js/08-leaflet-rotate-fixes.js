/* ---------- Correcciones a leaflet-rotate 0.2.8 ----------
   Todo lo que este visor ha tenido que arreglar del plugin de rotación
   vive AQUÍ, junto, y no repartido por 10-map.js: así se revisa de un
   vistazo, se retira de una vez si el experimento no sigue y, si algún
   día se incorpora el plugin al código, es la lista exacta de cambios
   que hay que llevarle. Son tres agujeros de «una sola Tierra» que el
   plugin no tapa con el mapa girado:

   1. Arrastre y recentrado contra el borde del mundo (`maxBounds`).
   2. Suelo de zoom: la ventana girada tiene que caber en el mundo.
   3. Teselas fuera del mundo (peticiones 400 y aviso falso).

   Va ANTES de 10-map.js: los parches de prototipo deben estar puestos
   cuando se crea el mapa. Nada de aquí usa `map` ni `WORLD_BOUNDS` al
   cargarse; quien llama pasa el mapa y los límites.                   */

const isRotatedMap = m => !!(m._rotate && m._bearing);

/* ---------- 1. `maxBounds` con el mapa girado ----------
   leaflet-rotate no adapta `maxBounds` al giro (lo deja como TODO en su
   código): Leaflet limita el arrastre con un rectángulo en píxeles de
   PANTALLA calculado con dos esquinas del mundo, y recentra con medio
   tamaño de ventana sin girar — con el mapa rotado, arrastrar contra el
   borde hacía saltar la vista a otro continente (medido: de Siberia a
   Madagascar en un solo arrastre a 45°). Con el norte arriba se usa el
   código de Leaflet tal cual; rotado, los dos límites se calculan en el
   marco del mapa SIN girar, con la caja que envuelve la vista girada
   (rotatedViewExtra), y el arrastre se vuelve a girar a pantalla.
   Límite duro (viscosidad 1), que es la que usa este visor.            */
const leafletLimitCenter = L.Map.prototype._limitCenter;
const leafletDragStart = L.Map.Drag.prototype._onDragStart;
const leafletPreDragLimit = L.Map.Drag.prototype._onPreDragLimit;

/* Arrastre `offset` (píxeles de pantalla que se mueve el contenido) con
   el mapa girado `b` radianes, recortado para que el centro —que se
   mueve al revés, en el marco del mapa— no salga de [min, max]. Si la
   vista es más grande que el mundo en un eje (min > max), el centro se
   queda en medio, como hace Leaflet.                                  */
function clampRotatedDragOffset(offset, b, c0, min, max) {
  const c = Math.cos(b), s = Math.sin(b);
  let dx = -(c * offset.x + s * offset.y), dy = -(-s * offset.x + c * offset.y);
  const clamp = (v, lo, hi) => lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
  dx = clamp(c0.x + dx, min.x, max.x) - c0.x;
  dy = clamp(c0.y + dy, min.y, max.y) - c0.y;
  return { x: -(c * dx - s * dy), y: -(s * dx + c * dy) };
}

L.Map.include({
  _limitCenter(center, zoom, bounds) {
    if (!bounds || !isRotatedMap(this)) return leafletLimitCenter.call(this, center, zoom, bounds);
    const centerPoint = this.project(center, zoom);
    const viewHalf = this.getSize().add(rotatedViewExtra(this)).divideBy(2);
    const viewBounds = L.bounds(centerPoint.subtract(viewHalf), centerPoint.add(viewHalf));
    const offset = this._getBoundsOffset(viewBounds, bounds, zoom);
    if (Math.abs(offset.x) <= 1 && Math.abs(offset.y) <= 1) return center;
    return this.unproject(centerPoint.add(offset), zoom);
  }
});
L.Map.Drag.include({
  _onDragStart() {
    leafletDragStart.call(this);
    const m = this._map;
    this._rotLimit = null;
    if (!this._offsetLimit || !isRotatedMap(m)) return;
    const zoom = m.getZoom();
    const b = L.latLngBounds(m.options.maxBounds);
    const half = m.getSize().add(rotatedViewExtra(m)).divideBy(2);
    this._rotLimit = {
      bearing: m._bearing, c0: m.project(m.getCenter(), zoom),
      min: m.project(b.getNorthWest(), zoom).add(half),
      max: m.project(b.getSouthEast(), zoom).subtract(half)
    };
  },
  _onPreDragLimit() {
    if (!this._rotLimit) return leafletPreDragLimit.call(this);
    const r = this._rotLimit;
    const offset = this._draggable._newPos.subtract(this._draggable._startPos);
    const fixed = clampRotatedDragOffset(offset, r.bearing, r.c0, r.min, r.max);
    this._draggable._newPos = this._draggable._startPos.add(L.point(fixed.x, fixed.y));
  }
});

/* ---------- 2. Suelo de zoom con el mapa girado ----------
   Con el mapa rotado, lo que tiene que llenar el mundo no es la ventana
   sino la caja que la envuelve girada (W·|cos|+H·|sin| de ancho, y al
   revés de alto), o asoma el fondo por las esquinas. Esto devuelve lo
   que esa caja excede a la ventana.                                   */
function rotatedViewExtra(m) {
  const size = m.getSize();
  const b = (m.getBearing ? m.getBearing() : 0) * Math.PI / 180;
  const c = Math.abs(Math.cos(b)), s = Math.abs(Math.sin(b));
  return L.point(size.x * c + size.y * s - size.x, size.x * s + size.y * c - size.y);
}
/* Zoom en que la vista GIRADA cabe dentro de `bounds`. getBoundsZoom
   resta su `padding` al tamaño de la ventana: un padding NEGATIVO de
   rotatedViewExtra es justo la caja girada, y así se sigue preguntando
   a Leaflet (redondeo a zoomSnap incluido) en vez de calcular el
   logaritmo aquí. Trampa: leaflet-rotate redefine getBoundsZoom con el
   mapa girado y mide otra cosa (la caja del MUNDO girado frente a la
   ventana), así que se apaga `_rotate` solo durante esta llamada
   síncrona y el plugin cae al método original de Leaflet.            */
function rotatedFitZoom(m, bounds) {
  const rot = m._rotate;
  m._rotate = false;
  try { return m.getBoundsZoom(bounds, true, rotatedViewExtra(m).multiplyBy(-1)); }
  finally { m._rotate = rot; }
}

/* ---------- 3. Teselas fuera del mundo ----------
   `noWrap` no basta con el mapa ROTADO: leaflet-rotate pide teselas
   para la caja que envuelve la vista girada, más ancha que el mundo, y
   Leaflet solo descarta una tesela fuera de rango (`_isValidTile`) si
   la capa tiene `bounds` — sin ellos pedía x=-1 o x=2^z, el servidor
   contestaba 400 y saltaba el aviso de «no responde» con el servicio en
   perfecto estado (medido: 8 errores a zoom 2 y 45°, ninguno a 0°).
   Como `noWrap`, se escribe sobre las opciones ya construidas: Leaflet
   las lee al añadir la capa, no en el constructor.                    */
function confineTilesToWorld(layer, bounds) {
  layer.options.bounds = bounds;
}
