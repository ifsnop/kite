/* KITE Local service worker: lets the app reload with no network.

   Why it exists: a browser may discard a background tab and reload it
   when it is selected again. Offline, that reload goes to the network and
   ends in the browser's error page, even though the data (IndexedDB) and
   every library the app needs could be served locally. A page cannot
   answer its own reload; only a service worker can.

   What it stores, and nothing else:
   - the app's HTML (same origin), network first so that a connected user
     always gets the latest version, as before;
   - the CDN libraries the page pins with an SRI hash, cache first (their
     URLs carry the version, so they never change).
   Tiles, Nominatim, WCS, GetCapabilities and URL imports are third-party
   DATA: they never go through respondWith, so they behave exactly as they
   did without a worker and nothing of them is kept.

   The list of libraries is NOT written here: the page sends it
   (06-offline.js builds it from its own <script>/<link> tags and from
   LAZY_LIBS), so URLs and hashes live in one place only.

   This file is GENERATED (copied by build.js from src/sw.js). It is not
   part of the single-file product: it only matters when the app is served
   over https (or localhost); opened from file:// no worker is registered. */
const LIBS_CACHE = "kite-libs-1";
const PAGES_CACHE = "kite-pages-1";
/* With a cached copy at hand, a network that does not answer must not
   hold the page hostage: after this the copy is served.               */
const NAV_TIMEOUT_MS = 4000;
/* The origins `script-src`/`style-src` of the CSP already allow. */
const LIB_HOSTS = ["unpkg.com", "cdnjs.cloudflare.com"];

/* A precache entry is DATA sent by a page, so it is validated here too: a
   compromised page must not be able to make the worker store arbitrary
   origins. Pinned version in the path, SRI hash required (images, which
   cannot carry one, are the only exception).                           */
function validPrecacheItem(item) {
  if (!item || typeof item.url !== "string") return false;
  let u;
  try { u = new URL(item.url); } catch { return false; }
  if (u.protocol !== "https:" || !LIB_HOSTS.includes(u.hostname)) return false;
  if (!/[@/]\d+\.\d+\.\d+[/]/.test(u.pathname)) return false;
  if (typeof item.integrity === "string" && item.integrity !== "") {
    return /^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(item.integrity);
  }
  return /\.png$/.test(u.pathname);
}

/* Only the app's own HTML is kept, and only from the worker's own scope. */
function isPageUrl(url, scope) {
  let u;
  try { u = new URL(url); } catch { return false; }
  return u.href.startsWith(scope) && (u.pathname.endsWith("/") || /\.html$/.test(u.pathname));
}

async function precache(msg) {
  const scope = self.registration.scope;
  const items = Array.isArray(msg.items) ? msg.items.filter(validPrecacheItem) : [];
  const libs = await caches.open(LIBS_CACHE);
  for (const it of items) {
    if (await libs.match(it.url, { ignoreVary: true })) continue;
    try {
      /* `integrity` makes fetch reject on a mismatch: what does not match
         is never stored, not just never executed.                       */
      const init = { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" };
      if (it.integrity) init.integrity = it.integrity;
      const res = await fetch(it.url, init);
      if (res.ok) await libs.put(it.url, res);
    } catch { /* offline or blocked: the next start tries again */ }
  }
  /* A version bump leaves the old URL behind: drop what the page no
     longer names, or the cache would only ever grow.                    */
  const wanted = new Set(items.map(it => it.url));
  for (const req of await libs.keys()) {
    if (!wanted.has(req.url)) await libs.delete(req);
  }
  /* The page that registered the worker was loaded BEFORE it controlled
     anything, so its HTML never passed through here: fetch it now.      */
  const pages = await caches.open(PAGES_CACHE);
  const own = [scope, ...(Array.isArray(msg.pages) ? msg.pages : [])].filter(u => isPageUrl(u, scope));
  for (const url of own) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (res.ok) await pages.put(url, res);
    } catch { /* idem */ }
  }
}

async function handleNavigation(event) {
  const url = event.request.url;
  const pages = await caches.open(PAGES_CACHE);
  const cached = await pages.match(url, { ignoreSearch: true, ignoreVary: true });
  const ctrl = new AbortController();
  /* Without a copy there is nothing to fall back to: wait for the network. */
  const timer = cached ? setTimeout(() => ctrl.abort(), NAV_TIMEOUT_MS) : null;
  try {
    const res = await fetch(event.request, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      event.waitUntil(pages.put(url, res.clone()));
      return res;
    }
    return cached && res.status >= 500 ? cached : res;
  } catch {
    clearTimeout(timer);
    return cached || Response.error();
  }
}

async function handleLib(request) {
  const hit = await caches.match(request.url, { cacheName: LIBS_CACHE, ignoreVary: true });
  return hit || fetch(request);
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("message", event => {
  if (event.data && event.data.type === "precache") event.waitUntil(precache(event.data));
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (isPageUrl(req.url, self.registration.scope)) event.respondWith(handleNavigation(event));
  } else if (LIB_HOSTS.includes(url.hostname)) {
    event.respondWith(handleLib(req));
  }
});
