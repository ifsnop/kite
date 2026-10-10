/* ---------- Map rotation ----------
   Derived from leaflet-rotate 0.2.8 (https://github.com/Raruto/leaflet-rotate),
   © Raruto and contributors (IvanSanchez, Fnicollet, Hyperknot),
   GPL-3.0. Incorporated into KITE Local and distributed as part of it
   under the AGPL-3.0 (GPLv3 §13 allows combining both). The plugin is
   unmaintained since 2023 and already needed fixes of ours, so it now
   lives here, cut down to what this viewer uses:

   - Kept: the rotated pane, screen <-> layer conversions, setBearing/
     getBearing and the "rotate" event, view bounds and fit zoom, tiles,
     the canvas renderer, markers (and dragging them), tooltips, popups,
     and two-finger pinch zoom.
   - Dropped: its compass control, device-orientation compass, Shift+
     wheel rotation, touch rotation, container mutation observer, the
     per-marker rotation options, geolocation and the `rotate` option
     itself. This map is ALWAYS rotatable: with leaflet-rotate it was
     created with `rotate: true`, so the north-up view already ran
     through this code — dropping the flag removes branches, not
     behaviour.
   - Added: the three «one world» fixes the plugin lacked (maxBounds,
     zoom floor, tiles outside the world), at the end of this file.

   It PATCHES Leaflet internals, so it is tied to the pinned Leaflet
   (LEAFLET_PATCHED, checked by tests/browser/rotation.mjs together with
   every original saved in `leaflet`). Loaded before 10-map.js: the
   prototypes must be patched before the map is created. Nothing here
   touches `map` or WORLD_BOUNDS at load time; callers pass them.      */

const LEAFLET_PATCHED = "1.9.4";
const DEG = Math.PI / 180;

/* Leaflet's own methods, saved before patching: every override below
   delegates to them for the part rotation does not change.          */
const leaflet = {
  mapInitialize: L.Map.prototype.initialize,
  getBoundsZoom: L.Map.prototype.getBoundsZoom,
  panInside: L.Map.prototype.panInside,
  getCenterOffset: L.Map.prototype._getCenterOffset,
  limitCenter: L.Map.prototype._limitCenter,
  dragStart: L.Map.Drag.prototype._onDragStart,
  preDragLimit: L.Map.Drag.prototype._onPreDragLimit,
  gridEvents: L.GridLayer.prototype.getEvents,
  rendererEvents: L.Renderer.prototype.getEvents,
  markerEvents: L.Marker.prototype.getEvents,
  markerSetPos: L.Marker.prototype._setPos,
  markerInitInteraction: L.Marker.prototype._initInteraction,
  overlayEvents: L.DivOverlay.prototype.getEvents,
  overlayUpdatePosition: L.DivOverlay.prototype._updatePosition,
  popupAnimateZoom: L.Popup.prototype._animateZoom
};

/* ---------- Pure geometry (tested in Node, tests/rotation.js) ---------- */

/* (x, y) turned `theta` radians clockwise on screen (y grows downwards)
   around (cx, cy).                                                    */
function rotateXY(x, y, theta, cx, cy) {
  const c = Math.cos(theta), s = Math.sin(theta), dx = x - cx, dy = y - cy;
  return { x: dx * c - dy * s + cx, y: dx * s + dy * c + cy };
}

/* CSS transform that places an element whose unrotated top-left is
   `pos` rotated `theta` around `pivot`. CSS rotates around the
   element's own origin (its top-left here), so the translation is the
   rotated position, not `pos` itself.                                 */
function rotatedTransformCss(pos, theta, pivot) {
  const p = rotateXY(pos.x, pos.y, theta, pivot.x, pivot.y);
  return `translate3d(${p.x}px,${p.y}px,0) rotate(${theta}rad)`;
}

/* Axis-aligned box that encloses a set of points: what a rotated
   rectangle covers once turned back into the unrotated frame.        */
function enclosingBox(points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { min: { x: Math.min(...xs), y: Math.min(...ys) },
           max: { x: Math.max(...xs), y: Math.max(...ys) } };
}

L.extend(L.Point.prototype, {
  /* Same object back when there is nothing to turn: north-up callers
     rely on it to keep whole-pixel positions untouched.               */
  rotateFrom(theta, pivot) {
    if (!theta) return this;
    const r = rotateXY(this.x, this.y, theta, pivot.x, pivot.y);
    return new L.Point(r.x, r.y);
  },
  rotate(theta) { return this.rotateFrom(theta, L.point(0, 0)); }
});

/* ---------- The rotated pane ----------
   Tiles and vector layers live in `rotatePane`, turned by CSS; markers,
   tooltips and popups in `norotatePane`, positioned on the turned spot
   but kept upright (labels stay horizontal for free). Both hang from
   Leaflet's mapPane, so panning and zooming still move them together. */
function rotatePaneTransform(el, pos, theta, pivot) {
  el._leaflet_pos = pos; /* what L.DomUtil.getPosition reads back */
  if (!theta) {
    /* North up: whole pixels, or every tile would be resampled blurry */
    L.DomUtil.setPosition(el, pos._round());
    return;
  }
  el.style[L.DomUtil.TRANSFORM] = rotatedTransformCss(pos, theta, pivot);
}

/* Centre of the view in mapPane coordinates: the pivot of every turn */
function pixelCenter(map) {
  return map.getSize()._divideBy(2)._subtract(map._getMapPanePos());
}

/* Layer-pixel box covering a rectangle of the CONTAINER once the map is
   turned (its four corners, floored like Leaflet does).              */
function containerRectToLayerBounds(map, min, max) {
  const corners = [[min.x, min.y], [max.x, min.y], [min.x, max.y], [max.x, max.y]]
    .map(c => map.containerPointToLayerPoint(c).floor());
  return L.bounds(corners);
}

L.Map.include({
  initialize(id, options) {
    /* Read while Leaflet's constructor sets the first view */
    this._bearing = 0;
    leaflet.mapInitialize.call(this, id, options);
    /* Gives rotatePane its first (null) transform, as every later turn will */
    this.setBearing(0);
  },

  _initPanes() {
    this._panes = {};
    this._paneRenderers = {};
    this._mapPane = this.createPane("mapPane", this._container);
    L.DomUtil.setPosition(this._mapPane, L.point(0, 0));
    this._rotatePane = this.createPane("rotatePane", this._mapPane);
    this._norotatePane = this.createPane("norotatePane", this._mapPane);
    for (const name of ["tilePane", "overlayPane"]) this.createPane(name, this._rotatePane);
    for (const name of ["shadowPane", "markerPane", "tooltipPane", "popupPane"]) {
      this.createPane(name, this._norotatePane);
    }
    if (!this.options.markerZoomAnimation) {
      L.DomUtil.addClass(this._panes.markerPane, "leaflet-zoom-hide");
      L.DomUtil.addClass(this._panes.shadowPane, "leaflet-zoom-hide");
    }
  },

  /* Degrees, clockwise: the content turns this much and north points
     that way on screen. Turns around the centre of the view.         */
  setBearing(theta) {
    const bearing = L.Util.wrapNum(theta, [0, 360]) * DEG;
    const center = pixelCenter(this);
    const oldPos = this._getRotatePanePos().rotateFrom(-this._bearing, center);
    const newPos = oldPos.rotateFrom(bearing, center);
    rotatePaneTransform(this._rotatePane, oldPos, bearing, center);
    this._bearing = bearing;
    this._rotatePanePos = newPos;
    this.fire("rotate");
  },
  getBearing() { return this._bearing / DEG; },

  _getRotatePanePos() { return this._rotatePanePos || L.point(0, 0); },

  containerPointToLayerPoint(point) {
    const rp = this._getRotatePanePos();
    return L.point(point).subtract(this._getMapPanePos()).rotateFrom(-this._bearing, rp).subtract(rp);
  },
  layerPointToContainerPoint(point) {
    const rp = this._getRotatePanePos();
    return L.point(point).add(rp).rotateFrom(this._bearing, rp).add(this._getMapPanePos());
  },
  /* rotatePane <-> mapPane (= norotatePane). Never mutate the argument:
     callers pass positions Leaflet still holds (an icon's own).       */
  rotatedPointToMapPanePoint(point) {
    return L.point(point).rotate(this._bearing).add(this._getRotatePanePos());
  },
  mapPanePointToRotatedPoint(point) {
    return L.point(point).subtract(this._getRotatePanePos()).rotate(-this._bearing);
  },

  _getNewPixelOrigin(center, zoom) {
    const viewHalf = this.getSize()._divideBy(2);
    return this.project(center, zoom).rotate(this._bearing)._subtract(viewHalf)
      ._add(this._getMapPanePos())._add(this._getRotatePanePos())
      .rotate(-this._bearing)._round();
  },
  _getCenterOffset(latlng) {
    return leaflet.getCenterOffset.call(this, latlng).rotate(this._bearing);
  },

  /* Turned, the view is no longer a north-aligned rectangle: these are
     the bounds that enclose its four corners.                        */
  getBounds() {
    const size = this.getSize();
    return L.latLngBounds([[0, 0], [size.x, 0], [size.x, size.y], [0, size.y]]
      .map(c => this.containerPointToLatLng(c)));
  },

  /* Zoom that fits `bounds` measured as they lie on the TURNED screen;
     north up it is Leaflet's own answer.                             */
  getBoundsZoom(bounds, inside, padding) {
    if (!this._bearing) return leaflet.getBoundsZoom.call(this, bounds, inside, padding);
    bounds = L.latLngBounds(bounds);
    const zoom = this.getZoom() || 0;
    const size = this.getSize().subtract(L.point(padding || [0, 0]));
    const origin = this.getPixelOrigin();
    const box = enclosingBox([bounds.getNorthWest(), bounds.getNorthEast(),
                              bounds.getSouthWest(), bounds.getSouthEast()]
      .map(ll => this.layerPointToContainerPoint(this.project(ll)._subtract(origin))));
    const scaleX = size.x / (box.max.x - box.min.x), scaleY = size.y / (box.max.y - box.min.y);
    let z = this.getScaleZoom(inside ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY), zoom);
    const snap = this.options.zoomSnap;
    if (snap) {
      z = Math.round(z / (snap / 100)) * (snap / 100); /* no jump within 1% of a level */
      z = inside ? Math.ceil(z / snap) * snap : Math.floor(z / snap) * snap;
    }
    return Math.max(this.getMinZoom(), Math.min(this.getMaxZoom(), z));
  },

  /* Leaflet tests "is it visible" in unrotated pixels; turned, the
     visible area is the container itself.                            */
  panInside(latlng, options = {}) {
    if (!this._bearing) return leaflet.panInside.call(this, latlng, options);
    const tl = L.point(options.paddingTopLeft || options.padding || [0, 0]);
    const br = L.point(options.paddingBottomRight || options.padding || [0, 0]);
    const rect = this._container.getBoundingClientRect();
    const point = this.latLngToContainerPoint(latlng);
    const view = L.bounds([L.point(rect), L.point(rect).add(this.getSize())]);
    const center = view.getCenter();
    const padded = L.bounds([view.min.add(tl), view.max.subtract(br)]);
    const paddedSize = padded.getSize();
    if (!padded.contains(point)) {
      this._enforcingBounds = true;
      const towards = point.subtract(padded.getCenter());
      const offset = padded.extend(point).getSize().subtract(paddedSize);
      center.x += towards.x < 0 ? -offset.x : offset.x;
      center.y += towards.y < 0 ? -offset.y : offset.y;
      this.panTo(this.containerPointToLatLng(center), options);
      this._enforcingBounds = false;
    }
    return this;
  }
});

/* ---------- Tiles and the canvas: cover the TURNED view ----------
   Both ask the map which layer pixels to fill; turned, that is the box
   enclosing the rotated container, larger than the container itself,
   or the corners show the background.                                */
L.GridLayer.include({
  getEvents() {
    const events = leaflet.gridEvents.call(this);
    if (!this.options.updateWhenIdle) {
      if (!this._onRotate) this._onRotate = L.Util.throttle(this._onMoveEnd, this.options.updateInterval, this);
      events.rotate = this._onRotate;
    }
    return events;
  },
  _getTiledPixelBounds(center) {
    const map = this._map, size = map.getSize();
    const mapZoom = map._animatingZoom ? Math.max(map._animateToZoom, map.getZoom()) : map.getZoom();
    const scale = map.getZoomScale(mapZoom, this._tileZoom);
    const pixelCenter = map.project(center, this._tileZoom).floor();
    const half = containerRectToLayerBounds(map, L.point(0, 0), size).getSize().divideBy(scale * 2);
    return L.bounds(pixelCenter.subtract(half), pixelCenter.add(half));
  }
});

L.Renderer.include({
  getEvents() {
    return L.extend(leaflet.rendererEvents.call(this), { rotate: this._update });
  },
  /* Zoom animation: scale around where the TURNED top-left goes */
  _updateTransform(center, zoom) {
    const scale = this._map.getZoomScale(zoom, this._zoom);
    const offset = this._map._latLngToNewLayerPoint(this._topLeft, zoom, center)._round();
    L.DomUtil.setTransform(this._container, offset, scale);
  },
  _update() {
    const map = this._map, size = map.getSize(), p = this.options.padding;
    this._bounds = containerRectToLayerBounds(map, size.multiplyBy(-p), size.multiplyBy(1 + p));
    this._topLeft = map.layerPointToLatLng(this._bounds.min);
    this._center = map.getCenter();
    this._zoom = map.getZoom();
  }
});

/* ---------- Markers, tooltips and popups: upright, on the turned spot ---------- */
L.Marker.include({
  getEvents() {
    return L.extend(leaflet.markerEvents.call(this), { rotate: this.update });
  },
  _setPos(pos) {
    leaflet.markerSetPos.call(this, this._map.rotatedPointToMapPanePoint(pos));
  },
  _initInteraction() {
    const result = leaflet.markerInitInteraction.apply(this, arguments);
    patchMarkerDrag(this.dragging);
    return result;
  }
});

/* Leaflet does not export its marker drag handler, so its prototype is
   reached through the first instance. While dragging, the icon moves in
   mapPane pixels, and its latlng has to be read back through the turn. */
let markerDragPatched = false;
function patchMarkerDrag(handler) {
  if (!handler || markerDragPatched) return;
  markerDragPatched = true;
  const proto = Object.getPrototypeOf(handler);
  const onDragEnd = proto._onDragEnd;
  proto._onDrag = function (e) {
    const marker = this._marker, map = marker._map;
    const iconPos = L.DomUtil.getPosition(marker._icon);
    if (marker._shadow) L.DomUtil.setPosition(marker._shadow, iconPos);
    const latlng = map.layerPointToLatLng(map.mapPanePointToRotatedPoint(iconPos));
    marker._latlng = latlng;
    e.latlng = latlng;
    e.oldLatLng = this._oldLatLng;
    marker.fire("move", e).fire("drag", e);
  };
  proto._onDragEnd = function (e) {
    this._marker.update(); /* back to its latlng, snapped like any other placement */
    onDragEnd.call(this, e);
  };
  /* Listeners are bound when enabled: this one already holds the old ones */
  if (handler.enabled()) { handler.disable(); handler.enable(); }
}

/* Leaflet placed the overlay at its ROTATED layer point; move it to
   where that point is on the mapPane, keeping the anchor.           */
function placeOverlayUnrotated(overlay) {
  const anchor = overlay._getAnchor();
  const pos = L.DomUtil.getPosition(overlay._container).subtract(anchor);
  L.DomUtil.setPosition(overlay._container, overlay._map.rotatedPointToMapPanePoint(pos).add(anchor));
}
L.DivOverlay.include({
  getEvents() {
    return L.extend(leaflet.overlayEvents.call(this), { rotate: this._updatePosition });
  },
  _updatePosition() {
    if (!this._map) return;
    leaflet.overlayUpdatePosition.call(this);
    if (this._map && this._zoomAnimated) placeOverlayUnrotated(this);
  }
});
L.Popup.include({
  _animateZoom(e) {
    leaflet.popupAnimateZoom.call(this, e);
    if (this._map) placeOverlayUnrotated(this);
  },
  /* Leaflet 1.9.4's, except for where the popup is on screen: it sits in
     norotatePane, so mapPane pixels plus the pane offset, not the
     (turned) layerPointToContainerPoint.                             */
  _adjustPan() {
    if (!this.options.autoPan) return;
    if (this._map._panAnim) this._map._panAnim.stop();
    if (this._autopanning) { this._autopanning = false; return; } /* our own autopan's moveend */
    const map = this._map;
    const marginBottom = parseInt(L.DomUtil.getStyle(this._container, "marginBottom"), 10) || 0;
    const containerHeight = this._container.offsetHeight + marginBottom;
    const containerWidth = this._containerWidth;
    const pos = L.point(this._containerLeft, -containerHeight - this._containerBottom)
      ._add(L.DomUtil.getPosition(this._container))._add(map._getMapPanePos());
    const padding = L.point(this.options.autoPanPadding);
    const tl = L.point(this.options.autoPanPaddingTopLeft || padding);
    const br = L.point(this.options.autoPanPaddingBottomRight || padding);
    const size = map.getSize();
    let dx = 0, dy = 0;
    if (pos.x + containerWidth + br.x > size.x) dx = pos.x + containerWidth - size.x + br.x;
    if (pos.x - dx - tl.x < 0) dx = pos.x - tl.x;
    if (pos.y + containerHeight + br.y > size.y) dy = pos.y + containerHeight - size.y + br.y;
    if (pos.y - dy - tl.y < 0) dy = pos.y - tl.y;
    if (dx || dy) {
      if (this.options.keepInView) this._autopanning = true;
      map.fire("autopanstart").panBy([dx, dy]);
    }
  }
});
L.Tooltip.include({
  _updatePosition() {
    const pos = this._map.latLngToLayerPoint(this._latlng);
    this._setPosition(this._map.rotatedPointToMapPanePoint(pos));
  },
  _animateZoom(e) {
    const pos = this._map._latLngToNewLayerPoint(this._latlng, e.zoom, e.center);
    this._setPosition(this._map.rotatedPointToMapPanePoint(pos));
  }
});

/* ---------- Two-finger pinch zoom ----------
   Leaflet keeps the spot under the fingers fixed by shifting the centre
   by the fingers' offset from the view centre — a SCREEN offset, applied
   in the unrotated map frame: turned, the map slid sideways under the
   fingers. Leaflet 1.9.4's handler, with that offset turned back.
   (leaflet-rotate replaced the whole handler instead, and left Leaflet's
   own attached too: both ran on every pinch.)                         */
L.Map.TouchZoom.include({
  _onTouchMove(e) {
    if (!e.touches || e.touches.length !== 2 || !this._zooming) return;
    const map = this._map;
    const p1 = map.mouseEventToContainerPoint(e.touches[0]);
    const p2 = map.mouseEventToContainerPoint(e.touches[1]);
    const scale = p1.distanceTo(p2) / this._startDist;
    this._zoom = map.getScaleZoom(scale, this._startZoom);
    if (!map.options.bounceAtZoomLimits && (
      (this._zoom < map.getMinZoom() && scale < 1) ||
      (this._zoom > map.getMaxZoom() && scale > 1))) {
      this._zoom = map._limitZoom(this._zoom);
    }
    if (map.options.touchZoom === "center") {
      this._center = this._startLatLng;
      if (scale === 1) return;
    } else {
      const delta = p1._add(p2)._divideBy(2)._subtract(this._centerPoint);
      if (scale === 1 && delta.x === 0 && delta.y === 0) return;
      this._center = map.unproject(
        map.project(this._pinchStartLatLng, this._zoom).subtract(delta.rotate(-map._bearing)), this._zoom);
    }
    if (!this._moved) {
      map._moveStart(true, false);
      this._moved = true;
    }
    L.Util.cancelAnimFrame(this._animRequest);
    const moveFn = L.Util.bind(map._move, map, this._center, this._zoom, { pinch: true, round: false }, undefined);
    this._animRequest = L.Util.requestAnimFrame(moveFn, this, true);
    L.DomEvent.preventDefault(e);
  }
});

/* ================= «One world» with the map turned =================
   Three holes leaflet-rotate left open, each with its fix:
   1. Dragging and recentring against the edge of the world (maxBounds).
   2. Zoom floor: the turned view has to fit inside the world.
   3. Tiles outside the world (400 responses and a false warning).    */

const isRotatedMap = m => !!m._bearing;

/* ---------- 1. `maxBounds` with the map turned ----------
   Leaflet limits dragging with a rectangle in SCREEN pixels built from
   two corners of the world, and recentres with half an unrotated view:
   turned, dragging against the edge jumped to another continent
   (measured: Siberia to Madagascar in one drag at 45°). North up it is
   Leaflet's code as is; turned, both limits are computed in the
   UNROTATED map frame with the box enclosing the turned view
   (rotatedViewExtra), and the drag is turned back to the screen. Hard
   limit (viscosity 1), the one this viewer uses.                     */

/* Drag `offset` (screen pixels the content moves) with the map turned
   `b` radians, clipped so the centre — which moves the opposite way,
   in the map frame — stays within [min, max]. If the view is larger
   than the world along an axis (min > max) the centre stays midway, as
   Leaflet does.                                                       */
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
    if (!bounds || !isRotatedMap(this)) return leaflet.limitCenter.call(this, center, zoom, bounds);
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
    leaflet.dragStart.call(this);
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
    if (!this._rotLimit) return leaflet.preDragLimit.call(this);
    const r = this._rotLimit;
    const offset = this._draggable._newPos.subtract(this._draggable._startPos);
    const fixed = clampRotatedDragOffset(offset, r.bearing, r.c0, r.min, r.max);
    this._draggable._newPos = this._draggable._startPos.add(L.point(fixed.x, fixed.y));
  }
});

/* ---------- 2. Zoom floor with the map turned ----------
   Turned, what has to fill the world is not the window but the box
   enclosing it turned (W·|cos|+H·|sin| wide, and the other way round
   high), or the background shows in the corners. This returns how much
   that box exceeds the window.                                       */
function rotatedViewExtra(m) {
  const size = m.getSize();
  const b = m.getBearing() * DEG;
  const c = Math.abs(Math.cos(b)), s = Math.abs(Math.sin(b));
  return L.point(size.x * c + size.y * s - size.x, size.x * s + size.y * c - size.y);
}
/* Zoom at which the TURNED view fits inside `bounds`. getBoundsZoom
   subtracts its `padding` from the window size: a NEGATIVE padding of
   rotatedViewExtra is exactly the turned box, so Leaflet still answers
   (zoomSnap rounding included) instead of computing the logarithm here.
   Leaflet's own method, not the turned one above: that one measures
   something else (the turned WORLD against the window).             */
function rotatedFitZoom(m, bounds) {
  return leaflet.getBoundsZoom.call(m, bounds, true, rotatedViewExtra(m).multiplyBy(-1));
}

/* ---------- 3. Tiles outside the world ----------
   `noWrap` is not enough with the map TURNED: tiles are requested for
   the box enclosing the turned view, wider than the world, and Leaflet
   only drops an out-of-range tile (`_isValidTile`) if the layer has
   `bounds` — without them it asked for x=-1 or x=2^z, the server
   answered 400 and the «not responding» warning fired with the service
   perfectly fine (measured: 8 errors at zoom 2 and 45°, none at 0°).
   Like `noWrap`, it is written on the already built options: Leaflet
   reads them when the layer is added, not in the constructor.        */
function confineTilesToWorld(layer, bounds) {
  layer.options.bounds = bounds;
}
