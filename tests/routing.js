/* Itineraries with openrouteservice (69-routing.js), the pure part.

   - The request: the profile from the whitelist, lon,lat order with six
     decimals, the key encoded, and nothing malformed reaching the service.
   - The key check (loose: the service decides).
   - The response is foreign input (`parseOrsRoute`): the fixture shaped like
     the documented GeoJSON, then hostile variants.
   - The error texts, read from the body first, per status and code.
   - `fmtDuration`, the summary, the card's properties and the boot check for
     the attribution (`routesInRecords`).
   The service was checked by the user with a real key (2026-11-17). The
   fixture (tests/fixtures/ors-route.json) is still synthetic, shaped like the
   documented `GET /v2/directions/{profile}`; replace it with a captured response
   when a key is at hand. The dialog and the tree are tested in
   tests/browser/routing.mjs.                                              */
const fs = require("fs");
const path = require("path");
const { fn, constDecl, between } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const src = between("const ORS_HOST", "/* A key as HeiGIT") + "\n"
  + ["validOrsKey", "orsDirectionsUrl", "parseOrsRoute", "orsErrorText", "fmtDuration", "routeEndLabel",
    "routeSummaryText", "routeProps", "routeFeature", "routesInRecords"].map(fn).join("\n");
const describeHttp = s => `HTTP ${s}`;
const formatCoord = (v, isLat, mode) => mode === "dms" ? `${v}${isLat ? "N" : "E"}` : v.toFixed(6);
const fmtUnitDist = (m, unit) => `${(m / 1000).toFixed(2)} ${unit}`;
const api = new Function("describeHttp", "formatCoord", "fmtUnitDist", src
  + "\nreturn { ORS_PROFILES, ORS_MAX_VERTICES, ORS_SRC, validOrsKey, orsDirectionsUrl, parseOrsRoute, orsErrorText, fmtDuration,"
  + " routeEndLabel, routeSummaryText, routeProps, routeFeature, routesInRecords };")(describeHttp, formatCoord, fmtUnitDist);
const KEY = "5b3ce3597851110001cf6248abcdefabcdefabcdefabcdef12345678";
const throws = f => { try { f(); } catch (e) { return e.message; } return null; };

/* ---------- 1. The request ---------- */
const url = new URL(api.orsDirectionsUrl("foot-walking", { lat: 40.4167754, lng: -3.7037902 }, { lat: 40.42, lng: -3.7 }, KEY));
ok(url.origin === "https://api.heigit.org" && url.pathname === "/openrouteservice/v2/directions/foot-walking", "servidor y ruta: " + url.origin + url.pathname);
ok(!url.href.includes("api.openrouteservice.org"), "ninguna dirección del servidor antiguo, que responde 410");
ok(url.searchParams.get("start") === "-3.703790,40.416775" && url.searchParams.get("end") === "-3.700000,40.420000",
  "start y end en orden lon,lat con seis decimales: " + url.search);
ok(url.searchParams.get("api_key") === KEY, "la clave va en api_key");
ok(Object.keys(api.ORS_PROFILES).join() === "driving-car,cycling-regular,foot-walking", "solo los tres modos básicos");
ok(throws(() => api.orsDirectionsUrl("driving-hgv", { lat: 0, lng: 0 }, { lat: 1, lng: 1 }, KEY)), "un modo fuera de la lista se rechaza");
ok(throws(() => api.orsDirectionsUrl("__proto__", { lat: 0, lng: 0 }, { lat: 1, lng: 1 }, KEY)), "ni un nombre de Object.prototype");
ok(throws(() => api.orsDirectionsUrl("driving-car", { lat: 91, lng: 0 }, { lat: 1, lng: 1 }, KEY)), "un punto fuera de rango se rechaza");
ok(throws(() => api.orsDirectionsUrl("driving-car", { lat: NaN, lng: 0 }, { lat: 1, lng: 1 }, KEY)), "un punto NaN se rechaza");
ok(throws(() => api.orsDirectionsUrl("driving-car", { lat: 0, lng: 0 }, { lat: 1, lng: 1 }, "x&y=1")), "una clave mal formada no llega a la dirección");

/* ---------- 2. The key ---------- */
ok(api.validOrsKey(KEY), "una clave como las de HeiGIT vale");
ok(api.validOrsKey("eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjEifQ=="), "una con = y más larga, también");
for (const bad of ["", "corta", "con espacio en medio de la clave 12345", "a&b=c-1234567890123456789", "x".repeat(513), 12345678901234567890, null]) {
  ok(!api.validOrsKey(bad), "no es una clave: " + JSON.stringify(bad));
}

/* ---------- 3. The response ---------- */
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "ors-route.json"), "utf8"));
const route = api.parseOrsRoute(fixture);
ok(route.coords.length === 7 && route.coords[0][0] === -3.70379 && route.coords[0][1] === 40.416775, "la línea, en [lon, lat]");
ok(route.distance === 512.3 && route.duration === 95.4, "distancia (m) y duración (s) del resumen");
const clone = () => JSON.parse(JSON.stringify(fixture));
const hostile = {
  "sin features": f => { delete f.features; },
  "un punto": f => { f.features[0].geometry.type = "Point"; },
  "un solo vértice": f => { f.features[0].geometry.coordinates = [[0, 0]]; },
  "una coordenada NaN": f => { f.features[0].geometry.coordinates[2] = [NaN, 40]; },
  "una latitud de 400": f => { f.features[0].geometry.coordinates[2] = [-3.7, 400]; },
  "una coordenada de texto": f => { f.features[0].geometry.coordinates[2] = ["-3.7", "40.4"]; },
  "distancia negativa": f => { f.features[0].properties.summary.distance = -1; },
  "duración de texto": f => { f.features[0].properties.summary.duration = "95"; },
  "demasiados vértices": f => { f.features[0].geometry.coordinates = Array.from({ length: api.ORS_MAX_VERTICES + 1 }, (_, i) => [0, i / 1e6]); }
};
for (const [what, spoil] of Object.entries(hostile)) {
  const f = clone(); spoil(f);
  ok(throws(() => api.parseOrsRoute(f)), "se rechaza una respuesta con " + what);
}
ok(throws(() => api.parseOrsRoute(null)) && throws(() => api.parseOrsRoute("texto")), "y lo que no es un objeto");
const zero = clone(); zero.features[0].properties.summary = {};
const z = api.parseOrsRoute(zero);
ok(z.distance === 0 && z.duration === 0, "un resumen que omite los ceros se lee como 0");

/* ---------- 4. Error texts ---------- */
ok(/clave .* no es válida/.test(api.orsErrorText(403, { error: "Access to this API has been disallowed" })), "403: la clave");
ok(/clave .* no es válida/.test(api.orsErrorText(401, { error: "Authorization field missing" })), "401: la clave");
ok(/cuota/.test(api.orsErrorText(429, { error: "Rate limit exceeded" })), "429: la cuota");
ok(/ningún itinerario/.test(api.orsErrorText(404, { error: { code: 2009, message: "Route could not be found" } })), "2009: sin itinerario");
ok(/demasiado lejos/.test(api.orsErrorText(404, { error: { code: 2010, message: "Could not find routable point" } })), "2010: punto lejos de un camino");
ok(/demasiado largo/.test(api.orsErrorText(400, { error: { code: 2004, message: "Request exceeds distance" } })), "2004: demasiado largo");
ok(api.orsErrorText(400, { error: { code: 2003, message: "Parameter 'x' has incorrect value" } }) === "Parameter 'x' has incorrect value",
  "otro error: el texto del servicio, tal cual");
const NUL = String.fromCharCode(0), RLO = String.fromCharCode(0x202E);
const evil = api.orsErrorText(400, { error: { code: 9, message: "a" + NUL + "b" + RLO + "c" + "x".repeat(400) } });
ok(!evil.includes(NUL) && !evil.includes(RLO) && evil.length <= 301, "un texto hostil sale limpio y recortado");
ok(api.orsErrorText(502, null) === "HTTP 502", "sin cuerpo, describeHttp");

/* ---------- 5. Formatting, card and attribution ---------- */
ok(api.fmtDuration(30.4) === "30 s" && api.fmtDuration(95.4) === "2 min" && api.fmtDuration(2700) === "45 min", "segundos y minutos");
ok(api.fmtDuration(4980) === "1 h 23 min" && api.fmtDuration(7200) === "2 h", "horas y minutos: " + api.fmtDuration(4980));
ok(api.fmtDuration(-1) === "" && api.fmtDuration(NaN) === "", "sin duración válida, nada");
ok(api.routeEndLabel({ lat: 1, lng: 2, name: "Sol" }, "dec") === "Sol", "un extremo con marcador se llama como él");
ok(api.routeEndLabel({ lat: 40.5, lng: -3.25, name: null }, "dec") === "40.500000, -3.250000", "si no, sus coordenadas");
ok(api.routeSummaryText("cycling-regular", route, "km") === "Bicicleta · 0.51 km · 2 min", "el resumen del nombre: " + api.routeSummaryText("cycling-regular", route, "km"));
const props = api.routeProps("driving-car", { lat: 40, lng: -3, name: "A" }, { lat: 41, lng: -4, name: "B" }, route, "km", "dec", "hoy");
ok(props.Origen === "A" && props.Destino === "B" && props.Modo === "Coche" && props.Distancia === "0.51 km" && props.Duración === "2 min",
  "la ficha: " + JSON.stringify(props));
const feat = api.routeFeature(route, props);
ok(feat.kiteSrc === api.ORS_SRC && feat.geometry.type === "LineString", "el Feature lleva su marca de origen");
ok(api.routesInRecords([{ t: "file", children: [{ t: "layer", geo: { type: "FeatureCollection", features: [feat] } }] }]), "un árbol con un itinerario se reconoce");
ok(!api.routesInRecords([{ t: "layer", geo: { type: "FeatureCollection", features: [{ type: "Feature", properties: {} }] } }]) && !api.routesInRecords(null),
  "y uno sin ninguno, no");

if (!process.exitCode) console.log("ROUTING TESTS OK");
