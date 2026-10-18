---
description: Uso sin conexión: service worker (sw.js generado desde src/sw.js), qué guarda y qué no, lista mandada por la página, indicador «Sin conexión» y mensajes de red.
paths:
  - "src/sw.js"
  - "src/js/06-offline.js"
  - "src/js/07-lazy-libs.js"
  - "src/js/99-boot.js"
  - "build.js"
  - "tests/offline.js"
  - "tests/browser/offline.mjs"
---

## Uso sin conexión (`src/sw.js`, `06-offline.js`)

Pedido del usuario: que una pestaña de KITE que el navegador descarte y recargue al seleccionarla, en un PC sin red, siga siendo KITE (visor, mediciones, análisis) con lo que hay en IndexedDB. Decidido con él, **y por este orden de descartes**:

- **Solo servido por http(s)** (GitHub Pages, su nginx). `file://` se queda como estaba: un service worker no existe ahí. Se descartó empotrar las librerías en el HTML para que `file://` funcione sin red (HTML +0,4-1 MB y se perdía el CDN con SRI).
- **Sin PWA instalable** (ni `manifest`, ni botón de instalar).
- **Precargar TODAS las librerías**, también las bajo demanda: sin geotiff.js/proj4 no se pintan las ortofotos COG guardadas ni se importa un shapefile con `.prj`.
- **Un archivo más, inevitable**: el worker tiene que ser un script del mismo origen (ni `blob:`/`data:`, ni el propio HTML, que Pages sirve como `text/html`). `sw.js` es **GENERADO** (copia literal de `src/sw.js` por `build.js`, tercer artefacto de `--check`) y NO forma parte del producto de un solo archivo: solo importa en el despliegue web. Nunca se edita a mano.

### Qué hace el worker

- **HTML del propio ámbito** (`isPageUrl`): **red primero**. Con red se ve siempre lo último publicado (el aviso de «versión nueva» no cambia). Con copia, un tope de `NAV_TIMEOUT_MS` (4 s) para una red que no responde; sin copia se espera a la red. Un 5xx con copia sirve la copia; un 404 se respeta y no pisa la copia buena. La clave de la caché es la URL como CADENA (no la `Request`): una `Request` real arrastra cabeceras y `Vary: Accept-Encoding` impediría emparejar.
- **Librerías de CDN** (solo `unpkg.com` y `cdnjs.cloudflare.com`, los de la CSP): **caché primero** (URL con versión: inmutable), red si falta.
- **Todo lo demás pasa de largo, sin `respondWith`**: teselas, Nominatim, WCS, GetCapabilities, 🔗, HEAD del aviso de versión, POST y el propio `sw.js`. Nada de terceros-datos se guarda jamás. Quien añada una petición nueva NO tiene que hacer nada: sigue sin pasar por el worker.
- **La lista de qué guardar la manda la PÁGINA**, no el worker (`precacheItems()`, `06-offline.js`): las etiquetas `<script>`/`<link>` con `integrity` del documento + `LAZY_LIBS` + `LEAFLET_PIN_URL`/`LEAFLET_PIN_SHADOW`. Una librería se cambia en un solo sitio (su etiqueta o su entrada de `LAZY_LIBS`, ver `build-and-release.md`) y el worker la sigue; `tests/offline.js` exige que todo lo que manda la página lo acepte el worker.
- **Precarga** (mensaje `precache`): el worker REVALIDA cada entrada (`validPrecacheItem`: origen, `https:`, versión fijada, SRI de un algoritmo admitido; una imagen puede ir sin él), descarga con `integrity` — **el hash se verifica ANTES de guardar** —, `credentials: "omit"`, poda las URL que la página ya no nombra (subida de versión) y trae la página que lo registró (nunca pasó por él: aún no controlaba nada) y la raíz del ámbito. Falla en silencio y se reintenta en el siguiente arranque.
- `install` → `skipWaiting`, `activate` → `clients.claim`. El worker es estático: cambia el nombre de la caché (`kite-libs-N`, `kite-pages-N`) solo si cambia el FORMATO de lo guardado.

### Lo que hace la página (`06-offline.js`)

- `registerOfflineWorker()` se llama **lo último del arranque** (`99-boot.js`, tras restaurar el árbol): no compite con él (regla de `performance.md`). Solo con `serviceWorker` en `navigator`, contexto seguro y `http(s):`. Todo error se traga: es una mejora que nadie ha pedido en ese momento.
- **Indicador `#offline-badge`** (cabecera, bajo los botones, `hidden`): sigue a `navigator.onLine`; el aviso (`navMessage`, tono `info`: no es un fallo) solo sale en una TRANSICIÓN y al arrancar sin red.
- **`netFailText(generico)`**: «sin conexión a la red» solo si `navigator.onLine === false` (es SEGURO que no hay red; `true` no prueba conectividad, así que nunca se usa para impedir un intento). Sustituye al texto genérico («CORS o servicio no disponible») en los `TypeError` de Nominatim, 🔗, elevación, perfil y los catálogos PNOA histórico/Copernicus. `ensureLib` NO la usa a propósito: `tests/lazylibs.js` lo extrae con un DOM de mentira y no tiene `isOffline`.
- **CSP**: `worker-src 'self'` explícito; sin `blob:`.

### Trampas ya pisadas

- **`page.route` no ve lo que contesta un worker**: por eso las pruebas de navegador bloquean los workers por defecto (`serviceWorkers: "block"` en `openApp` y en los `newContext` sueltos) y solo `browser/offline.mjs` los permite. Una suite nueva con `newContext` propio debe copiar el bloqueo, o `console: The script has an unsupported MIME type` (el servidor de pruebas devuelve HTML para todo) la tumbará.
- **`ctx.setOffline(true)` hace fallar al instante TAMBIÉN la petición del worker**: para probar la red colgada hay que volver a `setOffline(false)` y poner el servidor en `hang`; y después de un `hang`, cortar las conexiones colgadas (`dropConnections`), o Chromium las reutiliza y la siguiente petición ya sana se queda detrás de la que nunca se contestó (fallaba 1 de cada 4).
- **No `await handleDroppedFiles(...)` de un GeoJSON** en una prueba: abre el diálogo del nombre y la promesa no vuelve. Un KML evita el diálogo.

### Pruebas

`tests/offline.js` (lo puro y el comportamiento del worker con Cache API y red de mentira, la lista sobre el HTML entregado y la CSP) y `tests/browser/offline.mjs` (registro y precarga, recargar sin red, red colgada, red nueva). Ver `tests/README.md`.
