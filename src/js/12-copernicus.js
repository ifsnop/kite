/* ---------- Copernicus DEM (Sentinel Hub del Copernicus Data Space) ----------
   Comprobado contra los servicios reales antes de elegir esta vía:
   Copernicus NO publica ningún WMS anónimo. El de la EEA (EU-DEM v1.1)
   se retiró —su MapServer responde "not started" y su WMSServer da
   404— y el mirror de AWS sirve COG sin cabeceras CORS (y rechaza el
   preflight con 403), así que es ilegible desde el navegador. La única
   vía viva es Sentinel Hub, que autentica sus servicios OGC con un
   "instance ID" de la cuenta de cada usuario: es SU credencial, no una
   nuestra, así que se pide y se guarda en este navegador en lugar de
   incrustarse en el archivo, que se distribuye.
   Verificado también contra el servicio real: manda CORS correctos
   (refleja el Origin), y con un instance ID inválido responde HTTP 400
   con <ServiceException>Invalid instance id</ServiceException>, de modo
   que el error que ve el usuario es el del propio servicio.
   Las capas no se pueden fijar de antemano: cada usuario decide cuáles
   publica su configuración, así que salen de su GetCapabilities igual
   que las del PNOA histórico.                                         */
const COP_WMS_BASE = "https://sh.dataspace.copernicus.eu/ogc/wms/";
const COP_TIMEOUT = 15000;
/* La configuración del usuario puede publicar cualquier cosa, no solo
   elevación, y no hay grupos anidados que agrupar: una sola caja.    */
const COP_WMS_OPTS = { exclude: new Set(), rootGroup: N_("Capas de tu configuración") };

let shInstanceId = null;       /* credencial del usuario, si la ha dado */
let copCatalog = null;
let copError = null;
let copDiscovering = null;

function shWmsUrl() { return COP_WMS_BASE + encodeURIComponent(shInstanceId || ""); }

/* Se acepta el UUID que da el panel de Sentinel Hub. Validar la forma
   aquí evita una petición condenada y un error críptico del servicio. */
function validInstanceId(txt) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(txt.trim());
}

async function fetchCopernicusCatalog() {
  if (copCatalog) return copCatalog;
  if (copDiscovering) return copDiscovering;
  const instanceId = shInstanceId;
  /* La consulta lleva el instance ID con el que empezó. Si la credencial
     cambia (o se borra) mientras vuela, lo que conteste ya no es de la
     configuración actual y no debe pisar su catálogo ni su error, ni
     soltar la consulta nueva que `setInstanceId` ya lanzó. Una credencial
     que vuelve a ser la misma SÍ la valida: es su propia respuesta.   */
  const stale = () => instanceId !== shInstanceId;
  copError = null;
  const discovering = (async () => {
    const r = await fetch(`${shWmsUrl()}?service=WMS&request=GetCapabilities&version=1.3.0`,
      { signal: AbortSignal.timeout(COP_TIMEOUT) });
    const txt = await r.text();
    /* El error OGC viaja en el cuerpo aunque el HTTP sea 400 */
    const ex = parseWmsServiceException(txt);
    if (ex) throw new Error(ex.msg);
    if (!r.ok) throw new Error(describeHttp(r.status));
    const entries = parseWmsCapabilities(txt, COP_WMS_OPTS);
    if (!entries) throw new Error(tr("tu configuración de Sentinel Hub no publica ninguna capa"));
    if (!stale()) copCatalog = entries;
    return entries;
  })().catch(err => {
    if (copDiscovering === discovering) copDiscovering = null; /* permite reintentar en la próxima llamada */
    if (!stale()) {
      copError = err.name === "TimeoutError" ? tr("el servicio no responde")
        : err.message === "Failed to fetch" ? netFailText(tr("no se pudo conectar con Sentinel Hub"))
        : err.message;
    }
    throw err;
  });
  copDiscovering = discovering;
  return discovering;
}

function ensureCopernicusCatalog() {
  if (copCatalog || !shInstanceId) return;
  fetchCopernicusCatalog().then(onDynamicCatalogReady).catch(() => renderBasePanel());
}

/* Cambiar (o borrar) la credencial invalida el catálogo y la capa ya
   creada, cuya URL lleva dentro el instance ID anterior.              */
function setInstanceId(id) {
  shInstanceId = id || null;
  copCatalog = null; copError = null; copDiscovering = null;
  const st = baseState.get("copernicus-dem");
  if (st) {
    if (st.layer && map.hasLayer(st.layer)) map.removeLayer(st.layer);
    st.layer = null;
    st.wmsLayer = null;
    st.failed = false;
    if (!shInstanceId) st.on = false;
  }
  (shInstanceId ? dbSaveSh({ instanceId: shInstanceId }) : dbDeleteSh()).catch(() => {});
  scheduleBaseSave();
  if (shInstanceId) ensureCopernicusCatalog();
  renderBasePanel();
  if (st && st.on) applyBaseLayer("copernicus-dem");
}

/* Registro de fuentes de capa dinámica. Se declara DESPUÉS de las
   funciones que referencia y solo se consulta desde manejadores que
   corren con el script ya evaluado, así que no hay zona muerta.      */
const DYNAMIC_SOURCES = {
  "pnoa-hist": {
    selectTitle: tr("Año / vuelo"),
    get: () => pnoaHistCatalog,
    error: () => pnoaHistError,
    ensure: ensurePnoaHistCatalog,
    pickDefault: pnoaHistDefault,
    groups: groupPnoaHistEntries
  },
  "copernicus": {
    selectTitle: tr("Capa de Copernicus"),
    get: () => copCatalog,
    error: () => copError,
    ensure: ensureCopernicusCatalog,
    pickDefault: entries => entries[0] && entries[0].name,
    groups: entries => [{ group: COP_WMS_OPTS.rootGroup, items: entries }],
    blocked: () => shInstanceId ? null : {
      label: tr("Requiere credencial"),
      hint: tr("Configurar la credencial de Sentinel Hub que exige Copernicus")
    },
    configure: () => openShCredsDialog()
  }
};
/* A user base layer brings its own source (`def.src`, 11-base-panel.js);
   the fixed ones name an entry of this registry.                       */
function dynSource(def) { return (def && (def.src || (def.source && DYNAMIC_SOURCES[def.source]))) || null; }

function ensureDynamicCatalogs() {
  for (const st of baseState.values()) {
    const src = dynSource(st.def);
    /* A user tile layer has no catalog (its source brings no `ensure`):
       nothing to fetch ahead when the panel opens, only the gear ⚙.     */
    if (src && src.ensure) src.ensure();
  }
}

/* Grupo raíz del visor: cuelgan todas las capas de todos los archivos */
const rootGroup = L.featureGroup().addTo(map);
