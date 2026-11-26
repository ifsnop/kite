---
description: Suites de Playwright (tests/browser) — por qué existen, cómo se saltan si no hay navegador, y qué comprueban.
paths:
  - "tests/browser/**"
---

## Pruebas con navegador

Las suites de Node extraen funciones del `<script>` pero no pueden
comprobar que la app ARRANQUE, que los iconos empotrados se pinten,
que el minificado se comporte igual que el legible, o el portapapeles
del sistema entre instancias. Viven en `tests/browser/`.

- **Playwright, no puppeteer**: único que conduce el portapapeles de
  punta a punta; y `npm install` no trae navegador (puppeteer sí) —
  el navegador (~300 MB) va aparte, solo con
  `npx playwright install chromium` (o `npm run browser`).
- **Versión EXACTA, sin `^`: `playwright@1.61.1`** — última que corre
  en Node 18 (Ubuntu 24 LTS); 1.62 exige Node 20. `engines: >=18` no
  sirve para decidir (versiones que lo declaran luego se niegan).
- **Opcionales en local, OBLIGATORIAS en CI.** `npm test` detecta
  navegador lanzándolo de verdad (`_detect.mjs`). Sin navegador: se
  SALTAN y `npm test` sigue en verde. En CI, `KITE_REQUIRE_BROWSER=1`
  convierte el salto en FALLO.
- Sin poder descargar Chromium: `KITE_BROWSER=/ruta/al/chrome` usa uno
  ya instalado (o `channel: "chrome"`/`"msedge"`, Firefox/WebKit).
- **Sin service worker por defecto**: `openApp` crea el contexto con `serviceWorkers: "block"` (y también los `newContext` sueltos de `cog.mjs` y `lazy-libs.mjs`), porque con uno controlando la página `page.route` ya no ve lo que el worker contesta. Solo `offline.mjs` los permite, con `serveSite` (servidor que cambia en caliente entre `up`, `down` y `hang`). Ver `offline.md`.
- **Movimiento reducido por defecto**: `openApp` crea el contexto con `reducedMotion: "reduce"` (y los `newContext` sueltos de `arcgis.mjs`, `cog.mjs`, `lazy-libs.mjs` y `split-save.mjs`), porque la aplicación anima la entrada de menús y ventanas (160 ms) y las suites clican y miden al instante. Una suite con su propio `newContext` lo pone; solo `motion.mjs` pide `no-preference`. Ver `motion.md`.
- **Las teselas de OpenStreetMap son de MENTIRA** (`stubTiles(ctx)`, `_browser.mjs`, una ruta de CONTEXTO que `openApp` pone y que hay que repetir en un `browser.newContext` propio): la aplicación arranca con ese mapa base encendido y cada página pedía ~20 teselas reales —unos cientos por batería contra la política de uso de OpenStreetMap—, y un fallo de red (`net::ERR_CONNECTION_RESET`, visto en el CI con dos ejecuciones a la vez: `attr-table` en una y `seam-outline` en otra, suites que no tienen nada que ver con el mapa) rompía su «sin errores de consola». Una tesela lisa de 67 bytes basta para que Leaflet las dé por cargadas. Una prueba que necesite otras teselas (fallidas, lentas) pone su `page.route`, que manda sobre la del contexto. Lo que SÍ sigue saliendo a la red son las librerías de unpkg y cdnjs (con su SRI): sin copia local no se pueden simular, y si fallan la aplicación ni arranca. `tests/browser/app.mjs` comprueba que el stub está puesto. **`stubTiles` also keeps the «Novedades» window closed** (`window.__kiteSkipWhatsNew`, see `whats-new.md`): it is modal and opens at every start, so it would cover what a suite clicks first; that is why every context must go through `stubTiles`, and `browser/whats-new.mjs` passes `{ whatsNew: true }`. Las herramientas de imágenes (`capturas`, `demo-gif`, `social-image`) SÍ piden las teselas de verdad, una vez cada una.
- **Se sirve por `http://`, nunca `file://`**: IndexedDB necesita
  origen real; dos puertos = dos orígenes, necesario para probar
  copiar/pegar entre instancias.
- **`tests/browser/app.mjs` compara legible vs. minificado**: si terser
  rompe algo, el legible pasa y el minificado no.
- **`page.waitForFunction` NO espera a una promesa**: con un predicado
  `async` (o que devuelva una `Promise`) vuelve al instante, porque la
  promesa ya es «verdadera». Una lectura asíncrona (IndexedDB, `fetch`) se
  sondea desde Node con un bucle sobre `await page.evaluate(...)`. Causó
  un fallo intermitente (1 de cada 3) en `cog.mjs`, en la limpieza de
  blobs huérfanos al arrancar: la comprobación corría contra el borrado.
- **Se espera por CONDICIÓN, no por tiempo** (`openApp` aguarda a que
  `map` exista y el árbol esté resuelto) — nunca `waitForTimeout` fijo.
- **Lo que ES cuestión de tiempo (mantener una tecla, lo que pasa entre dos gestos) usa TIEMPO VIRTUAL, `page.clock`** (`keyboard-nav.mjs`): `await page.clock.install({ time })` tras `openApp` da a la página un `Date`, temporizadores, `requestAnimationFrame` y `performance.now` falsos, **y `await page.clock.pauseAt(time + 1000)` los congela** (solo con `install` el reloj falso SIGUE corriendo a velocidad real: con carga entraron de 42 a 132 ms de tiempo de verdad mientras volvía una llamada a `mouse.wheel`, y dos comprobaciones de la rueda fallaron en doce ejecuciones); `page.clock.runFor(ms)` los hace pasar entonces, un fotograma de 16,7 ms tras otro; el teclado y el ratón siguen siendo reales y Playwright no autorrepite una tecla, así que «mantener» es `down`, `runFor`, `up`. Con `waitForTimeout` esa suite dependía del ritmo de fotogramas de la máquina: con seis procesos de CPU en cuatro núcleos fallaban al menos seis comprobaciones distintas (mantener 1 s dio 472 px en vez de ~550). Reglas: los umbrales salen del MODELO (la integral del perfil, probada en `tests/view-keys.js`), no de un número a ojo; lo que ya estaba programado antes de `install` sigue con reloj real; `page.waitForTimeout` de Playwright es tiempo REAL y no hace pasar el de la página; una sección que no funcione con tiempo falso vuelve al real con `page.clock.resume()` o sondea una condición. Depende de la versión fija de Playwright. Ver «El tiempo en las pruebas» en `tests/README.md`.
- Coste: lanzar navegador 99 ms, cargar app 528 ms, `evaluate` 9 ms.
  Las dos suites completas no llegan a unos pocos segundos.
