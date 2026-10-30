/* ---------- Apertura tolerante del XML ----------
   KML producido por herramientas reales usa a veces un prefijo que nunca
   declara (el caso típico: `xsi:schemaLocation` sin su `xmlns:xsi`).
   Google Earth lo acepta, pero para XML eso es un error de buena
   formación y el `DOMParser` del navegador devuelve un documento de
   error, así que el archivo entero se perdía. Aquí se detecta ese caso
   concreto, se declaran los prefijos que faltan en el elemento raíz y se
   reintenta una sola vez. Cualquier otro fallo se comunica con el
   mensaje y la posición que da el propio analizador.                   */
const MAX_REPAIRED_PREFIXES = 12;

/* Fin de la etiqueta de apertura de `text` desde `from`, respetando los
   ">" que puedan aparecer dentro de valores entrecomillados */
function tagEnd(text, from) {
  let quote = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return i;
  }
  return -1;
}

/* Declara en la raíz los prefijos que se usan pero no se declaran.
   Función pura: recibe y devuelve texto, y por eso es verificable.    */
function repairUndeclaredPrefixes(content) {
  const declared = new Set(["xml", "xmlns"]);
  for (const m of content.matchAll(/\sxmlns:([A-Za-z_][\w.-]*)\s*=/g)) declared.add(m[1]);

  const used = new Set();
  for (const m of content.matchAll(/<\/?([A-Za-z_][\w.-]*):[A-Za-z_]/g)) used.add(m[1]);
  for (const m of content.matchAll(/\s([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*\s*=\s*["']/g)) used.add(m[1]);

  const missing = [...used].filter(pfx => !declared.has(pfx));
  if (!missing.length || missing.length > MAX_REPAIRED_PREFIXES) return { text: content, prefixes: [] };

  /* Primera etiqueta de elemento, saltando prólogo, comentarios y DOCTYPE */
  const start = content.search(/<[A-Za-z_]/);
  if (start < 0) return { text: content, prefixes: [] };
  const end = tagEnd(content, start);
  if (end < 0) return { text: content, prefixes: [] };

  const selfClosing = content[end - 1] === "/";
  const insertAt = selfClosing ? end - 1 : end;
  /* URI sintética: solo hace falta que exista para que el documento sea
     válido; las búsquedas del parser son agnósticas al namespace     */
  const decls = missing.map(pfx => ` xmlns:${pfx}="urn:kite:undeclared:${pfx}"`).join("");
  return {
    text: content.slice(0, insertAt) + decls + content.slice(insertAt),
    prefixes: missing
  };
}

/* Mensaje legible del <parsererror> del navegador */
function parserErrorText(doc) {
  const err = doc.querySelector("parsererror");
  if (!err) return null;
  return err.textContent.replace(/\s+/g, " ").trim().slice(0, 200);
}

/* Some KML export tools leave literal HTML-like tags as plain text inside
   <name> (real file seen: `A27<_bol><fnt scale="80">    </fnt></_bol>`,
   from a "bold"/"font" markup the exporter never rendered). Detected as
   any <...> span containing at least one letter, so a name that merely
   uses "<"/">" as comparison symbols isn't mistaken for a tag — the user
   asked for exactly this simple rule ("letras dentro de símbolos <>").
   Kept as two pure string functions (no DOM) so they're easy to unit
   test; the DOM-walking callers are just below.                       */
const HTML_LIKE_TAG_RE = /<[^<>]*[a-zA-Z][^<>]*>/;
function hasHtmlLikeTags(name) {
  return HTML_LIKE_TAG_RE.test(name);
}
function stripHtmlLikeTags(name) {
  return name.replace(/<[^<>]*[a-zA-Z][^<>]*>/g, "");
}
/* Lo mismo para las `properties` de un GeoJSON, que llegan con el mismo
   problema: valores con etiquetas literales que afean la tabla del panel
   de información, el nombre del árbol, el texto del marcador y el globo.

   OJO con una idea equivocada que cuesta una tarde: que un archivo
   escriba `\u003cb\u003e` en vez de `<b>` NO cambia nada. En un literal
   de cadena JSON eso es solo otra forma de escribir el mismo carácter, y
   `JSON.parse` las normaliza: aquí llegan indistinguibles. No hay, por
   tanto, ninguna validación que burlar por esa vía.

   Se recorre también dentro de objetos y arrays: una `property` no tiene
   por qué ser plana, y dejar ese hueco sería justo lo que esto viene a
   cerrar. Se muta SOBRE EL PROPIO OBJETO a propósito: geojsonFeatures
   devuelve los mismos objetos que cuelgan de `gj` (para un
   FeatureCollection y para un Feature suelto), así que limpiar aquí deja
   limpio lo que después recibe buildGeoJsonRecords. El tercer caso —una
   geometría suelta— se envuelve con `properties: {}`, donde no hay nada
   que limpiar.                                                        */
const propsOf = f => (f && typeof f.properties === "object" && f.properties) || null;

function valueHasHtmlTags(v) {
  if (typeof v === "string") return hasHtmlLikeTags(v);
  if (Array.isArray(v)) return v.some(valueHasHtmlTags);
  if (v && typeof v === "object") return Object.values(v).some(valueHasHtmlTags);
  return false;
}
function geojsonPropsHaveHtmlTags(features) {
  return features.some(f => {
    const p = propsOf(f);
    return p ? Object.values(p).some(valueHasHtmlTags) : false;
  });
}

/* Devuelve cuántos valores se han tocado, para poder decirlo en el
   resumen de importación en vez de limpiar en silencio.              */
function stripHtmlTagsFromGeojsonProps(features) {
  let changed = 0;
  const clean = v => {
    if (typeof v === "string") {
      const out = stripHtmlLikeTags(v);
      if (out !== v) changed++;
      return out;
    }
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === "object") {
      for (const k of Object.keys(v)) v[k] = clean(v[k]);
      return v;
    }
    return v;
  };
  for (const f of features) {
    const p = propsOf(f);
    if (p) for (const k of Object.keys(p)) p[k] = clean(p[k]);
  }
  return changed;
}

/* Every <name> in a KML document, regardless of whether it belongs to a
   Placemark, Folder or Document: KML has no separate "polygon name",
   a polygon's name IS its Placemark's <name>.                         */
function kmlNamesHaveHtmlTags(xml) {
  return elsByTag(xml, "name").some(el => hasHtmlLikeTags(el.textContent));
}
function stripHtmlTagsFromKmlNames(xml) {
  for (const el of elsByTag(xml, "name")) {
    const cleaned = stripHtmlLikeTags(el.textContent);
    if (cleaned !== el.textContent) el.textContent = cleaned;
  }
}

/* Some sources export the same point-of-interest twice under the exact
   same name and position (real duplicate rows, not a legitimate pair of
   nearby places) — group Placemarks that share both, so the user can
   choose to keep just one per group. Point-only: a line/polygon has no
   single "position" to compare, so it never joins a group. Position
   equality uses 5 decimal places (~1.1 m), the same tolerance COORD_EPS
   already documents elsewhere in the file as "far above rounding noise"
   — genuine duplicates from the same source are far closer than that;
   two legitimately distinct nearby places never are.                   */
const DUP_POS_DECIMALS = 5;
function findDuplicatePlacemarks(xml) {
  const groups = new Map(); /* "name|lat|lng" -> [<Placemark> elements] */
  for (const pm of elsByTag(xml, "Placemark")) {
    const name = text(pm, "name");
    if (!name) continue;
    const ptEl = elsByTag(pm, "Point")[0];
    const coordsEl = ptEl && firstByTag(ptEl, "coordinates");
    const pts = coordsEl ? parseCoords(coordsEl.textContent) : [];
    if (!pts.length) continue;
    const [lat, lng] = pts[0];
    const key = `${name}|${lat.toFixed(DUP_POS_DECIMALS)}|${lng.toFixed(DUP_POS_DECIMALS)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pm);
  }
  return [...groups.values()].filter(group => group.length > 1);
}
/* Keeps the first Placemark of each group (document order) and removes
   the rest from the DOM, so the normal import pipeline downstream never
   sees them — same "mutate the parsed doc before building records"
   approach as stripHtmlTagsFromKmlNames above. Returns how many were
   removed, for the import summary.                                    */
function removeDuplicatePlacemarks(groups) {
  let removed = 0;
  for (const group of groups) {
    for (let i = 1; i < group.length; i++) {
      group[i].parentNode.removeChild(group[i]);
      removed++;
    }
  }
  return removed;
}

/* Lo mismo para un GeoJSON, que hasta ahora se importaba sin mirar los
   duplicados aunque el problema es idéntico: un exportador que repite la
   misma ficha. Solo cambia de dónde salen el nombre y la posición, así
   que la clave de agrupación, la tolerancia (DUP_POS_DECIMALS) y el
   diálogo son los MISMOS.

   Tres cosas que no son evidentes:
   - En GeoJSON las coordenadas van **[lng, lat]**, al revés que en el
     resto del proyecto.
   - Solo cuenta `Point`, como en KML: una línea o un polígono no tienen
     una posición única que comparar.
   - Se agrupa por el nombre que sale de las PROPIEDADES, nunca por el
     «Elemento N» de respaldo: ese lo da el índice, así que es distinto
     para cada elemento por definición y agruparía por casualidad o no
     agruparía nunca. Es el mismo criterio que el `if (!name) continue`
     del KML, donde un Placemark sin `<name>` tampoco entra en ningún
     grupo.                                                             */
function featureDupName(props, nameKeys) {
  return composeFeatureName(props, nameKeys) || null;
}
function findDuplicateFeatures(features, nameKeys) {
  const groups = new Map(); /* "name|lat|lng" -> [Feature] */
  for (const f of features) {
    const geom = f && f.geometry;
    if (!geom || geom.type !== "Point") continue;
    const [lng, lat] = geom.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const props = (typeof f.properties === "object" && f.properties) || {};
    const name = featureDupName(props, nameKeys);
    if (!name) continue;
    const key = `${name}|${lat.toFixed(DUP_POS_DECIMALS)}|${lng.toFixed(DUP_POS_DECIMALS)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  return [...groups.values()].filter(group => group.length > 1);
}
/* Se queda el primero de cada grupo y los demás salen del ARRAY, que es
   el equivalente de quitarlos del DOM en el camino del KML: así
   buildGeoJsonRecords, que vuelve a sacar los features de `gj`, no
   llega a verlos. Solo hay array que tocar en una FeatureCollection, y
   es también el único caso en el que puede haber duplicados: un
   `Feature` suelto o una geometría pelada son un solo elemento.      */
function removeDuplicateFeatures(gj, groups) {
  if (!gj || gj.type !== "FeatureCollection" || !Array.isArray(gj.features)) return 0;
  const drop = new Set();
  for (const group of groups) for (let i = 1; i < group.length; i++) drop.add(group[i]);
  if (!drop.size) return 0;
  /* EN EL SITIO, no `gj.features = filtrados`: quien llamó tiene ya en
     la mano el array que devolvió geojsonFeatures —es el mismo objeto—
     y sustituirlo dejaría esa referencia apuntando a la lista vieja,
     con los duplicados dentro. Se recorre hacia atrás para que los
     índices no se muevan bajo los pies.                              */
  for (let i = gj.features.length - 1; i >= 0; i--) {
    if (drop.has(gj.features[i])) gj.features.splice(i, 1);
  }
  return drop.size;
}

function parseKmlDocument(content) {
  let xml = new DOMParser().parseFromString(content, "text/xml");
  let why = parserErrorText(xml);
  if (!why) return { xml, repaired: [] };

  const { text, prefixes } = repairUndeclaredPrefixes(content);
  if (prefixes.length) {
    xml = new DOMParser().parseFromString(text, "text/xml");
    const why2 = parserErrorText(xml);
    if (!why2) return { xml, repaired: prefixes };
    why = why2;
  }
  throw new Error(tr("XML no v\u00E1lido: {why}", { why }));
}

/* Asociaciones huella-de-properties → claves-nombre (array ordenado),
   cargadas perezosamente desde IndexedDB (ver dbLoadGnp) la primera vez
   que hace falta. Una forma ya guardada se aplica SIN preguntar (se
   cambia desde el panel Propiedades); addFileNode tiene un único punto
   de llamada y siempre se espera con await dentro del bucle secuencial
   de handleDroppedFiles, así que no hay condición de carrera entre
   importaciones concurrentes sobre este estado compartido.           */
let gnpStore = null;

/* El usuario cerró el selector de nombre sin elegir: se aborta la carga
   de ESE archivo (handleDroppedFiles lo distingue de un fallo real).   */
function importCancelled() {
  const err = new Error(tr("carga cancelada"));
  err.cancelled = true;
  return err;
}

/* Importa un archivo: crea su sección y construye su contenido.
   Para archivos grandes muestra las fases 2 y 3 del progreso:
   "Procesando XML…" (indeterminada) y construcción de capas (por lotes) */
/* Un KML trae su propia jerarquía de <Document> y <Folder>: envolverla en
   otra carpeta con el nombre del archivo añadiría un nivel que no está en
   el original, y la estructura del archivo es intocable. Se vuelca por
   tanto directamente en la raíz. Un GeoJSON, en cambio, es una lista
   plana de elementos sin jerarquía propia, así que ahí la carpeta
   contenedora sí aporta: agrupa lo que llegó junto.                    */
/* `content` es texto, salvo un GeoJSON que ya llega construido (un
   shapefile convertido): pasarlo a texto para volver a leerlo sería
   duplicar en memoria lo más grande de la importación. Sin texto que
   medir, «grande» lo decide el número de elementos.                  */
const BIG_FEATURE_COUNT = 5000;
/* `report`: un informe ya empezado por quien llama (lo que se ve al leer
   un shapefile —sin .prj, ED50…— va en el mismo resumen).             */
/* `presetNameKeys`: un formato que define él mismo qué es el nombre (el
   <name> de un GPX) lo da hecho y no se pregunta ni se recuerda nada.  */
async function addFileNode(name, kind, content, insertBefore = null, dropTargetUl = null, zip = null, report = null, presetNameKeys = null) {
  const big = typeof content === "string"
    ? content.length > SIZE_THRESHOLD
    : geojsonFeatures(content).length > BIG_FEATURE_COUNT;
  report = report || makeImportReport(name);
  coordClamped = 0;
  const ul = dropTargetUl || ensureRootUl();
  const wrap = kind !== "kml";
  const li = wrap ? makeNode({ name, isFile: true }) : null;
  /* Sin envoltorio, lo construido se cuelga de la raíz; se anota qué había
     antes para poder colocarlo en su sitio y para poder deshacerlo si
     algo falla a mitad                                                */
  const before = wrap ? null : new Set(ul.children);
  const target = wrap ? nodeUl(li) : ul;
  if (wrap) {
    ul.insertBefore(li, insertBefore && insertBefore.parentElement === ul ? insertBefore : null);
    /* Importar DENTRO de una carpeta cambia su conjunto de hijos, y se
       puede hacer sobre una colapsada sin desplegarla.              */
    refreshAncestorChecks(li);
  }

  try {
    if (kind === "kml") {
      if (big) {
        /* DOMParser es síncrono y monolítico: solo cabe indicar la fase
           y ceder un frame para que el indicador llegue a pintarse     */
        progress.indet(tr("Procesando XML de {name}\u2026", { name }));
        await yieldFrame();
      }
      const { xml, repaired } = parseKmlDocument(content);
      if (repaired.length) {
        report.note(tr("prefijos XML sin declarar, corregidos al vuelo: {prefixes}", { prefixes: repaired.join(", ") }));
      }
      if (kmlNamesHaveHtmlTags(xml)) {
        if (await confirmStripHtmlTags(name)) {
          stripHtmlTagsFromKmlNames(xml);
          report.note(tr("etiquetas tipo HTML eliminadas de los nombres"));
        }
      }
      const dupGroups = findDuplicatePlacemarks(xml);
      if (dupGroups.length) {
        if (await confirmMergeDuplicates(name, dupGroups)) {
          const removed = removeDuplicatePlacemarks(dupGroups);
          report.note(tr("{removed} placemark(s) duplicado(s) fusionado(s)", { removed }));
        }
      }

      const total = elsByTag(xml, "Placemark").length;
      const prog = big && total ? {
        done: 0,
        update: d => progress.set(100 * d / total,
          tr("Construyendo capas de {name}\u2026 ({d}/{total})", { name, d, total }))
      } : null;
      const styleIndex = buildStyleIndex(xml);
      const records = await buildKmlRecords(xml.documentElement, styleIndex, true, prog, report, zip);
      if (styleIndex.externalRefs) {
        report.note(tr("{externalRefs} estilo(s) en archivos externos, no aplicados", { externalRefs: styleIndex.externalRefs }));
      }
      await materializeRecords(records, target);
    } else {
      if (big) {
        progress.indet(tr("Procesando JSON de {name}\u2026", { name }));
        await yieldFrame();
      }
      const gj = typeof content === "string" ? JSON.parse(content) : content;
      const features = geojsonFeatures(gj);
      /* ANTES de leer firstProps, para que la vista previa del selector
         de propiedad-nombre salga ya limpia. Mismo diálogo que para los
         nombres de un KML: es el mismo problema y la misma decisión. */
      if (geojsonPropsHaveHtmlTags(features)) {
        if (await confirmStripHtmlTags(name, "properties")) {
          const n = stripHtmlTagsFromGeojsonProps(features);
          report.note(tr("etiquetas tipo HTML eliminadas de {n} propiedad(es)", { n }));
        }
      }
      const firstProps = (features[0] && typeof features[0].properties === "object" && features[0].properties) || {};
      let nameKeys = presetNameKeys;
      if (!nameKeys && needsNamePicker(firstProps)) {
        if (!gnpStore) gnpStore = await dbLoadGnp();
        const fp = propsFingerprint(firstProps);
        const stored = gnpStore[fp] || null;
        if (stored) {
          nameKeys = stored;
          navMessage(tr("\u00AB{name}\u00BB: nombre de los elementos seg\u00FAn la selecci\u00F3n guardada ({keys})", { name, keys: stored.join(NAME_JOIN) }), { tone: "info" });
        } else {
          nameKeys = await pickNameProperty(Object.keys(firstProps), name, { sample: firstProps });
          if (!nameKeys) throw importCancelled();
          gnpStore[fp] = nameKeys;
          await dbSaveGnp(gnpStore);
        }
      }
      /* DESPU\u00c9S del selector de propiedad-nombre: el nombre es media
         clave del duplicado, as\u00ed que preguntarlo antes agrupar\u00eda por un
         nombre que el usuario todav\u00eda no ha elegido. Misma pregunta y
         mismo di\u00e1logo que en KML, una sola vez por archivo y v\u00e1lida
         para todos sus grupos.                                        */
      const dupGroups = findDuplicateFeatures(features, nameKeys);
      if (dupGroups.length) {
        if (await confirmMergeDuplicates(name, dupGroups)) {
          const removed = removeDuplicateFeatures(gj, dupGroups);
          report.note(tr("{removed} elemento(s) duplicado(s) fusionado(s)", { removed }));
        }
      }
      /* Se cuenta AQU\u00cd, no antes de fusionar: si no, la barra de
         progreso prometer\u00eda m\u00e1s capas de las que van a construirse. */
      const total = features.length;
      const prog = big && total ? {
        done: 0,
        update: d => progress.set(100 * d / total,
          tr("Construyendo capas de {name}\u2026 ({d}/{total})", { name, d, total }))
      } : null;
      const records = await buildGeoJsonRecords(gj, prog, report, nameKeys);
      /* los GeoJSON arrancan colapsados SIEMPRE: nunca hace falta
         materializar sus filas al importar, van directas a pendientes  */
      li._pending = records;
      li.classList.add("collapsed");
      syncExpanded(li);
    }
  } catch (err) {
    /* Se retira lo que hubiera entrado: media importación es peor que ninguna */
    if (wrap) li.remove();
    else for (const n of [...ul.children]) if (!before.has(n)) n.remove();
    if (rootUl && !rootUl.children.length) showEmptyMessage();
    throw err;
  } finally {
    if (big) progress.hide();
  }

  if (wrap) {
    const count = li._pending ? li._pending.length : nodeUl(li).children.length;
    if (!count) {
      nodeUl(li).innerHTML = `<li class="empty">${tr("Sin geometr\u00EDas.")}</li>`;
    }
  } else {
    const added = [...ul.children].filter(n => !before.has(n));
    if (!added.length) throw new Error(tr("el archivo no contiene ninguna capa"));
    /* Se respeta el punto donde se soltó el archivo */
    if (insertBefore && insertBefore.parentElement === ul) {
      for (const n of added) ul.insertBefore(n, insertBefore);
    }
  }
  /* Resumen de la importación: qué entró, qué se omitió y por qué.
     Si hay algo omitido o alguna advertencia, el aviso espera a que el
     usuario pulse "Aceptar"; si todo ha ido bien, se va solo.        */
  if (coordClamped) {
    report.note(tr("{n} coordenada(s) fuera de rango por redondeo, ajustadas al l\u00EDmite (menos de {eps}\u00B0)",
      { n: coordClamped, eps: COORD_EPS }));
  }
  navMessage(report.summary(), {
    sticky: report.hasIssues,
    tone: report.hasIssues ? "error" : "info"
  });
  return li;  /* null cuando el KML se ha volcado sin envoltorio */
}

/* Cotas de cualquier zip que se abra (KMZ o shapefile comprimido). En
   kmlFromZip, `onPct` recibe el porcentaje descomprimido, la única fase
   con progreso medible de verdad.                                      */
const KMZ_MAX_ENTRIES = 2000;              /* entradas dentro del zip      */
const KMZ_MAX_UNCOMPRESSED = 300 * 1024 * 1024; /* 300 MB descomprimidos    */
const KMZ_MAX_RATIO = 200;                 /* descomprimido / comprimido    */

/* Abre un zip (un KMZ o el .zip de un shapefile) y aplica las cotas
   antes de descomprimir nada. `what` es cómo se le llama en el aviso. */
async function loadZipChecked(file, what) {
  if (typeof JSZip === "undefined") throw new Error(tr("no se pudo cargar el soporte de {what}", { what }));
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  /* Cotas preventivas contra zips desproporcionados ("zip bomb"): el
     visor no impone cuotas de uso, pero sí debe evitar que un archivo
     hostil o accidental agote la memoria del navegador.              */
  const entries = Object.values(zip.files).filter(f => !f.dir);
  if (entries.length > KMZ_MAX_ENTRIES) {
    throw new Error(tr("el {what} tiene demasiadas entradas ({length} > {kmzMaxEntries})", { what, length: entries.length, kmzMaxEntries: KMZ_MAX_ENTRIES }));
  }
  let uncompressed = 0;
  for (const f of entries) {
    const size = (f._data && f._data.uncompressedSize) || 0;
    uncompressed += size;
  }
  if (uncompressed > KMZ_MAX_UNCOMPRESSED) {
    throw new Error(tr("el {what} ocupa demasiado descomprimido ({size})", { what, size: fmtBytes(uncompressed) }));
  }
  if (file.size && uncompressed / file.size > KMZ_MAX_RATIO) {
    throw new Error(tr("relaci\u00F3n de compresi\u00F3n sospechosa (\u00D7{ratio})", { ratio: Math.round(uncompressed / file.size) }));
  }
  return zip;
}

async function kmzToKml(file, onPct) {
  return kmlFromZip(await loadZipChecked(file, "KMZ"), onPct);
}

/* ¿Trae el zip algún KML? Un .zip puede ser un KMZ con otro nombre o
   el de un shapefile: se decide por lo que lleva dentro.             */
function zipHasKml(zip) {
  return zip.file(/\.kml$/i).length > 0;
}

/* El KML principal de un zip ya abierto: doc.kml, o el primero que haya */
async function kmlFromZip(zip, onPct) {
  const entry = zip.file(/(^|\/)doc\.kml$/i)[0] || zip.file(/\.kml$/i)[0];
  if (!entry) throw new Error(tr("el KMZ no contiene ning\u00FAn .kml"));
  const kml = await entry.async("string", onPct ? meta => onPct(meta.percent) : undefined);
  /* Se devuelve tambi\u00E9n el zip (no solo el KML) para poder resolver, m\u00E1s
     adelante, las im\u00E1genes de los GroundOverlay que referencie el KML. */
  return { kml, zip };
}

/* Resolves a GroundOverlay Icon/href against the KMZ archive: exact path
   first, then a loose match by bare filename anywhere in the zip — same
   fallback shape as the doc.kml lookup above, since KML authors are not
   always consistent about leading "./" or folder prefixes.            */
function resolveKmzEntry(zip, href) {
  if (!zip || !href) return null;
  const path = href.split(/[?#]/)[0].replace(/^\.?\//, "");
  const exact = zip.file(path);
  if (exact) return exact;
  const fileName = path.split("/").pop();
  if (!fileName) return null;
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return zip.file(new RegExp(`(^|/)${escaped}$`, "i"))[0] || null;
}

const fmtBytes = n => {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
};

/* Procesa archivos soltados en la navegación; `insertBefore` permite
   insertarlos justo donde se hayan arrastrado                          */
async function handleDroppedFiles(files, insertBefore, dropTargetUl = null) {
  /* Un shapefile son varios archivos (.shp, .dbf, .prj…) que llegan
     sueltos en el mismo gesto: se agrupan por nombre ANTES del bucle, y
     cada grupo entra una vez, en el sitio de su .shp.                  */
  for (const item of groupShapefileParts(files)) {
    if (item.orphan) {
      navMessage(tr("\u00AB{name}\u00BB es parte de un shapefile y no ha llegado su .shp: "
        + "suelte todas las piezas juntas (.shp, .dbf, .prj, .cpg) o el .zip que las contiene.", { name: item.orphan.name }));
      continue;
    }
    if (item.shp) {
      await importShapefileSafely(item.shp, insertBefore, dropTargetUl);
      continue;
    }
    const file = item.file;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const big = file.size > SIZE_THRESHOLD;
    try {
      let kind, content, zip = null;
      if (ext === "kml") { kind = "kml"; content = await file.text(); }
      else if (ext === "kmz") {
        kind = "kml";
        /* Fase 1: descompresión, con progreso determinado de JSZip */
        const kmz = await kmzToKml(file, big
          ? pct => progress.set(pct, tr("Descomprimiendo {name}\u2026", { name: file.name }))
          : null);
        content = kmz.kml;
        zip = kmz.zip;
      }
      else if (ext === "zip") {
        /* Un .zip se reparte por lo que lleva dentro: con KML es un KMZ
           con otro nombre; si no, se buscan shapefiles.               */
        const z = await loadZipChecked(file, "zip");
        if (zipHasKml(z)) {
          kind = "kml";
          const kmz = await kmlFromZip(z, big
            ? pct => progress.set(pct, tr("Descomprimiendo {name}\u2026", { name: file.name }))
            : null);
          content = kmz.kml;
          zip = z;
        } else {
          await importShapefilesFromZip(z, file.name, insertBefore, dropTargetUl);
          continue;
        }
      }
      else if (ext === "tif" || ext === "tiff") {
        /* Una ortofoto COG: no pasa por addFileNode (no es vectorial),
           entra como un nodo propio con sus bytes en IndexedDB.      */
        await addCogNode(file, insertBefore, dropTargetUl);
        scheduleSave();
        continue;
      }
      else if (ext === "json" || ext === "geojson" || ext === "topojson") {
        content = await file.text();
        /* The JSON family is told apart by its shape, not its extension:
           an exported tree, a TopoJSON topology and plain GeoJSON can all
           arrive with the same .json extension.                        */
        const exported = parseTreeExport(content);
        if (exported) {
          await importTreeExport(exported, file.name, insertBefore, dropTargetUl);
          scheduleSave();
          continue;
        }
        let doc;
        try { doc = JSON.parse(content); } catch { doc = null; }
        if (doc && doc.type === "Topology") {
          content = JSON.stringify(topologyToGeoJson(doc));
        }
        kind = "geojson";
      }
      else if (ext === "gpx") {
        await importGpxFile(file, big, insertBefore, dropTargetUl);
        scheduleSave();
        continue;
      }
      else if (ext === "ecw") {
        navMessage(ecwHint(file.name), { sticky: true });
        continue;
      }
      else {
        navMessage(tr("\u00AB{name}\u00BB no est\u00E1 soportado. Formatos admitidos: {importFormats}.", { name: file.name, importFormats: IMPORT_FORMATS }));
        continue;
      }
      await addFileNode(file.name, kind, content, insertBefore, dropTargetUl, zip);
      scheduleSave();
    } catch (err) {
      if (err.cancelled) { navMessage(tr("Carga de \u00AB{name}\u00BB cancelada.", { name: file.name }), { tone: "info" }); continue; }
      navMessage(tr("No se pudo cargar \u00AB{name}\u00BB ({ext}, {size}): {message}", { name: file.name, ext: ext || tr("sin extensi\u00F3n"), size: fmtBytes(file.size), message: err.message }));
    } finally {
      if (big) progress.hide();
    }
  }
}

/* Lo que se acepta, dicho igual en todos los avisos que lo enumeran
   (handleDroppedFiles y el diálogo de 🔗).                          */
const IMPORT_FORMATS = tr("KML, KMZ (incl. ortofotos), GPX, JSON (GeoJSON), TopoJSON, "
  + "shapefiles (.shp con su .dbf y .prj, o en un .zip), ortofotos COG y modelos de elevaci\u00F3n (.tif) "
  + "y carpetas exportadas ({ext})", { ext: EXPORT_EXT });

/* ECW (el formato del Centro de Descargas del CNIG) no se lee: no hay
   decodificador en JS, el SDK de Hexagon es propietario y de pago fuera
   del escritorio, y el libecwj2 abierto solo entiende ECW v2 (el PNOA es
   v3). Se reconoce para decir cómo pasarlo a COG, que sí se abre. Ver
   cog.md.                                                             */
function ecwHint(name) {
  const base = String(name).replace(/\.ecw$/i, "");
  return tr("\u00AB{name}\u00BB es una ortofoto ECW, un formato propietario que el navegador no puede leer. "
    + "Convi\u00E9rtala a COG y suelte el .tif: gdal_translate -of COG -co COMPRESS=JPEG \"{name}\" \"{base}.tif\" "
    + "(necesita GDAL con soporte ECW; QGIS para Windows lo trae: Ráster \u203A Conversión \u203A Traducir, formato COG).",
    { name, base });
}

/* ¿Hay una carpeta bajo el puntero? Mismo test de "esto es un
   contenedor" que ya usan dropZone() (reordenar interno) y
   pasteClipboard() (pegar): nodeUl(li) solo es verdad para carpetas,
   archivos-sección y demás nodos con hijos, nunca para capas sueltas. */
function folderDropTarget(e) {
  const li = e.target.closest ? e.target.closest("li[role=treeitem]") : null;
  return li && nodeUl(li) ? li : null;
}

/* Zona de arrastre: toda la ventana de navegación acepta archivos.
   Soltar sobre una carpeta importa AHÍ DENTRO en vez de en la raíz. */
navPanel.addEventListener("dragover", e => {
  if (dragLi || !e.dataTransfer.types.includes("Files")) return;
  e.preventDefault();
  navPanel.classList.add("drop-hover");
  const folderLi = folderDropTarget(e);
  if (folderLi) markDrop(nodeRow(folderLi), "drop-into"); else clearDropMarks();
});
navPanel.addEventListener("dragleave", e => {
  if (!navPanel.contains(e.relatedTarget)) {
    navPanel.classList.remove("drop-hover");
    clearDropMarks();
  }
});
navPanel.addEventListener("drop", async e => {
  navPanel.classList.remove("drop-hover");
  clearDropMarks();
  if (dragLi || !e.dataTransfer.files.length) return;
  e.preventDefault();
  const folderLi = folderDropTarget(e);
  /* Si se suelta sobre una carpeta, el contenido entra ahí; si no, sobre
     un archivo ya cargado, el nuevo se inserta justo antes (como antes);
     si no, a la raíz. Materializar antes evita que lo nuevo se cuele
     por delante de contenido pendiente cuando la carpeta se despliegue. */
  const insertBefore = !folderLi && e.target.closest ? e.target.closest("li.file") : null;
  if (folderLi) await ensureMaterialized(folderLi);
  handleDroppedFiles([...e.dataTransfer.files], insertBefore, folderLi ? nodeUl(folderLi) : null);
});


/* ---------- Reconocimiento de lo descargado de una dirección ----------
   Gemelo de handleDroppedFiles: mismos formatos y mismo contrato (un
   `File` con nombre), pero aquí el nombre lo pone una URL y el
   contenido llega sin que nadie prometa qué es.

   Todo esto es PURO —ni DOM, ni red— justamente para poder probarlo en
   Node, que es donde se comprueba lo comprobable.

   La regla de fondo es la que el proyecto ya aplica a la familia JSON:
   manda la FORMA del contenido, no la extensión. Aquí es aún más
   necesario, porque media web sirve un GeoJSON desde una ruta que no
   termina en nada.                                                     */

/* Ramas vivas de handleDroppedFiles. Los tres tipos JSON comparten
   extensión a propósito: esa rama vuelve a distinguirlos por su forma,
   así que inventarles `.geojson` o `.topojson` no aportaría nada y sí
   daría un nombre que el servidor no puso.                            */
const URL_KIND_EXT = {
  kml: ".kml", kmz: ".kmz", gpx: ".gpx", geojson: ".json", topojson: ".json", kite: EXPORT_EXT,
  shpzip: ".zip"
};
/* Lo que se le dice al usuario que ha llegado */
const URL_KIND_LABEL = {
  kml: "KML", kmz: tr("KMZ (KML comprimido)"), gpx: "GPX", geojson: "GeoJSON", topojson: "TopoJSON",
  kite: tr("carpeta exportada de KITE (.kite.json)"), shpzip: tr("shapefile comprimido (.zip)")
};

/* Nombre de archivo que sugiere una dirección: el último segmento de su
   ruta. Sin ruta útil (la raíz de un sitio) se usa el host, que al
   menos dice de dónde salió; si no es una URL en absoluto, cadena
   vacía y que decida quien llama.                                     */
function fileNameFromUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return ""; }
  const last = u.pathname.split("/").filter(Boolean).pop() || "";
  let name = last;
  /* Una ruta puede traer %20 y compañía; si viene mal codificada, se
     usa tal cual en vez de perder el nombre entero.                   */
  try { name = decodeURIComponent(last); } catch { /* se queda como está */ }
  return safeFileName(name || u.hostname || "");
}

/* Firma de un zip. Se mira ANTES de decodificar nada: un KMZ es binario
   y pasar 100 MB de zip por TextDecoder no sirve para nada.           */
function isZipSignature(bytes) {
  return !!bytes && bytes.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/* Un JSON ya parseado: los MISMOS criterios que usa handleDroppedFiles
   para repartir la familia JSON, y en el mismo orden.                 */
const GEOJSON_DOC_TYPES = new Set([
  "FeatureCollection", "Feature", "Point", "MultiPoint", "LineString",
  "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"
]);
function sniffJsonKind(doc) {
  if (!doc || typeof doc !== "object") return null;
  if (doc.app === EXPORT_KIND && Array.isArray(doc.nodes)) return "kite";
  if (doc.type === "Topology") return "topojson";
  if (GEOJSON_DOC_TYPES.has(doc.type)) return "geojson";
  return null;
}

/* Texto ya decodificado. Devuelve además "html", que NO es un formato
   admitido pero sí el diagnóstico más útil de todos: es lo que llega
   cuando alguien pega la página de GitHub en vez del enlace «Raw».    */
const SNIFF_HEAD = 4096; /* mirar el principio basta; no es un barrido */
function sniffTextKind(text) {
  /* Fuera el BOM y los blancos: un XML con BOM empieza por "﻿<"  */
  const head = String(text || "").replace(/^﻿/, "").trimStart().slice(0, SNIFF_HEAD);
  if (!head) return null;
  if (head[0] === "<") {
    if (/^<!doctype\s+html|^<html[\s>]/i.test(head)) return "html";
    /* Namespace-agnóstico, como todo el parseo de KML de este archivo:
       <kml>, <kml:kml> y cualquier otro prefijo valen igual.          */
    if (/<\s*(?:[A-Za-z_][\w.-]*:)?kml[\s>]/i.test(head)) return "kml";
    if (/<\s*(?:[A-Za-z_][\w.-]*:)?gpx[\s>]/i.test(head)) return "gpx";
    return null; /* otro XML (una excepción OGC…): no es nuestro */
  }
  if (head[0] === "{" || head[0] === "[") {
    let doc;
    try { doc = JSON.parse(text); } catch { return null; }
    return sniffJsonKind(doc);
  }
  return null;
}

/* Nombres de las entradas de un zip, leídos de su directorio central
   (al final del archivo) sin descomprimir nada: basta para saber si
   es un KMZ o un shapefile. Un zip que no se deja leer así (ZIP64,
   truncado) da lista vacía y quien llama decide; nunca lanza.        */
const ZIP_EOCD_MAX = 22 + 0xFFFF; /* registro final + comentario máximo */
function zipEntryNames(bytes) {
  if (!bytes || bytes.length < 22) return [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stop = Math.max(0, bytes.length - ZIP_EOCD_MAX);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= stop; i--) {
    if (dv.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const count = Math.min(dv.getUint16(eocd + 10, true), KMZ_MAX_ENTRIES);
  let p = dv.getUint32(eocd + 16, true);
  const names = [];
  const dec = new TextDecoder("utf-8");
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014B50) break;
    const nameLen = dv.getUint16(p + 28, true);
    const extra = dv.getUint16(p + 30, true);
    const comment = dv.getUint16(p + 32, true);
    if (p + 46 + nameLen > bytes.length) break;
    names.push(dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)));
    p += 46 + nameLen + extra + comment;
  }
  return names;
}

/* El de verdad: bytes primero (zip), texto después. Un zip con .shp y
   sin .kml es un shapefile; cualquier otro zip se sigue tratando como
   KMZ, que es lo que era siempre (y su aviso, «no contiene ningún
   .kml», sigue siendo el diagnóstico correcto).                      */
function sniffContentKind(bytes, text) {
  if (isZipSignature(bytes)) {
    const names = zipEntryNames(bytes);
    const has = re => names.some(n => re.test(n));
    return has(/\.shp$/i) && !has(/\.kml$/i) ? "shpzip" : "kmz";
  }
  return sniffTextKind(text);
}

/* Nombre final del `File` que se le pasa a handleDroppedFiles, que
   despacha por EXTENSIÓN. Es el puente entre "sé lo que es" y "la
   importación lo reconoce": si el nombre de la URL ya trae una
   extensión de la misma rama se respeta —es el nombre que puso el
   servidor—, y si no se le añade la que toca. Una dirección sin
   extensión (`…/descarga?id=7`) acaba en `descarga.json` o
   `descarga.kml`; una con extensión ajena (`export.php`) en
   `export.php.json`, que es honesto y entra por la rama correcta.    */
function downloadFileName(url, kind) {
  const ext = URL_KIND_EXT[kind];
  if (!ext) return "";
  const base = fileNameFromUrl(url) || "descarga";
  const lower = base.toLowerCase();
  if (kind === "kite") return lower.endsWith(EXPORT_EXT) ? base : base + ext;
  /* Misma RAMA, no misma extensión: un .geojson y un .topojson entran
     los dos por la rama json, así que ninguno necesita renombrarse.  */
  const same = kind === "kml" ? [".kml"]
    : kind === "kmz" ? [".kmz"]
    : kind === "gpx" ? [".gpx"]
    : kind === "shpzip" ? [".zip"]
    : [".json", ".geojson", ".topojson"];
  return same.some(e => lower.endsWith(e)) ? base : base + ext;
}
