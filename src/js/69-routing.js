/* ================= Itineraries with openrouteservice (HeiGIT) =================
   Requested by the user: a route between two points (a marker or any point of
   the map) by car, bicycle or on foot, with its distance and time, using the
   openrouteservice API of HeiGIT with the user's OWN key (entered in
   Propiedades › Fuentes de datos; without it the entries are disabled with the
   reason). Decided with the user: picked from the context menu («Ruta desde
   aquí» / «Ruta hasta aquí», and «Itinerario ›» over a marker) into a small
   non-modal dialog; only the summary (no turn-by-turn instructions); three
   modes.

   - ONE request per calculation, only when the user presses «Calcular»:
     `GET https://api.heigit.org/openrouteservice/v2/directions/{profile}` with
     `api_key`, `start` and `end` (lon,lat) in the query. A SIMPLE request
     (`credentials: "omit"`, no headers of our own: no preflight, see
     url-import.md); the key travels only to that server.
   - The response is foreign input (`parseOrsRoute`): one LineString with
     finite coordinates in range, a vertex cap, a finite summary. Errors come
     in the body, as `{ error: { code, message } }` or `{ error: "text" }`.
   - The result is a NORMAL line layer in the «Itinerarios» section
     (`TREE_SCHEMA` does not change): its card is the table of the Feature's
     properties; an own member `kiteSrc: "ors"` lets the boot add the
     attribution when the saved tree holds one.
   Pure functions first (tested in tests/routing.js), then network, dialog and
   tree (DOM bound the first time the dialog opens). */
/* HeiGIT moved its APIs to one pattern, api.heigit.org/<service>/<version>/, and
   the old api.openrouteservice.org now answers 410 «Deprecated HeiGIT API URL»
   (checked 25 November 2026), with no CORS header, so a browser sees a network
   failure. The new host sends `access-control-allow-origin: *` and answers 403
   with a JSON body to a bad key. The path under it is the service's own. */
const ORS_HOST = "https://api.heigit.org/openrouteservice";
const ORS_PROFILES = {
  "driving-car": { label: N_("Coche"), color: "#1565c0" },
  "cycling-regular": { label: N_("Bicicleta"), color: "#2e7d32" },
  "foot-walking": { label: N_("A pie"), color: "#e65100" }
};
const ORS_DEFAULT_PROFILE = "driving-car";
const ORS_MAX_BYTES = 10 * 1024 * 1024;
const ORS_MAX_VERTICES = 100000;
const ORS_RETRY_DELAYS = [1000, 2000];
const ORS_MESSAGE_MAX = 300;
const ORS_SRC = "ors";
const ROUTES_SECTION = tr("Itinerarios");
const ORS_ATTRIB = '© <a href="https://openrouteservice.org/">openrouteservice.org</a> by HeiGIT · © OpenStreetMap contributors';

/* A key as HeiGIT hands them out (base64-like text, or a longer token): only
   the characters that can travel in a query without surprises. Loose on
   purpose: the service is the one that says whether it is valid. */
function validOrsKey(k) {
  return typeof k === "string" && /^[A-Za-z0-9_=.\-]{20,512}$/.test(k);
}

/* The request. `from`/`to` are { lat, lng }; GeoJSON order (lon,lat) and six
   decimals (~0.1 m). Refuses an unknown profile or a point out of range, so
   nothing malformed reaches the service. */
function orsDirectionsUrl(profile, from, to, key) {
  if (!Object.prototype.hasOwnProperty.call(ORS_PROFILES, profile)) throw new Error(tr("modo de transporte desconocido"));
  if (!validOrsKey(key)) throw new Error(tr("la clave de openrouteservice no es válida"));
  const pair = p => {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) {
      throw new Error(tr("un punto del itinerario no es válido"));
    }
    return `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;
  };
  const q = new URLSearchParams({ api_key: key, start: pair(from), end: pair(to) });
  return `${ORS_HOST}/v2/directions/${profile}?${q}`;
}

/* The route out of the response, or an Error with the reason. The summary may
   leave out a zero (same start and end): read as 0. */
function parseOrsRoute(json) {
  const bad = why => new Error(tr("el servicio ha devuelto un itinerario que no se puede usar ({why})", { why }));
  const f = json && Array.isArray(json.features) ? json.features[0] : null;
  if (!f || f.type !== "Feature" || !f.geometry || f.geometry.type !== "LineString") throw bad(tr("sin línea"));
  const c = f.geometry.coordinates;
  if (!Array.isArray(c) || c.length < 2) throw bad(tr("menos de dos puntos"));
  if (c.length > ORS_MAX_VERTICES) throw bad(tr("demasiados puntos"));
  const coords = [];
  for (const p of c) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])
        || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) throw bad(tr("coordenadas fuera de rango"));
    coords.push([p[0], p[1]]);
  }
  const s = (f.properties && f.properties.summary) || {};
  const num = v => (v === undefined ? 0 : v);
  const distance = num(s.distance), duration = num(s.duration);
  if (!Number.isFinite(distance) || !Number.isFinite(duration) || distance < 0 || duration < 0) throw bad(tr("resumen inválido"));
  return { coords, distance, duration };
}

/* Why the service said no, in words. The body is read first: openrouteservice
   explains itself there (`{ error: { code, message } }`, or a bare string for
   the key and the quota). Known codes get our own sentence; any other message
   is shown as text, cleaned and capped. */
function orsErrorText(status, body) {
  const e = body && body.error;
  const code = e && typeof e === "object" ? e.code : null;
  const raw = e && typeof e === "object" ? e.message : typeof e === "string" ? e : "";
  if (status === 401 || status === 403) return tr("la clave de openrouteservice no es válida o no tiene permiso (revísela en Propiedades → Fuentes de datos)");
  if (status === 429) return tr("se ha agotado la cuota de la clave de openrouteservice (consultas por minuto o por día)");
  if (code === 2009) return tr("no hay ningún itinerario entre los dos puntos con ese modo de transporte");
  if (code === 2010) return tr("uno de los puntos está demasiado lejos de cualquier camino");
  if (code === 2004) return tr("el itinerario es demasiado largo para el servicio");
  const msg = typeof raw === "string" ? raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").trim() : "";
  if (msg) return msg.length > ORS_MESSAGE_MAX ? msg.slice(0, ORS_MESSAGE_MAX) + "…" : msg;
  return describeHttp(status);
}

/* «1 h 23 min», «45 min», «30 s»: rounded to the minute from one minute up */
function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return tr("{n} s", { n: Math.round(seconds) });
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60), m = total % 60;
  if (!h) return tr("{m} min", { m });
  return m ? tr("{h} h {m} min", { h, m }) : tr("{h} h", { h });
}

/* What an end of the itinerary is called: the marker's name, or its
   coordinates in the format chosen in Propiedades */
function routeEndLabel(end, fmt) {
  if (end.name) return end.name;
  return `${formatCoord(end.lat, true, fmt)}, ${formatCoord(end.lng, false, fmt)}`;
}

/* The suffix of the node's name and the card's properties (keys in the
   language of the moment, saved as they are: i18n.md rule 8) */
function routeSummaryText(profile, route, unit) {
  return `${tr(ORS_PROFILES[profile].label)} · ${fmtUnitDist(route.distance, unit)} · ${fmtDuration(route.duration)}`;
}
function routeProps(profile, from, to, route, unit, fmt, when) {
  return {
    [tr("Origen")]: routeEndLabel(from, fmt),
    [tr("Destino")]: routeEndLabel(to, fmt),
    [tr("Modo")]: tr(ORS_PROFILES[profile].label),
    [tr("Distancia")]: fmtUnitDist(route.distance, unit),
    [tr("Duración")]: fmtDuration(route.duration),
    [tr("Calculado")]: when,
    [tr("Servicio")]: "openrouteservice (HeiGIT)"
  };
}
function routeFeature(route, props) {
  return { type: "Feature", properties: props, kiteSrc: ORS_SRC, geometry: { type: "LineString", coordinates: route.coords } };
}

/* Does a saved tree hold itineraries? (the records `serializeTree` gives: a
   layer's `geo` is a FeatureCollection whose features keep `kiteSrc`) */
function routesInRecords(records) {
  const stack = Array.isArray(records) ? [...records] : [];
  while (stack.length) {
    const r = stack.pop();
    if (!r || typeof r !== "object") continue;
    const feats = r.geo && Array.isArray(r.geo.features) ? r.geo.features : [];
    if (feats.some(f => f && f.kiteSrc === ORS_SRC)) return true;
    if (Array.isArray(r.children)) stack.push(...r.children);
  }
  return false;
}

/* ---------- Network, dialog and tree (needs the browser) ---------- */

let orsKey = null;            /* the key, from Propiedades (99-boot.js loads it) */
let routeProfile = ORS_DEFAULT_PROFILE; /* the last mode chosen, for the session */
let routeAttribDone = false;
function ensureRouteAttribution() {
  if (routeAttribDone) return;
  routeAttribDone = true;
  map.attributionControl.addAttribution(ORS_ATTRIB);
}
/* The reason the entries are disabled, or null */
const routeDisabled = () => (orsKey ? null : tr("Necesita una clave de openrouteservice: Propiedades → Fuentes de datos."));

/* One request: a time limit per attempt combined with the user's cancel,
   retries only for what is transient: a time-out, the network, a 5xx. An
   answer below 500 carries `owsCode` and is never retried, like the
   Cadastre's OGC exceptions, and that includes 429: the key's quota is per
   minute or per day, and retrying a second later only spends more of it. */
function orsGet(url, signal) {
  return withElevRetries(async () => {
    const t = AbortSignal.timeout(CFG.ORS_TIMEOUT);
    const resp = await fetch(url, { credentials: "omit", signal: AbortSignal.any([signal, t]) });
    const bytes = await readCapped(resp, ORS_MAX_BYTES);
    let json = null;
    try { json = JSON.parse(new TextDecoder("utf-8").decode(bytes)); } catch { /* handled below */ }
    if (!resp.ok) {
      const err = new Error(orsErrorText(resp.status, json));
      err.status = resp.status;
      if (resp.status < 500) err.owsCode = "ors";
      throw err;
    }
    if (!json) throw Object.assign(new Error(tr("respuesta ilegible")), { owsCode: "ors" });
    return json;
  }, { signal, retries: CFG.ORS_RETRIES, delays: ORS_RETRY_DELAYS });
}
function routeWhy(err) {
  if (err && err.name === "TimeoutError") return tr("el servicio ha tardado más de {seconds} s en responder", { seconds: CFG.ORS_TIMEOUT / 1000 });
  if (err instanceof TypeError) return netFailText(tr("error de red, o el servicio no admite consultas desde el navegador (CORS)"));
  return err && err.message ? err.message : tr("error desconocido");
}

/* The dialog: two ends ({ lat, lng, name }), the mode, «Calcular». Bound to
   the DOM the first time it opens (no DOM work when the file loads). */
const routeEnds = { from: null, to: null };
let routeRun = null; /* { ctrl, cancelled } while a calculation runs */
let routeUiCache = null;
function routeUi() {
  if (routeUiCache) return routeUiCache;
  const dialog = $id("route-dialog");
  const box = dialog.querySelector(".dlg-box");
  setupDialog(box, { modal: false });
  makeDialogMovable(box);
  const ui = routeUiCache = {
    dialog, box, profile: $id("route-profile"), calc: $id("route-calc"),
    fields: { from: $id("route-from"), to: $id("route-to") }
  };
  for (const [id, p] of Object.entries(ORS_PROFILES)) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = tr(p.label);
    ui.profile.appendChild(o);
  }
  ui.profile.addEventListener("change", () => { routeProfile = ui.profile.value; });
  for (const end of ["from", "to"]) {
    ui.fields[end].addEventListener("change", () => readRouteField(end));
    $id(`route-${end}-pick`).addEventListener("click", () => setTool(end === "from" ? "route-from" : "route-to"));
  }
  $id("route-swap").addEventListener("click", () => {
    [routeEnds.from, routeEnds.to] = [routeEnds.to, routeEnds.from];
    renderRouteDialog();
  });
  $id("route-cancel").addEventListener("click", closeRouteDialog);
  ui.calc.addEventListener("click", () => {
    if (ui.calc.dataset.mode === "cancel") { if (routeRun) { routeRun.cancelled = true; routeRun.ctrl.abort(); } return; }
    calculateRoute();
  });
  return ui;
}
const isRouteDialogOpen = () => !!routeUiCache && !routeUiCache.dialog.hidden;

/* A typed end: coordinates (the same reader as the place search). Unreadable,
   the field turns red and the end is empty until fixed. */
function readRouteField(end) {
  const field = routeUiCache.fields[end];
  const at = parsePlaceCoordinates(field.value);
  routeEnds[end] = at ? { lat: at.lat, lng: at.lng, name: null } : null;
  field.classList.toggle("bad", !at && field.value.trim() !== "");
  syncRouteCalc();
}
function renderRouteDialog() {
  const ui = routeUi();
  for (const end of ["from", "to"]) {
    ui.fields[end].value = routeEnds[end] ? routeEndLabel(routeEnds[end], coordFormat) : "";
    ui.fields[end].classList.remove("bad");
  }
  ui.profile.value = routeProfile;
  syncRouteCalc();
}
function syncRouteCalc() {
  const ui = routeUiCache;
  if (!ui || ui.calc.dataset.mode === "cancel") return;
  const why = routeDisabled() || (!routeEnds.from || !routeEnds.to ? tr("Falta el origen o el destino.") : null);
  ui.calc.disabled = !!why;
  ui.calc.title = why || "";
}
function setRouteBusy(busy) {
  const ui = routeUiCache;
  ui.calc.dataset.mode = busy ? "cancel" : "calc";
  ui.calc.textContent = busy ? tr("Cancelar cálculo") : tr("Calcular");
  map.getContainer().classList.toggle("route-busy", busy);
  if (!busy) syncRouteCalc(); else { ui.calc.disabled = false; ui.calc.title = ""; }
}

/* Entry point of the context menu and of the pick tool: fills one end and
   shows the dialog (a second «Ruta hasta…» with it open fills the other) */
function setRouteEnd(end, latlng, name = null) {
  routeEnds[end] = { lat: latlng.lat, lng: latlng.lng, name };
  const ui = routeUi();
  const wasHidden = ui.dialog.hidden;
  renderRouteDialog();
  if (wasHidden) {
    ui.dialog.hidden = false;
    fitInViewport(ui.box);
    focusDialog(ui.box, false); /* opened from the map: its keys stay with the map */
  }
}
/* «Elegir en el mapa»: one click, and a click on a marker takes that marker */
function pickRouteEndAt(tool, latlng) {
  const end = tool === "route-from" ? "from" : "to";
  const hit = layersAtPoint(latlng, map.latLngToContainerPoint(latlng)).find(li => soleMarker(li));
  if (hit) setRouteEnd(end, soleMarker(hit).getLatLng(), hit._name);
  else setRouteEnd(end, latlng);
}
function closeRouteDialog() {
  if (!isRouteDialogOpen()) return;
  if (routeRun) { routeRun.cancelled = true; routeRun.ctrl.abort(); }
  if (activeTool === "route-from" || activeTool === "route-to") setTool(null);
  routeUiCache.dialog.hidden = true;
  releaseFocus();
}

async function calculateRoute() {
  const from = routeEnds.from, to = routeEnds.to;
  if (routeDisabled() || !from || !to || routeRun) return;
  const profile = routeProfile;
  const run = routeRun = { ctrl: new AbortController(), cancelled: false };
  setRouteBusy(true);
  try {
    const route = parseOrsRoute(await orsGet(orsDirectionsUrl(profile, from, to, orsKey), run.ctrl.signal));
    ensureRouteAttribution();
    pushUndo(tr("calcular itinerario"));
    const li = addRouteNode(profile, from, to, route);
    scheduleSave();
    /* The view is never moved: the notice says where the result is */
    highlightNode(li);
    navMessage(tr("Itinerario añadido en «{section}»: {summary}.", { section: ROUTES_SECTION, summary: routeSummaryText(profile, route, measureUnit) }),
      { tone: "info" });
  } catch (err) {
    if (!run.cancelled) navMessage(tr("Error al calcular el itinerario: {reason}.", { reason: routeWhy(err) }));
  } finally {
    routeRun = null;
    if (routeUiCache) setRouteBusy(false);
  }
}

/* The result: a normal line layer in «Itinerarios», styled by mode, with the
   summary in its name and its card */
function addRouteNode(profile, from, to, route) {
  const name = `${nextNumberedName(tr("Itinerario"))} — ${routeSummaryText(profile, route, measureUnit)}`;
  const when = new Date().toLocaleString(uiLang);
  const style = normalizePathStyle({ color: ORS_PROFILES[profile].color, weight: 4 });
  const layer = L.geoJSON(routeFeature(route, routeProps(profile, from, to, route, measureUnit, coordFormat, when)), { style });
  clearFillOnOpenPaths(layer);
  layer.bindPopup(escapeHtml(name), COMPACT_POPUP);
  layer.addTo(rootGroup);
  const li = makeNode({ name, layer, style });
  ensureNamedSection(ROUTES_SECTION).appendChild(li);
  refreshAncestorChecks(li);
  return li;
}
