/* Uso sin conexión: el service worker (src/sw.js, copiado a sw.js) y la
   lista que la página le manda (06-offline.js). Sin navegador, lo que
   esta suite fija es:

   1. Que `sw.js` de la raíz ES el de src/ (lo comprueba también
      `build.js --check`; aquí se ve con nombre propio).
   2. Que el worker no se deja guiar por datos ajenos: `validPrecacheItem`
      solo admite los dos CDN de la CSP, con versión fijada y SRI (o una
      imagen, que no puede llevarlo); `isPageUrl` solo el HTML del propio
      ámbito.
   3. Qué cosas contesta el worker y cuáles NO: solo GET; teselas, APIs
      y descargas por URL pasan de largo (nada de terceros se guarda).
   4. Que la lista de `precacheItems()`, sobre el HTML ENTREGADO, es
      exactamente las etiquetas con integridad + LAZY_LIBS + las dos
      imágenes del marcador, y que el worker acepta todas.
   5. `netFailText` / `isOffline`: «sin conexión» solo cuando el
      navegador dice con seguridad que no hay red.
   6. La CSP permite el worker propio y nada más (`worker-src 'self'`).   */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { parseHTML } = require("linkedom");
const { fn, constDecl, between, HTML_PATH } = require("./_extract");

let failed = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); failed++; } };
const ROOT = path.join(__dirname, "..");

/* ---------- 1. Una sola fuente ---------- */
const swSrc = fs.readFileSync(path.join(ROOT, "src", "sw.js"), "utf8");
ok(fs.existsSync(path.join(ROOT, "sw.js")) && fs.readFileSync(path.join(ROOT, "sw.js"), "utf8") === swSrc,
  "sw.js de la raíz es idéntico a src/sw.js (npm run build)");

/* El worker se evalúa en un contexto con un `self` de mentira que
   recoge sus oyentes. */
function loadWorker(scope = "https://example.test/kite/") {
  const listeners = {};
  /* Cache API y red de mentira: un Map por caché y un fetch que el test
     decide si responde o falla. */
  const stores = new Map();
  const store = name => { if (!stores.has(name)) stores.set(name, new Map()); return stores.get(name); };
  const cacheOf = name => ({
    match: async url => { const r = store(name).get(String(url).split("#")[0].split("?")[0]); return r && r.clone(); },
    put: async (url, res) => { store(name).set(String(url).split("#")[0].split("?")[0], res); },
    keys: async () => [...store(name).keys()].map(url => ({ url })),
    delete: async req => store(name).delete(req.url)
  });
  const net = { fail: false, status: 200, body: "<html>net</html>", calls: [] };
  const sandbox = {
    URL, Response, Promise, Set, Map, JSON, console, AbortController, setTimeout, clearTimeout,
    caches: {
      open: async name => cacheOf(name),
      match: async (url, opts) => cacheOf(opts.cacheName).match(url)
    },
    fetch: async (req, init) => {
      net.calls.push({ url: String(req.url || req), init });
      if (net.fail) throw new TypeError("Failed to fetch");
      return new Response(net.body, { status: net.status });
    },
    self: {
      registration: { scope },
      location: { origin: new URL(scope).origin },
      clients: { claim: () => Promise.resolve() },
      skipWaiting: () => Promise.resolve(),
      addEventListener: (type, fn) => { listeners[type] = fn; }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(swSrc + "\n;this.__api = { validPrecacheItem, isPageUrl, LIBS_CACHE, PAGES_CACHE, NAV_TIMEOUT_MS };", sandbox);
  return { api: sandbox.__api, listeners, stores, net };
}
const { api, listeners, stores, net } = loadWorker();

/* ---------- 2. Qué acepta ---------- */
const H384 = "sha384-" + Buffer.alloc(48, 1).toString("base64");
const H256 = "sha256-" + Buffer.alloc(32, 2).toString("base64");
const item = (url, integrity) => ({ url, integrity });
const V = api.validPrecacheItem;
ok(V(item("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", H256)), "unpkg con versión y sha256");
ok(V(item("https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.22.0/proj4.js", H384)), "cdnjs con versión y sha384");
ok(V({ url: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png" }), "una imagen puede ir sin SRI");
ok(!V({ url: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" }), "un script SIN SRI se rechaza");
ok(!V(item("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "sha1-AAAA")), "SRI de un algoritmo no admitido");
ok(!V(item("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "sha384-no es base64!")), "SRI mal formado");
ok(!V(item("https://evil.test/leaflet@1.9.4/x.js", H384)), "origen ajeno");
ok(!V(item("https://unpkg.com.evil.test/leaflet@1.9.4/x.js", H384)), "origen que solo EMPIEZA como uno admitido");
ok(!V(item("http://unpkg.com/leaflet@1.9.4/x.js", H384)), "http: fuera");
ok(!V(item("https://unpkg.com/leaflet/dist/leaflet.js", H384)), "sin versión fijada en la ruta");
ok(!V(item("not a url", H384)) && !V(null) && !V({}) && !V({ url: 42 }), "basura");

const P = api.isPageUrl, S = "https://example.test/kite/";
ok(P(S, S) && P(S + "kitelocal.min.html", S) && P(S + "index.html?x=1", S), "el HTML del ámbito");
ok(!P("https://example.test/otra/index.html", S), "HTML de fuera del ámbito");
ok(!P("https://otro.test/kite/index.html", S), "otro origen");
ok(!P(S + "sw.js", S) && !P(S + "media/kite.png", S), "ni el worker ni las imágenes");

/* ---------- 3. Qué contesta el worker ---------- */
function dispatchFetch(method, url, mode = "no-cors") {
  let responded = false;
  const event = {
    request: { method, url, mode },
    respondWith: p => { responded = Promise.resolve(p); },
    waitUntil: () => {}
  };
  listeners.fetch(event);
  event.responded = responded;
  dispatchFetch.last = event;
  return !!responded;
}
ok(dispatchFetch("GET", S + "kitelocal.min.html", "navigate"), "navegación al HTML: sí");
ok(dispatchFetch("GET", S), "la raíz del ámbito: sí");
ok(dispatchFetch("GET", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "cors"), "librería del CDN: sí");
ok(!dispatchFetch("HEAD", S + "kitelocal.min.html"), "HEAD (aviso de versión nueva) pasa de largo");
ok(!dispatchFetch("POST", S), "POST pasa de largo");
ok(!dispatchFetch("GET", "https://tile.openstreetmap.org/3/4/2.png"), "teselas: pasan de largo");
ok(!dispatchFetch("GET", "https://nominatim.openstreetmap.org/search?q=madrid"), "Nominatim: pasa de largo");
ok(!dispatchFetch("GET", "https://servicios.idee.es/wcs-inspire/mdt?service=WCS"), "WCS: pasa de largo");
ok(!dispatchFetch("GET", "https://raw.githubusercontent.com/x/y/main/a.kml"), "descarga por URL: pasa de largo");
ok(!dispatchFetch("GET", S + "sw.js"), "el propio worker no se intercepta");
ok(typeof listeners.install === "function" && typeof listeners.activate === "function" && typeof listeners.message === "function",
  "install, activate y message registrados");
ok(api.NAV_TIMEOUT_MS >= 1000 && api.NAV_TIMEOUT_MS <= 10000, "tope de espera de red razonable: " + api.NAV_TIMEOUT_MS);

/* Comportamiento (con red y caché de mentira). Todo dentro de una función
   async que se espera al final. */
const behaviour = (async () => {
  const text = async r => (await r).text();
  const page = S + "kitelocal.min.html";

  /* Con red: gana la red y la copia se refresca */
  net.body = "<html>v1</html>";
  dispatchFetch("GET", page, "navigate");
  ok(await text(dispatchFetch.last.responded) === "<html>v1</html>", "con red se sirve la red");
  await new Promise(r => setImmediate(r));
  ok((await stores.get(api.PAGES_CACHE).get(page).clone().text()) === "<html>v1</html>", "y la copia se guarda");

  /* Sin red: la copia */
  net.fail = true;
  dispatchFetch("GET", page, "navigate");
  ok(await text(dispatchFetch.last.responded) === "<html>v1</html>", "sin red se sirve la copia guardada");

  /* Sin red y sin copia: fallo normal del navegador */
  dispatchFetch("GET", S + "otra.html", "navigate");
  const err = await dispatchFetch.last.responded;
  ok(err.type === "error", "sin red y sin copia: error de red, como sin worker");

  /* Un 5xx con copia: la copia; un 404, el 404 */
  net.fail = false; net.status = 503;
  dispatchFetch("GET", page, "navigate");
  ok(await text(dispatchFetch.last.responded) === "<html>v1</html>", "5xx con copia: la copia");
  net.status = 404; net.body = "nada";
  dispatchFetch("GET", page, "navigate");
  ok(await text(dispatchFetch.last.responded) === "nada", "404: se respeta, no se tapa con la copia");
  ok((await stores.get(api.PAGES_CACHE).get(page).clone().text()) === "<html>v1</html>", "y no pisa la copia buena");

  /* Librerías: caché primero, red si falta */
  net.status = 200; net.body = "/* lib */"; net.fail = false;
  const libUrl = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  const before = net.calls.length;
  dispatchFetch("GET", libUrl, "cors");
  ok(await text(dispatchFetch.last.responded) === "/* lib */" && net.calls.length === before + 1, "librería sin copia: va a la red");

  /* Precarga: guarda lo válido con su SRI, ignora lo inválido, poda lo que sobra y trae la página */
  net.calls.length = 0; net.body = "contenido";
  const good = { url: libUrl, integrity: H384 };
  const old = "https://unpkg.com/leaflet@1.9.3/dist/leaflet.js";
  stores.set(api.LIBS_CACHE, new Map([[old, new Response("viejo")]]));
  let done;
  listeners.message({
    data: {
      type: "precache",
      items: [good, { url: "https://evil.test/leaflet@1.9.4/x.js", integrity: H384 }, { url: libUrl.replace("leaflet.js", "sin-hash.js") }],
      pages: [page, "https://otro.test/kite/index.html"]
    },
    waitUntil: p => { done = p; }
  });
  await done;
  const libs = stores.get(api.LIBS_CACHE);
  ok(libs.has(libUrl) && libs.size === 1, "precarga: guarda la válida y poda la vieja: " + [...libs.keys()]);
  const fetched = net.calls.map(c => c.url);
  ok(!fetched.some(u => u.includes("evil.test") || u.includes("sin-hash") || u.includes("otro.test")), "no pide lo inválido: " + fetched);
  const libCall = net.calls.find(c => c.url === libUrl);
  ok(libCall && libCall.init.integrity === H384 && libCall.init.credentials === "omit" && libCall.init.mode === "cors",
    "la pide con SRI, sin credenciales y en modo cors (el hash se verifica ANTES de guardar)");
  ok(fetched.includes(S) && fetched.includes(page), "trae la página que registró el worker y la raíz del ámbito");
  ok(stores.get(api.PAGES_CACHE).has(S), "y las guarda");

  /* Una librería ya guardada no se vuelve a pedir */
  net.calls.length = 0;
  let done2;
  listeners.message({ data: { type: "precache", items: [good] }, waitUntil: p => { done2 = p; } });
  await done2;
  ok(!net.calls.some(c => c.url === libUrl), "ya guardada: no se vuelve a descargar");

  /* Sin red durante la precarga: no revienta y no borra lo guardado */
  net.fail = true;
  let done3;
  listeners.message({ data: { type: "precache", items: [good, { url: "https://unpkg.com/proj4@2.22.0/x.js", integrity: H384 }] }, waitUntil: p => { done3 = p; } });
  await done3;
  ok(libs.has(libUrl), "precarga sin red: lo guardado sigue ahí");
})();

/* ---------- 4. La lista que manda la página ---------- */
const html = fs.readFileSync(HTML_PATH, "utf8");
const { document } = parseHTML(html);
const lazy = between("const LAZY_LIBS", "const lazyLibPromises");
const build = new Function("document", "navigator",
  lazy + "\n" + constDecl("LEAFLET_PIN_URL") + "\n" + constDecl("LEAFLET_PIN_SHADOW") + "\n" +
  fn("isOffline") + "\n" + fn("netFailText") + "\n" + fn("precacheItems") +
  "\nreturn { LAZY_LIBS, LEAFLET_PIN_URL, LEAFLET_PIN_SHADOW, isOffline, netFailText, precacheItems };");
const env = build(document, { onLine: true });
const items = env.precacheItems();
const urls = items.map(i => i.url);

ok(new Set(urls).size === urls.length, "sin URL repetidas");
const tagged = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="(https:[^"]+)"[^>]*\bintegrity="/g)].map(m => m[1]);
ok(tagged.length >= 4, "el HTML tiene sus etiquetas con integridad: " + tagged.length);
for (const u of tagged) ok(urls.includes(u), "la lista incluye la etiqueta del HTML: " + u);
for (const lib of Object.values(env.LAZY_LIBS)) {
  const it = items.find(i => i.url === lib.url);
  ok(it && it.integrity === lib.integrity, "la lista incluye la bajo demanda, con su SRI: " + lib.url);
}
ok(urls.includes(env.LEAFLET_PIN_URL) && urls.includes(env.LEAFLET_PIN_SHADOW), "y las dos imágenes del marcador");
ok(urls.length === tagged.length + Object.keys(env.LAZY_LIBS).length + 2, "y nada más: " + urls.length);
for (const it of items) ok(api.validPrecacheItem(it), "el worker acepta lo que la página manda: " + it.url);

/* ---------- 5. «Sin conexión» solo con seguridad ---------- */
const mk = onLine => build(document, onLine === undefined ? {} : { onLine });
ok(mk(false).netFailText("genérico") === "sin conexión a la red", "sin interfaz de red: «sin conexión»");
ok(mk(true).netFailText("genérico") === "genérico", "con interfaz de red: el texto de siempre (puede ser CORS)");
ok(mk().netFailText("genérico") === "genérico", "navegador que no informa: el de siempre");
ok(mk(false).isOffline() === true && mk(true).isOffline() === false, "isOffline");

/* ---------- 6. CSP ---------- */
const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || "";
const directive = name => (csp.match(new RegExp("(?:^|;)\\s*" + name + "\\s+([^;]*)")) || [])[1];
ok(directive("worker-src") === "'self'", "worker-src 'self', sin blob: ni más orígenes: " + directive("worker-src"));
ok(!/blob:/.test(directive("script-src") || ""), "script-src sigue sin blob:");

behaviour.then(() => {
  if (failed) { console.error(`${failed} comprobación(es) fallidas`); process.exit(1); }
  console.log("OFFLINE TESTS OK");
});
