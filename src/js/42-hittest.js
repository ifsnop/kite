/* ---------- Hit-testing propio para el menú contextual ----------
   Leaflet solo resuelve UNA capa por click en su renderizador de
   lienzo (comprobado en el propio Canvas.js de Leaflet 1.9.4:
   _handleClick/_handleMouseHover siempre devuelven como mucho una capa,
   la de más arriba en ese píxel; no hay bubbling real a las de abajo).
   Por eso, para poder ofrecer varias capas superpuestas en el menú
   contextual, se recorre a mano.

   Antes esto probaba los trazos por CAJA ENVOLVENTE, como simplificación
   deliberada. Era incorrecto y se notaba: la caja de una línea diagonal
   cubre todo el rectángulo entre sus extremos, así que el menú ofrecía
   mediciones y polígonos a cientos de metros del cursor (medido en la
   reproducción: un punto a 226 px de una diagonal la "acertaba"), y un
   polígono cóncavo se acertaba en su escotadura, donde no hay nada
   dibujado. Ahora se prueba la geometría de verdad; la caja queda solo
   como criba barata previa.

   Todo se mide en PÍXELES de contenedor, no en grados: un margen en
   grados vale distancias muy distintas según la latitud y el zoom (la
   misma razón por la que isCenteredOn compara en píxeles).            */
const MARKER_HIT_PX = 20; /* radio de acierto en píxeles, del orden del icono de un marcador */
const PATH_HIT_PX = 10;   /* igual que el clickTolerance por defecto de Leaflet */

/* Distancia AL CUADRADO de un punto a un segmento: se evita la raíz
   comparando contra el cuadrado de la tolerancia.                     */
function segDistSq(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  /* Segmento degenerado (los dos extremos iguales): es un punto */
  let t = len ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = a.x + t * dx - p.x, ey = a.y + t * dy - p.y;
  return ex * ex + ey * ey;
}

/* ¿Hay algún segmento de la polilínea a menos de `tol` del punto?
   `closed` añade el lado de cierre (último → primero): getLatLngs() de
   un L.Polygon NO repite el punto inicial (Leaflet lo quita al
   construirse), así que sin esto el último lado del anillo no se
   probaría y un click sobre él no acertaría.                          */
function nearPolyline(p, pts, tol, closed) {
  const tol2 = tol * tol;
  for (let i = 1; i < pts.length; i++) {
    if (segDistSq(p, pts[i - 1], pts[i]) <= tol2) return true;
  }
  if (closed && pts.length > 2 && segDistSq(p, pts[pts.length - 1], pts[0]) <= tol2) return true;
  /* Un "anillo" de un solo punto no tiene segmentos que recorrer */
  return pts.length === 1 && segDistSq(p, pts[0], pts[0]) <= tol2;
}

/* Ray-casting clásico: cuenta los cruces de una semirrecta horizontal.
   La comparación asimétrica de las latitudes (`>` en una y `<=` en la
   otra) es lo que evita contar dos veces un vértice que cae justo a la
   altura del rayo.                                                     */
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].y, yj = ring[j].y;
    if ((yi > p.y) !== (yj > p.y)) {
      const x = ring[i].x + (p.y - yi) / (yj - yi) * (ring[j].x - ring[i].x);
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/* Un polígono se acierta dentro de su área o cerca de su contorno, que
   es lo que hace el propio renderizador de Leaflet: así el menú ofrece
   lo mismo que la capa captura en un click normal. Un punto dentro de
   un agujero queda fuera, salvo que esté pegado al borde del agujero. */
function pointInRings(p, rings, tol) {
  if (rings.some(ring => nearPolyline(p, ring, tol, true))) return true;
  const [outer, ...holes] = rings;
  return !!outer && pointInRing(p, outer) && !holes.some(h => pointInRing(p, h));
}

/* Los vértices de un trazo, proyectados a píxeles de contenedor */
function ringToPoints(ring) {
  return ring.map(ll => map.latLngToContainerPoint(ll));
}

/* Tolerancia de un trazo: nunca menos de PATH_HIT_PX, pero un contorno
   grueso debe poder acertarse en todo su ancho.                       */
function pathTolerance(sub) {
  const w = (sub.options && sub.options.weight) || 0;
  return Math.max(PATH_HIT_PX, w / 2 + 4);
}

/* Criba barata: la caja envolvente en píxeles, ensanchada por la
   tolerancia. Cuesta dos proyecciones por capa y evita proyectar todos
   los vértices de las que ni se acercan. Medido con 2002 capas en
   rootGroup: 7,2 ms por click derecho, imperceptible en una acción
   puntual (no es un bucle de fotograma). Sin esta criba habría que
   proyectar cada vértice de cada capa visible.                        */
function nearBounds(sub, containerPoint, tol) {
  let b;
  try { b = sub.getBounds(); } catch { return false; }
  if (!b || !b.isValid()) return false;
  const a = map.latLngToContainerPoint(b.getNorthWest());
  const c = map.latLngToContainerPoint(b.getSouthEast());
  return containerPoint.x >= Math.min(a.x, c.x) - tol && containerPoint.x <= Math.max(a.x, c.x) + tol
      && containerPoint.y >= Math.min(a.y, c.y) - tol && containerPoint.y <= Math.max(a.y, c.y) + tol;
}

/* El despacho es POR CLASE, no por "tiene este método". Con duck typing
   un L.Circle entraba por la rama de getLatLng —lo hereda de
   L.CircleMarker— y se probaba como un punto de 20 px en su centro, sin
   mirar jamás su radio: una medición circular de kilómetros solo se
   podía acertar en el centro. El orden importa además porque L.Polygon
   extiende L.Polyline.                                                */
function subHitTest(sub, latlng, containerPoint) {
  if (sub instanceof L.Marker) {
    return map.latLngToContainerPoint(sub.getLatLng()).distanceTo(containerPoint) <= MARKER_HIT_PX;
  }
  if (sub instanceof L.Circle) {
    /* En metros, que es como L.Circle define su radio. La tolerancia se
       pasa de píxeles a metros midiendo sobre el propio mapa, para que
       valga igual en cualquier latitud y zoom.                        */
    const tol = pathTolerance(sub);
    const metersPerPx = map.distance(map.containerPointToLatLng(containerPoint),
      map.containerPointToLatLng(containerPoint.add([1, 0])));
    return map.distance(sub.getLatLng(), latlng) <= sub.getRadius() + tol * metersPerPx;
  }
  if (sub instanceof L.Polyline) {
    const tol = pathTolerance(sub);
    if (!nearBounds(sub, containerPoint, tol)) return false;
    const closed = sub instanceof L.Polygon;
    const latlngs = sub.getLatLngs();
    if (!latlngs.length) return false;
    if (closed) {
      return polygonParts(latlngs).some(part =>
        pointInRings(containerPoint, [part.outer, ...part.holes].map(ringToPoints), tol));
    }
    /* Una polilínea puede ser multiparte: anida un nivel */
    const parts = Array.isArray(latlngs[0]) ? latlngs : [latlngs];
    return parts.some(part => nearPolyline(containerPoint, ringToPoints(part), tol));
  }
  /* Cualquier otro overlay anclado a un punto (la etiqueta L.Tooltip de
     una medición): sigue valiendo la distancia en píxeles.            */
  if (typeof sub.getLatLng === "function") {
    return map.latLngToContainerPoint(sub.getLatLng()).distanceTo(containerPoint) <= MARKER_HIT_PX;
  }
  return false;
}

function layerHitTest(layer, latlng, containerPoint) {
  const subs = typeof layer.getLayers === "function" ? layer.getLayers() : [layer];
  return subs.some(sub => subHitTest(sub, latlng, containerPoint));
}

/* Solo capas VISIBLES: rootGroup ya contiene exactamente esas, porque
   applyVisibility añade/quita de rootGroup al marcar/desmarcar la
   casilla.                                                           */
function layersAtPoint(latlng, containerPoint) {
  const hits = [];
  rootGroup.eachLayer(layer => {
    if (layer._li && layerHitTest(layer, latlng, containerPoint)) hits.push(layer._li);
  });
  return hits;
}

/* "marker" wins over "polygon" on mixed geometries: points sit on top and
   the marker panel is the useful one there. Split out of styleKind so a
   freshly-built KML/GeoJSON layer can be classified for the import report
   BEFORE it has an <li> (pending-record materialization, see
   materializeRecords) — styleKind still owns the li-level cases (measure/
   elevGrid/imageOverlay/group) and the per-node cache.                   */
function layerKind(layer) {
  if (!layer) return "group";
  let hasMarker = false, hasPath = false;
  const scan = l => {
    if (l instanceof L.Marker) hasMarker = true;
    else if (l instanceof L.Path) hasPath = true;
    if (l.eachLayer) l.eachLayer(scan);
  };
  scan(layer);
  return hasMarker ? "marker" : hasPath ? "polygon" : null;
}

/* Node kind, used by the style dialog AND by the same-kind selection rule.
   The result is cached because the geometry of a layer never changes
   after creation.                                                        */
function styleKind(li) {
  if (li._kind !== undefined) return li._kind;
  let kind;
  if (li._measure) kind = "measure";
  else if (li._elevGrid) kind = "elevGrid";
  else if (li._imageOverlay) kind = "imageOverlay";
  else kind = layerKind(nodeLayer(li));
  li._kind = kind;
  return kind;
}

/* Leaflet icon + text offset for a marker style. The two icon families
   anchor differently: the Leaflet pin points at its tip (bottom centre,
   as in stock Leaflet), while MDI glyphs are symmetric and sit centred
   on the coordinate, like Google Earth pushpins.                        */
function buildMarkerIcon(s, svg) {
  if (s.icon === LEAFLET_PIN || !svg) {
    const h = s.size, w = Math.round(h * LEAFLET_PIN_RATIO);
    return {
      icon: L.icon({
        iconUrl: LEAFLET_PIN_URL,
        shadowUrl: LEAFLET_PIN_SHADOW,
        iconSize: [w, h],
        iconAnchor: [Math.round(w / 2), h],
        shadowSize: [h, h],
        shadowAnchor: [Math.round(h * 12 / 41), h] /* stock proportions */
      }),
      textOffset: L.point(0, -h)
    };
  }
  /* divIcon with the SVG embedded inline, coloured via CSS currentColor */
  return {
    icon: L.divIcon({
      className: "mdi-pin",
      html: `<span style="color:${s.color};display:block;width:${s.size}px;height:${s.size}px">${svg}</span>`,
      iconSize: [s.size, s.size],
      iconAnchor: [s.size / 2, s.size / 2]
    }),
    textOffset: L.point(0, -s.size / 2)
  };
}

/* Apply icon + text + tree swatch of a marker-styled node.
   S\u00CDNCRONA desde que los iconos van empotrados (MDI_ICON_BODIES): no
   hay red que esperar, as\u00ED que tampoco hace falta el contador de
   secuencia que descartaba aplicaciones obsoletas durante la edici\u00F3n
   en vivo, ni el aviso de "no se pudo cargar el icono". Un icono
   desconocido (un \u00E1rbol guardado con otro cat\u00E1logo) devuelve null y
   buildMarkerIcon cae en la gota de Leaflet.                         */
function applyMarkerStyle(li) {
  const s = li._mstyle;
  const layer = nodeLayer(li);
  if (!s || !layer) return;
  const svg = s.icon === LEAFLET_PIN ? null : mdiSvg(s.icon);

  const { icon, textOffset } = buildMarkerIcon(s, svg);
  const each = l => {
    if (l instanceof L.Marker) l.setIcon(icon);
    if (l.eachLayer) l.eachLayer(each);
  };
  each(layer);
  applyMarkerText(li, textOffset);
  const sw = li.querySelector(":scope > .node-row > .swatch");
  if (sw) sw.style.background = s.color;
}

/* Bind the layer name to each marker as a compact text box: a permanent
   tooltip when "always visible", a click popup otherwise. Both use the
   "compacto" classes so the box shrink-wraps to the text.               */
function applyMarkerText(li, offset) {
  const s = li._mstyle;
  const layer = nodeLayer(li);
  if (!s || !layer) return;
  const html = `<span style="font-size:${s.textSize}px;color:${s.textColor}">${escapeHtml(li._name)}</span>`;
  if (!offset) offset = buildMarkerIcon(s, null).textOffset;
  layer.unbindPopup(); /* drop the group-level popup bound at creation */
  const each = l => {
    if (l instanceof L.Marker) {
      l.unbindPopup();
      l.unbindTooltip();
      if (s.textAlways) {
        l.bindTooltip(html, { permanent: true, direction: "top",
                              className: "compacto", offset });
      } else {
        l.bindPopup(html, { className: "compacto", autoClose: false,
                            closeOnClick: false, offset });
      }
    }
    if (l.eachLayer) l.eachLayer(each);
  };
  each(layer);
}

/* Imported markers never keep their original KML icon: Google Earth
   pushpins have no exact equivalent here and <IconStyle> images point at
   URLs this viewer does not load. Every marker layer therefore starts
   with the Leaflet drop pin in the default colour.                      */
function ensureMarkerDefaults(li) {
  if (li._mstyle || styleKind(li) !== "marker") return;
  li._mstyle = { ...DEFAULT_MARKER_STYLE };
  applyMarkerStyle(li);
}

/* Push li._style into every path of the layer and refresh the swatch */
function applyPolygonStyle(li) {
  const layer = nodeLayer(li);
  if (!layer || !li._style) return;
  layer.setStyle(li._style); /* group.setStyle only reaches paths; safe */
  clearFillOnOpenPaths(layer);
  const sw = li.querySelector(":scope > .node-row > .swatch");
  if (sw) sw.style.background = li._style.fillColor || li._style.color;
}

/* An open path can never be filled: Leaflet would close it on its own to
   paint the surface, drawing a side the user never traced. Enforced on
   the layer, not just in the dialog, because one style object is shared
   by every geometry of a KML placemark — a polygon and a line together
   there means the polygon legitimately wants fill and the line must not
   get it.                                                              */
function clearFillOnOpenPaths(layer) {
  const scan = l => {
    if (l instanceof L.Polyline && !(l instanceof L.Polygon)) l.setStyle({ fill: false });
    if (l.eachLayer) l.eachLayer(scan);
  };
  scan(layer);
}

/* Fill in defaults so every dialog control has a concrete value.
   Stroke opacity is not editable: outlines are always fully opaque.  */
function normalizePathStyle(s) {
  s = { color: "#3388ff", weight: 2, fillOpacity: 0.35, ...(s || {}) };
  if (!s.fillColor) s.fillColor = s.color;
  s.fill = s.fill !== false; /* Leaflet default: filled */
  s.stroke = s.stroke !== false; /* Leaflet default: outlined */
  s.opacity = 1;
  return s;
}

/* Maps the two independent booleans to the dialog's single three-way
   selector: stroke+fill can't both be off (that's not offered as an
   option), so a corrupted "both false" record falls back to "fill". */
function polygonModeOf(s) {
  if (s.stroke === false) return "fill";
  if (s.fill === false) return "stroke";
  return "both";
}

/* Perímetro de UN anillo: distancia geodésica (map.distance, la misma
   que usan las mediciones) entre cada vértice y el siguiente. Cerrado
   incluye el tramo último→primero; abierto lo mide tal cual viene, sin
   ese tramo final (un polígono ABC sin cerrar: A→B + B→C, sin C→A).    */
function ringPerimeter(ring, closed) {
  let d = 0;
  const edges = closed ? ring.length : ring.length - 1;
  for (let i = 0; i < edges; i++) d += map.distance(ring[i], ring[(i + 1) % ring.length]);
  return d;
}

/* Anillos de una geometría GeoJSON EN CRUDO, tal como venían en el
   archivo original (antes de que Leaflet los reescriba). Hace falta
   comprobar el cierre ahí y no en getLatLngs(): CUALQUIER L.Polygon
   quita el punto de cierre duplicado al construirse —lo trajera el
   archivo original o no—, así que una vez construida la capa ya no se
   puede distinguir un anillo que llegó cerrado de uno que no (verificado
   contra el código fuente de Leaflet 1.9.4: Polygon._convertLatLngs
   hace ring.pop() si el primer punto y el último son iguales, tanto si
   el anillo venía plano como anidado). layer.feature conserva el
   GeoJSON íntegro de origen (lo mismo que usa layerProperties para la
   ficha), así que solo existe para capas importadas de GeoJSON.       */
function rawPolygonRings(geometry) {
  if (!geometry) return null;
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return null;
}

