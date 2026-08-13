/* kite-diag.js — herramienta de diagnóstico para pegar en la consola de
   Chrome mientras kitelocal.html está abierto (o guardarla como Snippet
   en DevTools → Sources → Snippets, que persiste entre recargas sin
   tocar el archivo de la aplicación).

   No forma parte de kitelocal.html a propósito: es una herramienta de
   desarrollo, no una funcionalidad del producto, así que no lleva BUILD
   ni pasa por el checklist de features. Se apoya en que kitelocal.html
   carga su script como <script> clásico (no type="module"), así que sus
   `let`/`const` de nivel superior (treeEl, rootGroup, svgCache, map,
   selection, undoStack, elevAccum, demOn, clipboard, serializeTree,
   styleKind, nodeLayer, DB_NAME, DB_VERSION, TREE_SCHEMA...) viven en el
   scope léxico global de la página y son visibles desde la consola.

   Uso:
     await kiteDiag()            // resumen completo, tabla en consola
     await kiteDiag({ full: true })   // fuerza toGeoJSON() en capas sin
                                       // caché de geometría (más lento,
                                       // cuenta vértices reales de TODO)
     await kiteDiag({ top: 20 })      // más filas en "las capas más pesadas"

   Devuelve el objeto completo además de imprimirlo, así que también sirve
   para `copy(await kiteDiag())` y pegar el JSON donde haga falta.        */
async function kiteDiag({ full = false, top = 10 } = {}) {
  const t0 = performance.now();
  const out = { generatedAt: new Date().toISOString(), options: { full, top } };

  /* ---------- suma recursiva de coordenadas de un GeoJSON cualquiera ---------- */
  const countCoords = o => {
    if (!o || typeof o !== "object") return 0;
    if (Array.isArray(o)) {
      if (typeof o[0] === "number") return 1; /* es un par/terna [lng,lat(,alt)] */
      return o.reduce((s, x) => s + countCoords(x), 0);
    }
    if (o.type === "FeatureCollection") return o.features.reduce((s, f) => s + countCoords(f), 0);
    if (o.type === "Feature") return countCoords(o.geometry);
    if (o.type === "GeometryCollection") return o.geometries.reduce((s, g) => s + countCoords(g), 0);
    if (o.coordinates) return countCoords(o.coordinates);
    return 0;
  };

  /* ---------- árbol de navegación ---------- */
  const allLis = [...treeEl.querySelectorAll("li[role=treeitem]")];
  const byKind = {};
  let checked = 0, unchecked = 0, maxDepth = 0;
  for (const li of allLis) {
    const kind = li._isContainer ? (li.classList.contains("file") ? "file" : "folder") : (styleKind(li) || "sin-capa");
    byKind[kind] = (byKind[kind] || 0) + 1;
    const chk = li.querySelector(":scope > .node-row > input[type=checkbox]");
    if (chk) chk.checked ? checked++ : unchecked++;
    let depth = 0, p = li.parentElement;
    while (p && p !== treeEl) { if (p.tagName === "UL") depth++; p = p.parentElement; }
    if (depth > maxDepth) maxDepth = depth;
  }
  out.tree = {
    totalNodes: allLis.length,
    byKind,
    checked, unchecked,
    maxDepth,
    domNodesInPanel: treeEl.getElementsByTagName("*").length,
    selectedCount: (typeof selection !== "undefined" ? selection.size : null),
    clipboard: (typeof clipboard !== "undefined" && clipboard)
      ? { nodes: clipboard.nodes.length, cut: clipboard.cut.length, move: !!clipboard.move }
      : null,
  };

  /* ---------- geometría: capas Leaflet reales y su complejidad ---------- */
  let markerLayers = 0, pathLayers = 0, markerPoints = 0, pathVertices = 0;
  let cachedGeo = 0, uncachedGeo = 0, forcedNow = 0;
  let imageOverlays = 0, imageOverlayBytes = 0;
  let measures = 0, elevGrids = 0, elevGridCells = 0;
  const heavy = [];
  for (const li of allLis) {
    if (li._measure) { measures++; continue; }
    if (li._elevGrid) { elevGrids++; elevGridCells += li._elevGrid.cells.length; continue; }
    if (li._imageOverlay) {
      imageOverlays++;
      imageOverlayBytes += (li._imageOverlay.dataUrl || "").length;
      continue;
    }
    if (li._isContainer) continue;
    const layer = nodeLayer(li);
    if (!layer) continue;
    let geo = li._geo;
    if (!geo && full) { geo = layer.toGeoJSON(); li._geo = geo; forcedNow++; }
    if (li._geo) cachedGeo++; else uncachedGeo++;
    if (geo) {
      const n = countCoords(geo);
      if (styleKind(li) === "marker") { markerLayers++; markerPoints += n; }
      else { pathLayers++; pathVertices += n; }
      heavy.push({ name: li._name, kind: styleKind(li), vertices: n });
    }
  }
  heavy.sort((a, b) => b.vertices - a.vertices);
  out.geometry = {
    markerLayers, pathLayers,
    totalVertices: markerPoints + pathVertices,
    markerPoints, pathVertices,
    geoCache: {
      cached: cachedGeo, uncached: uncachedGeo, forcedByThisCall: forcedNow,
      note: full ? "toGeoJSON() forzado en lo que faltaba" : "pasa {full:true} para forzar toGeoJSON() en capas sin caché y contar TODO",
    },
    heaviestLayers: heavy.slice(0, top),
    measures, elevGrids, elevGridCells,
    imageOverlays, imageOverlayApproxBytes: imageOverlayBytes, /* dataURL en memoria, base64 */
  };

  /* ---------- huella real en el DOM del visor (canvas vs marcadores) ----------
     preferCanvas:true hace que polígonos/líneas NO generen nodos DOM, pero
     los marcadores de Leaflet (incl. los de una cuadrícula de elevación) SÍ:
     son siempre L.marker con icono HTML, nunca canvas.                     */
  const paneCount = name => {
    const pane = map.getPane(name);
    return pane ? pane.getElementsByTagName("*").length : null;
  };
  out.dom = {
    documentTotalNodes: document.getElementsByTagName("*").length,
    markerPaneNodes: paneCount("markerPane"),
    overlayPaneNodes: paneCount("overlayPane"), /* debería rondar 1 (el <canvas>) */
    tooltipPaneNodes: paneCount("tooltipPane"),
    popupPaneNodes: paneCount("popupPane"),
  };

  /* ---------- cachés de iconos ---------- */
  out.iconCache = {
    svgCacheEntries: (typeof svgCache !== "undefined" ? svgCache.size : null),
    svgCacheIcons: (typeof svgCache !== "undefined" ? [...svgCache.keys()] : null),
  };

  /* ---------- deshacer/rehacer ---------- */
  const countRecords = nodes => nodes.reduce((s, n) => s + 1 + (n.children ? countRecords(n.children) : 0), 0);
  out.undoRedo = (typeof undoStack !== "undefined") ? {
    undoSnapshots: undoStack.length,
    redoSnapshots: redoStack.length,
    undoTotalRecords: undoStack.reduce((s, snap) => s + countRecords(snap.nodes), 0),
    note: "las instantáneas comparten la geometría cacheada (li._geo), no la clonan: esto cuenta nodos de estructura, no bytes",
  } : null;

  /* ---------- modo altura (MDT/MDS) ---------- */
  out.elevation = {
    demOn: (typeof demOn !== "undefined") ? demOn : null,
    recentRequests: (typeof demTimes !== "undefined") ? demTimes.length : null, /* últimos <1s, ver ELEV_MAX_RPS */
    sessionCells: (typeof elevAccum !== "undefined" && elevAccum) ? elevAccum.cells.length : 0,
    sessionCapped: (typeof elevAccumCapped !== "undefined") ? elevAccumCapped : null,
    accumMaxCells: (typeof ELEV_ACCUM_MAX_CELLS !== "undefined") ? ELEV_ACCUM_MAX_CELLS : null,
  };

  /* ---------- mapas base activos ---------- */
  out.baseLayers = (typeof baseState !== "undefined")
    ? [...baseState.entries()].map(([id, s]) => ({ id, on: s.on, opacity: s.opacity }))
    : null;

  /* ---------- memoria del proceso (solo Chrome, no estándar) ---------- */
  if (performance.memory) {
    const mb = b => Math.round(b / 1048576);
    out.jsHeap = {
      usedMB: mb(performance.memory.usedJSHeapSize),
      totalMB: mb(performance.memory.totalJSHeapSize),
      limitMB: mb(performance.memory.jsHeapSizeLimit),
    };
  } else {
    out.jsHeap = null; /* Firefox/Safari no exponen performance.memory */
  }

  /* ---------- IndexedDB: cuota del navegador + tamaño real serializado ---------- */
  out.storage = { dbName: (typeof DB_NAME !== "undefined") ? DB_NAME : null,
                   dbVersion: (typeof DB_VERSION !== "undefined") ? DB_VERSION : null,
                   treeSchema: (typeof TREE_SCHEMA !== "undefined") ? TREE_SCHEMA : null };
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      out.storage.usageMB = est.usage != null ? +(est.usage / 1048576).toFixed(2) : null;
      out.storage.quotaMB = est.quota != null ? +(est.quota / 1048576).toFixed(2) : null;
    } catch (e) { out.storage.estimateError = String(e); }
  }
  if (typeof serializeTree === "function") {
    const tSer0 = performance.now();
    const payload = JSON.stringify(serializeTree());
    out.storage.serializedTreeMB = +(payload.length / 1048576).toFixed(2);
    out.storage.serializeMs = Math.round(performance.now() - tSer0);
  }

  out.elapsedMs = Math.round(performance.now() - t0);

  console.group("%cKITE diag " + out.generatedAt, "font-weight:bold");
  console.table(out.tree.byKind);
  console.log("árbol", out.tree);
  console.log("geometría", out.geometry);
  if (out.geometry.heaviestLayers.length) console.table(out.geometry.heaviestLayers);
  console.log("DOM", out.dom);
  console.log("cachés de icono", out.iconCache);
  console.log("deshacer/rehacer", out.undoRedo);
  console.log("modo altura", out.elevation);
  console.log("mapas base", out.baseLayers);
  console.log("heap JS", out.jsHeap);
  console.log("almacenamiento", out.storage);
  console.log(`tiempo total del diagnóstico: ${out.elapsedMs} ms`);
  console.groupEnd();

  return out;
}
