/* ================= Shapefile (SHP) =================
   Un shapefile no es un archivo sino varios con el mismo nombre: .shp
   (geometría), .dbf (atributos), .prj (proyección, en WKT), .cpg
   (codificación del .dbf) y .shx (índice, que aquí no hace falta: se
   lee de principio a fin). Llegan sueltos en el mismo gesto o dentro
   de un .zip, casi siempre en ETRS89 UTM.

   Se convierte a un FeatureCollection en WGS84 y entra por addFileNode
   como un GeoJSON más, con todo lo que eso trae: etiquetas HTML,
   propiedades que forman el nombre, duplicados, carpeta, resumen,
   deshacer. La lectura la hace la librería `shapefile` y la proyección
   proj4; aquí solo se agrupa, se acota y se decide qué hacer con lo
   que no encaja.                                                     */

const SHP_PARTS = new Set(["shp", "dbf", "prj", "cpg", "shx"]);
/* Cotas ante un archivo ajeno: lo leído (.shp + .dbf) y los elementos.
   Cada elemento es una capa de Leaflet y una fila del árbol; el árbol
   se ha medido con unos 8.000 nodos, así que cien mil ya es un tope de
   «esto no es para este visor», no de rendimiento fino.              */
const SHP_MAX_BYTES = 300 * 1024 * 1024;
const SHP_MAX_FEATURES = 100000;

/* "dir/Carreteras.SHP" → { key: "dir/carreteras", ext: "shp" } */
function splitShpName(name) {
  const s = String(name || "");
  const dot = s.lastIndexOf(".");
  if (dot <= 0) return { key: s.toLowerCase(), ext: "" };
  return { key: s.slice(0, dot).toLowerCase(), ext: s.slice(dot + 1).toLowerCase() };
}

/* Reparte lo soltado en elementos, EN EL ORDEN en que llegó:
     { file }    cualquier otro archivo, que sigue su camino;
     { shp }     un shapefile, en la posición de su .shp, con sus piezas
                 { name, shp, dbf, prj, cpg } (las que falten, null);
     { orphan }  una pieza (.dbf, .prj…) cuyo .shp no ha llegado.
   Mayúsculas aparte (Windows no distingue). PURA: solo mira `.name`,
   así que vale igual para un File que para una entrada de un zip.    */
function groupShapefileParts(files) {
  const groups = new Map();
  for (const f of files) {
    const { key, ext } = splitShpName(f.name);
    if (!SHP_PARTS.has(ext)) continue;
    if (!groups.has(key)) groups.set(key, {});
    groups.get(key)[ext] = f;
  }
  const items = [];
  for (const f of files) {
    const { key, ext } = splitShpName(f.name);
    if (!SHP_PARTS.has(ext)) { items.push({ file: f }); continue; }
    const g = groups.get(key);
    if (g.shp) {
      if (ext === "shp") {
        items.push({ shp: {
          name: f.name.split("/").pop(), shp: g.shp,
          dbf: g.dbf || null, prj: g.prj || null, cpg: g.cpg || null
        } });
      }
      /* el resto de piezas ya van dentro de su grupo */
    } else if (ext !== "shx") {
      /* Un .shx suelto no merece aviso propio: sin .shp no aporta nada,
         y quien suelta medio shapefile ya recibe el de las otras piezas */
      items.push({ orphan: f });
    }
  }
  return items;
}

/* Codificación del .dbf según su .cpg: "UTF-8", "1252", "ANSI 1252",
   "ISO-8859-1"… Devuelve una etiqueta que TextDecoder entienda, o null
   si el .cpg dice algo que no se reconoce.                            */
function cpgEncoding(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (/^utf-?8$/i.test(t)) return "utf-8";
  const m = /^(?:ansi\s*|cp\s*|windows-)?(\d{3,5})$/i.exec(t);
  if (m) {
    const n = m[1];
    if (n === "88591") return "iso-8859-1";
    if (n === "88592") return "iso-8859-2";
    if (n === "65001") return "utf-8";
    return `windows-${n}`;
  }
  try { new TextDecoder(t); return t.toLowerCase(); } catch { return null; }
}

/* Sin .cpg: si los bytes son UTF-8 válido, UTF-8 (lo que escriben QGIS
   y casi todo lo reciente); si no, Windows-1252, el valor por defecto
   histórico del formato. Un .dbf todo ASCII da igual cuál se elija.   */
function guessDbfEncoding(bytes) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "utf-8";
  } catch {
    return "windows-1252";
  }
}

/* ¿Puede ser un shapefile en grados aunque no traiga .prj? Mira la caja
   envolvente de la cabecera del .shp: [xmin, ymin, xmax, ymax].       */
function bboxLooksGeographic(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4) return false;
  const [x0, y0, x1, y1] = bbox;
  return [x0, y0, x1, y1].every(Number.isFinite)
    && Math.abs(x0) <= 180 && Math.abs(x1) <= 180
    && Math.abs(y0) <= 90 && Math.abs(y1) <= 90;
}

/* ED50, el datum de la cartografía española anterior a ETRS89, llega
   en el .prj sin parámetros de transformación (el WKT de ESRI no los
   lleva), y proj4 sin ellos no cambia de datum: todo quedaría unos
   120 m desplazado sin que nada lo dijera. Se le ponen los estándar
   para la España peninsular (EPSG:1133) y se avisa de que la precisión
   es de unos metros. Un .prj que ya trae TOWGS84 se respeta.          */
const ED50_TOWGS84 = "-87,-98,-121,0,0,0,0";
function prjDatumFix(wkt) {
  const s = String(wkt || "");
  if (/TOWGS84/i.test(s) || !/DATUM\s*\[\s*"[^"]*(European_1950|ED_?50)/i.test(s)) {
    return { wkt: s, ed50: false };
  }
  const fixed = s.replace(/(DATUM\s*\[[^\[]*SPHEROID\s*\[[^\]]*\])/i, `$1,TOWGS84[${ED50_TOWGS84}]`);
  return { wkt: fixed, ed50: fixed !== s };
}

/* Reproyecta una geometría GeoJSON EN SU SITIO con `fn([x, y]) → [lon,
   lat]`. Lo que no se pueda proyectar queda como NaN y validGeometry
   lo rechaza después, contado en el resumen como el resto.            */
function reprojectGeometry(geom, fn) {
  if (!geom) return geom;
  if (geom.type === "GeometryCollection") {
    for (const g of geom.geometries || []) reprojectGeometry(g, fn);
    return geom;
  }
  const walk = c => {
    if (typeof c[0] === "number") {
      const r = fn([c[0], c[1]]);
      c[0] = r[0];
      c[1] = r[1];
    } else {
      for (const x of c) walk(x);
    }
  };
  if (Array.isArray(geom.coordinates) && geom.coordinates.length) walk(geom.coordinates);
  return geom;
}

/* Un .dbf da fechas como Date; en el árbol todo atributo es texto.   */
function shpPropsToPlain(props) {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    out[k] = v instanceof Date
      ? (Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : "")
      : v;
  }
  return out;
}

/* La transformación del .prj a WGS84, con las notas que merezca para
   el resumen. Sin .prj se aceptan coordenadas que parezcan grados (y
   se dice que se ha supuesto); si no, no hay forma honesta de
   colocarlas y se rechaza.                                            */
function shpProjection(prjText, bbox, report) {
  if (!prjText || !prjText.trim()) {
    if (!bboxLooksGeographic(bbox)) {
      throw new Error("falta el .prj y las coordenadas no son geográficas: "
        + "no se sabe en qué sistema están");
    }
    report.note("sin .prj: se suponen coordenadas geográficas WGS84");
    return null;
  }
  if (typeof proj4 === "undefined") throw new Error("no se pudo cargar el soporte de proyecciones");
  const { wkt, ed50 } = prjDatumFix(prjText);
  let proj;
  try {
    proj = proj4.Proj(wkt);
  } catch {
    proj = null;
  }
  if (!proj || !proj.projName) {
    throw new Error(`proyección del .prj no reconocida: «${prjText.trim().slice(0, 80)}…»`);
  }
  if (ed50) {
    report.note("datum ED50 pasado a WGS84 con los parámetros estándar de la España "
      + "peninsular (error de unos metros)");
  } else if (proj.datum && proj.datum.datum_type === 5 && Math.abs(proj.a - 6378137) > 1) {
    /* Sin transformación de datum conocida y con otro elipsoide: se
       dibuja, pero puede estar desplazado y el usuario debe saberlo. */
    report.note(`datum «${proj.datumCode || "desconocido"}» sin transformación a WGS84: `
      + "la posición puede desplazarse decenas o cientos de metros");
  }
  const t = proj4(wkt, "WGS84");
  return xy => t.forward(xy);
}

/* Un trozo de shapefile, venga de un File o de una entrada de un zip */
const shpPartBytes = part => (typeof part.async === "function"
  ? part.async("uint8array") : part.arrayBuffer().then(b => new Uint8Array(b)));
const shpPartSize = part => (typeof part.size === "number" ? part.size
  : (part._data && part._data.uncompressedSize) || 0);

/* Lee un shapefile agrupado y lo devuelve como FeatureCollection en
   WGS84. Va registro a registro (no `shapefile.read`, que lo junta
   todo sin tope) para poder cortar en SHP_MAX_FEATURES y ceder el hilo
   con progreso en los grandes.                                       */
async function readShapefile(group, report) {
  if (typeof shapefile === "undefined") throw new Error("no se pudo cargar el soporte de shapefiles");
  const bytes = shpPartSize(group.shp) + (group.dbf ? shpPartSize(group.dbf) : 0);
  if (bytes > SHP_MAX_BYTES) {
    throw new Error(`el shapefile es demasiado grande (${fmtBytes(bytes)}, tope ${fmtBytes(SHP_MAX_BYTES)})`);
  }
  const shp = await shpPartBytes(group.shp);
  const dbf = group.dbf ? await shpPartBytes(group.dbf) : null;
  const prj = group.prj ? new TextDecoder("utf-8").decode(await shpPartBytes(group.prj)) : "";
  let encoding = null;
  if (group.cpg) {
    const cpgText = new TextDecoder("utf-8").decode(await shpPartBytes(group.cpg));
    encoding = cpgEncoding(cpgText);
    if (!encoding) report.note(`codificación del .cpg no reconocida («${cpgText.trim().slice(0, 30)}»): se usa UTF-8 o Windows-1252 según el contenido`);
  }
  if (!encoding && dbf) encoding = guessDbfEncoding(dbf);
  if (!dbf) report.note("sin .dbf: los elementos no traen atributos");

  let source;
  try {
    source = await shapefile.open(shp, dbf || undefined, { encoding: encoding || "utf-8" });
  } catch (err) {
    throw new Error(`el .shp no es válido (${err && err.message || err})`);
  }
  const project = shpProjection(prj, source.bbox, report);

  const big = bytes > SIZE_THRESHOLD;
  const features = [];
  let skipped = 0;
  for (;;) {
    const r = await source.read();
    if (r.done) break;
    if (features.length >= SHP_MAX_FEATURES) { skipped++; continue; }
    const f = r.value;
    f.properties = shpPropsToPlain(f.properties);
    if (f.geometry && project) {
      try { reprojectGeometry(f.geometry, project); } catch { f.geometry = null; }
    }
    features.push(f);
    if (big && features.length % PROGRESS_BATCH === 0) {
      progress.indet(`Leyendo ${group.name}… (${features.length} elementos)`);
      await yieldFrame();
    }
  }
  if (skipped) {
    report.warn(`${skipped} elemento(s) omitidos: el tope es ${SHP_MAX_FEATURES} por shapefile`);
  }
  return { type: "FeatureCollection", features };
}

/* Un shapefile al árbol, con el mismo contrato que un archivo suelto en
   handleDroppedFiles: un fallo se avisa y no corta los demás.        */
async function importShapefileSafely(group, insertBefore, dropTargetUl) {
  const size = shpPartSize(group.shp);
  try {
    /* El informe de la lectura (sin .prj, ED50, tope…) se vuelca en el
       de addFileNode, que es el que el usuario ve.                  */
    const pre = makeImportReport(group.name);
    const gj = await readShapefile(group, pre);
    await addFileNode(group.name, "geojson", gj, insertBefore, dropTargetUl, null, pre);
    scheduleSave();
  } catch (err) {
    if (err.cancelled) { navMessage(`Carga de «${group.name}» cancelada.`, { tone: "info" }); return; }
    navMessage(`No se pudo cargar «${group.name}» (shapefile, ${fmtBytes(size)}): ${err.message}`);
  } finally {
    progress.hide();
  }
}

/* Los shapefiles de un .zip ya abierto (y con las cotas pasadas): uno
   por .shp, cada uno en su carpeta. Las piezas sin .shp se avisan.   */
async function importShapefilesFromZip(zip, zipName, insertBefore, dropTargetUl) {
  const entries = Object.values(zip.files).filter(f => !f.dir && !/(^|\/)__MACOSX\//.test(f.name));
  const items = groupShapefileParts(entries);
  const groups = items.filter(i => i.shp);
  if (!groups.length) throw new Error("el zip no contiene ningún .kml ni .shp");
  for (const i of items) {
    if (i.orphan) navMessage(`«${zipName}»: «${i.orphan.name}» no tiene su .shp dentro del zip.`);
  }
  for (const i of groups) await importShapefileSafely(i.shp, insertBefore, dropTargetUl);
}
