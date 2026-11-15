/* ================= Tunable settings (Propiedades) =================
   Values that used to be fixed constants and that the user can now change
   in the Properties dialog, grouped in tabs (requested, 2026-11-15). Each
   entry keeps the name the constant had, so a grep for INFO_STACK_MAX still
   lands here and on every use (`CFG.INFO_STACK_MAX`).

   - `def` is the value the constant had: «Restaurar» (which wipes the whole
     database) brings every setting back to it. tests/tunables.js pins each
     default, so a default cannot drift without the test saying so.
   - `def`, `min` and `max` are in the unit the CODE uses (ms, bytes, a
     fraction). The dialog shows `value / scale` in `unit`: seconds for a
     timeout, MB for a size, % for a fraction.
   - `int`: the stored value is an integer (counts, ms, bytes, zoom levels).
   - The bounds keep the protections in place: the import limits stop
     hostile files, the network ones keep the discipline of
     external-network.md (timeouts of at most a few minutes, at most five
     retries, at most ten elevation requests per second).

   Only constants that are read when they are USED live here. Anything
   copied at load time (MAX_ZOOM into the map options, ELEV_WINDOW into the
   elevation lattice, the refresh intervals) stays a constant in its file:
   a new value would not reach the copy.

   Saved in IndexedDB as ONE key holding only what differs from the default
   (`tunables`, 32-geojson.js), so a future change to a default reaches
   whoever never touched that setting. Restored at boot (99-boot.js) before
   anything reads them in earnest.                                      */
const TUNABLES_TABS = ["cards", "ui", "map", "files", "net", "elev"];
const TUNABLE_MB = 1024 * 1024;
const TUNABLES = [
  /* ---- Info cards ---- */
  { id: "LAYER_INFO_HOVER_INTENT_MS", tab: "cards", label: N_("Espera antes de abrir la ficha al pasar el ratón"), unit: "ms", def: 250, min: 0, max: 5000, step: 50 },
  { id: "LAYER_INFO_HIDE_DELAY", tab: "cards", label: N_("Espera antes de cerrarla al salir el ratón"), unit: "ms", def: 200, min: 0, max: 5000, step: 50 },
  { id: "INFO_STACK_DWELL_MS", tab: "cards", label: N_("Tiempo sobre una capa para guardarla en las recientes"), unit: "ms", def: 400, min: 0, max: 10000, step: 50 },
  { id: "INFO_STACK_TTL_MS", tab: "cards", label: N_("Duración de una ficha reciente"), unit: "s", scale: 1000, def: 30000, min: 1000, max: 3600000 },
  { id: "INFO_STACK_WARN_MS", tab: "cards", label: N_("Aviso antes de que caduque"), unit: "s", scale: 1000, def: 5000, min: 0, max: 600000 },
  { id: "INFO_STACK_MAX", tab: "cards", label: N_("Fichas recientes como máximo"), def: 6, min: 1, max: 30 },
  { id: "INFO_STACK_MAX_PINNED", tab: "cards", label: N_("Fichas fijadas como máximo"), def: 6, min: 1, max: 30 },

  /* ---- Interface ---- */
  { id: "MSG_TIMEOUT", tab: "ui", label: N_("Duración de un aviso del panel"), unit: "s", scale: 1000, def: 6000, min: 1000, max: 600000 },
  { id: "MSG_MAX_LINES", tab: "ui", label: N_("Avisos a la vista como máximo"), def: 8, min: 1, max: 50 },
  { id: "MSG_LOG_MAX", tab: "ui", label: N_("Avisos guardados en el registro"), def: 200, min: 10, max: 10000 },
  { id: "SEARCH_DEBOUNCE_MS", tab: "ui", label: N_("Pausa al escribir antes de filtrar el árbol"), unit: "ms", def: 150, min: 0, max: 3000, step: 50 },
  { id: "SEARCH_MIN_CHARS", tab: "ui", label: N_("Letras mínimas para filtrar el árbol"), def: 3, min: 1, max: 20 },
  { id: "UNDO_MAX", tab: "ui", label: N_("Pasos que se pueden deshacer"), def: 20, min: 1, max: 100 },
  { id: "PAGE_STEP", tab: "ui", label: N_("Filas que salta Re Pág / Av Pág en el árbol"), def: 10, min: 1, max: 200 },
  { id: "DRAG_THRESHOLD_PX", tab: "ui", label: N_("Distancia para empezar a arrastrar una fila"), unit: "px", def: 6, min: 1, max: 100 },

  /* ---- Map and keyboard ---- */
  { id: "FOCUS_ZOOM", tab: "map", label: N_("Zoom al centrar un punto (🔍)"), def: 14, min: 1, max: 25 },
  /* coordinates are an exact point: street scale, not a region */
  { id: "COORD_SEARCH_ZOOM", tab: "map", label: N_("Zoom al buscar unas coordenadas"), def: 17, min: 1, max: 25 },
  { id: "PLACE_ZOOM", tab: "map", label: N_("Zoom mínimo al elegir un lugar sin extensión"), def: 14, min: 1, max: 25 },
  { id: "FRAME_MARGIN_RATIO", tab: "map", label: N_("Margen al encuadrar una forma"), unit: "%", scale: 0.01, int: false, def: 0.2, min: 0, max: 0.45 },
  { id: "KEY_PAN_STEP", tab: "map", label: N_("Desplazamiento de un toque de flecha"), unit: "px", def: 80, min: 1, max: 2000 },
  { id: "KEY_PAN_SPEED", tab: "map", label: N_("Velocidad al mantener una flecha"), unit: "px/s", def: 400, min: 10, max: 10000, step: 10 },
  { id: "KEY_PAN_MAX_SPEED", tab: "map", label: N_("Velocidad máxima al mantenerla"), unit: "px/s", def: 1600, min: 10, max: 20000, step: 10 },
  { id: "KEY_PAN_SHIFT", tab: "map", label: N_("Multiplicador con Mayús"), unit: "×", int: false, def: 3, min: 1, max: 20, step: 0.5 },
  { id: "KEY_ZOOM_RATE", tab: "map", label: N_("Zoom al mantener Re Pág / Av Pág"), unit: N_("niveles/s"), int: false, def: 3, min: 0.5, max: 20, step: 0.5 },
  { id: "WHEEL_PX_PER_LEVEL", tab: "map", label: N_("Rueda: píxeles por nivel de zoom"), unit: "px", def: 100, min: 10, max: 2000, step: 10 },
  { id: "ROTATE_DEG_PER_PX", tab: "map", label: N_("Giro con el botón central"), unit: "°/px", int: false, def: 0.5, min: 0.05, max: 10, step: 0.05 },
  /* a marker: about the size of its icon; a line: Leaflet's own default
     clickTolerance, widened by the stroke where it is thicker */
  { id: "MARKER_HIT_PX", tab: "map", label: N_("Tolerancia al pulsar un marcador"), unit: "px", def: 20, min: 1, max: 100 },
  { id: "PATH_HIT_PX", tab: "map", label: N_("Tolerancia al pulsar una línea"), unit: "px", def: 10, min: 1, max: 100 },

  /* ---- Files ---- */
  { id: "KMZ_MAX_ENTRIES", tab: "files", label: N_("Archivos dentro de un KMZ o zip"), def: 2000, min: 10, max: 100000 },
  { id: "KMZ_MAX_RATIO", tab: "files", label: N_("Compresión máxima de un KMZ (descomprimido / comprimido)"), unit: "×", def: 200, min: 10, max: 10000 },
  { id: "SHP_MAX_BYTES", tab: "files", label: N_("Tamaño máximo de un shapefile"), unit: "MB", scale: TUNABLE_MB, def: 300 * TUNABLE_MB, min: TUNABLE_MB, max: 4096 * TUNABLE_MB },
  { id: "SHP_MAX_FEATURES", tab: "files", label: N_("Elementos de un shapefile como máximo"), def: 100000, min: 100, max: 10000000, step: 100 },
  { id: "GPX_MAX_POINTS", tab: "files", label: N_("Puntos de un GPX como máximo"), def: 2000000, min: 1000, max: 50000000, step: 1000 },
  { id: "HUGE_IMPORT_CHARS", tab: "files", label: N_("Preguntar antes de abrir un texto de más de"), unit: "MB", scale: TUNABLE_MB, def: 100 * TUNABLE_MB, min: TUNABLE_MB, max: 4096 * TUNABLE_MB },
  { id: "URL_MAX_BYTES", tab: "files", label: N_("Descarga máxima desde una dirección (🔗)"), unit: "MB", scale: TUNABLE_MB, def: 100 * TUNABLE_MB, min: TUNABLE_MB, max: 4096 * TUNABLE_MB },
  /* above it only the internal clipboard gets the copy (the 💾 button exports) */
  { id: "CLIPBOARD_MAX", tab: "files", label: N_("Texto máximo al portapapeles del sistema"), unit: "MB", scale: TUNABLE_MB, def: 5 * TUNABLE_MB, min: TUNABLE_MB, max: 256 * TUNABLE_MB },
  { id: "EXT_MAX_FIELDS", tab: "files", label: N_("Atributos por elemento de un KML como máximo"), def: 200, min: 10, max: 5000 },
  { id: "DUP_POS_DECIMALS", tab: "files", label: N_("Decimales de posición para detectar duplicados"), def: 5, min: 0, max: 10 },
  /* 120: a vertex every 3°, a circle at map scale */
  { id: "EXPORT_CIRCLE_SEGMENTS", tab: "files", label: N_("Vértices de un círculo al exportar"), def: 120, min: 8, max: 3600 },

  /* ---- Network ---- */
  { id: "PLACE_TIMEOUT", tab: "net", label: N_("Tiempo de espera del buscador de lugares"), unit: "s", scale: 1000, def: 10000, min: 1000, max: 120000 },
  { id: "URL_TIMEOUT", tab: "net", label: N_("Tiempo de espera de una descarga (🔗)"), unit: "s", scale: 1000, def: 20000, min: 1000, max: 600000 },
  { id: "CUSTOM_WMS_TIMEOUT", tab: "net", label: N_("Tiempo de espera del catálogo de un WMS propio"), unit: "s", scale: 1000, def: 15000, min: 1000, max: 120000 },
  /* per attempt; a slow source brings its own (Digital Earth Africa, 40 s) */
  { id: "ELEV_TIMEOUT", tab: "net", label: N_("Tiempo de espera de una consulta de elevación"), unit: "s", scale: 1000, def: 12000, min: 1000, max: 120000 },
  { id: "ELEV_RETRIES", tab: "net", label: N_("Reintentos de una consulta de elevación"), def: 3, min: 0, max: 5 },
  /* across every source: a profile waits for its turn */
  { id: "ELEV_MAX_RPS", tab: "net", label: N_("Peticiones de elevación por segundo"), def: 4, min: 1, max: 10 },
  { id: "CADASTRE_TIMEOUT", tab: "net", label: N_("Tiempo de espera del Catastro"), unit: "s", scale: 1000, def: 15000, min: 1000, max: 120000 },
  { id: "CADASTRE_RETRIES", tab: "net", label: N_("Reintentos del Catastro"), def: 2, min: 0, max: 5 },
  /* per attempt */
  { id: "ARCGIS_QUERY_TIMEOUT", tab: "net", label: N_("Tiempo de espera de un servicio ArcGIS"), unit: "s", scale: 1000, def: 30000, min: 1000, max: 300000 },
  { id: "ARCGIS_RETRIES", tab: "net", label: N_("Reintentos de un servicio ArcGIS"), def: 2, min: 0, max: 5 },
  { id: "WIKIPEDIA_TIMEOUT", tab: "net", label: N_("Tiempo de espera de Wikipedia"), unit: "s", scale: 1000, def: 15000, min: 1000, max: 120000 },
  { id: "WIKIPEDIA_RETRIES", tab: "net", label: N_("Reintentos de Wikipedia"), def: 3, min: 0, max: 5 },
  { id: "WIKIPEDIA_LIMIT", tab: "net", label: N_("Artículos de Wikipedia como máximo"), def: 100, min: 1, max: 500 },

  /* ---- Elevation and profile (the Fresnel frequency, its own key, shares the tab) ---- */
  { id: "PF_FRESNEL_ZONE", tab: "elev", label: N_("Zona de Fresnel que debe quedar libre"), unit: "%", scale: 0.01, int: false, def: 0.6, min: 0.1, max: 1 },
  { id: "ELEV_ALERT_DIFF", tab: "elev", label: N_("Aviso rojo si el MDS supera al MDT en más de"), unit: "m", int: false, def: 1, min: 0, max: 100, step: 0.1 },
  { id: "ELEV_CACHE_MAX", tab: "elev", label: N_("Rejillas de elevación en memoria"), def: 200, min: 10, max: 5000 },
  /* the oldest lines go first */
  { id: "PROFILE_LOG_MAX", tab: "elev", label: N_("Líneas del registro de descarga de un perfil"), def: 3000, min: 100, max: 100000, step: 100 },
  { id: "PF_EXPORT_SCALE", tab: "elev", label: N_("Escala del PNG de un perfil"), unit: "×", def: 2, min: 1, max: 4 }
];
const TUNABLE_BY_ID = new Map(TUNABLES.map(t => [t.id, t]));
/* The live values: every use reads CFG.<id> when it runs */
const CFG = Object.fromEntries(TUNABLES.map(t => [t.id, t.def]));

const tunableScale = t => t.scale || 1;
const tunableInt = t => t.int !== false;
/* A value is valid if it is a finite number inside the bounds and, for an
   integer setting, a whole number. Pure: the reader of the saved record and
   the dialog both ask here. */
function tunableValid(t, v) {
  return typeof v === "number" && Number.isFinite(v) && v >= t.min && v <= t.max
    && (!tunableInt(t) || Number.isInteger(v));
}
/* The saved record ({ v, values }) → the values worth applying. Foreign
   input (another tab, an older version, a hand-edited database): an unknown
   id or an invalid value is dropped on its own, the rest still applies. */
const TUNABLES_SCHEMA = 1;
function validTunables(r) {
  const out = {};
  if (!r || typeof r !== "object" || r.v !== TUNABLES_SCHEMA || !r.values || typeof r.values !== "object") return out;
  for (const [id, v] of Object.entries(r.values)) {
    const t = TUNABLE_BY_ID.get(id);
    if (t && tunableValid(t, v)) out[id] = v;
  }
  return out;
}
/* Only what differs from the default is saved */
function tunableOverrides(values = CFG) {
  const out = {};
  for (const t of TUNABLES) if (values[t.id] !== t.def) out[t.id] = values[t.id];
  return out;
}
/* Shown ↔ stored. The shown value is rounded to six significant decimals so
   0.6 / 0.01 reads 60 and not 59.99999999999999. */
const tunableShown = (t, v) => +(v / tunableScale(t)).toFixed(6);
function tunableStored(t, shown) {
  const v = shown * tunableScale(t);
  return tunableInt(t) ? Math.round(v) : +v.toFixed(9);
}
