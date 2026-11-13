/* ---------- Validación de GeoJSON ----------
   L.geoJSON is forgiving and will happily build layers from malformed
   geometries; the damage shows up later as layers in absurd places or as
   exceptions deep in Leaflet. Everything is therefore checked up front:
   known type, coordinates present, numeric, finite and in range.      */
const GEOJSON_TYPES = new Set(["Point", "MultiPoint", "LineString", "MultiLineString",
  "Polygon", "MultiPolygon", "GeometryCollection"]);

function validGeometry(geom, depth = 0) {
  if (!geom || typeof geom !== "object" || depth > 4) return false;
  if (!GEOJSON_TYPES.has(geom.type)) return false;
  if (geom.type === "GeometryCollection") {
    return Array.isArray(geom.geometries) && geom.geometries.length > 0 &&
           geom.geometries.every(g => validGeometry(g, depth + 1));
  }
  const c = geom.coordinates;
  if (!Array.isArray(c) || !c.length) return false;
  /* A position is [lon, lat, alt?]; anything deeper is a list of them */
  /* Además de comprobar, AJUSTA la posición sobre el propio objeto: así
     lo que se guarda y se dibuja ya está dentro de rango y no hace
     falta recorrer la geometría por segunda vez.                    */
  const checkPos = pos => {
    if (!Array.isArray(pos) || pos.length < 2) return false;
    const pair = clampLatLng(Number(pos[1]), Number(pos[0]));
    if (!pair) return false;
    pos[0] = pair[1];
    pos[1] = pair[0];
    return true;
  };
  const walk = (node, level) => level === 0
    ? checkPos(node)
    : Array.isArray(node) && node.length > 0 && node.every(n => walk(n, level - 1));
  const depths = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2,
                   Polygon: 2, MultiPolygon: 3 };
  if (!walk(c, depths[geom.type])) return false;
  /* A ring needs at least four positions (closed triangle) */
  if (geom.type === "Polygon") return c.every(r => r.length >= 4);
  if (geom.type === "MultiPolygon") return c.every(p => p.every(r => r.length >= 4));
  if (geom.type === "LineString") return c.length >= 2;
  if (geom.type === "MultiLineString") return c.every(l => l.length >= 2);
  return true;
}

/* Convierte una topología TopoJSON a un FeatureCollection GeoJSON normal
   (une los objetos con nombre en una sola lista de features), para que a
   partir de aquí siga el proceso habitual de importar un JSON.        */
function topologyToGeoJson(topology) {
  if (typeof topojson === "undefined") throw new Error(tr("no se pudo cargar el soporte de TopoJSON"));
  const features = [];
  for (const name of Object.keys(topology.objects || {})) {
    const fc = topojson.feature(topology, topology.objects[name]);
    features.push(...(fc.type === "FeatureCollection" ? fc.features : [fc]));
  }
  return { type: "FeatureCollection", features };
}

/* Extrae el array de Features de cualquier forma de entrada aceptada
   (FeatureCollection, Feature suelto o geometría suelta); factoriza la
   detección de tipo que antes vivía inline al principio de
   buildGeoJsonRecords, y la reutiliza addFileNode para mirar el primer
   Feature antes de construir nada (elegir la propiedad-nombre).      */
function geojsonFeatures(gj) {
  if (!gj || typeof gj !== "object") throw new Error(tr("no parece un GeoJSON"));
  if (gj.type === "FeatureCollection") return Array.isArray(gj.features) ? gj.features : [];
  if (gj.type === "Feature") return [gj];
  if (GEOJSON_TYPES.has(gj.type)) return [{ type: "Feature", geometry: gj, properties: {} }];
  throw new Error(tr("no parece un GeoJSON"));
}

/* Hay que preguntar (o aplicar lo guardado) siempre que el primer Feature
   traiga properties con alguna clave: NO se asume que `name` o `title`
   sean el nombre, lo decide el usuario una vez por forma de properties. */
function needsNamePicker(props) {
  return !!(props && typeof props === "object" && Object.keys(props).length);
}

/* Huella de la FORMA de properties (su conjunto de claves, no sus
   valores ni su orden original): sirve para indexar la asociación
   guardada, y como es el JSON de las propias claves, se puede
   recuperar la lista de claves de una huella con JSON.parse.        */
function propsFingerprint(props, scope = "") {
  const keys = JSON.stringify(Object.keys(props || {}).sort());
  return scope ? scope + GNP_SCOPE_SEP + keys : keys;
}

/* Un ORIGEN opcional delante de la huella: dos capas de un mismo servicio
   ArcGIS comparten casi todos sus campos (OBJECTID, NAME_TXT, TYPE_CODE…),
   y con solo las claves la asociación elegida para una se aplicaba en
   silencio a las demás, que no tienen por qué llamarse igual. Con origen
   (`arcgis:<servicio>#<id de capa>`) cada capa descargada tiene la suya.
   El JSON de las claves nunca lleva un salto de línea sin escapar y su
   primer carácter es «[», así que separar por «\n» es inequívoco y una
   huella SIN origen (todo lo ya guardado) sigue valiendo tal cual.     */
const GNP_SCOPE_SEP = "\n";
function splitFingerprint(fp) {
  fp = String(fp);
  const i = fp.indexOf(GNP_SCOPE_SEP);
  const rest = i < 0 ? fp : fp.slice(i + 1);
  let keys = null;
  try { keys = JSON.parse(rest); } catch { /* una huella ilegible */ }
  return { scope: i < 0 ? "" : fp.slice(0, i),
           keys: Array.isArray(keys) ? keys.map(String) : [rest] };
}

/* Separador entre los valores de varias claves elegidas como nombre. */
const NAME_JOIN = " / ";

/* Une, EN EL ORDEN de `keys`, los valores presentes de esas claves.
   Una clave ausente o de valor vacío se omite (no deja «A / »); si no
   queda ninguna devuelve "" y quien llama decide el respaldo.         */
function composeFeatureName(props, keys) {
  if (!props || !Array.isArray(keys)) return "";
  const parts = [];
  for (const k of keys) {
    const v = stringifyPropValue(props[k]).trim();
    if (v) parts.push(v);
  }
  return parts.join(NAME_JOIN);
}

/* nameKeys es la lista ordenada elegida por el usuario (o recordada).
   Sin `name`/`title` de respaldo a propósito: si el elemento no tiene
   ninguna de esas claves, sale «Elemento N».                         */
function resolveFeatureName(props, index, nameKeys) {
  return composeFeatureName(props, nameKeys) || tr("Elemento {n}", { n: index + 1 });
}

async function buildGeoJsonRecords(gj, prog, report, nameKeys = null) {
  const features = geojsonFeatures(gj);
  const out = [];

  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    const props = (feature && typeof feature.properties === "object" && feature.properties) || {};
    const name = resolveFeatureName(props, i, nameKeys);
    try {
      if (!feature || !validGeometry(feature.geometry)) {
        if (report) {
          report.warn(feature && feature.geometry
            ? tr("geometr\u00EDa no v\u00E1lida o fuera de rango ({type})", { type: feature.geometry.type || tr("sin tipo") })
            : tr("elemento sin geometr\u00EDa"));
        }
        continue;
      }
      const style = geojsonStyle(props);
      const layer = L.geoJSON(feature, { style });
      clearFillOnOpenPaths(layer); /* una línea no se rellena, ver esa función */
      layer.bindPopup(escapeHtml(name), COMPACT_POPUP);
      layer.addTo(rootGroup); /* GeoJSON no define visibilidad: todo activo */
      const rec = { t: "layer", name, checked: true, style, _layer: layer };
      wirePendingLayerEvents(rec);
      out.push(rec);
      if (report) { report.loaded++; report.kinds.add(feature.geometry.type); }
    } catch (err) {
      if (report) report.warn(`\u00AB${name}\u00BB: ${err.message}`);
    }
    if (prog && ++prog.done % PROGRESS_BATCH === 0) {
      prog.update(prog.done);
      await yieldFrame();
    }
  }
  return out;
}

/* ================= Persistencia: árbol completo en IndexedDB =================
   Se guarda el árbol de navegación tal cual está: carpetas creadas, orden,
   renombrados, capas movidas, estados de visibilidad y colapso y mediciones.
   La geometría de cada capa se serializa a GeoJSON, de modo que el archivo
   original deja de ser necesario tras la importación. Cualquier cambio en el
   panel reprograma un guardado (con un pequeño debounce).                    */

const DB_NAME = "visor-kml";
const DB_VERSION = 5;  /* esquema de la base: almacenes "tree", "rasters" y
                          "segments". Subir solo cuando cambie la
                          estructura de almacenes.
                          v4 añade "rasters" (las ortofotos COG, ver
                          64-cog.js) SIN borrar "tree": subir la versión
                          vaciaba antes todos los almacenes, y añadir uno
                          habría tirado el árbol de todo el mundo a cambio
                          de nada. openDb crea solo los que falten; un
                          almacén que deje de existir se borra allí.
                          v5 añade "segments": la parte PESADA de cada hoja
                          (geometría y ficha de una capa, celdas de una
                          cuadrícula, imagen de una superposición) sale
                          del "root" guardado, que pasa a ser un esqueleto
                          con referencias `p: [segmento, índice]` (ver
                          «Guardado en dos niveles» más abajo). Una
                          instancia anterior no puede abrir una base v5
                          (VersionError), así que nunca leerá un esqueleto
                          sin geometría. TERCERA excepción deliberada a
                          «sin compatibilidad hacia atrás», decidida con
                          el usuario: un "root" v8 con todo en línea se
                          sigue leyendo tal cual, sin transformar nada, y
                          el primer guardado lo reparte.                 */
const TREE_SCHEMA = 9; /* formato del árbol serializado. Subir solo cuando
                          cambie el formato; un árbol guardado con otra
                          versión se descarta al leer.
                          v2: los nodos de capa admiten `mstyle` (estilo de
                          marcador: icono MDI, colores, tamaños y texto).
                          v3: nuevo tipo de nodo "elevGrid" (celdas de
                          elevación acumuladas en una sesión de modo altura).
                          v4: nuevo tipo de nodo "imageOverlay" (ortofotos
                          georeferenciadas de KMZ, con cambio de nivel de
                          detalle por zoom).
                          v5: imageOverlay ya no guarda minLod/maxLod (se
                          retira el cambio de nivel de detalle por zoom;
                          las ortofotos se cargan y muestran todas).
                          v6: los nodos "measure" guardan su `style`
                          (color, grosor y relleno del círculo), ahora
                          editable desde el diálogo de propiedades.
                          `style` es un saco ABIERTO de opciones que
                          normalizePathStyle completa con sus valores
                          por defecto, así que añadirle una clave
                          (textAlways) NO sube esta versión: un árbol
                          anterior se lee igual y subirla habría
                          borrado el de todo el mundo a cambio de nada.
                          v7: los nodos "measure" guardan `waypoints`
                          (array de {lat,lng}, longitud 2 para línea/
                          círculo, N para el nuevo mtype "route") en vez
                          de los campos sueltos `a`/`b`. EXCEPCIÓN
                          deliberada al principio de «sin compatibilidad
                          hacia atrás»: un árbol v6 no se descarta, se
                          sube en silencio con upgradeMeasuresV6 (ver
                          más abajo) porque el único cambio de forma
                          entre v6 y v7 es ese, y se sabe de antemano
                          que es trivial y está acotado a un solo tipo
                          de nodo — no es la política por defecto para
                          la próxima subida de versión, que se evalúa
                          aparte.
                          v8: nuevo tipo de nodo "cog" (ortofoto COG cuyos
                          bytes viven en el almacén "rasters", ver
                          64-cog.js). SEGUNDA excepción deliberada, y sin
                          transformar nada: un árbol v7 ya es un v8
                          válido (solo se añade un tipo), así que se lee
                          tal cual (dbLoadTree, importTreeExport). Se sube
                          igualmente para que una instancia ANTERIOR
                          rechace un árbol que traiga el tipo nuevo.
                          v9: nuevos tipos de nodo "arcgis" (un servicio
                          ArcGIS MapServer: su dirección, extent, opacidad
                          y las capas del catálogo) y "arcgisLayer" (cada
                          capa, hija de su servicio; ver 66-arcgis.js).
                          CUARTA excepción deliberada, misma forma que la
                          v8: un árbol v8 (y el v7 que ya se leía) se lee
                          tal cual porque solo se AÑADEN tipos, y se sube
                          para que una instancia anterior rechace un árbol
                          con servicios en vez de leer un "arcgis" con
                          hijos como una carpeta y estropearlo. */
const DB_TREE = "tree";
const DB_RASTERS = "rasters";
const DB_SEGMENTS = "segments";
/* Los almacenes de DB_VERSION: openDb crea los que falten y borra los
   que sobren, sin tocar los que siguen (ver DB_VERSION v4).          */
const DB_STORES = [DB_TREE, DB_RASTERS, DB_SEGMENTS];

/* Id aleatorio de 32 hex para las claves que no deben chocar entre
   pestañas: blobs de "rasters" y segmentos de "segments".           */
function newStoreId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

/* ================= Guardado en dos niveles =================
   IndexedDB no modifica un valor en parte: `put` lo reescribe entero, y
   el structured clone de ese `put` corre SÍNCRONO en el hilo principal.
   Con el árbol entero como un solo valor, cualquier cambio —plegar una
   carpeta, marcar una capa— reescribía todo. Medido (Chromium sin GPU,
   7 copias de un .kite.json real, 114 MB, 22.078 capas): 330 ms de
   bloqueo 400 ms después de CADA acción, con el trabajo propio de la
   acción por debajo de 40 ms. Y con la composición de un árbol real de
   usuario (fichas 39 MB, polígonos 34 MB): 460 ms, de ellos 370 solo
   por la geometría.

   Ahora el "root" es un ESQUELETO (nombres, casillas, colapso, estilos:
   2,9 MB con 22k capas → 18-20 ms) y lo pesado va a "segments", que se
   escribe como un registro de bitácora: cada guardado añade como mucho
   UN segmento con lo nuevo o cambiado desde el anterior. Importar es un
   segmento grande; mover un marcador, uno diminuto. Al arrancar se
   borran los segmentos muertos y se funden los pequeños o medio
   muertos (segmentPlan).

   Por qué segmentos y no una clave por capa (medido, 22k capas): una
   clave por capa tardaba 9,4 s en el primer guardado y 1,16 s en leerse
   al arrancar, frente a 0,24 s del "root" único; cada registro de
   IndexedDB tiene un coste fijo alto. Hay que tener POCOS registros.

   Saber qué ha cambiado no exige marcar nada en los ~100 sitios que
   llaman a scheduleSave: la parte pesada se reconoce por IDENTIDAD.
   `li._geo`/`rec.geo` es un objeto que nadie modifica en el sitio: todo
   cambio de geometría pasa por invalidateGeo (31-tree-node.js), y el
   siguiente toGeoJSON() crea otro objeto. Igual las celdas de una
   cuadrícula y la cadena de una superposición. Cualquier código nuevo
   que altere geometría SIN invalidateGeo perdería ese cambio al
   recargar (antes también: la caché ya dependía de lo mismo).          */

/* La parte pesada de una hoja serializada, o null si no tiene. `key` es
   lo que la identifica (objeto o cadena) y `disc` lo que la acompaña y
   también puede cambiar (la ficha de una capa, el perfil de una
   cuadrícula): dos nodos con la misma geometría y distinta ficha son
   dos cargas distintas. PURA.                                         */
const HEAVY_FIELDS = { layer: ["geo", "desc"], elevGrid: ["cells", "profile"], imageOverlay: ["dataUrl"] };
function heavyPart(n) {
  const fields = HEAVY_FIELDS[n.t];
  if (!fields) return null;
  const key = n[fields[0]];
  if (!key || (typeof key !== "object" && typeof key !== "string")) return null;
  return { key, disc: fields[1] ? n[fields[1]] : undefined, fields };
}
/* La parte pesada, solo cuando hace falta escribirla. Un campo vacío no
   se guarda, igual que serializeNode no lo pone.                     */
function heavyPayload(n, fields) {
  const out = {};
  for (const f of fields) if (n[f]) out[f] = n[f];
  return out;
}
/* El registro sin su parte pesada y con la referencia. A mano y no con
   `{ ...rest }`: con 22k hojas por guardado, la desestructuración con
   resto costaba de 5 a 19 ms medidos.                                */
function skeletonLeaf(n, fields, ref) {
  const out = {};
  for (const k in n) if (!fields.includes(k)) out[k] = n[k];
  out.p = ref;
  return out;
}

/* Qué cargas ya están en disco y dónde: objeto pesado → (disc → ref).
   Un WeakMap para los objetos, que así no retiene nada que el árbol ya
   no use; las cadenas (dataUrl) no pueden ir en un WeakMap y van en un
   Map que se rehace en cada guardado con las que siguen en el árbol.  */
const newPayloadIndex = () => ({ obj: new WeakMap(), str: new Map() });
function payloadRef(index, key, disc) {
  const m = typeof key === "string" ? index.str.get(key) : index.obj.get(key);
  return m ? m.get(disc) : undefined;
}
function rememberPayload(index, key, disc, ref) {
  const table = typeof key === "string" ? index.str : index.obj;
  let m = table.get(key);
  if (!m) table.set(key, m = new Map());
  m.set(disc, ref);
}

/* Reparte unos registros serializados en esqueleto + entradas del
   segmento nuevo `segId`. Una carga ya conocida reutiliza su ref SOLO si
   su segmento sigue en disco (`liveSegs`): si otra pestaña lo borró al
   arrancar, se vuelve a escribir aquí (auto-reparación). `fresh` guarda
   lo nuevo de este guardado, que pasa a `known` solo cuando la
   transacción se complete (commitPayloads): si fallara, el siguiente
   guardado lo reescribiría. PURA salvo por leer `known`.             */
function splitPayloads(nodes, known, segId, liveSegs) {
  const entries = [], fresh = newPayloadIndex(), freshList = [], strings = new Map();
  const walk = list => list.map(n => {
    if (n.children) return { ...n, children: walk(n.children) };
    const h = heavyPart(n);
    if (!h) return n;
    let ref = payloadRef(fresh, h.key, h.disc);
    if (!ref) {
      const old = payloadRef(known, h.key, h.disc);
      if (old && liveSegs.has(old[0])) ref = old;
    }
    if (!ref) {
      ref = [segId, entries.length];
      entries.push(heavyPayload(n, h.fields));
      rememberPayload(fresh, h.key, h.disc, ref);
      freshList.push([h.key, h.disc, ref]);
    }
    if (typeof h.key === "string") {
      let m = strings.get(h.key);
      if (!m) strings.set(h.key, m = new Map());
      m.set(h.disc, ref);
    }
    return skeletonLeaf(n, h.fields, ref);
  });
  return { skeleton: walk(nodes), entries, freshList, strings };
}
function commitPayloads(known, out) {
  for (const [key, disc, ref] of out.freshList) rememberPayload(known, key, disc, ref);
  known.str = out.strings; /* solo las cadenas que siguen en el árbol */
}

/* Hojas del esqueleto que apuntan a un segmento, en orden. PURA. */
function skeletonRefs(nodes, out = []) {
  for (const n of nodes) {
    if (n.children) skeletonRefs(n.children, out);
    else if (Array.isArray(n.p)) out.push(n);
  }
  return out;
}

/* Qué hacer con los segmentos al arrancar, a partir del esqueleto
   leído: borrar los que nada nombra y fundir en uno nuevo los que
   tienen más entradas muertas que vivas o son pequeños (si hay más de
   uno pequeño). Un segmento grande y sano (una importación) no se toca:
   reescribirlo costaría lo mismo que el guardado entero que se evita.
   PURA: `sizes` es Map(segId → nº de entradas).                      */
const SEG_SMALL = 64;
function segmentPlan(nodes, sizes) {
  const live = new Map(); /* segId → Set(índices vivos) */
  for (const n of skeletonRefs(nodes)) {
    const [seg, i] = n.p;
    if (!sizes.has(seg)) continue;
    let s = live.get(seg);
    if (!s) live.set(seg, s = new Set());
    s.add(i);
  }
  const drop = [], small = [], compact = [];
  for (const [seg, total] of sizes) {
    const s = live.get(seg);
    if (!s) drop.push(seg);
    else if (s.size * 2 < total) compact.push(seg);
    else if (total < SEG_SMALL) small.push(seg);
  }
  if (small.length > 1 || (small.length && compact.length)) compact.push(...small);
  return { drop, compact };
}

/* Mueve al segmento nuevo `segId` las entradas vivas de los segmentos a
   fundir, reescribiendo `p` en el esqueleto (que se MUTA, como
   upgradeMeasuresV6). Dos hojas con la misma ref siguen compartiéndola.
   Devuelve las entradas del segmento nuevo. PURA salvo esa mutación. */
function compactSegments(nodes, segs, compact, segId) {
  const moving = new Set(compact), moved = new Map(), entries = [];
  for (const n of skeletonRefs(nodes)) {
    const [seg, i] = n.p;
    if (!moving.has(seg)) continue;
    const k = seg + "|" + i;
    let ref = moved.get(k);
    if (!ref) {
      const e = segs.get(seg)[i];
      if (e === undefined) continue; /* la cuenta joinPayloads como perdida */
      moved.set(k, ref = [segId, entries.length]);
      entries.push(e);
    }
    n.p = ref;
  }
  return entries;
}

/* Devuelve a cada hoja su parte pesada (MUTA el esqueleto, recién leído
   de disco) y quita las que apuntan a algo que ya no está: una base
   tocada a mano, o una carrera entre pestañas que la auto-reparación no
   llegó a cubrir. `remember(key, disc, ref)` siembra el índice de lo ya
   guardado para que el primer guardado no lo reescriba todo. Un
   registro con su parte pesada EN LÍNEA (un "root" v8 de antes de los
   segmentos) pasa tal cual. Devuelve cuántas hojas se perdieron. PURA
   salvo la mutación y `remember`.                                     */
function joinPayloads(nodes, segs, remember = () => {}) {
  let missing = 0;
  const walk = list => {
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (n.children) { walk(n.children); continue; }
      if (!Array.isArray(n.p)) continue;
      const seg = segs.get(n.p[0]);
      const e = Array.isArray(seg) ? seg[n.p[1]] : undefined;
      const ok = e && typeof e === "object" && (
        (n.t === "layer" && e.geo && typeof e.geo === "object") ||
        (n.t === "elevGrid" && Array.isArray(e.cells)) ||
        (n.t === "imageOverlay" && typeof e.dataUrl === "string"));
      if (!ok) { list.splice(i, 1); missing++; continue; }
      const ref = n.p;
      delete n.p;
      Object.assign(n, e);
      const h = heavyPart(n);
      if (h) remember(h.key, h.disc, ref);
    }
  };
  walk(nodes);
  return missing;
}

/* Lo ya escrito en "segments" en esta sesión (y lo leído al arrancar) */
let payloadsKnown = newPayloadIndex();

/* Sube en silencio un árbol v6 a la forma v7 (measure: a/b → waypoints),
   la ÚNICA excepción a «lo que no corresponda a la versión actual se
   borra, no se migra». Función PURA sobre el array de registros: no
   toca IndexedDB ni el DOM, así que se puede probar aislada. No hace
   falta mirar `mtype`: la transformación es idéntica para línea y
   círculo (los únicos tipos que existían en v6, ambos con exactamente
   dos puntos).                                                        */
function upgradeMeasuresV6(nodes) {
  for (const rec of nodes) {
    if (rec.t === "measure" && !rec.waypoints && rec.a && rec.b) {
      rec.waypoints = [rec.a, rec.b];
      delete rec.a;
      delete rec.b;
    } else if (rec.children) {
      upgradeMeasuresV6(rec.children);
    }
  }
  return nodes;
}

/* One connection, reused. Opening the database on every save wastes
   handles and, worse, a stale connection blocks the upgrade of another
   tab: `onversionchange` closes ours so the other tab can proceed, and
   the cached promise is dropped so the next call reopens.            */
let dbPromise = null;
/* Mientras se borra toda la base (Propiedades › Restaurar, wipeAllData)
   nadie puede volver a abrirla: un guardado tardío (la vista del mapa, un
   autoguardado) recrearía la base vacía y escribiría en ella justo antes
   de recargar. Todos los que llaman a openDb ya capturan el rechazo.    */
let dbWiped = false;

function openDb() {
  if (dbWiped) return Promise.reject(new Error("restoring"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, DB_VERSION);
    rq.onupgradeneeded = () => {
      /* Se crea lo que falta y se borra lo que ya no existe; lo que
         sigue se conserva con su contenido (ver DB_VERSION v4).      */
      const db = rq.result;
      for (const s of [...db.objectStoreNames]) if (!DB_STORES.includes(s)) db.deleteObjectStore(s);
      for (const s of DB_STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    rq.onsuccess = () => {
      const db = rq.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; }; /* cierre inesperado */
      resolve(db);
    };
    rq.onerror = () => { dbPromise = null; reject(rq.error); };
    rq.onblocked = () => navMessage(tr("Otra pesta\u00F1a est\u00E1 usando el almacenamiento; ci\u00E9rrela para continuar."));
  }).catch(err => { dbPromise = null; throw err; });
  return dbPromise;
}
/* Una sola transacción sobre "tree" y "segments": el esqueleto nunca
   puede quedar en disco apuntando a un segmento que no llegó. Primero
   se listan los segmentos que hay (pocos registros: barato) para que el
   reparto sepa cuáles de los ya conocidos siguen vivos. `onCost` recibe
   lo que tardó la parte SÍNCRONA de los `put`, que es donde se clona y
   lo que bloquea el hilo: el retardo de scheduleSave se ajusta a eso.  */
async function dbSaveTree(nodes, onCost = () => {}) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([DB_TREE, DB_SEGMENTS], "readwrite");
    const segs = tx.objectStore(DB_SEGMENTS);
    let out = null;
    const rq = segs.getAllKeys();
    rq.onsuccess = () => {
      const t0 = performance.now();
      const segId = newStoreId();
      out = splitPayloads(nodes, payloadsKnown, segId, new Set(rq.result));
      if (out.entries.length) segs.put(out.entries, segId);
      tx.objectStore(DB_TREE).put({ v: TREE_SCHEMA, nodes: out.skeleton }, "root");
      onCost(performance.now() - t0);
    };
    tx.oncomplete = () => { if (out) commitPayloads(payloadsKnown, out); resolve(); };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
/* ================= Ficha del elemento =================
   La <description> de un KML es HTML de un archivo AJENO: insertarlo tal
   cual sería ejecutar código de terceros en la página. Se sanea con
   lista blanca: se descartan los elementos peligrosos, todos los
   atributos `on*` y cualquier URL que no sea http(s).                */
const DESC_TAGS = new Set(["B","I","U","EM","STRONG","SMALL","BR","P","DIV","SPAN","HR",
  "UL","OL","LI","TABLE","THEAD","TBODY","TFOOT","TR","TD","TH","CAPTION",
  "H1","H2","H3","H4","H5","H6","A","IMG","PRE","CODE","FONT","CENTER"]);
const DESC_ATTRS = new Set(["href", "src", "alt", "title", "colspan", "rowspan"]);
/* Estos se tiran ENTEROS. Al resto de elementos no permitidos se les
   quita la etiqueta pero se conserva su texto, que suele ser el dato;
   con un <script> eso dejaba su código a la vista como texto suelto. */
const DESC_DROP = new Set(["SCRIPT","STYLE","IFRAME","OBJECT","EMBED","NOSCRIPT",
  "TEMPLATE","LINK","META","TITLE","HEAD","FORM","INPUT","BUTTON","SELECT","TEXTAREA"]);

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  const walk = node => {
    for (const el of [...node.children]) {
      if (DESC_DROP.has(el.tagName)) { el.remove(); continue; }
      if (!DESC_TAGS.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
      for (const att of [...el.attributes]) {
        const name = att.name.toLowerCase();
        const bad = !DESC_ATTRS.has(name)
          || (/^(href|src)$/.test(name) && !/^https?:/i.test(att.value.trim()));
        if (bad) el.removeAttribute(att.name);
      }
      if (el.tagName === "A") { el.target = "_blank"; el.rel = "noopener noreferrer"; }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/* El usuario cerró el panel explícitamente (Cerrar o Escape): el hover
   no debe reabrirlo hasta la próxima apertura explícita (botón ℹ o
   «Mostrar atributos» del menú contextual), o el cierre nunca "se
   queda cerrado" mientras el ratón siga pasando por capas.           */
let layerInfoDismissed = false;

/* Deferred close on mouseout: if no mouseover on some layer cancels it
   within LAYER_INFO_HIDE_DELAY, the hover-opened card stops showing the
   layer it showed. The short delay avoids a flicker when crossing the gap
   between two neighbouring layers. What happens then depends on the stack
   of recent cards (below): the layer the pointer rested on joins it and the
   card shrinks to that stack ("compact"); with nothing in the stack it
   closes, as it always did. Skipped while the card holds keyboard focus (an
   explicit open via the ℹ button or the context menu): that close stays the
   user's call.                                                           */
const LAYER_INFO_HIDE_DELAY = 200; /* ms */
let layerInfoHideTimer = null;
let infoHideHeld = false; /* the deferred close waits for a text selection in the card to go (44-dialogs.js) */
function cancelLayerInfoHide() {
  if (layerInfoHideTimer) { clearTimeout(layerInfoHideTimer); layerInfoHideTimer = null; }
}
function scheduleLayerInfoHide() {
  cancelHoverIntent(); /* the pointer left a layer before its intent fired: it never shows */
  if (liveInfo && liveInfo.leftAt == null) liveInfo.leftAt = Date.now();
  settleHoverCandidate();
  /* A pinned card on screen stays until the user picks another tab or closes it */
  if (infoCardLocked()) return;
  /* With the focus in the card, closing it stays the user's call, but only
     while it shows the layer opened on purpose (ℹ, «Mostrar atributos»): once
     the pointer brought another layer, it is a hover card again. Before, the
     last layer hovered after an explicit open stayed on screen for ever (the
     focus never left the card), while its tabs expired around it. */
  if (descDialog.hidden || (descBox.contains(document.activeElement) && liveInfo && liveInfo.explicit)) return;
  cancelLayerInfoHide();
  layerInfoHideTimer = setTimeout(() => {
    layerInfoHideTimer = null;
    /* The pointer is on the card itself: it always opens in the same corner, so
       it can land right over the layer being hovered (a «W» near the top-right
       edge), the user may be heading for the link inside it, or for a row of
       its stack. Closing it now would put the layer back under the pointer,
       reopen it and blink for ever. It acts when the pointer leaves it
       (`mouseleave`, 44-dialogs.js). */
    if (descBox.matches(":hover")) return;
    /* Text selected in the card (to copy it): it must not change under the
       selection. It acts once the selection goes (selectionchange, 44). */
    if (infoSelectionInCard()) { infoHideHeld = true; return; }
    if (infoCardLocked()) return;
    collapseLayerInfo();
  }, LAYER_INFO_HIDE_DELAY);
}

/* ---------- Hover intent ----------
   Sweeping the mouse across many markers used to rewrite the card on every
   one of them, so none could be read. With the card already showing a layer,
   another layer takes it over only once the pointer has RESTED on it for
   LAYER_INFO_HOVER_INTENT_MS; just crossing it changes nothing. A closed or
   compact card still opens at once on the first layer.                    */
const LAYER_INFO_HOVER_INTENT_MS = 250; /* ms */
let hoverIntent = null; /* { li, timer } */
function cancelHoverIntent() {
  if (hoverIntent) { clearTimeout(hoverIntent.timer); hoverIntent = null; }
}

/* ---------- Stack of recent cards ----------
   Every layer the pointer rested on (INFO_STACK_DWELL_MS, counted from when it
   entered the layer) or that was opened on purpose (ℹ, «Mostrar atributos»)
   leaves a one-line row in the card when another layer takes over or the
   pointer leaves them all. The rows are tabs under the title (44-dialogs.js):
   hovering one shows its card in the body and outlines its layer on the map;
   the pin keeps it, the F key pins the layer under the pointer.
   Rules decided with the user:
   - Rows never move: a new one goes on top, revisiting a layer leaves its row
     where it is (it only renews its lease).
   - At most INFO_STACK_MAX unpinned rows, first in first out: the one that
     entered the queue earliest goes (`q`). Pinned rows do not count (their own
     cap, INFO_STACK_MAX_PINNED); unpinning one puts it back in the queue as
     its newest entry, with a fresh lease, and it expires like any other.
   - Unpinned rows expire INFO_STACK_TTL_MS after their last use (dimmed for
     the last INFO_STACK_WARN_MS).
   - While the pointer is on the card NOTHING leaves: every row's clock stops
     (dimming included) and goes on from where it was when the pointer leaves,
     so leaving never makes several rows vanish at once; the queue cap is not
     applied meanwhile either (a row unpinned while there waits).
   Session state only: rows point at live tree rows, which undo and reload
   rebuild. Rendering lives in 44-dialogs.js (renderInfoStack).            */
const INFO_STACK_DWELL_MS = 400;
const INFO_STACK_TTL_MS = 30000;
const INFO_STACK_WARN_MS = 5000;
const INFO_STACK_MAX = 6;
const INFO_STACK_MAX_PINNED = 6;
let infoStack = [];      /* [{ li, pinned, t: last use, q: order of entry in the queue }], newest first, never reordered */
let infoQueueSeq = 0;    /* q comes from a counter, not the clock: two rows can enter within the same millisecond */
let liveInfo = null;     /* { li, enteredAt, leftAt, explicit }: the layer under the pointer or opened on purpose */
let infoPeek = null;     /* the recent card whose tab is being looked at (pointer or focus on it) */
let infoStackTimer = null;
let infoStackPaused = false;
let infoPausedAt = 0;    /* when the clocks stopped (pointer on the card) */
/* The stack's clock: frozen while the pointer is on the card */
const infoStackClock = () => infoStackPaused ? infoPausedAt : Date.now();

/* `rows` with `li` added on top, or, if already there, left in place with a
   renewed lease. Unchanged (same array) when `li` should enter pinned and the
   pinned cap is full. Trims the queue unless `paused`. Pure, tested in
   tests/toolstest.js. */
function infoStackWith(rows, li, now, { pinned = false, max = INFO_STACK_MAX, maxPinned = INFO_STACK_MAX_PINNED, paused = false, q = now } = {}) {
  if (rows.some(r => r.li === li)) return rows.map(r => r.li === li ? { ...r, t: now } : r);
  if (pinned && rows.filter(r => r.pinned).length >= maxPinned) return rows;
  const next = [{ li, pinned, t: now, q }, ...rows];
  return paused ? next : infoStackTrim(next, max);
}
/* First in, first out over the unpinned rows: drops the ones that entered the
   queue earliest until `max` are left. Pure. */
function infoStackTrim(rows, max = INFO_STACK_MAX) {
  const queue = rows.filter(r => !r.pinned);
  if (queue.length <= max) return rows;
  const out = new Set([...queue].sort((a, b) => a.q - b.q).slice(0, queue.length - max));
  return rows.filter(r => !out.has(r));
}
/* Pin or unpin the row of `li` in place. Unpinning puts it back in the queue as
   its newest entry (q, t = now). Same array back when pinning would pass the
   pinned cap. Pure. */
function infoStackPinned(rows, li, pinned, now, { max = INFO_STACK_MAX, maxPinned = INFO_STACK_MAX_PINNED, paused = false, q = now } = {}) {
  const row = rows.find(r => r.li === li);
  if (!row) return infoStackWith(rows, li, now, { pinned, max, maxPinned, paused, q });
  if (row.pinned === pinned) return rows;
  if (pinned && rows.filter(r => r.pinned).length >= maxPinned) return rows;
  const next = rows.map(r => r === row ? (pinned ? { ...r, pinned } : { ...r, pinned, t: now, q }) : r);
  return paused ? next : infoStackTrim(next, max);
}
/* The rows still worth showing: unpinned ones expire (not while `paused`), and
   a layer that left the tree (deleted, or rebuilt by undo) goes. Pure. */
function infoStackAlive(rows, now, ttl = INFO_STACK_TTL_MS, paused = false) {
  return rows.filter(r => r.li.isConnected !== false && (r.pinned || paused || now - r.t < ttl));
}
/* The clocks go on after a pause of `pausedFor` ms: every unpinned row keeps
   the time it had left. Pure. */
function infoStackResumed(rows, pausedFor) {
  return rows.map(r => r.pinned ? r : { ...r, t: r.t + pausedFor });
}
function infoStackExpiring(row, now, ttl = INFO_STACK_TTL_MS, warn = INFO_STACK_WARN_MS) {
  return !row.pinned && now >= row.t + ttl - warn;
}
/* When the next row starts dimming or expires (Infinity: nothing pending). Pure. */
function infoStackNextEvent(rows, now, ttl = INFO_STACK_TTL_MS, warn = INFO_STACK_WARN_MS) {
  let next = Infinity;
  for (const r of rows) {
    if (r.pinned) continue;
    for (const at of [r.t + ttl - warn, r.t + ttl]) if (at > now && at < next) next = at;
  }
  return next;
}

/* One timer for the whole stack, armed for its next event only. */
function scheduleInfoStackTick() {
  clearTimeout(infoStackTimer);
  infoStackTimer = null;
  if (infoStackPaused) return;
  const now = Date.now();
  const next = infoStackNextEvent(infoStack, now);
  if (next !== Infinity) infoStackTimer = setTimeout(refreshInfoStack, next - now + 20);
}
/* While the pointer is on the card the user is reading the rows: their clocks
   stop. Leaving restarts them where they were and applies the queue cap that
   waited (a row unpinned meanwhile may have passed it). */
function pauseInfoStack(paused) {
  if (paused === infoStackPaused) return;
  if (paused) {
    infoPausedAt = Date.now();
    infoStackPaused = true;
    scheduleInfoStackTick(); /* clears the timer */
    return;
  }
  infoStack = infoStackTrim(infoStackResumed(infoStack, Date.now() - infoPausedAt));
  infoStackPaused = false;
  if (infoStack.length || liveInfo) refreshInfoStack();
  else scheduleInfoStackTick();
}
/* Drops what expired or left the tree and repaints; a card left with nothing
   to show closes. Also called from scheduleSave, so a deleted or renamed
   layer is reflected at once (a handful of rows to look at). */
function refreshInfoStack() {
  if (!infoStack.length && !liveInfo) return;
  infoStack = infoStackAlive(infoStack, infoStackClock(), INFO_STACK_TTL_MS, infoStackPaused);
  if (liveInfo && liveInfo.li.isConnected === false) liveInfo = null;
  if (infoPeek && !infoStack.some(r => r.li === infoPeek)) { infoPeek = null; setInfoHalo(null); }
  if (!descDialog.hidden) {
    const shown = infoPeek || (liveInfo && liveInfo.li);
    if (!shown && !infoStack.length) hideLayerInfo();
    else paintLayerInfo(shown || null);
  }
  scheduleInfoStackTick();
}

/* The card stops showing the layer under the pointer: it joins the stack if
   the pointer rested on it or it was opened on purpose; already there, its
   row stays where it is with a renewed lease. */
function retireLiveInfo() {
  const live = liveInfo;
  liveInfo = null;
  if (!live || !infoStackActive()) return;
  const now = Date.now();
  const dwell = (live.leftAt ?? now) - live.enteredAt;
  if (live.explicit || dwell >= INFO_STACK_DWELL_MS || infoStack.some(r => r.li === live.li)) {
    infoStack = infoStackWith(infoStack, live.li, infoStackClock(), { paused: infoStackPaused, q: ++infoQueueSeq });
    scheduleInfoStackTick();
  }
}
/* The pointer left every layer and the card: shrink to the stack, or close. */
function collapseLayerInfo() {
  retireLiveInfo();
  /* a tab chosen with a click stays on screen; otherwise the card shrinks */
  if (infoStack.length && infoStackActive()) paintLayerInfo(infoPeek || null);
  else hideLayerInfo();
}
function toggleInfoPin(li) {
  if (!li || !infoStackActive()) return;
  const row = infoStack.find(r => r.li === li);
  const next = infoStackPinned(infoStack, li, !(row && row.pinned), infoStackClock(), { paused: infoStackPaused, q: ++infoQueueSeq });
  if (next === infoStack) {
    navMessage(tr("Ya hay {n} fichas fijadas: suelte alguna para fijar otra.", { n: INFO_STACK_MAX_PINNED }));
    return;
  }
  infoStack = next;
  scheduleInfoStackTick();
  if (!descDialog.hidden) renderInfoStack();
}
/* ---------- A pinned card on screen is locked ----------
   Requested: with the card showing a pinned card (the live layer pinned, or a
   pinned tab chosen with a click), hovering other layers of the map does not
   change it, and leaving them all does not shrink it; only a click on another
   tab, an explicit open (ℹ, «Mostrar atributos») or closing the card do. A
   layer the pointer rests on meanwhile joins the stack as a tab without being
   shown (`infoHoverCandidate`), so it can be picked with a click. */
let infoHoverCandidate = null; /* { li, enteredAt, leftAt }: the layer under the pointer while the card is locked */
function infoCardLocked() {
  return !!descLayer && infoStack.some(r => r.li === descLayer && r.pinned);
}
/* The pointer left the candidate: it becomes a tab if it rested on it */
function settleHoverCandidate() {
  const c = infoHoverCandidate;
  if (!c) return;
  infoHoverCandidate = null;
  if (!infoStackActive() || Date.now() - c.enteredAt < INFO_STACK_DWELL_MS) return;
  infoStack = infoStackWith(infoStack, c.li, infoStackClock(), { paused: infoStackPaused, q: ++infoQueueSeq });
  scheduleInfoStackTick();
  if (!descDialog.hidden) renderInfoStack();
}
/* F with the map focused: pins (or unpins) the layer under the pointer, also
   when the card is locked on another one. False when there is none, so the key
   does nothing else. */
function pinLiveLayerInfo() {
  const target = infoHoverCandidate ? infoHoverCandidate.li : liveInfo && liveInfo.li;
  if (descDialog.hidden || !target) return false;
  toggleInfoPin(target);
  return true;
}

/* One-shot guard set when LEAVING a drawing tool (see setTool): the
   double click / mouseup that finishes a polygon or a line/circle
   measurement lands exactly where the cursor is, usually on top of
   some layer, and the mousemove right after fires a genuine mouseover
   there. Consumed by the very next hover, real or not, and also
   expires on its own after TOOL_EXIT_HOVER_GUARD_MS in case no hover
   follows soon — unlike layerInfoDismissed (which stays closed until
   an EXPLICIT reopen), this must not silently turn hover off for the
   rest of the session just because the user drew something once.     */
const TOOL_EXIT_HOVER_GUARD_MS = 300; /* ms */
let suppressNextHover = false;

/* Layer info panel: a KML placemark's description or a GeoJSON
   feature's properties, opened by the row's ℹ button, by hovering the
   layer in the viewer (focus:false, so it never steals the user's
   focus on every hover), or from the context menu. Non-modal
   (.dlg-float): the map stays interactive underneath, and with the
   dialog already open, moving to another layer only updates its
   content, without repositioning or closing the box.                 */
/* Every hide goes through here so focusReturn stays paired with the open
   (showLayerInfo always pushes one entry). Focus is restored only if it
   was in the panel or already lost to <body>: a hover-opened panel that
   times out must not pull focus away from wherever the user is now.   */
/* `clear` (by default, a close the user asked for) also empties the stack of
   recent cards, except the pinned ones; a close that only gets the card out of
   the way (opening the style dialog over it) keeps it for the next time.   */
function hideLayerInfo({ dismiss = false, clear = dismiss } = {}) {
  cancelHoverIntent();
  infoHoverCandidate = null;
  if (descDialog.hidden) return;
  retireLiveInfo();
  if (clear) infoStack = infoStack.filter(r => r.pinned);
  clearInfoPeek();
  const a = document.activeElement;
  const hadFocus = !a || a === document.body || descBox.contains(a);
  descDialog.hidden = true;
  if (dismiss) layerInfoDismissed = true;
  if (hadFocus) releaseFocus(); else focusReturn.pop();
  scheduleInfoStackTick();
}
/* Puts `li`'s card in the body (the live layer, or the recent card whose tab
   is being looked at); with no layer the card shrinks to its title and its
   tabs. The body is
   only rewritten when the layer changes (or on `force`): rewriting it on
   every repaint of the stack would reset its scroll under the reader.     */
function paintLayerInfo(li, html = undefined, force = false) {
  if (li !== descLayer || force) {
    const h = li ? (html === undefined ? infoHtmlFor(li) : html) : null;
    descLayer = h == null ? null : li;
    descTitle.textContent = descLayer ? li._name : tr("Fichas recientes");
    descTitle.title = descTitle.textContent; /* one line (it must not move the tabs): the whole name on hover */
    descBody.innerHTML = descLayer ? h : "";
    descBody.hidden = !descLayer;
    descEditBtn.hidden = !descLayer || !STYLE_EDITABLE_KINDS.has(styleKind(li));
    if (descLayer) applyPropsSplit(); /* el reparto elegido sobrevive al cambio de capa */
  }
  renderInfoStack();
}
/* The card shows `li` as the live layer (under the pointer, or opened on
   purpose); the one it showed before goes to the stack. */
function setLiveInfo(li, focus, enteredAt, html = infoHtmlFor(li)) {
  if (html == null) return;
  if (liveInfo && liveInfo.li !== li) retireLiveInfo();
  infoHoverCandidate = null;
  /* A new live layer ends the choice of a tab (44-dialogs.js) */
  if (infoPeek) { infoPeek = null; setInfoHalo(null); }
  liveInfo = { li, enteredAt, leftAt: null, explicit: focus };
  paintLayerInfo(li, html, true);
  const wasHidden = descDialog.hidden;
  descDialog.hidden = false;
  if (wasHidden) {
    clampToViewport(descBox);
    if (focus) focusDialog(descBox);
    /* Opened by hovering the viewer: closing it must land back there,
       not wherever focus happened to be when the cursor crossed it.   */
    else focusReturn.push(map.getContainer());
  }
}
function showLayerInfo(li, { focus = true } = {}) {
  cancelLayerInfoHide(); /* a real hover cancels any pending deferred close */
  if (!focus && suppressNextHover) { suppressNextHover = false; return; } /* residual hover right after leaving a drawing tool */
  /* While the edit dialog (style/name) is open, hovering must not reopen
     this panel on top of or under it: that would recreate the same
     overlap openStyleDialog already avoids on opening. Same while
     drawing a polygon: the floating panel could sit exactly where the
     user needs to click to fix a vertex inside another polygon, and
     the hover would block it.                                        */
  const hoverBlocked = () => layerInfoDismissed || !styleDialog.hidden || clickPicksPoint();
  if (!focus && hoverBlocked()) return;
  if (focus) layerInfoDismissed = false; /* explicit open: re-arms the hover */
  const html = infoHtmlFor(li);
  if (html == null) return;
  /* Pasar el ratón solo abre la ficha propia de la capa: que un marcador
     sin nada más tenga las horas del sol (con la iluminación activa) no
     debe abrir una ventana cada vez que se cruza uno.                  */
  if (!focus && baseInfoHtml(li) == null) return;
  const now = Date.now();
  if (!focus && !descDialog.hidden && infoCardLocked()) {
    cancelHoverIntent();
    if (li === descLayer) return;
    if (infoHoverCandidate && infoHoverCandidate.li === li) return;
    infoHoverCandidate = { li, enteredAt: now, leftAt: null };
    return;
  }
  if (!focus && liveInfo && !descDialog.hidden) {
    if (liveInfo.li === li) { /* back on the layer already shown */
      cancelHoverIntent();
      liveInfo.leftAt = null;
      return;
    }
    /* Another layer is on the card: it only takes over if the pointer stays */
    if (hoverIntent && hoverIntent.li === li) return;
    cancelHoverIntent();
    hoverIntent = { li, timer: setTimeout(() => {
      hoverIntent = null;
      if (descDialog.hidden || hoverBlocked()) return;
      setLiveInfo(li, false, now);
    }, LAYER_INFO_HOVER_INTENT_MS) };
    return;
  }
  cancelHoverIntent();
  setLiveInfo(li, focus, now, html);
}

/* ================= Deshacer =================
   Instantáneas del árbol completo. Es viable porque serializar cuesta
   poco desde que la geometría se cachea (~5 ms con 8.000 capas) y porque
   las instantáneas COMPARTEN esa geometría en vez de clonarla: lo que
   ocupa es la estructura, no las coordenadas.                        */
const UNDO_MAX = 20;
const undoStack = [];
const redoStack = [];

function pushUndo(label) {
  undoStack.push({ label, nodes: serializeTree() });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  /* Una acción nueva invalida lo rehacible: la historia se bifurca */
  redoStack.length = 0;
}

/* Reconstruye el árbol desde una instantánea */
async function applySnapshot(nodes) {
  clearSelection();
  rootGroup.clearLayers();
  /* La lista viva de cuadrículas se rehace con el árbol: sin esto, cada
     deshacer dejaba las de antes, y una ruta seguía «teniendo» un
     perfil que ya no estaba (findRouteProfile).                      */
  elevGridGroups.length = 0;
  syncElevFontControl(); /* (60-elevation.js) */
  showEmptyMessage();
  if (nodes.length) await restoreTree(nodes);
  scheduleSave();
}
function withUndo(label, fn) {
  pushUndo(label);
  return fn();
}

async function undoLast() {
  const state = undoStack.pop();
  if (!state) { navMessage(tr("No hay nada que deshacer.")); return; }
  /* Antes de retroceder se guarda el presente, que es lo que habrá que
     recuperar al rehacer                                             */
  redoStack.push({ label: state.label, nodes: serializeTree() });
  await applySnapshot(state.nodes);
  navMessage(tr("Deshecho: {label}.", { label: state.label }), { tone: "info" });
}

async function redoLast() {
  const state = redoStack.pop();
  if (!state) { navMessage(tr("No hay nada que rehacer.")); return; }
  undoStack.push({ label: state.label, nodes: serializeTree() });
  await applySnapshot(state.nodes);
  navMessage(tr("Rehecho: {label}.", { label: state.label }), { tone: "info" });
}

/* ---------- Vista guardada (centro y zoom) ----------
   Comparte almacén con el árbol: es otra clave, no otro almacén, así que
   no hace falta subir DB_VERSION. Lleva su propia versión de formato
   porque su contenido no tiene nada que ver con el del árbol.        */
const VIEW_KEY = "view";
const VIEW_SCHEMA = 1;
const BASE_KEY = "bases";
const BASE_SCHEMA = 1;
/* ---------- Tope de vértices editables interactivamente sobre el mapa ----------
   Otra clave del mismo almacén: no hace falta subir DB_VERSION. Depende
   del hardware de quien lo usa (ver VERTEX_EDIT_MAX_DEFAULT en
   43-points-editor.js), así que es una preferencia y no una constante
   fija — se edita en el mismo editor que las asociaciones de nombre de
   GeoJSON (botón 🏷️, gnp-editor).                                    */
const VERTMAX_KEY = "vertexEditMax";
const VERTMAX_SCHEMA = 1;

async function dbSaveVertexEditMax(max) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: VERTMAX_SCHEMA, max }, VERTMAX_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
/* Validado como cualquier otro valor leído: un registro corrupto o un
   0/negativo no debe colar un tope inservible (`beginVertexEdit`
   comparte código para "sin trazo" y "por encima del tope", y un tope
   de 0 desactivaría la edición interactiva para todo el mundo).       */
async function dbLoadVertexEditMax() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(VERTMAX_KEY);
    rq.onsuccess = () => {
      const r = rq.result;
      resolve(r && r.v === VERTMAX_SCHEMA && Number.isInteger(r.max) && r.max > 0 ? r.max : null);
    };
    rq.onerror = () => reject(rq.error);
  });
}

/* Segmentos de un arco (herramienta «Medir arco»): mismo patrón que el
   tope de vértices. Se valida contra el mismo rango que el campo del
   panel (ARC_SEGMENTS_MIN/MAX, 43-points-editor.js).                  */
const ARC_SEGMENTS_KEY = "arcSegments";
const ARC_SEGMENTS_SCHEMA = 1;
async function dbSaveArcSegments(n) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: ARC_SEGMENTS_SCHEMA, n }, ARC_SEGMENTS_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadArcSegments() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(ARC_SEGMENTS_KEY);
    rq.onsuccess = () => {
      const r = rq.result;
      resolve(r && r.v === ARC_SEGMENTS_SCHEMA && Number.isInteger(r.n)
        && r.n >= ARC_SEGMENTS_MIN && r.n <= ARC_SEGMENTS_MAX ? r.n : null);
    };
    rq.onerror = () => reject(rq.error);
  });
}

/* Fuentes de elevación elegidas (Propiedades → Fuentes de datos): un id
   del catálogo ELEV_SOURCES por modelo, o null = «Ninguna». Se valida
   contra el catálogo ACTUAL al leer (validElevSources, 60-elevation.js):
   una fuente retirada del código vuelve a la de por defecto.        */
const ELEV_SOURCES_KEY = "elevSources";
const ELEV_SOURCES_SCHEMA = 1;
async function dbSaveElevSources(sel) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: ELEV_SOURCES_SCHEMA, mdt: sel.mdt, mds: sel.mds }, ELEV_SOURCES_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadElevSources() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(ELEV_SOURCES_KEY);
    rq.onsuccess = () => {
      const r = rq.result;
      resolve(r && r.v === ELEV_SOURCES_SCHEMA ? validElevSources(r) : null);
    };
    rq.onerror = () => reject(rq.error);
  });
}

/* Unidad de medida y formato de latitud/longitud: mismo patrón que
   VERTMAX_KEY/VERTMAX_SCHEMA, ajustes GLOBALES (panel de Propiedades,
   43-points-editor.js) que antes vivían solo en memoria, sin persistir
   entre sesiones, y con un control repetido en varios diálogos
   distintos (`measureUnit`) o propio de uno solo (el formato de
   coordenadas de un marcador) — pedido explícitamente: un único sitio,
   que además recuerde el valor entre sesiones.                       */
const MEASURE_UNIT_KEY = "measureUnit";
const MEASURE_UNIT_SCHEMA = 1;
const MEASURE_UNITS = ["m", "km", "ft", "mi", "nm"];
async function dbSaveMeasureUnit(unit) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: MEASURE_UNIT_SCHEMA, unit }, MEASURE_UNIT_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadMeasureUnit() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(MEASURE_UNIT_KEY);
    rq.onsuccess = () => {
      const r = rq.result;
      resolve(r && r.v === MEASURE_UNIT_SCHEMA && MEASURE_UNITS.includes(r.unit) ? r.unit : null);
    };
    rq.onerror = () => reject(rq.error);
  });
}

/* Unidad de las ALTITUDES (celdas de elevación, cuadro de coordenadas,
   perfil de una ruta), independiente de la de distancias: en
   aeronáutica se mide en millas náuticas y se sube en pies. Mismas
   cinco unidades que la de distancia.                                 */
const ALTITUDE_UNIT_KEY = "altitudeUnit";
const ALTITUDE_UNIT_SCHEMA = 1;
const validAltitudeUnit = r =>
  (r && r.v === ALTITUDE_UNIT_SCHEMA && MEASURE_UNITS.includes(r.unit) ? r.unit : null);
async function dbSaveAltitudeUnit(unit) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: ALTITUDE_UNIT_SCHEMA, unit }, ALTITUDE_UNIT_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadAltitudeUnit() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(ALTITUDE_UNIT_KEY);
    rq.onsuccess = () => resolve(validAltitudeUnit(rq.result));
    rq.onerror = () => reject(rq.error);
  });
}

/* Longitud máxima de una ruta para obtener su perfil, en METROS (se
   enseña en la unidad de distancia). Acota lo que un perfil descarga y,
   sobre todo, lo que deja guardado en el árbol: una celda por cada una
   recorrida. Fuera de [PROFILE_MAX_MIN, PROFILE_MAX_MAX] se descarta. */
const PROFILE_MAX_KEY = "profileMax";
const PROFILE_MAX_SCHEMA = 1;
const validProfileMax = r =>
  (r && r.v === PROFILE_MAX_SCHEMA && Number.isFinite(r.m)
    && r.m >= PROFILE_MAX_MIN && r.m <= PROFILE_MAX_MAX ? r.m : null);
async function dbSaveProfileMax(m) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: PROFILE_MAX_SCHEMA, m }, PROFILE_MAX_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadProfileMax() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(PROFILE_MAX_KEY);
    rq.onsuccess = () => resolve(validProfileMax(rq.result));
    rq.onerror = () => reject(rq.error);
  });
}

/* Frecuencia del elipsoide de Fresnel, en MHz (pestaña «Frecuencias» de
   Propiedades). Fuera de [FRESNEL_FREQ_MIN, FRESNEL_FREQ_MAX] se descarta. */
const FRESNEL_FREQ_KEY = "fresnelFreq";
const FRESNEL_FREQ_SCHEMA = 1;
const validFresnelFreq = r =>
  (r && r.v === FRESNEL_FREQ_SCHEMA && Number.isFinite(r.f)
    && r.f >= FRESNEL_FREQ_MIN && r.f <= FRESNEL_FREQ_MAX ? r.f : null);
async function dbSaveFresnelFreq(f) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: FRESNEL_FREQ_SCHEMA, f }, FRESNEL_FREQ_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadFresnelFreq() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(FRESNEL_FREQ_KEY);
    rq.onsuccess = () => resolve(validFresnelFreq(rq.result));
    rq.onerror = () => reject(rq.error);
  });
}

/* Tamaño máximo descomprimido de un KMZ o .zip, en MB enteros (Propiedades →
   Preferencias; ver loadZipChecked en 33-kml-import.js). Clave propia del
   almacén `tree`, como la frecuencia de Fresnel; no sube DB_VERSION ni
   TREE_SCHEMA. Validado al leer: fuera de rango o no entero se descarta y
   queda el de partida.                                                   */
const KMZ_MAX_KEY = "kmzMaxUncompressed";
const KMZ_MAX_SCHEMA = 1;
const validKmzMax = r =>
  (r && r.v === KMZ_MAX_SCHEMA && Number.isInteger(r.mb)
    && r.mb >= KMZ_MAX_UNCOMPRESSED_MIN_MB && r.mb <= KMZ_MAX_UNCOMPRESSED_MAX_MB ? r.mb : null);
async function dbSaveKmzMax(mb) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: KMZ_MAX_SCHEMA, mb }, KMZ_MAX_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadKmzMax() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(KMZ_MAX_KEY);
    rq.onsuccess = () => resolve(validKmzMax(rq.result));
    rq.onerror = () => reject(rq.error);
  });
}

/* Tamaño de las cifras de las celdas de elevación (botones A− / A+, ver
   ElevFontControl en 60-elevation.js): un ÍNDICE de ELEV_FONT_STEPS. Clave
   propia del almacén `tree`, como la frecuencia de Fresnel; no sube
   DB_VERSION ni TREE_SCHEMA. Validado al leer: un índice que ya no existe
   (escalones cambiados) vuelve al de partida.                            */
const ELEV_FONT_KEY = "elevFont";
const ELEV_FONT_SCHEMA = 1;
const validElevFont = r =>
  (r && r.v === ELEV_FONT_SCHEMA && Number.isInteger(r.step) && r.step >= 0 && r.step < ELEV_FONT_STEPS.length ? r.step : null);
async function dbSaveElevFont(step) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: ELEV_FONT_SCHEMA, step }, ELEV_FONT_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadElevFont() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(ELEV_FONT_KEY);
    rq.onsuccess = () => resolve(validElevFont(rq.result));
    rq.onerror = () => reject(rq.error);
  });
}

/* Position and size of the info card (#desc-dialog), kept across reloads
   (requested). Only what the user set: left/top after dragging it by its
   title (the box goes position: fixed, makeDialogMovable), width/height after
   resizing it (the inline style the resize handle writes); null for what was
   never touched, which keeps the default. Own key of the `tree` store: no
   DB_VERSION or TREE_SCHEMA bump. Validated on reading (another tab or an old
   version may have written anything): finite numbers, left and top together,
   sizes of at least INFO_BOX_MIN_PX. Off-screen is fixed when the card opens
   (clampToViewport), not here: the window may be another size by then. */
const INFO_BOX_KEY = "infoBox";
const INFO_BOX_SCHEMA = 1;
const INFO_BOX_MIN_PX = 120;
const INFO_BOX_MAX_PX = 20000;
function validInfoBox(r) {
  if (!r || typeof r !== "object" || r.v !== INFO_BOX_SCHEMA) return null;
  const pos = n => n === null || (Number.isFinite(n) && Math.abs(n) <= INFO_BOX_MAX_PX);
  const size = n => n === null || (Number.isFinite(n) && n >= INFO_BOX_MIN_PX && n <= INFO_BOX_MAX_PX);
  if (!pos(r.left) || !pos(r.top) || !size(r.width) || !size(r.height)) return null;
  if ((r.left === null) !== (r.top === null)) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}
async function dbSaveInfoBox(geom) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: INFO_BOX_SCHEMA, ...geom }, INFO_BOX_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadInfoBox() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(INFO_BOX_KEY);
    rq.onsuccess = () => resolve(validInfoBox(rq.result));
    rq.onerror = () => reject(rq.error);
  });
}

const COORD_FORMAT_KEY = "coordFormat";
const COORD_FORMAT_SCHEMA = 1;
async function dbSaveCoordFormat(fmt) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: COORD_FORMAT_SCHEMA, fmt }, COORD_FORMAT_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
/* Tema de la interfaz: "auto" sigue al sistema (prefers-color-scheme),
   "light"/"dark" lo fuerzan. Va aquí y no con la variable (43-points-
   editor.js) porque dbLoadUiTheme lo necesita para validar.            */
const UI_THEMES = ["auto", "light", "dark"];
const UI_THEME_KEY = "uiTheme";
const UI_THEME_SCHEMA = 1;
async function dbSaveUiTheme(theme) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: UI_THEME_SCHEMA, theme }, UI_THEME_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadUiTheme() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(UI_THEME_KEY);
    rq.onsuccess = () => {
      const r = rq.result;
      resolve(r && r.v === UI_THEME_SCHEMA && UI_THEMES.includes(r.theme) ? r.theme : null);
    };
    rq.onerror = () => reject(rq.error);
  });
}
/* Qué eligió quien abrió la aplicación desde un móvil ante el aviso de
   «mejor desde un ordenador» (50-splitter.js): "map" = continuar solo con
   el mapa, "nav" = cerrar el aviso y quedarse con la navegación. Se
   recuerda para no volver a preguntar en cada carga.                    */
const MOBILE_VIEWS = ["map", "nav"];
const MOBILE_VIEW_KEY = "mobileView";
const MOBILE_VIEW_SCHEMA = 1;
async function dbSaveMobileView(choice) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: MOBILE_VIEW_SCHEMA, choice }, MOBILE_VIEW_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadMobileView() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(MOBILE_VIEW_KEY);
    rq.onsuccess = () => {
      const r = rq.result;
      resolve(r && r.v === MOBILE_VIEW_SCHEMA && MOBILE_VIEWS.includes(r.choice) ? r.choice : null);
    };
    rq.onerror = () => reject(rq.error);
  });
}
async function dbLoadCoordFormat() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(COORD_FORMAT_KEY);
    rq.onsuccess = () => {
      const r = rq.result;
      resolve(r && r.v === COORD_FORMAT_SCHEMA && (r.fmt === "dec" || r.fmt === "dms") ? r.fmt : null);
    };
    rq.onerror = () => reject(rq.error);
  });
}

async function dbSaveBases(rec) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: BASE_SCHEMA, ...rec }, BASE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadBases() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(BASE_KEY);
    rq.onsuccess = () => {
      const rec = rq.result;
      resolve(rec && rec.v === BASE_SCHEMA && rec.bases ? rec : null);
    };
    rq.onerror = () => reject(rq.error);
  });
}

/* ---------- Color de fondo del mapa ----------
   Otra clave del mismo almacén: no hace falta subir DB_VERSION. Sin
   valor guardado (nunca se tocó, o el árbol viene de antes de este
   cambio) `dbLoadMapBackground` devuelve null y el mapa se queda con el
   color por defecto que ya trae el CSS (`#dfe8ef`) — compatibilidad
   hacia atrás sin migrar nada.                                       */
const MAPBG_KEY = "mapBackground";
const MAPBG_SCHEMA = 1;

async function dbSaveMapBackground(color) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: MAPBG_SCHEMA, color }, MAPBG_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
/* Validado como cualquier otro valor leído (ver la vista guardada):
   un registro corrupto no debe colar un `background` inválido.       */
async function dbLoadMapBackground() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(MAPBG_KEY);
    rq.onsuccess = () => {
      const rec = rq.result;
      resolve(rec && rec.v === MAPBG_SCHEMA && /^#[0-9a-f]{6}$/i.test(rec.color) ? rec.color : null);
    };
    rq.onerror = () => reject(rq.error);
  });
}

/* ---------- Credencial de Sentinel Hub ----------
   Otra clave del mismo almacén. Es del usuario y solo vive en su
   navegador: nunca se serializa con el árbol ni viaja en un .kite.json
   exportado, que se comparte.                                         */
const SH_KEY = "shCreds";
const SH_SCHEMA = 1;

async function dbSaveSh(rec) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: SH_SCHEMA, ...rec }, SH_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
/* Borrar la credencial RETIRA la clave, no guarda un registro vacío:
   una credencial retirada no debe dejar rastro en el almacén.        */
async function dbDeleteSh() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).delete(SH_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadSh() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(SH_KEY);
    rq.onsuccess = () => {
      const rec = rq.result;
      resolve(rec && rec.v === SH_SCHEMA && typeof rec.instanceId === "string" ? rec : null);
    };
    rq.onerror = () => reject(rq.error);
  });
}

/* ---------- Servidor de teselas de "Custom Tile Map Service" ----------
   Otra clave del mismo almacén, mismo criterio que la credencial de
   Sentinel Hub: es del usuario (su propio servidor de teselas, típico
   caso: una caché/proxy delante de OpenStreetMap u otro servicio) y
   solo vive en su navegador — nunca se serializa con el árbol ni viaja
   en un .kite.json exportado.                                        */
const CUSTOM_TILES_KEY = "customTilesUrl";
const CUSTOM_TILES_SCHEMA = 1;

async function dbSaveCustomTilesUrl(rec) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: CUSTOM_TILES_SCHEMA, ...rec }, CUSTOM_TILES_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
/* Borrar la URL RETIRA la clave, no guarda un registro vacío: mismo
   criterio que dbDeleteSh.                                            */
async function dbDeleteCustomTilesUrl() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).delete(CUSTOM_TILES_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadCustomTilesUrl() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(CUSTOM_TILES_KEY);
    rq.onsuccess = () => {
      const rec = rq.result;
      resolve(rec && rec.v === CUSTOM_TILES_SCHEMA && typeof rec.url === "string" ? rec : null);
    };
    rq.onerror = () => reject(rq.error);
  });
}

/* ---------- Servidor de "Custom Web Map Service" ----------
   Mismo criterio que el de teselas de arriba: la dirección del WMS es
   del usuario, vive solo en su navegador y no viaja en un .kite.json.  */
const CUSTOM_WMS_KEY = "customWmsUrl";
const CUSTOM_WMS_SCHEMA = 1;

async function dbSaveCustomWmsUrl(rec) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: CUSTOM_WMS_SCHEMA, ...rec }, CUSTOM_WMS_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDeleteCustomWmsUrl() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).delete(CUSTOM_WMS_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadCustomWmsUrl() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(CUSTOM_WMS_KEY);
    rq.onsuccess = () => {
      const rec = rq.result;
      resolve(rec && rec.v === CUSTOM_WMS_SCHEMA && typeof rec.url === "string" ? rec : null);
    };
    rq.onerror = () => reject(rq.error);
  });
}

/* ---------- Nombres de GeoJSON recordados por forma de properties ----------
   Otra clave del mismo almacén: huella (JSON de las claves de properties,
   ordenadas) → ARRAY ORDENADO de claves que el usuario eligió para
   componer el nombre (se unen con " / "). Un archivo futuro con la misma
   forma de properties (esta sesión u otra) lo aplica sin preguntar.
   v2: el valor pasó de una clave (string) a un array; lo guardado en v1
   se descarta al leer.                                               */
const GNP_KEY = "geojsonNameProps";
const GNP_SCHEMA = 2;

async function dbSaveGnp(map) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: GNP_SCHEMA, map }, GNP_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadGnp() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(GNP_KEY);
    rq.onsuccess = () => {
      const rec = rq.result;
      const out = {};
      if (rec && rec.v === GNP_SCHEMA && rec.map && typeof rec.map === "object") {
        for (const [fp, keys] of Object.entries(rec.map)) {
          if (Array.isArray(keys) && keys.length && keys.every(k => typeof k === "string")) out[fp] = keys;
        }
      }
      resolve(out);
    };
    rq.onerror = () => reject(rq.error);
  });
}

async function dbSaveView(rec) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readwrite");
    tx.objectStore(DB_TREE).put({ v: VIEW_SCHEMA, ...rec }, VIEW_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function dbLoadView() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_TREE, "readonly");
    const rq = tx.objectStore(DB_TREE).get(VIEW_KEY);
    rq.onsuccess = () => resolve(validView(rq.result));
    rq.onerror = () => reject(rq.error);
  });
}

/* Lo guardado puede venir de otra versión, de otra pantalla o
   directamente corrupto: se comprueba antes de mover la vista, porque un
   valor absurdo dejaría el mapa en un sitio del que no se sale.      */
function validView(rec) {
  if (!rec || rec.v !== VIEW_SCHEMA) return null;
  const { lat, lng, zoom } = rec;
  /* `Number.isFinite` no convierte: un "12" guardado por error se
     rechaza en vez de colarse como número                          */
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) return null;
  if (Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  if (zoom < 0 || zoom > 25) return null;
  return { lat, lng, zoom };
}

/* Lee el árbol y sus segmentos y, en la MISMA transacción, borra los
   segmentos muertos y funde los pequeños (segmentPlan). Tiene que ser la
   misma: un archivo soltado mientras arranca la aplicación guarda sus
   segmentos en una transacción posterior, y una limpieza hecha aparte
   podría verlos sin nadie que los nombre y borrarlos.               */
async function dbLoadTree() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([DB_TREE, DB_SEGMENTS], "readwrite");
    const st = tx.objectStore(DB_TREE);
    const segStore = tx.objectStore(DB_SEGMENTS);
    let rec, keys, nodes = null, missing = 0;
    const rqRoot = st.get("root");
    const rqKeys = segStore.getAllKeys();
    const rqVals = segStore.getAll();
    rqRoot.onsuccess = () => { rec = rqRoot.result; };
    rqKeys.onsuccess = () => { keys = rqKeys.result; };
    /* Las peticiones de una transacción terminan en orden: aquí ya están
       las otras dos.                                                  */
    rqVals.onsuccess = () => {
      const segs = new Map(keys.map((k, i) => [k, rqVals.result[i]]));
      /* v8 y v7 se leen tal cual: ya son un v9 válido, solo se han ido
         añadiendo tipos de nodo (ver TREE_SCHEMA v8 y v9)             */
      if (rec && (rec.v === TREE_SCHEMA || rec.v === 8 || rec.v === 7)) nodes = rec.nodes;
      /* Excepción deliberada (ver TREE_SCHEMA v7): un árbol v6 no se
         descarta, se sube en silencio. scheduleSave() lo dejará ya en
         v7 en cuanto el árbol restaurado sufra cualquier mutación.  */
      else if (rec && rec.v === 6) nodes = upgradeMeasuresV6(rec.nodes);
      /* Versión distinta: se descarta el árbol, pero solo el árbol; la
         vista guardada es independiente y sigue siendo válida. El
         usuario pierde lo que tuviera cargado, así que el aviso es
         sticky (exige "Aceptar"), igual que un resumen de importación
         con elementos omitidos.                                     */
      else if (rec) {
        st.delete("root");
        navMessage(tr("El árbol guardado en este navegador es de una versión "
          + "anterior, incompatible con esta, y se ha eliminado."),
          { sticky: true });
      }
      const plan = segmentPlan(nodes || [], new Map([...segs].map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])));
      for (const seg of plan.drop) { segStore.delete(seg); segs.delete(seg); }
      if (plan.compact.length) {
        const segId = newStoreId();
        const entries = compactSegments(nodes, segs, plan.compact, segId);
        for (const seg of plan.compact) { segStore.delete(seg); segs.delete(seg); }
        segs.set(segId, entries);
        segStore.put(entries, segId);
        /* Las refs del esqueleto cambiaron: se reescribe AHORA, antes de
           que joinPayloads le devuelva la parte pesada (el clon del put
           se hace en el acto).                                       */
        st.put({ v: TREE_SCHEMA, nodes }, "root");
      }
      if (nodes) {
        missing = joinPayloads(nodes, segs, (key, disc, ref) => rememberPayload(payloadsKnown, key, disc, ref));
      }
    };
    tx.oncomplete = () => {
      if (missing) {
        navMessage(trn(missing,
          "Faltan en el almacenamiento los datos de {n} capa guardada; se ha quitado del árbol.",
          "Faltan en el almacenamiento los datos de {n} capas guardadas; se han quitado del árbol."),
          { sticky: true });
      }
      resolve(nodes);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* ---------- Serialización del árbol de navegación ----------
   Serializing one node is its own function because the same records feed
   two consumers: the automatic save of the whole tree and the export of a
   single folder to a file.                                             */
function serializeNode(li) {
  if (li._name === undefined) return []; /* mensajes tipo "Sin geometrías" */
  const chk = li.querySelector(":scope > .node-row > input[type=checkbox]");
  const base = { name: li._name, checked: chk ? chk.checked : true };
  if (li._measure) {
    return [{ ...base, t: "measure", mtype: li._measure.type, style: li._style,
              waypoints: measureWaypoints(li._measure) }];
  }
  if (li._elevGrid) {
    const rec = { ...base, t: "elevGrid", cells: li._elevGrid.cells };
    if (li._elevGrid.profile) rec.profile = li._elevGrid.profile; /* perfil de ruta */
    return [rec];
  }
  if (li._imageOverlay) {
    const o = li._imageOverlay;
    return [{ ...base, t: "imageOverlay", box: o.box, dataUrl: o.dataUrl, opacity: o.opacity }];
  }
  if (li._cog) {
    const c = li._cog;
    return [{ ...base, t: "cog", rasterId: c.rasterId, box: c.box, opacity: c.opacity }];
  }
  /* Un servicio ArcGIS y sus capas son contenedores con forma propia: van
     ANTES de la rama de carpeta, que los guardaría como una carpeta más. */
  if (li._arcgisLayer) {
    const rec = { ...base, t: "arcgisLayer", id: li._arcgisLayer.id };
    if (li._arcgisLayer.data) rec.data = true;
    if (li._isContainer) {
      rec.collapsed = li.classList.contains("collapsed");
      rec.children = serializeChildren(li, nodeUl(li));
    }
    return [rec];
  }
  if (li._arcgis) {
    const a = li._arcgis;
    return [{ ...base, t: "arcgis", collapsed: li.classList.contains("collapsed"), url: a.url,
              opacity: a.opacity, tile: a.tile, extent: a.extent, attribution: a.attribution,
              children: serializeChildren(li, nodeUl(li)) }];
  }
  /* li._isContainer evita este querySelector en toda capa hoja (la
     inmensa mayoría de los nodos de un árbol grande): solo carpetas y
     archivos pueden tener un <ul class="node-list"> de verdad.       */
  const ul = li._isContainer ? nodeUl(li) : null;
  if (ul) {
    /* Una carpeta nunca desplegada no tiene hijos reales que recorrer
       (ul está vacío a propósito, ver materializeRecords/li._pending):
       se serializa directamente desde los registros, sin construir ni
       una sola fila — coste casi nulo para lo que nadie ha llegado a
       abrir.                                                          */
    const children = serializeChildren(li, ul);
    const rec = { ...base, t: li.classList.contains("file") ? "file" : "folder",
                  collapsed: li.classList.contains("collapsed"), children };
    if (li._appSection) rec.sec = true; /* sección creada por la aplicación */
    return [rec];
  }
  /* `toGeoJSON()` clona TODAS las coordenadas de la capa. Hacerlo en cada
     guardado (y se guarda tras cualquier cambio del panel) suponía
     rehacer el archivo entero por renombrar un nodo. La geometría solo
     cambia al mover un marcador, así que se calcula una vez y se
     invalida ahí: ver `invalidateGeo`.                                */
  if (!li._geo) li._geo = chk._layer.toGeoJSON();
  const rec = { ...base, t: "layer", style: li._style, geo: li._geo };
  if (li._mstyle) rec.mstyle = li._mstyle; /* marker style, if customized */
  if (li._desc) rec.desc = li._desc;       /* ficha original del archivo   */
  return [rec];
}
const serializeNodes = ul => [...ul.children].flatMap(serializeNode);

/* ---------- Carpetas a medio construir ----------
   Una carpeta puede tener filas Y registros pendientes a la vez: lo que el
   filtro del panel pidió (materializeMatching, 31-tree-node.js) es una fila
   y el resto sigue en `li._pending`. Son conjuntos DISJUNTOS —un registro
   que se construye sale de `_pending`—, así que lo que ya recorría los dos
   (containerState, cascadeVisibility, removeSubtreeFromMap, findMatches…)
   no cuenta nada dos veces. Lo que no podía con eso era guardar y colocar:

   - Guardar: se tomaban los hijos de `_pending` O del DOM, nunca de los dos,
     y se perdía uno de los dos conjuntos (ya pasaba al soltar un archivo en
     una carpeta colapsada con pendientes).
   - Colocar: construir solo algunas filas las dejaba fuera de su sitio.

   Ambos se resuelven con la posición ORIGINAL de cada registro (`rec._pos`,
   su índice en el nivel antes de partirlo, que la fila hereda en `li._pos`).
   `ensurePos` la asigna una sola vez por nivel.                           */
function ensurePos(records) {
  if (records.length && records[0]._pos === undefined) records.forEach((r, i) => { r._pos = i; });
}

/* Parte `records` en lo elegido y el resto, conservando el orden de cada
   mitad. Pura: no construye nada.                                       */
function splitPending(records, only) {
  ensurePos(records);
  const chosen = [], rest = [];
  for (const rec of records) (only(rec) ? chosen : rest).push(rec);
  return { chosen, rest };
}

/* Coloca las filas nuevas de un nivel en el sitio que les toca por `_pos`
   mezclando dos listas ya ordenadas: las que hay en el <ul> y las que
   llegan (en orden). Con un ancla que avanza solo hacia delante cuesta
   O(1) por fila, no O(filas ya puestas) —con 20 000 y una fila cada 500, la
   búsqueda lineal de cada una sería N × x—. Devuelve null si el nivel nunca
   se partió (sin `_pos`): ahí se añade al final, como siempre. Una fila sin
   `_pos` (un pin o un archivo soltado después) cuenta como «al final».    */
function placementAnchor(parentUl, records) {
  if (!records.length || records[0]._pos === undefined) return null;
  let anchor = parentUl.firstElementChild;
  return (li, pos) => {
    /* Si el usuario borró la fila ancla mientras cedíamos el hilo, se vuelve a empezar */
    if (anchor && anchor.parentNode !== parentUl) anchor = parentUl.firstElementChild;
    while (anchor && anchor._pos !== undefined && anchor._pos < pos) anchor = anchor.nextElementSibling;
    parentUl.insertBefore(li, anchor); /* ancla nula = al final */
  };
}

/* Los hijos de un contenedor, listos para guardar. Solo filas: lo de siempre;
   solo pendientes: lo de siempre (sin construir ni una fila); LAS DOS COSAS:
   se fusionan por posición original. Si el usuario reordenó a mano las filas
   construidas (sus `_pos` ya no crecen en el DOM), no hay una posición que
   respetar: filas en el orden en que están y luego los pendientes.       */
function serializeChildren(li, ul) {
  if (!li._pending) return serializeNodes(ul);
  if (!ul || !ul.firstElementChild) return serializePendingRecords(li._pending);
  const pend = li._pending;
  ensurePos(pend);
  const pendOut = serializePendingRecords(pend); /* en paralelo a `pend` */
  const rows = [...ul.children].filter(c => c._name !== undefined);
  const rowOut = rows.map(serializeNode);
  const pos = r => r._pos === undefined ? Infinity : r._pos;
  let last = -1, ordered = true;
  for (const r of rows) { if (pos(r) < last) { ordered = false; break; } last = pos(r); }
  if (!ordered) return [...rowOut.flat(), ...pendOut];
  const out = [];
  let i = 0, j = 0;
  while (i < rows.length || j < pend.length) {
    if (j < pend.length && (i >= rows.length || pend[j]._pos < pos(rows[i]))) out.push(pendOut[j++]);
    else out.push(...rowOut[i++]);
  }
  return out;
}

/* Gemela de serializeNode/serializeNodes, pero sobre registros pendientes
   (li._pending) en vez de filas del DOM: misma forma de salida exacta,
   así que un árbol restaurado nunca se distingue de uno recién
   importado por cómo quedó serializado (test diferencial en
   tests/lazytree.js). geo se calcula perezosamente y se cachea EN EL
   REGISTRO (rec.geo ||= …), la misma disciplina que li._geo, para que
   una carpeta nunca desplegada solo pague ese coste una vez, la
   primera vez que de verdad hace falta guardarla.                     */
function serializePendingRecords(records) {
  return records.map(rec => {
    if (rec.t === "folder" || rec.t === "file") {
      const out = { name: rec.name, checked: rec.checked, t: rec.t,
                    collapsed: rec.collapsed, children: serializePendingRecords(rec.children) };
      if (rec.sec) out.sec = true;
      return out;
    }
    if (rec.t === "layer") {
      if (!rec.geo) rec.geo = rec._layer.toGeoJSON();
      const out = { name: rec.name, checked: rec.checked, t: "layer", style: rec.style, geo: rec.geo };
      if (rec.mstyle) out.mstyle = rec.mstyle;
      if (rec.desc) out.desc = rec.desc;
      return out;
    }
    if (rec.t === "measure") {
      /* Posición siempre en vivo: los manejadores son arrastrables
         sobre el mapa aunque la fila siga pendiente (ver
         buildMeasureRecord), así que cachear los waypoints se quedaría
         obsoleto.                                                     */
      return { name: rec.name, checked: rec.checked, t: "measure", mtype: rec.mtype,
                style: rec.style, waypoints: measureWaypoints(rec._m) };
    }
    if (rec.t === "elevGrid") {
      const out = { name: rec.name, checked: rec.checked, t: "elevGrid", cells: rec.cells };
      if (rec.profile) out.profile = rec.profile;
      return out;
    }
    if (rec.t === "cog") {
      return { name: rec.name, checked: rec.checked, t: "cog",
                rasterId: rec.rasterId, box: rec.box, opacity: rec.opacity };
    }
    /* Explícitos: lo que no se reconozca cae en el último caso, el de
       una ortofoto de KMZ, y un servicio saldría estropeado.          */
    if (rec.t === "arcgis") {
      return { name: rec.name, checked: rec.checked, t: "arcgis", collapsed: rec.collapsed, url: rec.url,
                opacity: rec.opacity, tile: rec.tile, extent: rec.extent, attribution: rec.attribution,
                children: serializePendingRecords(rec.children) };
    }
    if (rec.t === "arcgisLayer") {
      const out = { name: rec.name, checked: rec.checked, t: "arcgisLayer", id: rec.id };
      if (rec.data) out.data = true;
      if (rec.children) { out.collapsed = rec.collapsed; out.children = serializePendingRecords(rec.children); }
      return out;
    }
    /* rec.t === "imageOverlay" */
    return { name: rec.name, checked: rec.checked, t: "imageOverlay",
              box: rec.box, dataUrl: rec.dataUrl, opacity: rec.opacity };
  });
}
function serializeTree() {
  if (!rootUl || !rootUl.isConnected) return [];
  return serializeNodes(rootUl);
}

/* ---------- Exportar e importar carpetas ----------
   The exported file is the very same record format the tree is saved
   with, wrapped in a small envelope that states which versions produced
   it. Importing therefore costs nothing beyond `buildRecordsFromStorage`
   + `materializeRecords`, and a
   file written by another format version can be rejected outright
   instead of migrated (see the no-backwards-compatibility principle).  */
const EXPORT_KIND = "kite-local/tree";
const EXPORT_EXT = ".kite.json";
/* Versión del FORMATO DE ARCHIVO, independiente de TREE_SCHEMA (que
   versiona los registros) y de DB_VERSION (que versiona los almacenes).
   Se sube cuando cambia el envoltorio; al importar, un archivo con una
   versión distinta se rechaza en vez de intentar adivinar su contenido. */
const EXPORT_FORMAT = 1;

const safeFileName = name =>
  String(name).replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80) || "carpeta";

/* El envoltorio, en un solo sitio: lo comparten guardar una carpeta en
   un archivo y copiar al portapapeles del sistema. Son el mismo
   formato a propósito — pegar en otra pestaña cuesta entonces lo mismo
   que importar un .kite.json, y las comprobaciones de versión ya
   escritas valen para los dos.                                       */
function treeExportDoc(nodes) {
  return {
    app: EXPORT_KIND,
    format: EXPORT_FORMAT,
    db: DB_VERSION,
    schema: TREE_SCHEMA,
    generator: `KITE Local ${BUILD}`,
    exported: new Date().toISOString(),
    nodes
  };
}

function exportNode(li) {
  const { nodes, left } = withoutCogNodes(serializeNode(li));
  if (left.length) {
    navMessage(trn(left.length, "Las ortofotos COG no se exportan (pueden ocupar gigas): se queda fuera {names}.",
      "Las ortofotos COG no se exportan (pueden ocupar gigas): se quedan fuera {names}.",
      { names: left.map(n => `\u00AB${n}\u00BB`).join(", ") }), { sticky: true, tone: "info" });
  }
  if (!nodes.length) { navMessage(tr("No hay nada que descargar en este nodo.")); return; }
  const doc = treeExportDoc(nodes);
  downloadBlob(new Blob([JSON.stringify(doc)], { type: "application/json" }), safeFileName(li._name) + EXPORT_EXT);
}

/* Todas las descargas de la aplicación (.kite.json, KML, GeoJSON, PNG…)
   pasan por aquí: la limpieza del blob y el aviso son los mismos.     */
function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  /* Algunos navegadores leen el blob después de volver de click():
     revocarlo en el acto cancela la descarga. Se libera más tarde.  */
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  navMessage(tr("Descargado \u00AB{download}\u00BB.", { download: fileName }), { tone: "info" }); /* confirma lo pedido: notificación, no alerta */
}

/* Quita los nodos "cog" de unos registros serializados, a cualquier
   profundidad, y dice cuáles eran. Un .kite.json o el portapapeles
   del sistema llevan el árbol en texto: los bytes de una ortofoto
   (cientos de MB) no caben ahí, y una referencia a un almacén de ESTE
   navegador no sirve en otro. PURA.                                  */
function withoutCogNodes(nodes) {
  const left = [];
  const strip = list => list.flatMap(n => {
    if (n.t === "cog") { left.push(n.name); return []; }
    return n.children ? [{ ...n, children: strip(n.children) }] : [n];
  });
  return { nodes: strip(nodes), left };
}

/* Recognizes an exported tree among the dropped .json files; anything
   else falls through to the GeoJSON reader                            */
function parseTreeExport(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return null; }
  return doc && doc.app === EXPORT_KIND && Array.isArray(doc.nodes) ? doc : null;
}

const countRecords = nodes => nodes.reduce((n, r) =>
  n + (r.children ? countRecords(r.children) : 1), 0);

/* Imported folders are always added: nothing is replaced or merged, so
   it is the user who decides which copy to keep                       */
async function importTreeExport(doc, fileName, insertBefore, dropTargetUl = null) {
  /* Dos comprobaciones distintas: el envoltorio y los registros */
  const format = doc.format === undefined ? 0 : doc.format;
  if (format !== EXPORT_FORMAT) {
    throw new Error(tr("archivo de formato v{format}, incompatible con el actual v{exportFormat}", { format, exportFormat: EXPORT_FORMAT }));
  }
  /* Misma excepci\u00F3n deliberada que dbLoadTree (ver TREE_SCHEMA v7):
     un .kite.json exportado por una v6 se sube en silencio en vez de
     rechazarse.                                                      */
  if (doc.schema === 6) upgradeMeasuresV6(doc.nodes);
  else if (doc.schema !== TREE_SCHEMA && doc.schema !== 8 && doc.schema !== 7) { /* v8 = v9 sin servicios ArcGIS; v7 = v8 sin COG */
    throw new Error(tr("formato de \u00E1rbol v{schema}, incompatible con el actual v{treeSchema}", { schema: doc.schema, treeSchema: TREE_SCHEMA }));
  }
  if (!doc.nodes.length) throw new Error(tr("el archivo no contiene ning\u00FAn nodo"));
  const ul = dropTargetUl || ensureRootUl();
  const before = new Set(ul.children);
  const total = countRecords(doc.nodes);
  const prog = total > PROGRESS_BATCH ? {
    done: 0,
    update: d => progress.set(100 * d / total, tr("Construyendo {fileName}\u2026 ({d}/{total})", { fileName, d, total }))
  } : null;
  /* Lo que llega de un archivo ajeno no consulta ningún servidor sin que
     el usuario lo encienda (ver buildArcgisRecord) */
  const foreign = { hosts: new Set() };
  try {
    const records = await buildRecordsFromStorage(doc.nodes, prog, { foreign });
    await materializeRecords(records, ul);
  } finally {
    if (prog) progress.hide();
  }
  arcgisForeignNotice(foreign);
  /* Honour the drop position: move whatever was just appended */
  if (insertBefore && insertBefore.parentElement === ul) {
    for (const li of [...ul.children]) {
      if (!before.has(li)) ul.insertBefore(li, insertBefore);
      refreshChecksFrom(ul);
    }
  }
}

let saveTimer = null;
let saveChain = Promise.resolve(); /* cola: los guardados nunca se solapan */
let savePending = false;
let saveCost = 0; /* lo que tardó el último guardado, en ms */

const SAVE_MIN_MS = 400, SAVE_MAX_MS = 3000;

/* El retardo se ajusta solo: en un árbol pequeño guarda casi al instante,
   y en uno de miles de nodos espera más para no repetir un trabajo caro
   mientras el usuario sigue navegando o escribiendo.                   */
function scheduleSave() {
  if (dbWiped) return; /* se está borrando la base: nada que guardar */
  scheduleReorder(); /* toda mutación del árbol también puede haber cambiado el orden de pintado */
  scheduleArcgisSync(); /* y, de un servicio ArcGIS, qué capas pide al servidor (66-arcgis.js) */
  refreshInfoStack(); /* a deleted or renamed layer leaves or renames its row in the info card's stack */
  clearTimeout(saveTimer);
  const wait = Math.min(SAVE_MAX_MS, Math.max(SAVE_MIN_MS, saveCost * 4));
  saveTimer = setTimeout(saveTree, wait);
}

/* Serializing the writes matters because IndexedDB transactions can
   complete out of order: two overlapping saves could leave the older
   snapshot on disk. The tree is serialized when its turn comes, so the
   state written is always the most recent one.                       */
/* navigator.storage.estimate() reports the whole origin's usage; this app
   only writes to IndexedDB, so in practice it reflects what is saved
   here. Refreshed after each save instead of on a timer: saves already
   carry their own debounce, so this rides along for free.             */
async function refreshStorageUsage() {
  const el = document.getElementById("storage-usage");
  if (!el) return;
  if (!navigator.storage || !navigator.storage.estimate) {
    el.textContent = tr("Almacenamiento usado: no disponible en este navegador.");
    return;
  }
  try {
    const { usage } = await navigator.storage.estimate();
    el.textContent = tr("Almacenamiento usado: {size}", { size: fmtBytes(usage || 0) });
  } catch {
    el.textContent = tr("Almacenamiento usado: no disponible.");
  }
}

/* Memoria de la pestaña, al lado de lo que ocupa en disco: son las dos
   cotas con las que se topa un árbol grande, y hasta ahora solo se veía
   una.

   `performance.memory` es una extensión de Chromium: no está en ninguna
   norma y en el resto de navegadores no existe, así que ahí se dice «no
   disponible» en vez de inventar un número. La alternativa normalizada,
   `measureUserAgentSpecificMemory()`, exige aislamiento de origen
   cruzado (COOP/COEP): ni una página abierta con doble clic ni GitHub
   Pages pueden dar esas cabeceras, así que no es una opción.

   SOBRE file:// EL VALOR SE QUEDA CONGELADO, y por eso ahí no se
   muestra: un número fijo con aspecto de medida en vivo engaña más que
   no poner nada. Medido con Chromium 129: reservando 600.000 objetos,
   `usedJSHeapSize` no se movió de 9,54 MB ni a los 35 s con el archivo
   abierto por file://, mientras que la MISMA página servida por http
   pasó de 4,38 a 54,33 MB al instante. O sea que el indicador sirve
   en el demo y en cualquier despliegue servido, que es donde el
   consumo importa de verdad.

   A diferencia del almacenamiento, que se refresca tras cada guardado
   porque ya viaja con su propio retardo, la memoria cambia sin que el
   árbol se toque —navegar el mapa, abrir diálogos—, así que lleva su
   propio temporizador. Leer `performance.memory` es un captador, no una
   consulta al disco como `navigator.storage.estimate()`, y por eso este
   temporizador puede permitirse ser periódico y aquel no: medido, 0,005
   ms por lectura.                                                     */
const MEMORY_REFRESH_MS = 5000;
/* Sin cifra que dar, la línea NO se pinta: se esconde. Una línea fija
   diciendo "no disponible" es ruido permanente, y las dos razones por
   las que puede faltar son casos raros frente al uso normal, que es la
   página servida — `file://` (valor congelado) y un navegador que no
   sea Chromium (`performance.memory` no está en ninguna norma). Quien
   abre el archivo con doble clic no necesita leer cada vez por qué no
   hay un dato que probablemente no esperaba.                         */
function memoryUsageText() {
  if (location.protocol === "file:") return null;
  const m = performance.memory;
  if (!m || !isFinite(m.usedJSHeapSize)) return null;
  return tr("Memoria de la pestaña: {used} de {limit}",
    { used: fmtBytes(m.usedJSHeapSize), limit: fmtBytes(m.jsHeapSizeLimit) });
}
function refreshMemoryUsage() {
  const el = document.getElementById("memory-usage");
  if (!el) return;
  const txt = memoryUsageText();
  el.hidden = txt === null;
  if (txt !== null) el.textContent = txt;
}

function saveTree() {
  if (dbWiped) return saveChain;
  saveChain = saveChain
    .then(() => {
      const t0 = performance.now();
      const nodes = serializeTree();
      const serializing = performance.now() - t0;
      /* El coste que cuenta es el que BLOQUEA el hilo: serializar más el
         clon síncrono de los put. Midiendo solo lo primero (3-10 ms), el
         retardo se quedaba en 400 ms aunque el put tardara 330.      */
      return dbSaveTree(nodes, putting => { saveCost = serializing + putting; });
    })
    .then(refreshStorageUsage)
    .catch(err => {
      /* Un solo aviso por racha de fallos, para no inundar el panel */
      if (!savePending) {
        savePending = true;
        navMessage(tr("No se pudo guardar el estado en el navegador: {reason}.", { reason: err && err.message ? err.message : tr("error de almacenamiento") }));
        setTimeout(() => { savePending = false; }, 5000);
      }
    });
  return saveChain;
}

/* Borra la base de IndexedDB ENTERA (árbol, segmentos, ortofotos y todos
   los ajustes) y recarga la página: Propiedades › Restaurar, tras su
   segunda confirmación. Recargar es lo que lo hace seguro: el estado en
   memoria (árbol, deshacer, portapapeles) no puede volver a escribir lo
   borrado. Solo IndexedDB: el idioma vive en localStorage (ver i18n.md) y
   se conserva a propósito. El orden importa: primero se frena todo
   guardado, luego se espera al que va en vuelo, se cierra NUESTRA
   conexión (si no, deleteDatabase se queda bloqueada por ella) y entonces
   se borra.                                                             */
async function wipeAllData() {
  dbWiped = true;
  clearTimeout(saveTimer);
  try {
    await saveChain;
    if (dbPromise) {
      const db = await dbPromise.catch(() => null);
      dbPromise = null;
      if (db) db.close();
    }
    await new Promise((resolve, reject) => {
      const rq = indexedDB.deleteDatabase(DB_NAME);
      rq.onsuccess = () => resolve();
      rq.onerror = () => reject(rq.error);
      /* Otra pestaña con la base abierta: se queda esperando a que la cierre */
      rq.onblocked = () => navMessage(tr("Otra pesta\u00F1a est\u00E1 usando el almacenamiento; ci\u00E9rrela para continuar."));
    });
  } catch (err) {
    dbWiped = false;
    navMessage(tr("No se pudieron borrar los datos guardados: {reason}.",
      { reason: err && err.message ? err.message : tr("error de almacenamiento") }));
    return false;
  }
  location.reload();
  return true;
}

/* ---------- Reconstrucción del árbol desde el almacenamiento ---------- */
const LEAF_RECORD_TYPES = new Set(["layer", "measure", "elevGrid", "imageOverlay", "cog"]);
function countLayers(nodes) {
  let n = 0;
  for (const x of nodes) {
    if (LEAF_RECORD_TYPES.has(x.t)) n++;
    else n += countLayers(x.children || []);
  }
  return n;
}
async function restoreTree(nodes) {
  const total = countLayers(nodes);
  const prog = total > 500 ? {
    done: 0,
    update: d => progress.set(100 * d / total, tr("Restaurando capas\u2026 ({d}/{total})", { d, total }))
  } : null;
  const records = await buildRecordsFromStorage(nodes, prog);
  if (prog) progress.hide();
  await materializeRecords(records, ensureRootUl());
}

/* ---------- Capas Leaflet perezosas ----------
   Un registro `layer` APAGADO guarda solo su `geo` (el GeoJSON, que es lo
   que se persiste) y su capa Leaflet se construye la PRIMERA vez que
   alguien la lee. Motivo, medido con un KML de 309 MB (62 673
   placemarks apagados, 9,66 M de vértices): construirlas todas eran 9,4 s
   y +1,1 GB de heap al importar y OTROS 7,6 s y 3,1 GB en cada arranque, y
   copiarlas de vuelta a GeoJSON para guardar, 1,3 s y +0,6 GB más; con un
   límite de heap de 3 GB el guardado pasó de 1,3 s a 67 s (el recolector
   de basura contra el techo) y con menos la pestaña moría.

   `rec._layer` pasa a ser un getter que construye, se sustituye a sí
   mismo por el valor y registra los manejadores del registro pendiente
   (`wirePendingLayerEvents`): los sitios que leen `rec._layer` no se
   enteran. Quien solo quiere APAGAR o QUITAR una capa, o medirla, NO debe
   construirla: pregunta antes `recLayerPending(rec)` (apagar una capa que
   nunca existió no hace nada; su encuadre sale de `rec.geo`).
   La capa que se construye es EXACTAMENTE la de un registro restaurado
   (`buildRecordLayer`, la misma que usa `buildRecordsFromStorage`): nada
   nuevo que probar más allá de que se construye tarde.                 */
function defineLazyLayer(rec, build) {
  rec._built = false;
  const settle = layer => Object.defineProperty(rec, "_layer",
    { value: layer, writable: true, configurable: true, enumerable: true });
  Object.defineProperty(rec, "_layer", {
    configurable: true, enumerable: true,
    get() {
      const layer = build();
      settle(layer);
      rec._built = true;
      wirePendingLayerEvents(rec);
      return layer;
    },
    set(layer) { settle(layer); rec._built = true; }
  });
}
/* ¿Es un registro perezoso cuya capa aún no existe? (`_built` solo lo
   tienen los perezosos) */
const recLayerPending = rec => rec._built === false;

/* La capa Leaflet de un registro `layer` a partir de su GeoJSON, con el
   estilo, el popup y el icono propio: lo que hacía en línea el arranque. */
function buildRecordLayer(rec) {
  const layer = L.geoJSON(rec.geo, rec.style ? { style: rec.style } : undefined);
  clearFillOnOpenPaths(layer); /* una línea no se rellena, ver esa función */
  layer.bindPopup(escapeHtml(rec.name), COMPACT_POPUP);
  /* El icono personalizado se aplica AQUÍ, sobre la capa cruda, no
     solo cuando materializeRecords construya su fila más adelante:
     un marcador dentro de una carpeta colapsada puede pasar de
     "pendiente" a "visible" con la cascada de la casilla de la
     carpeta (cascadeVisibility → walkRecords) sin que su fila
     llegue a crearse nunca — ese camino solo hace
     setLayerVisible(rec._layer, checked), sin tocar el icono.
     Reportado: un marcador con icono MDI (no la gota por defecto),
     desactivado y dentro de una carpeta nunca desplegada, volvía a
     la gota de Leaflet al activarlo tras recargar. Aplicarlo dos
     veces (otra vez en materializeRecords, si la fila sí llega a
     crearse) es inocuo: setIcon con el mismo icono no hace nada.  */
  if (rec.mstyle) styleMarkerIcon(layer, rec.mstyle, typeof rec.name === "string" ? rec.name : "");
  return layer;
}

/* ¿Puede un GeoJSON quedarse sin capa hasta que haga falta? Solo si no
   tiene ningún punto (un marcador necesita su icono, que es de Leaflet) ni
   nada que no se reconozca: ante la duda, se construye ya.            */
const LAZY_GEOMETRIES = new Set(["Polygon", "MultiPolygon", "LineString", "MultiLineString"]);
function geoIsLazyable(g) {
  if (!g || typeof g !== "object") return false;
  if (g.type === "FeatureCollection") return Array.isArray(g.features) && g.features.every(geoIsLazyable);
  if (g.type === "Feature") return !!g.geometry && LAZY_GEOMETRIES.has(g.geometry.type);
  return LAZY_GEOMETRIES.has(g.type);
}

/* Encuadre de un GeoJSON sin construir su capa (la caja de todas sus
   posiciones, que es la que da `getBounds()`), o null si no hay ninguna.
   Se guarda en el registro: se pide en cada "ir a la carpeta".          */
function recGeoBounds(rec) {
  if (rec._bounds !== undefined) return rec._bounds;
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  const walk = c => {
    if (typeof c[0] === "number") {
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
    } else for (const x of c) walk(x);
  };
  const geoms = g => g.type === "FeatureCollection" ? g.features.forEach(f => geoms(f))
    : g.type === "Feature" ? (g.geometry && geoms(g.geometry)) : walk(g.coordinates);
  try { geoms(rec.geo); } catch { /* geometría rota: sin encuadre */ }
  return (rec._bounds = s <= n ? L.latLngBounds([s, w], [n, e]) : null);
}

/* Reconstruye la geometría/capas Leaflet de un árbol guardado
   (restaurar, deshacer/rehacer, pegar, importar un .kite.json), como
   REGISTROS — nunca filas del panel. Igual que buildKmlRecords: la
   visibilidad de cada capa (alta en rootGroup) es independiente de si
   su fila llega a materializarse, así que esto SIEMPRE recorre el
   árbol entero sin mirar `collapsed` — es materializeRecords quien
   decide cuánto DOM construir a partir de estos registros.        */
async function buildRecordsFromStorage(nodes, prog, opts = {}) {
  const out = [];
  for (const n of nodes) {
    if (n.t === "arcgis") {
      /* Un servicio que no pasa la validación se descarta entero, como un COG */
      const rec = buildArcgisRecord(n, opts);
      if (rec) out.push(rec);
    } else if (n.t === "arcgisLayer") {
      /* Una capa de servicio solo existe dentro de su servicio (que las
         construye él): una suelta, de un archivo manipulado, no es nada. */
    } else if (n.t === "measure") {
      out.push(buildMeasureRecord(n));
    } else if (n.t === "elevGrid") {
      out.push(buildElevGridRecord(n));
    } else if (n.t === "imageOverlay") {
      out.push(buildImageOverlayRecord(n));
    } else if (n.t === "cog") {
      /* Un registro ajeno (un .kite.json manipulado) que no pasa la
         validación se descarta: no hay nada que dibujar con él.    */
      const rec = buildCogRecord(n);
      if (rec) out.push(rec);
    } else if (n.t === "layer") {
      const rec = { t: "layer", name: n.name, checked: !!n.checked, style: n.style || null,
                    geo: n.geo, mstyle: n.mstyle, desc: n.desc || null };
      /* Apagada, sin marcadores y de este navegador (lo AJENO se construye
         ya: Leaflet es quien rechaza una geometría rota, y es mejor que
         falle al cargar que al encender): sin capa hasta que se pida. */
      if (!rec.checked && !opts.foreign && geoIsLazyable(rec.geo)) {
        defineLazyLayer(rec, () => buildRecordLayer(rec));
      } else {
        rec._layer = buildRecordLayer(rec);
        if (rec.checked) rec._layer.addTo(rootGroup);
        /* geo ya es el toGeoJSON() que serializeNode recalcularía: se
           reutiliza en vez de perder la caché (ver materializeRecords) */
        wirePendingLayerEvents(rec);
      }
      out.push(rec);
    } else {
      const children = await buildRecordsFromStorage(n.children || [], prog, opts);
      const rec = { t: n.t, name: n.name, checked: !!n.checked, collapsed: !!n.collapsed, children };
      /* `sec` solo vale en un archivo y solo si es EXACTAMENTE true (entrada ajena) */
      if (n.t === "file" && n.sec === true) rec.sec = true;
      out.push(rec);
    }
    if (prog && LEAF_RECORD_TYPES.has(n.t)) await yieldIfDue(prog);
  }
  return out;
}

/* Convierte REGISTROS (de buildKmlRecords/buildGeoJsonRecords/
   buildRecordsFromStorage, o de li._pending) en filas reales del panel,
   por lotes con yieldFrame — usada para la materialización inicial
   de una importación/restauración Y para materializar una
   carpeta al desplegarla por primera vez (ensureMaterialized): es el
   mismo trabajo ("construir estas filas aquí dentro"), la fuente de
   los registros es lo único que cambia. Una carpeta que empieza
   colapsada solo recibe su PROPIA fila: sus hijos se quedan en
   `li._pending` sin tocar el DOM, en vez de recursar — así que
   desplegar una carpeta grande nunca materializa más que ella y la
   cadena de subcarpetas ya abiertas, nunca el subárbol entero. No
   lleva parámetro de progreso: el trabajo caro (parsear geometría,
   construir capas Leaflet) ya pasó en la fase de registros, que sí
   lo muestra; esto solo cede el hilo para no bloquear.                 */
async function materializeRecords(records, parentUl, only = null) {
  let n = 0;
  /* Dónde va cada fila: al final, como siempre, salvo que este nivel se haya
     partido ya (rec._pos): entonces por su posición original, mezclando con
     las filas que ya hay (ver placementAnchor). */
  const anchored = placementAnchor(parentUl, records);
  const put = (li, rec) => {
    if (rec._pos !== undefined) li._pos = rec._pos;
    if (anchored) anchored(li, rec._pos); else parentUl.appendChild(li);
  };
  for (const rec of records) {
    if (rec.t === "folder" || rec.t === "file") {
      const li = makeNode({
        name: rec.name, isFolder: rec.t === "folder", isFile: rec.t === "file", checked: !!rec.checked,
        appSection: rec.sec === true
      });
      rec._li = li; /* referencia inversa: la usa resolveMatch para llegar aquí desde una búsqueda pendiente */
      if (rec.collapsed) li.classList.add("collapsed");
      syncExpanded(li);
      put(li, rec);
      /* la sección que contiene mediciones recupera su papel, mire o no
         esta llamada dentro de sus hijos: rec.children ya existe       */
      if (rec.t === "file" && rec.children.some(c => c.t === "measure")) measureLi = li;
      if (only) {
        /* Construcción parcial (el filtro del panel): de esta carpeta solo se
           construye lo que pide `only` y el resto queda en SU _pending,
           aunque no esté colapsada (al quitar el filtro se completa).    */
        const sub = splitPending(rec.children, only);
        li._pending = sub.rest.length ? sub.rest : null;
        if (li._pending) partialFolders.add(li);
        await materializeRecords(sub.chosen, nodeUl(li), only);
      } else if (rec.collapsed) {
        li._pending = rec.children;
        /* Sus hijos no llegan a ser filas, así que la pasada recursiva
           no va a recalcular esta casilla por ellos: se hace aquí, con
           los registros. Sin esto, una carpeta colapsada a medias volvía
           de IndexedDB diciendo "entera".                             */
        applyContainerState(li);
      } else {
        await materializeRecords(rec.children, nodeUl(li));
      }
    } else if (rec.t === "layer") {
      const li = makeNode({
        name: rec.name, layer: rec._layer, style: rec.style || null, checked: !!rec.checked,
        desc: rec.desc || null
      });
      rec._li = li;
      /* makeNode already wired the definitive click/hover listeners (see
         "back-reference" there): the waiting ones from
         wirePendingLayerEvents are no longer needed and must be
         removed, or the layer would keep two and a click would
         highlight the node twice.                                     */
      if (rec._pendingHandlers) {
        rec._layer.off("click", rec._pendingHandlers.onClick);
        rec._layer.off("mouseover", rec._pendingHandlers.onHover);
        rec._layer.off("mouseout", rec._pendingHandlers.onLeave);
        rec._pendingHandlers = null;
      }
      if (rec.geo) li._geo = rec.geo;
      put(li, rec);
      if (rec.mstyle) {
        li._mstyle = rec.mstyle;
        applyMarkerStyle(li); /* síncrona: los iconos van empotrados */
      } else {
        ensureMarkerDefaults(li);
      }
      /* Un trazo con el nombre siempre a la vista recupera su etiqueta:
         la capa se construyó con el globo de siempre, sin mirar el
         estilo, porque ahí todavía no hay nodo del que sacar el nombre. */
      if (rec.style && rec.style.textAlways) applyPolygonText(li);
    } else if (rec.t === "measure") {
      const li = makeMeasureLi(rec._m);
      rec._li = li;
      put(li, rec);
      if (!rec.checked) li.querySelector(":scope > .node-row > input").checked = false;
      updateMeasurement(rec._m);
    } else if (rec.t === "elevGrid") {
      const li = makeNode({
        name: rec.name, layer: rec._layer, styleable: false, focusable: true, checked: !!rec.checked,
        onDelete: () => forgetElevGridGroup(rec._layer)
      });
      rec._li = li;
      li._elevGrid = { cells: rec.cells, profile: rec.profile || null };
      put(li, rec);
    } else if (rec.t === "imageOverlay") {
      const li = makeNode({ name: rec.name, layer: rec._layer, styleable: true, checked: !!rec.checked });
      rec._li = li;
      li._imageOverlay = { box: rec.box, dataUrl: rec.dataUrl, opacity: rec.opacity };
      put(li, rec);
    } else if (rec.t === "cog") {
      const li = makeNode({ name: rec.name, layer: rec._layer, styleable: true, checked: !!rec.checked });
      rec._li = li;
      li._cog = { rasterId: rec.rasterId, box: rec.box, opacity: rec.opacity };
      put(li, rec);
    } else if (rec.t === "arcgis" || rec.t === "arcgisLayer") {
      await materializeArcgisRecord(rec, parentUl, put);
    }
    if (++n % PROGRESS_BATCH === 0) await yieldFrame();
  }
  /* Una sola vez al final, no por nodo: el conjunto de hijos cambia una
     vez por lote y recalcular por cada uno costaría k × profundidad. */
  refreshChecksFrom(parentUl);
}

/* ---------- Indicador de progreso (tres fases) ----------
   Solo se muestra para archivos que superen el umbral; los pequeños
   cargan al instante y la barra sería ruido.                        */
const SIZE_THRESHOLD = 2.5 * 1024 * 1024; /* ~2.5 MB */
const progress = {
  el: document.getElementById("progress"),
  label: document.getElementById("progress-label"),
  fill: document.getElementById("progress-fill"),
  /* barra determinada 0–100 */
  set(pct, txt) {
    this.el.hidden = false;
    this.fill.classList.remove("indet");
    this.fill.style.width = pct.toFixed(1) + "%";
    this.label.textContent = txt;
  },
  /* fase de duración desconocida (rayas animadas) */
  indet(txt) {
    this.el.hidden = false;
    this.fill.classList.add("indet");
    this.label.textContent = txt;
  },
  hide() {
    this.el.hidden = true;
    this.fill.classList.remove("indet");
    this.fill.style.width = "0";
  }
};

