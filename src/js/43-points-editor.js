/* ---------- Lista de puntos editable de una capa de trazos ----------
   Formato de intercambio: una línea por punto, campos separados por
   TABULADOR, con fila de cabecera. Es lo que una hoja de cálculo pega y
   copia sin pedir nada, y un <textarea> lo aguanta con miles de líneas
   sin construir DOM por punto. Los anillos y las partes (agujeros de un
   polígono, tramos de una multigeometría) se separan con una LÍNEA EN
   BLANCO, conservando el orden original: exterior primero, agujeros
   después.                                                            */
const POINTS_HEADER = "Lat\tLon\tAlt";
const POINTS_DECIMALS = 6; /* ~0,1 m: más dígitos no dicen nada real */

/* Anillos de una capa como arrays de L.LatLng, en el orden en que hay
   que devolvérselos a setLatLngs. Devuelve también la forma para poder
   reconstruirla: `nested` indica si la capa esperaba un array de
   anillos o uno plano de puntos.                                      */
function pathRings(layer) {
  const latlngs = layer.getLatLngs();
  if (!latlngs.length) return { rings: [], nested: false };
  /* getLatLngs() de un polígono siempre anida (anillos); el de una
     polilínea solo anida si es multipart.                             */
  const nested = Array.isArray(latlngs[0]);
  if (!nested) return { rings: [latlngs], nested: false };
  const rings = [];
  const walk = arr => {
    if (!arr.length) return;
    if (Array.isArray(arr[0])) arr.forEach(walk); else rings.push(arr);
  };
  latlngs.forEach(walk);
  return { rings, nested: true };
}

/* Los waypoints de una medición (círculo o ruta, ver measureWaypoints en
   52-measure.js) no tienen concepto de anillo, pero encajan sin fricción
   como un único "anillo" en pointsToText/textToPoints — nunca hay más de
   uno, así que la pista de "esta capa tiene N trazos" no aplica nunca. */
function measureRings(m) {
  return { rings: [measureWaypoints(m)] };
}

/* Lat/Lon en el formato global elegido en Propiedades (`coordFormat`,
   decimal o GMS — ver su comentario más abajo); la altitud no es una
   coordenada y se queda siempre en decimal simple.                    */
function pointsToText(rings) {
  const alt = v => Number(v).toFixed(POINTS_DECIMALS);
  return [POINTS_HEADER, ""].concat(
    rings.map(ring => ring.map(p =>
      /* Sin altitud se escribe 0: la columna existe siempre, y 0 es lo
         que vale un punto dibujado a mano sobre el mapa.              */
      `${formatCoord(p.lat, true, coordFormat)}\t${formatCoord(p.lng, false, coordFormat)}\t${alt(p.alt === undefined ? 0 : p.alt)}`).join("\n"))
      .join("\n\n")).join("\n");
}

/* Texto → { rings, errors }. Tolera tabulador, coma o espacios como
   separador (se pega desde sitios muy distintos), se salta la cabecera
   y no cuenta como separador de anillo las líneas en blanco del
   principio ni del final. `errors` lleva el número de línea REAL para
   poder señalarlas.                                                   */
function textToPoints(text) {
  const rings = [], errors = [];
  let current = null;
  const lines = String(text).split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { if (current && current.length) { rings.push(current); current = null; } return; }
    /* La cabecera puede venir repetida al pegar varias veces */
    if (/^lat\b/i.test(line)) return;
    /* Tabulador primero: es el separador que pointsToText genera SIEMPRE,
       y el único que no choca con los espacios internos de un valor en
       GMS ("40° 30' 15.23\" N"). Coma/punto y coma como alternativa para
       pegar una lista externa; espacios sueltos, solo si no hay ninguno
       de los otros dos (entonces cada campo es un único token, como un
       decimal simple — un GMS pegado sin tabuladores ni comas no se
       puede recomponer en columnas de forma fiable).                   */
    const f = line.includes("\t") ? line.split("\t").map(s => s.trim()).filter(s => s !== "")
      : /[,;]/.test(line) ? line.split(/[,;]+/).map(s => s.trim()).filter(s => s !== "")
      : line.split(/\s+/).filter(s => s !== "");
    if (f.length < 2) { errors.push({ line: i + 1, text: raw, why: "hacen falta al menos latitud y longitud" }); return; }
    /* Latitud y longitud PRIMERO: en una línea de texto basura los tres
       campos fallan, y decir "altitud no numérica" mandaría a mirar la
       columna equivocada. parseCoord acepta decimal o GMS sin necesitar
       saber cuál se usó para escribir (coordFormat solo decide cómo se
       ESCRIBE, ver pointsToText).                                      */
    const lat = parseCoordRaw(f[0], true), lng = parseCoordRaw(f[1], false);
    if (!isFinite(lat) || !isFinite(lng)) {
      errors.push({ line: i + 1, text: raw, why: "latitud o longitud no numérica" });
      return;
    }
    const alt = f.length > 2 ? Number(f[2]) : undefined;
    if (f.length > 2 && !isFinite(alt)) { errors.push({ line: i + 1, text: raw, why: "altitud no numérica" }); return; }
    const pos = clampLatLng(lat, lng, alt);
    if (!pos) { errors.push({ line: i + 1, text: raw, why: "latitud o longitud fuera de rango" }); return; }
    if (!current) current = [];
    current.push(pos);
  });
  if (current && current.length) rings.push(current);
  return { rings, errors };
}

/* Perímetro y área de un nodo de tipo polígono, para el diálogo de
   propiedades. Un anillo DE POLÍGONO se da por cerrado salvo que su
   GeoJSON original (rawPolygonRings) diga lo contrario: un KML repite
   siempre el punto de cierre de su LinearRing, y un polígono dibujado a
   mano que se cerró sobre su último vértice lo está por construcción
   (ninguno de los dos tiene ese GeoJSON crudo con el que comprobar lo
   contrario). Un GeoJSON importado cuyo archivo no repetía el punto de
   cierre hace que el área salga null y no se muestre.
   Las formas ABIERTAS (una línea importada, o una dibujada terminando
   fuera de un vértice) no son L.Polygon: aportan longitud al perímetro
   y nunca área. Con solo líneas, el área es null y su fila se oculta;
   el perímetro sí se calcula siempre (ver ringPerimeter).             */
function polygonMeasures(li) {
  const layer = nodeLayer(li);
  if (!layer) return null;
  const polys = [], lines = [];
  /* L.Polygon extiende L.Polyline, así que el orden importa: lo que no
     es polígono pero sí polilínea es una forma ABIERTA (una línea
     importada, o una dibujada terminando fuera de un vértice) y tiene
     longitud aunque no tenga área.                                    */
  const scan = l => {
    if (l instanceof L.Polygon) polys.push(l);
    else if (l instanceof L.Polyline) lines.push(l);
    if (l.eachLayer) l.eachLayer(scan);
  };
  scan(layer);
  if (!polys.length && !lines.length) return null; /* nada que medir */
  let area = 0, perim = 0, allClosed = true;
  /* Una polilínea suma longitud pero NO toca `allClosed`: eso habla solo
     de si los anillos de los polígonos cierran. Un placemark KML puede
     traer un polígono y una línea juntos, y el área del polígono sigue
     siendo válida ahí.                                                */
  for (const line of lines) {
    const parts = line.getLatLngs();
    const rings = Array.isArray(parts[0]) ? parts : [parts];
    for (const ring of rings) perim += ringPerimeter(ring, false);
  }
  for (const poly of polys) {
    const rawParts = rawPolygonRings(poly.feature && poly.feature.geometry);
    polygonParts(poly.getLatLngs()).forEach((part, i) => {
      const rawRings = rawParts && rawParts[i]; /* anillos [lng,lat] del mismo polígono, en crudo */
      [part.outer, ...part.holes].forEach((ring, j) => {
        const raw = rawRings && rawRings[j];
        const closed = raw ? ringClosed(raw.map(([lng, lat]) => ({ lat, lng }))) : true;
        allClosed = allClosed && closed;
        perim += ringPerimeter(ring, closed);
      });
      /* El área se acumula siempre; se descarta al final si algún
         anillo no estaba cerrado, en vez de complicar el bucle con una
         salida anticipada.                                            */
      area += ringArea(part.outer) - part.holes.reduce((s, h) => s + ringArea(h), 0);
    });
  }
  /* Sin ningún polígono no hay área que dar: devolver 0 haría que la
     fila apareciera anunciando "0 m²" para una línea. `open` distingue
     "esto es una línea" de "esto es un polígono cuyo anillo no cierra":
     lo primero se mide en LONGITUD, no en perímetro.                  */
  return { area: polys.length && allClosed ? area : null, perim, open: !polys.length };
}

/* Una capa es "abierta" si tiene trazos y ninguno es un polígono
   cerrado. No puede tener área ni relleno: rellenar un trazo abierto
   obliga a Leaflet a cerrarlo por su cuenta para pintar la superficie,
   dibujando un lado que el usuario nunca trazó.                       */
function isOpenOnly(li) {
  const layer = nodeLayer(li);
  if (!layer) return false;
  let hasLine = false, hasPolygon = false;
  const scan = l => {
    if (l instanceof L.Polygon) hasPolygon = true;
    else if (l instanceof L.Polyline) hasLine = true;
    if (l.eachLayer) l.eachLayer(scan);
  };
  scan(layer);
  return hasLine && !hasPolygon;
}

/* ---------- Coordinate input formats ----------
   The dialog shows a position in one of two interchangeable notations:
   "dec" (decimal degrees) and "dms" (degrees, minutes and seconds with
   decimals). Parsing is deliberately permissive — it accepts either
   notation regardless of the selected one, with the sign given by a
   leading minus or by a hemisphere letter (N/S/E/W, plus the Spanish O
   for oeste) — so pasting a coordinate from anywhere just works.      */
/* Ajuste GLOBAL de latitud/longitud, elegido una vez en el panel
   Propiedades → Preferencias y persistente entre sesiones
   (dbSaveCoordFormat/dbLoadCoordFormat, 32-geojson.js): lo usan la
   lista de puntos de un polígono («Ver y editar…», pointsToText), el
   centro de un círculo en su diálogo (renderMeasureValues,
   44-dialogs.js) y la posición de un marcador en el suyo (renderCoords,
   44-dialogs.js) — antes esta última tenía su PROPIO toggle (`posFormat`,
   el botón ⇅ del diálogo de un marcador, de sesión y sin persistir);
   unificado a petición explícita, para que la notación se decida en un
   solo sitio. El rumbo no pasa por aquí: siempre en grados decimales,
   no es una coordenada.                                                */
let coordFormat = "dec";

function dmsParts(value, isLat) {
  const hemi = isLat ? (value < 0 ? "S" : "N") : (value < 0 ? "W" : "E");
  let rest = Math.round(Math.abs(value) * 360000) / 100; /* seconds, 2 dp */
  let d = Math.floor(rest / 3600); rest -= d * 3600;
  let m = Math.floor(rest / 60);
  let sec = Math.round((rest - m * 60) * 100) / 100;
  if (sec >= 60) { sec -= 60; m++; }        /* carries from the rounding */
  if (m >= 60) { m -= 60; d++; }
  return { d, m: String(m).padStart(2, "0"), sec: sec.toFixed(2).padStart(5, "0"), hemi };
}

function formatCoord(value, isLat, mode) {
  if (!isFinite(value)) return "";
  if (mode === "dms") {
    const { d, m, sec, hemi } = dmsParts(value, isLat);
    return `${d}\u00B0 ${m}' ${sec}" ${hemi}`;
  }
  return value.toFixed(6);
}

/* Compact GMS reading for the read-only coordinate readout (bottom-left
   box): no spaces between degrees/minutes/seconds/hemisphere, the way
   it's read on a nautical chart, with the degree figure in bold as the
   most-used field. HTML, not plain text \u2014 only for trusted, self-built
   content, never for `formatCoord`'s editable dialog fields.           */
function formatCoordCompactHtml(value, isLat) {
  if (!isFinite(value)) return "";
  const { d, m, sec, hemi } = dmsParts(value, isLat);
  return `<b>${d}\u00B0</b>${m}'${sec}"${hemi}`;
}

/* Separado de `parseCoord` (que rechaza en seco fuera de ±90/±180) para
   que quien tenga su PROPIA tolerancia de rango pueda usarlo sin que
   este rechazo se adelante al suyo — el editor de puntos («Ver y
   editar…») necesita justo eso: `clampLatLng` ya ajusta al límite lo
   que se pase por menos de COORD_EPS en vez de rechazarlo (ver
   «Coordenadas con tolerancia de redondeo»), y si `parseCoord`
   rechazara antes esa tolerancia nunca llegaría a aplicarse.           */
function parseCoordRaw(txt, isLat) {
  const t = String(txt).trim().toUpperCase().replace(/,/g, ".");
  if (!t) return NaN;
  const nums = t.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length > 3) return NaN;
  const v = nums.map(Number);
  if (v.some(n => !isFinite(n))) return NaN;
  if (v.length > 1 && (v[1] < 0 || v[1] >= 60)) return NaN;   /* minutes  */
  if (v.length > 2 && (v[2] < 0 || v[2] >= 60)) return NaN;   /* seconds  */
  const hemi = (t.match(/[NSEWO]/) || [])[0];
  if (hemi && (isLat !== "NS".includes(hemi))) return NaN;    /* N/S vs E/W/O */
  let deg = Math.abs(v[0]) + (v[1] || 0) / 60 + (v[2] || 0) / 3600;
  if (v[0] < 0 || (hemi && "SWO".includes(hemi))) deg = -deg;
  return deg;
}

function parseCoord(txt, isLat) {
  const deg = parseCoordRaw(txt, isLat);
  return isFinite(deg) && Math.abs(deg) <= (isLat ? 90 : 180) ? deg : NaN;
}

/* The single marker of a layer, or null when it has none or several:
   editing a position only makes sense for exactly one marker.        */
function soleMarker(li) {
  const layer = nodeLayer(li);
  if (!layer) return null;
  let found = null, count = 0;
  const scan = l => {
    if (l instanceof L.Marker) { found = l; count++; }
    if (l.eachLayer) l.eachLayer(scan);
  };
  scan(layer);
  return count === 1 ? found : null;
}

/* The single path (polygon or polyline) of a layer, or null when it has
   none or several: the point list edits one geometry, and with two
   shapes in the same layer there is no single list to show. Mirrors
   soleMarker, which does the same for the position of a marker.       */
function solePath(li) {
  const layer = nodeLayer(li);
  if (!layer) return null;
  let found = null, count = 0;
  const scan = l => {
    if (l instanceof L.Polyline) { found = l; count++; } /* cubre L.Polygon */
    if (l.eachLayer) l.eachLayer(scan);
  };
  scan(layer);
  return count === 1 ? found : null;
}

function setMarkerDraggable(mk, on) {
  mk.options.draggable = on;
  if (mk.dragging) { if (on) mk.dragging.enable(); else mk.dragging.disable(); }
}

/* ---------- Edición interactiva de vértices (arrastrar, borrar,
   seleccionar e insertar) ----------
   Complementa al editor de texto («Ver y editar…», sigue existiendo
   para listas grandes o ediciones masivas): mientras un ÚNICO polígono
   está seleccionado en el árbol —sin que haga falta abrir su diálogo de
   propiedades—, sus vértices se pueden arrastrar (Ctrl+arrastre, el
   mismo gesto reservado que ya usan las mediciones) y borrar (clic
   derecho), directamente sobre el mapa. A diferencia de la posición de
   un marcador, esto YA NO es edición diferida: cada arrastre o borrado
   se guarda al momento (scheduleSave), igual que ya hacía un waypoint
   de ruta — el diálogo de estilos, si está abierto a la vez, solo
   refleja los cambios (ver refreshOpenPolygonDialog más abajo).

   Por debajo del tope configurado (`vertexEditMax`, más abajo) se
   construyen manejadores; por encima, ninguno — demasiados manejadores
   son otros tantos nodos del DOM (los marcadores de Leaflet siempre lo
   son, nunca van por canvas, como ya advierte ELEV_ACCUM_MAX_CELLS) y
   el editor de texto ya cubre ese caso sin problema. Medido en el
   navegador (Chromium, construir los manejadores de un anillo
   sintético, sin la caché de geometría de por medio): 500 vértices,
   12-30 ms según la ejecución; 2000, ~85 ms; 4000, ~213 ms — el coste
   crece con N, y 500 (`VERTEX_EDIT_MAX_DEFAULT`) se queda cómodamente
   por debajo del umbral de "se siente instantáneo" (~100 ms) incluso
   con margen para un equipo más lento que esta VM de desarrollo. Pero
   es solo un PUNTO DE PARTIDA: cuánto tarda depende del hardware de
   quien lo usa, así que el tope es una preferencia editable (editor
   🏷️, ver el listener de `gnpVertexMaxInput` más abajo), no una
   constante fija.

   ---------- Selección de vértice (rutas Y polígonos) ----------
   Un único modelo para cualquier geometría de varios puntos: un clic
   (sin Ctrl) sobre un manejador lo SELECCIONA (`vertexOwner`/
   `vertexSelHandle`, más abajo); Mayús+clic en cualquier otro punto del
   mapa INSERTA un vértice justo después del seleccionado —o al final,
   si no hay ninguno—; Supr BORRA el seleccionado (con prioridad sobre
   el borrado de nodos del árbol, ver 41-selection.js). `vertexOwner` es
   quién decide qué significa "insertar"/"borrar" para su tipo de
   geometría (una ruta ya tiene sus manejadores siempre puestos; un
   polígono los construye/destruye aquí mismo, según la selección del
   árbol): ver syncVertexOwner, llamada desde selectNode/selectRange/
   toggleOne/clearSelection (30-tree-walk.js) y desde deleteNode
   (31-tree-node.js).

   ---------- Coherencia entre ruta y polígono ----------
   Las dos comparten exactamente el mismo modelo de arriba (clic
   selecciona, Ctrl+arrastre mueve, clic derecho borra, Mayús+clic
   inserta, Supr borra con prioridad), con la única diferencia real que
   les corresponde por naturaleza: los manejadores de una ruta son
   PERMANENTES (viven mientras la medición exista y esté marcada, no
   solo mientras esté seleccionada en el árbol — arrastrarlos o
   borrarlos ya funcionaba antes de que existiera "seleccionar vértice",
   y una ruta rara vez tiene más de una docena de waypoints porque se
   dibuja a mano, punto a punto), mientras que los de un polígono se
   CONSTRUYEN Y DESTRUYEN según la selección del árbol y el tope de
   vértices, porque un polígono sí puede llegar importado con miles de
   ellos. No es una asimetría por descuido: extender el tope a las
   rutas exigiría además un editor de texto equivalente al de un
   polígono, que hoy no tiene sentido para algo que casi nunca hace
   falta.

   ---------- Editor de texto (Ver y editar…) INHIBE la edición
   interactiva del mismo nodo ----------
   Las dos formas de editar la misma geometría en paralelo — arrastrar
   un vértice en el mapa mientras la lista de texto sigue mostrando su
   posición ANTERIOR — dejarían el texto desactualizado sin ningún
   aviso. Mientras `points-dialog` esté abierto para un nodo, sus
   manejadores se retiran (`openPointsDialog`/`closePointsDialog`, más
   abajo) y `syncVertexOwner` no los reconstruye para ese mismo nodo
   aunque siga siendo la única selección del árbol.                    */
const VERTEX_EDIT_MAX_DEFAULT = 500;
let vertexEditMax = VERTEX_EDIT_MAX_DEFAULT; /* preferencia, ver dbLoadVertexEditMax en 99-boot.js */

let vertexEdit = null;   /* { li, layer, rings, handleRings, nested, closed, group } o null */
let vertexOwner = null;  /* { kind: "route"|"polygon", li, hasHandle, insertAfter, removeVertex } o null */
let vertexSelHandle = null; /* manejador seleccionado dentro de vertexOwner, o null */
let vertexEditSnapshot = null; /* geometría al abrir el diálogo, para que Cancelar la restaure */

/* Copia independiente de una estructura de anillos (array de L.LatLng, o
   array de arrays): `rings` no debe compartir los objetos que Leaflet
   tiene en su _latlngs interno, o mutarlos aquí mutaría la capa a medias. */
function cloneLatLngRings(rings) {
  return rings.map(r => r.map(p => L.latLng(p.lat, p.lng)));
}

/* true si pudo construir los manejadores (y por tanto activar la
   edición interactiva), false si no hay trazo propio o supera el tope.
   Solo avisa en el segundo caso: sin trazo (varios trazos en la misma
   capa, o ninguno) no es un límite que se pueda subir, es un tipo de
   capa que este editor nunca ha cubierto — ya lo explica el `title` del
   propio botón «Ver y editar…» en el diálogo de estilos.              */
function beginVertexEdit(li) {
  const layer = solePath(li);
  if (!layer) return false;
  const { rings: liveRings, nested } = pathRings(layer);
  const total = liveRings.reduce((n, r) => n + r.length, 0);
  if (!total) return false;
  if (total > vertexEditMax) {
    navMessage(`«${li._name}» tiene ${total} vértices, por encima del tope configurado para `
      + `editarlos sobre el mapa (${vertexEditMax}). Usa «Ver y editar…» en su diálogo de estilos, `
      + "o sube el tope desde 🏷️ (Ventana de Propiedades).");
    return false;
  }
  const rings = cloneLatLngRings(liveRings);
  const group = L.featureGroup().addTo(rootGroup);
  const handleRings = rings.map(ring => ring.map(pos => {
    const h = makeHandle(pos, true);
    wireVertexEditHandle(h);
    group.addLayer(h);
    return h;
  }));
  vertexEdit = { li, layer, rings, handleRings, nested,
                 closed: layer instanceof L.Polygon, group };
  return true;
}

/* Vuelca vertexEdit.rings a la capa real y recalcula lo que enseña el
   diálogo (perímetro/área) SI está abierto mostrando este nodo — las
   mismas dos funciones que ya usa el editor de texto al aceptar, aquí
   en cada arrastre/borrado/inserción.                                 */
function applyVertexEditRings() {
  const { layer, rings, nested } = vertexEdit;
  layer.setLatLngs(nested || rings.length > 1 ? rings : rings[0]);
  invalidateGeo(vertexEdit.li);
  refreshOpenPolygonDialog(vertexEdit.li);
}

/* Convierte una capa de trazo entre L.Polygon y L.Polyline, con las
   MISMAS coordenadas (`latlngs`, un único anillo simple: cerrar/abrir
   solo tiene sentido con un anillo, sin agujeros ni multi-parte, ver
   sus dos llamadas). Leaflet no puede cambiar la clase de un L.Path en
   vivo, así que si hace falta se reconstruye la capa entera: mismo
   estilo (`layer.options`), mismo cableado de eventos que `makeNode` le
   dio la primera vez (`wireLayerEvents`, 31-tree-node.js), y ocupa el
   mismo sitio en `rootGroup` y en `chk._layer`. Si no hace falta cambiar
   de clase, solo actualiza las coordenadas de la capa que ya había —
   así sirve también para el revertido de Cancelar (ver
   restoreVertexSnapshot), que puede necesitar solo esto último.        */
function setPathLayerClosed(li, layer, closed, latlngs = pathRings(layer).rings[0]) {
  if ((layer instanceof L.Polygon) === closed) {
    layer.setLatLngs(latlngs);
    return layer;
  }
  const chk = li.querySelector(":scope > .node-row > input[type=checkbox]");
  const wasVisible = map.hasLayer(layer);
  const next = (closed ? L.polygon : L.polyline)(latlngs, layer.options);
  wireLayerEvents(li, next);
  rootGroup.removeLayer(layer);
  chk._layer = next;
  if (wasVisible) next.addTo(rootGroup);
  if (!closed) clearFillOnOpenPaths(next); /* una forma abierta no se rellena */
  applyPolygonText(li); /* lee nodeLayer(li) en fresco: ya ve `next` */
  invalidateGeo(li);
  return next;
}

/* Cierra o abre el anillo que se está editando ahora mismo, con la
   MISMA función de arriba, sobre las coordenadas EN VIVO del propio
   `vertexEdit` (no las de la capa, que solo se sincronizan al llamar a
   applyVertexEditRings).                                               */
function convertVertexEditShape(closed) {
  vertexEdit.layer = setPathLayerClosed(vertexEdit.li, vertexEdit.layer, closed, vertexEdit.rings[0]);
  vertexEdit.closed = closed;
}

/* Mayús+clic sobre el PRIMER vértice del anillo, con el ÚLTIMO
   seleccionado: cierra la forma en vez de insertar un vértice
   duplicado ahí mismo. Restringido a un único anillo simple —un
   polígono con agujeros o varias partes no cambia de naturaleza con
   este gesto, igual que ya limita el editor de texto («Ver y
   editar…»).                                                          */
function tryCloseAtFirstVertex(handle, e) {
  if (!e.originalEvent.shiftKey || !vertexEdit || vertexEdit.closed
      || vertexEdit.handleRings.length !== 1) return false;
  const ring = vertexEdit.handleRings[0];
  if (handle !== ring[0] || vertexSelHandle !== ring[ring.length - 1]) return false;
  if (ring.length < 3) {
    navMessage("Faltan vértices para cerrar el polígono (mínimo 3).");
    return true;
  }
  clearVertexSelection();
  convertVertexEditShape(true);
  applyVertexEditRings();
  scheduleSave();
  return true;
}

/* Busca en qué anillo/posición vive un manejador AHORA MISMO: no se
   captura el índice al crearlo porque borrar uno de en medio desplaza
   los que le siguen (mismo motivo que ya explica addPolyVertex).      */
function findVertexEditPos(handle) {
  for (let ri = 0; ri < vertexEdit.handleRings.length; ri++) {
    const pi = vertexEdit.handleRings[ri].indexOf(handle);
    if (pi !== -1) return [ri, pi];
  }
  return null;
}

function wireVertexEditHandle(handle) {
  /* Sin Ctrl: basta con arrastrar el manejador. attachVertexDrag
     gestiona map.dragging él solo mientras dura el arrastre, así que el
     mapa no compite por el gesto (52-measure.js).                     */
  attachVertexDrag(handle, false, latlng => {
    const pos = findVertexEditPos(handle);
    if (!pos) return;
    vertexEdit.rings[pos[0]][pos[1]] = latlng;
    applyVertexEditRings();
  }, scheduleSave);
  handle.on("contextmenu", ev => {
    L.DomEvent.stop(ev.originalEvent);
    removeVertexEditPoint(handle);
  });
  handle.on("click", e => {
    if (tryCloseAtFirstVertex(handle, e)) return;
    selectVertex(handle);
  });
}

/* Mismo mínimo que ya exige el editor de texto y el dibujo a mano: 3
   vértices por anillo cerrado, 2 en una forma abierta. En vivo: se
   guarda al momento, no hay ningún "Aceptar" que lo difiera.          */
function removeVertexEditPoint(handle) {
  const pos = findVertexEditPos(handle);
  if (!pos) return;
  const [ri, pi] = pos;
  /* Borrar el que dejaría un anillo cerrado por debajo de 3 lo ABRE en
     vez de bloquear el borrado — restringido a un único anillo simple,
     igual que cerrar (ver tryCloseAtFirstVertex): un contorno con
     agujeros no cambia de naturaleza por este gesto. La longitud sigue
     siendo 3 en este punto, así que el mínimo de abajo (ya en 2) no
     bloquea el borrado que sigue.                                      */
  if (vertexEdit.closed && vertexEdit.handleRings.length === 1 && vertexEdit.rings[ri].length === 3) {
    convertVertexEditShape(false);
    navMessage(`«${vertexEdit.li._name}» se ha abierto: por debajo de 3 vértices deja de ser un `
      + "polígono cerrado.");
  }
  const min = vertexEdit.closed ? 3 : 2;
  if (vertexEdit.rings[ri].length <= min) {
    navMessage(vertexEdit.closed
      ? "Faltan vértices para seguir siendo un polígono (mínimo 3 por anillo)."
      : "Faltan vértices para seguir siendo una línea (mínimo 2).");
    return;
  }
  if (vertexSelHandle === handle) clearVertexSelection();
  vertexEdit.rings[ri].splice(pi, 1);
  vertexEdit.handleRings[ri].splice(pi, 1);
  vertexEdit.group.removeLayer(handle);
  applyVertexEditRings();
  scheduleSave();
}

/* Inserta un vértice nuevo justo después de `handle` (o al final del
   primer anillo si `handle` es null: el caso normal de un polígono de
   un único anillo, sin agujeros — con varios, ambiguo por diseño, se
   escoge el primero). Devuelve el manejador nuevo, ya seleccionable. */
function insertVertexEditPoint(handle, latlng) {
  if (!vertexEdit) return null;
  let ri = 0, pi = vertexEdit.rings[0].length;
  if (handle) {
    const pos = findVertexEditPos(handle);
    if (pos) { ri = pos[0]; pi = pos[1] + 1; }
  }
  const pos2 = L.latLng(latlng.lat, latlng.lng);
  const h = makeHandle(pos2, true);
  wireVertexEditHandle(h);
  vertexEdit.rings[ri].splice(pi, 0, pos2);
  vertexEdit.handleRings[ri].splice(pi, 0, h);
  vertexEdit.group.addLayer(h);
  applyVertexEditRings();
  scheduleSave();
  return h;
}

/* Cierra la edición interactiva: solo retira los manejadores temporales
   (ya no hay nada que "cancelar" — los cambios ya están guardados).   */
function endVertexEdit() {
  if (!vertexEdit) return;
  rootGroup.removeLayer(vertexEdit.group);
  vertexEdit = null;
}

/* ---------- vertexOwner: qué geometría responde a seleccionar/insertar/
   borrar un vértice ahora mismo ----------
   Envuelve una ruta (sus manejadores viven siempre en el mapa, ligados
   a la medición) o un polígono (vertexEdit, construido/destruido aquí
   según si el diálogo de estilos está mostrando ese nodo). `li` es el
   nodo del árbol al que pertenece, para poder comparar contra
   `styleTargets`; una ruta guarda además `m` (la propia medición), que
   `wireRouteHandle` usa para comprobar por referencia, sin DOM, si un
   manejador concreto pertenece al owner activo (ver 52-measure.js).   */
function makeRouteVertexOwner(m, li) {
  return {
    kind: "route", li, m,
    hasHandle: h => m.handles.includes(h),
    /* Base para la tecla Insertar cuando no hay ningún vértice
       seleccionado: el mismo "al final" que ya usa insertAfter(null). */
    lastHandle: () => m.handles[m.handles.length - 1],
    /* El vecino que va a QUEDAR tras borrar `h`: el siguiente, o el
       anterior si `h` era el último — nunca apunta a un hueco. Se
       calcula ANTES de borrar (ver deleteSelectedVertex): el objeto
       que devuelve sigue siendo válido después, el borrado no lo toca.*/
    neighborOf: h => {
      const i = m.handles.indexOf(h);
      return i === -1 ? null : (m.handles[i + 1] || m.handles[i - 1] || null);
    },
    insertAfter: (h, latlng) => insertRouteWaypoint(m, h, latlng),
    removeVertex: h => removeRouteWaypoint(m, h)
  };
}
function makePolygonVertexOwner(li) {
  return {
    kind: "polygon", li,
    hasHandle: h => !!findVertexEditPos(h),
    /* Mismo criterio que insertVertexEditPoint(null, …): ambiguo con
       varios anillos por diseño, se toma el primero.                  */
    lastHandle: () => {
      const ring = vertexEdit.handleRings[0];
      return ring[ring.length - 1];
    },
    /* Mismo criterio que en una ruta, pero DENTRO del anillo de `h`: un
       polígono con agujeros o varias partes no puede "saltar" a otro
       anillo al elegir el vecino.                                     */
    neighborOf: h => {
      const pos = findVertexEditPos(h);
      if (!pos) return null;
      const [ri, pi] = pos;
      const ring = vertexEdit.handleRings[ri];
      return ring[pi + 1] || ring[pi - 1] || null;
    },
    insertAfter: (h, latlng) => insertVertexEditPoint(h, latlng),
    removeVertex: h => removeVertexEditPoint(h)
  };
}

function clearVertexSelection() {
  if (vertexSelHandle) {
    const el = vertexSelHandle.getElement();
    if (el) el.classList.remove("vertex-selected");
  }
  vertexSelHandle = null;
}

/* Selecciona un manejador DENTRO del vertexOwner activo. Un clic sobre
   un manejador que no pertenezca al owner actual (no debería darse: los
   manejadores de un polígono solo existen mientras es el owner) no hace
   nada, por seguridad.                                                */
function selectVertex(handle) {
  if (!vertexOwner || !vertexOwner.hasHandle(handle)) return;
  clearVertexSelection();
  vertexSelHandle = handle;
  const el = handle.getElement();
  if (el) el.classList.add("vertex-selected");
}

/* Retira el owner activo: deselecciona, destruye los manejadores del
   polígono si los hubiera (una ruta no tiene nada que destruir, sus
   manejadores son permanentes) y apaga el cursor de inserción.        */
function teardownVertexOwner() {
  clearVertexSelection();
  if (vertexOwner && vertexOwner.kind === "polygon") endVertexEdit();
  vertexOwner = null;
  map.getContainer().classList.remove("vertex-insert-cursor");
  refreshDoubleClickZoom(); /* 52-measure.js: puede que ya no haga falta seguir apagado */
}

/* Único punto de sincronización entre "qué muestra ahora mismo el
   diálogo de estilos" y "qué geometría responde a Mayús+clic/Supr
   sobre un vértice". BUG reportado: con el diseño anterior (ligado a
   la selección del árbol) se podía mover, insertar o borrar un
   vértice sin tener el diálogo de propiedades abierto — bastaba con
   tener el nodo como única selección. Ahora la única pregunta es
   `styleDialogShows(li)` (44-dialogs.js): sin diálogo abierto para
   exactamente este nodo, no hay owner, y por tanto ningún gesto de
   vértice hace nada — ni siquiera construir los manejadores de un
   polígono. Llamada al abrir/cerrar el diálogo de estilos
   (openStyleDialog/closeStyleDialog) y al cerrar el editor de texto
   de un polígono (closePointsDialog, que la reactiva si el diálogo de
   estilos sigue mostrando el mismo nodo).                             */
function syncVertexOwnerForDialog() {
  teardownVertexOwner();
  const li = styleTargets[0];
  if (!styleDialogShows(li)) return;
  /* El editor de texto («Ver y editar…») y la edición interactiva
     muestran la MISMA geometría por dos caminos distintos: con los dos
     activos a la vez para el mismo nodo, arrastrar un vértice en el
     mapa dejaría el texto ya abierto desactualizado sin ningún aviso.
     Mientras points-dialog siga mostrando este nodo, no se reconstruye
     — se restaura sola al cerrarlo (closePointsDialog llama aquí).    */
  if (styleKindOpen === "polygon" && !(pointsTarget && pointsTarget.li === li)) {
    if (beginVertexEdit(li)) vertexOwner = makePolygonVertexOwner(li);
  } else if (styleKindOpen === "measure" && li._measure && li._measure.type === "route"
      && !(pointsTarget && pointsTarget.li === li)) {
    vertexOwner = makeRouteVertexOwner(li._measure, li);
  }
  refreshDoubleClickZoom(); /* 52-measure.js: puede que haya que apagarlo ahora */
}

/* Foto de la geometría al abrir el diálogo de estilos, para que
   Cancelar pueda restaurarla (ver restoreVertexSnapshot): un polígono,
   una ruta o un círculo. Reportado como bug: mover/insertar/borrar un
   vértice, o Ctrl+arrastrar el centro/borde de un círculo, se guardaba
   al momento sin que "Cancelar" lo revirtiera — a diferencia del resto
   de campos del diálogo (edición diferida) y del propio arrastre del
   marcador (`posMarker`/`posOriginal`, 44-dialogs.js), cuyo patrón se
   sigue aquí igual. Llamada desde openStyleDialog, junto a
   syncVertexOwnerForDialog.                                            */
function captureVertexSnapshot() {
  const li = styleTargets[0];
  if (!styleDialogShows(li)) return null;
  if (styleKindOpen === "polygon") {
    const layer = solePath(li);
    if (!layer) return null;
    const { rings, nested } = pathRings(layer);
    return { kind: "polygon", li, closed: layer instanceof L.Polygon,
              nested, rings: cloneLatLngRings(rings) };
  }
  if (styleKindOpen === "measure" && li._measure) {
    const m = li._measure;
    if (m.type === "route") return { kind: "route", li, waypoints: m.handles.map(h => h.getLatLng()) };
    if (m.type === "circle") return { kind: "circle", li, origin: m.mOrigin.getLatLng(), dest: m.mDest.getLatLng() };
  }
  return null;
}

/* Restaura la foto anterior: llamada desde closeStyleDialog solo si se
   cancela. Vuelve a leer la capa/medición EN FRESCO (nodeLayer/
   li._measure), sin depender de vertexEdit —que closeStyleDialog ya ha
   desmontado, vía teardownVertexOwner, antes de llegar aquí— así que da
   igual cuántas veces se haya cerrado/abierto o movido de por medio.   */
function restoreVertexSnapshot(snap) {
  if (!snap) return;
  if (snap.kind === "polygon") {
    const layer = solePath(snap.li);
    if (!layer) return;
    /* Con varios anillos (agujero) nunca hay cambio de clase —el cierre/
       apertura está restringido a un único anillo simple, ver §3—, así
       que `coords` cae siempre en `rings[0]` en ese caso de todos modos:
       una sola llamada basta, sin el doble setLatLngs de antes.        */
    const coords = snap.nested || snap.rings.length > 1 ? snap.rings : snap.rings[0];
    setPathLayerClosed(snap.li, layer, snap.closed, coords);
    invalidateGeo(snap.li);
  } else if (snap.kind === "route") {
    const m = snap.li._measure;
    m.handles.forEach(h => m.group.removeLayer(h));
    m.legLabels.forEach(l => m.group.removeLayer(l));
    m.handles = snap.waypoints.map(p => makeHandle(p, true));
    m.handles.forEach(h => wireRouteHandle(m, h));
    m.legLabels = snap.waypoints.slice(1).map(() =>
      L.tooltip({ permanent: true, direction: "top", className: "measure-label" }));
    updateMeasurement(m);
    m.handles.forEach(h => m.group.addLayer(h));
    m.legLabels.forEach(l => m.group.addLayer(l));
  } else if (snap.kind === "circle") {
    const m = snap.li._measure;
    m.mOrigin.setLatLng(snap.origin);
    m.mDest.setLatLng(snap.dest);
    updateMeasurement(m);
  }
  scheduleSave();
}

/* Borra el vértice seleccionado (con el mínimo de cada owner, avisado
   por su propio removeVertex si no se puede). Llamado con prioridad
   desde el Supr del árbol — ver 41-selection.js.
   Reportado: tras borrar, no quedaba nada seleccionado, así que borrar
   varios vértices consecutivos exigía volver a hacer clic entre uno y
   otro. El vecino se calcula ANTES de borrar (`neighborOf`, el mismo
   objeto sigue siendo válido después) y solo se selecciona si el
   borrado se completó de verdad —`!vertexOwner.hasHandle(handle)`,
   la misma comprobación de siempre: si se bloqueó por el mínimo, no
   cambia nada—, con el mínimo por anillo/ruta (2 o 3) garantizando que
   `next` nunca es `null` en ese caso.                                 */
function deleteSelectedVertex() {
  if (!vertexOwner || !vertexSelHandle) return;
  const handle = vertexSelHandle;
  const next = vertexOwner.neighborOf(handle);
  vertexOwner.removeVertex(handle);
  if (!vertexOwner.hasHandle(handle)) {
    clearVertexSelection();
    if (next && vertexOwner.hasHandle(next)) selectVertex(next);
  }
}

/* Mayús+clic en el mapa (fuera de un manejador): inserta un vértice
   nuevo en el owner activo, después del seleccionado o al final si no
   hay ninguno (ver el tercer punto de la aclaración pedida al usuario),
   y selecciona el vértice recién creado.                              */
function insertVertexAfterSelected(latlng) {
  if (!vertexOwner) return;
  const h = vertexOwner.insertAfter(vertexSelHandle, latlng);
  if (h) selectVertex(h);
}

/* ---------- Moving the dialogs ----------
   Both property dialogs can be dragged by their title so they stop
   covering the part of the map being worked on. On the first drag the box
   switches to fixed positioning (until then it is placed by its wrapper:
   pinned top-right for the styles, centred for the picker) and from there
   it keeps whatever position the user left it in. Pointer events cover
   mouse, pen and touch with a single code path.                        */
function clampToViewport(box) {
  if (!box.style.left) return; /* never moved: the wrapper still places it */
  const r = box.getBoundingClientRect();
  const left = Math.min(Math.max(parseFloat(box.style.left), 60 - r.width), window.innerWidth - 60);
  const top = Math.min(Math.max(parseFloat(box.style.top), 0), window.innerHeight - 34);
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}

/* ---------- Accesibilidad de los diálogos ----------
   Each dialog announces itself as such, keeps the keyboard inside while
   it is open (Tab cycles through its own controls) and hands focus back
   to whatever opened it when it closes. Escape already closes them.  */
function setupDialog(box, { modal }) {
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", String(modal));
  const title = box.querySelector("h2");
  if (title) {
    if (!title.id) title.id = `dlg-title-${Math.random().toString(36).slice(2, 8)}`;
    box.setAttribute("aria-labelledby", title.id);
  }
  box.addEventListener("keydown", e => {
    if (e.key !== "Tab") return;
    const focusables = [...box.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });
}

/* Focus goes to the dialog on open and back to the opener on close */
let focusReturn = [];
function focusDialog(box) {
  focusReturn.push(document.activeElement);
  const first = box.querySelector("button, input, select");
  if (first) first.focus();
}
function releaseFocus() {
  const back = focusReturn.pop();
  if (back && back.isConnected && back.focus) back.focus();
}

function makeDialogMovable(box) {
  const handle = box.querySelector("h2");
  let from = null;
  handle.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    const r = box.getBoundingClientRect();
    box.style.position = "fixed";
    box.style.margin = "0";
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    from = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener("pointermove", e => {
    if (!from) return;
    box.style.left = `${from.left + e.clientX - from.x}px`;
    box.style.top = `${from.top + e.clientY - from.y}px`;
    clampToViewport(box);
  });
  for (const ev of ["pointerup", "pointercancel"]) {
    handle.addEventListener(ev, () => { from = null; });
  }
}

/* ---------- Colour picker (popover, one gesture, fully ours) ----------
   Used to be a full second modal window (its own Cancelar/Aceptar),
   stacked as a centred .dlg-overlay regardless of where the style
   dialog was — reported bug: it landed on top of the style dialog,
   nearly covering its own buttons. Fixed by turning it into a popover.

   That popover still used a native <input type="color"> for the full
   spectrum, and THAT was its own unfixable version of the same
   complaint: clicking it opens the browser's OWN colour panel, which
   lives outside our DOM entirely — no script can close it, reposition
   it, or make pressing "the big button" again dismiss it, because that
   panel was never ours to begin with. "One integrated dialog" cannot
   be true while part of it is a browser-native popup we don't control.
   So the spectrum is now two <canvas> elements (saturation/value, and
   hue) that we draw and handle ourselves, plus a text field — nothing
   here ever leaves our own DOM, so every close gesture (repeat the
   opening button, click outside, Escape) works on it exactly like on
   the rest of the popover.

   Reported bug (round 2): the popover had NO Cancelar/Aceptar of its
   own, so every gesture — a drag release, a swatch click, Enter in the
   text field — committed AND closed in one step. That contradicts the
   project's own deferred-editing rule: a change must never be final
   without the user choosing to make it so. Now dragging the spectrum,
   clicking a swatch or typing a value only PREVIEWS live on the actual
   edited element (`colorOnPreview`: the button's swatch, and for a
   marker's colour, its icon preview too) — nothing is saved. Saving
   only happens in `acceptColorPicker` (`colorOnCommit`), and every other
   way of leaving the popover (Cancelar, a click outside, repeating the
   opening button, Escape) is a discard: `cancelColorPicker` restores
   `colorOriginal`, the hex the target had when the popover opened.
   `openColorPicker`'s second argument lets a caller outside the style
   dialog (the base-map background colour, see 11-base-panel.js) supply
   its own preview/commit behaviour instead of touching styleDraft.    */
const COLOR_PRESETS = [
  "#000000", "#4d4d4d", "#8c8c8c", "#ffffff", "#1b5e97", "#3388ff", "#00a3c4", "#00897b",
  "#2e7d32", "#8bc34a", "#f9a825", "#ef6c00", "#b04a3a", "#d32f2f", "#8e24aa", "#5e35b1"
];
/* The four numeric notations the value fields can show, cycled with the
   ‹ › arrows — same idea as the ⇅ button that toggles a marker's
   coordinates between "dec" and "dms", generalised to more than two
   states. Purely a display/input preference: it does not change what
   gets picked, only how the current colour is split into fields.
   Each mode lists its channels: `label` (shown above the field and used
   in its `aria-label`) plus `min`/`max` for a numeric spinner, or
   `text: true` for Hex, which isn't a channel value. ONE INPUT PER
   CHANNEL on purpose — no separator ("255, 0, 0") to parse, so there is
   no parsing logic to keep in sync with what the fields can contain,
   and the browser's own number spinner (arrows, wheel, drag) works on
   each channel for free.                                              */
const COLOR_MODES = ["hex", "rgb", "cmyk", "hsv"];
const COLOR_MODE_LABELS = { hex: "HEX", rgb: "RGB", cmyk: "CMYK", hsv: "HSV" };
const COLOR_MODE_FIELDS = {
  hex: [{ label: "Hex", text: true }],
  rgb: [{ label: "R", min: 0, max: 255 }, { label: "G", min: 0, max: 255 }, { label: "B", min: 0, max: 255 }],
  cmyk: [{ label: "C", min: 0, max: 100 }, { label: "M", min: 0, max: 100 },
         { label: "Y", min: 0, max: 100 }, { label: "K", min: 0, max: 100 }],
  hsv: [{ label: "H", min: 0, max: 360 }, { label: "S", min: 0, max: 100 }, { label: "V", min: 0, max: 100 }]
};
const colorPicker = document.getElementById("color-picker");
const svCanvas = document.getElementById("color-sv");
const hueCanvas = document.getElementById("color-hue");
const svCtx = svCanvas.getContext("2d");
const hueCtx = hueCanvas.getContext("2d");
const colorPreview = document.getElementById("color-preview");
const colorModeLabel = document.getElementById("color-mode-label");
const colorFieldWraps = [0, 1, 2, 3].map(i => document.getElementById(`color-field-${i}`));
const colorFieldLabels = colorFieldWraps.map(w => w.querySelector(".color-field-label"));
const colorFieldEls = colorFieldWraps.map(w => w.querySelector("input"));
let colorTarget = null;    /* colour button being edited */
let colorOriginal = null;  /* its hex when the popover opened: what Cancelar restores */
let colorOnPreview = null; /* (btn, hex) => void — live, never persisted */
let colorOnCommit = null;  /* (btn, hex) => void — the actual save, only on Aceptar */
let colorMode = "hex";     /* current notation of the value fields; a per-session preference, not persisted */
let pickH = 210, pickS = 1, pickV = 1; /* current spectrum position, HSV */

function setColorButton(btn, hex) {
  btn.dataset.color = hex;
  btn.style.background = hex;
}
const colorOf = btn => btn.dataset.color || "#000000";

/* Default preview, for the style-dialog colour buttons: the swatch, the
   marker's icon preview and — live — the layer itself (`previewColorControl`,
   44-dialogs.js). Cancelling the popover re-runs this with the original
   hex, and the outer dialog's own "Cancelar" restores the snapshot.     */
function defaultColorPreview(btn, hex) {
  setColorButton(btn, hex);
  if (btn.id === "mk-color" && styleDraft) {
    document.getElementById("icon-preview").src = iconUrl(styleDraft.icon, hex, 20);
  }
  previewColorControl(btn, hex);
}
/* Default commit: the visual value is already there (defaultColorPreview
   put it there), so this only makes it part of the draft for real — the
   same touchControl()+readStyleControls() the old immediate commit did,
   just gated behind Aceptar instead of behind any single gesture.      */
function defaultColorCommit(btn) {
  touchControl(btn);
  if (styleDraft) readStyleControls();
}

function buildColorSwatches(current) {
  const box = document.getElementById("color-swatches");
  box.innerHTML = "";
  for (const hex of COLOR_PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.title = hex;
    b.style.background = hex;
    if (hex.toLowerCase() === current.toLowerCase()) b.classList.add("chosen");
    b.addEventListener("click", () => pickHex(hex));
    box.appendChild(b);
  }
}

/* ---- HSV <-> RGB <-> hex, just enough for the two canvases ---- */
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(n => n.toString(16).padStart(2, "0")).join("");
}
function hexToRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [1, 2, 3].map(i => parseInt(m[i], 16)) : [0, 0, 0];
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return [h < 0 ? h + 360 : h, max ? d / max : 0, max];
}
/* CMYK, the fourth notation offered in the text field: subtractive, and
   only meaningful for print — nothing downstream of the picker uses it,
   it exists purely as an input/reading convenience. The 0-100 range
   (not 0-1) matches how it is always quoted (e.g. "0, 100, 100, 0").  */
function rgbToCmyk(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k]
    .map(v => Math.round(v * 100));
}
function cmykToRgb(c, m, y, k) {
  c /= 100; m /= 100; y /= 100; k /= 100;
  return [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)]
    .map(v => Math.round(v));
}
const clamp01 = n => Math.min(1, Math.max(0, n));

function drawHue() {
  const w = hueCanvas.width, h = hueCanvas.height;
  const grad = hueCtx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${i * 60}, 100%, 50%)`);
  hueCtx.fillStyle = grad;
  hueCtx.fillRect(0, 0, w, h);
  const x = (pickH / 360) * w;
  hueCtx.strokeStyle = "#fff"; hueCtx.lineWidth = 2; hueCtx.strokeRect(x - 2, 0, 4, h);
  hueCtx.strokeStyle = "rgba(0,0,0,.4)"; hueCtx.lineWidth = 1; hueCtx.strokeRect(x - 2.5, 0.5, 5, h - 1);
}
/* The square's own base colour is the pure hue at full saturation/value;
   a white-to-transparent wash left-to-right gives saturation, a
   transparent-to-black wash top-to-bottom gives value — the standard
   construction for this widget, done with two overlaid gradients.    */
function drawSv() {
  const w = svCanvas.width, h = svCanvas.height;
  const [r, g, b] = hsvToRgb(pickH, 1, 1);
  svCtx.fillStyle = `rgb(${r},${g},${b})`;
  svCtx.fillRect(0, 0, w, h);
  let grad = svCtx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#fff"); grad.addColorStop(1, "rgba(255,255,255,0)");
  svCtx.fillStyle = grad; svCtx.fillRect(0, 0, w, h);
  grad = svCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(1, "#000");
  svCtx.fillStyle = grad; svCtx.fillRect(0, 0, w, h);
  const mx = pickS * w, my = (1 - pickV) * h;
  svCtx.beginPath(); svCtx.arc(mx, my, 5, 0, Math.PI * 2);
  svCtx.strokeStyle = "#fff"; svCtx.lineWidth = 2; svCtx.stroke();
  svCtx.strokeStyle = "rgba(0,0,0,.4)"; svCtx.lineWidth = 1; svCtx.stroke();
}
function currentHex() { return rgbToHex(...hsvToRgb(pickH, pickS, pickV)); }
/* Writes the current HSV position into whichever fields the active mode
   uses. Kept apart from the fields' OWN `input` handler (below) because
   an external pick (a swatch, a spectrum drag, switching mode) is the
   only time the fields should be overwritten wholesale — doing it on
   every keystroke while the user is typing INTO one of them would fight
   the caret (see the comment on `colorFieldEls` `input` below).       */
function writeFieldsToMode() {
  const [r, g, b] = hsvToRgb(pickH, pickS, pickV);
  const values = colorMode === "hex" ? [rgbToHex(r, g, b)]
    : colorMode === "rgb" ? [r, g, b]
    : colorMode === "cmyk" ? rgbToCmyk(r, g, b)
    : [Math.round(pickH), Math.round(pickS * 100), Math.round(pickV * 100)]; /* hsv */
  values.forEach((v, i) => { colorFieldEls[i].value = v; });
}
function refreshPreview() {
  const hex = currentHex();
  colorPreview.style.background = hex;
  writeFieldsToMode();
  return hex;
}
function setFromHex(hex) {
  [pickH, pickS, pickV] = rgbToHsv(...hexToRgb(hex));
  drawHue(); drawSv(); refreshPreview();
}
/* ‹ › cycle through COLOR_MODES; wraps both ways. Switching notation
   never changes the colour, only how many fields show and what they
   mean — a preference, not state, same as `colorMode` itself. Fields
   the mode doesn't use are hidden, not removed: `COLOR_MODE_FIELDS`
   always describes the first N of the four, so the rest just stay
   `hidden`.                                                          */
function setColorMode(mode) {
  colorMode = mode;
  colorModeLabel.textContent = COLOR_MODE_LABELS[mode];
  const fields = COLOR_MODE_FIELDS[mode];
  colorFieldWraps.forEach((wrap, i) => {
    const f = fields[i];
    wrap.hidden = !f;
    if (!f) return;
    colorFieldLabels[i].textContent = f.label;
    const el = colorFieldEls[i];
    el.setAttribute("aria-label", `${f.label} (${COLOR_MODE_LABELS[mode]})`);
    if (f.text) { el.type = "text"; el.removeAttribute("min"); el.removeAttribute("max"); el.maxLength = 7; }
    else { el.type = "number"; el.min = f.min; el.max = f.max; el.step = 1; el.removeAttribute("maxlength"); }
  });
  writeFieldsToMode();
}
function cycleColorMode(delta) {
  const i = COLOR_MODES.indexOf(colorMode);
  setColorMode(COLOR_MODES[(i + delta + COLOR_MODES.length) % COLOR_MODES.length]);
}
document.getElementById("color-mode-prev").addEventListener("click", () => cycleColorMode(-1));
document.getElementById("color-mode-next").addEventListener("click", () => cycleColorMode(1));

/* Picking a colour (a swatch, a spectrum drag, a confirmed field value)
   only moves the spectrum position and PREVIEWS on the actual target —
   see the comment atop this section. It never closes the popover and
   never calls `colorOnCommit`: that only happens in `acceptColorPicker`. */
function pickHex(hex) {
  setFromHex(hex);
  if (colorTarget && colorOnPreview) colorOnPreview(colorTarget, hex);
}

/* Drag on either canvas: pointer capture so the gesture keeps tracking
   even if the cursor leaves the small canvas mid-drag (same technique
   as makeDialogMovable's title-bar drag). Every move previews live —
   there is no separate "commit on release" step any more, since NO
   gesture on the spectrum commits: only Aceptar does.                */
function wireSpectrumDrag(canvas, onMove) {
  let dragging = false;
  const step = e => {
    const r = canvas.getBoundingClientRect();
    onMove(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
  };
  canvas.addEventListener("pointerdown", e => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    step(e);
  });
  canvas.addEventListener("pointermove", e => { if (dragging) step(e); });
  const stop = () => { dragging = false; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
}
function livePreview() {
  const hex = refreshPreview();
  if (colorTarget && colorOnPreview) colorOnPreview(colorTarget, hex);
  return hex;
}
wireSpectrumDrag(svCanvas, (x, y) => { pickS = x; pickV = 1 - y; drawSv(); livePreview(); });
wireSpectrumDrag(hueCanvas, x => { pickH = x * 360; drawHue(); drawSv(); livePreview(); });

/* Reads the CURRENTLY VISIBLE fields for the active mode straight into a
   hex colour — no separator to split, each channel comes from its own
   `<input>.value`. `null` means "incomplete or out of range", which is
   the normal state of a field mid-edit (e.g. empty right after
   Ctrl+A+Delete) and is not an error to report, just "not ready yet". */
function readFieldsToHex() {
  const fields = COLOR_MODE_FIELDS[colorMode];
  if (colorMode === "hex") {
    const v = colorFieldEls[0].value.trim().toLowerCase();
    return /^#?[0-9a-f]{6}$/.test(v) ? (v[0] === "#" ? v : "#" + v) : null;
  }
  const nums = fields.map((f, i) => {
    const n = Number(colorFieldEls[i].value);
    return colorFieldEls[i].value !== "" && isFinite(n) && n >= f.min && n <= f.max ? n : null;
  });
  if (nums.some(n => n === null)) return null;
  if (colorMode === "rgb") return rgbToHex(...nums);
  if (colorMode === "cmyk") return rgbToHex(...cmykToRgb(...nums));
  return rgbToHex(...hsvToRgb(nums[0], nums[1] / 100, nums[2] / 100)); /* hsv */
}
/* Fires on every keystroke, arrow-key nudge and wheel/drag tick of a
   number field's native spinner: previews the SPECTRUM AND SWATCH from
   whatever is currently typed, but deliberately does NOT call
   `writeFieldsToMode()` (unlike every other pick above) — that would
   overwrite the very field the user is mid-typing with a "cleaned up"
   value on each keystroke, which resets the caret to the end and makes
   typing a multi-digit number fight the input. The fields only get
   rewritten wholesale by an EXTERNAL pick (swatch, drag, mode switch).  */
function onFieldInput() {
  const hex = readFieldsToHex();
  if (!hex) return;
  [pickH, pickS, pickV] = rgbToHsv(...hexToRgb(hex));
  drawHue(); drawSv();
  colorPreview.style.background = hex;
  if (colorTarget && colorOnPreview) colorOnPreview(colorTarget, hex);
}
/* Enter (or leaving the field) normalises what's shown — e.g. filling in
   a leading "#", or snapping an out-of-range/incomplete value back to
   the last good one — same role `commitColorHex` used to play for the
   single text field. Nothing here closes the popover: only Aceptar does,
   so there is no `.blur()`-triggered reentrancy to worry about either. */
function commitFields() {
  const hex = readFieldsToHex();
  if (hex) pickHex(hex); else writeFieldsToMode();
}
colorFieldEls.forEach(el => {
  el.addEventListener("input", onFieldInput);
  el.addEventListener("change", commitFields);
  el.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    commitFields();
  });
});

/* Anchored to the button that opened it, not centred on the viewport:
   below it by default, flipped above when there is no room below, and
   clamped so it never runs off either edge. Measuring offsetWidth/Height
   needs the element laid out first, so `hidden` comes off before this
   runs — same tick, so nothing visibly flashes at the wrong spot.
   Gaining its own Cancelar/Aceptar (and the notation row) made the
   popover tall enough to reach down past the WINDOW edge check and
   into the host dialog's own sticky Aceptar/Cancelar bar — the exact
   overlap this popover exists to avoid (see the original centred-modal
   bug in CLAUDE.md). So "room below" is capped not just by the window
   but by that bar's top too, when the button lives inside one.       */
function positionColorPicker(btn) {
  const r = btn.getBoundingClientRect();
  const w = colorPicker.offsetWidth, h = colorPicker.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - w - 8);
  left = Math.max(left, 8);
  const hostBox = btn.closest(".dlg-box");
  const hostActions = hostBox && hostBox.querySelector(".dlg-actions");
  const limit = Math.min(window.innerHeight - 8,
    hostActions ? hostActions.getBoundingClientRect().top - 6 : Infinity);
  let top = r.bottom + 6;
  if (top + h > limit) top = r.top - h - 6;
  top = Math.max(top, 8);
  colorPicker.style.left = `${left}px`;
  colorPicker.style.top = `${top}px`;
}

function openColorPicker(btn, { onPreview = defaultColorPreview, onCommit = defaultColorCommit } = {}) {
  colorTarget = btn;
  colorOriginal = colorOf(btn);
  colorOnPreview = onPreview;
  colorOnCommit = onCommit;
  setFromHex(colorOriginal);
  buildColorSwatches(colorOriginal);
  setColorMode(colorMode); /* re-format the field for whatever notation was left selected */
  colorPicker.hidden = false;
  positionColorPicker(btn);
  focusDialog(colorPicker);
}
/* Pure cleanup: hides the popover and drops its state. Never decides by
   itself whether the pending colour is kept or discarded — that is
   `acceptColorPicker`'s or `cancelColorPicker`'s job, always called
   first.                                                              */
function closeColorPicker() {
  colorPicker.hidden = true;
  colorTarget = null;
  colorOnPreview = null;
  colorOnCommit = null;
  releaseFocus();
}
/* The only gesture that makes a colour final. */
function acceptColorPicker() {
  if (colorTarget && colorOnCommit) colorOnCommit(colorTarget, currentHex());
  closeColorPicker();
}
/* Every other way of leaving the popover is a discard: restore the hex
   the target had when it opened (`colorOnPreview`, the same function
   that applied every live preview, undoes them the same way) and close
   without ever calling `colorOnCommit`.                               */
function cancelColorPicker() {
  if (colorTarget && colorOnPreview) colorOnPreview(colorTarget, colorOriginal);
  closeColorPicker();
}
document.getElementById("color-accept").addEventListener("click", acceptColorPicker);
document.getElementById("color-cancel").addEventListener("click", cancelColorPicker);
/* The button itself is a close gesture too: pulsing the same swatch
   that opened the popover closes it again — as a CANCEL, same as
   Escape or a click outside, not as an accept. "Click outside" (below)
   is a convenience on top of this, not a replacement for it.          */
function toggleColorPicker(btn, opts) {
  if (!colorPicker.hidden && colorTarget === btn) { cancelColorPicker(); return; }
  openColorPicker(btn, opts);
}
/* Closing without accepting: click outside the popover and outside the
   button that opened it (so re-clicking that same button hits the
   toggle branch above instead of closing-then-reopening).
   "click", not "mousedown": a control marked with
   L.DomEvent.disableClickPropagation (the base-maps panel, the
   measure/view toolbars…) stops mousedown/dblclick/contextmenu from
   reaching the map — but NOT plain click, which Leaflet leaves alone
   (see clickOnControl's comment in 52-measure.js for the same trap hit
   before). The colour button of the map-background row lives inside
   exactly such a panel, so a mousedown listener here never saw a click
   anywhere in that panel — reported bug: opening the popover from that
   button and then clicking elsewhere in the SAME panel couldn't close
   it with the mouse at all, only Escape did.                          */
document.addEventListener("click", e => {
  if (colorPicker.hidden) return;
  if (colorPicker.contains(e.target)) return;
  if (colorTarget && colorTarget.contains(e.target)) return;
  cancelColorPicker();
});
for (const id of ["mk-color", "mk-text-color", "pg-color", "pg-fill-color",
                  "ms-color", "ms-fill-color"]) {
  document.getElementById(id).addEventListener("click", e => {
    e.preventDefault();
    toggleColorPicker(e.currentTarget);
  });
}

/* ---------- Confirmar la limpieza de etiquetas HTML en nombres KML ----------
   Mismo patrón que el selector de nombre de GeoJSON justo debajo: una
   Promise que addFileNode espera antes de seguir. "Dejarlas" resuelve
   con false (nombres tal cual); "Eliminarlas" con true.                */
const ktpDialog = document.getElementById("kml-tags-picker");
const ktpBox = ktpDialog.querySelector(".dlg-box");
const ktpIntro = document.getElementById("ktp-intro");
const ktpTitle = document.getElementById("ktp-title");
let ktpResolve = null;
function closeKtpPicker(result) {
  ktpDialog.hidden = true;
  const resolve = ktpResolve;
  ktpResolve = null;
  releaseFocus();
  if (resolve) resolve(result);
}
/* `kind` distingue los dos llamantes: los <name> de un KML y las
   `properties` de un GeoJSON. El diálogo es el mismo —mismo problema,
   misma decisión del usuario— y solo cambia de qué habla.            */
const KTP_WORDING = {
  names: { titulo: "Etiquetas en los nombres", donde: "nombres", origen: "el KML" },
  properties: { titulo: "Etiquetas en las propiedades", donde: "propiedades", origen: "el archivo" }
};
function confirmStripHtmlTags(fileName, kind = "names") {
  const w = KTP_WORDING[kind] || KTP_WORDING.names;
  ktpTitle.textContent = w.titulo;
  ktpIntro.textContent = `«${fileName}» tiene ${w.donde} con etiquetas de tipo HTML `
    + `(texto entre «<» y «>»), probablemente restos de la herramienta que generó `
    + `${w.origen}. ¿Eliminarlas al importar?`;
  ktpDialog.hidden = false;
  clampToViewport(ktpBox);
  focusDialog(ktpBox);
  return new Promise(resolve => { ktpResolve = resolve; });
}
document.getElementById("ktp-cancel").addEventListener("click", () => closeKtpPicker(false));
document.getElementById("ktp-accept").addEventListener("click", () => closeKtpPicker(true));

/* ---------- Confirmar la fusión de placemarks duplicados ----------
   Mismo patrón que el diálogo anterior. "Mantener todos" resuelve con
   false; "Fusionar" con true.                                         */
const kdpDialog = document.getElementById("kml-dup-picker");
const kdpBox = kdpDialog.querySelector(".dlg-box");
const kdpIntro = document.getElementById("kdp-intro");
let kdpResolve = null;
function closeKdpPicker(result) {
  kdpDialog.hidden = true;
  const resolve = kdpResolve;
  kdpResolve = null;
  releaseFocus();
  if (resolve) resolve(result);
}
function confirmMergeDuplicates(fileName, groups) {
  const total = groups.reduce((n, g) => n + g.length - 1, 0);
  /* "s", no "es": el plural se pega a «nombre» y a «repetido», no a
     «marcador(es)». Decía «2 nombrees repetidoes».                    */
  const plural = groups.length === 1 ? "" : "s";
  kdpIntro.textContent = `«${fileName}» tiene ${groups.length} nombre${plural} repetido${plural} `
    + `con la misma posición (${total} marcador(es) de más). ¿Fusionarlos y mantener solo uno de cada grupo?`;
  kdpDialog.hidden = false;
  clampToViewport(kdpBox);
  focusDialog(kdpBox);
  return new Promise(resolve => { kdpResolve = resolve; });
}
document.getElementById("kdp-cancel").addEventListener("click", () => closeKdpPicker(false));
document.getElementById("kdp-accept").addEventListener("click", () => closeKdpPicker(true));

/* ---------- Elegir la propiedad-nombre de un GeoJSON ambiguo ----------
   addFileNode es async y necesita ESPERAR la elección antes de seguir
   construyendo el árbol: mismo patrón que el diálogo anterior, una
   Promise en vez de eventos sueltos. Cancelar resuelve con null
   (nombrado automático de siempre, nada se guarda); Aceptar resuelve
   con la clave marcada.                                              */
const gnpDialog = document.getElementById("geojson-name-picker");
const gnpBox = gnpDialog.querySelector(".dlg-box");
const gnpList = document.getElementById("gnp-list");
const gnpIntro = document.getElementById("gnp-intro");
let gnpResolve = null;

function gnpPreview(v) {
  const s = stringifyPropValue(v);
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}

function closeGnpPicker(result) {
  gnpDialog.hidden = true;
  const resolve = gnpResolve;
  gnpResolve = null;
  releaseFocus();
  if (resolve) resolve(result);
}

function pickNameProperty(props, fileName, storedKey) {
  const keys = Object.keys(props);
  gnpIntro.textContent = storedKey
    ? `Para archivos con esta misma estructura de propiedades se guardó «${storedKey}» como nombre. Confirma o elige otra:`
    : `«${fileName}» no tiene una propiedad «name» ni «title». Elige cuál usar como nombre:`;
  gnpList.innerHTML = "";
  keys.forEach((k, i) => {
    const checked = storedKey ? k === storedKey : i === 0;
    const row = document.createElement("label");
    row.className = "gnp-row";
    row.innerHTML = `<input type="radio" name="gnp-key" value="${escapeHtml(k)}"${checked ? " checked" : ""}>`
      + `<span class="gnp-key">${escapeHtml(k)}</span>`
      + `<span class="gnp-val">${escapeHtml(gnpPreview(props[k]))}</span>`;
    gnpList.appendChild(row);
  });
  gnpDialog.hidden = false;
  clampToViewport(gnpBox);
  focusDialog(gnpBox);
  return new Promise(resolve => { gnpResolve = resolve; });
}
document.getElementById("gnp-cancel").addEventListener("click", () => closeGnpPicker(null));
document.getElementById("gnp-accept").addEventListener("click", () => {
  const checked = gnpList.querySelector("input[name=gnp-key]:checked");
  closeGnpPicker(checked ? checked.value : null);
});

/* ---------- Style dialog (single instance, deferred editing) ----------
   Nothing is applied to the map while the dialog is open: the controls
   write into `styleDraft`, and only "Aceptar" copies the draft into every
   target and repaints. "Cancelar" drops the draft, so the layers keep the
   style they had when the dialog was opened (including the icon).      */
const styleDialog = document.getElementById("style-dialog");
const iconPicker = document.getElementById("icon-picker");
const $id = id => document.getElementById(id);
const styleBox = styleDialog.querySelector(".dlg-box");
const iconBox = iconPicker.querySelector(".dlg-box");
/* No colorBox: the colour popover (#color-picker) IS its own box now,
   not a wrapper around a nested .dlg-box — see openColorPicker.      */
const shortcutsDialog = document.getElementById("shortcuts");
const shortcutsBox = shortcutsDialog.querySelector(".dlg-box");
/* Cuatro pestañas para no tener que scrollear una única tabla larga
   (reportado: la ayuda ocupaba demasiada pantalla). Mismo lenguaje
   visual que las pestañas de Propiedades (.dlg-tabs/.dlg-tab), pero con
   un mapa en vez de dos booleanos hardcodeados: aquí son cuatro.       */
const shTabs = {
  nav: [document.getElementById("sh-tab-btn-nav"), document.getElementById("sh-tab-nav")],
  act: [document.getElementById("sh-tab-btn-act"), document.getElementById("sh-tab-act")],
  view: [document.getElementById("sh-tab-btn-view"), document.getElementById("sh-tab-view")],
  draw: [document.getElementById("sh-tab-btn-draw"), document.getElementById("sh-tab-draw")]
};
function showShortcutsTab(tab) {
  for (const [key, [btn, panel]] of Object.entries(shTabs)) {
    const active = key === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
    panel.hidden = !active;
  }
}
for (const key of Object.keys(shTabs)) shTabs[key][0].addEventListener("click", () => showShortcutsTab(key));
function toggleShortcuts() {
  shortcutsDialog.hidden = !shortcutsDialog.hidden;
  if (!shortcutsDialog.hidden) {
    showShortcutsTab("nav"); /* no se queda en la última pestaña vista la vez anterior */
    clampToViewport(shortcutsBox);
    focusDialog(shortcutsBox);
  } else releaseFocus();
}
document.getElementById("shortcuts-close").addEventListener("click", toggleShortcuts);
document.getElementById("help-btn").addEventListener("click", toggleShortcuts);

/* ---------- Panel de Propiedades: nombres de GeoJSON + preferencias ----------
   Antes "gnp-editor" (aplicación inmediata, solo nombres recordados de
   GeoJSON, sin pestañas). Ahora agrupa también los ajustes GLOBALES que
   antes vivían sueltos —unidad de medida y formato de coordenadas, dos
   <select> redundantes repetidos en los diálogos de polígono/medición,
   sin persistir entre sesiones— y pasa a seguir la edición diferida del
   resto de la aplicación: los controles previsualizan en vivo (aplicando
   measureUnit/coordFormat/vertexEditMax de verdad, porque son ajustes
   globales y "probarlos" significa verlos aplicados en el mapa) pero
   solo Aceptar los persiste en IndexedDB; Cancelar deshace exactamente
   esa previsualización, con los valores que había al abrir el panel.   */
const propsDialog = document.getElementById("props-dialog");
const propsBox = propsDialog.querySelector(".dlg-box");
const gnpEditorList = document.getElementById("gnp-editor-list");
const propsTabGnpBtn = document.getElementById("props-tab-btn-gnp");
const propsTabPrefsBtn = document.getElementById("props-tab-btn-prefs");
const propsTabGnp = document.getElementById("props-tab-gnp");
const propsTabPrefs = document.getElementById("props-tab-prefs");
const propsUnitSelect = document.getElementById("props-unit");
const propsCoordFormatSelect = document.getElementById("props-coord-format");
const gnpVertexMaxInput = document.getElementById("gnp-vertex-max");

let propsDraftGnp = null; /* clon de gnpStore mientras el panel está abierto */
let propsOriginal = null; /* {unit, coordFormat, vertexEditMax} al abrir, para Cancelar */

function showPropsTab(tab) {
  const isGnp = tab === "gnp";
  propsTabGnpBtn.classList.toggle("active", isGnp);
  propsTabPrefsBtn.classList.toggle("active", !isGnp);
  propsTabGnpBtn.setAttribute("aria-selected", String(isGnp));
  propsTabPrefsBtn.setAttribute("aria-selected", String(!isGnp));
  propsTabGnp.hidden = !isGnp;
  propsTabPrefs.hidden = isGnp;
}
propsTabGnpBtn.addEventListener("click", () => showPropsTab("gnp"));
propsTabPrefsBtn.addEventListener("click", () => showPropsTab("prefs"));

function renderGnpEditor() {
  gnpEditorList.innerHTML = "";
  const entries = Object.entries(propsDraftGnp || {});
  if (!entries.length) {
    const p = document.createElement("p");
    p.className = "dlg-hint";
    p.textContent = "Sin asociaciones guardadas todavía.";
    gnpEditorList.appendChild(p);
    return;
  }
  for (const [fp, value] of entries) {
    let keys;
    try { keys = JSON.parse(fp); } catch { keys = [fp]; }
    const row = document.createElement("div");
    row.className = "gnp-editor-row";
    const keysSpan = document.createElement("span");
    keysSpan.className = "gnp-editor-keys";
    keysSpan.textContent = keys.join(", ");
    keysSpan.title = keysSpan.textContent;
    const select = document.createElement("select");
    for (const k of keys) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k;
      if (k === value) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => { propsDraftGnp[fp] = select.value; });
    const del = document.createElement("button");
    del.className = "btn";
    del.textContent = "Borrar";
    del.addEventListener("click", () => {
      delete propsDraftGnp[fp];
      renderGnpEditor();
    });
    row.append(keysSpan, select, del);
    gnpEditorList.appendChild(row);
  }
}
document.getElementById("gnp-editor-clear").addEventListener("click", () => {
  propsDraftGnp = {};
  renderGnpEditor();
});

function renderPropsPrefsTab() {
  propsUnitSelect.value = measureUnit;
  propsCoordFormatSelect.value = coordFormat;
  gnpVertexMaxInput.value = vertexEditMax;
}
propsUnitSelect.addEventListener("change", () => setMeasureUnit(propsUnitSelect.value));
propsCoordFormatSelect.addEventListener("change", () => {
  coordFormat = propsCoordFormatSelect.value;
  renderMeasureValues();
  /* El diálogo de propiedades de un marcador también sigue este ajuste
     (ver el comentario largo de coordFormat, más abajo): si está
     abierto mostrando su posición, se repinta al momento igual que el
     centro de un círculo.                                             */
  if (styleDraft && posMarker) renderCoords();
});
/* Tope de vértices editables interactivamente (ver el comentario largo
   junto a VERTEX_EDIT_MAX_DEFAULT): `change`, no `input`, porque aplicar
   a cada pulsación mientras se teclea dejaría el tope en un valor a
   medio escribir la mayor parte del tiempo. Un valor inválido (vacío,
   cero, negativo) se descarta y el campo vuelve al que sigue vigente.  */
gnpVertexMaxInput.addEventListener("change", () => {
  const n = Math.trunc(Number(gnpVertexMaxInput.value));
  if (!Number.isFinite(n) || n < 1) { gnpVertexMaxInput.value = vertexEditMax; return; }
  vertexEditMax = n;
  gnpVertexMaxInput.value = n;
  /* Si el nodo cuyo diálogo está abierto es justo un polígono que este
     cambio acaba de poner por debajo (o por encima) del tope, que se
     note al momento: syncVertexOwnerForDialog ya empieza retirando
     cualquier owner activo antes de reevaluar, así que basta con
     llamarla de nuevo.                                                */
  syncVertexOwnerForDialog();
});

async function togglePropsDialog() {
  if (!propsDialog.hidden) { cancelPropsDialog(); return; }
  if (!gnpStore) gnpStore = await dbLoadGnp();
  propsDraftGnp = { ...gnpStore };
  propsOriginal = { unit: measureUnit, coordFormat, vertexEditMax };
  renderGnpEditor();
  renderPropsPrefsTab();
  showPropsTab("prefs");
  propsDialog.hidden = false;
  clampToViewport(propsBox);
  focusDialog(propsBox);
}
document.getElementById("gnp-editor-btn").addEventListener("click", togglePropsDialog);

function cancelPropsDialog() {
  if (propsDialog.hidden) return;
  propsDialog.hidden = true;
  releaseFocus();
  if (!propsOriginal) return;
  /* Deshace la previsualización en vivo con el mismo camino que la aplicó. */
  if (propsOriginal.unit !== measureUnit) setMeasureUnit(propsOriginal.unit);
  if (propsOriginal.coordFormat !== coordFormat) {
    coordFormat = propsOriginal.coordFormat;
    renderMeasureValues();
    if (styleDraft && posMarker) renderCoords();
  }
  if (propsOriginal.vertexEditMax !== vertexEditMax) {
    vertexEditMax = propsOriginal.vertexEditMax;
    syncVertexOwnerForDialog();
  }
  propsDraftGnp = null;
  propsOriginal = null;
}
document.getElementById("props-cancel").addEventListener("click", cancelPropsDialog);
document.getElementById("props-accept").addEventListener("click", () => {
  if (propsDialog.hidden) return;
  gnpStore = propsDraftGnp || {};
  dbSaveGnp(gnpStore);
  dbSaveMeasureUnit(measureUnit);
  dbSaveCoordFormat(coordFormat);
  dbSaveVertexEditMax(vertexEditMax);
  propsDialog.hidden = true;
  releaseFocus();
  propsDraftGnp = null;
  propsOriginal = null;
});

/* ---------- Diálogo de la lista de puntos ----------
   Edición diferida como el resto: se escribe en el área de texto y solo
   «Aceptar» toca la capa. El nodo se guarda al abrir porque el diálogo
   de estilos es flotante y el usuario podría cambiar de fila.         */
const pointsDialog = document.getElementById("points-dialog");
const pointsBox = pointsDialog.querySelector(".dlg-box");
const pointsText = document.getElementById("points-text");
const pointsError = document.getElementById("points-error");
let pointsTarget = null;  /* { li, path, nested } (polígono) o { li, measure } mientras está abierto */

function closePointsDialog() {
  pointsDialog.hidden = true;
  pointsTarget = null;
  releaseFocus();
  /* La edición interactiva sobre el mapa vuelve sola si el diálogo de
     estilos sigue mostrando este mismo nodo — ver el guardia en
     syncVertexOwnerForDialog, que hasta ahora la tenía inhibida.      */
  syncVertexOwnerForDialog();
}

/* Parte común de rellenar el textarea/contador/título y mostrar el
   diálogo, compartida entre un polígono/línea y una medición.        */
function openPointsDialogCommon(li, rings, { showRingsHint }) {
  pointsText.value = pointsToText(rings);
  pointsText.classList.remove("bad");
  pointsError.hidden = true;
  const total = rings.reduce((n, r) => n + r.length, 0);
  $id("points-title").textContent = `Puntos de «${li._name}»`;
  $id("points-count").textContent = `${total} punto${total === 1 ? "" : "s"}`;
  /* Solo se explica la separación por anillos cuando de verdad hay más
     de uno: en el caso corriente sobra el detalle. Una medición nunca
     tiene más de un "anillo", así que aquí siempre queda oculta.      */
  const ringsHint = $id("points-rings");
  ringsHint.hidden = !showRingsHint || rings.length < 2;
  ringsHint.textContent = !showRingsHint || rings.length < 2 ? ""
    : `Esta capa tiene ${rings.length} trazos (contorno exterior primero, luego los `
      + "agujeros). Van separados por una línea en blanco; mantén esa separación.";
  pointsDialog.hidden = false;
  clampToViewport(pointsBox);
  focusDialog(pointsBox);
}

function openPointsDialogForPath(li) {
  const path = solePath(li);
  if (!path) return;
  const { rings, nested } = pathRings(path);
  pointsTarget = { li, path, nested };
  /* Las dos formas de editar la misma geometría no pueden convivir: si
     ya había manejadores interactivos para este nodo, se retiran aquí
     (mismo motivo que el comentario en syncVertexOwnerForDialog).
     Mientras este editor de texto siga abierto no se reconstruyen,
     aunque el diálogo de estilos siga mostrando el mismo nodo;
     closePointsDialog los restaura al cerrar.                        */
  if (vertexOwner && vertexOwner.kind === "polygon" && vertexOwner.li === li) teardownVertexOwner();
  openPointsDialogCommon(li, rings, { showRingsHint: true });
}

function openPointsDialogForMeasure(li) {
  const measure = li._measure;
  if (!measure) return;
  const { rings } = measureRings(measure);
  pointsTarget = { li, measure };
  /* Mismo criterio que un polígono: si el diálogo mostraba esta ruta con
     sus manejadores interactivos activos (vertexOwner), se retiran
     mientras el editor de texto esté abierto (un círculo nunca pasa por
     vertexOwner, así que aquí no hay nada que retirar en ese caso).    */
  if (vertexOwner && vertexOwner.li === li) teardownVertexOwner();
  openPointsDialogCommon(li, rings, { showRingsHint: false });
}

function openPointsDialog(li) {
  if (li._measure) openPointsDialogForMeasure(li);
  else openPointsDialogForPath(li);
}
$id("pg-points").addEventListener("click", () => {
  if (styleTargets.length === 1) openPointsDialog(styleTargets[0]);
});
$id("ms-points").addEventListener("click", () => {
  if (styleTargets.length === 1) openPointsDialog(styleTargets[0]);
});
$id("points-cancel").addEventListener("click", closePointsDialog);
$id("points-accept").addEventListener("click", () => {
  if (!pointsTarget) return closePointsDialog();
  const { rings, errors } = textToPoints(pointsText.value);
  const bad = msg => {
    /* No se cierra con la lista rota: mismo criterio que las
       coordenadas del diálogo de estilos.                            */
    pointsError.textContent = msg;
    pointsError.hidden = false;
    pointsText.classList.add("bad");
    pointsText.focus();
  };
  if (errors.length) {
    const list = errors.slice(0, 3).map(e => `línea ${e.line} (${e.why})`).join("; ");
    return bad(`Hay ${errors.length} línea${errors.length === 1 ? "" : "s"} que no se entienden: `
      + list + (errors.length > 3 ? "…" : "") + ".");
  }
  if (!rings.length) return bad("No queda ningún punto.");

  if (pointsTarget.measure) {
    const { li, measure } = pointsTarget;
    /* textToPoints devuelve tuplas [lat, lon(, alt)] (clampLatLng), no
       objetos {lat, lng} — measure.mOrigin/mDest.setLatLng las acepta
       tal cual (Leaflet normaliza arrays), pero buildRouteMeasurement
       lee w.lat/w.lng como propiedades, así que la ruta las convierte
       explícitamente más abajo.                                      */
    if (measure.type === "circle") {
      if (rings[0].length !== 2) return bad("Un círculo tiene exactamente 2 puntos: centro y borde.");
      pushUndo("editar puntos");
      measure.mOrigin.setLatLng(rings[0][0]);
      measure.mDest.setLatLng(rings[0][1]);
      updateMeasurement(measure);
    } else {
      if (rings[0].length < 2) return bad("Una ruta necesita al menos 2 waypoints.");
      pushUndo("editar puntos");
      if (vertexSelHandle && measure.handles.includes(vertexSelHandle)) clearVertexSelection();
      /* Reconstruye solo la parte GEOMÉTRICA del mismo objeto "measure"
         (el número de waypoints puede haber cambiado): retira lo viejo
         del mapa, construye lo nuevo con buildRouteMeasurement (que crea
         su PROPIO featureGroup efímero, descartado aquí) y traslada sus
         piezas al featureGroup de siempre — measure.treeLabel/treeName/
         style y la identidad del nodo del árbol no se tocan.          */
      measure.group.removeLayer(measure.geom);
      for (const h of measure.handles) measure.group.removeLayer(h);
      for (const lb of measure.legLabels) measure.group.removeLayer(lb);
      const waypoints = rings[0].map(p => ({ lat: p[0], lng: p[1] }));
      const fresh = buildRouteMeasurement(waypoints, measure.style);
      rootGroup.removeLayer(fresh.group); /* descarta el featureGroup efímero, no sus capas */
      measure.geom = fresh.geom;
      measure.handles = fresh.handles;
      measure.legLabels = fresh.legLabels;
      measure.legs = fresh.legs;
      measure.totalDist = fresh.totalDist;
      measure.group.addLayer(measure.geom);
      for (const h of measure.handles) { wireRouteHandle(measure, h); measure.group.addLayer(h); }
      for (const lb of measure.legLabels) measure.group.addLayer(lb);
      setMeasureLabelsVisible(measure, measure.style.showLabels);
      updateMeasurement(measure);
    }
    scheduleSave();
    closePointsDialog();
    /* El diálogo de estilos sigue abierto detrás y muestra medidas ya
       obsoletas: se recalculan con la geometría nueva.                 */
    if (!styleDialog.hidden && styleTargets[0] === li) {
      msMeasures = measurementValues(measure);
      $id("ms-values").hidden = !msMeasures;
      if (msMeasures) renderMeasureValues();
    }
    return;
  }

  const { li, path, nested } = pointsTarget;
  const closed = path instanceof L.Polygon;
  const min = closed ? 3 : 2;
  const short = rings.find(r => r.length < min);
  if (short) {
    return bad(closed
      ? `Cada trazo de un polígono necesita al menos 3 puntos; hay uno con ${short.length}.`
      : `Una línea necesita al menos 2 puntos; hay un trazo con ${short.length}.`);
  }
  pushUndo("editar puntos");
  path.setLatLngs(nested || rings.length > 1 ? rings : rings[0]);
  invalidateGeo(li);   /* la geometría cambió: la caché serializada ya no vale */
  scheduleSave();
  closePointsDialog();
  /* El diálogo de estilos sigue abierto detrás y muestra medidas ya
     obsoletas: se recalculan con la geometría nueva.                 */
  if (!styleDialog.hidden && styleTargets[0] === li) {
    polyMeasures = polygonMeasures(li);
    $id("pg-measures").hidden = !polyMeasures;
    if (polyMeasures) renderPolyMeasures();
  }
});

