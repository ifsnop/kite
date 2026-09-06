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
  throw new Error(`XML no v\u00E1lido: ${why}`);
}

/* Asociaciones huella-de-properties → propiedad-nombre, cargadas
   perezosamente desde IndexedDB (ver dbLoadGnp) la primera vez que
   hace falta. gnpSessionUsed recuerda qué huellas ya se confirmaron en
   ESTA carga de página, para no volver a preguntar por ellas dentro de
   la misma sesión. addFileNode tiene un único punto de llamada y
   siempre se espera con await dentro del bucle secuencial de
   handleDroppedFiles, así que no hay condición de carrera entre
   importaciones concurrentes sobre este estado compartido.           */
let gnpStore = null;
const gnpSessionUsed = new Set();

/* Importa un archivo: crea su sección y construye su contenido.
   Para archivos grandes muestra las fases 2 y 3 del progreso:
   "Procesando XML…" (indeterminada) y construcción de capas (por lotes) */
/* Un KML trae su propia jerarquía de <Document> y <Folder>: envolverla en
   otra carpeta con el nombre del archivo añadiría un nivel que no está en
   el original, y la estructura del archivo es intocable. Se vuelca por
   tanto directamente en la raíz. Un GeoJSON, en cambio, es una lista
   plana de elementos sin jerarquía propia, así que ahí la carpeta
   contenedora sí aporta: agrupa lo que llegó junto.                    */
async function addFileNode(name, kind, content, insertBefore = null, dropTargetUl = null, zip = null) {
  const big = content.length > SIZE_THRESHOLD;
  const report = makeImportReport(name);
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
  }

  try {
    if (kind === "kml") {
      if (big) {
        /* DOMParser es síncrono y monolítico: solo cabe indicar la fase
           y ceder un frame para que el indicador llegue a pintarse     */
        progress.indet(`Procesando XML de ${name}\u2026`);
        await yieldFrame();
      }
      const { xml, repaired } = parseKmlDocument(content);
      if (repaired.length) {
        report.note(`prefijos XML sin declarar, corregidos al vuelo: ${repaired.join(", ")}`);
      }
      if (kmlNamesHaveHtmlTags(xml)) {
        if (await confirmStripHtmlTags(name)) {
          stripHtmlTagsFromKmlNames(xml);
          report.note("etiquetas tipo HTML eliminadas de los nombres");
        }
      }
      const dupGroups = findDuplicatePlacemarks(xml);
      if (dupGroups.length) {
        if (await confirmMergeDuplicates(name, dupGroups)) {
          const removed = removeDuplicatePlacemarks(dupGroups);
          report.note(`${removed} placemark(s) duplicado(s) fusionado(s)`);
        }
      }

      const total = elsByTag(xml, "Placemark").length;
      const prog = big && total ? {
        done: 0,
        update: d => progress.set(100 * d / total,
          `Construyendo capas de ${name}\u2026 (${d}/${total})`)
      } : null;
      const styleIndex = buildStyleIndex(xml);
      const records = await buildKmlRecords(xml.documentElement, styleIndex, true, prog, report, zip);
      if (styleIndex.externalRefs) {
        report.note(`${styleIndex.externalRefs} estilo(s) en archivos externos, no aplicados`);
      }
      await materializeRecords(records, target);
    } else {
      if (big) {
        progress.indet(`Procesando JSON de ${name}\u2026`);
        await yieldFrame();
      }
      const gj = JSON.parse(content);
      const features = geojsonFeatures(gj);
      const total = features.length;
      const firstProps = (features[0] && typeof features[0].properties === "object" && features[0].properties) || {};
      let nameProp = null;
      if (needsNamePicker(firstProps)) {
        if (!gnpStore) gnpStore = await dbLoadGnp();
        const fp = propsFingerprint(firstProps);
        const stored = gnpStore[fp] || null;
        if (stored && gnpSessionUsed.has(fp)) {
          nameProp = stored; /* ya confirmada esta sesi\u00f3n: se aplica sin preguntar */
        } else {
          nameProp = await pickNameProperty(firstProps, name, stored);
          if (nameProp) {
            gnpStore[fp] = nameProp;
            gnpSessionUsed.add(fp);
            await dbSaveGnp(gnpStore);
          }
        }
      }
      const prog = big && total ? {
        done: 0,
        update: d => progress.set(100 * d / total,
          `Construyendo capas de ${name}\u2026 (${d}/${total})`)
      } : null;
      const records = await buildGeoJsonRecords(gj, prog, report, nameProp);
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
      nodeUl(li).innerHTML = '<li class="empty">Sin geometr\u00EDas.</li>';
    }
  } else {
    const added = [...ul.children].filter(n => !before.has(n));
    if (!added.length) throw new Error("el archivo no contiene ninguna capa");
    /* Se respeta el punto donde se soltó el archivo */
    if (insertBefore && insertBefore.parentElement === ul) {
      for (const n of added) ul.insertBefore(n, insertBefore);
    }
  }
  /* Resumen de la importación: qué entró, qué se omitió y por qué.
     Si hay algo omitido o alguna advertencia, el aviso espera a que el
     usuario pulse "Aceptar"; si todo ha ido bien, se va solo.        */
  if (coordClamped) {
    report.note(`${coordClamped} coordenada(s) fuera de rango por redondeo,`
      + ` ajustadas al l\u00EDmite (menos de ${COORD_EPS}\u00B0)`);
  }
  navMessage(report.summary(), {
    sticky: report.hasIssues,
    tone: report.hasIssues ? "error" : "info"
  });
  return li;  /* null cuando el KML se ha volcado sin envoltorio */
}

/* Extrae el KML principal de un KMZ (zip). `onPct` recibe el porcentaje
   descomprimido, la única fase con progreso medible de verdad           */
const KMZ_MAX_ENTRIES = 2000;              /* entradas dentro del zip      */
const KMZ_MAX_UNCOMPRESSED = 300 * 1024 * 1024; /* 300 MB descomprimidos    */
const KMZ_MAX_RATIO = 200;                 /* descomprimido / comprimido    */

async function kmzToKml(file, onPct) {
  if (typeof JSZip === "undefined") throw new Error("no se pudo cargar el soporte de KMZ");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  /* Cotas preventivas contra zips desproporcionados ("zip bomb"): el
     visor no impone cuotas de uso, pero sí debe evitar que un archivo
     hostil o accidental agote la memoria del navegador.              */
  const entries = Object.values(zip.files).filter(f => !f.dir);
  if (entries.length > KMZ_MAX_ENTRIES) {
    throw new Error(`el KMZ tiene demasiadas entradas (${entries.length} > ${KMZ_MAX_ENTRIES})`);
  }
  let uncompressed = 0;
  for (const f of entries) {
    const size = (f._data && f._data.uncompressedSize) || 0;
    uncompressed += size;
  }
  if (uncompressed > KMZ_MAX_UNCOMPRESSED) {
    throw new Error(`el KMZ ocupa demasiado descomprimido (${fmtBytes(uncompressed)})`);
  }
  if (file.size && uncompressed / file.size > KMZ_MAX_RATIO) {
    throw new Error(`relaci\u00F3n de compresi\u00F3n sospechosa (\u00D7${Math.round(uncompressed / file.size)})`);
  }

  const entry = zip.file(/(^|\/)doc\.kml$/i)[0] || zip.file(/\.kml$/i)[0];
  if (!entry) throw new Error("el KMZ no contiene ning\u00FAn .kml");
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
  for (const file of files) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const big = file.size > SIZE_THRESHOLD;
    try {
      let kind, content, zip = null;
      if (ext === "kml") { kind = "kml"; content = await file.text(); }
      else if (ext === "kmz") {
        kind = "kml";
        /* Fase 1: descompresión, con progreso determinado de JSZip */
        const kmz = await kmzToKml(file, big
          ? pct => progress.set(pct, `Descomprimiendo ${file.name}\u2026`)
          : null);
        content = kmz.kml;
        zip = kmz.zip;
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
      else {
        navMessage(`\u00AB${file.name}\u00BB no est\u00E1 soportado. Formatos admitidos: KML, KMZ (incl. ortofotos), JSON (GeoJSON), TopoJSON y carpetas exportadas (${EXPORT_EXT}).`);
        continue;
      }
      await addFileNode(file.name, kind, content, insertBefore, dropTargetUl, zip);
      scheduleSave();
    } catch (err) {
      navMessage(`No se pudo cargar \u00AB${file.name}\u00BB (${ext || "sin extensi\u00F3n"}, ${fmtBytes(file.size)}): ${err.message}`);
    } finally {
      if (big) progress.hide();
    }
  }
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

