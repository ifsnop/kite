/* ===== Nearby Wikipedia articles (Wikipedia, MediaWiki Action API) =====
   «Artículos de Wikipedia en la vista» in the viewer's context menu (submenu
   «Consultas», next to «Elevación» and «Parcela catastral»): the articles
   whose coordinates fall within the reach of the current view from the clicked point
   (the distance to the farthest visible corner, 10 m to 10 km: the API's own range)
   become markers with
   the Wikipedia "W" icon, each one carrying the summary of the article and a
   link to the full article in its card (the ℹ button, or hovering the marker).

   Two kinds of request, both plain GETs with CORS opened by `origin=*`
   (checked with curl on 2026-11-09):
     1. `list=geosearch`: the articles around a point, nearest first.
     2. `prop=extracts` (exintro, explaintext, exsentences=3): their summaries.
        The API returns at most 20 extracts per request, so the pages go in
        chunks of 20, one chunk after the other.
   The result is made of ordinary tree nodes (a folder per query under the
   «Wikipedia» section, one marker per article), so saving, undo, export and
   copy treat it like anything imported. See wikipedia.md.                 */

/* One host per language, written out in full: tests/docs.js reads the servers
   from the string literals of the code and each one needs its row in the
   security study's Annex A. The language is the one of the interface. */
const WIKIPEDIA_APIS = {
  es: "https://es.wikipedia.org/w/api.php",
  en: "https://en.wikipedia.org/w/api.php"
};
const WIKIPEDIA_FALLBACK_LANG = "en";
/* The search radius is the REACH OF THE CURRENT VIEW from the clicked point (see
   wikipediaViewReach), within the range `gsradius` accepts: 10 m to 10 km (an
   out-of-range value is an `outofrange` error, and `gsbbox` has the same kind of
   limit: "toobig"), checked against the service on 2026-11-09. A view wider than
   10 km is searched up to 10 km, and the nearest WIKIPEDIA_LIMIT win. */
const WIKIPEDIA_RADIUS_MIN_M = 10;
const WIKIPEDIA_RADIUS_MAX_M = 10000;
/* The nearest N. In the centre of a big city 100 articles fit in ~300 m: the
   radius is a ceiling, not a promise of coverage (docs/pendientes). */
const WIKIPEDIA_LIMIT = 100;
const WIKIPEDIA_EXTRACT_CHUNK = 20; /* the API's cap for `exlimit` */
const WIKIPEDIA_TIMEOUT = 15000;
/* The service answers "search is too busy" (HTTP 200 with an `error` object)
   roughly one request in three at peak: that is retried like a 503. */
const WIKIPEDIA_RETRIES = 3;
const WIKIPEDIA_RETRY_DELAYS = [1000, 2000, 3000];
const WIKIPEDIA_MAX_BYTES = 2 * 1024 * 1024;
const WIKIPEDIA_MAX_TITLE = 255;
const WIKIPEDIA_MAX_EXTRACT = 1500;
const WIKIPEDIA_SECTION = "Wikipedia"; /* a proper name, the same in every language */
const WIKIPEDIA_ATTRIB = "© Wikipedia (CC BY-SA 4.0)";
const WIKIPEDIA_ICON = "wikipedia";
const WIKIPEDIA_COLOR = "#202122";
const WIKIPEDIA_ICON_SIZE = 30;

/* ---------- The pure part (tested in Node) ---------- */

/* The language of the interface, or English when there is no Wikipedia for it */
function wikipediaLang(code) {
  return Object.prototype.hasOwnProperty.call(WIKIPEDIA_APIS, code) ? code : WIKIPEDIA_FALLBACK_LANG;
}

/* A point that ends up inside a URL: validated, and wrapped into ±180 (the map
   does not wrap, but a coordinate that slipped out must not reach the service).
   Only a number or a non-empty numeric string counts: `Number(null)` is 0, and
   a missing point must not turn into the Gulf of Guinea. */
function wikipediaCoord(latlng) {
  const num = v => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) ? Number(v) : NaN;
  const lat = num(latlng && latlng.lat), lng = num(latlng && latlng.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90) {
    throw new Error(tr("coordenadas no válidas"));
  }
  /* wrapped only when needed: the arithmetic would nudge a valid longitude by a rounding error */
  return { lat, lng: Math.abs(lng) <= 180 ? lng : ((lng + 180) % 360 + 360) % 360 - 180 };
}

/* A reach in metres (what the view covers) → the radius to ask for: whole
   metres, inside the service's range. `capped` says the view was wider than the
   service can search, so the notice can tell the user. */
function wikipediaRadius(meters) {
  const m = Number(meters);
  if (typeof meters === "boolean" || meters === null || !Number.isFinite(m) || m < 0) throw new Error(tr("vista no válida"));
  const radius = Math.min(WIKIPEDIA_RADIUS_MAX_M, Math.max(WIKIPEDIA_RADIUS_MIN_M, Math.ceil(m)));
  return { radius, capped: m > WIKIPEDIA_RADIUS_MAX_M };
}

function wikipediaGeoUrl(lang, latlng, radius) {
  const { lat, lng } = wikipediaCoord(latlng);
  if (!Number.isInteger(radius) || radius < WIKIPEDIA_RADIUS_MIN_M || radius > WIKIPEDIA_RADIUS_MAX_M) {
    throw new Error(tr("radio no válido"));
  }
  const q = new URLSearchParams({
    action: "query", list: "geosearch", gscoord: `${lat.toFixed(6)}|${lng.toFixed(6)}`,
    gsradius: String(radius), gslimit: String(WIKIPEDIA_LIMIT),
    format: "json", formatversion: "2", origin: "*"
  });
  return `${WIKIPEDIA_APIS[wikipediaLang(lang)]}?${q}`;
}

/* The page ids are an input that comes from the service and ends up in a URL
   again: only positive integers, and no more than the API serves per request. */
function wikipediaExtractsUrl(lang, pageIds) {
  if (!Array.isArray(pageIds) || !pageIds.length || pageIds.length > WIKIPEDIA_EXTRACT_CHUNK
      || !pageIds.every(id => Number.isSafeInteger(id) && id > 0)) {
    throw new Error(tr("identificadores de página no válidos"));
  }
  const q = new URLSearchParams({
    action: "query", prop: "extracts", exintro: "1", explaintext: "1", exsentences: "3",
    exlimit: "max", pageids: pageIds.join("|"), format: "json", formatversion: "2", origin: "*"
  });
  return `${WIKIPEDIA_APIS[wikipediaLang(lang)]}?${q}`;
}

/* The link to the full article is built here from the title instead of trusting
   one that comes in the response: the host is ours and the title is encoded. */
function wikipediaArticleUrl(lang, title) {
  const host = WIKIPEDIA_APIS[wikipediaLang(lang)].replace("/w/api.php", "");
  return `${host}/wiki/${encodeURIComponent(String(title).replace(/ /g, "_"))}`;
}

/* Text that comes from the service and is shown to the user: no zero-width or
   control characters (an extract is full of invisible footnote markers),
   normalized line breaks, no empty lines, and a cap. */
function cleanWikipediaText(text, max) {
  const clean = String(text)
    .replace(/[\u200B-\u200F\u2028\u2029\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split("\n").map(l => l.trim()).filter(Boolean).join("\n");
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
}

/* The API reports its errors inside a 200 response. Most are permanent (a bad
   parameter: `owsCode`, never retried) but "search is too busy", maxlag and
   rate limiting are transient and behave like a 503 (retried). */
const WIKIPEDIA_TRANSIENT = /(^|-)too-busy(-|$)|^(maxlag|ratelimited|readonly)$|^internal_api_error/;
function wikipediaCheck(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error(tr("respuesta inesperada"));
  if (!json.error) return json;
  const code = typeof json.error.code === "string" ? json.error.code.slice(0, 60) : "error";
  let err;
  if (WIKIPEDIA_TRANSIENT.test(code)) {
    err = new Error(tr("el servicio está ocupado; vuelva a intentarlo en unos segundos"));
    err.status = 503;
  } else {
    const info = typeof json.error.info === "string" ? ": " + cleanWikipediaText(json.error.info, 160) : "";
    err = new Error(`${code}${info}`);
    err.owsCode = code;
  }
  throw err;
}

/* One entry of `list=geosearch`; null when anything is wrong with it */
function wikipediaArticle(r) {
  if (!r || typeof r !== "object") return null;
  const title = typeof r.title === "string" ? cleanWikipediaText(r.title, WIKIPEDIA_MAX_TITLE).replace(/\s+/g, " ") : "";
  const ok = Number.isSafeInteger(r.pageid) && r.pageid > 0 && title
    && typeof r.lat === "number" && Number.isFinite(r.lat) && Math.abs(r.lat) <= 90
    && typeof r.lon === "number" && Number.isFinite(r.lon) && Math.abs(r.lon) <= 180
    && typeof r.dist === "number" && Number.isFinite(r.dist) && r.dist >= 0;
  return ok ? { pageid: r.pageid, title, lat: r.lat, lon: r.lon, dist: r.dist } : null;
}

/* → { articles, skipped } nearest first, no repeats, never more than the limit */
function parseWikipediaGeosearch(json) {
  wikipediaCheck(json);
  const list = json.query && json.query.geosearch;
  if (!Array.isArray(list)) throw new Error(tr("respuesta inesperada"));
  const seen = new Set(), articles = [];
  let skipped = 0;
  for (const r of list) {
    const a = wikipediaArticle(r);
    if (!a || seen.has(a.pageid)) { skipped++; continue; }
    seen.add(a.pageid);
    articles.push(a);
    if (articles.length >= WIKIPEDIA_LIMIT) break;
  }
  return { articles, skipped };
}

/* → Map pageid → clean summary (a page without one, or a missing page, is left out) */
function parseWikipediaExtracts(json) {
  wikipediaCheck(json);
  const pages = json.query && json.query.pages;
  if (!Array.isArray(pages)) throw new Error(tr("respuesta inesperada"));
  const out = new Map();
  for (const p of pages) {
    if (!p || typeof p !== "object" || p.missing || !Number.isSafeInteger(p.pageid) || p.pageid <= 0) continue;
    if (typeof p.extract !== "string") continue;
    const text = cleanWikipediaText(p.extract, WIKIPEDIA_MAX_EXTRACT);
    if (text) out.set(p.pageid, text);
  }
  return out;
}

/* A distance in the unit the user chose, with the decimals that make it
   useful here: `fmtUnitDist` always prints two, which turns 17 m into
   "0.01 NM" and almost every article (most are within 1 km) into noise. */
const WIKIPEDIA_DIST_DECIMALS = { m: 0, ft: 0, km: 3, mi: 3, nm: 3 };
function wikipediaDistance(meters, unit) {
  const factor = POLY_UNIT_FACTOR[unit], label = POLY_UNIT_LABEL[unit];
  if (!factor) return `${Math.round(meters)} m`;
  return `${(meters / factor).toFixed(WIKIPEDIA_DIST_DECIMALS[unit])} ${label}`;
}

/* Why a request failed, in words for the notice (also used for the chunks of
   summaries that fail, so the user learns the cause and not just the count) */
function wikipediaWhy(err) {
  if (err && err.name === "TimeoutError") {
    return tr("el servicio ha tardado más de {seconds} s en responder", { seconds: WIKIPEDIA_TIMEOUT / 1000 });
  }
  if (err instanceof TypeError) {
    return netFailText(tr("error de red, o el servicio no admite consultas desde el navegador (CORS)"));
  }
  return err && err.message ? err.message : tr("error desconocido");
}

/* Does a saved tree hold Wikipedia markers? (records as `serializeTree` gives
   them: `mstyle.icon` on a layer, `children` on a folder) */
function wikipediaInRecords(records) {
  const stack = Array.isArray(records) ? [...records] : [];
  while (stack.length) {
    const r = stack.pop();
    if (!r || typeof r !== "object") continue;
    if (r.mstyle && r.mstyle.icon === WIKIPEDIA_ICON) return true;
    if (Array.isArray(r.children)) stack.push(...r.children);
  }
  return false;
}

/* The card of an article (the marker's ℹ / hover card): the summary, the link
   to the full article and the credit its licence asks for. Every piece of text
   that came from the service is escaped; `sanitizeHtml` runs again when the
   card is shown, and makes the link open in a new tab with `noopener`.
   `distance` is already formatted in the unit the user chose. */
function wikipediaCardHtml(lang, article, extract, distance) {
  const paragraphs = extract ? extract.split("\n").map(p => `<p>${escapeHtml(p)}</p>`).join("") : "";
  const link = `<a href="${escapeHtml(wikipediaArticleUrl(lang, article.title))}">`
    + `${escapeHtml(tr("Leer el artículo completo en Wikipedia"))}</a>`;
  const credit = tr("A {distance} del punto consultado. Texto de Wikipedia, con licencia CC BY-SA 4.0.", { distance });
  return `${paragraphs}<p>${link}</p><p><small>${escapeHtml(credit)}</small></p>`;
}

/* ---------- Network and tree (needs the browser) ---------- */

/* A plain request (no headers of our own, no credentials: no preflight, see
   url-import.md) with a time limit PER ATTEMPT and retries only for what is
   transient (`withElevRetries`). The response is read as bytes with a cap. */
function wikipediaGet(url) {
  return withElevRetries(async () => {
    const resp = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(WIKIPEDIA_TIMEOUT) });
    if (!resp.ok) {
      const err = new Error(describeHttp(resp.status));
      err.status = resp.status;
      throw err;
    }
    const bytes = await readCapped(resp, WIKIPEDIA_MAX_BYTES);
    let json;
    try { json = JSON.parse(new TextDecoder("utf-8").decode(bytes)); }
    catch { throw new Error(tr("respuesta ilegible")); }
    return wikipediaCheck(json);
  }, { retries: WIKIPEDIA_RETRIES, delays: WIKIPEDIA_RETRY_DELAYS });
}

const wikipediaInFlight = new Set();
let wikipediaAttribDone = false;
/* CC BY-SA asks for the credit wherever the text is shown: once per session
   when a query adds it, and at start-up when the saved tree already holds some */
function ensureWikipediaAttribution() {
  if (wikipediaAttribDone) return;
  wikipediaAttribDone = true;
  map.attributionControl.addAttribution(WIKIPEDIA_ATTRIB);
}
const syncWikipediaBusy = () => map.getContainer().classList.toggle("wikipedia-busy", wikipediaInFlight.size > 0);

/* The summaries, one chunk after the other. A chunk that fails (after its
   retries) does not sink the whole query: its articles just keep the link. */
async function wikipediaExtracts(lang, articles) {
  const extracts = new Map();
  let failed = 0, why = "";
  for (let i = 0; i < articles.length; i += WIKIPEDIA_EXTRACT_CHUNK) {
    const chunk = articles.slice(i, i + WIKIPEDIA_EXTRACT_CHUNK);
    try {
      const got = parseWikipediaExtracts(await wikipediaGet(wikipediaExtractsUrl(lang, chunk.map(a => a.pageid))));
      for (const [id, text] of got) extracts.set(id, text);
    } catch (err) {
      failed += chunk.length;
      why = why || wikipediaWhy(err);
    }
  }
  return { extracts, failed, why };
}

/* One folder per query under the «Wikipedia» section, one marker per article.
   The marker is a normal one with the "W" icon: its style is editable like any
   other, and the card travels with the node (`desc`) so it survives a reload. */
function addWikipediaNodes(lang, articles, extracts) {
  const sectionUl = ensureNamedSection(WIKIPEDIA_SECTION);
  const folder = makeNode({ name: nextNumberedName(WIKIPEDIA_SECTION), isFolder: true });
  sectionUl.appendChild(folder);
  const folderUl = nodeUl(folder);
  for (const a of articles) {
    const layer = L.marker([a.lat, a.lon]).addTo(rootGroup);
    const li = makeNode({
      name: a.title, layer, style: { color: WIKIPEDIA_COLOR },
      desc: wikipediaCardHtml(lang, a, extracts.get(a.pageid) || "", wikipediaDistance(a.dist, measureUnit))
    });
    folderUl.appendChild(li);
    li._mstyle = { ...DEFAULT_MARKER_STYLE, icon: WIKIPEDIA_ICON, color: WIKIPEDIA_COLOR, size: WIKIPEDIA_ICON_SIZE };
    applyMarkerStyle(li);
  }
  /* Collapsed: 100 rows would push the user's other layers out of the panel.
     The query's own notice names the folder, and `highlightNode` (called by
     the query) reveals its row without opening it. */
  folder.classList.add("collapsed");
  syncExpanded(folder);
  refreshAncestorChecks(folder);
  return folder;
}

/* How far the visible map reaches from a point: the distance to the farthest
   corner of the viewer (so everything on screen is inside the circle). The
   corners go through `containerPointToLatLng`, which knows the map rotation. */
function wikipediaViewReach(point) {
  const size = map.getSize();
  const from = L.latLng(point.lat, point.lng);
  return Math.max(...[[0, 0], [size.x, 0], [0, size.y], [size.x, size.y]]
    .map(c => map.distance(from, map.containerPointToLatLng(L.point(c[0], c[1])))));
}

async function queryWikipediaAt(latlng) {
  let point, view;
  try { point = wikipediaCoord(latlng); view = wikipediaRadius(wikipediaViewReach(point)); }
  catch (err) {
    navMessage(tr("Error al consultar Wikipedia: {reason}.", { reason: err.message }));
    return;
  }
  const key = `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
  if (wikipediaInFlight.has(key)) {
    navMessage(tr("Ya se está consultando Wikipedia en ese punto."), { tone: "info" });
    return;
  }
  wikipediaInFlight.add(key);
  syncWikipediaBusy();
  const reach = wikipediaDistance(view.radius, measureUnit);
  try {
    const lang = wikipediaLang(uiLang);
    const { articles, skipped } = parseWikipediaGeosearch(await wikipediaGet(wikipediaGeoUrl(lang, point, view.radius)));
    if (!articles.length) {
      /* "nothing around" and "everything it sent was unusable" are not the same news */
      if (skipped) throw new Error(tr("el servicio ha devuelto artículos que no se pueden usar"));
      navMessage(tr("Wikipedia no tiene ningún artículo a menos de {distance} de ese punto.", { distance: reach }), { tone: "info" });
      return;
    }
    const { extracts, failed, why } = await wikipediaExtracts(lang, articles);
    ensureWikipediaAttribution();

    pushUndo(tr("consultar artículos de Wikipedia"));
    const folder = addWikipediaNodes(lang, articles, extracts);
    scheduleSave();
    /* The view is never moved (a markers query must not take the map from the
       user), so say where the result is: the folder's row is revealed and its
       🔍 frames all the articles. */
    highlightNode(folder);
    navMessage(trn(articles.length,
      "{n} artículo de Wikipedia añadido en «{folder}»; pulse 🔍 en la carpeta para verlo.",
      "{n} artículos de Wikipedia añadidos en «{folder}»; pulse 🔍 en la carpeta para verlos.",
      { folder: folder._name }), { tone: "info" });
    if (articles.length >= WIKIPEDIA_LIMIT) {
      navMessage(tr("Se muestran los {n} artículos más cercanos; puede haber más a menos de {distance}.",
        { n: articles.length, distance: reach }), { tone: "info" });
    }
    if (view.capped) {
      navMessage(tr("La vista es más grande de lo que Wikipedia permite buscar: se han buscado los artículos a menos de {distance} del punto.",
        { distance: reach }), { tone: "info" });
    }
    if (failed) {
      navMessage(tr("No se pudo obtener el resumen de {n} artículo(s) ({reason}): solo llevan el enlace.",
        { n: failed, reason: why }));
    }
  } catch (err) {
    navMessage(tr("Error al consultar Wikipedia: {reason}.", { reason: wikipediaWhy(err) }));
  } finally {
    wikipediaInFlight.delete(key);
    syncWikipediaBusy();
  }
}
